# Grocery App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-first PWA combining a grocery list with a household inventory tracker, linked by a shopping-trip loop that restocks counts by quantity bought.

**Architecture:** Static HTML/CSS/JS, no framework, no build step. `assets/store.js` holds a `Store` namespace of pure state-transition functions plus a `DB` IndexedDB adapter (in-memory fallback). `assets/app.js` holds all UI wiring and rendering. Tests run in the browser via `tests/run-tests.html` with a tiny harness — no toolchain.

**Tech Stack:** Vanilla JS (plain `<script>` globals, no ES modules), IndexedDB, PWA (manifest + service worker), Python 3 stdlib for icon generation only.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-grocery-app-design.md`. Visual reference: `docs/DESIGN.md` (dark adaptation).
- No frameworks, no npm, no build step, no ES modules (plain script tags so tests work over `file://`).
- Dark theme only in v1. Palette tokens exactly: canvas `#141413`, surface `#1f1e1b`, surface-2 `#262521`, ink `#faf9f5`, muted `#b0aea5`, hairline `#3d3d3a`, clay `#d97757`, clay-deep `#c6613f`, sage `#7d9b76`, ochre `#d9a557`, out `#c6613f`.
- Clay is reserved for action state (on-list ribbon, checked marks, primary buttons). Status colors are sage/ochre/clay only — never green/yellow/red.
- Serif (Georgia stack) for headings and item names; sans (system stack) for UI chrome.
- Flat elevation: 1px hairline borders, no box-shadows, no gradients.
- Dev server: `python3 -m http.server 8000` from repo root (service worker needs http; everything else works from `file://`).
- Data tests: open `tests/run-tests.html` in a browser; the page title shows `✓ all passing` or `✗ N failing`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: PWA skeleton — shell, theme, manifest, icons, service worker

**Files:**
- Create: `index.html`
- Create: `assets/style.css`
- Create: `manifest.json`
- Create: `sw.js`
- Create: `tools/make_icons.py`
- Create: `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-180.png` (generated)
- Create: `README.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the complete static DOM that all later tasks render into. Later tasks rely on these element ids exactly: `banner`, `banner-text`, `banner-dismiss`, `list-sub`, `settings-btn`, `add-form`, `add-input`, `list`, `complete-trip`, `sheet`, `sheet-bar`, `peek-pills`, `inv-add`, `sheet-content`, `inv-grid`, `item-dialog`, `item-form`, `settings-dialog`, `export-btn`, `import-file`. And these CSS classes: `cat`, `row`, `done`, `check`, `name`, `unit`, `track-btn`, `stepper`, `step-btn`, `qty`, `open` (on `#sheet`), `grabber`, `peek`, `pill`, `dot` (+ `ok`/`low`/`out`), `inv-cat`, `tile-grid`, `tile`, `editing`, `bottom`, `meta`, `count`, `stock-step`, `ribbon`, `btn-clay`, `btn-danger`, `check-label`.

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#141413">
<title>Grocery</title>
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div id="banner" hidden><span id="banner-text"></span><button id="banner-dismiss" aria-label="Dismiss">✕</button></div>

<header class="appbar">
  <h1>Shopping List</h1>
  <span class="sub" id="list-sub"></span>
  <button id="settings-btn" aria-label="Settings">⚙</button>
</header>

<form id="add-form"><input id="add-input" placeholder="＋ Add item…" autocomplete="off" aria-label="Add item"></form>

<main id="list"></main>

<button id="complete-trip" hidden>Complete trip</button>

<section id="sheet">
  <div id="sheet-bar">
    <div class="grabber"></div>
    <div class="peek">
      <strong>Inventory</strong>
      <span id="peek-pills"></span>
      <button id="inv-add" hidden>＋ Add</button>
    </div>
  </div>
  <div id="sheet-content"><div id="inv-grid"></div></div>
</section>

