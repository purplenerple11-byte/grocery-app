/* UI layer. All data changes go through Store pure functions, then commit()/removeItems() persist. */
const state = { items: [] };

const CATEGORY_ORDER = ['Produce', 'Dairy', 'Meat', 'Frozen', 'Pantry', 'Household', 'Other'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function groupByCategory(items) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category).push(it);
  }
  const rank = (c) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

function formatPrice(n) {
  return `$${n.toFixed(2)}`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function showBanner(msg) {
  document.getElementById('banner-text').textContent = msg;
  document.getElementById('banner').hidden = false;
}

function findItem(el) {
  const id = el.closest('[data-id]').dataset.id;
  return state.items.find((x) => x.id === id);
}

async function commit(item) {
  const i = state.items.findIndex((x) => x.id === item.id);
  if (i >= 0) state.items[i] = item; else state.items.push(item);
  render();
  try {
    await DB.put(item);
  } catch (e) {
    try { await DB.put(item); } // spec: retry once, then surface
    catch (e2) { showBanner('Save failed — changes may not persist.'); }
  }
}

async function removeItems(ids) {
  const gone = new Set(ids);
  state.items = state.items.filter((x) => !gone.has(x.id));
  render();
  try { for (const id of ids) await DB.delete(id); } catch (e) { showBanner('Save failed — changes may not persist.'); }
}

function renderList() {
  const listEl = document.getElementById('list');
  const onList = state.items.filter((it) => it.onList);
  const checkedCount = onList.filter((it) => it.checked).length;
  document.getElementById('list-sub').textContent =
    onList.length ? `${onList.length} item${onList.length === 1 ? '' : 's'} · ${checkedCount} checked` : '';
  document.getElementById('complete-trip').hidden = checkedCount === 0;

  listEl.innerHTML = groupByCategory(onList).map(([cat, items]) => `
    <div class="cat">${escapeHtml(cat)}</div>
    ${items.map((it) => `
      <div class="row${it.checked ? ' done' : ''}" data-id="${it.id}">
        <button class="check" data-action="check" aria-label="Check off">✓</button>
        <span class="name">${escapeHtml(it.name)}</span>
        ${it.unit ? `<span class="unit">${escapeHtml(it.unit)}</span>` : ''}
        ${it.tracked ? '' : '<button class="track-btn" data-action="track">track</button>'}
        <span class="stepper">
          <button class="step-btn" data-action="qty-minus" aria-label="Less">−</button>
          <span class="qty">${it.listQty}</span>
          <button class="step-btn" data-action="qty-plus" aria-label="More">＋</button>
        </span>
      </div>`).join('')}`).join('')
    || '<div class="cat" style="margin-top:30px;text-align:center">Nothing on the list</div>';
}

function renderSheet() {
  const tracked = state.items.filter((it) => it.tracked);
  const { out, low } = Store.outLowCounts(state.items);
  document.getElementById('peek-pills').innerHTML =
    (out ? `<span class="pill"><span class="dot out"></span>${out} out</span>` : '') +
    (low ? `<span class="pill"><span class="dot low"></span>${low} low</span>` : '');
  document.getElementById('inv-add').hidden = !document.getElementById('sheet').classList.contains('open');

  document.getElementById('inv-grid').innerHTML = groupByCategory(tracked).map(([cat, items]) => `
    <div class="inv-cat">${escapeHtml(cat)}</div>
    <div class="tile-grid">
      ${items.map((it) => {
        const status = Store.deriveStatus(it);
        const last = Store.lastPrice(it);
        return `
        <div class="tile" data-id="${it.id}" data-action="toggle" role="button" tabindex="0">
          <span class="name">${escapeHtml(it.name)}</span>
          <span class="bottom">
            <span class="meta">
              <span class="dot ${status === 'stocked' ? 'ok' : status}"></span>
              <button class="step-btn stock-step" data-action="stock-minus" aria-label="Less stock">−</button>
              <button class="count" data-action="count">${it.stock}</button>
              <button class="step-btn stock-step" data-action="stock-plus" aria-label="More stock">＋</button>
            </span>
            ${last ? `<span class="price">${escapeHtml(formatPrice(last.price))}</span>` : ''}
          </span>
          ${it.onList ? '<span class="ribbon">✓</span>' : ''}
        </div>`;
      }).join('')}
    </div>`).join('')
    || '<div class="cat" style="margin-top:20px;text-align:center">No tracked items yet</div>';
}

function render() { renderList(); renderSheet(); }

document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('add-input');
  const name = input.value.trim();
  if (!name) return;
  commit(Store.createItem(name, { onList: true }));
  input.value = '';
});

