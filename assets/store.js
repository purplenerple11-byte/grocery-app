/* Data layer: Store = pure state transitions. DB (IndexedDB adapter) is added below in a later task. */

const MAX_PRICE = 100000; // guards against fat-fingered values overflowing the tile
const CURSOR_OVERLAP_MS = 2000;    // re-fetch window; see Store.nextCursor
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days; see Store.expiredTombstones

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
}

/* Fixed display order for known categories; anything else (including future
   user-added categories) sorts alphabetically after all of these. */
/* Shelf order. Singular variants ('Spice', 'Condiment') are deliberately absent:
   they were duplicates of the plural and got folded in. 'Canned & Jarred' is one
   category, not two — splitting it into 'Canned' and 'Jarred' just produced a
   third redundant option next to the one the data actually used. */
const CATEGORY_ORDER = [
  'Produce', 'Dairy', 'Meat', 'Frozen',
  'Grains & Starch', 'Baking', 'Pantry', 'Canned & Jarred',
  'Oil & Vinegar', 'Condiments', 'Spices',
  'Drinks', 'Household', 'Other'
];

const Store = {
  CATEGORY_ORDER,

  /* Groups items by category (in CATEGORY_ORDER, unknown categories last and
     alphabetical), then sorts within each category block. `secondary(item)`
     returns a bucket number to sort ascending by (e.g. 0 = first); ties, and
     items when no secondary is given, fall back to a name sort — so order is
     stable across reloads instead of depending on incidental array position. */
  groupByCategory(items, { secondary } = {}) {
    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it.category)) groups.set(it.category, []);
      groups.get(it.category).push(it);
    }
    const rank = (c) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };
    const bucket = secondary || (() => 0);
    for (const list of groups.values()) {
      list.sort((a, b) => bucket(a) - bucket(b) || a.name.localeCompare(b.name));
    }
    return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  },
  /* Categories the item editor offers: the built-in list in shelf order, then
     any other category actually present in the data, alphabetically — the same
     ranking groupByCategory uses. A merge import accepts any category string
     (see sanitizeItemFields) and the inventory already renders unknown ones, so
     the editor has to be able to show them. `current` is always included, which
     is what stops opening an item from silently rewriting its category. */
  categoryChoices(items, current = null) {
    const known = new Set(CATEGORY_ORDER);
    const extra = new Set();
    for (const it of items || []) {
      if (it && typeof it.category === 'string' && it.category && !known.has(it.category)) extra.add(it.category);
    }
    if (typeof current === 'string' && current && !known.has(current)) extra.add(current);
    return [...CATEGORY_ORDER, ...[...extra].sort((a, b) => a.localeCompare(b))];
  },

  /* Every field is overridable, including the timestamps and `deletedAt`.
     That matters for sync: a record arriving from another device has to be
     reconstructable exactly as it was written there, and a hardcoded
     `createdAt: now` would silently restamp it and corrupt conflict
     resolution. Locally-created items simply omit the overrides. */
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
      checked: opts.checked ?? false,
      prices: opts.prices ? [...opts.prices] : [],
      addedBy: opts.addedBy || '',
      createdAt: opts.createdAt ?? now,
      updatedAt: opts.updatedAt ?? now,
      deletedAt: opts.deletedAt ?? null
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

  /* `updatedAt` is the conflict-resolution clock, so it must never go
     backwards on a record even when the device clock does. Without the
     Math.max, a phone running ten minutes fast wins every conflict against
     every other device, permanently and silently — and a phone running slow
     can never win one. Clamping to at least prev+1 makes it a poor-man's
     hybrid logical clock: still wall-clock-ish across devices, but monotonic
     per record. */
  update(item, changes) {
    return { ...item, ...changes, updatedAt: Store.nextStamp(item.updatedAt) };
  },

  nextStamp(prev) {
    return Math.max(Date.now(), (prev || 0) + 1);
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
      updatedAt: opts.updatedAt ?? now,
      deletedAt: opts.deletedAt ?? null
    };
  },

  updateMeal(meal, changes) {
    return { ...meal, ...changes, updatedAt: Store.nextStamp(meal.updatedAt) };
  },

  /* ---- Tombstones ----
     A delete is a write, not an absence. Hard-deleting a row makes a delete
     invisible to every other device, which would resurrect the item on the
     next sync. `deletedAt` is filtered out exactly once, at the boundary
     (boot and snapshot-apply), so `state.items`/`state.meals` never contain
     tombstones and no render, lookup, export, or merge path has to know they
     exist. */

  /* Works for items and meals alike. Clearing the list state matters: a
     deleted item must not linger on another member's list, and it must not
     come back checked if it is ever re-created. Meals carry no list state,
     so those keys are only touched when the record actually has them. */
  softDelete(record) {
    const stamp = Store.nextStamp(record.updatedAt);
    const cleared = 'onList' in record ? { onList: false, checked: false } : {};
    return { ...record, ...cleared, deletedAt: stamp, updatedAt: stamp };
  },

  live(records) {
    return records.filter((r) => !r.deletedAt);
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

  /* v3 carries timestamps and emits live records only — a backup is a picture
     of what you have, not a graveyard. Consequence worth knowing: restoring a
     backup on one device does not propagate deletes to another, because the
     tombstones aren't in the file. Restore is already destructive and
     explicit, so that's the right trade. */
  serialize(items, meals = []) {
    return JSON.stringify({ version: 3, items: Store.live(items), meals: Store.live(meals) }, null, 2);
  },

  /* Pantry export (V5): just the tracked items you currently have in stock,
     in a compact shape meant to be handed to an AI ("here's what's in my
     kitchen, suggest a meal"). Deliberately NOT the backup format — no ids,
     prices, list state or timestamps, none of which help a recommendation.
     Grouped in the same category order the inventory shows so it reads
     top-to-bottom like a shelf. Empty stock is a valid, empty export. */
  serializePantry(items) {
    const inStock = items.filter((it) => it.tracked && it.stock > 0);
    const pantry = Store.groupByCategory(inStock).flatMap(([, group]) =>
      group.map((it) => {
        const entry = { name: it.name, category: it.category, stock: it.stock };
        if (it.unit) entry.unit = it.unit;
        return entry;
      })
    );
    return JSON.stringify({ exportedAt: new Date().toISOString().slice(0, 10), pantry }, null, 2);
  },

  /* v1 backups predate meals, v2 predates tombstones; both are still accepted
     (the missing fields default in normalizeImport). */
  validateImport(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return false;
    if (![1, 2, 3].includes(data.version)) return false;
    const strings = ['name', 'category', 'unit'];
    const numbers = ['stock', 'lowAt', 'listQty'];
    const booleans = ['tracked', 'onList', 'checked'];
    return data.items.every((it) =>
      it && typeof it === 'object' &&
      typeof it.id === 'string' && /^[\w-]{1,64}$/.test(it.id) &&
      strings.every((k) => typeof it[k] === 'string') &&
      numbers.every((k) => typeof it[k] === 'number' && Number.isFinite(it[k])) &&
      booleans.every((k) => typeof it[k] === 'boolean') &&
      Store.validStamp(it.deletedAt) &&
      Store.validPrices(it.prices)
    ) && Store.validMeals(data.meals);
  },

  /* Absent or null is valid — v1/v2 backups predate tombstones. Present must
     be a finite number of milliseconds. */
  validStamp(v) {
    return v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));
  },

  /* Same uuid-shaped id rule as items — an import must not be able to inject
     arbitrary keys via a meal's itemIds. */
  validMeals(meals) {
    if (meals === undefined) return true;
    if (!Array.isArray(meals)) return false;
    const id = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
    return meals.every((m) =>
      m && typeof m === 'object' && id(m.id) && typeof m.name === 'string' &&
      Store.validStamp(m.deletedAt) &&
      Array.isArray(m.itemIds) && m.itemIds.every(id)
    );
  },

  /* Imported meals may reference items the file didn't carry; drop those ids
     rather than rejecting the whole backup. Pruning is only correct here,
     where the payload is self-contained — never against a live item set that
     a sync may not have finished filling in. */
  normalizeImportMeals(meals, items) {
    if (!Array.isArray(meals)) return [];
    return Store.normalizeMeals(Store.pruneMeals(meals, items));
  },

  /* Backfills the fields that older records predate. Records written before
     tombstones existed have no `deletedAt`, and v1 items have no timestamps;
     both must gain them before they can take part in conflict resolution.
     Returns the original object untouched when nothing is missing. */
  normalizeRecord(r) {
    if (r.createdAt !== undefined && r.updatedAt !== undefined && r.deletedAt !== undefined) return r;
    const now = Date.now();
    return {
      ...r,
      createdAt: r.createdAt ?? now,
      updatedAt: r.updatedAt ?? now,
      deletedAt: r.deletedAt ?? null
    };
  },

  normalizeMeals(meals) {
    return (Array.isArray(meals) ? meals : []).map(Store.normalizeRecord);
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
    return items.map((it) => Store.normalizeRecord(it.prices ? it : { ...it, prices: [] }));
  },

  /* ---- Additive merge import (V4) ----
     "Restore from backup" replaces everything and stays strict (validateImport).
     "Add / merge" stacks a loose payload on top and NEVER deletes — this is the
     path an AI supplemental list takes, so it tolerates missing UUIDs and
     partial items. Only fields actually present are overlaid onto a match, so a
     payload of `{name:"Basil"}` updates nothing it didn't mention. */

  /* Minimal gate: a mergeable payload is an object with an items array. Per-item
     shape is handled defensively in mergeItems, not rejected wholesale here. */
  validateMergeImport(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return false;
    if (data.meals !== undefined && !Array.isArray(data.meals)) return false;
    return true;
  },

  /* Pulls only present, well-typed fields off a loose incoming item. Numbers
     tolerate numeric strings (AI output). Never returns `id` — see mergeItems. */
  sanitizeItemFields(raw) {
    const f = {};
    const num = (v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      return null;
    };
    if (typeof raw.category === 'string' && raw.category.trim()) f.category = raw.category.trim();
    // Empty string means "unspecified", same as category — a merge must not use
    // it to blank a unit the item already has.
    if (typeof raw.unit === 'string' && raw.unit.trim()) f.unit = raw.unit.trim();
    const s = num(raw.stock); if (s !== null) f.stock = Math.max(0, Math.floor(s));
    const l = num(raw.lowAt); if (l !== null) f.lowAt = Math.max(0, Math.floor(l));
    const q = num(raw.listQty); if (q !== null) f.listQty = Math.max(1, Math.floor(q));
    if (typeof raw.tracked === 'boolean') f.tracked = raw.tracked;
    if (typeof raw.onList === 'boolean') f.onList = raw.onList;
    if (typeof raw.checked === 'boolean') f.checked = raw.checked;
    if (Store.validPrices(raw.prices) && Array.isArray(raw.prices)) f.prices = raw.prices;
    return f;
  },

  isUuid(v) {
    return typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
  },

  /* Union of two price histories, newest first, de-duped by time+price+store.
     A merge must never drop a recorded price, so incoming prices are added to
     the existing history rather than replacing it. */
  mergePrices(existing, incoming) {
    const seen = new Set();
    const out = [];
    for (const p of [...(existing || []), ...(incoming || [])]) {
      const k = `${p.at}|${p.price}|${p.store}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out.sort((a, b) => b.at - a.at);
  },

  /* Merges incoming items into existing. Match by uuid id first, else by
     trimmed, case-insensitive name. Match → overlay present fields; no match →
     mint a fresh item (a payload's id is NEVER trusted as the new id, which
     preserves the injection guard). Returns the merged array, an idMap from any
     uuid-shaped incoming id → the resulting item's real id (so meals can be
     remapped), and add/update/skip counts. */
  mergeItems(existing, incoming) {
    const items = existing.slice();
    const key = (name) => name.trim().toLowerCase();
    const byId = new Map(items.map((i) => [i.id, i]));
    const byName = new Map(items.map((i) => [key(i.name), i]));
    const idMap = {};
    let added = 0, updated = 0, skipped = 0;
    for (const raw of Array.isArray(incoming) ? incoming : []) {
      if (!raw || typeof raw !== 'object') { skipped++; continue; }
      const name = String(raw.name ?? '').trim();
      if (!name) { skipped++; continue; }
      const uuid = Store.isUuid(raw.id) ? raw.id : null;
      const fields = Store.sanitizeItemFields(raw);
      const match = (uuid && byId.get(uuid)) || byName.get(key(name));
      let resultId;
      if (match) {
        // Prices union rather than overlay, so a match never loses history.
        const { prices: incomingPrices, ...rest } = fields;
        const changes = { name, ...rest };
        if (incomingPrices) changes.prices = Store.mergePrices(match.prices, incomingPrices);
        const next = Store.update(match, changes);
        items[items.indexOf(match)] = next;
        byId.set(next.id, next);
        byName.delete(key(match.name));
        byName.set(key(name), next);
        resultId = next.id;
        updated++;
      } else {
        const created = Store.createItem(name, fields);
        items.push(created);
        byId.set(created.id, created);
        byName.set(key(name), created);
        resultId = created.id;
        added++;
      }
      if (uuid) idMap[uuid] = resultId;
    }
    return { items, idMap, stats: { added, updated, skipped } };
  },

  /* Merges incoming meals, remapping their itemIds through idMap so a full
     export's meals still point at the right items after the items were merged.
     Match by uuid id, else by trimmed name; matched meals take the incoming
     itemIds. Dangling ids are pruned against the already-merged items. */
  mergeMeals(existingMeals, incoming, mergedItems, idMap = {}) {
    const meals = existingMeals.slice();
    const key = (name) => name.trim().toLowerCase();
    const byId = new Map(meals.map((m) => [m.id, m]));
    const byName = new Map(meals.map((m) => [key(m.name), m]));
    for (const raw of Array.isArray(incoming) ? incoming : []) {
      if (!raw || typeof raw !== 'object') continue;
      const name = String(raw.name ?? '').trim();
      if (!name) continue;
      const ids = (Array.isArray(raw.itemIds) ? raw.itemIds : [])
        .filter(Store.isUuid).map((id) => idMap[id] || id);
      const itemIds = [...new Set(ids)];
      const uuid = Store.isUuid(raw.id) ? raw.id : null;
      const match = (uuid && byId.get(uuid)) || byName.get(key(name));
      if (match) {
        const next = Store.updateMeal(match, { name, itemIds });
        meals[meals.indexOf(match)] = next;
        byId.set(next.id, next);
        byName.delete(key(match.name));
        byName.set(key(name), next);
      } else {
        const created = Store.createMeal(name, itemIds);
        meals.push(created);
        byId.set(created.id, created);
        byName.set(key(name), created);
      }
    }
    return Store.pruneMeals(meals, mergedItems);
  },

  mergeImport(existingItems, existingMeals, data) {
    const { items, idMap, stats } = Store.mergeItems(existingItems, data.items);
    const meals = Store.mergeMeals(existingMeals, data.meals, items, idMap);
    return { items: Store.normalizeImport(items), meals, stats };
  },

  /* ---- Sync reconciliation (V6) ----
     Every decision about what two devices' copies of a record collapse into
     lives here, as pure functions over plain objects — no network, no
     IndexedDB, no clock beyond what's on the records. That's deliberate: this
     is the code that can silently destroy the household's data, so it has to
     be exhaustively testable in the browser harness with no fixtures. */

  /* Whole-record last-write-wins on `updatedAt`, with three exceptions:
     - `prices` always unions (append-only observation set; a merge must never
       drop a recorded price).
     - `deletedAt` takes the earliest non-null and never returns to null —
       a delete beats a concurrent edit. A resurrected item is invisible and
       silently wrong; a lost edit is visible and one tap to redo.
     - `createdAt` takes the earliest, so the record's own history stays honest.
     Ties go to local: it's a coin flip either way, and preferring local means
     one fewer write. */
  reconcileRecord(local, remote) {
    if (!remote) return local || null;
    if (!local) return remote;
    const winner = (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
    const merged = { ...winner };

    if (Array.isArray(local.prices) || Array.isArray(remote.prices)) {
      merged.prices = Store.mergePrices(local.prices, remote.prices);
    }
    const created = [local.createdAt, remote.createdAt].filter((n) => typeof n === 'number');
    if (created.length) merged.createdAt = Math.min(...created);
    const deleted = [local.deletedAt, remote.deletedAt].filter((n) => typeof n === 'number');
    merged.deletedAt = deleted.length ? Math.min(...deleted) : null;

    return merged;
  },

  /* Order-independent structural equality. Used only to decide whether a
     reconciled record still differs from what the server sent — a false
     positive costs one redundant (idempotent) upsert, a false negative leaves
     two devices permanently disagreeing, so it errs toward pushing. */
  sameRecord(a, b) {
    if (!a || !b) return a === b;
    const canon = (r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
    return canon(a) === canon(b);
  },

  /* Folds a delta from the server into the full local set. Returns the merged
     records plus the ids whose merged value differs from the server's copy —
     those MUST be pushed back or the two sides never converge. `localAll`
     includes tombstones; filter with Store.live only at the render boundary. */
  reconcileRecords(localAll, remoteDelta) {
    const byId = new Map(localAll.map((r) => [r.id, r]));
    const toPush = [];
    for (const remote of Array.isArray(remoteDelta) ? remoteDelta : []) {
      if (!remote || typeof remote !== 'object' || !remote.id) continue;
      const merged = Store.reconcileRecord(byId.get(remote.id) || null, remote);
      byId.set(remote.id, merged);
      if (!Store.sameRecord(merged, remote)) toPush.push(merged.id);
    }
    return { records: [...byId.values()], toPush };
  },

  /* Deliberately does NOT dedupe by name. `deduplicateSnapshot` used to run
     here, on every pull, and it caused a permanent merge war: each device
     grouped same-named items, picked a survivor by `updatedAt`, and tombstoned
     the rest. Two devices holding the same pair could pick DIFFERENT survivors,
     so each resurrected the other's victim and re-pushed — the whole table
     rewrote itself every few minutes, deletes never stuck (you removed the copy
     you could see; the other device still had the other id and pushed it back),
     and attribution was lost whenever an older copy won.

     Reconciliation is keyed on id and nothing else. Two records with the same
     name are two records; merging them is a user decision, not a sync one. */
  reconcileSnapshot(local, remote) {
    const i = Store.reconcileRecords(local.items || [], remote.items || []);
    const m = Store.reconcileRecords(local.meals || [], remote.meals || []);
    return { items: i.records, meals: m.records, toPush: { items: i.toPush, meals: m.toPush } };
  },

  /* `commit()` mutates state, renders, and only THEN awaits the write. A pull
     that reads storage inside that gap would see the pre-edit row and let the
     server overwrite an edit the user can already see on screen. Overlaying
     in-memory records on top of stored ones closes that window: tombstones
     come from storage, anything live in RAM wins. */
  overlayLocal(stored, inMemory) {
    const byId = new Map(stored.map((r) => [r.id, r]));
    for (const r of inMemory) byId.set(r.id, r);
    return [...byId.values()];
  },

  /* ---- Wire mapping ----
     Postgres gets snake_case columns; the app keeps its camelCase records.
     `client_*` are the app's own Date.now() stamps and drive conflict
     resolution; the server's own `updated_at` is never written by the client
     and is used only as the delta cursor. */

  toItemRow(item, householdId) {
    return {
      id: item.id, household_id: householdId,
      name: item.name, category: item.category, unit: item.unit || '',
      tracked: !!item.tracked, stock: item.stock, low_at: item.lowAt,
      on_list: !!item.onList, list_qty: item.listQty, checked: !!item.checked,
      prices: item.prices || [], added_by: item.addedBy || '',
      client_created_at: item.createdAt, client_updated_at: item.updatedAt,
      deleted_at: item.deletedAt ?? null
    };
  },

  fromItemRow(row) {
    return Store.createItem(row.name, {
      id: row.id, category: row.category, unit: row.unit,
      tracked: row.tracked, stock: row.stock, lowAt: row.low_at,
      onList: row.on_list, listQty: row.list_qty, checked: row.checked,
      prices: row.prices || [], addedBy: row.added_by || '',
      createdAt: row.client_created_at, updatedAt: row.client_updated_at,
      deletedAt: row.deleted_at ?? null
    });
  },

  toMealRow(meal, householdId) {
    return {
      id: meal.id, household_id: householdId, name: meal.name,
      item_ids: meal.itemIds || [],
      client_created_at: meal.createdAt, client_updated_at: meal.updatedAt,
      deleted_at: meal.deletedAt ?? null
    };
  },

  fromMealRow(row) {
    return Store.createMeal(row.name, row.item_ids || [], {
      id: row.id,
      createdAt: row.client_created_at, updatedAt: row.client_updated_at,
      deletedAt: row.deleted_at ?? null
    });
  },

  /* Rewinds the cursor a couple of seconds behind the newest row seen.
     Postgres transactions do not necessarily commit in `updated_at` order, so
     a cursor set to the exact maximum can step over a row that committed
     late. The overlap re-fetches a handful of rows; reconciliation is
     idempotent, so replaying them costs nothing. Empty delta → don't move. */
  nextCursor(rows, prev = null) {
    let max = null;
    for (const r of rows || []) {
      const t = Date.parse(r && r.updated_at);
      if (Number.isFinite(t) && (max === null || t > max)) max = t;
    }
    if (max === null) return prev;
    return new Date(max - CURSOR_OVERLAP_MS).toISOString();
  },

  /* Tombstones are kept long enough that a device offline for a normal
     stretch still learns about the delete, then hard-deleted locally. A
     device offline longer than this can resurrect what it never saw removed. */
  expiredTombstones(records, cutoff) {
    return records.filter((r) => typeof r.deletedAt === 'number' && r.deletedAt < cutoff).map((r) => r.id);
  },
};

/* IndexedDB adapter. Falls back to in-memory Map when IndexedDB is unavailable. */
const DB = {
  _db: null,
  _mem: null,
  _memSettings: new Map(), // mirrors the `settings` store when IndexedDB is unavailable
  _memOutbox: new Map(),   // mirrors the `outbox` store in the same situation
  persistent: true,
  blocked: false,          // another tab is holding an older schema open
  /* Set by the sync layer once a session and a household exist. While false,
     nothing is ever enqueued, so a signed-out app pays no cost at all. */
  syncing: false,

  /* v2 adds the `outbox` store. Every store is created defensively rather
     than assumed absent, so the upgrade is safe from any prior version and
     safe to re-run.

     `onblocked` is not optional now that the version can change: another tab
     still holding v1 blocks the upgrade, and without this handler `init()`
     simply never settles and the app boots to a blank screen. `onversionchange`
     is the mirror image — it lets THIS tab get out of the way when a newer
     one wants to upgrade, instead of being the tab that blocks someone else. */
  init(name = 'grocery') {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(name, 2);
      } catch (e) {
        DB.persistent = false; DB._mem = new Map(); resolve(); return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
      };
      req.onblocked = () => { DB.blocked = true; };
      req.onsuccess = () => {
        DB._db = req.result;
        DB._db.onversionchange = () => { DB._db.close(); DB.persistent = false; DB._mem = new Map(); };
        resolve();
      };
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

  async get(id) {
    if (!DB.persistent) return DB._mem.get(id);
    return DB._tx('readonly', (store) => store.get(id));
  },

  /* Writes the record and marks it dirty in ONE transaction. Splitting these
     into two would lose the change from the outbox forever if the tab died in
     between, while the edit sat happily in local storage — a divergence no
     later sync could ever detect or repair. */
  async put(item) {
    if (!DB.persistent) {
      DB._mem.set(item.id, item);
      if (DB.syncing) DB._memOutbox.set(`item:${item.id}`, DB._outboxEntry('item', item.id));
      return;
    }
    if (!DB.syncing) { await DB._tx('readwrite', (store) => store.put(item)); return; }
    await new Promise((resolve, reject) => {
      const tx = DB._db.transaction(['items', 'outbox'], 'readwrite');
      tx.objectStore('items').put(item);
      tx.objectStore('outbox').put(DB._outboxEntry('item', item.id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async delete(id) {
    if (!DB.persistent) { DB._mem.delete(id); return; }
    await DB._tx('readwrite', (store) => store.delete(id));
  },

  /* ---- Outbox ----
     A set of dirty keys, not a log of operations. Push reads the CURRENT
     record for each key, which makes coalescing free (five taps on a stepper
     collapse to one entry), makes ordering irrelevant, and makes replay
     idempotent. Because deletes are tombstones — ordinary writes — there is no
     delete op-code and no special replay path.

     `queuedAt` exists so a successful push can remove only the entries it
     actually sent: an edit made while the request was in flight bumps
     queuedAt, and must survive rather than being cleared with the rest. */

  _outboxEntry(kind, id) {
    return { key: `${kind}:${id}`, kind, id, queuedAt: Date.now() };
  },

  async enqueue(kind, id) {
    if (!DB.syncing) return;
    const entry = DB._outboxEntry(kind, id);
    if (!DB.persistent) { DB._memOutbox.set(entry.key, entry); return; }
    await DB._tx('readwrite', (s) => s.put(entry), 'outbox');
  },

  /* One transaction for a whole batch. A bulk write (restore, trip, merge)
     can dirty hundreds of records; enqueueing them one at a time would be
     hundreds of transactions. */
  async enqueueMany(entries) {
    if (!DB.syncing || !entries.length) return;
    if (!DB.persistent) {
      for (const e of entries) DB._memOutbox.set(`${e.kind}:${e.id}`, DB._outboxEntry(e.kind, e.id));
      return;
    }
    await DB._tx('readwrite', (s) => entries.forEach((e) => s.put(DB._outboxEntry(e.kind, e.id))), 'outbox');
  },

  async outboxAll() {
    if (!DB.persistent) return [...DB._memOutbox.values()];
    return DB._tx('readonly', (s) => s.getAll(), 'outbox');
  },

  async outboxCount() {
    return (await DB.outboxAll()).length;
  },

  /* Removes only entries whose queuedAt still matches what was pushed. Never
     clear() — that is the classic outbox bug, and it silently drops every
     edit made during the round trip. */
  async outboxRemove(entries) {
    if (!DB.persistent) {
      for (const e of entries) {
        const cur = DB._memOutbox.get(e.key);
        if (cur && cur.queuedAt === e.queuedAt) DB._memOutbox.delete(e.key);
      }
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = DB._db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      for (const e of entries) {
        const req = store.get(e.key);
        req.onsuccess = () => {
          const cur = req.result;
          if (cur && cur.queuedAt === e.queuedAt) store.delete(e.key);
        };
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  /* Hard-deletes tombstones old enough that every device has surely seen the
     delete. Local only — purging server-side would create a resurrection
     window for anyone offline longer than the retention period. */
  async purgeTombstones(cutoff = Date.now() - TOMBSTONE_TTL_MS) {
    const ids = Store.expiredTombstones(await DB.getAll(), cutoff);
    if (!ids.length) return 0;
    if (!DB.persistent) { ids.forEach((id) => DB._mem.delete(id)); return ids.length; }
    await DB._tx('readwrite', (store) => ids.forEach((id) => store.delete(id)));
    return ids.length;
  },

  async replaceAll(items) {
    if (!DB.persistent) { DB._mem = new Map(items.map((i) => [i.id, i])); return; }
    await DB._tx('readwrite', (store) => { store.clear(); items.forEach((i) => store.put(i)); });
  },

  /* Import writes items and meals together. One transaction spanning both
     object stores, so a failure aborts atomically — no half-written state that
     the caller would then wrongly report as "unchanged". */
  async replaceAllWithMeals(items, meals) {
    if (!DB.persistent) {
      DB._mem = new Map(items.map((i) => [i.id, i]));
      DB._memSettings.set('meals', meals);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = DB._db.transaction(['items', 'settings'], 'readwrite');
      const itemStore = tx.objectStore('items');
      itemStore.clear();
      items.forEach((i) => itemStore.put(i));
      tx.objectStore('settings').put(meals, 'meals');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  /* Replaces the LIVE working set while preserving tombstones already in
     storage. Bulk mutations (completing a trip, a meal preflight, a file
     merge) must use this rather than replaceAllWithMeals: the caller passes
     `state.items`, which by design never contains tombstones, so a plain
     clear-and-rewrite would silently erase every delete the household has
     not yet synced. Restore keeps using replaceAllWithMeals, where wiping
     everything is the whole point.
     Reading inside the same transaction is what makes this safe — fetching
     the tombstones beforehand would race with any concurrent write. */
  async replaceLiveWithMeals(items, meals) {
    if (!DB.persistent) {
      const kept = [...DB._mem.values()].filter((r) => r.deletedAt);
      DB._mem = new Map([...kept, ...items].map((i) => [i.id, i]));
      DB._memSettings.set('meals', meals);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = DB._db.transaction(['items', 'settings'], 'readwrite');
      const itemStore = tx.objectStore('items');
      const existing = itemStore.getAll();
      existing.onsuccess = () => {
        const tombstones = existing.result.filter((r) => r.deletedAt);
        itemStore.clear();
        // tombstones first, so a live record always wins a same-id collision
        [...tombstones, ...items].forEach((i) => itemStore.put(i));
      };
      tx.objectStore('settings').put(meals, 'meals');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  /* Applies a reconciled pull: the merged records (tombstones included), the
     new cursor, and the keys that still need pushing back — all in ONE
     transaction across all three stores.

     Atomicity is the whole point. If the cursor were committed separately and
     the process died in between, the next pull would start after rows that
     were never applied, and those rows would never be fetched again — a
     permanent, silent hole in the local copy. */
  async applyPull({ items, meals, cursor, enqueue = [] }) {
    if (!DB.persistent) {
      if (items) DB._mem = new Map(items.map((i) => [i.id, i]));
      if (meals) DB._memSettings.set('meals', meals);
      if (cursor !== undefined) DB._memSettings.set('sync.cursor', cursor);
      for (const e of enqueue) DB._memOutbox.set(`${e.kind}:${e.id}`, DB._outboxEntry(e.kind, e.id));
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = DB._db.transaction(['items', 'settings', 'outbox'], 'readwrite');
      if (items) {
        const itemStore = tx.objectStore('items');
        itemStore.clear();
        items.forEach((i) => itemStore.put(i));
      }
      const settings = tx.objectStore('settings');
      if (meals) settings.put(meals, 'meals');
      if (cursor !== undefined) settings.put(cursor, 'sync.cursor');
      const outbox = tx.objectStore('outbox');
      for (const e of enqueue) outbox.put(DB._outboxEntry(e.kind, e.id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
};
