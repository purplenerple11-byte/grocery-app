/* UI layer. All data changes go through Store pure functions, then commit()/removeItems() persist. */
const state = { items: [], meals: [], displayName: '', notesLastSeen: null };

function currentCreatorName() {
  if (state.displayName) return state.displayName;
  if (typeof Sync !== 'undefined' && Sync.email) return Sync.email.split('@')[0];
  return '';
}

function getAttributionSeenMap() {
  try { return JSON.parse(localStorage.getItem('grocery_attr_seen') || '{}'); }
  catch (e) { return {}; }
}
function setAttributionSeenMap(map) {
  try { localStorage.setItem('grocery_attr_seen', JSON.stringify(map)); }
  catch (e) {}
}

function getAttributionState(item) {
  if (!item.addedBy) return null;
  const map = getAttributionSeenMap();
  const now = Date.now();
  if (!map[item.id]) {
    map[item.id] = now;
    setAttributionSeenMap(map);
  }
  const age = now - map[item.id];
  if (age >= 32000) return null;
  return {
    name: item.addedBy,
    isFading: age >= 29000
  };
}

const attrTimers = new Map();
function scheduleAttributionFadeouts() {
  attrTimers.forEach((t) => clearTimeout(t));
  attrTimers.clear();
  const map = getAttributionSeenMap();
  const now = Date.now();
  document.querySelectorAll('#list .added-by').forEach((el) => {
    const id = el.dataset.attrId;
    if (!id) return;
    const seenAt = map[id] || now;
    const age = now - seenAt;
    const remFade = Math.max(0, 30000 - age);
    const t = setTimeout(() => {
      el.classList.add('faded');
      setTimeout(() => { el.style.display = 'none'; }, 1500);
    }, remFade);
    attrTimers.set(id, t);
  });
}

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
    drainSnapshot();
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
    scheduleSync();
  } catch (e) {
    try { await DB.put(item); scheduleSync(); } // spec: retry once, then surface
    catch (e2) { showBanner('Save failed — changes may not persist.'); }
  }
}

/* A delete is a write, not an erasure. The record stays in storage as a
   tombstone so the removal can propagate to other devices, while `state` —
   which never holds tombstones — simply drops it.

   Meals are deliberately NOT pruned here any more. Pruning rewrote every meal
   against the local item set and persisted the result; once items can arrive
   from elsewhere, that turns a not-yet-synced item into permanent meal damage.
   Nothing needs the prune: mealItems, mealSummary, and addMealToList all
   ignore ids with no surviving item. */
async function removeItems(ids) {
  const gone = new Set(ids);
  const tombstones = state.items.filter((x) => gone.has(x.id)).map(Store.softDelete);
  state.items = state.items.filter((x) => !gone.has(x.id));
  cancelScheduledRender();
  render();
  try {
    for (const t of tombstones) await DB.put(t);
    scheduleSync();
  } catch (e) {
    showBanner('Save failed — changes may not persist.');
  }
}

/* Bulk counterpart to commit(). Every wholesale mutation routes through here
   instead of reaching for DB directly, so there is exactly one place where a
   bulk change can be observed — which is what lets sync hook in later without
   hunting down four scattered call sites.

   Items that vanish from the working set (a one-off bought on a trip, say) are
   tombstoned rather than dropped, for the same reason removeItems tombstones.
   `replace: true` is the restore path: it genuinely wipes everything, including
   tombstones, because the backup is being declared the new truth. */
async function commitAll(items, meals, { replace = false } = {}) {
  const vanished = new Map(state.items.map((i) => [i.id, i]));
  for (const it of items) vanished.delete(it.id);
  const tombstones = replace ? [] : [...vanished.values()].map(Store.softDelete);

  state.items = items;
  if (meals) state.meals = meals;
  cancelScheduledRender();
  render();

  try {
    const written = [...items, ...tombstones];
    if (replace) await DB.replaceAllWithMeals(items, state.meals);
    else await DB.replaceLiveWithMeals(written, state.meals);
    // Bulk writes bypass DB.put, so they have to mark their own records dirty.
    await DB.enqueueMany([
      ...written.map((i) => ({ kind: 'item', id: i.id })),
      ...state.meals.map((m) => ({ kind: 'meal', id: m.id }))
    ]);
    scheduleSync();
    return true;
  } catch (e) {
    return false;
  }
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
        <span class="name">
          ${escapeHtml(it.name)}${(() => {
            const attr = getAttributionState(it);
            return attr ? ` <em class="added-by${attr.isFading ? ' faded' : ''}" data-attr-id="${it.id}">by ${escapeHtml(attr.name)}</em>` : '';
          })()}
        </span>
        ${Store.hasEnough(it) ? `<span class="have-note">have ${it.stock}</span>` : ''}
        ${it.tracked ? '' : '<button class="track-btn" data-action="track">track</button>'}
        ${it.unit ? `<span class="unit">${escapeHtml(it.unit)}</span>` : ''}
        <span class="stepper">
          <button class="step-btn" data-action="qty-minus" aria-label="Less">−</button>
          <span class="qty">${it.listQty}</span>
          <button class="step-btn" data-action="qty-plus" aria-label="More">＋</button>
        </span>
      </div>`).join('')}`).join('')
    || `<div class="empty">Nothing on the list
          <span class="empty-hint">Add an item above, or open Inventory and tap what you're out of.</span>
        </div>`;
  scheduleAttributionFadeouts();
}

