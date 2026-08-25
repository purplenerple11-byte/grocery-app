# Per-Store Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single shopping list into one list per store, named in the header, switched by swiping the header block, with an "inhale" animation that funnels items into the block and drops the next list out.

**Architecture:** A list is a name string (`item.listStore`), not a record — one new column on `items`, no new synced entity. Pure list logic goes in `Store`; the gesture and animation go in `app.js`. The header block is the swipe surface, which leaves the existing row-swipe delete gesture untouched.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, no ES modules. IndexedDB via the existing `DB` adapter. Supabase Postgres for household sync. Tests are `tests/store.test.js` run by opening `tests/run-tests.html`.

## Global Constraints

- **No npm, no build step, no ES modules.** Plain `<script>` tags. Do not introduce a toolchain.
- **`assets/store.js` stays pure** — no DOM access. UI concerns go in `app.js`.
- **Categories are open-ended.** Never coerce an unrecognized category to `Other`. The same rule now applies to `listStore`: an unknown store name from an import is preserved verbatim.
- **New `Store` functions get tests** in `tests/store.test.js`.
- **Bump `const CACHE` in `sw.js`** (`grocery-v48` → `grocery-v49`) before merging. Currently at line 1.
- **Merge finished work straight into `main`.** No pull request unless asked. `main` is production — Cloudflare Pages publishes every push within ~1 minute.
- **Tests must pass before merging.** Open `tests/run-tests.html`; the page title shows ✓/✗.
- **One browser tab only** when running tests — a second tab holds IndexedDB open and the DB tests hang forever.

### ⚠ The one thing that will silently break production

Task 3 puts `list_store` on the sync wire. **The live Supabase table must gain that column in the same change**, or PostgREST rejects every upsert with 400 while reads keep working — the sync panel reads "synced" while nothing uploads. This took household sync down for a full day on 2026-08-05.

```sql
alter table public.items
  add column list_store text not null default '' check (char_length(list_store) <= 60);
```

Run it in the Supabase SQL editor. `supabase/schema.sql` is a committed **record, not a migration** — editing it changes nothing.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `assets/store.js` | `listStore` field, six pure list functions, list-scoped trip completion, sync mappers | Modify |
| `tests/store.test.js` | Tests for all of the above | Modify |
| `supabase/schema.sql` | Record the new column | Modify |
| `index.html` | Stacked header markup, page dots, Settings "Lists" section, list field in item dialog | Modify |
| `assets/style.css` | Header stack, page dots, swipe affordance, animation classes, reduced-motion | Modify |
| `assets/app.js` | Current-list state, migration, render scoping, swipe gesture, inhale animation, list CRUD UI | Modify |
| `sw.js` | CACHE bump | Modify |

No new files. This codebase deliberately keeps everything in four assets; adding a fifth script tag for ~200 lines would fight the established pattern.

---

### Task 1: `listStore` on the item, and the pure list functions

**Files:**
- Modify: `assets/store.js:66-85` (`createItem`), `assets/store.js:408-427` (`sanitizeItemFields`)
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `Store.createItem(name, opts)` gains `listStore: opts.listStore || ''`
  - `Store.listRoster(items, roster) → string[]`
  - `Store.itemsForList(items, name) → item[]`
  - `Store.nextList(roster, current, dir) → string | null` (`dir` is `1` or `-1`)
  - `Store.renameList(items, from, to) → item[]`
  - `Store.clearList(items, name) → item[]`
  - `Store.moveItemToList(item, name) → item`

- [ ] **Step 1: Write the failing tests**

Append to `tests/store.test.js`:

```js
test('createItem defaults listStore to empty', () => {
  assertEqual(Store.createItem('Milk').listStore, '');
  assertEqual(Store.createItem('Milk', { listStore: 'Hannaford' }).listStore, 'Hannaford');
});

test('listRoster unions stored roster with names actually in use', () => {
  const items = [
    Store.createItem('Milk', { onList: true, listStore: 'Hannaford' }),
    Store.createItem('Rice', { onList: true, listStore: "BJ's Club" }),
    Store.createItem('Soap', { onList: false, listStore: 'Target' })
  ];
  // Roster order wins for names it knows; in-use names it does not know append.
  assertEqual(Store.listRoster(items, ["BJ's Club", 'Hannaford']), ["BJ's Club", 'Hannaford', 'Target']);
  // An empty list survives because the roster remembers it.
  assertEqual(Store.listRoster([], ['Hannaford', 'Empty']), ['Hannaford', 'Empty']);
});

test('listRoster preserves an unfamiliar store name from an import', () => {
  const items = [Store.createItem('Kimchi', { onList: true, listStore: 'H Mart' })];
  assert(Store.listRoster(items, []).includes('H Mart'), 'unknown store preserved, never coerced');
});

test('itemsForList returns only that list, and only on-list items', () => {
  const items = [
    Store.createItem('Milk', { onList: true, listStore: 'Hannaford' }),
    Store.createItem('Rice', { onList: true, listStore: "BJ's Club" }),
    Store.createItem('Soap', { onList: false, listStore: 'Hannaford' })
  ];
  const got = Store.itemsForList(items, 'Hannaford');
  assertEqual(got.length, 1);
  assertEqual(got[0].name, 'Milk');
});

test('nextList walks the roster and stops at both ends', () => {
  const r = ['Hannaford', "BJ's Club", 'Target'];
  assertEqual(Store.nextList(r, 'Hannaford', 1), "BJ's Club");
  assertEqual(Store.nextList(r, "BJ's Club", -1), 'Hannaford');
  assertEqual(Store.nextList(r, 'Target', 1), null, 'no wrap-around past the end');
  assertEqual(Store.nextList(r, 'Hannaford', -1), null, 'no wrap-around before the start');
  assertEqual(Store.nextList(r, 'Gone', 1), null, 'unknown current list');
});

test('renameList rewrites only that list and bumps updatedAt', () => {
  const items = [
    Store.createItem('Milk', { onList: true, listStore: 'Hanaford', updatedAt: 1 }),
    Store.createItem('Rice', { onList: true, listStore: "BJ's Club", updatedAt: 1 })
  ];
  const next = Store.renameList(items, 'Hanaford', 'Hannaford');
  assertEqual(next[0].listStore, 'Hannaford');
  assert(next[0].updatedAt > 1, 'renamed item restamped');
  assertEqual(next[1].listStore, "BJ's Club");
  assertEqual(next[1].updatedAt, 1, 'untouched item not restamped');
});

test('clearList takes items off the list without destroying anything', () => {
  const items = [
    Store.createItem('Milk', { onList: true, checked: true, listQty: 3, listStore: 'Hannaford',
                               tracked: true, stock: 2 }),
    Store.createItem('Rice', { onList: true, listStore: "BJ's Club" })
  ];
  const next = Store.clearList(items, 'Hannaford');
  assertEqual(next[0].onList, false);
  assertEqual(next[0].checked, false);
  assertEqual(next[0].listQty, 1);
  assertEqual(next[0].stock, 2, 'stock untouched');
  assertEqual(next[0].tracked, true, 'tracking untouched');
  assertEqual(next[0].listStore, 'Hannaford', 'remembers where it was, so re-adding returns it');
  assertEqual(next[1].onList, true, 'other list untouched');
});

test('moveItemToList sets the list and puts the item on it', () => {
  const it = Store.createItem('Milk', { onList: true, listStore: 'Hannaford' });
  const moved = Store.moveItemToList(it, "BJ's Club");
  assertEqual(moved.listStore, "BJ's Club");
  assertEqual(moved.onList, true);
});

test('sanitizeItemFields keeps a non-empty listStore and ignores a blank one', () => {
  assertEqual(Store.sanitizeItemFields({ listStore: '  Hannaford ' }).listStore, 'Hannaford');
  assertEqual('listStore' in Store.sanitizeItemFields({ listStore: '   ' }), false,
    'blank must not blank an existing list, same rule as unit and category');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Open `tests/run-tests.html` in one browser tab. Expected: title shows ✗, failures name `listRoster is not a function` and similar.

- [ ] **Step 3: Add `listStore` to `createItem`**

In `assets/store.js`, inside the object literal returned by `createItem` (currently ends at line 84), add after the `onList` line:

```js
      onList: opts.onList ?? false,
      listStore: opts.listStore || '',