<dialog id="item-dialog">
  <form id="item-form">
    <h3 id="item-dialog-title">Edit item</h3>
    <label>Name <input name="name" required></label>
    <label>Category
      <select name="category">
        <option>Produce</option><option>Dairy</option><option>Meat</option>
        <option>Frozen</option><option>Pantry</option><option>Household</option>
        <option>Other</option>
      </select>
    </label>
    <label>Unit (label only) <input name="unit" placeholder="e.g. cartons"></label>
    <label class="check-label"><input type="checkbox" name="tracked"> Track in inventory</label>
    <label>Stock <input type="number" name="stock" min="0" value="0"></label>
    <label>Low at <input type="number" name="lowAt" min="0" value="1"></label>
    <menu>
      <button type="submit" value="save" class="btn-clay">Save</button>
      <button type="button" value="delete" class="btn-danger" id="item-delete">Delete</button>
      <button type="button" value="cancel" id="item-cancel">Cancel</button>
    </menu>
  </form>
</dialog>

<dialog id="settings-dialog">
  <h3>Settings</h3>
  <menu>
    <button id="export-btn">Export JSON</button>
    <label class="import-label">Import JSON<input type="file" id="import-file" accept="application/json,.json" hidden></label>
    <button id="settings-close">Close</button>
  </menu>
</dialog>

<script src="assets/store.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
```

Note: `assets/store.js` and `assets/app.js` don't exist yet. Create both as empty files in this task so the page loads cleanly:

```bash
mkdir -p assets icons tools tests docs
touch assets/store.js assets/app.js
```

- [ ] **Step 2: Create `assets/style.css`** (complete final stylesheet — later tasks add no CSS)

```css
:root {
  --canvas: #141413; --surface: #1f1e1b; --surface-2: #262521;
  --ink: #faf9f5; --muted: #b0aea5; --hairline: #3d3d3a;
  --clay: #d97757; --clay-deep: #c6613f;
  --ok: #7d9b76; --low: #d9a557; --out: #c6613f;
  --serif: Georgia, "Source Serif Pro", Charter, serif;
  --sans: Inter, system-ui, -apple-system, Arial, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: var(--sans); background: var(--canvas); color: var(--ink);
  max-width: 480px; margin: 0 auto; display: flex; flex-direction: column;
}
h1, h3 { font-family: var(--serif); font-weight: 400; }
button { font-family: var(--sans); cursor: pointer; }

.appbar { padding: 20px 18px 8px; display: flex; align-items: baseline; gap: 10px; }
.appbar h1 { font-size: 24px; }
.appbar .sub { font-size: 12px; color: var(--muted); }
#settings-btn { margin-left: auto; background: none; border: 1px solid var(--hairline); color: var(--muted); border-radius: 8px; padding: 4px 10px; font-size: 14px; }

#add-form { padding: 8px 16px 4px; }
#add-input {
  width: 100%; background: var(--surface); border: 1px solid var(--hairline);
  border-radius: 12px; padding: 11px 14px; color: var(--ink); font-size: 15px;
}
#add-input::placeholder { color: var(--muted); }

#list { flex: 1; padding: 4px 16px 140px; overflow-y: auto; }
.cat { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 14px 2px 6px; }
.row {
  display: flex; align-items: center; gap: 11px; background: var(--surface);
  border: 1px solid var(--hairline); border-radius: 12px; padding: 9px 13px; margin-bottom: 6px;
  font-family: var(--serif); font-size: 16px;
}
.check {
  width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--muted);
  background: none; flex: none; color: transparent; font-size: 13px; line-height: 1; padding: 0;
}
.row.done .check { background: var(--clay); border-color: var(--clay); color: var(--canvas); }
.row.done .name { text-decoration: line-through; color: var(--muted); }
.unit { font-family: var(--sans); font-size: 12px; color: var(--muted); }
.track-btn { font-size: 10px; color: var(--muted); background: none; border: 1px solid var(--hairline); border-radius: 999px; padding: 2px 8px; }
.stepper { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.step-btn { width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--hairline); background: none; color: var(--ink); font-size: 14px; padding: 0; }
.qty { font-size: 13px; min-width: 16px; text-align: center; }

