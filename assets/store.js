/* Data layer: Store = pure state transitions. DB (IndexedDB adapter) is added below in a later task. */
const Store = {
  createItem(name, opts = {}) {
    const now = Date.now();
    return {
      id: opts.id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + now),
      name: String(name).trim(),
      category: opts.category || 'Other',
      tracked: opts.tracked ?? false,
      stock: opts.stock ?? 0,
      lowAt: opts.lowAt ?? 1,
      unit: opts.unit || '',
      onList: opts.onList ?? false,
      listQty: opts.listQty ?? 1,
      checked: false,
      prices: opts.prices ? [...opts.prices] : [],
      createdAt: now,
      updatedAt: now
    };
  },

  /* Price history: newest first. Each entry is { price, store, at }. */
  addPrice(item, price, store) {
    const entry = { price, store: String(store).trim(), at: Date.now() };
    return Store.update(item, { prices: [entry, ...item.prices] });
  },

  lastPrice(item) {
    return item.prices.length ? item.prices[0] : null;
  },

  storeNames(items) {
    const seen = new Set();
    for (const it of items) {
      for (const p of it.prices) if (p.store) seen.add(p.store);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  },

  deriveStatus(item) {
    if (item.stock === 0) return 'out';
    if (item.stock <= item.lowAt) return 'low';
    return 'stocked';
  },

  update(item, changes) {
    return { ...item, ...changes, updatedAt: Date.now() };
  },

  toggleOnList(item) {
    return item.onList
      ? Store.update(item, { onList: false, checked: false, listQty: 1 })
      : Store.update(item, { onList: true });
  },

  setChecked(item, checked) {
    return Store.update(item, { checked });
  },

  adjustListQty(item, delta) {
    return Store.update(item, { listQty: Math.max(1, item.listQty + delta) });
  },

  adjustStock(item, delta) {
    return Store.update(item, { stock: Math.max(0, item.stock + delta) });
  },

  /* purchase (optional): { store, prices: { [itemId]: number } }. A price is
     recorded only for bought items that have one; blank entries are skipped. */
  completeTrip(items, purchase = null) {
    const kept = [];
    for (const it of items) {
      if (!(it.onList && it.checked)) { kept.push(it); continue; }
      if (!it.tracked) continue; // bought one-off: gone
      let next = Store.update(it, {
        stock: it.stock + it.listQty,
        onList: false, checked: false, listQty: 1
      });
      const price = purchase && purchase.prices ? purchase.prices[it.id] : undefined;
      if (typeof price === 'number' && Number.isFinite(price)) {
        next = Store.addPrice(next, price, purchase.store || '');
      }
      kept.push(next);
    }
    return kept;
  },

  outLowCounts(items) {
    let out = 0, low = 0;
    for (const it of items) {
      if (!it.tracked) continue;
      const s = Store.deriveStatus(it);
      if (s === 'out') out++;
      else if (s === 'low') low++;
    }
    return { out, low };
  },

  serialize(items) {
    return JSON.stringify({ version: 1, items }, null, 2);
  },

  validateImport(data) {
    if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.items)) return false;
    const strings = ['name', 'category', 'unit'];
    const numbers = ['stock', 'lowAt', 'listQty'];
    const booleans = ['tracked', 'onList', 'checked'];
    return data.items.every((it) =>
      it && typeof it === 'object' &&
      typeof it.id === 'string' && /^[\w-]{1,64}$/.test(it.id) &&
      strings.every((k) => typeof it[k] === 'string') &&
      numbers.every((k) => typeof it[k] === 'number' && Number.isFinite(it[k])) &&
      booleans.every((k) => typeof it[k] === 'boolean') &&
      Store.validPrices(it.prices)
    );
  },

  /* Absent prices is valid: v1 backups predate price history (normalizeImport
     fills them in). Present prices must be well-formed. */
  validPrices(prices) {
    if (prices === undefined) return true;
    if (!Array.isArray(prices)) return false;
    return prices.every((p) =>
      p && typeof p === 'object' &&
      typeof p.price === 'number' && Number.isFinite(p.price) &&
      typeof p.store === 'string' &&
      typeof p.at === 'number' && Number.isFinite(p.at)
    );
  },

  normalizeImport(items) {
    return items.map((it) => (it.prices ? it : { ...it, prices: [] }));
  },
};

/* IndexedDB adapter. Falls back to in-memory Map when IndexedDB is unavailable. */
const DB = {
  _db: null,
  _mem: null,
  persistent: true,

  init(name = 'grocery') {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(name, 1);
      } catch (e) {
        DB.persistent = false; DB._mem = new Map(); resolve(); return;
      }
      req.onupgradeneeded = () => {
        req.result.createObjectStore('items', { keyPath: 'id' });
        req.result.createObjectStore('settings');
      };
      req.onsuccess = () => { DB._db = req.result; resolve(); };
      req.onerror = () => { DB.persistent = false; DB._mem = new Map(); resolve(); };
    });
  },

  _tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = DB._db.transaction('items', mode);
      const result = fn(tx.objectStore('items'));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAll() {
    if (!DB.persistent) return [...DB._mem.values()];
    return DB._tx('readonly', (store) => store.getAll());
  },

  async put(item) {
    if (!DB.persistent) { DB._mem.set(item.id, item); return; }
    await DB._tx('readwrite', (store) => store.put(item));
  },

  async delete(id) {
    if (!DB.persistent) { DB._mem.delete(id); return; }
    await DB._tx('readwrite', (store) => store.delete(id));
  },

  async replaceAll(items) {
    if (!DB.persistent) { DB._mem = new Map(items.map((i) => [i.id, i])); return; }
    await DB._tx('readwrite', (store) => { store.clear(); items.forEach((i) => store.put(i)); });
  }
};