```

- [ ] **Step 4: Add the list functions**

In `assets/store.js`, insert after `categoryChoices` (which ends at line 59):

```js
  /* ── Lists ───────────────────────────────────────────────────────────────
     A list is a name, not a record. The set of lists is whatever the items
     say, unioned with a stored roster — the roster is what lets an EMPTY
     list keep existing and keep its position. Deriving from items alone
     would silently delete a list the moment you cleared it.

     Unknown names are preserved verbatim, for the same reason unknown
     categories are: an import must never have its data quietly rewritten. */
  listRoster(items, roster = []) {
    const out = [];
    const seen = new Set();
    for (const name of Array.isArray(roster) ? roster : []) {
      if (typeof name === 'string' && name && !seen.has(name)) { seen.add(name); out.push(name); }
    }
    const extra = new Set();
    for (const it of items || []) {
      if (it && typeof it.listStore === 'string' && it.listStore && !seen.has(it.listStore)) {
        extra.add(it.listStore);
      }
    }
    return [...out, ...[...extra].sort((a, b) => a.localeCompare(b))];
  },

  itemsForList(items, name) {
    return (items || []).filter((it) => it.onList && it.listStore === name);
  },

  /* Returns the neighbour, or null at either end — the caller turns a null
     at the far end into the "+ New list" card. Deliberately does not wrap. */
  nextList(roster, current, dir) {
    const list = Array.isArray(roster) ? roster : [];
    const i = list.indexOf(current);
    if (i === -1) return null;
    const j = i + (dir >= 0 ? 1 : -1);
    return j >= 0 && j < list.length ? list[j] : null;
  },

  /* A rename rewrites every member, which is the price of storing the list
     as a name rather than an id. Only members are restamped, so a rename
     does not queue the whole item table into the outbox. */
  renameList(items, from, to) {
    return (items || []).map((it) =>
      it.listStore === from ? Store.update(it, { listStore: to }) : it);
  },

  /* Deleting a list is exactly "swipe every item away": off the list,
     unchecked, qty reset. Stock, tracking and listStore survive, so
     re-adding an item returns it to the store it came from. */
  clearList(items, name) {
    return (items || []).map((it) =>
      it.onList && it.listStore === name
        ? Store.update(it, { onList: false, checked: false, listQty: 1 })
        : it);
  },

  moveItemToList(item, name) {
    return Store.update(item, { listStore: name, onList: true });
  },
```

- [ ] **Step 5: Accept `listStore` in `sanitizeItemFields`**

In `assets/store.js`, in `sanitizeItemFields` (line 408), add after the `unit` line:

```js
    // Same rule as category and unit: blank means "unspecified", so a merge
    // cannot use it to knock an item off the list it is already on.
    if (typeof raw.listStore === 'string' && raw.listStore.trim()) f.listStore = raw.listStore.trim();
```

- [ ] **Step 6: Run the tests to verify they pass**

Reload `tests/run-tests.html`. Expected: title shows ✓ all passing. Confirm the loaded source is yours before trusting green:

```js
/listRoster/.test(Store.listRoster && Store.listRoster.toString())
```

- [ ] **Step 7: Commit**

```bash
git add assets/store.js tests/store.test.js
git commit -m "Give an item the store whose list it is on"
```

---

### Task 2: List-scoped trip completion

**Files:**
- Modify: `assets/store.js:154-169` (`completeTrip`)
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: `Store.createItem` with `listStore` (Task 1).
- Produces: `Store.completeTrip(items, purchase, listName)` — a third parameter. When `listName` is a non-empty string, only items on that list are bought. When omitted or `''`, behaviour is unchanged (every checked item), which keeps every existing test and call site valid.

- [ ] **Step 1: Write the failing tests**

Append to `tests/store.test.js`:

```js
test('completeTrip scoped to a list leaves other lists alone', () => {
  const items = [
    Store.createItem('Milk', { onList: true, checked: true, tracked: true, stock: 0,
                               listQty: 2, listStore: 'Hannaford' }),
    Store.createItem('Rice', { onList: true, checked: true, tracked: true, stock: 1,
                               listQty: 5, listStore: "BJ's Club" })
  ];
  const next = Store.completeTrip(items, null, 'Hannaford');
  const milk = next.find((i) => i.name === 'Milk');
  const rice = next.find((i) => i.name === 'Rice');
  assertEqual(milk.stock, 2, 'bought at Hannaford');
  assertEqual(milk.onList, false);
  assertEqual(rice.stock, 1, "BJ's stock untouched");
  assertEqual(rice.onList, true, "BJ's item still on its list");
  assertEqual(rice.checked, true, "BJ's item still checked");
});

test('completeTrip scoped to a list still drops that list untracked one-offs', () => {
  const items = [
    Store.createItem('Napkins', { onList: true, checked: true, tracked: false, listStore: 'Hannaford' }),
    Store.createItem('Foil', { onList: true, checked: true, tracked: false, listStore: "BJ's Club" })
  ];
  const next = Store.completeTrip(items, null, 'Hannaford');
  assertEqual(next.length, 1);
  assertEqual(next[0].name, 'Foil', 'the other list keeps its one-off');
});

test('completeTrip with no list name is unchanged', () => {
  const items = [
    Store.createItem('Milk', { onList: true, checked: true, tracked: true, stock: 0,
                               listQty: 1, listStore: 'Hannaford' }),
    Store.createItem('Rice', { onList: true, checked: true, tracked: true, stock: 0,
                               listQty: 1, listStore: "BJ's Club" })
  ];
  const next = Store.completeTrip(items);
  assertEqual(next.find((i) => i.name === 'Milk').stock, 1);
  assertEqual(next.find((i) => i.name === 'Rice').stock, 1);
});