function renderSheet() {
  const tracked = state.items.filter((it) => it.tracked);
  const { out, low } = Store.outLowCounts(state.items);
  document.getElementById('peek-pills').innerHTML =
    (out ? `<span class="pill"><span class="dot out"></span>${out} out</span>` : '') +
    (low ? `<span class="pill"><span class="dot low"></span>${low} low</span>` : '');
  /* The collapsed sheet clips its grid with overflow:hidden, but clipped is not
     unfocusable — 9 tiles and 27 step buttons stayed in the tab order behind a
     64px bar. `inert` takes the whole grid out until the sheet is open. The bar
     itself stays live; it's the control that opens the thing. */
  const sheetOpen = document.getElementById('sheet').classList.contains('open');
  document.getElementById('inv-add').hidden = !sheetOpen;
  document.getElementById('sheet-content').inert = !sheetOpen;

  const stockedFirst = { secondary: (it) => (it.stock > 0 ? 0 : 1) };
  document.getElementById('inv-grid').innerHTML = Store.groupByCategory(tracked, stockedFirst).map(([cat, items]) => `
    <div class="inv-cat${typeof collapsedCats !== 'undefined' && collapsedCats.has(cat) ? ' collapsed' : ''}">${escapeHtml(cat)}</div>
    <div class="tile-grid">
      ${items.map((it) => {
        const status = Store.deriveStatus(it);
        const last = Store.lastPrice(it);
        return `
        <div class="tile${it.onList ? ' on-list' : ''}" data-id="${it.id}" data-action="toggle" role="button" tabindex="0">
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
    || `<div class="empty">No tracked items yet
          <span class="empty-hint">Tap ＋ Add to start tracking something you keep at home.</span>
        </div>`;
}

/* Lives outside renderMeals because renderMeals is called from render() on
   every state change, and a filter you typed must survive saving a meal. */
let mealQuery = '';

function renderMeals() {
  document.getElementById('meal-save').disabled = !state.items.some((it) => it.onList);
  const el = document.getElementById('meals-list');
  /* Nothing to search when there are no meals: the empty state is the whole
     drawer, and a search field above it would be furniture. */
  document.getElementById('meal-search-row').hidden = !state.meals.length;
  if (!state.meals.length) {
    el.innerHTML = '<div class="drawer-empty">No meals yet. Put a meal’s items on your list, then tap <strong>＋ Save list</strong> to keep it.</div>';
    return;
  }
  const matches = Store.searchMeals(state.meals, state.items, mealQuery);
  if (!matches.length) {
    el.innerHTML = `<div class="drawer-empty">No meals match “${escapeHtml(mealQuery.trim())}”.</div>`;
    return;
  }
  el.innerHTML = matches.map((m) => {
    const summary = Store.mealSummary(m, state.items);
    return `
      <button class="meal" data-meal-id="${m.id}">
        <span class="meal-name">${escapeHtml(m.name)}</span>
        <span class="meal-items">${escapeHtml(summary || 'no items')}</span>
      </button>`;
  }).join('');
}

function render() { renderList(); renderSheet(); renderMeals(); keepEditing(); }

/* Meals persist locally as one blob but sync as individual rows, so the blob
   write is paired with a per-meal outbox entry. `ids` narrows that to the
   meals that actually changed; omitting it marks them all, which is
   harmless — the outbox coalesces and the upsert is idempotent. */
async function saveMeals(ids, tombstone = null) {
  try {
    // `state.meals` holds only live meals, but the stored blob has to keep
    // tombstones or a deleted meal is simply absent — and absence is exactly
    // what a pull would treat as "the other device has one I'm missing", so
    // the meal would come straight back.
    const stored = await DB.getSetting('meals', []);
    const liveIds = new Set(state.meals.map((m) => m.id));
    const keptTombstones = stored.filter((m) =>
      m.deletedAt && !liveIds.has(m.id) && (!tombstone || m.id !== tombstone.id));
    const all = [...keptTombstones, ...(tombstone ? [tombstone] : []), ...state.meals];
    await DB.putSetting('meals', all);
    await DB.enqueueMany((ids || all.map((m) => m.id)).map((id) => ({ kind: 'meal', id })));
    scheduleSync();
  } catch (e) {
    showBanner('Save failed — meals may not persist.');
  }
}

/* ── Intelligent auto-complete for the add-item input ── */
(() => {
  const addInput = document.getElementById('add-input');
  if (!addInput) return; // defensive

  // Grab or create the dropdown list element
  let listEl = document.getElementById('autocomplete-list');
  if (!listEl) {
    listEl = document.createElement('div');
    listEl.id = 'autocomplete-list';
    listEl.className = 'autocomplete-items';
    listEl.hidden = true;
    // Insert right after the input
    addInput.insertAdjacentElement('afterend', listEl);
    // Ensure parent acts as positioning anchor
    if (addInput.parentElement) addInput.parentElement.style.position = 'relative';
  }

  function hideList() { listEl.hidden = true; }

  addInput.addEventListener('input', () => {
    const val = addInput.value.trim().toLowerCase();
    if (!val) { hideList(); return; }
    const matches = state.items.filter(it => it.name.toLowerCase().includes(val));
    if (!matches.length) { hideList(); return; }
    listEl.innerHTML = matches.map(it => `
      <div class="autocomplete-item" data-id="${it.id}">
        <span class="autocomplete-name">${escapeHtml(it.name)}</span>
        ${it.tracked ? `<span class="autocomplete-stock">Stock: ${it.stock}</span>` : ''}
      </div>
    `).join('');
    listEl.hidden = false;
  });

  // Close dropdown when tapping anywhere else
  document.addEventListener('pointerdown', (e) => {
    if (e.target !== addInput && !listEl.contains(e.target)) hideList();
  });

  listEl.addEventListener('click', (e) => {
    const el = e.target.closest('.autocomplete-item');
    if (!el) return;
    const item = state.items.find(it => it.id === el.dataset.id);
    if (item) {
      commit(Store.update(item, { onList: true, checked: false, addedBy: currentCreatorName() }));
      addInput.value = '';
      hideList();
    }
  });

  document.getElementById('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = addInput.value.trim();
    if (!name) return;

    // Exact-match → re-add existing item; else create new
    const existing = state.items.find(it => it.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      commit(Store.update(existing, { onList: true, checked: false, addedBy: currentCreatorName() }));
    } else {
      commit(Store.createItem(name, { onList: true, addedBy: currentCreatorName() }));
    }

    addInput.value = '';
    hideList();
  });
})();

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
/* Completing a trip is the largest-blast-radius write in the app and it is not
   idempotent: it adds listQty to stock for every checked item at once. If two
   members both tap it, both devices restock and last-write-wins silently keeps
   one — so the household is either double-stocked or missing a restock, across
   the whole list.

   Pulling first is most of the fix: whoever finishes second sees an already
   emptied list and has nothing to complete. The banner covers the rest, where
   the other trip landed too recently for the list to have caught up. */
document.getElementById('complete-trip').addEventListener('click', async () => {
  if (typeof Sync !== 'undefined' && Sync.enabled) {
    await Sync.sync();
    const recent = await Sync.recentTripByOther();
    if (recent) {
      showBanner('Someone else just completed a trip. Check the list before restocking again.');
      render();
      return;
    }
    if (!state.items.some((it) => it.onList && it.checked)) {
      showBanner('That trip was already completed on another device.');
      render();
      return;
    }
  }
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
  openModal(document.getElementById('trip-dialog'));
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
  const restocked = Store.completeTrip(state.items, { store: e.target.elements.store.value, prices });
  document.getElementById('trip-dialog').close();
  // completeTrip drops bought one-offs entirely; commitAll tombstones them.
  if (!await commitAll(restocked)) showBanner('Save failed — changes may not persist.');
  if (typeof Sync !== 'undefined' && Sync.enabled) Sync.recordTrip();
});

