test('createItem applies defaults', () => {
  const it = Store.createItem('Milk');
  assert(it.id.length > 0, 'has id');
  assertEqual(it.name, 'Milk');
  assertEqual(it.category, 'Other');
  assertEqual(it.tracked, false);
  assertEqual(it.stock, 0);
  assertEqual(it.lowAt, 1);
  assertEqual(it.unit, '');
  assertEqual(it.onList, false);
  assertEqual(it.listQty, 1);
  assertEqual(it.checked, false);
});

test('createItem trims name and accepts overrides', () => {
  const it = Store.createItem('  Eggs ', { category: 'Dairy', tracked: true, stock: 6, lowAt: 3, unit: 'cartons' });
  assertEqual(it.name, 'Eggs');
  assertEqual(it.category, 'Dairy');
  assertEqual(it.tracked, true);
  assertEqual(it.stock, 6);
  assertEqual(it.lowAt, 3);
  assertEqual(it.unit, 'cartons');
});

test('deriveStatus: 0 = out, <= lowAt = low, else stocked', () => {
  const base = Store.createItem('Eggs', { tracked: true, lowAt: 3 });
  assertEqual(Store.deriveStatus({ ...base, stock: 0 }), 'out');
  assertEqual(Store.deriveStatus({ ...base, stock: 3 }), 'low');
  assertEqual(Store.deriveStatus({ ...base, stock: 4 }), 'stocked');
});

test('update merges without mutating and bumps updatedAt', () => {
  const it = Store.createItem('Rice');
  const before = it.updatedAt;
  const changed = Store.update(it, { stock: 5 });
  assertEqual(changed.stock, 5);
  assertEqual(it.stock, 0, 'original untouched');
  assert(changed.updatedAt >= before, 'updatedAt bumped');
});

test('toggleOnList on and off', () => {
  const it = Store.createItem('Milk', { tracked: true });
  const on = Store.toggleOnList(it);
  assertEqual(on.onList, true);
  const off = Store.toggleOnList({ ...on, checked: true, listQty: 3 });
  assertEqual(off.onList, false);
  assertEqual(off.checked, false, 'check cleared when removed from list');
  assertEqual(off.listQty, 1, 'qty reset when removed from list');
});

test('setChecked toggles checked', () => {
  const it = Store.createItem('Milk', { onList: true });
  assertEqual(Store.setChecked(it, true).checked, true);
  assertEqual(Store.setChecked(Store.setChecked(it, true), false).checked, false);
});

test('adjustListQty floors at 1', () => {
  const it = Store.createItem('Milk', { onList: true });
  assertEqual(Store.adjustListQty(it, 2).listQty, 3);
  assertEqual(Store.adjustListQty(it, -5).listQty, 1);
});

test('adjustStock floors at 0', () => {
  const it = Store.createItem('Eggs', { tracked: true, stock: 2 });
  assertEqual(Store.adjustStock(it, 3).stock, 5);
  assertEqual(Store.adjustStock(it, -9).stock, 0);
});

test('completeTrip restocks tracked items by quantity bought', () => {
  const eggs = { ...Store.createItem('Eggs', { tracked: true, stock: 0, onList: true, listQty: 2 }), checked: true };
  const [after] = Store.completeTrip([eggs]);
  assertEqual(after.stock, 2, 'stock 0 + bought 2 = 2');
  assertEqual(after.onList, false);
  assertEqual(after.checked, false);
  assertEqual(after.listQty, 1);
});

test('completeTrip deletes checked one-offs, keeps unchecked items', () => {
  const oneOff = { ...Store.createItem('Birthday candles', { onList: true }), checked: true };
  const unbought = Store.createItem('Milk', { tracked: true, onList: true, listQty: 1 });
  const idle = Store.createItem('Rice', { tracked: true, stock: 3 });
  const result = Store.completeTrip([oneOff, unbought, idle]);
  assertEqual(result.length, 2, 'one-off removed');
  assertEqual(result[0].id, unbought.id);
  assertEqual(result[0].onList, true, 'unbought stays on list');
  assertEqual(result[1].stock, 3, 'idle untouched');
});