#complete-trip {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 78px; z-index: 5;
  background: var(--clay); color: var(--canvas); border: none; font-weight: 600; font-size: 15px;
  padding: 12px 28px; border-radius: 0 0 8px 8px;
}
#complete-trip:active { background: var(--clay-deep); }

#sheet {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 0; width: 100%; max-width: 480px;
  background: var(--surface-2); border-top: 1px solid var(--hairline);
  border-radius: 20px 20px 0 0; z-index: 10;
  height: 64px; transition: height .25s ease; overflow: hidden;
  display: flex; flex-direction: column;
}
#sheet.open { height: 86vh; }
#sheet-bar { padding: 10px 18px 14px; flex: none; cursor: pointer; -webkit-user-select: none; user-select: none; }
.grabber { width: 42px; height: 4px; background: var(--hairline); border-radius: 2px; margin: 0 auto 8px; }
.peek { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.peek strong { font-family: var(--serif); font-weight: 400; font-size: 16px; }
.pill { display: inline-flex; align-items: center; gap: 5px; background: var(--surface); border: 1px solid var(--hairline); border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--muted); }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; }
.dot.ok { background: var(--ok); } .dot.low { background: var(--low); } .dot.out { background: var(--out); }
#inv-add { margin-left: auto; font-size: 12px; color: var(--ink); background: none; border: 1px solid var(--hairline); border-radius: 999px; padding: 3px 10px; }
#sheet-content { overflow-y: auto; padding: 0 16px 24px; }
.inv-cat { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 12px 2px 7px; }
.tile-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.tile {
  aspect-ratio: 1; min-width: 0; overflow: hidden; position: relative;
  background: var(--surface); border: 1px solid var(--hairline); border-radius: 14px;
  padding: 6px; display: flex; flex-direction: column; text-align: left; color: var(--ink);
  font-family: inherit;
}
.tile .name {
  font-family: var(--serif); font-size: 12.5px; line-height: 1.2;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.tile .bottom { margin-top: auto; display: flex; align-items: center; gap: 4px; }
.meta { display: inline-flex; align-items: center; gap: 4px; }
.count { font-weight: 600; font-size: 11px; color: var(--ink); background: none; border: none; padding: 0 2px; }
.stock-step { display: none; width: 20px; height: 20px; font-size: 12px; }
.tile.editing .stock-step { display: inline-flex; align-items: center; justify-content: center; }
.ribbon {
  position: absolute; top: 0; right: 0; width: 28px; height: 28px;
  background: var(--clay); color: var(--canvas);
  clip-path: polygon(0 0, 100% 0, 100% 100%);
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 2px 4px 0 0; font-size: 10px; font-weight: 700;
}

#banner {
  position: sticky; top: 0; z-index: 20;
  background: var(--surface-2); border-bottom: 1px solid var(--hairline); color: var(--ink);
  padding: 10px 14px; font-size: 13px; display: flex; gap: 10px; align-items: center;
}
#banner button { margin-left: auto; background: none; border: none; color: var(--muted); font-size: 15px; }