/* ── Physical 1:1 vertical drag & fling for the inventory sheet ── */
(() => {
  const sheet = document.getElementById('sheet');
  const bar = document.getElementById('sheet-bar');
  const content = document.getElementById('sheet-content');

  let active = false;
  let startY = 0;
  let startHeight = 0;
  let currentHeight = 0;
  let isDragging = false;
  let pointerId = null;

  /* velocity: ring buffer of recent pointer Y positions */
  const vBuf = [];
  const V_WINDOW = 80;
  function vTrack(y) {
    const t = performance.now();
    vBuf.push({ y, t });
    while (vBuf.length > 1 && t - vBuf[0].t > V_WINDOW) vBuf.shift();
  }
  function vGet() {
    if (vBuf.length < 2) return 0;
    const a = vBuf[0], b = vBuf[vBuf.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.y - a.y) / dt : 0;
  }

  function getClosedHeight() {
    return 64; // matching CSS #sheet height when closed
  }
  function getOpenHeight() {
    return Math.round(window.innerHeight * 0.86); // matching CSS #sheet.open height: 86vh
  }

  /* Only a gesture that STARTED on the grab bar may toggle the sheet by tapping.
     The tap branch in onPointerEnd used to fire for any pointerdown that armed
     the drag, and content arms it whenever the sheet is scrolled to the top — so
     tapping a category header collapsed the category AND closed the whole sheet.
     Tracking the origin makes that impossible for anything in the content, not
     just for the one control that happened to expose it. */
  let fromBar = false;

  function onPointerDown(e, viaBar) {
    if (e.button !== 0) return;
    // .inv-cat is a control built from a div, so it needs naming here: without
    // it, a tap on a category arms a drag it never intends to finish.
    if (e.target.closest('button, input, select, label, a, .inv-cat')) return;

    fromBar = !!viaBar;
    active = true;
    isDragging = false;
    pointerId = e.pointerId;
    startY = e.clientY;
    startHeight = sheet.offsetHeight;
    currentHeight = startHeight;
    vBuf.length = 0;
    vTrack(e.clientY);

    sheet.style.transition = 'none';
  }

  function onPointerMove(e) {
    if (!active || (pointerId !== null && e.pointerId !== pointerId)) return;
    const dy = e.clientY - startY;

    if (!isDragging && Math.abs(dy) > 4) {
      isDragging = true;
      content.inert = false;
    }

    if (!isDragging) return;

    vTrack(e.clientY);

    const closedH = getClosedHeight();
    const openH = getOpenHeight();
    let rawH = startHeight - dy;

    // Rubber banding past bounds
    if (rawH > openH) {
      const over = rawH - openH;
      rawH = openH + over * 0.3;
    } else if (rawH < closedH) {
      const under = closedH - rawH;
      rawH = closedH - under * 0.3;
    }

    currentHeight = rawH;
    sheet.style.height = `${currentHeight}px`;
  }

  function onPointerEnd(e) {
    if (!active || (pointerId !== null && e.pointerId !== pointerId)) return;
    active = false;
    pointerId = null;

    if (!isDragging) {
      // Tap, not a drag. Only the grab bar toggles the sheet — a tap that began
      // in the content belongs to whatever was tapped, not to the sheet.
      if (fromBar) setSheetState(!sheet.classList.contains('open'), true);
      else sheet.style.transition = '';   // undo the 'none' armed on pointerdown
      return;
    }

    const closedH = getClosedHeight();
    const openH = getOpenHeight();
    const vy = vGet(); // positive = moving down, negative = moving up
    const FLING_VEL = 0.35; // px/ms threshold for flick/fling

    let shouldOpen = false;

    if (vy < -FLING_VEL) {
      shouldOpen = true;
    } else if (vy > FLING_VEL) {
      shouldOpen = false;
    } else {
      const midPoint = closedH + (openH - closedH) * 0.45;
      shouldOpen = currentHeight > midPoint;
    }

    setSheetState(shouldOpen, true);
  }

  function setSheetState(open, animate = false) {
    const targetH = open ? getOpenHeight() : getClosedHeight();

    if (animate) {
      sheet.style.transition = 'height 0.32s cubic-bezier(.25, 1, .5, 1)';
      sheet.style.height = `${targetH}px`;

      let animationDone = false;
      const finish = () => {
        if (animationDone) return;
        animationDone = true;
        sheet.removeEventListener('transitionend', finish);
        sheet.style.transition = '';
        sheet.style.height = '';
        sheet.classList.toggle('open', open);
        renderSheet();
      };

      sheet.addEventListener('transitionend', finish);
      setTimeout(finish, 350);
    } else {
      sheet.style.transition = '';
      sheet.style.height = '';
      sheet.classList.toggle('open', open);
      renderSheet();
    }
  }

  bar.addEventListener('pointerdown', (e) => onPointerDown(e, true));
  content.addEventListener('pointerdown', (e) => {
    if (sheet.classList.contains('open') && content.scrollTop <= 0) {
      onPointerDown(e, false);
    }
  });

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
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
    editingTileId = tile.classList.contains('editing') ? item.id : null;
    return;
  }
  if (action === 'toggle') commit(Store.toggleOnList(item));
});

/* Which tile has its stepper open. render() rebuilds the grid wholesale, so
   without this the open stepper closes under the user's finger on any render
   they didn't cause — today only a rare race, but every sync pull triggers a
   render, so it has to survive one. */
let editingTileId = null;