test('outLowCounts counts tracked items only', () => {
  const items = [
    Store.createItem('A', { tracked: true, stock: 0 }),            // out
    Store.createItem('B', { tracked: true, stock: 1, lowAt: 1 }),  // low
    Store.createItem('C', { tracked: true, stock: 9 }),            // stocked
    Store.createItem('D', { stock: 0 })                            // untracked, ignored
  ];
  assertEqual(Store.outLowCounts(items), { out: 1, low: 1 });
});

test('serialize/validateImport round-trip', () => {
  const items = [Store.createItem('Milk', { tracked: true })];
  const data = JSON.parse(Store.serialize(items));
  assertEqual(data.version, 2); // bumped in V3 to carry meals
  assertEqual(Store.validateImport(data), true);
});

test('validateImport rejects bad shapes', () => {
  assertEqual(Store.validateImport(null), false);
  assertEqual(Store.validateImport({ version: 9, items: [] }), false); // still-unknown version
  assertEqual(Store.validateImport({ version: 1, items: 'nope' }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ id: 'x', name: 'incomplete' }] }), false);
});

test('DB round-trip: init, put, getAll, delete, replaceAll', async () => {
  await new Promise((res) => { const r = indexedDB.deleteDatabase('grocery-test'); r.onsuccess = r.onerror = r.onblocked = res; });
  await DB.init('grocery-test');
  assertEqual(DB.persistent, true);

  const a = Store.createItem('A'), b = Store.createItem('B');
  await DB.put(a);
  await DB.put(b);
  let all = await DB.getAll();
  assertEqual(all.length, 2);

  await DB.delete(a.id);
  all = await DB.getAll();
  assertEqual(all.length, 1);
  assertEqual(all[0].id, b.id);

  await DB.replaceAll([a]);
  all = await DB.getAll();
  assertEqual(all.length, 1);
  assertEqual(all[0].id, a.id);
});

test('DB falls back to memory when IndexedDB unavailable', async () => {
  const realOpen = indexedDB.open;
  indexedDB.open = () => { throw new Error('unavailable'); };
  await DB.init('grocery-fallback');
  indexedDB.open = realOpen;
  assertEqual(DB.persistent, false);

  const a = Store.createItem('A'), b = Store.createItem('B');
  await DB.put(a);
  await DB.put(b);
  assertEqual((await DB.getAll()).length, 2);
  await DB.delete(a.id);
  const remaining = await DB.getAll();
  assertEqual(remaining.length, 1);
  assertEqual(remaining[0].id, b.id);
  await DB.replaceAll([a]);
  assertEqual((await DB.getAll())[0].id, a.id);

  // restore persistent mode so later tests are unaffected
  DB.persistent = true;
  DB._mem = null;
  await DB.init('grocery-test');
});

test('validateImport rejects wrong value types', () => {
  const good = Store.createItem('Milk');
  assertEqual(Store.validateImport({ version: 1, items: [good] }), true);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, id: 42 }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, stock: '3' }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, listQty: '<b>1</b>' }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, onList: 'yes' }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, stock: NaN }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, id: '"><img src=x onerror=1>' }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, id: 'a'.repeat(65) }] }), false);
});

test('update preserves untouched fields', () => {
  const it = Store.createItem('Milk', { category: 'Dairy', unit: 'gal' });
  const changed = Store.update(it, { stock: 5 });
  assertEqual(changed.name, 'Milk');
  assertEqual(changed.category, 'Dairy');
  assertEqual(changed.unit, 'gal');
  assertEqual(changed.id, it.id);
});

test('createItem starts with empty price history', () => {
  assertEqual(Store.createItem('Milk').prices, []);
});