dialog {
  background: var(--surface-2); color: var(--ink); border: 1px solid var(--hairline);
  border-radius: 16px; padding: 20px; width: min(90vw, 360px); margin: auto;
}
dialog::backdrop { background: rgba(0, 0, 0, .55); }
dialog h3 { font-size: 20px; margin-bottom: 12px; }
dialog label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 10px; }
dialog input:not([type="checkbox"]), dialog select {
  width: 100%; margin-top: 4px; background: var(--surface); border: 1px solid var(--hairline);
  border-radius: 8px; padding: 8px 10px; color: var(--ink); font-size: 14px;
}
dialog menu { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; padding: 0; list-style: none; }
#item-form menu { flex-direction: row; }
dialog menu button, .import-label {
  padding: 9px 12px; border-radius: 8px; border: 1px solid var(--hairline);
  background: none; color: var(--ink); font-size: 14px; text-align: center; flex: 1;
}
.import-label { display: block; font-size: 14px !important; color: var(--ink) !important; margin: 0 !important; cursor: pointer; }
.btn-clay { background: var(--clay); border: none !important; color: var(--canvas) !important; font-weight: 600; border-radius: 0 0 8px 8px !important; }
.btn-danger { color: var(--out) !important; border-color: var(--out) !important; }
.check-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }
```

- [ ] **Step 3: Create `manifest.json`**

```json
{
  "name": "Grocery",
  "short_name": "Grocery",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#141413",
  "theme_color": "#141413",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: Create `tools/make_icons.py` and generate icons** (stdlib-only PNG writer, solid clay squares)

```python
"""Generate solid-color PWA icons. Run: python3 tools/make_icons.py"""
import os, struct, zlib

def png(width, height, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))

CLAY = (217, 119, 87)
os.makedirs("icons", exist_ok=True)
for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "icon-180.png")]:
    with open(f"icons/{name}", "wb") as f:
        f.write(png(size, size, CLAY))
    print(f"wrote icons/{name}")
```

Run: `python3 tools/make_icons.py` (from repo root)
Expected output: three `wrote icons/...` lines; `icons/` contains three PNGs.

- [ ] **Step 5: Create `sw.js`**

```js
const CACHE = 'grocery-v1';
const ASSETS = [
  './', './index.html', './manifest.json',
  './assets/style.css', './assets/store.js', './assets/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
```

- [ ] **Step 6: Create `README.md`**

```markdown
# Grocery

Personal grocery list + household inventory tracker. Local-first PWA — no backend, no build step.

## Run

    python3 -m http.server 8000

Open http://localhost:8000. Install to home screen from the browser menu.

## Tests

Open `tests/run-tests.html` in a browser. Page title shows ✓/✗.

## Docs

- Spec: `docs/superpowers/specs/2026-07-16-grocery-app-design.md`
- Visual style reference: `docs/DESIGN.md`
```

- [ ] **Step 7: Verify the shell renders**

Run: `python3 -m http.server 8000` (background), open `http://localhost:8000`.
Expected: dark page, "Shopping List" serif header, add input, collapsed "Inventory" bar pinned at bottom. No console errors (empty JS files are fine). DevTools → Application → Manifest shows name "Grocery" with icons.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: PWA skeleton — shell, dark theme, manifest, icons, service worker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Test harness + `Store.createItem` / `Store.deriveStatus` / `Store.update`

**Files:**
- Create: `tests/harness.js`
- Create: `tests/run-tests.html`
- Create: `tests/store.test.js`
- Modify: `assets/store.js` (currently empty)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Harness globals: `test(name, fn)` (fn may be async), `assert(cond, msg)`, `assertEqual(actual, expected, msg)` (deep-equal via JSON), `runAll()`.
  - `Store.createItem(name, opts?) -> Item` where `Item = {id, name, category, tracked, stock, lowAt, unit, onList, listQty, checked, createdAt, updatedAt}`. Defaults: `category 'Other'`, `tracked false`, `stock 0`, `lowAt 1`, `unit ''`, `onList false`, `listQty 1`, `checked false`.
  - `Store.deriveStatus(item) -> 'out' | 'low' | 'stocked'`.
  - `Store.update(item, changes) -> Item` (shallow merge, bumps `updatedAt`, never mutates input).

- [ ] **Step 1: Write `tests/harness.js`**

```js
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assertEqual'}: expected ${e}, got ${a}`);
}
async function runAll() {
  const out = document.getElementById('results');
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      out.insertAdjacentHTML('beforeend', `<div style="color:#7d9b76">✓ ${name}</div>`);
    } catch (err) {
      fail++;
      out.insertAdjacentHTML('beforeend', `<div style="color:#c6613f">✗ ${name} — ${err.message}</div>`);
    }
  }
  out.insertAdjacentHTML('beforeend', `<h2>${pass} passed, ${fail} failed</h2>`);
  document.title = fail ? `✗ ${fail} failing` : '✓ all passing';
}
```

- [ ] **Step 2: Write `tests/run-tests.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>running…</title>
<style>body{font-family:monospace;background:#141413;color:#faf9f5;padding:20px}</style>
</head>
<body>
<h1>Store tests</h1>
<div id="results"></div>
<script src="harness.js"></script>
<script src="../assets/store.js"></script>
<script src="store.test.js"></script>
<script>runAll();</script>
</body>
</html>
```

- [ ] **Step 3: Write failing tests in `tests/store.test.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they fail**

Open `tests/run-tests.html` in a browser (double-click the file or visit `http://localhost:8000/tests/run-tests.html`).
Expected: title `✗ 4 failing`, each test red with "Store is not defined".

- [ ] **Step 5: Implement in `assets/store.js`**

```js
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
```

- [ ] **Step 6: Run tests to verify they pass**

Reload `tests/run-tests.html`. Expected: title `✓ all passing`, 4 passed.

- [ ] **Step 7: Commit**

```bash
git add tests/ assets/store.js
git commit -m "feat: browser test harness + Store.createItem/deriveStatus/update

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Store list operations — toggle, check, steppers

**Files:**
- Modify: `assets/store.js` (add methods to the `Store` object)
- Modify: `tests/store.test.js` (append tests)

**Interfaces:**
- Consumes: `Store.createItem`, `Store.update` from Task 2.
- Produces:
  - `Store.toggleOnList(item) -> Item` — on: sets `onList true`; off: sets `onList false`, resets `checked false`, `listQty 1`.
  - `Store.setChecked(item, checked) -> Item`.
  - `Store.adjustListQty(item, delta) -> Item` — floor 1.
  - `Store.adjustStock(item, delta) -> Item` — floor 0.

- [ ] **Step 1: Append failing tests to `tests/store.test.js`**

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Reload `tests/run-tests.html`. Expected: `✗ 4 failing` (the 4 new ones, "Store.toggleOnList is not a function" etc.), earlier 4 still green.

- [ ] **Step 3: Implement — add inside the `Store` object literal (after `update`)**

```js
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
```

- [ ] **Step 4: Run tests to verify all pass**

Reload `tests/run-tests.html`. Expected: `✓ all passing`, 8 passed.

- [ ] **Step 5: Commit**

```bash
git add assets/store.js tests/store.test.js
git commit -m "feat: Store list ops — toggleOnList, setChecked, qty/stock steppers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `Store.completeTrip` + `Store.outLowCounts`

**Files:**
- Modify: `assets/store.js`
- Modify: `tests/store.test.js`

**Interfaces:**
- Consumes: Tasks 2-3 methods.
- Produces:
  - `Store.completeTrip(items) -> Item[]` — checked+onList+tracked: `stock += listQty`, reset `onList/checked/listQty`; checked+onList+untracked: removed; everything else unchanged.
  - `Store.outLowCounts(items) -> {out: number, low: number}` — tracked items only.

- [ ] **Step 1: Append failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Reload `tests/run-tests.html`. Expected: 3 new failures ("Store.completeTrip is not a function").

- [ ] **Step 3: Implement — add inside the `Store` object literal**

```js
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
  },
```

- [ ] **Step 4: Run tests to verify all pass**

Reload `tests/run-tests.html`. Expected: `✓ all passing`, 11 passed.

- [ ] **Step 5: Commit**

```bash
git add assets/store.js tests/store.test.js
git commit -m "feat: Store.completeTrip restock-by-bought + outLowCounts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `Store.serialize` + `Store.validateImport`

**Files:**
- Modify: `assets/store.js`
- Modify: `tests/store.test.js`

**Interfaces:**
- Consumes: `Store.createItem`.
- Produces:
  - `Store.serialize(items) -> string` — JSON of `{version: 1, items}`.
  - `Store.validateImport(data) -> boolean` — true iff `data.version === 1`, `data.items` is an array, and every element has all of: `id, name, category, tracked, stock, lowAt, unit, onList, listQty, checked`.

- [ ] **Step 1: Append failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Reload `tests/run-tests.html`. Expected: 2 new failures.

- [ ] **Step 3: Implement — add inside the `Store` object literal**

```js
  serialize(items) {
    return JSON.stringify({ version: 1, items }, null, 2);
  },

  validateImport(data) {
    if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.items)) return false;
    const required = ['id', 'name', 'category', 'tracked', 'stock', 'lowAt', 'unit', 'onList', 'listQty', 'checked'];
    return data.items.every((it) => it && typeof it === 'object' && required.every((k) => k in it));
  },