document.getElementById('banner-dismiss').addEventListener('click', () => {
  document.getElementById('banner').hidden = true;
});

document.getElementById('list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const item = findItem(btn);
  switch (btn.dataset.action) {
    case 'check': commit(Store.setChecked(item, !item.checked)); break;
    case 'qty-minus': commit(Store.adjustListQty(item, -1)); break;
    case 'qty-plus': commit(Store.adjustListQty(item, 1)); break;
    case 'track': commit(Store.update(item, { tracked: true })); break;
  }
});

/* Completing a trip opens the price-capture dialog; finishing it there is what
   actually restocks. Only tracked items keep history, so only they get a row. */
document.getElementById('complete-trip').addEventListener('click', () => {
  const bought = state.items.filter((it) => it.onList && it.checked && it.tracked);
  document.getElementById('store-names').innerHTML =
    Store.storeNames(state.items).map((s) => `<option value="${escapeHtml(s)}">`).join('');
  const form = document.getElementById('trip-form');
  form.elements.store.value = '';
  document.getElementById('trip-prices').innerHTML = bought.map((it) => `
    <div class="trip-row">
      <span class="trip-name">${escapeHtml(it.name)}</span>
      ${it.listQty > 1 ? `<span class="trip-qty">×${it.listQty}</span>` : ''}
      <input type="text" inputmode="decimal" placeholder="$" data-price-for="${it.id}" aria-label="Price for ${escapeHtml(it.name)}">
    </div>`).join('');
  document.getElementById('trip-dialog').showModal();
});

document.getElementById('trip-cancel').addEventListener('click', () => {
  document.getElementById('trip-dialog').close();
});

document.getElementById('trip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prices = {};
  for (const input of document.querySelectorAll('#trip-prices input[data-price-for]')) {
    const raw = input.value.trim();
    if (!raw) continue; // blank = skip, per design
    const value = Store.normalizePrice(raw);
    if (value !== null) prices[input.dataset.priceFor] = value;
  }
  state.items = Store.completeTrip(state.items, { store: e.target.elements.store.value, prices });
  render();
  document.getElementById('trip-dialog').close();
  try { await DB.replaceAll(state.items); } catch (err) { showBanner('Save failed — changes may not persist.'); }
});

/* sheet open/close: tap the bar, or swipe it up/down */
(() => {
  const sheet = document.getElementById('sheet');
  const bar = document.getElementById('sheet-bar');
  let startY = null, dragged = false;
  bar.addEventListener('pointerdown', (e) => { startY = e.clientY; dragged = false; });
  bar.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (dy < -30) { sheet.classList.add('open'); startY = null; dragged = true; renderSheet(); }
    else if (dy > 30) { sheet.classList.remove('open'); startY = null; dragged = true; renderSheet(); }
  });
  ['pointerup', 'pointercancel'].forEach((ev) => bar.addEventListener(ev, () => { startY = null; }));
  bar.addEventListener('click', () => {
    if (dragged) { dragged = false; return; } // a swipe already handled this gesture
    sheet.classList.toggle('open');
    renderSheet();
  });
})();

document.getElementById('inv-grid').addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const item = findItem(actionEl);
  const action = actionEl.dataset.action;
  if (action === 'stock-minus') { commit(Store.adjustStock(item, -1)); keepEditing(item.id); return; }
  if (action === 'stock-plus') { commit(Store.adjustStock(item, 1)); keepEditing(item.id); return; }
  if (action === 'count') {
    const tile = actionEl.closest('.tile');
    document.querySelectorAll('.tile.editing').forEach((t) => t !== tile && t.classList.remove('editing'));
    tile.classList.toggle('editing');
    return;
  }
  if (action === 'toggle') commit(Store.toggleOnList(item));
});