test('addPrice prepends newest-first and trims store name', () => {
  let it = Store.createItem('Milk', { tracked: true });
  it = Store.addPrice(it, 3.49, '  Trader Joes ');
  it = Store.addPrice(it, 3.99, 'Safeway');
  assertEqual(it.prices.length, 2);
  assertEqual(it.prices[0].price, 3.99);
  assertEqual(it.prices[0].store, 'Safeway');
  assertEqual(it.prices[1].store, 'Trader Joes');
  assert(typeof it.prices[0].at === 'number', 'entry timestamped');
});

test('lastPrice returns newest entry or null', () => {
  const fresh = Store.createItem('Milk');
  assertEqual(Store.lastPrice(fresh), null);
  const priced = Store.addPrice(fresh, 2.5, 'Aldi');
  assertEqual(Store.lastPrice(priced).price, 2.5);
});

test('storeNames collects unique sorted stores across items', () => {
  const a = Store.addPrice(Store.createItem('Milk'), 3, 'Safeway');
  const b = Store.addPrice(Store.addPrice(Store.createItem('Eggs'), 4, 'Aldi'), 5, 'Safeway');
  const c = Store.createItem('Rice'); // no prices
  assertEqual(Store.storeNames([a, b, c]), ['Aldi', 'Safeway']);
});

test('completeTrip records prices for bought items only', () => {
  const eggs = { ...Store.createItem('Eggs', { tracked: true, stock: 0, onList: true, listQty: 2 }), checked: true };
  const milk = Store.createItem('Milk', { tracked: true, stock: 1, onList: true }); // unchecked
  const result = Store.completeTrip([eggs, milk], { store: 'Aldi', prices: { [eggs.id]: 4.25, [milk.id]: 9.99 } });
  const boughtEggs = result.find((i) => i.id === eggs.id);
  assertEqual(boughtEggs.stock, 2, 'still restocks by qty bought');
  assertEqual(boughtEggs.prices.length, 1);
  assertEqual(boughtEggs.prices[0].price, 4.25);
  assertEqual(boughtEggs.prices[0].store, 'Aldi');
  assertEqual(result.find((i) => i.id === milk.id).prices.length, 0, 'unchecked item gets no price');
});

test('completeTrip skips blank prices and works with no purchase arg', () => {
  const mk = () => ({ ...Store.createItem('Eggs', { tracked: true, stock: 0, onList: true, listQty: 1 }), checked: true });
  const a = mk();
  assertEqual(Store.completeTrip([a], { store: 'Aldi', prices: {} })[0].prices.length, 0);
  const b = mk();
  assertEqual(Store.completeTrip([b])[0].prices.length, 0, 'no purchase arg still completes');
  assertEqual(Store.completeTrip([b])[0].stock, 1, 'restock unaffected');
});

test('validateImport accepts v1 backups without prices and validates new ones', () => {
  const good = Store.createItem('Milk');
  const { prices, ...v1Item } = good; // v1 backup shape
  assertEqual(Store.validateImport({ version: 1, items: [v1Item] }), true, 'v1 backup still imports');
  assertEqual(Store.validateImport({ version: 1, items: [Store.addPrice(good, 3.5, 'Aldi')] }), true);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, prices: 'nope' }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, prices: [{ price: '3', store: 'A', at: 1 }] }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, prices: [{ price: 3, store: 5, at: 1 }] }] }), false);
  assertEqual(Store.validateImport({ version: 1, items: [{ ...good, prices: [{ price: 3, store: 'A' }] }] }), false);
});

test('normalizeImport backfills missing price history', () => {
  const good = Store.createItem('Milk');
  const { prices, ...v1Item } = good;
  const [normalized] = Store.normalizeImport([v1Item]);
  assertEqual(normalized.prices, []);
  const priced = Store.addPrice(good, 2, 'Aldi');
  assertEqual(Store.normalizeImport([priced])[0].prices.length, 1, 'existing history preserved');
});

