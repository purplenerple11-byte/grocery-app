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
      commit(Store.update(item, { onList: true, checked: false }));
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
      commit(Store.update(existing, { onList: true, checked: false }));
    } else {
      commit(Store.createItem(name, { onList: true }));
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
  
  document.getElementById('preflight-dialog').showModal();
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
  state.items = state.items.map(it =>
    selectedIds.includes(it.id) ? Store.update(it, { onList: true, checked: false }) : it
  );
  render();
  DB.replaceAll(state.items).catch(() => showBanner('Save failed — changes may not persist.'));
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
