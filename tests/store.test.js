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