test('normalizePrice rounds to cents and rejects junk', () => {
  assertEqual(Store.normalizePrice('3.5'), 3.5);
  assertEqual(Store.normalizePrice('1.999'), 2, 'rounds to cents instead of blocking');
  assertEqual(Store.normalizePrice('1.994'), 1.99);
  assertEqual(Store.normalizePrice('$12.99'), 12.99, 'tolerates a typed dollar sign');
  assertEqual(Store.normalizePrice('1,234.5'), 1234.5, 'tolerates thousands separator');
  assertEqual(Store.normalizePrice('0'), 0, 'free item is valid');
  assertEqual(Store.normalizePrice('-5'), null, 'negative rejected');
  assertEqual(Store.normalizePrice('abc'), null);
  assertEqual(Store.normalizePrice(''), null);
  assertEqual(Store.normalizePrice('99999999999999999999'), null, 'absurd value rejected');
});

/* ---- Meals (V3) ---- */

test('createMeal names, dedupes ids, and stamps timestamps', () => {
  const m = Store.createMeal('  Tacos ', ['a', 'b', 'a']);
  assertEqual(m.name, 'Tacos', 'trims name');
  assertEqual(m.itemIds, ['a', 'b'], 'dedupes repeated ids');
  assert(m.id.length > 0, 'has id');
  assert(m.createdAt > 0 && m.updatedAt > 0, 'stamped');
  assertEqual(Store.createMeal('Empty').itemIds, [], 'defaults to no items');
});

test('mealItems resolves in meal order and drops deleted items', () => {
  const a = Store.createItem('Tortillas'), b = Store.createItem('Mince');
  const meal = Store.createMeal('Tacos', [b.id, a.id]);
  assertEqual(Store.mealItems(meal, [a, b]).map((i) => i.name), ['Mince', 'Tortillas'], 'meal order, not item order');
  assertEqual(Store.mealItems(meal, [a]).map((i) => i.name), ['Tortillas'], 'deleted item drops out silently');
  assertEqual(Store.mealItems(meal, []), [], 'all gone is not an error');
});

test('mealSummary is a flat ingredient line', () => {
  const a = Store.createItem('Tortillas'), b = Store.createItem('Mince');
  assertEqual(Store.mealSummary(Store.createMeal('Tacos', [a.id, b.id]), [a, b]), 'Tortillas, Mince');
  assertEqual(Store.mealSummary(Store.createMeal('Gone', ['nope']), [a]), '', 'no survivors is an empty line');
});

test('hasEnough only counts tracked items above the low mark', () => {
  const stocked = Store.createItem('Cumin', { tracked: true, stock: 4, lowAt: 1 });
  assertEqual(Store.hasEnough(stocked), true, 'well stocked');
  assertEqual(Store.hasEnough(Store.createItem('Onion', { tracked: true, stock: 1, lowAt: 1 })), false, 'at the low mark is short');
  assertEqual(Store.hasEnough(Store.createItem('Mince', { tracked: true, stock: 0, lowAt: 1 })), false, 'out is short');
  assertEqual(Store.hasEnough(Store.createItem('Napkins', { tracked: false, stock: 9 })), false,
    'untracked has no meaningful stock, so never counts as covered');
});

test('addMealToList adds every item, stocked or not', () => {
  const have = Store.createItem('Cumin', { tracked: true, stock: 4, lowAt: 1 });
  const need = Store.createItem('Mince', { tracked: true, stock: 0, lowAt: 1 });
  const other = Store.createItem('Soap');
  const meal = Store.createMeal('Tacos', [have.id, need.id]);
  const out = Store.addMealToList([have, need, other], meal);
  assertEqual(out.find((i) => i.id === have.id).onList, true, 'stocked item still lands — user prunes');
  assertEqual(out.find((i) => i.id === need.id).onList, true);
  assertEqual(out.find((i) => i.id === other.id).onList, false, 'items outside the meal untouched');
});

