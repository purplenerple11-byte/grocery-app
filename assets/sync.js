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

  // ---- trip coordination ----

  /* Was a trip completed by SOMEONE ELSE within the guard window? Used to stop
     a second member double-restocking the whole list. Failures here are
     deliberately swallowed: this is a safety prompt, and it must never be the
     reason a trip cannot be completed. */
  async recentTripByOther() {
    if (!Sync.enabled) return false;
    try {
      const { data, error } = await Sync.client.from('households')
        .select('last_trip_at,last_trip_by').eq('id', Sync.householdId).limit(1);
      if (error || !data || !data.length) return false;
      const row = data[0];
      if (!row.last_trip_at) return false;
      const mine = Sync.session && Sync.session.user && Sync.session.user.id;
      if (row.last_trip_by && mine && row.last_trip_by === mine) return false;
      return Date.now() - Date.parse(row.last_trip_at) < TRIP_GUARD_MS;
    } catch (e) {
      return false;
    }
  },

  async recordTrip() {
    if (!Sync.enabled) return;
    const mine = Sync.session && Sync.session.user ? Sync.session.user.id : null;
    try {
      await Sync.client.from('households')
        .update({ last_trip_at: new Date().toISOString(), last_trip_by: mine })
        .eq('id', Sync.householdId);
    } catch (e) { /* advisory only */ }
  },

  // ---- pull ----

  /* Fetches everything changed since the cursor, reconciles it against the
     local copy, and applies the result in one transaction.

     `apply: false` runs the whole thing except the write and reports what
     WOULD change — the safe way to point this at real data the first time. */
  async pull({ apply = true } = {}) {
    if (!Sync.enabled) return { applied: 0 };
    Sync._set('syncing');
    try {
      const cursor = await DB.getSetting('sync.cursor', null);
      const [itemRows, mealRows] = await Promise.all([
        Sync._fetchDelta('items', cursor),
        Sync._fetchDelta('meals', cursor)
      ]);

      const remote = {
        items: itemRows.map(Store.fromItemRow),
        meals: mealRows.map(Store.fromMealRow)
      };
      const local = await Sync._getLocal();
      const merged = Store.reconcileSnapshot(local, remote);
      const nextCursor = Store.nextCursor([...itemRows, ...mealRows], cursor);

      if (!apply) {
        Sync._set('idle');
        return {
          dryRun: true,
          fetched: { items: itemRows.length, meals: mealRows.length },
          localBefore: { items: local.items.length, meals: local.meals.length },
          mergedAfter: { items: merged.items.length, meals: merged.meals.length },
          wouldPushBack: merged.toPush,
          nextCursor
        };
      }

      /* Last line of defence. A reconciler bug does not throw — it quietly
         returns a smaller, plausible-looking set, that set is written to every
         device, and the correct-looking result propagates. Refusing to apply a
         merge that destroys most of the local data turns the worst failure
         mode from silent into visible. A genuine mass-delete by another member
         trips this too; that is the right trade. */
      const liveBefore = Store.live(local.items).length;
      const liveAfter = Store.live(merged.items).length;
      if (liveBefore > 3 && liveAfter * 2 < liveBefore) {
        throw new Error(`Sync stopped: this would remove ${liveBefore - liveAfter} of ${liveBefore} items. Nothing changed.`);
      }

      await Sync._backupOnce(local);
      // Items, meals, cursor and re-push keys in ONE transaction: a cursor that
      // advanced past rows that were never applied is a permanent silent hole.
      await DB.applyPull({
        items: merged.items,
        meals: merged.meals,
        cursor: nextCursor,
        enqueue: [
          ...merged.toPush.items.map((id) => ({ kind: 'item', id })),
          ...merged.toPush.meals.map((id) => ({ kind: 'meal', id }))
        ]
      });

      Sync._onSnapshot({ items: Store.live(merged.items), meals: Store.live(merged.meals) });
      Sync.lastSyncAt = Date.now();
      Sync._set('idle');
      return { applied: itemRows.length + mealRows.length, rePushed: merged.toPush };
    } catch (e) {
      Sync._fail(e);
      return { applied: 0, error: e };
    }
  },

  async _fetchDelta(table, cursor) {
    const out = [];
    let from = cursor;
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = Sync.client.from(table).select('*')
        .eq('household_id', Sync.householdId)
        .order('updated_at')
        .limit(PAGE_SIZE);
      if (from) q = q.gt('updated_at', from);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from = data[data.length - 1].updated_at;
    }
    return out;
  },

  /* Written once, before the first pull ever touches real data, and never
     overwritten. If the reconciler turns out to be wrong on live data this is
     the only way back. */
  async _backupOnce(local) {
    if (await DB.getSetting('sync.preSyncBackup', null)) return;
    await DB.putSetting('sync.preSyncBackup', {
      at: Date.now(),
      items: Store.live(local.items),
      meals: Store.live(local.meals)
    });
  },

  /* Single-flight: overlapping calls share one in-flight run rather than
     racing each other through the same outbox. Push before pull, so local
     work is on the server before its copy comes back. */
  _inFlight: null,
  _failures: 0,
  _retryTimer: null,
  sync() {
    if (Sync._inFlight) return Sync._inFlight;
    Sync._inFlight = (async () => {
      try {
        await Sync.seedFromLocal();
        const pushed = await Sync.push();
        const pulled = await Sync.pull();
        const failed = !!(pushed.error || pulled.error);
        if (failed) Sync._scheduleRetry(); else Sync._failures = 0;
        return { pushed, pulled };
      } finally {
        Sync._inFlight = null;
      }
    })();
    return Sync._inFlight;
  },

  /* Retries on a widening schedule, and only tells the user once the problem
     looks persistent — a phone in a shop dips offline constantly and a banner
     for every dip would be noise, not information. */
  _scheduleRetry() {
    Sync._failures++;
    if (Sync._retryTimer) clearTimeout(Sync._retryTimer);
    const wait = BACKOFF_MS[Math.min(Sync._failures - 1, BACKOFF_MS.length - 1)];
    Sync._retryTimer = setTimeout(() => { Sync._retryTimer = null; Sync.sync(); }, wait);
    if (Sync._failures === 3) Sync._onStatus({ ...Sync.snapshotStatus(), persistentFailure: true });
  }
};

const PUSH_CHUNK = 200;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const TRIP_GUARD_MS = 2 * 60 * 1000;
/* Retry schedule after a failed sync. Caps at 5 minutes: the app works fine
   offline, so there is nothing to gain from hammering a dead network. */
const BACKOFF_MS = [5000, 15000, 60000, 300000];