/* re-apply .editing after render() rebuilds the grid */
function keepEditing(id) {
  if (id) editingTileId = id;
  const tile = document.querySelector(`.tile[data-id="${editingTileId}"]`);
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

/* ── Swipe-to-remove: hold to lift, drag to dismiss ──
   Touch → short hold (120ms) → row pops up from the surface →
   drag freely with finger → fling off or release to snap back. */
(() => {
  const listEl = document.getElementById('list');
  const HOLD_MS   = 120;   // ms before the row lifts
  const DISMISS_PX = 80;   // drag distance that counts as a dismiss
  const FLING_VEL  = 0.4;  // px/ms velocity that counts as a fling

  /* ── state ── */
  let row = null;
  let originX, originY;
  let dx = 0, dy = 0;
  let holdTimer = null;
  let lifted = false;
  let dragging = false;
  let aborted = false;

  /* velocity: ring buffer of recent pointer positions */
  const vBuf = [];
  const V_WINDOW = 80; // ms
  function vTrack(x) {
    const t = performance.now();
    vBuf.push({ x, t });
    while (vBuf.length > 1 && t - vBuf[0].t > V_WINDOW) vBuf.shift();
  }
  function vGet() {
    if (vBuf.length < 2) return 0;
    const a = vBuf[0], b = vBuf[vBuf.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.x - a.x) / dt : 0;
  }

  /* ── visuals (animations unchanged) ── */
  function liftShadow(el) {
    el.style.boxShadow = '0 6px 16px 2px rgba(0,0,0,.25)';
  }
  function dragShadow(el, absDx) {
    const t = Math.min(absDx / 140, 1);
    const blur  = 10 + t * 22;
    const spread = 1 + t * 5;
    const yOff  = 6 + t * 10;
    const alpha = 0.25 + t * 0.20;
    el.style.boxShadow = `0 ${yOff}px ${blur}px ${spread}px rgba(0,0,0,${alpha})`;
  }
  function pose(el) {
    const maxRot = 3;
    const rot = Math.max(-maxRot, Math.min(maxRot, dx * 0.018));
    el.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${rot}deg)`;
    dragShadow(el, Math.abs(dx));
  }
  function clearInline(el) {
    el.style.transform = '';
    el.style.boxShadow = '';
    el.style.transition = '';
    el.style.opacity = '';
    el.style.touchAction = '';   // restore CSS touch-action: pan-y
    el.classList.remove('lifted');
  }

  /* Full state reset — called on every pointerdown so stale flags from
     a previous gesture (especially one killed by pointercancel) can never
     leak into the next interaction. */
  function resetState() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    // If a previous row was left in a dirty state, clean it
    if (row) clearInline(row);
    row = null;
    dx = 0; dy = 0;
    lifted = false;
    dragging = false;
    aborted = false;
    vBuf.length = 0;
  }

  /* ── lift: the row pops up from the list ── */
  function liftRow() {
    if (!row || aborted) return;
    lifted = true;
    row.classList.add('lifted');
    // Lock out the browser's touch handling entirely once lifted
    row.style.touchAction = 'none';
    // Animate the pop-up
    row.style.transition = 'box-shadow 0.15s ease-out';
    liftShadow(row);
    // After the shadow settles, kill the transition so dragging is instant
    setTimeout(() => { if (row) row.style.transition = 'none'; }, 160);
  }

  /* ── pointer handlers ── */
  listEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = e.target.closest('.row');
    if (!r || e.target.closest('button, .stepper')) return;

    resetState();

    row = r;
    originX = e.clientX;
    originY = e.clientY;
    vTrack(e.clientX);

    // Start the hold timer — row lifts after HOLD_MS
    holdTimer = setTimeout(liftRow, HOLD_MS);
  });

  listEl.addEventListener('pointermove', (e) => {
    if (!row || aborted) return;
    dx = e.clientX - originX;
    dy = e.clientY - originY;
    vTrack(e.clientX);

    if (!lifted) {
      // Still waiting for the hold timer.
      if (Math.abs(dy) > 10) {
        // Vertical scroll — abort entirely
        clearTimeout(holdTimer); holdTimer = null;
        aborted = true;
        row = null;
        return;
      }
      if (Math.abs(dx) > 6) {
        // Horizontal intent — lift immediately, don't wait for timer
        clearTimeout(holdTimer); holdTimer = null;
        liftRow();
        // preventDefault now so the browser doesn't steal the gesture
        e.preventDefault();
      }
      return;
    }

    // Row is lifted — follow the finger
    dragging = true;
    try { row.setPointerCapture(e.pointerId); } catch (_) {}
    pose(row);
    e.preventDefault();
  });

  function release() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (!row) {
      // No row in progress — but make sure flags are clean
      lifted = false;
      dragging = false;
      return;
    }
    const el = row;
    row = null;

    if (!lifted) {
      clearInline(el);
      lifted = false;
      dragging = false;
      return;
    }

    const vel = vGet();
    const absVel = Math.abs(vel);
    const flung = absVel > FLING_VEL;
    const pastThreshold = Math.abs(dx) > DISMISS_PX;
    const dismiss = dragging && (flung || pastThreshold);
    const dir = (flung ? Math.sign(vel) : Math.sign(dx)) || -1;

    if (dismiss) {
      // Fling off — momentum-based
      const flyDist = dir * (Math.abs(dx) + Math.max(absVel * 220, 200));
      const flyTime = Math.min(0.32, Math.max(0.14, 160 / (absVel * 1000 + 1)));
      el.style.transition = `transform ${flyTime}s ease-out, opacity ${flyTime}s ease-out, box-shadow ${flyTime}s ease-out`;
      el.style.transform = `translate(${flyDist}px, ${dy * 0.25}px) rotate(${dir * 5}deg)`;
      el.style.opacity = '0';
      el.style.boxShadow = '';
      const item = findItem(el);
      if (item) {
        setTimeout(() => {
          clearInline(el);
          commit(Store.update(item, { onList: false, checked: false, listQty: 1 }));
        }, flyTime * 1000);
      }
    } else {
      // Spring back with slight overshoot
      el.style.transition = 'transform 0.3s cubic-bezier(.34,1.56,.64,1), box-shadow 0.3s ease';
      el.style.transform = '';
      el.style.boxShadow = '';
      el.addEventListener('transitionend', function cleanup() {
        el.removeEventListener('transitionend', cleanup);
        clearInline(el);
      });
    }

    // Reset flags AFTER the animation is queued but before the next gesture
    // (dragging stays true briefly so the click swallower can catch it)
  }

  listEl.addEventListener('pointerup', release);
  listEl.addEventListener('pointercancel', () => {
    // Browser stole the gesture (e.g., decided to scroll).
    // Clean up everything so the next touch starts fresh.
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (row) {
      clearInline(row);
      row = null;
    }
    lifted = false;
    dragging = false;
    aborted = false;
  });

  // Swallow the click that follows a drag gesture
  listEl.addEventListener('click', (e) => {
    if (dragging) {
      e.stopPropagation(); e.preventDefault();
      dragging = false;
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

/* ── Category picker ──
   Rows are radios named "category", so form.elements.category.value still
   reports the checked one and the submit handler needs no special case. */
const categoryList = document.getElementById('category-list');
const categoryBtn = document.getElementById('category-btn');

function setCategory(value) {
  document.getElementById('category-current').textContent = value;
  const hit = [...categoryList.querySelectorAll('input[name="category"]')]
    .find((r) => r.value === value);
  if (hit) hit.checked = true;
}

function openCategoryList(open) {
  categoryList.hidden = !open;
  categoryBtn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  /* Open on the current selection rather than at the top — with 14+ categories
     the checked row is usually out of view otherwise. */
  const checked = categoryList.querySelector('input:checked');
  if (!checked) return;
  checked.closest('.picker-row').scrollIntoView({ block: 'center' });
  checked.focus();
}

function renderCategoryList(current) {
  categoryList.innerHTML = Store.categoryChoices(state.items, current).map((c) => `
    <label class="picker-row">
      <input type="radio" name="category" value="${escapeHtml(c)}"${c === current ? ' checked' : ''}>
      <span class="picker-name">${escapeHtml(c)}</span>
      <span class="picker-check"></span>
    </label>`).join('')
    + `<button type="button" class="picker-row picker-new" id="category-new">＋ New category…</button>`;
}

categoryBtn.addEventListener('click', () => openCategoryList(categoryList.hidden));

/* Choosing a row closes the list — one tap, same as the native popup did. */
categoryList.addEventListener('change', (e) => {
  if (e.target.name !== 'category') return;
  setCategory(e.target.value);
  openCategoryList(false);
  categoryBtn.focus();
});

/* "＋ New category…": prompt, add a row, select it. A category is just a string
   on the item, so nothing is persisted until the item itself is saved. */
categoryList.addEventListener('click', (e) => {
  if (!e.target.closest('#category-new')) return;
  const name = (prompt('New category name') || '').trim();
  if (!name) return; // cancelled — the list stays as it was
  // Re-use a row that already matches, so casing variants don't split a category.
  const existing = [...categoryList.querySelectorAll('input[name="category"]')]
    .find((r) => r.value.toLowerCase() === name.toLowerCase());
  if (existing) {
    setCategory(existing.value);
  } else {
    document.getElementById('category-new').insertAdjacentHTML('beforebegin', `
      <label class="picker-row">
        <input type="radio" name="category" value="${escapeHtml(name)}" checked>
        <span class="picker-name">${escapeHtml(name)}</span>
        <span class="picker-check"></span>
      </label>`);
    document.getElementById('category-current').textContent = name;
  }
  openCategoryList(false);
  categoryBtn.focus();
});

/* `<dialog>.showModal()` focuses the first focusable descendant, which in most
   of these is a text input — so opening Settings or an item raised the phone
   keyboard over the content the user came to look at, and covered half the
   dialog before they had read any of it.

   Focusing the dialog itself instead keeps everything showModal() gives us —
   the focus trap, Escape to close, the screen-reader announcement — without
   summoning a keyboard nobody asked for. The dialogs carry `tabindex="-1"` so
   they can take focus without joining the tab order.

   `#meal-dialog` is deliberately NOT routed through here: its only purpose is
   typing a name, so the keyboard is the point. */
function openModal(el) {
  el.showModal();
  el.focus();
}

function openItemDialog(item) {
  dialogItemId = item ? item.id : null;
  const form = document.getElementById('item-form');
  document.getElementById('item-dialog-title').textContent = item ? 'Edit item' : 'New inventory item';
  form.elements.name.value = item ? item.name : '';
  /* Built fresh each open: the list depends on current data, and an item whose
     category isn't built in must still show its own category rather than
     falling back to Other (which a save would then make permanent). */
  const current = (item && item.category) || 'Other';
  renderCategoryList(current);
  setCategory(current);
  openCategoryList(false); // always starts collapsed
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
  openModal(document.getElementById('item-dialog'));
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
  commit(existing ? Store.update(existing, fields) : Store.createItem(fields.name, { ...fields, addedBy: currentCreatorName() }));
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
  const drawer = document.getElementById('meals-drawer');
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  /* aria-hidden on a container whose buttons are still focusable is the classic
     ARIA contradiction: the drawer sits off-screen at translateX(-100%) but you
     could tab straight into it. `inert` makes the two agree. */
  drawer.inert = !open;
  document.getElementById('meals-tab').setAttribute('aria-expanded', String(open));
  document.getElementById('meals-scrim').hidden = !open;
  /* Closing clears the filter. Re-opening the drawer to a list still narrowed
     by something you typed a day ago reads as "my meals are gone". */
  if (!open) { mealQuery = ''; document.getElementById('meal-search').value = ''; }
  if (open) renderMeals();
}

document.getElementById('meal-search').addEventListener('input', (e) => {
  mealQuery = e.target.value;
  renderMeals();
});
document.getElementById('meals-tab').addEventListener('click', () => setDrawer(true));
document.getElementById('meals-scrim').addEventListener('click', () => setDrawer(false));

/* Tap a meal: everything in it goes on the list — you prune, we don't guess.
   The banner names how many you're actually short on. */
document.getElementById('meals-list').addEventListener('click', (e) => {
  const el = e.target.closest('.meal');
  if (!el) return;
  const meal = state.meals.find((m) => m.id === el.dataset.mealId);
  if (!meal) return;
  
  const items = meal.itemIds.map(id => state.items.find(i => i.id === id)).filter(Boolean);
  if (!items.length) { showBanner(`${meal.name}: its items are all gone.`); return; }

  // Sort: out of stock first, then alphabetically
  items.sort((a, b) => {
    if (a.stock === 0 && b.stock !== 0) return -1;
    if (b.stock === 0 && a.stock !== 0) return 1;
    return a.name.localeCompare(b.name);
  });

  document.getElementById('preflight-dialog-title').textContent = meal.name;
  
  document.getElementById('preflight-items').innerHTML = items.map(it => {
    const staged = it.stock === 0 || it.stock <= it.lowAt;
    return `
      <label class="preflight-row ${staged ? '' : 'dimmed'}">
        <input type="checkbox" name="itemIds" value="${it.id}" ${staged ? 'checked' : ''}>
        <span class="preflight-check ${staged ? 'checked' : ''}">✓</span>
        <span class="preflight-name">${escapeHtml(it.name)}</span>
        <span class="preflight-stock">Stock: ${it.stock}</span>
      </label>
    `;
  }).join('');
  
  openModal(document.getElementById('preflight-dialog'));
});

document.getElementById('preflight-cancel').addEventListener('click', () => {
  document.getElementById('preflight-dialog').close();
});

document.getElementById('preflight-items').addEventListener('change', (e) => {
  if (e.target.tagName === 'INPUT') {
    const label = e.target.closest('label');
    const checked = e.target.checked;
    label.classList.toggle('dimmed', !checked);
    const checkEl = label.querySelector('.preflight-check');
    if (checkEl) checkEl.classList.toggle('checked', checked);
  }
});

document.getElementById('preflight-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const form = e.target;
  const checkboxes = form.querySelectorAll('input[name="itemIds"]:checked');
  const selectedIds = Array.from(checkboxes).map(cb => cb.value);

  if (selectedIds.length === 0) {
    document.getElementById('preflight-dialog').close();
    setDrawer(false);
    return;
  }

  // 1. Snapshot source rects from preflight rows
  const sourceRects = {};
  selectedIds.forEach(id => {
    const input = form.querySelector(`input[value="${id}"]`);
    if (input) {
      const row = input.closest('.preflight-row');
      sourceRects[id] = row.getBoundingClientRect();
    }
  });

  // 2. Close dialog, update state, render
  document.getElementById('preflight-dialog').close();
  setDrawer(false);
  const withAdded = state.items.map(it =>
    selectedIds.includes(it.id) ? Store.update(it, { onList: true, checked: false }) : it
  );
  // Deliberately not awaited — the fly animation below must start this frame.
  commitAll(withAdded).then((ok) => { if (!ok) showBanner('Save failed — changes may not persist.'); });
  showBanner(`Added ${selectedIds.length} item(s) from ${document.getElementById('preflight-dialog-title').textContent}.`);

  // 3. Mark destination rows as pending, snapshot destination rects
  const listEl = document.getElementById('list');
  const flights = [];
  selectedIds.forEach(id => {
    const destRow = listEl.querySelector(`.row[data-id="${id}"]`);
    if (destRow && sourceRects[id]) {
      destRow.classList.add('fly-pending');
      flights.push({ id, src: sourceRects[id], dest: destRow.getBoundingClientRect(), destRow });
    }
  });
  flights.sort((a, b) => a.dest.top - b.dest.top);

  // 4. Create clones and animate with stagger
  const FLY_MS = 640;
  const STAGGER_MS = 60;
  const SETTLE_AT = 0.85;  // motion is done by here; the rest is the hand-off fade

  const revealRow = (row) => {
    row.style.transition = 'opacity .12s ease';
    row.classList.remove('fly-pending');
    row.addEventListener('transitionend', () => { row.style.transition = ''; }, { once: true });
  };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { flights.forEach(f => f.destRow.classList.remove('fly-pending')); return; }

  flights.forEach((f, i) => {
    const clone = document.createElement('div');
    clone.className = 'fly-clone';
    clone.textContent = state.items.find(it => it.id === f.id)?.name || '';
    clone.style.left = f.src.left + 'px';
    clone.style.top = f.src.top + 'px';
    clone.style.width = f.src.width + 'px';
    clone.style.height = f.src.height + 'px';
    document.body.appendChild(clone);

    const dx = f.dest.left - f.src.left;
    const dy = f.dest.top - f.src.top;
    // Uniform scale, damped toward 1 — a non-uniform scale distorts the label mid-flight.
    const s = 1 + (f.dest.width / f.src.width - 1) * 0.5;

    // Overshoot a fixed few pixels along the direction of travel rather than a
    // proportion of it, so a long flight does not fling much further than a short one.
    const dist = Math.hypot(dx, dy) || 1;
    const over = Math.min(10, dist * 0.05);
    const ox = (dx / dist) * over;
    const oy = (dy / dist) * over;

    setTimeout(() => {
      const anim = clone.animate([
        // slow start, accelerates, decelerates as it runs slightly past the slot
        { offset: 0,    transform: `translate(0px, 0px) scale(1)`,                              opacity: 1, easing: 'cubic-bezier(.5,0,.25,1)' },
        { offset: 0.62, transform: `translate(${dx + ox}px, ${dy + oy}px) scale(${s * 1.015})`, opacity: 1, easing: 'ease-in-out' },
        // caught, swings back a touch past centre
        { offset: 0.76, transform: `translate(${dx - ox * 0.3}px, ${dy - oy * 0.3}px) scale(${s * 0.997})`, opacity: 1, easing: 'ease-out' },
        // settled in the slot, then hands off
        { offset: SETTLE_AT, transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1, easing: 'linear' },
        { offset: 1,         transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 },
      ], { duration: FLY_MS, fill: 'forwards' });

      // Reveal underneath only once the clone has stopped moving, so the elastic
      // settle reads on the clone and the swap happens with both at rest.
      setTimeout(() => revealRow(f.destRow), FLY_MS * SETTLE_AT);
      anim.finished.then(() => clone.remove(), () => clone.remove());
    }, i * STAGGER_MS);
  });
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
  const gone = state.meals.find((m) => m.id === dialogMealId);
  state.meals = state.meals.filter((m) => m.id !== dialogMealId);
  document.getElementById('meal-dialog').close();
  renderMeals();
  await saveMeals(gone ? [gone.id] : undefined, gone ? Store.softDelete(gone) : null);
});
document.getElementById('meal-cancel').addEventListener('click', () => {
  document.getElementById('meal-dialog').close();
});

onLongPress(document.getElementById('list'), '.row', (el) => openItemDialog(findItem(el)));
onLongPress(document.getElementById('inv-grid'), '.tile', (el) => openItemDialog(findItem(el)));
document.getElementById('inv-add').addEventListener('click', () => openItemDialog(null));

document.getElementById('settings-btn').addEventListener('click', () => {
  const nameInput = document.getElementById('display-name-input');
  if (nameInput) nameInput.value = state.displayName || '';
  openModal(document.getElementById('settings-dialog'));
});

const displayNameInput = document.getElementById('display-name-input');
if (displayNameInput) {
  displayNameInput.addEventListener('input', async (e) => {
    state.displayName = e.target.value.trim();
    await DB.putSetting('displayName', state.displayName);
  });
}

document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-dialog').close();
});