test('addMealToList preserves qty and basket state of items already listed', () => {
  let listed = Store.createItem('Mince', { onList: true, listQty: 3 });
  listed = Store.setChecked(listed, true);
  const meal = Store.createMeal('Tacos', [listed.id]);
  const [out] = Store.addMealToList([listed], meal);
  assertEqual(out.listQty, 3, 'qty not reset');
  assertEqual(out.checked, true, 'basket state not clobbered');
  assert(out === listed, 'already-listed item is returned untouched');
});

test('mealAddStats counts total and how many you are short on', () => {
  const have = Store.createItem('Cumin', { tracked: true, stock: 4, lowAt: 1 });
  const low = Store.createItem('Onion', { tracked: true, stock: 1, lowAt: 1 });
  const out = Store.createItem('Mince', { tracked: true, stock: 0, lowAt: 1 });
  const meal = Store.createMeal('Tacos', [have.id, low.id, out.id]);
  assertEqual(Store.mealAddStats(meal, [have, low, out]), { total: 3, short: 2 });
  assertEqual(Store.mealAddStats(meal, []), { total: 0, short: 0 }, 'meal whose items are all deleted');
});

test('pruneMeals drops dangling ids and leaves untouched meals identical', () => {
  const a = Store.createItem('Tortillas');
  const meal = Store.createMeal('Tacos', [a.id, 'deleted-id']);
  const clean = Store.createMeal('Toast', [a.id]);
  const [pruned, untouched] = Store.pruneMeals([meal, clean], [a]);
  assertEqual(pruned.itemIds, [a.id], 'dangling id removed');
  assert(untouched === clean, 'unchanged meal is the same object, so callers can skip a write');
});

test('serialize is v2 and carries meals', () => {
  const a = Store.createItem('Tortillas');
  const meal = Store.createMeal('Tacos', [a.id]);
  const data = JSON.parse(Store.serialize([a], [meal]));
  assertEqual(data.version, 2);
  assertEqual(data.meals.length, 1);
  assertEqual(data.meals[0].name, 'Tacos');
  assertEqual(JSON.parse(Store.serialize([a])).meals, [], 'meals default to empty');
});

test('validateImport accepts v1 backups and v2 with meals', () => {
  const good = Store.createItem('Milk');
  const meal = Store.createMeal('Tacos', [good.id]);
  assertEqual(Store.validateImport({ version: 1, items: [good] }), true, 'v1 still loads');
  assertEqual(Store.validateImport({ version: 2, items: [good], meals: [meal] }), true);
  assertEqual(Store.validateImport({ version: 2, items: [good] }), true, 'v2 without meals is fine');
  assertEqual(Store.validateImport({ version: 3, items: [good] }), false, 'unknown version rejected');
});

test('validateImport rejects malformed meals', () => {
  const good = Store.createItem('Milk');
  const v = (meals) => Store.validateImport({ version: 2, items: [good], meals });
  assertEqual(v('nope'), false, 'meals must be an array');
  assertEqual(v([{ id: 'a', name: 'X', itemIds: [] }]), true);
  assertEqual(v([{ id: 'a', name: 'X' }]), false, 'itemIds required');
  assertEqual(v([{ id: 'a', name: 5, itemIds: [] }]), false, 'name must be a string');
  assertEqual(v([{ id: 'bad id!', name: 'X', itemIds: [] }]), false, 'meal id must be uuid-shaped');
  assertEqual(v([{ id: 'a', name: 'X', itemIds: ['../../etc'] }]), false,
    'itemIds must be uuid-shaped — no key injection via an import');
});

test('normalizeImportMeals tolerates v1 backups and drops unknown item refs', () => {
  const a = Store.createItem('Tortillas');
  assertEqual(Store.normalizeImportMeals(undefined, [a]), [], 'v1 backup has no meals key');
  const meal = Store.createMeal('Tacos', [a.id, 'ghost']);
  assertEqual(Store.normalizeImportMeals([meal], [a])[0].itemIds, [a.id], 'ref to an item the file lacked is dropped');
});

/* ---- Additive merge import (V4) ---- */