```

- [ ] **Step 4: Run tests to verify all pass**

Reload `tests/run-tests.html`. Expected: `✓ all passing`, 13 passed.

- [ ] **Step 5: Commit**

```bash
git add assets/store.js tests/store.test.js
git commit -m "feat: Store.serialize + validateImport for JSON backup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `DB` IndexedDB adapter with in-memory fallback

**Files:**
- Modify: `assets/store.js` (append `DB` below `Store`)
- Modify: `tests/store.test.js`

**Interfaces:**
- Consumes: nothing from `Store` (independent namespace in the same file).
- Produces:
  - `DB.init(name = 'grocery') -> Promise<void>` — opens IndexedDB db `name` v1 with object store `items` (keyPath `id`) and `settings`; on failure sets `DB.persistent = false` and uses an in-memory Map.
  - `DB.persistent: boolean`.
  - `DB.getAll() -> Promise<Item[]>`, `DB.put(item) -> Promise<void>`, `DB.delete(id) -> Promise<void>`, `DB.replaceAll(items) -> Promise<void>` (clear + bulk put, one transaction).

- [ ] **Step 1: Append failing async tests** (uses a throwaway db name so app data is never touched)

```js
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
```

- [ ] **Step 2: Run tests to verify the new one fails**

Reload `tests/run-tests.html`. Expected: 1 new failure ("DB is not defined").

