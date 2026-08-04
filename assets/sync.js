/* Sync engine. Auth + household membership; push/pull land in later phases.

   This file never touches the DOM and never reads a global UI variable. The
   Supabase client is INJECTED at init() rather than read off `window.supabase`,
   which is what lets tests drive the real engine against a fake client with no
   network. Everything it needs from the UI arrives as a callback.

   The only client surface this file is allowed to use — keep this list short,
   and keep tests/fake-supabase.js matching it:
     .auth.getSession() .auth.onAuthStateChange(cb) .auth.signInWithOtp()
     .auth.signInWithOAuth() .auth.signOut()
     .rpc(name, args)
     .from(t).select() .eq() .gt() .order() .limit() .upsert() */

const Sync = {
  /* off        — no client; the app is purely local (this is a valid resting state)
     signed-out — client loaded, nobody signed in
     choosing   — signed in, but not in a household yet
     idle       — signed in and settled
     syncing    — a request is in flight
     offline    — network unreachable; local writes are queued
     error      — the last attempt failed for a non-network reason */
  status: 'off',
  client: null,
  session: null,
  householdId: null,
  lastSyncAt: null,
  lastError: null,

  _onStatus: null,
  _getLocal: null,
  _onSnapshot: null,

  get enabled() {
    return !!(Sync.client && Sync.session && Sync.householdId);
  },

  get email() {
    return Sync.session && Sync.session.user ? Sync.session.user.email : null;
  },

  /* `client` is required; the rest are hooks the UI provides.
     getLocal()   -> { items, meals } including tombstones
     onSnapshot() <- called with reconciled { items, meals } to render
     onStatus()   <- called whenever anything user-visible changes */
  async init({ client, getLocal, onStatus, onSnapshot }) {
    Sync.client = client;
    Sync._getLocal = getLocal || (() => ({ items: [], meals: [] }));
    Sync._onSnapshot = onSnapshot || (() => {});
    Sync._onStatus = onStatus || (() => {});

    const { data } = await client.auth.getSession();
    await Sync._adoptSession(data && data.session);

    client.auth.onAuthStateChange((_event, session) => {
      Sync._adoptSession(session);
    });
    return Sync.status;
  },

  /* Called on init and on every auth change. Deliberately does NOT create a
     household: an invited user who lands here must get the chance to redeem
     their code, and auto-creating would strand them in an orphan solo
     household that then has to be merged out of existence. */
  async _adoptSession(session) {
    Sync.session = session || null;
    if (!session) {
      Sync.householdId = null;
      DB.syncing = false;
      return Sync._set('signed-out');
    }
    Sync._set('syncing');
    try {
      const { data, error } = await Sync.client.rpc('my_household');
      if (error) throw error;
      Sync.householdId = data || null;
      DB.syncing = !!data;
      Sync._set(data ? 'idle' : 'choosing');
    } catch (e) {
      Sync._fail(e);
    }
  },

  _set(status) {
    Sync.status = status;
    if (status !== 'error') Sync.lastError = null;
    Sync._onStatus(Sync.snapshotStatus());
    return status;
  },

  _fail(e) {
    // A dead network is a normal state for this app, not an error to report.
    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false)
      || /fetch|network|Failed to fetch/i.test((e && e.message) || '');
    Sync.lastError = (e && e.message) || String(e);
    return Sync._set(offline ? 'offline' : 'error');
  },

  /* Everything the settings panel needs, in one plain object, so the UI never
     reaches into Sync's internals. */
  snapshotStatus() {
    return {
      status: Sync.status,
      email: Sync.email,
      householdId: Sync.householdId,
      lastSyncAt: Sync.lastSyncAt,
      error: Sync.lastError
    };
  },

  // ---- auth ----

  /* Magic link. No password is ever created, stored, typed or reset, which
     removes a whole class of security burden from the project. */
  async signInWithEmail(email, redirectTo) {
    const clean = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('Enter a valid email address.');
    const { error } = await Sync.client.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: redirectTo }
    });
    if (error) throw error;
    return true;
  },

  async signInWithGoogle(redirectTo) {
    const { error } = await Sync.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) throw error;
    return true;
  },

  /* Signing out stops sync; it does NOT delete anything local. The app keeps
     working exactly as it did before anyone signed in. */
  async signOut() {
    await Sync.client.auth.signOut();
    Sync.session = null;
    Sync.householdId = null;
    DB.syncing = false;
    return Sync._set('signed-out');
  },

  // ---- household ----

  async startHousehold() {
    return Sync._rpcToHousehold('ensure_household');
  },

  async redeemInvite(code) {
    const clean = String(code || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (clean.length !== 10) throw new Error('An invite code is 10 characters.');
    return Sync._rpcToHousehold('redeem_invite', { p_code: clean });
  },

  async _rpcToHousehold(fn, args) {
    Sync._set('syncing');
    try {
      const { data, error } = await Sync.client.rpc(fn, args);
      if (error) throw error;
      Sync.householdId = data;
      DB.syncing = !!data;
      Sync._set('idle');
      return data;
    } catch (e) {
      Sync._fail(e);
      throw e;
    }
  },

  /* Returns a 10-character bearer token. Whoever holds it gets full read/write
     on the household until it is redeemed or expires (24h), so it should be
     handed over directly, not posted anywhere. */
  async createInvite() {
    const { data, error } = await Sync.client.rpc('create_invite');
    if (error) throw error;
    return data;
  },

  async pendingCount() {
    return DB.outboxCount();
  },

  // ---- push ----

  /* Seeding is just "mark everything dirty and let push do its job" — no
     separate upload path, no second set of bugs. Gated on the household id so
     it runs once per household and is safe to call on every boot. */
  async seedFromLocal() {
    if (!Sync.enabled) return { seeded: false };
    if (await DB.getSetting('sync.seededHouseholdId', null) === Sync.householdId) return { seeded: false };
    const items = await DB.getAll();
    const meals = await DB.getSetting('meals', []);
    await DB.enqueueMany([
      ...items.map((i) => ({ kind: 'item', id: i.id })),
      ...meals.map((m) => ({ kind: 'meal', id: m.id }))
    ]);
    await DB.putSetting('sync.seededHouseholdId', Sync.householdId);
    return { seeded: true, items: items.length, meals: meals.length };
  },

  /* Reads the CURRENT record for each dirty key and upserts it. Entries are
     removed only after a successful round trip, and only if `queuedAt` is
     unchanged — an edit made while the request was in flight has to survive.
     Never clear() the outbox. */
  async push() {
    if (!Sync.enabled) return { pushed: 0 };
    const entries = await DB.outboxAll();
    if (!entries.length) return { pushed: 0 };

    Sync._set('syncing');
    try {
      const itemRows = [];
      const mealRows = [];
      const meals = new Map((await DB.getSetting('meals', [])).map((m) => [m.id, m]));

      for (const e of entries) {
        if (e.kind === 'item') {
          const rec = await DB.get(e.id);
          if (rec) itemRows.push(Store.toItemRow(rec, Sync.householdId));
        } else if (e.kind === 'meal') {
          const rec = meals.get(e.id);
          if (rec) mealRows.push(Store.toMealRow(rec, Sync.householdId));
        }
        // A key whose record has vanished is still cleared: nothing to send.
      }

      await Sync._upsert('items', itemRows);
      await Sync._upsert('meals', mealRows);
      await DB.outboxRemove(entries);

      Sync.lastSyncAt = Date.now();
      Sync._set('idle');
      return { pushed: itemRows.length + mealRows.length };
    } catch (e) {
      // The outbox is left intact, so nothing is lost — it retries later.
      Sync._fail(e);
      return { pushed: 0, error: e };
    }
  },

  async _upsert(table, rows) {
    for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
      const { error } = await Sync.client.from(table).upsert(rows.slice(i, i + PUSH_CHUNK), { onConflict: 'id' });
      if (error) throw error;
    }
  },

  /* Single-flight: overlapping calls share one in-flight run rather than
     racing each other through the same outbox. */
  _inFlight: null,
  sync() {
    if (Sync._inFlight) return Sync._inFlight;
    Sync._inFlight = (async () => {
      try {
        await Sync.seedFromLocal();
        return await Sync.push();
      } finally {
        Sync._inFlight = null;
      }
    })();
    return Sync._inFlight;
  }
};

const PUSH_CHUNK = 200;