test('validateMergeImport accepts loose payloads, rejects non-objects', () => {
  assertEqual(Store.validateMergeImport({ items: [] }), true, 'no version needed');
  assertEqual(Store.validateMergeImport({ items: [{ name: 'Basil' }] }), true, 'loose items ok');
  assertEqual(Store.validateMergeImport({ items: [], meals: [] }), true);
  assertEqual(Store.validateMergeImport(null), false);
  assertEqual(Store.validateMergeImport({ items: 'nope' }), false, 'items must be an array');
  assertEqual(Store.validateMergeImport({ items: [], meals: 'nope' }), false, 'meals if present must be an array');
});

test('sanitizeItemFields keeps only present, well-typed fields', () => {
  assertEqual(Store.sanitizeItemFields({ name: 'X' }), {}, 'name is not a field here; nothing else present');
  const f = Store.sanitizeItemFields({ category: ' Spices ', unit: ' g ', stock: '3', lowAt: 1, tracked: true, onList: true, listQty: 0 });
  assertEqual(f.category, 'Spices', 'trims category');
  assertEqual(f.unit, 'g');
  assertEqual(f.stock, 3, 'numeric string coerced');
  assertEqual(f.lowAt, 1);
  assertEqual(f.tracked, true);
  assertEqual(f.onList, true);
  assertEqual(f.listQty, 1, 'listQty floored to at least 1');
  assertEqual('stock' in Store.sanitizeItemFields({ stock: 'abc' }), false, 'junk number dropped');
  assertEqual('tracked' in Store.sanitizeItemFields({ tracked: 'yes' }), false, 'non-boolean dropped');
});

test('mergeItems appends new items and mints fresh ids', () => {
  const { items, stats } = Store.mergeItems([], [{ name: 'Basil', category: 'Spices' }]);
  assertEqual(items.length, 1);
  assertEqual(items[0].name, 'Basil');
  assertEqual(items[0].category, 'Spices');
  assert(items[0].id.length > 0, 'minted an id for an id-less item');
  assertEqual(stats, { added: 1, updated: 0, skipped: 0 });
});

test('mergeItems never trusts an incoming id for a NEW item (injection guard)', () => {
  const { items } = Store.mergeItems([], [{ id: 'evil key', name: 'Basil' }]);
  assert(items[0].id !== 'evil key', 'a non-uuid id is discarded and a fresh one minted');
  assert(Store.isUuid(items[0].id) || items[0].id.length > 0, 'resulting id is well-formed');
});

test('mergeItems updates a match by id and overlays only present fields', () => {
  const existing = Store.createItem('Milk', { stock: 5, lowAt: 2, tracked: true, category: 'Dairy' });
  const { items, stats } = Store.mergeItems([existing], [{ id: existing.id, name: 'Milk', onList: true }]);
  assertEqual(items.length, 1, 'no new row');
  assertEqual(items[0].onList, true, 'present field applied');
  assertEqual(items[0].stock, 5, 'absent field left alone — a partial payload does not zero stock');
  assertEqual(items[0].category, 'Dairy', 'absent field untouched');
  assertEqual(stats, { added: 0, updated: 1, skipped: 0 });
});

test('mergeItems matches by trimmed, case-insensitive name when id is absent', () => {
  const existing = Store.createItem('Olive Oil', { stock: 1 });
  const { items, stats } = Store.mergeItems([existing], [{ name: '  olive oil ', stock: 2 }]);
  assertEqual(items.length, 1, 'matched by name, not appended');
  assertEqual(items[0].stock, 2, 'updated');
  assertEqual(items[0].id, existing.id, 'kept the existing id');
  assertEqual(stats.updated, 1);
});

test('mergeItems skips items with no usable name', () => {
  const { items, stats } = Store.mergeItems([], [{ stock: 3 }, { name: '   ' }, null, 'nope']);
  assertEqual(items.length, 0);
  assertEqual(stats.skipped, 4);
});

test('mergeItems does not mutate the existing array', () => {
  const existing = [Store.createItem('Milk')];
  const before = existing.length;
  Store.mergeItems(existing, [{ name: 'Eggs' }]);
  assertEqual(existing.length, before, 'input array untouched');
});

