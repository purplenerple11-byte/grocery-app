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
  }
};
