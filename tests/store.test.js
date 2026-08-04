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

test('categoryChoices lists built-ins in shelf order', () => {
  const choices = Store.categoryChoices([]);
  assertEqual(choices, Store.CATEGORY_ORDER);
  assert(choices.includes('Canned & Jarred'), 'canned/jarred is one built-in category');
  // The singular forms were duplicates of the plurals; they must not come back.
  assert(!choices.includes('Spice') && !choices.includes('Condiment'), 'no singular duplicates');
  assert(!choices.includes('Canned') && !choices.includes('Jarred'), 'not split into two');
});

test('categoryChoices surfaces categories that only exist in the data', () => {
  const items = [
    Store.createItem('Kimchi', { category: 'Ferments' }), // e.g. arrived via merge import
    Store.createItem('Milk', { category: 'Dairy' }),      // already built in — not duplicated
  ];
  const choices = Store.categoryChoices(items);
  assertEqual(choices.filter((c) => c === 'Dairy').length, 1, 'no duplicate for a known category');
  assertEqual(choices[choices.length - 1], 'Ferments', 'unknown category sorts after the built-ins');
});

test('categoryChoices always includes the current category', () => {
  // The editor must be able to show a category no item carries any more,
  // otherwise opening the item would silently reset it to Other on save.
  assert(Store.categoryChoices([], 'Bulk bins').includes('Bulk bins'), 'current is present');
  assertEqual(Store.categoryChoices([], 'Dairy').length, Store.CATEGORY_ORDER.length, 'known current adds nothing');
});

test('categoryChoices sorts multiple unknown categories alphabetically', () => {
  const items = [Store.createItem('a', { category: 'Zest' }), Store.createItem('b', { category: 'Ferments' })];
  const extra = Store.categoryChoices(items).slice(Store.CATEGORY_ORDER.length);
  assertEqual(extra, ['Ferments', 'Zest']);
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
  assertEqual(data.version, 3); // V3 added meals, V6 added timestamps + tombstones
  assertEqual(Store.validateImport(data), true);
});

test('serializePantry keeps only tracked, in-stock items', () => {
  const items = [
    Store.createItem('Eggs', { tracked: true, stock: 6, category: 'Dairy', unit: 'cartons' }),
    Store.createItem('Rice', { tracked: true, stock: 2, category: 'Pantry' }),
    Store.createItem('Milk', { tracked: true, stock: 0, category: 'Dairy' }), // out of stock → excluded
    Store.createItem('Napkins', { tracked: false, stock: 9, category: 'Household' }), // untracked → excluded
  ];
  const data = JSON.parse(Store.serializePantry(items));
  assertEqual(data.pantry.map((p) => p.name), ['Eggs', 'Rice']);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(data.exportedAt), 'has ISO date');
});

test('serializePantry emits a clean, minimal shape', () => {
  const items = [
    Store.createItem('Eggs', { tracked: true, stock: 6, category: 'Dairy', unit: 'cartons' }),
    Store.createItem('Rice', { tracked: true, stock: 2, category: 'Pantry' }),
  ];
  const data = JSON.parse(Store.serializePantry(items));
  assertEqual(data.pantry[0], { name: 'Eggs', category: 'Dairy', stock: 6, unit: 'cartons' });
  assertEqual(data.pantry[1], { name: 'Rice', category: 'Pantry', stock: 2 }); // unit omitted when empty
});

test('serializePantry groups in category order', () => {
  const items = [
    Store.createItem('Rice', { tracked: true, stock: 1, category: 'Pantry' }),
    Store.createItem('Apples', { tracked: true, stock: 3, category: 'Produce' }),
    Store.createItem('Eggs', { tracked: true, stock: 6, category: 'Dairy' }),
  ];
  const data = JSON.parse(Store.serializePantry(items));
  // Produce before Dairy before Pantry, per CATEGORY_ORDER
  assertEqual(data.pantry.map((p) => p.name), ['Apples', 'Eggs', 'Rice']);
});