- [ ] **Step 3: Implement — append to `assets/store.js` after the `Store` object**

```js
/* IndexedDB adapter. Falls back to in-memory Map when IndexedDB is unavailable. */
const DB = {
  _db: null,
  _mem: null,
  persistent: true,

  init(name = 'grocery') {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(name, 1);
      } catch (e) {
        DB.persistent = false; DB._mem = new Map(); resolve(); return;
      }
      req.onupgradeneeded = () => {
        req.result.createObjectStore('items', { keyPath: 'id' });
        req.result.createObjectStore('settings');
      };
      req.onsuccess = () => { DB._db = req.result; resolve(); };
      req.onerror = () => { DB.persistent = false; DB._mem = new Map(); resolve(); };
    });
  },

  _tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = DB._db.transaction('items', mode);
      const result = fn(tx.objectStore('items'));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAll() {
    if (!DB.persistent) return [...DB._mem.values()];
    return DB._tx('readonly', (store) => store.getAll());
  },

  async put(item) {
    if (!DB.persistent) { DB._mem.set(item.id, item); return; }
    await DB._tx('readwrite', (store) => store.put(item));
  },

  async delete(id) {
    if (!DB.persistent) { DB._mem.delete(id); return; }
    await DB._tx('readwrite', (store) => store.delete(id));
  },

  async replaceAll(items) {
    if (!DB.persistent) { DB._mem = new Map(items.map((i) => [i.id, i])); return; }
    await DB._tx('readwrite', (store) => { store.clear(); items.forEach((i) => store.put(i)); });
  }
};
```

- [ ] **Step 4: Run tests to verify all pass**

Reload `tests/run-tests.html` **over http** (`http://localhost:8000/tests/run-tests.html` — some browsers block IndexedDB on `file://`). Expected: `✓ all passing`, 14 passed.

