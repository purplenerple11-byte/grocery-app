/* UI layer. All data changes go through Store pure functions, then commit()/removeItems() persist. */
const state = { items: [], meals: [] };

// Uses the global CATEGORY_ORDER declared in store.js

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

let renderTimer = null;
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    render();
  }, 1500);
}
function cancelScheduledRender() {
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

async function commit(item, { deferRender = false } = {}) {
  const i = state.items.findIndex((x) => x.id === item.id);
  if (i >= 0) state.items[i] = item; else state.items.push(item);
  
  if (deferRender) {
    scheduleRender();
  } else {
    cancelScheduledRender();
    render();
  }
  
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
  const pruned = Store.pruneMeals(state.meals, state.items);
  const mealsChanged = pruned.some((m, i) => m !== state.meals[i]);
  state.meals = pruned;
  cancelScheduledRender();
  render();
  try { for (const id of ids) await DB.delete(id); } catch (e) { showBanner('Save failed — changes may not persist.'); }
  if (mealsChanged) await saveMeals();
}

function renderList() {
  const listEl = document.getElementById('list');
  const onList = state.items.filter((it) => it.onList);
  const checkedCount = onList.filter((it) => it.checked).length;
  document.getElementById('list-sub').textContent =
    onList.length ? `${onList.length} item${onList.length === 1 ? '' : 's'} · ${checkedCount} checked` : '';
  document.getElementById('complete-trip').hidden = checkedCount === 0;

  listEl.innerHTML = Store.groupByCategory(onList).map(([cat, items]) => `
    <div class="cat">${escapeHtml(cat)}</div>
    ${items.map((it) => `
      <div class="row${it.checked ? ' done' : ''}${Store.hasEnough(it) ? ' have' : ''}" data-id="${it.id}">
        <button class="check" data-action="check" aria-label="Check off">✓</button>
        <span class="name">${escapeHtml(it.name)}</span>
        ${Store.hasEnough(it) ? `<span class="have-note">have ${it.stock}</span>` : ''}
        ${it.tracked ? '' : '<button class="track-btn" data-action="track">track</button>'}
        ${it.unit ? `<span class="unit">${escapeHtml(it.unit)}</span>` : ''}
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

  const stockedFirst = { secondary: (it) => (it.stock > 0 ? 0 : 1) };
  document.getElementById('inv-grid').innerHTML = Store.groupByCategory(tracked, stockedFirst).map(([cat, items]) => `
    <div class="inv-cat${typeof collapsedCats !== 'undefined' && collapsedCats.has(cat) ? ' collapsed' : ''}">${escapeHtml(cat)}</div>
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

function renderMeals() {
  document.getElementById('meal-save').disabled = !state.items.some((it) => it.onList);
  const el = document.getElementById('meals-list');
  if (!state.meals.length) {
    el.innerHTML = '<div class="drawer-empty">No meals yet. Put a meal’s items on your list, then tap <strong>＋ Save list</strong> to keep it.</div>';
    return;
  }
  el.innerHTML = state.meals.map((m) => {
    const summary = Store.mealSummary(m, state.items);
    return `
      <button class="meal" data-meal-id="${m.id}">
        <span class="meal-name">${escapeHtml(m.name)}</span>
        <span class="meal-items">${escapeHtml(summary || 'no items')}</span>
      </button>`;
  }).join('');
}

function render() { renderList(); renderSheet(); renderMeals(); }

async function saveMeals() {
  try {
    await DB.putSetting('meals', state.meals);
  } catch (e) {
    showBanner('Save failed — meals may not persist.');
  }
}

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
  if (action === 'stock-minus' || action === 'stock-plus') {
    const nextItem = Store.adjustStock(item, action === 'stock-plus' ? 1 : -1);
    commit(nextItem, { deferRender: true });
    
    // Immediate visual update of count and status dot
    actionEl.parentElement.querySelector('.count').textContent = nextItem.stock;
    const dot = actionEl.parentElement.querySelector('.dot');
    const status = Store.deriveStatus(nextItem);
    dot.className = `dot ${status === 'stocked' ? 'ok' : status}`;
    
    keepEditing(nextItem.id);
    return;
  }
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

/* Fires on release, not off the timer. Opening a dialog while the finger is
   still down puts its inputs under a live touch, and WebKit's selection gesture
   hit-tests when it recognizes (~500ms) rather than at touchstart — so it lands
   on the dialog and raises the Copy/Paste callout. At 500ms we only arm; the
   handler runs on pointerup, once nothing is under the finger any more. */
function onLongPress(container, selector, handler) {
  let timer = null, armed = null, swallowClick = false, downX = 0, downY = 0;
  const reset = () => {
    clearTimeout(timer); timer = null;
    if (armed) armed.classList.remove('pressing');
    armed = null;
  };
  container.addEventListener('pointerdown', (e) => {
    /* Clear first, unconditionally: the click we meant to swallow may never
       arrive (see the click listener), and a stale flag would eat this tap. */
    swallowClick = false;
    const el = e.target.closest(selector);
    if (!el || e.button !== 0) return;
    reset();
    downX = e.clientX; downY = e.clientY;
    timer = setTimeout(() => { timer = null; armed = el; el.classList.add('pressing'); }, 500);
  });
  container.addEventListener('pointermove', (e) => {
    if ((timer || armed) && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) reset();
  });
  container.addEventListener('pointerup', () => {
    const el = armed;
    reset();
    if (!el) return;
    swallowClick = true; // the press already handled this gesture; see #sheet-bar's `dragged`
    handler(el);
  });
  for (const ev of ['pointercancel', 'pointerleave']) container.addEventListener(ev, reset);
  /* Firing on pointerup means the browser may still deliver a click afterwards,
     which would hit the row/tile delegation below and toggle the item. When the
     handler opens a modal the click is retargeted to the <dialog> by its
     backdrop and never lands here at all — hence the reset in pointerdown, which
     is what actually bounds this flag's lifetime. */
  container.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation(); e.preventDefault();
  }, true);
}

/* Swipe-to-remove on shopping list rows — bidirectional, floaty, with fling */
(() => {
  const listEl = document.getElementById('list');
  let startX = null, startY = null, swipingRow = null, isSwiping = false;
  let lastX = 0, lastTime = 0, velocity = 0;
  const THRESHOLD = 90;       // px: past this the row is dismissed on release
  const FLING_VEL = 0.6;      // px/ms: velocity that counts as a fling

  listEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const row = e.target.closest('.row');
    if (!row || e.target.closest('button, .stepper')) return;
    startX = e.clientX;
    startY = e.clientY;
    lastX = startX;
    lastTime = Date.now();
    velocity = 0;
    swipingRow = row;
    isSwiping = false;
    swipingRow.style.transition = 'none';
  });

  listEl.addEventListener('pointermove', (e) => {
    if (!swipingRow || startX === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Lock into horizontal swipe once intent is clear
    if (!isSwiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      isSwiping = true;
      swipingRow.classList.add('swiping');
      try { swipingRow.setPointerCapture(e.pointerId); } catch(err) {}
    }

    if (isSwiping) {
      // Track velocity for fling detection
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) velocity = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastTime = now;

      // Allow both directions; slight scale up to look "lifted"
      const progress = Math.min(Math.abs(dx) / THRESHOLD, 1);
      const scale = 1 + progress * 0.02;
      swipingRow.style.transform = `translateX(${dx}px) scale(${scale})`;
      e.preventDefault();
    }
  });

  const endSwipe = (e) => {
    if (!swipingRow) return;
    const dx = startX !== null ? e.clientX - startX : 0;
    const row = swipingRow;
    swipingRow = null;
    startX = null;

    if (isSwiping) {
      const absVel = Math.abs(velocity);
      const flung = absVel > FLING_VEL;
      const pastThreshold = Math.abs(dx) > THRESHOLD;
      const dismiss = flung || pastThreshold;
      const direction = (flung ? Math.sign(velocity) : Math.sign(dx)) || -1;

      row.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
      row.classList.remove('swiping');

      if (dismiss) {
        row.style.transform = `translateX(${direction * 110}%)`;
        row.style.opacity = '0';
        const item = findItem(row);
        if (item) {
          setTimeout(() => commit(Store.update(item, { onList: false, checked: false, listQty: 1 })), 250);
        }
      } else {
        // Snap back
        row.style.transform = '';
        row.style.opacity = '';
      }
    }
  };

  listEl.addEventListener('pointerup', endSwipe);
  listEl.addEventListener('pointercancel', endSwipe);
  listEl.addEventListener('click', (e) => {
    if (isSwiping) {
      e.stopPropagation(); e.preventDefault();
      isSwiping = false;
    }
  }, true);
})();

/* Collapsible inventory categories */
const collapsedCats = new Set();

document.getElementById('inv-grid').addEventListener('click', (e) => {
  const catEl = e.target.closest('.inv-cat');
  if (catEl) {
    const catName = catEl.textContent.replace(/\s*▾\s*$/, '').trim();
    if (collapsedCats.has(catName)) {
      collapsedCats.delete(catName);
      catEl.classList.remove('collapsed');
    } else {
      collapsedCats.add(catName);
      catEl.classList.add('collapsed');
    }
    return;
  }
  // Existing tile actions handled below
});

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

/* ---- Meals drawer ---- */
function setDrawer(open) {
  document.getElementById('meals-drawer').classList.toggle('open', open);
  document.getElementById('meals-drawer').setAttribute('aria-hidden', String(!open));
  document.getElementById('meals-tab').setAttribute('aria-expanded', String(open));
  document.getElementById('meals-scrim').hidden = !open;
  if (open) renderMeals();
}
document.getElementById('meals-tab').addEventListener('click', () => setDrawer(true));
document.getElementById('meals-scrim').addEventListener('click', () => setDrawer(false));

/* Tap a meal: everything in it goes on the list — you prune, we don't guess.
   The banner names how many you're actually short on. */
document.getElementById('meals-list').addEventListener('click', (e) => {
  const el = e.target.closest('.meal');
  if (!el) return;
  const meal = state.meals.find((m) => m.id === el.dataset.mealId);
  if (!meal) return;
  const { total, short } = Store.mealAddStats(meal, state.items);
  if (!total) { showBanner(`${meal.name}: its items are all gone.`); return; }
  state.items = Store.addMealToList(state.items, meal);
  render();
  DB.replaceAll(state.items).catch(() => showBanner('Save failed — changes may not persist.'));
  setDrawer(false);
  showBanner(short ? `${meal.name}: ${total} added, ${short} short.` : `${meal.name}: ${total} added — you have it all.`);
});

let dialogMealId = null; // null = saving the current list as a new meal

function openMealDialog(meal) {
  dialogMealId = meal ? meal.id : null;
  const form = document.getElementById('meal-form');
  const listed = state.items.filter((it) => it.onList);
  document.getElementById('meal-dialog-title').textContent = meal ? 'Meal' : 'Save list as meal';
  document.getElementById('meal-dialog-note').textContent = meal
    ? Store.mealSummary(meal, state.items) || 'This meal’s items no longer exist.'
    : `${listed.length} item${listed.length === 1 ? '' : 's'}: ${listed.map((it) => it.name).join(', ')}`;
  form.elements.name.value = meal ? meal.name : '';
  document.getElementById('meal-delete').hidden = !meal;
  document.getElementById('meal-dialog').showModal();
}

document.getElementById('meal-save').addEventListener('click', () => openMealDialog(null));
onLongPress(document.getElementById('meals-list'), '.meal', (el) => {
  const meal = state.meals.find((m) => m.id === el.dataset.mealId);
  if (meal) openMealDialog(meal);
});

document.getElementById('meal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  if (!name) return;
  const existing = state.meals.find((m) => m.id === dialogMealId);
  if (existing) {
    state.meals = state.meals.map((m) => (m.id === existing.id ? Store.updateMeal(m, { name }) : m));
  } else {
    /* Snapshot of what's on the list right now — including things already
       checked into the basket, which are still part of the meal. */
    state.meals = [...state.meals, Store.createMeal(name, state.items.filter((it) => it.onList).map((it) => it.id))];
  }
  document.getElementById('meal-dialog').close();
  renderMeals();
  await saveMeals();
});

document.getElementById('meal-delete').addEventListener('click', async () => {
  state.meals = state.meals.filter((m) => m.id !== dialogMealId);
  document.getElementById('meal-dialog').close();
  renderMeals();
  await saveMeals();
});
document.getElementById('meal-cancel').addEventListener('click', () => {
  document.getElementById('meal-dialog').close();
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
  const blob = new Blob([Store.serialize(state.items, state.meals)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grocery-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
});

/* Restore: strict, replaces everything. Destructive, so it confirms first. */
document.getElementById('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { showBanner('Restore failed: not valid JSON.'); return; }
  if (!Store.validateImport(data)) { showBanner('Restore failed: unrecognized file format.'); return; }
  if (!confirm('Restore replaces everything currently in the app with this backup. Continue?')) return;
  const items = Store.normalizeImport(data.items); // v1 backups predate price history
  const meals = Store.normalizeImportMeals(data.meals, items); // v1 backups predate meals
  try {
    await DB.replaceAllWithMeals(items, meals); // atomic: both stores or neither
  } catch (err) {
    showBanner('Restore failed — data unchanged.');
    return;
  }
  state.items = items;
  state.meals = meals;
  render();
  document.getElementById('settings-dialog').close();
});

/* Add: lenient merge, never deletes. This is the AI-additive path — matched
   items update, new items append. See Store.mergeImport. */
document.getElementById('merge-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { showBanner('Add failed: not valid JSON.'); return; }
  if (!Store.validateMergeImport(data)) { showBanner('Add failed: expected an object with an items list.'); return; }
  const { items, meals, stats } = Store.mergeImport(state.items, state.meals, data);
  try {
    await DB.replaceAllWithMeals(items, meals); // atomic: both stores or neither
  } catch (err) {
    showBanner('Add failed — data unchanged.');
    return;
  }
  state.items = items;
  state.meals = meals;
  render();
  document.getElementById('settings-dialog').close();
  const parts = [`Added ${stats.added}`, `updated ${stats.updated}`];
  if (stats.skipped) parts.push(`skipped ${stats.skipped}`);
  showBanner(parts.join(', ') + '.');
});

async function boot() {
  await DB.init();
  if (!DB.persistent) showBanner("Changes won't be saved in this session.");
  // Items stored before price history existed have no prices array.
  state.items = Store.normalizeImport(await DB.getAll());
  // Meals arrived in V3; older databases simply have no `meals` setting.
  state.meals = Store.pruneMeals(await DB.getSetting('meals', []), state.items);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
}
boot();
