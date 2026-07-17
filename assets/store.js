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
      createdAt: now,
      updatedAt: now
    };
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

  completeTrip(items) {
    const kept = [];
    for (const it of items) {
      if (!(it.onList && it.checked)) { kept.push(it); continue; }
      if (!it.tracked) continue; // bought one-off: gone
      kept.push(Store.update(it, {
        stock: it.stock + it.listQty,
        onList: false, checked: false, listQty: 1
      }));
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
  }
};