/* ---- What's new ----
   PATCH_NOTES is plain data (assets/patch-notes.js); Store.unseenNotes decides
   what is unread. The read marker persists in the `settings` store rather than
   localStorage, so it travels with the rest of the app's state. */

/* 'YYYY-MM-DD' must be given a time before Date parses it, or it is read as
   UTC midnight and renders as the previous day for anyone west of Greenwich. */
function formatNoteDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function refreshNewsDot() {
  const unseen = Store.unseenNotes(PATCH_NOTES, state.notesLastSeen);
  document.getElementById('settings-btn').classList.toggle('has-news', unseen.length > 0);
  document.getElementById('notes-dot').hidden = unseen.length === 0;
  document.getElementById('notes-desc').textContent = unseen.length
    ? `${unseen.length} update${unseen.length === 1 ? '' : 's'} since you last looked.`
    : 'See what changed in recent updates.';
}

function renderPatchNotes() {
  // Snapshot the unread set before the read marker moves, so this viewing is
  // the one that actually shows which entries were new.
  const unseen = new Set(Store.unseenNotes(PATCH_NOTES, state.notesLastSeen).map((n) => n.date));
  document.getElementById('notes-body').innerHTML = PATCH_NOTES.map((r) => `
    <div class="note-release">
      <div class="note-head">
        <span class="note-date">${escapeHtml(formatNoteDate(r.date))}</span>
        ${r.version ? `<span class="note-version">v${r.version}</span>` : ''}
        ${unseen.has(r.date) ? '<span class="note-new">New</span>' : ''}
      </div>
      <ul class="note-list">
        ${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
      </ul>
    </div>`).join('');
}