test('serializePantry on empty stock yields an empty list', () => {
  const data = JSON.parse(Store.serializePantry([]));
  assertEqual(data.pantry, []);
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

test('serialize is v3 and carries meals', () => {
  const a = Store.createItem('Tortillas');
  const meal = Store.createMeal('Tacos', [a.id]);
  const data = JSON.parse(Store.serialize([a], [meal]));
  assertEqual(data.version, 3);
  assertEqual(data.meals.length, 1);
  assertEqual(data.meals[0].name, 'Tacos');
  assertEqual(JSON.parse(Store.serialize([a])).meals, [], 'meals default to empty');
});

test('validateImport accepts v1 backups, v2 with meals, and v3 with tombstones', () => {
  const good = Store.createItem('Milk');
  const meal = Store.createMeal('Tacos', [good.id]);
  assertEqual(Store.validateImport({ version: 1, items: [good] }), true, 'v1 still loads');
  assertEqual(Store.validateImport({ version: 2, items: [good], meals: [meal] }), true);
  assertEqual(Store.validateImport({ version: 2, items: [good] }), true, 'v2 without meals is fine');
  assertEqual(Store.validateImport({ version: 3, items: [good], meals: [meal] }), true, 'v3 loads');
  assertEqual(Store.validateImport({ version: 4, items: [good] }), false, 'unknown version rejected');
  // v1/v2 records predate deletedAt, so absent must stay valid; junk must not.
  const { deletedAt, ...noStamp } = good;
  assertEqual(Store.validateImport({ version: 1, items: [noStamp] }), true, 'absent deletedAt is fine');
  assertEqual(Store.validateImport({ version: 3, items: [{ ...good, deletedAt: 'soon' }] }), false);
  assertEqual(Store.validateImport({ version: 3, items: [{ ...good, deletedAt: NaN }] }), false);
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

/* ── V6: tombstones, monotonic clock, sync reconciliation ── */

test('softDelete tombstones an item and clears its list state', () => {
  const it = Store.createItem('Milk', { onList: true, listQty: 3, checked: true });
  const gone = Store.softDelete(it);
  assert(typeof gone.deletedAt === 'number', 'deletedAt stamped');
  assertEqual(gone.deletedAt, gone.updatedAt, 'delete is a write, stamped like one');
  assertEqual(gone.onList, false, 'a deleted item must not linger on the list');
  assertEqual(gone.checked, false);
  assertEqual(gone.listQty, 3, 'other fields survive so the record stays diffable');
});

test('softDelete leaves meals without list fields', () => {
  const meal = Store.createMeal('Tacos', ['a']);
  const gone = Store.softDelete(meal);
  assert(typeof gone.deletedAt === 'number');
  assert(!('onList' in gone), 'meals gain no spurious item fields');
});

test('live filters tombstones, including records that predate the field', () => {
  const a = Store.createItem('A');
  const b = Store.softDelete(Store.createItem('B'));
  const { deletedAt, ...legacy } = Store.createItem('C'); // written before tombstones existed
  assertEqual(Store.live([a, b, legacy]).map((r) => r.name), ['A', 'C']);
});

test('updatedAt is monotonic even when the device clock runs backwards', () => {
  const future = Store.createItem('Milk', { updatedAt: Date.now() + 600000 }); // clock 10 min fast
  const next = Store.update(future, { stock: 2 });
  assert(next.updatedAt > future.updatedAt, 'never goes backwards on a record');
  const meal = Store.createMeal('Tacos', ['a'], { updatedAt: Date.now() + 600000 });
  assert(Store.updateMeal(meal, { name: 'T2' }).updatedAt > meal.updatedAt);
});

test('createItem reconstructs a remote record faithfully', () => {
  const it = Store.createItem('Milk', {
    id: 'milk', createdAt: 1000, updatedAt: 2000, deletedAt: 3000, checked: true
  });
  assertEqual(it.createdAt, 1000, 'a hardcoded now would corrupt conflict resolution');
  assertEqual(it.updatedAt, 2000);
  assertEqual(it.deletedAt, 3000);
  assertEqual(it.checked, true);
});

test('reconcile: newer side wins, ties go to local', () => {
  const local = Store.createItem('Milk', { id: 'm', stock: 1, updatedAt: 100 });
  const remote = Store.createItem('Milk', { id: 'm', stock: 9, updatedAt: 200 });
  assertEqual(Store.reconcileRecord(local, remote).stock, 9, 'remote newer wins');
  assertEqual(Store.reconcileRecord(remote, local).stock, 9, 'order-independent');
  const tie = Store.createItem('Milk', { id: 'm', stock: 5, updatedAt: 100 });
  assertEqual(Store.reconcileRecord(local, tie).stock, 1, 'tie goes to local');
});

test('reconcile: a missing side is not a conflict', () => {
  const it = Store.createItem('Milk', { id: 'm' });
  assertEqual(Store.reconcileRecord(null, it), it, 'remote-only record is adopted');
  assertEqual(Store.reconcileRecord(it, null), it, 'local-only record survives a delta');
  assertEqual(Store.reconcileRecord(null, null), null);
});

test('reconcile: prices union in both directions, even for the losing side', () => {
  let local = Store.createItem('Milk', { id: 'm', updatedAt: 500 });
  local = Store.addPrice(local, 3.5, 'Aldi');
  local = Store.update(local, { updatedAt: 500 });
  let remote = Store.createItem('Milk', { id: 'm', updatedAt: 900 });
  remote = Store.addPrice(remote, 4.25, 'Coles');
  remote = Store.update(remote, { updatedAt: 900 });

  const merged = Store.reconcileRecord(local, remote);
  assertEqual(merged.prices.length, 2, 'the loser keeps its price too');
  const stores = merged.prices.map((p) => p.store).sort();
  assertEqual(stores, ['Aldi', 'Coles']);
});

test('reconcile: delete beats a newer edit and never comes back', () => {
  const deleted = Store.createItem('Milk', { id: 'm', updatedAt: 100, deletedAt: 100 });
  const edited = Store.createItem('Milk', { id: 'm', updatedAt: 900, stock: 7 });
  const merged = Store.reconcileRecord(edited, deleted);
  assertEqual(merged.stock, 7, 'the newer edit still wins the ordinary fields');
  assertEqual(merged.deletedAt, 100, 'but the record stays deleted');
  assertEqual(Store.live([merged]).length, 0);

  const twice = Store.reconcileRecord(merged, edited);
  assertEqual(twice.deletedAt, 100, 'deletedAt never returns to null');
});

test('reconcile: earliest deletedAt and createdAt win', () => {
  const a = Store.createItem('Milk', { id: 'm', createdAt: 500, updatedAt: 900, deletedAt: 900 });
  const b = Store.createItem('Milk', { id: 'm', createdAt: 100, updatedAt: 100, deletedAt: 300 });
  const merged = Store.reconcileRecord(a, b);
  assertEqual(merged.createdAt, 100);
  assertEqual(merged.deletedAt, 300, 'the first delete is the real one');
});

test('reconcileRecords re-enqueues records the local side won', () => {
  const localWins = Store.createItem('Milk', { id: 'm', stock: 1, updatedAt: 900 });
  const remoteWins = Store.createItem('Eggs', { id: 'e', stock: 1, updatedAt: 100 });
  const delta = [
    Store.createItem('Milk', { id: 'm', stock: 9, updatedAt: 100 }),
    Store.createItem('Eggs', { id: 'e', stock: 9, updatedAt: 900 })
  ];
  const { records, toPush } = Store.reconcileRecords([localWins, remoteWins], delta);
  assertEqual(records.length, 2);
  assertEqual(records.find((r) => r.id === 'm').stock, 1);
  assertEqual(records.find((r) => r.id === 'e').stock, 9);
  assertEqual(toPush, ['m'], 'the side the server does not know about must be pushed back');
});

test('reconcileRecords adopts remote-only rows and keeps local-only ones', () => {
  const localOnly = Store.createItem('Bread', { id: 'b', updatedAt: 100 });
  const remoteOnly = Store.createItem('Rice', { id: 'r', updatedAt: 100 });
  const { records, toPush } = Store.reconcileRecords([localOnly], [remoteOnly]);
  assertEqual(records.map((r) => r.id).sort(), ['b', 'r']);
  assertEqual(toPush, [], 'a local-only record is the outbox\'s job, not the reconciler\'s');
});

test('reconciling the same delta twice is a no-op', () => {
  const local = [Store.createItem('Milk', { id: 'm', stock: 1, updatedAt: 100 })];
  const delta = [Store.createItem('Milk', { id: 'm', stock: 9, updatedAt: 900 })];
  const once = Store.reconcileRecords(local, delta);
  const twice = Store.reconcileRecords(once.records, delta);
  assertEqual(twice.records, once.records, 'idempotent — replaying the cursor overlap is free');
  assertEqual(twice.toPush, []);
});

test('reconcileSnapshot handles items and meals together', () => {
  const local = { items: [Store.createItem('Milk', { id: 'm', updatedAt: 900 })], meals: [] };
  const remote = {
    items: [Store.createItem('Milk', { id: 'm', updatedAt: 100 })],
    meals: [Store.createMeal('Tacos', ['m'], { id: 't', updatedAt: 100 })]
  };
  const out = Store.reconcileSnapshot(local, remote);
  assertEqual(out.items.length, 1);
  assertEqual(out.meals.length, 1, 'a meal arriving alone is adopted');
  assertEqual(out.toPush.items, ['m']);
  assertEqual(out.toPush.meals, []);
});

test('overlayLocal lets an unpersisted in-memory edit beat the stored row', () => {
  const stored = [
    Store.createItem('Milk', { id: 'm', stock: 1 }),
    Store.softDelete(Store.createItem('Gone', { id: 'g' }))
  ];
  const inMemory = [Store.createItem('Milk', { id: 'm', stock: 42 })];
  const out = Store.overlayLocal(stored, inMemory);
  assertEqual(out.find((r) => r.id === 'm').stock, 42, 'the edit the user can see wins');
  assertEqual(out.length, 2, 'tombstones only storage knows about are retained');
});

test('item wire mapping round-trips losslessly', () => {
  let item = Store.createItem('Milk', {
    id: 'm', category: 'Dairy', unit: 'gal', tracked: true, stock: 3, lowAt: 2,
    onList: true, listQty: 4, checked: true, createdAt: 111, updatedAt: 222
  });
  item = Store.addPrice(item, 3.5, 'Aldi');
  item = Store.update(item, { updatedAt: 222 });

  const back = Store.fromItemRow(Store.toItemRow(item, 'house-1'));
  assertEqual(back, item, 'every synced field survives the round trip');
  assertEqual(Store.toItemRow(item, 'house-1').household_id, 'house-1');
});

test('meal wire mapping round-trips, tombstone included', () => {
  const meal = Store.softDelete(Store.createMeal('Tacos', ['a', 'b'], { id: 't', createdAt: 111 }));
  const back = Store.fromMealRow(Store.toMealRow(meal, 'house-1'));
  assertEqual(back, meal);
});

test('wire mapping preserves a null tombstone rather than inventing one', () => {
  const row = Store.toItemRow(Store.createItem('Milk', { id: 'm' }), 'h');
  assertEqual(row.deleted_at, null);
  assertEqual(Store.fromItemRow(row).deletedAt, null);
});

test('nextCursor rewinds behind the newest row and holds still on an empty delta', () => {
  const rows = [{ updated_at: '2026-01-01T00:00:10.000Z' }, { updated_at: '2026-01-01T00:00:04.000Z' }];
  assertEqual(Store.nextCursor(rows, null), '2026-01-01T00:00:08.000Z', 'max minus the overlap');
  assertEqual(Store.nextCursor([], 'keep-me'), 'keep-me', 'an empty page must not advance the cursor');
  assertEqual(Store.nextCursor([{ updated_at: 'junk' }], 'keep-me'), 'keep-me');
});

test('expiredTombstones selects only tombstones past the cutoff', () => {
  const live = Store.createItem('A', { id: 'a' });
  const fresh = Store.createItem('B', { id: 'b', deletedAt: 950 });
  const old = Store.createItem('C', { id: 'c', deletedAt: 100 });
  assertEqual(Store.expiredTombstones([live, fresh, old], 500), ['c']);
});

test('a file merge re-adds a deleted name instead of resurrecting the tombstone', () => {
  const gone = Store.softDelete(Store.createItem('Milk', { id: 'm' }));
  // state.items never contains tombstones, so the merge cannot see it to match on.
  const { items } = Store.mergeImport(Store.live([gone]), [], { items: [{ name: 'Milk', stock: 2 }] });
  assertEqual(items.length, 1);
  assert(items[0].id !== 'm', 'a fresh record, not the tombstone brought back to life');
  assertEqual(items[0].deletedAt, null);
});

test('replaceLiveWithMeals preserves tombstones a bulk write did not carry', async () => {
  await new Promise((res) => { const r = indexedDB.deleteDatabase('grocery-tomb'); r.onsuccess = r.onerror = r.onblocked = res; });
  await DB.init('grocery-tomb');

  const live = Store.createItem('Milk', { id: 'milk' });
  const dead = Store.softDelete(Store.createItem('Gone', { id: 'gone' }));
  await DB.replaceAllWithMeals([live, dead], []);

  // A bulk mutation passes state.items, which by design excludes tombstones.
  await DB.replaceLiveWithMeals([live], []);
  const all = await DB.getAll();
  assertEqual(all.length, 2, 'the tombstone survived a write that never mentioned it');
  assert(all.find((r) => r.id === 'gone').deletedAt, 'still a tombstone');
  assertEqual(Store.live(all).map((r) => r.id), ['milk']);

  // Restore, by contrast, is meant to wipe everything.
  await DB.replaceAllWithMeals([live], []);
  assertEqual((await DB.getAll()).length, 1, 'restore genuinely replaces everything');

  DB.persistent = true; DB._mem = null;
});

test('replaceLiveWithMeals preserves tombstones in the memory fallback too', async () => {
  DB.persistent = false;
  DB._mem = new Map();
  DB._memSettings = new Map();
  const live = Store.createItem('Milk', { id: 'milk' });
  const dead = Store.softDelete(Store.createItem('Gone', { id: 'gone' }));
  DB._mem.set('milk', live); DB._mem.set('gone', dead);

  await DB.replaceLiveWithMeals([live], []);
  assertEqual([...DB._mem.keys()].sort(), ['gone', 'milk']);

  DB.persistent = true; DB._mem = null;
});

/* ── V6: outbox + schema upgrade ── */

async function freshDb(name) {
  await new Promise((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = res; });
  await DB.init(name);
}
function restoreDb() {
  DB.persistent = true; DB._mem = null; DB.syncing = false; DB._memOutbox = new Map();
}

test('outbox stays empty while signed out — a local-only user pays nothing', async () => {
  await freshDb('grocery-outbox-off');
  DB.syncing = false;
  await DB.put(Store.createItem('Milk', { id: 'milk' }));
  await DB.enqueue('item', 'milk');
  assertEqual(await DB.outboxCount(), 0, 'nothing is recorded until sync is on');
  restoreDb();
});

test('outbox coalesces repeat writes to one entry per record', async () => {
  await freshDb('grocery-outbox');
  DB.syncing = true;
  let it = Store.createItem('Milk', { id: 'milk', stock: 0 });
  for (let n = 0; n < 5; n++) { it = Store.adjustStock(it, 1); await DB.put(it); }
  const entries = await DB.outboxAll();
  assertEqual(entries.length, 1, 'five stepper taps collapse to one dirty key');
  assertEqual(entries[0].key, 'item:milk');
  assertEqual((await DB.get('milk')).stock, 5, 'the record itself is current');
  restoreDb();
});

test('outboxRemove keeps an entry re-dirtied during the push', async () => {
  await freshDb('grocery-outbox-race');
  DB.syncing = true;
  const it = Store.createItem('Milk', { id: 'milk' });
  await DB.put(it);
  const pushed = await DB.outboxAll();          // what a push would send

  // …the user edits again while that request is in flight.
  await new Promise((r) => setTimeout(r, 5));
  await DB.put(Store.update(it, { stock: 9 }));

  await DB.outboxRemove(pushed);
  assertEqual(await DB.outboxCount(), 1, 'the in-flight edit must NOT be cleared');
  restoreDb();
});

test('outboxRemove clears entries that did not change', async () => {
  await freshDb('grocery-outbox-clear');
  DB.syncing = true;
  await DB.put(Store.createItem('Milk', { id: 'milk' }));
  await DB.put(Store.createItem('Eggs', { id: 'eggs' }));
  const pushed = await DB.outboxAll();
  assertEqual(pushed.length, 2);
  await DB.outboxRemove(pushed);
  assertEqual(await DB.outboxCount(), 0);
  restoreDb();
});

test('a delete needs no op-code: the tombstone write dirties the key itself', async () => {
  await freshDb('grocery-outbox-del');
  DB.syncing = true;
  const it = Store.createItem('Milk', { id: 'milk' });
  await DB.put(it);
  await DB.outboxRemove(await DB.outboxAll());
  await DB.put(Store.softDelete(it));
  const entries = await DB.outboxAll();
  assertEqual(entries.map((e) => e.key), ['item:milk']);
  assert((await DB.get('milk')).deletedAt, 'storage holds a tombstone, not a hole');
  restoreDb();
});

test('applyPull writes records, meals, cursor and re-push keys atomically', async () => {
  await freshDb('grocery-apply');
  DB.syncing = true;
  const items = [Store.createItem('Milk', { id: 'milk', stock: 4 }), Store.softDelete(Store.createItem('Gone', { id: 'gone' }))];
  const meals = [Store.createMeal('Tacos', ['milk'], { id: 'meal-1' })];
  await DB.applyPull({ items, meals, cursor: '2026-01-01T00:00:00.000Z', enqueue: [{ kind: 'item', id: 'milk' }] });

  assertEqual((await DB.getAll()).length, 2, 'tombstones are stored, not dropped');
  assertEqual(Store.live(await DB.getAll()).map((r) => r.id), ['milk']);
  assertEqual((await DB.getSetting('meals', [])).length, 1);
  assertEqual(await DB.getSetting('sync.cursor'), '2026-01-01T00:00:00.000Z');
  assertEqual((await DB.outboxAll()).map((e) => e.key), ['item:milk'], 'records the local side won are re-queued');
  restoreDb();
});

test('purgeTombstones drops only tombstones past the cutoff', async () => {
  await freshDb('grocery-purge');
  const live = Store.createItem('Milk', { id: 'milk' });
  const fresh = Store.createItem('Recent', { id: 'recent', deletedAt: Date.now() - 1000 });
  const ancient = Store.createItem('Ancient', { id: 'ancient', deletedAt: 1000 });
  await DB.replaceAllWithMeals([live, fresh, ancient], []);

  const purged = await DB.purgeTombstones(Date.now() - 60000);
  assertEqual(purged, 1);
  assertEqual((await DB.getAll()).map((r) => r.id).sort(), ['milk', 'recent']);
  restoreDb();
});

test('v1 databases upgrade to v2 without losing data', async () => {
  const NAME = 'grocery-upgrade';
  await new Promise((res) => { const r = indexedDB.deleteDatabase(NAME); r.onsuccess = r.onerror = r.onblocked = res; });

  // Build a genuine v1 database: items + settings only, no outbox.
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('items', { keyPath: 'id' });
      req.result.createObjectStore('settings');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['items', 'settings'], 'readwrite');
      tx.objectStore('items').put({ id: 'milk', name: 'Milk', stock: 3, prices: [] }); // pre-timestamp shape
      tx.objectStore('settings').put([{ id: 'm1', name: 'Tacos', itemIds: ['milk'] }], 'meals');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  await DB.init(NAME);
  const all = await DB.getAll();
  assertEqual(all.length, 1, 'the only copy of real data survived the upgrade');
  assertEqual(all[0].name, 'Milk');
  assertEqual(all[0].stock, 3);
  assertEqual((await DB.getSetting('meals', [])).length, 1, 'meals survived too');
  assertEqual(await DB.outboxCount(), 0, 'the new outbox store exists and is empty');

  // And the legacy record normalises into a sync-capable shape on load.
  const [normalised] = Store.normalizeImport(all);
  assertEqual(normalised.deletedAt, null);
  assert(typeof normalised.updatedAt === 'number', 'backfilled a clock it never had');
  restoreDb();
});

/* ── V6: the sync engine, driven against a fake client ── */

async function syncFixture(opts = {}) {
  // The open connection must be closed first, or deleteDatabase is BLOCKED and
  // silently leaves the previous test's data (and its cursor) in place.
  if (DB._db) { DB._db.close(); DB._db = null; }
  await new Promise((res) => { const r = indexedDB.deleteDatabase('grocery-sync'); r.onsuccess = r.onerror = r.onblocked = res; });
  await DB.init('grocery-sync');
  DB.syncing = true;
  const client = makeFakeSupabase(opts);
  await Sync.init({
    client,
    getLocal: async () => ({
      items: Store.overlayLocal(await DB.getAll(), []),
      meals: await DB.getSetting('meals', [])
    }),
    onStatus: () => {},
    onSnapshot: (s) => { Sync._lastSnapshot = s; }
  });
  return client;
}
function resetSync() {
  if (DB._db) { DB._db.close(); DB._db = null; }
  DB.persistent = true; DB._mem = null; DB.syncing = false; DB._memOutbox = new Map();
  Sync.client = null; Sync.session = null; Sync.householdId = null; Sync._lastSnapshot = null;
}

test('sync: signing in with a household reaches idle and enables the outbox', async () => {
  await syncFixture();
  assertEqual(Sync.status, 'idle');
  assertEqual(Sync.householdId, 'h1');
  assertEqual(Sync.enabled, true);
  resetSync();
});

test('sync: no household means choosing, and nothing is enqueued', async () => {
  await syncFixture({ household: null });
  assertEqual(Sync.status, 'choosing');
  assertEqual(DB.syncing, false, 'a user without a household must not queue writes');
  resetSync();
});

test('sync: seed marks every local record dirty exactly once', async () => {
  const client = await syncFixture();
  await DB.replaceAllWithMeals([Store.createItem('Milk', { id: 'milk' })], [Store.createMeal('Tacos', ['milk'], { id: 'm1' })]);
  await DB.putSetting('meals', [Store.createMeal('Tacos', ['milk'], { id: 'm1' })]);

  assertEqual((await Sync.seedFromLocal()).seeded, true);
  assertEqual(await DB.outboxCount(), 2, 'one item + one meal');
  assertEqual((await Sync.seedFromLocal()).seeded, false, 'seeding is idempotent');
  resetSync();
});

test('sync: push uploads dirty records and drains the outbox', async () => {
  const client = await syncFixture();
  await DB.put(Store.createItem('Milk', { id: 'milk', stock: 2 }));
  await DB.putSetting('meals', [Store.createMeal('Tacos', ['milk'], { id: 'm1' })]);
  await DB.enqueue('meal', 'm1');

  const res = await Sync.push();
  assertEqual(res.pushed, 2);
  assertEqual(await DB.outboxCount(), 0);
  assertEqual(client._tables.items.length, 1);
  assertEqual(client._tables.items[0].name, 'Milk');
  assertEqual(client._tables.items[0].household_id, 'h1');
  assertEqual(client._tables.meals[0].item_ids, ['milk']);
  resetSync();
});

test('sync: a failed push loses nothing and leaves the outbox intact', async () => {
  await syncFixture({ fail: { message: 'network down' } });
  DB.syncing = true;
  await DB.put(Store.createItem('Milk', { id: 'milk' }));
  assertEqual(await DB.outboxCount(), 1);

  const res = await Sync.push();
  assertEqual(res.pushed, 0);
  assertEqual(await DB.outboxCount(), 1, 'the change is still queued for the next attempt');
  resetSync();
});

test('sync: pull adopts remote records and renders them', async () => {
  const remote = Store.toItemRow(Store.createItem('Bread', { id: 'bread', stock: 1 }), 'h1');
  remote.updated_at = '2026-01-01T00:00:10.000Z';
  await syncFixture({ items: [remote] });

  const res = await Sync.pull();
  assertEqual(res.applied, 1);
  assertEqual((await DB.getAll()).map((r) => r.name), ['Bread']);
  assertEqual(Sync._lastSnapshot.items.map((i) => i.name), ['Bread']);
  assertEqual(await DB.getSetting('sync.cursor'), '2026-01-01T00:00:08.000Z', 'cursor rewound by the overlap');
  resetSync();
});

test('sync: a remote tombstone removes the item locally but keeps the record', async () => {
  const row = Store.toItemRow(Store.softDelete(Store.createItem('Bread', { id: 'bread' })), 'h1');
  row.updated_at = '2026-01-01T00:00:10.000Z';
  await syncFixture({ items: [row] });
  await DB.put(Store.createItem('Bread', { id: 'bread' }));

  await Sync.pull();
  assertEqual(Sync._lastSnapshot.items.length, 0, 'gone from the UI');
  assert((await DB.get('bread')).deletedAt, 'but still a tombstone, so it cannot come back');
  resetSync();
});

test('sync: a record the local side won is queued to push back', async () => {
  const stale = Store.toItemRow(Store.createItem('Milk', { id: 'milk', stock: 1, updatedAt: 100 }), 'h1');
  stale.updated_at = '2026-01-01T00:00:10.000Z';
  await syncFixture({ items: [stale] });
  await DB.put(Store.createItem('Milk', { id: 'milk', stock: 99, updatedAt: 9999 }));
  await DB.outboxRemove(await DB.outboxAll());   // pretend it was already pushed

  await Sync.pull();
  assertEqual((await DB.get('milk')).stock, 99, 'the newer local edit survives');
  assertEqual((await DB.outboxAll()).map((e) => e.key), ['item:milk'],
    'and is re-queued — without this the two sides never converge');
  resetSync();
});

test('sync: dry run reports what would change and writes nothing', async () => {
  const row = Store.toItemRow(Store.createItem('Bread', { id: 'bread' }), 'h1');
  row.updated_at = '2026-01-01T00:00:10.000Z';
  await syncFixture({ items: [row] });

  const res = await Sync.pull({ apply: false });
  assertEqual(res.dryRun, true);
  assertEqual(res.fetched.items, 1);
  assertEqual((await DB.getAll()).length, 0, 'nothing was written');
  assertEqual(await DB.getSetting('sync.cursor'), null, 'the cursor did not move');
  resetSync();
});

test('sync: a merge that would destroy most local data is refused', async () => {
  await syncFixture();
  // Ten local items, and a reconciler that (hypothetically) returns almost none.
  const many = Array.from({ length: 10 }, (_, n) => Store.createItem('Item' + n, { id: 'i' + n }));
  await DB.replaceAllWithMeals(many, []);
  const realReconcile = Store.reconcileSnapshot;
  Store.reconcileSnapshot = () => ({ items: [many[0]], meals: [], toPush: { items: [], meals: [] } });

  const res = await Sync.pull();
  Store.reconcileSnapshot = realReconcile;

  assert(res.error, 'the pull refused rather than applying');
  assert(/would remove 9 of 10/.test(res.error.message), res.error.message);
  assertEqual((await DB.getAll()).length, 10, 'local data untouched');
  resetSync();
});

test('sync: the pre-sync backup is written once and never overwritten', async () => {
  const row = Store.toItemRow(Store.createItem('Bread', { id: 'bread' }), 'h1');
  row.updated_at = '2026-01-01T00:00:10.000Z';
  await syncFixture({ items: [row] });
  await DB.put(Store.createItem('Original', { id: 'orig' }));

  await Sync.pull();
  const first = await DB.getSetting('sync.preSyncBackup');
  assertEqual(first.items.map((i) => i.name), ['Original'], 'captured the pre-sync state');

  await DB.putSetting('sync.cursor', null);
  await Sync.pull();
  assertEqual((await DB.getSetting('sync.preSyncBackup')).at, first.at, 'not overwritten by a later pull');
  resetSync();
});

test('sync: sync() is single-flight', async () => {
  const client = await syncFixture();
  await DB.put(Store.createItem('Milk', { id: 'milk' }));
  const [a, b] = await Promise.all([Sync.sync(), Sync.sync()]);
  assertEqual(a, b, 'concurrent triggers share one run rather than racing the outbox');
  resetSync();
});