test('mergeImport remaps a full export’s meal itemIds onto the merged items', () => {
  // A backup whose ids collide with nothing here: items get fresh ids on append,
  // and the meal must follow them, not dangle.
  const a = Store.createItem('Tortillas', { id: 'aaaa-1111' });
  const b = Store.createItem('Mince', { id: 'bbbb-2222' });
  const meal = Store.createMeal('Tacos', [a.id, b.id]);
  meal.id = 'meal-9999';
  const data = { items: [a, b], meals: [meal] };
  const { items, meals } = Store.mergeImport([], [], data);
  assertEqual(items.length, 2);
  assertEqual(meals.length, 1);
  assertEqual(Store.mealItems(meals[0], items).map((i) => i.name), ['Tortillas', 'Mince'],
    'meal resolves to real items after the merge remap');
});

test('mergeImport into a populated db updates overlaps and appends the rest', () => {
  const milk = Store.createItem('Milk', { stock: 5 });
  const { items, stats } = Store.mergeImport([milk], [],
    { items: [{ name: 'Milk', stock: 8 }, { name: 'Bread' }, { name: 'Eggs' }] });
  assertEqual(items.find((i) => i.name === 'Milk').stock, 8, 'existing updated');
  assertEqual(items.filter((i) => i.name === 'Bread' || i.name === 'Eggs').length, 2, 'new appended');
  assertEqual(stats, { added: 2, updated: 1, skipped: 0 });
  assertEqual(items.every((i) => Array.isArray(i.prices)), true, 'merged items are normalized');
});

test('mergeMeals merges by name and prunes dangling ids', () => {
  const a = Store.createItem('Tortillas');
  const existingMeal = Store.createMeal('Tacos', [a.id]);
  const merged = Store.mergeMeals([existingMeal], [{ name: 'Tacos', itemIds: [a.id, 'ghost-id'] }], [a], {});
  assertEqual(merged.length, 1, 'matched by name, not duplicated');
  assertEqual(merged[0].itemIds, [a.id], 'ghost id pruned against real items');
});

/* ---- V4 merge fixes (from independent review) ---- */

test('mergePrices unions histories newest-first without dupes', () => {
  const a = { price: 2, store: 'Aldi', at: 100 };
  const b = { price: 3, store: 'Lidl', at: 200 };
  const merged = Store.mergePrices([b], [a, b]); // b appears in both
  assertEqual(merged.map((p) => p.at), [200, 100], 'newest first');
  assertEqual(merged.length, 2, 'duplicate dropped');
});

test('mergeItems unions price history on a match instead of clobbering it', () => {
  let milk = Store.createItem('Milk');
  milk = Store.addPrice(milk, 3, 'Lidl');
  milk = Store.addPrice(milk, 2, 'Aldi');   // addPrice prepends -> this is newest
  const newestAt = milk.prices[0].at;
  const stale = { price: 1, store: 'Old', at: 1 };
  const { items } = Store.mergeItems([milk], [{ id: milk.id, name: 'Milk', prices: [stale] }]);
  const prices = items[0].prices;
  assert(prices.length >= 3, 'existing history preserved, not replaced');
  assertEqual(prices[0].at, newestAt, 'newest real price still on top');
  assert(prices.some((p) => p.store === 'Old'), 'incoming price also folded in');
});

test('sanitizeItemFields treats empty unit and category alike (both ignored)', () => {
  assertEqual('unit' in Store.sanitizeItemFields({ unit: '' }), false, 'empty unit not applied');
  assertEqual('unit' in Store.sanitizeItemFields({ unit: '   ' }), false, 'whitespace unit not applied');
  assertEqual('category' in Store.sanitizeItemFields({ category: '' }), false, 'empty category not applied');
  assertEqual(Store.sanitizeItemFields({ unit: 'cartons' }).unit, 'cartons', 'real unit still applied');
});