- [ ] **Step 5: Commit**

```bash
git add assets/store.js tests/store.test.js
git commit -m "feat: DB IndexedDB adapter with in-memory fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: App boot, list rendering, add bar

**Files:**
- Modify: `assets/app.js` (currently empty)

**Interfaces:**
- Consumes: `Store.*`, `DB.*`; DOM ids/classes from Task 1.
- Produces (used by Tasks 8-10): global `state = {items}`, `CATEGORY_ORDER`, `groupByCategory(items)`, `render()`, `renderList()`, `renderSheet()` (stub for now), `commit(item)`, `removeItems(ids)`, `showBanner(msg)`, `escapeHtml(s)`, `findItem(el)`.

- [ ] **Step 1: Write the core of `assets/app.js`**

```js
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
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:8000`. Type "Milk" in the add bar, press enter.
Expected: "Milk" appears under an "Other" heading with a check circle, a "track" pill, and a −/1/＋ stepper. Subtitle reads "1 item · 0 checked". Reload the page — Milk persists (IndexedDB).

- [ ] **Step 3: Verify data-layer tests still pass**

Reload `http://localhost:8000/tests/run-tests.html`. Expected: `✓ all passing`.

- [ ] **Step 4: Commit**

```bash
git add assets/app.js
git commit -m "feat: app boot, list rendering, add bar with persistence

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Check-off, quantity stepper, track button, complete trip

**Files:**
- Modify: `assets/app.js`

**Interfaces:**
- Consumes: `Store.setChecked/adjustListQty/update/completeTrip`, `commit`, `removeItems`, `findItem`, `render`, `state`.
- Produces: click handling on `#list` rows via `data-action` values `check`, `qty-minus`, `qty-plus`, `track`; `#complete-trip` handler.

- [ ] **Step 1: Add event delegation for list actions** (append to `assets/app.js`, before `boot()`)

```js
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
```

- [ ] **Step 2: Verify the trip loop in browser**

On `http://localhost:8000`:
1. Add "Eggs", tap "track" (pill disappears — item is now inventory-tracked).
2. Tap ＋ once (qty 2), tap the circle (row strikes through, clay circle, "Complete trip" button appears).
3. Add "Candles" (leave untracked), check it off too.
4. Tap "Complete trip".
Expected: list is empty ("Nothing on the list"), button hidden. Eggs still exists in the data with stock 2 (verify: DevTools → Application → IndexedDB → grocery → items — Eggs has `stock: 2`, `onList: false`; Candles is gone).

- [ ] **Step 3: Commit**

```bash
git add assets/app.js
git commit -m "feat: check-off, qty stepper, track promotion, complete-trip restock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Inventory sheet — peek bar, tiles, tap-to-toggle, stock stepper

**Files:**
- Modify: `assets/app.js` (replace the `renderSheet` stub; add sheet event handlers)

**Interfaces:**
- Consumes: `Store.deriveStatus/outLowCounts/toggleOnList/adjustStock`, `commit`, `findItem`, `state`, `escapeHtml`, `groupByCategory`.
- Produces: working bottom sheet. Tile `data-action` values: `toggle` (whole tile), `stock-minus`, `stock-plus`, `count` (opens inline stepper via `.editing` class). Task 10 attaches long-press to `.tile` and `.row` elements rendered here and in Task 7.

- [ ] **Step 1: Replace the `renderSheet() { }` stub in `assets/app.js`**

```js
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
```

- [ ] **Step 2: Add sheet open/close + tile actions** (append before `boot()`)

```js
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
```

Note: clicks on the inner `count`/`stock-*` buttons must not also toggle the list. `closest('[data-action]')` returns the innermost action element, and each branch `return`s — so the outer tile toggle only fires when the tap lands outside the meta buttons. Verify this behavior in Step 3.

- [ ] **Step 3: Verify in browser**

On `http://localhost:8000` (with Eggs tracked, stock 2 from Task 8):
1. Collapsed bar shows no pills (stock 2 > lowAt 1). Tap the bar — sheet slides up, Eggs tile visible under its category with dot + count "2".
2. Tap the tile — clay ✓ corner ribbon appears; open the list (tap bar to collapse) — Eggs is on the list. Tap tile again — ribbon gone, off the list.
3. Tap the count "2" — −/＋ steppers appear inline. Tap − twice — count 0, dot turns clay, peek pill "1 out" appears when collapsed.
4. Tap elsewhere on another tile — it toggles list membership without opening steppers.

