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

function renderSheet() { /* implemented in the inventory task */ }

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

async function boot() {
  await DB.init();
  if (!DB.persistent) showBanner("Changes won't be saved in this session.");
  state.items = await DB.getAll();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
}
boot();
