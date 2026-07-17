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

document.getElementById('complete-trip').addEventListener('click', async () => {
  state.items = Store.completeTrip(state.items);
  render();
  try { await DB.replaceAll(state.items); } catch (e) { showBanner('Save failed — changes may not persist.'); }
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

async function boot() {
  await DB.init();
  if (!DB.persistent) showBanner("Changes won't be saved in this session.");
  state.items = await DB.getAll();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
}
boot();