test('merge does not blank an existing unit when payload sends unit:""', () => {
  const milk = Store.createItem('Milk', { unit: 'gal' });
  const { items } = Store.mergeItems([milk], [{ name: 'Milk', unit: '' }]);
  assertEqual(items[0].unit, 'gal', 'existing unit survives an empty-string payload');
});

test('replaceAllWithMeals persists items and meals together', async () => {
  await new Promise((res) => { const r = indexedDB.deleteDatabase('grocery-atomic'); r.onsuccess = r.onerror = r.onblocked = res; });
  await DB.init('grocery-atomic');
  const a = Store.createItem('Rice');
  const meal = Store.createMeal('SoloRice', [a.id]);
  await DB.replaceAllWithMeals([a], [meal]);
  assertEqual((await DB.getAll()).map((i) => i.name), ['Rice']);
  assertEqual((await DB.getSetting('meals', [])).map((m) => m.name), ['SoloRice']);
  DB.persistent = true; DB._mem = null;
  await DB.init('grocery-test');
});

/* ---- Category order & grouping (V4 #2) ---- */

test('CATEGORY_ORDER includes the new V4 categories', () => {
  for (const c of ['Condiments', 'Spices', 'Drinks']) assert(Store.CATEGORY_ORDER.includes(c), `${c} missing from CATEGORY_ORDER`);
  // Placed after Pantry, before Household — pantry-adjacent staples grouped together.
  const idx = (c) => Store.CATEGORY_ORDER.indexOf(c);
  assert(idx('Pantry') < idx('Condiments') && idx('Drinks') < idx('Household'), 'new categories sit between Pantry and Household');
});

test('groupByCategory orders by CATEGORY_ORDER, unknown categories last and alphabetical', () => {
  const items = [
    Store.createItem('Ketchup', { category: 'Condiments' }),
    Store.createItem('Milk', { category: 'Dairy' }),
    Store.createItem('Cola', { category: 'Drinks' }),
    Store.createItem('Batteries', { category: 'Zzz-Unknown' }),
    Store.createItem('Aardvark Food', { category: 'Aaa-Unknown' }),
  ];
  const cats = Store.groupByCategory(items).map(([c]) => c);
  assertEqual(cats, ['Dairy', 'Condiments', 'Drinks', 'Aaa-Unknown', 'Zzz-Unknown'],
    'known categories in CATEGORY_ORDER, unknowns after, alphabetical among themselves');
});

test('groupByCategory with no secondary is stable by name (fixes reload reshuffle)', () => {
  const c = Store.createItem('Carrots', { category: 'Produce' });
  const a = Store.createItem('Apples', { category: 'Produce' });
  const b = Store.createItem('Bananas', { category: 'Produce' });
  // Feed in a deliberately non-alphabetical array order.
  const [, items] = Store.groupByCategory([c, a, b])[0];
  assertEqual(items.map((i) => i.name), ['Apples', 'Bananas', 'Carrots'], 'name order regardless of input order');
});

test('groupByCategory secondary bucket sorts within a category, ties broken by name', () => {
  const out1 = Store.createItem('Zucchini', { category: 'Produce', stock: 0 });
  const out2 = Store.createItem('Apples', { category: 'Produce', stock: 0 });
  const have = Store.createItem('Carrots', { category: 'Produce', stock: 5 });
  const stockedFirst = { secondary: (it) => (it.stock > 0 ? 0 : 1) };
  const [, items] = Store.groupByCategory([out1, out2, have], stockedFirst)[0];
  assertEqual(items.map((i) => i.name), ['Carrots', 'Apples', 'Zucchini'],
    'stock > 0 first, stock === 0 last, and the two zero-stock items tie-break by name');
});

test('groupByCategory does not mutate the input array', () => {
  const items = [Store.createItem('B'), Store.createItem('A')];
  const before = items.map((i) => i.name);
  Store.groupByCategory(items);
  assertEqual(items.map((i) => i.name), before, 'caller\'s array order untouched');
});