async function markNotesSeen() {
  const latest = Store.latestNoteDate(PATCH_NOTES);
  if (!latest || state.notesLastSeen === latest) return;
  state.notesLastSeen = latest;
  try { await DB.putSetting('notes.lastSeen', latest); } catch (e) { /* read marker only */ }
}

document.getElementById('notes-btn').addEventListener('click', async () => {
  renderPatchNotes();
  openModal(document.getElementById('notes-dialog'));
  await markNotesSeen();
  refreshNewsDot();
});

document.getElementById('notes-close').addEventListener('click', () => {
  document.getElementById('notes-dialog').close();
});

function downloadJson(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

const today = () => new Date().toISOString().slice(0, 10);

document.getElementById('export-btn').addEventListener('click', () => {
  downloadJson(Store.serialize(state.items, state.meals), `grocery-backup-${today()}.json`);
});

/* Pantry export: only what's in stock, in an AI-friendly shape (see
   Store.serializePantry). Meant to be pasted/uploaded to an assistant for a
   "what can I cook?" suggestion, not to be re-imported. */
document.getElementById('export-pantry-btn').addEventListener('click', () => {
  const inStock = state.items.some((it) => it.tracked && it.stock > 0);
  if (!inStock) { showBanner('Nothing in stock to export yet.'); return; }
  downloadJson(Store.serializePantry(state.items), `pantry-${today()}.json`);
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
  // replace: the backup becomes the whole truth, tombstones included.
  if (!await commitAll(items, meals, { replace: true })) {
    showBanner('Restore failed — data unchanged.');
    return;
  }
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
  // A merge never deletes, so tombstones must survive it.
  if (!await commitAll(items, meals)) {
    showBanner('Add failed — data unchanged.');
    return;
  }
  document.getElementById('settings-dialog').close();
  const parts = [`Added ${stats.added}`, `updated ${stats.updated}`];
  if (stats.skipped) parts.push(`skipped ${stats.skipped}`);
  showBanner(parts.join(', ') + '.');
});

/* ── Sync: lazy client load + settings panel ──
   The 205 KB client is only fetched when it can actually be used: an existing
   session, or the user reaching for the sign-in button. A signed-out user
   boots at exactly the speed they did before any of this existed. */

let sbClient = null;

function loadVendor() {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/supabase-js-2.111.0.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the sync library.'));
    document.head.appendChild(s);
  });
}

/* Every entry point is guarded on this resolving, so a failed vendor load, a
   paused backend, or sync.js being absent entirely all degrade to "the app
   works locally" rather than to a broken app. */
async function ensureSync() {
  if (sbClient) return true;
  if (typeof Sync === 'undefined' || typeof SYNC_CONFIG === 'undefined') return false;
  await loadVendor();
  sbClient = window.supabase.createClient(SYNC_CONFIG.url, SYNC_CONFIG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  await Sync.init({
    client: sbClient,
    getLocal: async () => ({
      // RAM wins over storage: commit() renders before it persists, so a pull
      // reading storage alone could overwrite an edit already on screen.
      // Storage supplies the tombstones, which `state` deliberately never holds.
      items: Store.overlayLocal(await DB.getAll(), state.items),
      meals: Store.overlayLocal(await DB.getSetting('meals', []), state.meals)
    }),
    onStatus: renderSyncPanel,
    onSnapshot: applySnapshot
  });
  return true;
}

/* Only auto-loads when a session already exists — checking localStorage costs
   nothing and avoids the download for everyone else. */
async function bootSync() {
  const hasSession = Object.keys(localStorage).some((k) => k.startsWith(SYNC_CONFIG.storagePrefix));
  const returningFromAuth = /[?#].*(code=|access_token=)/.test(location.href);
  if (!hasSession && !returningFromAuth) { renderSyncPanel(); return; }
  try {
    await ensureSync();
    scheduleSync(0);
  } catch (e) {
    renderSyncPanel({ status: 'error', error: e.message });
  }
}

/* Push is debounced rather than fired per write: the stock stepper can produce
   five writes in a second, and the outbox coalesces them anyway. */
let syncTimer = null;
function scheduleSync(delay = 1200) {
  if (typeof Sync === 'undefined' || !Sync.enabled) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; Sync.sync(); }, delay);
}

/* The trigger set the owner chose: on open, on refocus, on reconnect. No
   polling and no subscription. Note the consequence — while shopping the app
   stays foregrounded, so none of these fire and the list can go stale for the
   length of the trip. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleSync(0);
});
window.addEventListener('online', () => scheduleSync(0));

/* Remote snapshots are applied here, not in sync.js, because only the UI knows
   when a rebuild would land under the user's finger. */