test('completeTrip records the price against the list being completed', () => {
  const items = [Store.createItem('Milk', { id: 'm1', onList: true, checked: true,
                                            tracked: true, listStore: 'Hannaford' })];
  const next = Store.completeTrip(items, { store: 'Hannaford', prices: { m1: 3.49 } }, 'Hannaford');
  assertEqual(next[0].prices[0].price, 3.49);
  assertEqual(next[0].prices[0].store, 'Hannaford');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `tests/run-tests.html`. Expected: ✗, `completeTrip scoped to a list leaves other lists alone` fails — `rice.stock` is 6, not 1.

- [ ] **Step 3: Add the list scope**

In `assets/store.js`, replace the `completeTrip` signature and its first loop condition (lines 154-157):

```js
  /* purchase (optional): { store, prices: { [itemId]: number } }. A price is
     recorded only for bought items that have one; blank entries are skipped.

     listName (optional): when set, only that list's checked items are bought.
     You are standing in one store; checking off at another is a different
     trip. Omitted, every checked item is bought — the pre-lists behaviour,
     which keeps old call sites and old tests honest. */
  completeTrip(items, purchase = null, listName = '') {
    const kept = [];
    for (const it of items) {
      const inScope = !listName || it.listStore === listName;
      if (!(it.onList && it.checked && inScope)) { kept.push(it); continue; }
```

Leave the rest of the function unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Reload `tests/run-tests.html`. Expected: ✓ all passing.

- [ ] **Step 5: Commit**

```bash
git add assets/store.js tests/store.test.js
git commit -m "Finish a trip at one store without buying the other store's list"
```

---

### Task 3: Put `list_store` on the sync wire — and on the live table

**Files:**
- Modify: `assets/store.js:662-683` (`toItemRow`, `fromItemRow`), `supabase/schema.sql:45-`
- Test: `tests/store.test.js`
- **External: the live Supabase project.**

**Interfaces:**
- Consumes: `Store.createItem` with `listStore` (Task 1).
- Produces: `toItemRow` emits `list_store`; `fromItemRow` reads it. `Store.normalizeShape` heals `listStore` for free, because it rebuilds through `createItem`.

- [ ] **Step 1: Run the migration against the live project — before any code**

Open the Supabase SQL editor for the live project and run:

```sql
alter table public.items
  add column list_store text not null default '' check (char_length(list_store) <= 60);
```

Verify it landed:

```sql
select column_name from information_schema.columns
 where table_name = 'items' and column_name = 'list_store';
```

Expected: one row. **If this returns nothing, stop.** Shipping the next step without the column makes every upsert fail with 400 while the sync panel still reads "synced".

- [ ] **Step 2: Write the failing tests**

Append to `tests/store.test.js`:

```js
test('toItemRow and fromItemRow round-trip listStore', () => {
  const it = Store.createItem('Milk', { listStore: 'Hannaford' });
  const row = Store.toItemRow(it, 'hh-1');
  assertEqual(row.list_store, 'Hannaford');
  assertEqual(Store.fromItemRow(row).listStore, 'Hannaford');
});

test('toItemRow emits an empty list_store rather than undefined', () => {
  const row = Store.toItemRow(Store.createItem('Milk'), 'hh-1');
  assertEqual(row.list_store, '');
});

test('normalizeShape backfills listStore on a pre-lists record', () => {
  // A record written before this feature has no such KEY. sameRecord compares
  // key sets, so without the backfill it re-queues on every pull forever.
  const old = Store.createItem('Milk');
  delete old.listStore;
  assertEqual(Store.normalizeShape(old).listStore, '');
});

test('a pre-lists local record and its server copy compare equal', () => {
  const old = Store.createItem('Milk', { id: 'm1' });
  delete old.listStore;
  const fromServer = Store.fromItemRow(Store.toItemRow(Store.createItem('Milk', { id: 'm1',
    createdAt: old.createdAt, updatedAt: old.updatedAt }), 'hh-1'));
  assert(Store.sameRecord(Store.normalizeShape(old), Store.normalizeShape(fromServer)),
    'must not re-queue forever — this is gotcha #9');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Reload `tests/run-tests.html`. Expected: ✗, `row.list_store` is `undefined`.

- [ ] **Step 4: Add the field to both mappers**

In `assets/store.js`, in `toItemRow` (line 662), add after the `on_list` line:

```js
      on_list: !!item.onList, list_qty: item.listQty, checked: !!item.checked,
      list_store: item.listStore || '',
```

In `fromItemRow` (line 674), add after the `onList` line:

```js
      onList: row.on_list, listQty: row.list_qty, checked: row.checked,
      listStore: row.list_store || '',
```

- [ ] **Step 5: Record the column in the schema file**

In `supabase/schema.sql`, in the `create table public.items` block, add after the `checked` line:

```sql
  list_store        text    not null default ''      check (char_length(list_store) <= 60),
```

Add above the `create table` a comment recording that this is a record, not a migration:

```sql
-- list_store added 2026-08-25 (per-store lists). Run against live projects:
--   alter table public.items
--     add column list_store text not null default '' check (char_length(list_store) <= 60);
```

- [ ] **Step 6: Run the tests to verify they pass**

Reload `tests/run-tests.html`. Expected: ✓ all passing.

- [ ] **Step 7: Commit**

```bash
git add assets/store.js supabase/schema.sql tests/store.test.js
git commit -m "Carry the list name over sync, with the column it needs"
```

---

### Task 4: Current list, roster persistence, and migration

**Files:**
- Modify: `assets/app.js:2` (`state`), `assets/app.js:1733` (`boot`)
- Test: manual, in the browser console (this is DB/state wiring, not pure logic)

**Interfaces:**
- Consumes: `Store.listRoster`, `Store.itemsForList` (Task 1); `DB.getSetting(key, fallback)`, `DB.putSetting(key, value)` (existing, `store.js:781`/`787`); `commitAll(items, meals)` (existing, `app.js:144`).
- Produces:
  - `state.roster` — `string[]`
  - `state.currentList` — `string`
  - `saveRoster()` → Promise, persists `state.roster`
  - `setCurrentList(name)` → Promise, persists and re-renders
  - Settings keys: `'lists.roster'`, `'lists.current'`

- [ ] **Step 1: Extend the state object**

In `assets/app.js`, replace line 2:

```js
const state = { items: [], meals: [], displayName: '', roster: [], currentList: '' };
```

- [ ] **Step 2: Add the roster helpers**

In `assets/app.js`, insert after the `state` declaration:

```js
/* ── Lists ───────────────────────────────────────────────────────────────
   The roster is the ordered set of list names. It is persisted separately
   from the items because it is the ONLY record of a list with nothing on
   it — a non-empty list is derivable from the items themselves. */
const ROSTER_KEY = 'lists.roster';
const CURRENT_KEY = 'lists.current';

async function saveRoster() {
  state.roster = Store.listRoster(state.items, state.roster);
  try { await DB.putSetting(ROSTER_KEY, state.roster); }
  catch (e) { showBanner('Save failed — changes may not persist.'); }
}

async function setCurrentList(name) {
  state.currentList = name;
  render();
  try { await DB.putSetting(CURRENT_KEY, name); } catch (e) { /* view state only */ }
}
```

- [ ] **Step 3: Add the migration and the boot load**

In `assets/app.js`, inside `boot()` (line 1733), after `state.items` and `state.meals` are loaded from the DB and before the first `render()`, insert:

```js
  /* One-time migration. The owner's existing list IS the Hannaford list —
     their decision, not a guess. The absence of the roster setting is the
     "not yet migrated" marker.

     Only ON-LIST items are stamped. Stamping every item would rewrite the
     whole table and queue every record in the outbox to say nothing. An
     off-list item picks up a list when it is next added. */
  let roster = await DB.getSetting(ROSTER_KEY, null);
  if (roster === null) {
    const onList = state.items.filter((it) => it.onList && !it.listStore);
    if (onList.length) {
      const stamped = new Set(onList.map((it) => it.id));
      await commitAll(
        state.items.map((it) => stamped.has(it.id)
          ? Store.update(it, { listStore: 'Hannaford' })
          : it),
        null
      );
    }
    roster = ['Hannaford'];
    await DB.putSetting(ROSTER_KEY, roster);
  }
  state.roster = Store.listRoster(state.items, roster);
  if (!state.roster.length) state.roster = ['Hannaford'];

  /* A list deleted on another device can leave a dangling current. */
  const saved = await DB.getSetting(CURRENT_KEY, '');
  state.currentList = state.roster.includes(saved) ? saved : state.roster[0];
```

- [ ] **Step 4: Verify the migration in the browser**

Start the server and open the app in **one** tab:

```bash
python3 -m http.server 8000
```

Clear the service worker first, or you will test yesterday's code:

```js
(async () => { const rs = await navigator.serviceWorker.getRegistrations();
  for (const r of rs) await r.unregister();
  const ks = await caches.keys(); for (const k of ks) await caches.delete(k);
  return 'cleared ' + rs.length; })()
```

Reload, then in the console:

```js
JSON.stringify({ roster: state.roster, current: state.currentList,
  stamped: state.items.filter(i => i.listStore === 'Hannaford').length,
  onList: state.items.filter(i => i.onList).length,
  offListStamped: state.items.filter(i => !i.onList && i.listStore).length })
```

Expected: `roster: ["Hannaford"]`, `current: "Hannaford"`, `stamped` equals `onList`, and `offListStamped: 0`.

- [ ] **Step 5: Verify the migration does not run twice**

Reload again and run:

```js
(async () => JSON.stringify({
  roster: await DB.getSetting('lists.roster', null),
  outbox: (await DB.outboxAll()).length }))()
```

Expected: roster is `["Hannaford"]`. The outbox count should fall to 0 after a sync and stay there — a count that never drains is gotcha #9.

- [ ] **Step 6: Commit**

```bash
git add assets/app.js
git commit -m "Remember which list you are on, and make the old one Hannaford"
```

---

### Task 5: The stacked header and list-scoped rendering

**Files:**
- Modify: `index.html:21-28` (the `.appbar` block), `assets/style.css:84-90`, `assets/app.js:170-201` (`renderList`)
- Test: browser

**Interfaces:**
- Consumes: `state.currentList`, `state.roster` (Task 4); `Store.itemsForList` (Task 1).
- Produces: DOM ids `#list-store` (the `- Hannaford` span) and `#list-dots` (the page dots container).

- [ ] **Step 1: Replace the header markup**

In `index.html`, replace lines 21-22 (the `<h1>` and the `.sub` span) with:

```html
  <!-- The title stacks deliberately: "- Hannaford" then sits both beside
       "List" and beneath "Shopping", which is what the owner asked for, and
       stacking is what makes a long name like "BJ's Wholesale Club" fit
       without colliding with the Recipes button. On one line the row
       measures ~476px against 390px of phone. -->
  <h1 id="list-title">Shopping<span class="title-l2">List <em id="list-store"></em></span></h1>
  <span class="sub" id="list-sub"></span>
  <span id="list-dots" aria-hidden="true"></span>
```

- [ ] **Step 2: Style the stack, the dots and the swipe surface**

In `assets/style.css`, replace lines 84-86 with:

```css
/* The header block is the swipe surface for changing lists, so it is a
   grid rather than a baseline row: the title stacks, the count sits under
   it, and the two buttons pin to the right across both rows. */
.appbar { padding: 20px 18px 8px; display: grid; gap: 0 10px;
          grid-template-columns: 1fr auto auto; align-items: start;
          position: relative; touch-action: pan-y; user-select: none;
          transition: background 140ms ease; }
.appbar.armed { background: var(--fill); }
.appbar h1 { font-size: 24px; line-height: 1.08; grid-column: 1; }
.appbar .title-l2 { display: block; }
.appbar h1 em { font-style: normal; font-size: 12px; color: var(--muted); font-weight: 400; }
.appbar .sub { font-size: 12px; color: var(--muted); grid-column: 1; margin-top: 6px; }
#list-dots { grid-column: 1 / -1; position: absolute; right: 18px; top: 22px;
             display: flex; gap: 5px; }
#list-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--hairline); }
#list-dots i.on { background: var(--muted); }
```

Then change the two button rules on lines 89-90 so they sit in the grid rather than relying on `margin-left: auto`:

```css
#recipes-link { grid-column: 2; grid-row: 1; border: 1px solid var(--hairline); color: var(--muted); border-radius: 6px; padding: 4px 10px; font-size: 14px; text-decoration: none; }
#settings-btn { grid-column: 3; grid-row: 1; background: none; border: 1px solid var(--hairline); color: var(--muted); border-radius: 6px; padding: 4px 10px; font-size: 14px; }
```

- [ ] **Step 3: Scope `renderList` to the current list**

In `assets/app.js`, replace lines 171-176 of `renderList`:

```js
  const listEl = document.getElementById('list');
  const onList = Store.itemsForList(state.items, state.currentList);
  const checkedCount = onList.filter((it) => it.checked).length;
  document.getElementById('list-store').textContent =
    state.currentList ? `- ${state.currentList}` : '';
  document.getElementById('list-sub').textContent =
    onList.length ? `${onList.length} item${onList.length === 1 ? '' : 's'} · ${checkedCount} checked` : '';
  document.getElementById('complete-trip').hidden = checkedCount === 0;

  /* One dot says nothing. With a single list the store name alone carries it. */
  document.getElementById('list-dots').innerHTML = state.roster.length > 1
    ? state.roster.map((n) => `<i class="${n === state.currentList ? 'on' : ''}"></i>`).join('')
    : '';
```

- [ ] **Step 4: Point the add paths at the current list**

In `assets/app.js`, find every place that puts an item on the list and set `listStore` alongside `onList`. There are four:

1. The add-form submit handler — where a new item is created, pass `listStore: state.currentList` in the `createItem` opts.
2. `Store.toggleOnList` call sites (inventory tile tap) — replace `commit(Store.toggleOnList(item))` with:

```js
commit(item.onList
  ? Store.toggleOnList(item)
  : Store.moveItemToList(item, state.currentList));
```

3. The meal pre-flight "Add to list" handler — same substitution for each item added.
4. The autocomplete "add existing item" path — same substitution.

Find them with:

```bash
grep -n "toggleOnList\|onList: true" assets/app.js
```

- [ ] **Step 5: Scope trip completion to the current list**

In `assets/app.js`, find the trip-form submit handler and pass the list name as the third argument:

```bash
grep -n "completeTrip" assets/app.js
```

Change `Store.completeTrip(state.items, purchase)` to `Store.completeTrip(state.items, purchase, state.currentList)`.

In the same handler, prefill the store field when the dialog opens:

```js
document.querySelector('#trip-form [name=store]').value = state.currentList;
```

- [ ] **Step 6: Verify in the browser**

Clear the service worker (snippet in Task 4 Step 4), reload, then:

```js
JSON.stringify({
  title: document.getElementById('list-title').innerText,
  store: document.getElementById('list-store').textContent,
  sub: document.getElementById('list-sub').textContent,
  dots: document.getElementById('list-dots').children.length,
  bodyScrollsSideways: document.body.scrollWidth > document.body.clientWidth })
```

Expected: `title` contains a newline between "Shopping" and "List", `store` is `"- Hannaford"`, `dots` is `0` with one list, and `bodyScrollsSideways` is `false`.

- [ ] **Step 7: Commit**

```bash
git add index.html assets/style.css assets/app.js
git commit -m "Name the list in the header and show only that list"
```

---

### Task 6: The swipe gesture on the header block

**Files:**
- Modify: `assets/app.js` (append a new IIFE near the row-swipe block at line 654)
- Test: browser, by dispatching events

**Interfaces:**
- Consumes: `Store.nextList` (Task 1); `state.roster`, `state.currentList`, `setCurrentList` (Task 4).
- Produces: `switchList(dir)` — `dir` is `1` (next) or `-1` (previous). Task 7 replaces its body with the animated version.

- [ ] **Step 1: Add the gesture**

In `assets/app.js`, append after the existing row-swipe IIFE:

```js
/* ── Swipe the header block to change lists ──────────────────────────────
   The block, not the list body. A horizontal swipe on a ROW already means
   delete — a row lifts after a 500ms hold or the instant it moves 6px
   sideways, then flings off. Putting the pager on the block leaves that
   gesture completely untouched.

   Two input paths because a Mac and a phone deliver this differently:
   wheel+deltaX is a trackpad two-finger swipe, pointer events are a finger
   drag or a click-drag. Same threshold so both feel alike. */
(function () {
  const SWIPE_PX = 55;
  const bar = document.querySelector('.appbar');
  let animating = false;

  function arm(on) { bar.classList.toggle('armed', !!on); }

  window.switchList = function (dir) {
    if (animating) return;
    const next = Store.nextList(state.roster, state.currentList, dir);
    if (next === null) return;   // no wrap-around; Task 8 adds the "+ New" card
    setCurrentList(next);
  };

  /* Trackpad momentum keeps firing deltaX long after the fingers lift, so
     one flick would otherwise fire three switches. Accumulate to the
     threshold, act once, then stay locked until the stream goes quiet. */
  let acc = 0, locked = false, quiet = null;
  bar.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;  // vertical: let it scroll
    e.preventDefault();
    clearTimeout(quiet);
    quiet = setTimeout(() => { acc = 0; locked = false; arm(false); }, 280);
    if (locked) return;
    acc += e.deltaX;
    arm(Math.abs(acc) > 12);
    if (Math.abs(acc) > SWIPE_PX) { locked = true; arm(false); switchList(acc > 0 ? 1 : -1); }
  }, { passive: false });

  let x0 = null, fired = false;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a')) return;   // the gear and Recipes still work
    x0 = e.clientX; fired = false;
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
  });
  bar.addEventListener('pointermove', (e) => {
    if (x0 === null || fired) return;
    const dx = e.clientX - x0;
    arm(Math.abs(dx) > 10);
    if (Math.abs(dx) > SWIPE_PX) { fired = true; arm(false); switchList(dx < 0 ? 1 : -1); }
  });
  const end = () => { x0 = null; fired = false; arm(false); };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  bar.addEventListener('pointerleave', end);

  window.__setListAnimating = (v) => { animating = v; };  // Task 7 uses this
})();
```

- [ ] **Step 2: Verify all four gesture paths in the browser**

Clear the service worker, reload, then create a second list by hand so there is somewhere to swipe to:

```js
(async () => { state.roster = ['Hannaford', "BJ's Club"];
  await DB.putSetting('lists.roster', state.roster); render(); return state.roster; })()
```

Then run the gesture test:

```js
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const bar = document.querySelector('.appbar');
  const out = { start: state.currentList };
  for (let i = 0; i < 8; i++) bar.dispatchEvent(new WheelEvent('wheel',
    { deltaX: 14, deltaY: 1, bubbles: true, cancelable: true }));
  await wait(300); out.afterWheel = state.currentList;
  for (let i = 0; i < 8; i++) bar.dispatchEvent(new WheelEvent('wheel',
    { deltaX: 3, deltaY: 0, bubbles: true, cancelable: true }));
  await wait(400); out.afterMomentumTail = state.currentList;
  for (let i = 0; i < 10; i++) bar.dispatchEvent(new WheelEvent('wheel',
    { deltaX: 2, deltaY: 40, bubbles: true, cancelable: true }));
  await wait(300); out.afterVerticalScroll = state.currentList;
  bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 40, bubbles: true, pointerId: 1 }));
  bar.dispatchEvent(new PointerEvent('pointermove', { clientX: 290, clientY: 42, bubbles: true, pointerId: 1 }));
  bar.dispatchEvent(new PointerEvent('pointerup',   { clientX: 290, clientY: 42, bubbles: true, pointerId: 1 }));
  await wait(300); out.afterRightDrag = state.currentList;
  return JSON.stringify(out);
})()
```

Expected exactly:

```
start: "Hannaford", afterWheel: "BJ's Club", afterMomentumTail: "BJ's Club",
afterVerticalScroll: "BJ's Club", afterRightDrag: "Hannaford"
```

`afterMomentumTail` differing from `afterWheel` means the lock is broken and one flick fires twice.

- [ ] **Step 3: Verify the gear button still works**

```js
document.getElementById('settings-btn').click();
document.getElementById('settings-dialog').open   // expected: true
```

Then close it. A swipe handler that swallows the button press is the likeliest regression here.

- [ ] **Step 4: Commit**

```bash
git add assets/app.js
git commit -m "Swipe the header block to change lists"
```

---

### Task 7: The inhale animation

**Files:**
- Modify: `assets/style.css` (append), `assets/app.js` (replace the body of `switchList` from Task 6)
- Test: browser

**Interfaces:**
- Consumes: `switchList(dir)`, `window.__setListAnimating` (Task 6); `renderList` (Task 5).
- Produces: nothing new. `switchList` becomes async internally but keeps its signature.

**Timing — copy these numbers exactly.** They were chosen against a live prototype:

| | value |
|---|---|
| Out | 140ms, `cubic-bezier(.55,.06,.68,.19)`, 14ms stagger, bottom row first |
| In | 170ms, `cubic-bezier(.22,.9,.31,1.18)`, 16ms stagger, top row first |
| Squash | `scale(0.55, 0.04)` at the dock point |
| Dock point | header block centre, 62% down its height |
| Stagger cap | 180ms accumulated, each direction |

- [ ] **Step 1: Add the reduced-motion rule**

Append to `assets/style.css`:

```css
/* The list-switch animation is driven by inline styles from app.js, so the
   opt-out is a flag the script reads rather than a transition override. */
@media (prefers-reduced-motion: reduce) {
  #list.switching { transition: opacity 90ms linear; }
}
```

- [ ] **Step 2: Replace `switchList` with the animated version**

In `assets/app.js`, replace the `window.switchList` function body from Task 6 with:

```js
  /* ── The inhale ────────────────────────────────────────────────────────
     Rows rise into the header block, squashing to a sliver; the block
     relabels itself while the list is inside it, which is what sells the
     block as the thing holding the list; the next list drops back out.

     The stagger cap is load-bearing, not polish: uncapped, an 18-item list
     takes three times as long as a 4-item one. Capped it costs ~170ms more.

     The landing curve overshoots. That is deliberate and owner-chosen over
     ease-out-expo, and it matches the row-swipe spring-back already
     shipping at the bottom of the row-drag release handler. */
  const OUT_MS = 140, OUT_STAGGER = 14, OUT_EASE = 'cubic-bezier(.55,.06,.68,.19)';
  const IN_MS  = 170, IN_STAGGER  = 16, IN_EASE  = 'cubic-bezier(.22,.9,.31,1.18)';
  const SQUASH = 'scale(0.55, 0.04)';
  const STAGGER_CAP = 180;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = (el) => [...el.querySelectorAll('.row, .cat')];
  const dockY = () => {
    const b = bar.getBoundingClientRect();
    return b.top + b.height * 0.62;
  };

  window.switchList = function (dir) {
    if (animating) return;
    const next = Store.nextList(state.roster, state.currentList, dir);
    if (next === null) return;

    const listEl = document.getElementById('list');

    if (reduced()) { setCurrentList(next); return; }

    animating = true;
    const out = parts(listEl);
    const n = out.length;
    const outStep = n > 1 ? Math.min(OUT_STAGGER, STAGGER_CAP / (n - 1)) : 0;
    const y = dockY();

    out.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dy = y - (r.top + r.height / 2);
      const d = n - 1 - i;                       // bottom row leaves first
      el.style.transformOrigin = '50% 50%';
      el.style.transition =
        `transform ${OUT_MS}ms ${OUT_EASE} ${d * outStep}ms, ` +
        `opacity ${OUT_MS}ms linear ${d * outStep + OUT_MS * 0.35}ms`;
      el.style.transform = `translate(0, ${dy}px) ${SQUASH}`;
      el.style.opacity = '0';
    });

    setTimeout(() => {
      state.currentList = next;
      DB.putSetting(CURRENT_KEY, next).catch(() => {});
      renderList();                              // relabels the block and the dots

      const inn = parts(listEl);
      const m = inn.length;
      const inStep = m > 1 ? Math.min(IN_STAGGER, STAGGER_CAP / (m - 1)) : 0;
      const y2 = dockY();

      inn.forEach((el) => {
        const r = el.getBoundingClientRect();
        const dy = y2 - (r.top + r.height / 2);
        el.style.transition = 'none';
        el.style.transformOrigin = '50% 50%';
        el.style.transform = `translate(0, ${dy}px) ${SQUASH}`;
        el.style.opacity = '0';
      });
      void listEl.offsetHeight;                  // commit the "from" pose

      inn.forEach((el, i) => {
        el.style.transition =
          `transform ${IN_MS}ms ${IN_EASE} ${i * inStep}ms, ` +
          `opacity ${Math.round(IN_MS * 0.5)}ms linear ${i * inStep}ms`;
        el.style.transform = '';
        el.style.opacity = '1';
      });

      setTimeout(() => {
        inn.forEach((el) => { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; });
        animating = false;
      }, IN_MS + (m - 1) * inStep + 40);
    }, OUT_MS + (n - 1) * outStep + 16);
  };
```

- [ ] **Step 3: Verify the animation settles clean**

Clear the service worker, reload, ensure two lists exist (Task 6 Step 2 snippet), put a few items on each, then:

```js
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const t0 = performance.now();
  switchList(1);
  await wait(1200);
  const rows = [...document.querySelectorAll('#list .row')];
  return JSON.stringify({
    elapsedBudgetMs: Math.round(performance.now() - t0),
    list: state.currentList,
    header: document.getElementById('list-store').textContent,
    rows: rows.length,
    residualTransforms: rows.filter(e => e.style.transform).length,
    residualOpacity: rows.filter(e => e.style.opacity).length,
    opacities: [...new Set(rows.map(e => getComputedStyle(e).opacity))]
  });
})()
```

Expected: `list` and `header` show the other list, `residualTransforms: 0`, `residualOpacity: 0`, `opacities: ["1"]`. A leftover transform means a row is stuck mid-flight and will look broken on the next render.

- [ ] **Step 4: Verify the stagger cap on a long list**

```js
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 18; i++) {
    state.items.push(Store.createItem('Filler ' + i,
      { onList: true, listStore: state.currentList, category: 'Pantry' }));
  }
  render(); await wait(60);
  const n = document.querySelectorAll('#list .row, #list .cat').length;
  const t0 = performance.now();
  switchList(1);
  await wait(1400);
  return JSON.stringify({ elements: n, wallClockMs: Math.round(performance.now() - t0) });
})()
```

Expected: with ~19 elements the switch still completes well inside the 1400ms wait. Uncapped it would need `140 + 18*14 = 392ms` out plus the same again in; capped, each direction tops out at `140+180` and `170+180`. Reload afterwards to discard the filler items — they were pushed to `state` only, not committed.

- [ ] **Step 5: Verify reduced motion skips it**

```js
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const before = state.currentList;
  // Emulate via devtools rendering panel, or trust the branch:
  return JSON.stringify({ branchExists: /reduced\(\)/.test(switchList.toString()), before });
})()
```

Then set **Emulate CSS prefers-reduced-motion: reduce** in the devtools Rendering panel, call `switchList(1)`, and confirm the list changes with no movement.

- [ ] **Step 6: Commit**

```bash
git add assets/app.js assets/style.css
git commit -m "Inhale the list into the header and drop the next one out"
```

---

### Task 8: Creating, renaming and deleting lists

**Files:**
- Modify: `index.html` (Settings menu, item dialog), `assets/style.css` (append), `assets/app.js`
- Test: `tests/store.test.js` for the pure part, browser for the UI

**Interfaces:**
- Consumes: `Store.renameList`, `Store.clearList`, `Store.moveItemToList`, `Store.listRoster` (Task 1); `saveRoster`, `setCurrentList` (Task 4); `commitAll` (existing).
- Produces: `Store.canAddList(roster, name) → { ok: boolean, reason: string }`.

- [ ] **Step 1: Write the failing test for name validation**

Append to `tests/store.test.js`:

```js
test('canAddList rejects blanks and duplicates, case-insensitively', () => {
  const r = ['Hannaford'];
  assertEqual(Store.canAddList(r, "BJ's Club").ok, true);
  assertEqual(Store.canAddList(r, '   ').ok, false);
  assertEqual(Store.canAddList(r, 'hannaford').ok, false, 'duplicate is rejected, never merged');
  assertEqual(Store.canAddList(r, ' Hannaford ').ok, false);
  assertEqual(Store.canAddList(r, 'x'.repeat(61)).ok, false, 'over the column check constraint');
  assertEqual(Store.canAddList(r, 'x'.repeat(60)).ok, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Reload `tests/run-tests.html`. Expected: ✗, `Store.canAddList is not a function`.

- [ ] **Step 3: Implement `canAddList`**

In `assets/store.js`, add after `moveItemToList`:

```js
  /* 60 is not arbitrary: it is the check constraint on items.list_store.
     Rejecting here means a too-long name never reaches PostgREST, where it
     would fail the whole upsert batch. */
  canAddList(roster, name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return { ok: false, reason: 'Give the list a name.' };
    if (trimmed.length > 60) return { ok: false, reason: 'That name is too long.' };
    const lower = trimmed.toLowerCase();
    if ((roster || []).some((n) => n.trim().toLowerCase() === lower)) {
      return { ok: false, reason: `You already have a ${trimmed} list.` };
    }
    return { ok: true, reason: '' };
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Reload `tests/run-tests.html`. Expected: ✓ all passing.

- [ ] **Step 5: Add the "＋ New list" card at the end of the roster**

In `assets/app.js`, in the `switchList` function from Task 7, replace the early return:

```js
    const next = Store.nextList(state.roster, state.currentList, dir);
    if (next === null) {
      // Past the last list is a chance to make one. Past the first is nothing.
      if (dir > 0) promptNewList();
      return;
    }
```

Add the prompt near the other dialog helpers:

```js
/* A prompt(), not a dialog: naming a list is one field, and this app already
   uses confirm() for the destructive paths. The card is not a list until it
   is named — cancelling leaves the roster untouched. */
async function promptNewList() {
  const raw = prompt('Name the new list');
  if (raw === null) return;
  const check = Store.canAddList(state.roster, raw);
  if (!check.ok) { showBanner(check.reason); return; }
  const name = raw.trim();
  state.roster = [...state.roster, name];
  await saveRoster();
  setCurrentList(name);
}
```

- [ ] **Step 6: Make the store name in the header tappable to rename**

In `assets/app.js`, add near the other listeners:

```js
document.getElementById('list-store').addEventListener('click', async (e) => {
  e.stopPropagation();                     // do not arm the swipe
  const from = state.currentList;
  const raw = prompt('Rename this list', from);
  if (raw === null || raw.trim() === from) return;
  const check = Store.canAddList(state.roster.filter((n) => n !== from), raw);
  if (!check.ok) { showBanner(check.reason); return; }
  const to = raw.trim();
  // Rewrites every member of the list — the price of storing a list as a name.
  await commitAll(Store.renameList(state.items, from, to), null);
  state.roster = state.roster.map((n) => (n === from ? to : n));
  await saveRoster();
  setCurrentList(to);
});
```

Give it a hit target in `assets/style.css`:

```css
.appbar h1 em { cursor: pointer; padding: 2px 4px; margin: -2px -4px; border-radius: 4px; }
.appbar h1 em:active { background: var(--fill); }
```

- [ ] **Step 7: Add the Settings "Lists" section**

In `index.html`, inside the settings `<menu>`, before the `<section id="sync-panel">`:

```html
    <h4 class="settings-head">Lists</h4>
    <div id="lists-manage"></div>
    <p class="dialog-note">Deleting a list takes its items off the list. Stock and inventory are not affected.</p>
```

In `assets/app.js`, render and wire it:

```js
function renderListsManage() {
  const el = document.getElementById('lists-manage');
  if (!el) return;
  el.innerHTML = state.roster.map((name, i) => {
    const count = Store.itemsForList(state.items, name).length;
    return `<div class="list-row" data-list="${escapeHtml(name)}">
      <span class="list-name">${escapeHtml(name)}</span>
      <span class="list-count">${count} item${count === 1 ? '' : 's'}</span>
      <button data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button data-act="down" ${i === state.roster.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button data-act="del" class="btn-danger" ${state.roster.length === 1 ? 'disabled' : ''}
              aria-label="Delete list">✕</button>
    </div>`;
  }).join('');
}

document.getElementById('lists-manage').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const name = btn.closest('.list-row').dataset.list;
  const i = state.roster.indexOf(name);
  const act = btn.dataset.act;

  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    const next = [...state.roster];
    [next[i], next[j]] = [next[j], next[i]];
    state.roster = next;
    await saveRoster();
    renderListsManage();
    render();
    return;
  }

  if (act === 'del') {
    const count = Store.itemsForList(state.items, name).length;
    const msg = count
      ? `Delete the ${name} list? ${count} item${count === 1 ? '' : 's'} will come off the list. Stock and inventory are not affected.`
      : `Delete the ${name} list?`;
    if (!confirm(msg)) return;
    if (count) await commitAll(Store.clearList(state.items, name), null);
    state.roster = state.roster.filter((n) => n !== name);
    await saveRoster();
    if (state.currentList === name) await setCurrentList(state.roster[0]);
    renderListsManage();
    render();
  }
});
```

Call `renderListsManage()` wherever the settings dialog is opened. Find it with:

```bash
grep -n "settings-dialog" assets/app.js
```

Style it in `assets/style.css`:

```css
.list-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
            background: var(--fill); border-radius: 8px; margin-bottom: 6px; }
.list-row .list-name { font-weight: 600; }
.list-row .list-count { color: var(--muted); font-size: 12px; margin-left: auto; }
.list-row button { border: 1px solid var(--hairline); background: var(--surface);
                   color: var(--ink); border-radius: 6px; padding: 2px 8px; font-size: 13px; }
.list-row button[disabled] { opacity: .35; }
```

- [ ] **Step 8: Add the list field to the item dialog**

In `index.html`, in `#item-form`, after the Category picker block:

```html
    <div class="field">List
      <button type="button" id="list-btn" class="picker-btn"
              aria-expanded="false" aria-controls="list-picker">
        <span id="list-current"></span>
      </button>
      <div id="list-picker" class="picker-list" hidden></div>
    </div>
```

In `assets/app.js`, in `openItemDialog(item)` (line 1017), populate it from `state.roster` following the exact pattern `renderCategoryList` uses (line 956) — radios named `list`, current value always included. In the item-form submit handler, read `form.elements.list.value` and pass it as `listStore`.

- [ ] **Step 9: Verify the whole management flow in the browser**

Clear the service worker, reload, then:

```js
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const before = state.roster.slice();
  state.roster = ['Hannaford']; await saveRoster();
  // create
  window.prompt = () => "BJ's Club";
  await promptNewList(); await wait(50);
  const created = state.roster.slice();
  // rename
  window.prompt = () => 'BJs';
  document.getElementById('list-store').click(); await wait(150);
  const renamed = state.roster.slice();
  const stamped = state.items.filter(i => i.listStore === 'BJs').length;
  return JSON.stringify({ before, created, renamed, currentList: state.currentList, stamped });
})()
```

Expected: `created` is `["Hannaford","BJ's Club"]`, `renamed` is `["Hannaford","BJs"]`, `currentList` is `"BJs"`. Reload afterwards to restore a real `window.prompt`.

Then check duplicate rejection and delete-clears-not-destroys by hand: open ⚙, try adding a list named `hannaford` (expect the banner "You already have a Hannaford list."), then delete a list holding items and confirm in the console that those items still exist with their stock intact:

```js
JSON.stringify(state.items.filter(i => !i.onList && i.listStore)
  .map(i => ({ name: i.name, stock: i.stock, tracked: i.tracked, was: i.listStore })))
```

- [ ] **Step 10: Commit**

```bash
git add index.html assets/style.css assets/app.js assets/store.js tests/store.test.js
git commit -m "Make, rename, reorder and delete lists"
```

---

### Task 9: Ship it

**Files:**
- Modify: `sw.js:1`, `HANDOFF.md`
- Test: full suite + a real device

- [ ] **Step 1: Bump the service worker cache**

In `sw.js`, line 1:

```js
const CACHE = 'grocery-v49';
```

Without this an already-installed PWA keeps serving the old files and the entire feature is invisible on the phone even though the deploy succeeded.

- [ ] **Step 2: Run the full test suite**

Open `tests/run-tests.html` in **one** tab. Expected: the title shows `✓ all passing`. Before trusting green, confirm the loaded source is yours:

```js
/canAddList/.test(Store.canAddList && Store.canAddList.toString())
```

`false` means you are looking at a cached file, not your code.

- [ ] **Step 3: Confirm the live column exists**

In the Supabase SQL editor:

```sql
select column_name from information_schema.columns
 where table_name = 'items' and column_name = 'list_store';
```

Expected: one row. If this is empty, **do not merge** — every upsert will 400 while the sync panel reads "synced".

- [ ] **Step 4: Confirm the outbox drains**

In the app console, twice in a row about a minute apart:

```js
(async () => JSON.stringify({ cursor: await DB.getSetting('sync.cursor', null),
  outbox: (await DB.outboxAll()).length, status: Sync.status, lastError: Sync.lastError }))()
```

Expected: `outbox` reaches 0 and stays. A non-zero count that never falls is gotcha #9 or #11 — a record re-queuing on every pull.

- [ ] **Step 5: Update HANDOFF.md**

Add to the Layout section's description of `store.js`, and to Status:

```
**V7 — per-store lists (built 2026-08-25).** One list per store; `item.listStore`
holds the name. A list is a name, not a record — the roster of names lives in
the `lists.roster` setting, which exists so an EMPTY list survives; non-empty
lists are derivable from the items. Deliberately NOT a `lists` table: that
would have meant new RLS policies, a third reconciler path and tombstones for
lists, roughly doubling the feature for referential integrity over a handful of
strings.

The swipe lives on the header block, not the list body, because a horizontal
swipe on a row already means delete. Do not move it onto the rows.

`completeTrip` takes an optional third argument, the list name. Omitted, it
behaves exactly as before — that is what keeps the pre-lists tests honest.

Added `items.list_store` to the live table on 2026-08-25.
```

- [ ] **Step 6: Register the easing waiver**

The landing curve is flagged by the design hook as dated easing. It is owner-chosen after a live side-by-side against ease-out-expo:

```bash
node .claude/skills/impeccable/scripts/hook-admin.mjs ignore-value bounce-easing "cubic-bezier(.22, .9, .31, 1.18)" --shared --reason "Owner chose the bounce for the Inhale list-switch landing over ease-out-expo; matches the shipped row-swipe spring-back"
```

Already registered during design. Verify rather than re-run:

```bash
cat .impeccable/config.json
```

Note `.impeccable/` is gitignored, so this waiver is machine-local. The durable record is the spec's "Deliberate deviations" section.

- [ ] **Step 7: Merge to main**

```bash
git add sw.js HANDOFF.md
git commit -m "Ship per-store lists"
git checkout main && git merge --no-ff - && git push
```

Cloudflare Pages publishes within about a minute.

- [ ] **Step 8: Verify on the real phone**

The gestures **have never been tested on a real device** — this is a standing note in HANDOFF, not a new risk. On the phone, after the PWA updates:

1. The title reads "Shopping / List - Hannaford" on two lines.
2. Swiping the header block left changes lists; swiping a row still deletes it.
3. The inhale animation runs at a speed you actually want.
4. Completing a trip at one list leaves the other list's checked items alone.

---

## Self-Review

**Spec coverage:** every section maps to a task — data model and the six pure functions (1), trip scoping (2), schema and sync (3), migration and current-list persistence (4), header and rendering (5), gesture (6), animation (7), list CRUD and the item-dialog list field (8), rollout including the CACHE bump and the `alter table` verification (9).

**Not implemented, by design, and recorded in the spec's "Known rough edges":** per-store `last_trip_at`; a synced roster (the roster is a local setting, so an *empty* list does not reach the other device — non-empty lists always do, because they derive from items).

**Type consistency checked:** `listStore` (camel, JS) vs `list_store` (snake, wire) used consistently; `Store.nextList(roster, current, dir)` with `dir` as `1`/`-1` in both Tasks 6 and 7; `completeTrip(items, purchase, listName)` third-argument order matches between Tasks 2 and 5; `canAddList` returns `{ ok, reason }` in Tasks 8 Step 3 and its two call sites.