/* re-apply .editing after render() rebuilds the grid */
function keepEditing(id) {
  const tile = document.querySelector(`.tile[data-id="${id}"]`);
  if (tile) tile.classList.add('editing');
}

function onLongPress(container, selector, handler) {
  let timer = null, downX = 0, downY = 0;
  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(selector);
    if (!el || e.button !== 0) return;
    downX = e.clientX; downY = e.clientY;
    timer = setTimeout(() => { timer = null; handler(el); }, 500);
  });
  container.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) { clearTimeout(timer); timer = null; }
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    container.addEventListener(ev, () => { clearTimeout(timer); timer = null; });
  }
}

let dialogItemId = null; // null = creating a new item

function openItemDialog(item) {
  dialogItemId = item ? item.id : null;
  const form = document.getElementById('item-form');
  document.getElementById('item-dialog-title').textContent = item ? 'Edit item' : 'New inventory item';
  form.elements.name.value = item ? item.name : '';
  form.elements.category.value = item && CATEGORY_ORDER.includes(item.category) ? item.category : 'Other';
  form.elements.unit.value = item ? item.unit : '';
  form.elements.tracked.checked = item ? item.tracked : true;
  form.elements.stock.value = item ? item.stock : 0;
  form.elements.lowAt.value = item ? item.lowAt : 1;
  document.getElementById('item-delete').hidden = !item;
  document.getElementById('price-history').innerHTML =
    item && item.prices.length
      ? `<div class="hist-label">Price history</div>` + item.prices.slice(0, 5).map((p) => `
          <div class="hist-row">
            <span class="hist-price">${escapeHtml(formatPrice(p.price))}</span>
            <span>${escapeHtml(p.store || '—')}</span>
            <span class="hist-date">${escapeHtml(formatDate(p.at))}</span>
          </div>`).join('')
      : '';
  document.getElementById('item-dialog').showModal();
}

document.getElementById('item-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const fields = {
    name: f.name.value.trim(),
    category: f.category.value,
    unit: f.unit.value.trim(),
    tracked: f.tracked.checked,
    stock: Math.max(0, parseInt(f.stock.value, 10) || 0),
    lowAt: Math.max(0, parseInt(f.lowAt.value, 10) || 0)
  };
  if (!fields.name) return;
  const existing = state.items.find((x) => x.id === dialogItemId);
  commit(existing ? Store.update(existing, fields) : Store.createItem(fields.name, fields));
  document.getElementById('item-dialog').close();
});

document.getElementById('item-delete').addEventListener('click', () => {
  if (dialogItemId) removeItems([dialogItemId]);
  document.getElementById('item-dialog').close();
});
document.getElementById('item-cancel').addEventListener('click', () => {
  document.getElementById('item-dialog').close();
});

onLongPress(document.getElementById('list'), '.row', (el) => openItemDialog(findItem(el)));
onLongPress(document.getElementById('inv-grid'), '.tile', (el) => openItemDialog(findItem(el)));
document.getElementById('inv-add').addEventListener('click', () => openItemDialog(null));

document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('settings-dialog').showModal();
});
document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-dialog').close();
});

document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([Store.serialize(state.items)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grocery-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
});

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { showBanner('Import failed: not valid JSON.'); return; }
  if (!Store.validateImport(data)) { showBanner('Import failed: unrecognized file format.'); return; }
  const items = Store.normalizeImport(data.items); // v1 backups predate price history
  try {
    await DB.replaceAll(items);
  } catch (err) {
    showBanner('Import failed — data unchanged.');
    return;
  }
  state.items = items;
  render();
  document.getElementById('settings-dialog').close();
});

async function boot() {
  await DB.init();
  if (!DB.persistent) showBanner("Changes won't be saved in this session.");
  // Items stored before price history existed have no prices array.
  state.items = Store.normalizeImport(await DB.getAll());
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
}
boot();