let pendingSnapshot = null;
function canApplyNow() {
  return !document.querySelector('dialog[open]')  // a stale submit target
      && renderTimer === null;                    // inside the stepper debounce
}
function applySnapshot(snap) {
  if (!canApplyNow()) { pendingSnapshot = snap; return; }
  pendingSnapshot = null;
  state.items = snap.items;
  state.meals = snap.meals;
  render();
}
function drainSnapshot() {
  if (pendingSnapshot) applySnapshot(pendingSnapshot);
}
// The two moments a deferred snapshot becomes safe to apply.
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('close', drainSnapshot));

const SYNC_DOTS = { idle: 'ok', syncing: 'pending', offline: 'low', error: 'out' };

/* A modal <dialog> renders in the browser's top layer, which sits above every
   z-index on the page — so #banner painted *underneath* the settings dialog and
   sync errors were effectively invisible. Errors raised while the dialog is open
   have to be shown inside it. */
function showSyncError(msg) {
  const slot = document.getElementById('sync-error');
  if (!slot || !document.getElementById('settings-dialog').open) { showBanner(msg); return; }
  slot.textContent = msg;
  slot.hidden = false;
}

function renderSyncPanel(s) {
  const panel = document.getElementById('sync-panel');
  const body = document.getElementById('sync-body');
  if (!panel || !body) return;
  panel.hidden = false;
  const st = s || (typeof Sync !== 'undefined' ? Sync.snapshotStatus() : { status: 'off' });
  // Anything half-typed must survive a re-render — an auth-state change can
  // rebuild this panel mid-interaction, and retyping a 10-character code
  // because the client finished loading is exactly the papercut being fixed.
  const typedEmail = (document.getElementById('sync-email') || {}).value || '';
  const typedCode = (document.getElementById('sync-code') || {}).value || '';

  if (st.status === 'off' || st.status === 'signed-out') {
    /* Code first: joining a household is the common case (one person starts
       it, everyone else is invited), and it needs no email at all — which
       matters because the built-in mailer allows 2 messages an hour. */
    body.innerHTML = `
      <p class="dialog-note">Your list stays on this device until you sign in.</p>
      <input type="text" id="sync-code" placeholder="Invite code" maxlength="13"
             autocapitalize="characters" autocomplete="one-time-code"
             autocorrect="off" spellcheck="false" enterkeyhint="go" inputmode="text"
             value="${escapeHtml(typedCode)}">
      <button id="sync-join-code-btn" class="btn-clay">Join with code</button>
      <details id="sync-email-more">
        <summary>Sign in with email instead</summary>
        <input type="email" id="sync-email" placeholder="you@example.com" autocomplete="email" value="${escapeHtml(typedEmail)}">
        <button id="sync-email-btn">Send sign-in link</button>
        <button id="sync-google-btn">Continue with Google</button>
      </details>
      <p class="sync-error" id="sync-error" hidden></p>`;
    return;
  }
  if (st.status === 'adopting') {
    body.innerHTML = `
      <p class="dialog-note">You're in. This device already has its own list — what should happen to it?</p>
      <button id="sync-adopt-replace" class="btn-clay">Use the household's list</button>
      <button id="sync-adopt-merge">Add my items to the household</button>
      <p class="dialog-note">Replacing discards what's on this device. Adding pushes it to everyone.</p>
      <p class="sync-error" id="sync-error" hidden></p>`;
    return;
  }
  if (st.status === 'choosing') {
    body.innerHTML = `
      <p class="dialog-note">Signed in as ${escapeHtml(st.email || '')}. Start a household, or join one you were invited to.</p>
      <button id="sync-start-btn">Start a household</button>
      <button id="sync-join-btn">I have an invite code</button>
      <div id="sync-join-row" hidden>
        <input type="text" id="sync-code" placeholder="10-character code" maxlength="13" autocapitalize="characters">
        <button id="sync-redeem-btn" class="btn-clay">Join</button>
      </div>
      <p class="sync-error" id="sync-error" hidden></p>`;
    return;
  }

  const label = {
    idle: st.lastSyncAt ? `Synced · ${formatDate(st.lastSyncAt)}` : 'Synced',
    syncing: 'Syncing…',
    offline: 'Offline · changes will send later',
    error: 'Sync failed'
  }[st.status] || st.status;

  body.innerHTML = `
    <p class="pill"><span class="dot ${SYNC_DOTS[st.status] || 'pending'}"></span>${escapeHtml(label)}</p>
    <p class="dialog-note">${escapeHtml(st.email || '')}</p>
    ${st.status === 'error' ? '<button id="sync-retry-btn">Retry</button>' : ''}
    <button id="sync-invite-btn">Invite someone</button>
    <p class="dialog-note" id="sync-invite-out" hidden></p>
    <button id="sync-signout-btn">Sign out</button>
    <p class="sync-error" id="sync-error" hidden></p>
    <p class="dialog-note" id="sync-diag" hidden></p>
    <button id="sync-report-btn">Copy sync report</button>`;
  fillSyncDiag();
}

/* Everything a diagnosis needs, on the clipboard, from a phone.
   Written after asking the owner to open a browser console four times — twice
   on a phone, where there isn't one. A diagnostic that requires devtools does
   not exist for the person actually holding the broken device. */
async function copySyncReport() {
  const report = { version: 'unknown', status: null, lastError: null, cursor: null, outbox: 0, stuck: [] };
  try {
    const keys = await caches.keys();
    report.version = keys.find((k) => k.startsWith('grocery-')) || 'not installed';
  } catch (e) { /* private mode */ }
  if (typeof Sync !== 'undefined') {
    report.status = Sync.status;
    report.lastError = Sync.lastError;
    report.household = Sync.householdId;
  }
  try {
    report.cursor = await DB.getSetting('sync.cursor', null);
    const entries = await DB.outboxAll();
    const all = await DB.getAll();
    report.outbox = entries.length;
    // The field list is the point: a record missing a key the server has is
    // what made these queue forever (gotcha #9).
    report.stuck = entries.slice(0, 8).map((e) => {
      const r = all.find((x) => x.id === e.id);
      return { kind: e.kind, name: r ? r.name : '(gone)', fields: r ? Object.keys(r).sort().join(',') : null };
    });
  } catch (e) { report.dbError = e.message; }

  const text = JSON.stringify(report, null, 1);
  try {
    await navigator.clipboard.writeText(text);
    showBanner('Sync report copied — paste it in the chat.');
  } catch (e) {
    // Clipboard needs a secure context and a user gesture; if it is refused,
    // showing the text still beats telling someone to find a console.
    const out = document.getElementById('sync-diag');
    if (out) { out.textContent = text; out.hidden = false; }
  }
}

/* A phone has no console. Diagnosing the 2026-08-05 sync failures took six
   rounds partly because nobody could tell whether the phone was even running
   the current code, and every "hard refresh" was taken on trust.

   The version comes from `caches.keys()`, NOT from a constant in this file:
   that reports what the device actually holds, which is the whole question. A
   constant would report what the source says it should be and would have been
   useless for exactly the bug it exists to catch.

   `outbox` is the other half. A number that does not fall to zero across two
   syncs means changes are queued and not leaving, which every failure so far
   has looked like from the inside while the panel read "Synced". */
async function fillSyncDiag() {
  const el = document.getElementById('sync-diag');
  if (!el) return;
  const parts = [];
  try {
    const keys = await caches.keys();
    parts.push(keys.find((k) => k.startsWith('grocery-')) || 'not installed');
  } catch (e) { parts.push('version unknown'); }
  try { parts.push(`outbox ${await DB.outboxCount()}`); } catch (e) { /* pre-init */ }
  el.textContent = parts.join(' · ');
  el.hidden = false;
}

