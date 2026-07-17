/* Data layer: Store = pure state transitions. DB (IndexedDB adapter) is added below in a later task. */

const MAX_PRICE = 100000; // guards against fat-fingered values overflowing the tile

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
}

const Store = {
  createItem(name, opts = {}) {
    const now = Date.now();
    return {
      id: opts.id || newId(),
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

  /* Coerce user-typed price text to a sane amount, or null to skip it.
     Rounds to cents and rejects negatives/junk rather than blocking the trip. */
  normalizePrice(raw) {
    const value = parseFloat(String(raw).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE) return null;
    return Math.round(value * 100) / 100;
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

  /* ---- Meals (V3) ----
     A meal is just a named set of item ids — it never copies item data, so
     renaming an item updates every meal it appears in for free, and a deleted
     item simply drops out (see mealItems). This is why v1 used one flat Item. */

  createMeal(name, itemIds = [], opts = {}) {
    const now = Date.now();
    return {
      id: opts.id || newId(),
      name: String(name).trim(),
      itemIds: [...new Set(itemIds)],
      createdAt: opts.createdAt ?? now,
      updatedAt: now
    };
  },

  updateMeal(meal, changes) {
    return { ...meal, ...changes, updatedAt: Date.now() };
  },

  /* Resolves ids to live items in meal order. Ids with no surviving item are
     dropped rather than erroring — deleting an item shouldn't break its meals. */
  mealItems(meal, items) {
    const byId = new Map(items.map((i) => [i.id, i]));
    return meal.itemIds.map((id) => byId.get(id)).filter(Boolean);
  },

  mealSummary(meal, items) {
    return Store.mealItems(meal, items).map((i) => i.name).join(', ');
  },

  /* "Already covered": tracked and above the low threshold. Untracked items
     carry no meaningful stock, so they're never considered covered. */
  hasEnough(item) {
    return item.tracked && Store.deriveStatus(item) === 'stocked';
  },

  /* Adds every item in the meal to the list — you prune, the app doesn't guess.
     Items you already have still land (rendered dimmed via .row.have). Items
     already on the list keep their qty and basket state. */
  addMealToList(items, meal) {
    const ids = new Set(meal.itemIds);
    return items.map((it) => (ids.has(it.id) && !it.onList ? Store.update(it, { onList: true }) : it));
  },

  /* Feedback for the add banner: how many the meal put on the list, and how
     many of those you're actually short on. */
  mealAddStats(meal, items) {
    const inMeal = Store.mealItems(meal, items);
    return { total: inMeal.length, short: inMeal.filter((it) => !Store.hasEnough(it)).length };
  },

  /* Drops ids for items that no longer exist. Used after a delete so meals
     don't accumulate dangling references in storage. */
  pruneMeals(meals, items) {
    const live = new Set(items.map((i) => i.id));
    return meals.map((m) => {
      const kept = m.itemIds.filter((id) => live.has(id));
      return kept.length === m.itemIds.length ? m : { ...m, itemIds: kept };
    });
  },

  serialize(items, meals = []) {
    return JSON.stringify({ version: 2, items, meals }, null, 2);
  },

  /* v1 backups predate meals and are still accepted (meals default to none). */
  validateImport(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return false;
    if (data.version !== 1 && data.version !== 2) return false;
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
    ) && Store.validMeals(data.meals);
  },

  /* Same uuid-shaped id rule as items — an import must not be able to inject
     arbitrary keys via a meal's itemIds. */
  validMeals(meals) {
    if (meals === undefined) return true;
    if (!Array.isArray(meals)) return false;
    const id = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
    return meals.every((m) =>
      m && typeof m === 'object' && id(m.id) && typeof m.name === 'string' &&
      Array.isArray(m.itemIds) && m.itemIds.every(id)
    );
  },

  /* Imported meals may reference items the file didn't carry; drop those ids
     rather than rejecting the whole backup. */
  normalizeImportMeals(meals, items) {
    if (!Array.isArray(meals)) return [];
    return Store.pruneMeals(meals, items);
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
  _memSettings: new Map(), // mirrors the `settings` store when IndexedDB is unavailable
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

  _tx(mode, fn, storeName = 'items') {
    return new Promise((resolve, reject) => {
      const tx = DB._db.transaction(storeName, mode);
      const result = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  },

  /* `settings` has existed in the v1 schema since day one but was never
     written to, so meals persist here with no version bump and no migration
     over live data. Out-of-line keys: put(value, key). */
  async getSetting(key, fallback = null) {
    if (!DB.persistent) return DB._memSettings.has(key) ? DB._memSettings.get(key) : fallback;
    const v = await DB._tx('readonly', (s) => s.get(key), 'settings');
    return v === undefined ? fallback : v;
  },

  async putSetting(key, value) {
    if (!DB.persistent) { DB._memSettings.set(key, value); return; }
    await DB._tx('readwrite', (s) => s.put(value, key), 'settings');
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