- [ ] **Step 4: Commit**

```bash
git add assets/app.js
git commit -m "feat: inventory bottom sheet — tiles, tap-to-toggle, stock stepper, peek pills

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Item details dialog, inventory add, export/import

**Files:**
- Modify: `assets/app.js`

**Interfaces:**
- Consumes: everything above; dialog DOM from Task 1 (`item-dialog`, `item-form`, `item-delete`, `item-cancel`, `settings-dialog`, `export-btn`, `import-file`, `settings-close`, `inv-add`, `settings-btn`).
- Produces: `openItemDialog(item | null)` (null = create new tracked item), `onLongPress(container, selector, handler)`, export/import handlers. Completes the v1 feature set.

- [ ] **Step 1: Add long-press helper + item dialog logic** (append before `boot()`)

```js
function onLongPress(container, selector, handler) {
  let timer = null;
  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(selector);
    if (!el) return;
    timer = setTimeout(() => { timer = null; handler(el); }, 500);
  });
  for (const ev of ['pointerup', 'pointermove', 'pointercancel', 'pointerleave']) {
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
```

- [ ] **Step 2: Add settings dialog with export/import** (append before `boot()`)

```js
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
  URL.revokeObjectURL(a.href);
});

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { showBanner('Import failed: not valid JSON.'); return; }
  if (!Store.validateImport(data)) { showBanner('Import failed: unrecognized file format.'); return; }
  state.items = data.items;
  render();
  try { await DB.replaceAll(state.items); } catch (err) { showBanner('Save failed — changes may not persist.'); }
  document.getElementById('settings-dialog').close();
});
```

- [ ] **Step 3: Verify in browser**

On `http://localhost:8000`:
1. Long-press (hold 0.5s) the Eggs tile → dialog opens pre-filled. Change "Low at" to 3, save — dot turns ochre if stock ≤ 3.
2. Open sheet, tap "＋ Add" → dialog with "New inventory item", tracked pre-checked. Add "Coffee", category Pantry, stock 1 → tile appears.
3. ⚙ → Export JSON downloads a dated file; open it — `{"version": 1, "items": [...]}`.
4. ⚙ → Import that file back — no error, data unchanged. Import a text file of `hello` — banner "Import failed: not valid JSON."
5. Long-press a list row → same dialog; Delete removes the item everywhere.

- [ ] **Step 4: Run full test suite one last time**

Reload `http://localhost:8000/tests/run-tests.html`. Expected: `✓ all passing`, 14 passed.

- [ ] **Step 5: Add the smoke checklist to `README.md`** (append)

```markdown
## Manual smoke checklist

- [ ] Install as PWA (browser menu → Add to Home Screen / Install)
- [ ] Kill the server, reload the installed app — shell loads offline
- [ ] Add item → check off → adjust qty → Complete trip → tracked stock increases by qty bought
- [ ] Untracked checked item disappears on Complete trip
- [ ] Inventory: tap tile toggles list (clay ✓ ribbon); tap count opens −/＋ stepper
- [ ] Peek bar shows correct out/low pills when collapsed
- [ ] Long-press row/tile opens details; edit + delete work
- [ ] ⚙ Export then Import round-trips with no data change
- [ ] Malformed import shows banner, data untouched
```

- [ ] **Step 6: Commit**

```bash
git add assets/app.js README.md
git commit -m "feat: item details dialog, inventory add, JSON export/import

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
