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
  assertEqual(data.version, 1);
  assertEqual(Store.validateImport(data), true);
});

test('validateImport rejects bad shapes', () => {
  assertEqual(Store.validateImport(null), false);
  assertEqual(Store.validateImport({ version: 2, items: [] }), false);
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