/* Locks a button for the duration of a request. A double-tap on "Join" would
   otherwise start two anonymous sign-ins and leave an orphan user behind —
   easy to do on a phone, where the first tap gives no feedback. */
function busy(btn, label) {
  if (!btn || btn.tagName !== 'BUTTON') return;
  btn.disabled = true;
  btn.dataset.idleLabel = btn.textContent;
  btn.textContent = label;
}
function unbusy() {
  document.querySelectorAll('#sync-panel button[disabled]').forEach((b) => {
    b.disabled = false;
    if (b.dataset.idleLabel) b.textContent = b.dataset.idleLabel;
  });
}

/* The iOS keyboard shows Go/return rather than a visible submit, and reaching
   for a button means dismissing the keyboard first. Enter submits instead. */
document.getElementById('settings-dialog').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const submit = { 'sync-code': 'sync-join-code-btn', 'sync-email': 'sync-email-btn' }[e.target.id];
  if (!submit) return;
  e.preventDefault();
  const btn = document.getElementById(submit);
  if (btn && !btn.disabled) btn.click();
});

/* Invite codes are uppercase and unambiguous by construction. Normalising as
   the user types means what they see matches what gets sent, and iOS
   autocorrect never gets a chance to "fix" a 10-character non-word. */
document.getElementById('settings-dialog').addEventListener('input', (e) => {
  if (e.target.id !== 'sync-code') return;
  const start = e.target.selectionStart;
  e.target.value = e.target.value.toUpperCase();
  e.target.setSelectionRange(start, start);
});

/* After joining, only ask about the local list if there IS one. An empty
   device — the normal case for someone installing fresh — just syncs. */
async function offerAdoption() {
  if (await Sync.hasLocalData()) {
    renderSyncPanel({ ...Sync.snapshotStatus(), status: 'adopting' });
  } else {
    await Sync.adoptHousehold('replace');
  }
}

/* Delegated so the panel can re-render freely without rebinding. */
document.getElementById('settings-dialog').addEventListener('click', async (e) => {
  const id = e.target.id;
  if (!id.startsWith('sync-')) return;
  const redirectTo = location.href.split(/[?#]/)[0];

  try {
    if (id === 'sync-email-btn') {
      // Read BEFORE ensureSync: loading the client fires an auth-state change,
      // which re-renders this panel and replaces the input with an empty one.
      // Reading afterwards silently swallowed the first attempt every time.
      const email = document.getElementById('sync-email').value;
      await ensureSync();
      await Sync.signInWithEmail(email, redirectTo);
      document.getElementById('sync-body').innerHTML =
        `<p class="dialog-note">Check ${escapeHtml(email)} for a sign-in link.</p>`;
    } else if (id === 'sync-google-btn') {
      await ensureSync();
      await Sync.signInWithGoogle(redirectTo);
    } else if (id === 'sync-start-btn') {
      await Sync.startHousehold();
      scheduleSync(0);   // this device's data becomes the household's seed
    } else if (id === 'sync-join-btn') {
      document.getElementById('sync-join-row').hidden = false;
    } else if (id === 'sync-join-code-btn' || id === 'sync-redeem-btn') {
      // Read BEFORE ensureSync, for the same reason as the email field:
      // loading the client fires an auth-state change that re-renders this
      // panel and replaces the input, so reading after it got an empty one
      // and silently ate the first attempt.
      const code = document.getElementById('sync-code').value;
      busy(e.target, 'Joining…');
      await ensureSync();
      await Sync.joinWithCode(code);
      // Deliberately NOT scheduleSync: a joining device must decide what
      // happens to its own list first, or the seed silently uploads it.
      await offerAdoption();
    } else if (id === 'sync-adopt-replace') {
      await Sync.adoptHousehold('replace');
    } else if (id === 'sync-adopt-merge') {
      await Sync.adoptHousehold('merge');
    } else if (id === 'sync-retry-btn') {
      await Sync.init({ client: sbClient, getLocal: Sync._getLocal, onStatus: renderSyncPanel, onSnapshot: applySnapshot });
    } else if (id === 'sync-invite-btn') {
      const code = await Sync.createInvite();
      const out = document.getElementById('sync-invite-out');
      out.hidden = false;
      out.textContent = `Code: ${code} — single use, expires in 24 hours.`;
    } else if (id === 'sync-signout-btn') {
      await Sync.signOut();
    } else if (id === 'sync-report-btn') {
      await copySyncReport();
    }
  } catch (err) {
    showSyncError(err.message || 'Sync action failed.');
  } finally {
    unbusy();
  }
});

async function boot() {
  /* A second tab holding the previous schema blocks the upgrade, and the open
     request then never settles. Racing it means a blocked upgrade shows an
     actionable message instead of an indefinitely blank screen. */
  const timedOut = Symbol('timeout');
  const outcome = await Promise.race([
    DB.init(),
    new Promise((r) => setTimeout(() => r(timedOut), 3000))
  ]);
  if (outcome === timedOut) {
    showBanner(DB.blocked
      ? 'Close this app\'s other tabs and reload to finish updating.'
      : 'Storage is taking too long to open. Reload to try again.');
    return;
  }
  if (!DB.persistent) showBanner("Changes won't be saved in this session.");
  await DB.purgeTombstones().catch(() => {});
  // Items stored before price history existed have no prices array; those
  // written before tombstones have no deletedAt. normalizeImport backfills
  // both. Store.live is the single boundary where tombstones are dropped —
  // past this point `state` never contains one.
  const stored = Store.normalizeImport(await DB.getAll());
  state.items = Store.live(stored);
  // Meals arrived in V3; older databases simply have no `meals` setting.
  // NOT pruned against state.items: pruning here rewrote and persisted every
  // meal based on whichever items happened to be present, so an item that a
  // sync had not yet delivered would be permanently stripped from its meals.
  state.meals = Store.live(Store.normalizeMeals(await DB.getSetting('meals', [])));
  state.displayName = await DB.getSetting('displayName', '');
  /* A device that has never recorded a read marker is treated as up to date
     rather than as having every release unread — "9 updates since you last
     looked" on a fresh install is noise, not news. Stamping it now is what
     makes the *next* release show a badge. */
  state.notesLastSeen = await DB.getSetting('notes.lastSeen', null);
  if (!state.notesLastSeen) await markNotesSeen();
  refreshNewsDot();
  render();

  // ── Import from URL fragment (Recipe Holder integration) ──
  // Recipe Holder links here with #import=<base64 JSON> to push ingredients
  // into the list as tracked items plus a saved meal.
  const hashMatch = location.hash.match(/^#import=(.+)$/);
  if (hashMatch) {
    history.replaceState(null, '', location.pathname);
    try {
      const data = JSON.parse(atob(decodeURIComponent(hashMatch[1])));
      if (Store.validateMergeImport(data)) {
        const { items, meals, stats } = Store.mergeImport(state.items, state.meals, data);
        if (await commitAll(items, meals)) {
          const parts = [`Added ${stats.added}`, `updated ${stats.updated}`];
          if (stats.skipped) parts.push(`skipped ${stats.skipped}`);
          showBanner(parts.join(', ') + '.');
        } else {
          showBanner('Import failed — data unchanged.');
        }
      } else {
        showBanner('Import failed: invalid data.');
      }
    } catch {
      showBanner('Import failed: could not read data.');
    }
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  bootSync();
}
boot();
