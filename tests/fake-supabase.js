/* Hand-written stand-in for the Supabase client. Backed by plain arrays, and
   exposing ONLY the surface sync.js is allowed to use (the list is pinned in a
   comment at the top of sync.js). Because Sync.init takes the client as a
   parameter, this drives the real engine with no network. */
/* `fail` breaks everything; `pushFail` breaks ONLY upserts, which is the shape
   of the real 2026-08-05 outage — a column missing server-side made every
   write 400 while reads kept returning 200. */
function makeFakeSupabase({ items = [], meals = [], households = [], household = 'h1', session = { user: { id: 'u1', email: 'a@b.c' } }, fail = null, pushFail = null, anonDisabled = false, rpcFail = null } = {}) {
  const tables = { items: items.slice(), meals: meals.slice(), households: households.slice() };
  const calls = [];

  function query(table) {
    const filters = [];
    const q = {
      select() { return q; },
      eq(col, val) { filters.push((r) => r[col] === val); return q; },
      gt(col, val) { filters.push((r) => r[col] > val); return q; },
      order() { return q; },
      limit(n) { q._limit = n; return q; },
      then(resolve) {
        if (fail) return resolve({ data: null, error: fail });
        let rows = tables[table].filter((r) => filters.every((f) => f(r)));
        rows.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
        if (q._limit) rows = rows.slice(0, q._limit);
        return resolve({ data: rows, error: null });
      }
    };
    return q;
  }

  return {
    _tables: tables,
    _calls: calls,
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOtp() { return { error: null }; },
      async signInAnonymously() {
        calls.push({ auth: 'signInAnonymously' });
        if (anonDisabled) return { data: null, error: { message: 'Anonymous sign-ins are disabled' } };
        const s = { user: { id: 'anon-1', is_anonymous: true } };
        return { data: { session: s }, error: null };
      },
      async signInWithOAuth() { return { error: null }; },
      async signOut() { return { error: null }; }
    },
    async rpc(name) {
      calls.push({ rpc: name });
      if (rpcFail) return { data: null, error: rpcFail };
      if (fail) return { data: null, error: fail };
      return { data: household, error: null };
    },
    from(table) {
      return {
        select: () => query(table).select(),
        update(patch) {
          calls.push({ update: table, patch });
          const u = {
            eq(col, val) {
              if (!fail) {
                for (const r of tables[table] || []) if (r[col] === val) Object.assign(r, patch);
              }
              return Promise.resolve({ data: null, error: fail });
            }
          };
          return u;
        },
        upsert(rows, opts) {
          calls.push({ upsert: table, count: rows.length, opts });
          if (fail || pushFail) return Promise.resolve({ data: null, error: fail || pushFail });
          for (const row of rows) {
            const i = tables[table].findIndex((r) => r.id === row.id);
            // The server stamps updated_at; the client never sends it.
            const stamped = { ...row, updated_at: new Date(Date.now() + tables[table].length).toISOString() };
            if (i >= 0) tables[table][i] = stamped; else tables[table].push(stamped);
          }
          return Promise.resolve({ data: rows, error: null });
        }
      };
    }
  };
}
