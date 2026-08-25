# Per-Store Lists — Design Spec

Date: 2026-08-25
Status: Approved pending user review

## Overview

One shopping list becomes several, one per store. The header names the list you
are on, a swipe across the header block moves between them, and the items
animate out of one list and into the next as though the header block were the
Mac dock swallowing a window.

The existing list is not migrated to a nameless bucket — it *is* the Hannaford
list, by the owner's decision.

## Goals

- Keep one list per store, so what you see is what you can actually buy where
  you are standing.
- Move between lists with a gesture, not a menu.
- Make the switch legible: you should see where the old list went and where the
  new one came from.

## Non-goals

- An item on two lists at once. One item, one list, with an explicit move.
- A `lists` table in Postgres. A list is a name, not a record. See "Data model".
- Per-store trip history or per-store `last_trip_at`. Out of scope; see
  "Known rough edges".
- Reworking `onList` into a nullable list reference. See "Data model".

## Data model

**A list is a name string on the item.** `item.listStore` holds the store name;
`''` means the item predates the feature or sits on no named list.

```js
createItem(name, opts) → { …, onList, listQty, checked, listStore: '' , … }
```

The set of lists is the distinct `listStore` values across live items, unioned
with a **roster** — an ordered array of names — so that an empty list still
exists and holds its position.

### Why not first-class list records

A `lists` table would buy referential integrity and one-row renames. It would
cost a new synced entity: table, RLS policies, a third reconciler path beside
items and meals, tombstones for deleted lists, and changes to `mergeImport`,
`serialize` and `validateImport`. That is most of the work of the whole feature,
spent on integrity for a handful of strings in a single-household app.

Renaming a list therefore rewrites `listStore` on every item on it — a bulk
write, which the app already performs for trips, imports and restores.

### Why `onList` stays

`onList` is threaded through rendering, trip completion, meals, export and the
reconciler. Collapsing it into "`listStore === null` means not on a list" would
touch far more code than this feature should. The two fields are redundant by
design: `onList` says whether the item is on *a* list, `listStore` says which.

**Invariant:** `onList === false` implies `listStore` is ignored, never read.
Taking an item off a list sets `onList: false` and leaves `listStore` alone, so
re-adding it returns it to the store it came from.

### Roster storage

The roster syncs as a household setting so an empty list reaches the other
device. An empty list is the only thing the roster is load-bearing for —
non-empty lists are derivable from the items themselves, so a roster that fails
to sync degrades to "empty lists are local", not to data loss.

### Migration

On first boot after the upgrade, if the roster setting is absent:

1. Stamp `listStore: 'Hannaford'` on every item with `onList === true`.
2. Seed the roster to `['Hannaford']`.
3. Write the roster setting, which is also the "already migrated" marker.

Items **not** on the list keep `listStore: ''` and are not touched — stamping
all of them would rewrite the entire item table and queue every record in the
outbox for nothing. An off-list item picks up a list when it is next added.

The on-list items *are* rewritten, so they queue once. That is expected and
drains on the next sync.

## ⚠ Schema change — must be run by hand, in the same change

```sql
alter table public.items
  add column list_store text not null default '' check (char_length(list_store) <= 60);
```

`supabase/schema.sql` is a committed **record, not a migration**. The moment
`Store.toItemRow` puts `list_store` on the wire, PostgREST rejects **every**
upsert with 400 until the column exists on the live table. Reads keep working,
so the sync panel reads "synced" while nothing uploads. This took household sync
down for a full day on 2026-08-05 and the test suite cannot catch it — the fake
client has whatever columns the fake gives it.

Both `toItemRow` and `fromItemRow` change, and `schema.sql` is updated to match.

## Header

The title stacks onto two lines — deliberately, at the current 24px, not larger:

```
Shopping
List - Hannaford        Recipes  ⚙
6 items · 2 checked
```

`- Hannaford` trails "List" at the existing `.sub` size and colour, so it is
both beside *List* and beneath *Shopping*. The count keeps its own line below.
Stacking is what makes a long name like "BJ's Wholesale Club" fit without
colliding with the Recipes button; on one line the content measures ~476px
against 390px of phone.

Page dots sit top-right of the block, one per list, current one filled. With
only one list the dots are hidden — a single dot communicates nothing. The store
name still shows, so a one-list app reads as "Shopping / List - Hannaford".

**Which list is current** is persisted as a setting and restored on boot. If the
stored name is no longer in the roster (deleted on another device), it falls
back to the first list.

## The gesture

**The header block is the swipe surface.** Two paths:

- `wheel` with `|deltaX| > |deltaY|` — a trackpad two-finger swipe. Momentum
  keeps firing after the fingers lift, so deltas accumulate to a 55px threshold,
  act once, then lock until the stream is quiet for 280ms. Without the lock one
  flick fires three switches.
- `pointerdown`/`move`/`up` — the finger drag on the phone, and click-drag on a
  Mac. Same 55px threshold.

Vertical movement is ignored and left to scroll. The block gets
`touch-action: pan-y` and a pressed state while it is listening.

**This is why the block was chosen.** Horizontal swipe on a *row* is already
delete: a row lifts after a 500ms hold or the instant it moves 6px sideways,
then flings off ([`app.js:784`](../../../assets/app.js)). Putting the pager on
the block leaves that gesture completely untouched — no change to a gesture the
owner already has muscle memory for.

Left swipe = next list. Right swipe = previous. No wrap-around: past the last
list is a blank **"＋ New list"** card; past the first is a soft bounce.

## The animation — "Inhale"

Items rise into the header block, squashing to a sliver as they go; the block
relabels itself; the next list drops back out.

| | value |
|---|---|
| Out | 140ms, `cubic-bezier(.55,.06,.68,.19)`, 14ms stagger |
| In | 170ms, `cubic-bezier(.22,.9,.31,1.18)`, 16ms stagger |
| Stagger order | out bottom-row-first; in top-row-first |
| Squash at the dock | `scale(0.55, 0.04)`, no horizontal convergence |
| Dock point | header block centre, 62% down its height |
| Stagger cap | 180ms accumulated, both directions |
| Measured total | 483ms at 4 items, 696ms at 18 |

Category headings animate with the rows. Transform and opacity only — no layout
thrash. The header text and page dots swap at the moment the list is fully
inside the block, which is what sells the block as the thing holding the list.

**The stagger cap is load-bearing.** Without it an 18-item list takes three
times as long as a 4-item one. Capped, it costs ~170ms more.

**The bounce landing is deliberate.** The design hook flags
`cubic-bezier(.22,.9,.31,1.18)` as dated easing; the owner compared it against
`ease-out-expo` side by side and chose the bounce. It is also consistent with
what already ships — `app.js:874` uses `cubic-bezier(.34,1.56,.64,1)` for the
row-swipe spring-back. A narrow `bounce-easing` waiver for this one value is
registered with the commit that lands the CSS.

`prefers-reduced-motion: reduce` replaces the whole thing with a cross-fade.

## List management

Creating happens in the moment; tidying happens in Settings.

- **Create** — swipe past the last list onto a "＋ New list" card, name it. The
  card is not a list until it is named: it holds no items, gets no page dot, and
  cancelling returns you to the list you came from. A name that already exists
  is rejected rather than merged.
- **Rename** — tap the store name in the header. Rewrites `listStore` on every
  item on that list, in one transaction.
- **Reorder, delete** — a "Lists" section in Settings, where this app already
  puts destructive things.
- **Move an item** — long-press a row opens the item dialog, which gains a list
  field. This is the affordance that makes one-list-at-a-time workable.

**Deleting a list takes its items off the list** — `onList: false`, exactly like
swiping each one away. Stock, tracking and inventory are untouched, nothing is
destroyed, and the confirm says how many items are affected.

Lists are **separate from price-history store names.** `Store.storeNames()`
scrapes places you have paid; that is a history, not a set of lists, and every
one-off store typed on a trip would otherwise become a permanent list. The
useful half of the connection is kept: the trip dialog prefills its Store field
from the list being completed, still editable.

## Existing actions under multiple lists

| Action | Behaviour |
|---|---|
| Complete trip | Scoped to the current list only. The button appears when *this* list has checked items; other lists are untouched. |
| Trip dialog "Store" | Prefilled with the current list's name, editable. |
| ＋ Add item | Lands on the list being viewed. |
| Inventory → tap to add | Lands on the list behind the sheet. |
| Meals → add meal | Lands on the list being viewed. |
| Export JSON | Includes `listStore`; round-trips. |
| Export pantry | Unchanged — stock-only, no list state. |
| Merge import | `listStore` overlaid only when present and non-empty, per the existing "only present, non-empty fields" rule. |

## Store functions (pure, tested)

New in `assets/store.js`:

- `listRoster(items, roster)` — the ordered set of list names.
- `itemsForList(items, name)` — live items with `onList && listStore === name`.
- `nextList(roster, current, dir)` — neighbour or `null` at the ends.
- `renameList(items, from, to)` — returns rewritten items.
- `clearList(items, name)` — returns items with that list's members set
  `onList: false`.
- `moveItemToList(item, name)`.

Trip completion takes a list name and restocks only that list's checked items.

`assets/store.js` stays pure — no DOM. Gesture and animation live in `app.js`.

## Testing

`tests/store.test.js` gains coverage for every function above, plus:

- an unknown `listStore` from an import is preserved, never coerced;
- `clearList` leaves `stock`, `tracked` and `listStore` intact;
- trip completion on one list does not touch another list's checked items;
- `normalizeShape` round-trips `listStore` so existing records do not re-queue
  forever (gotcha #9);
- `sameRecord` still matches after a pull, with `list_store` on the wire.

Gesture and animation are verified by dispatching pointer and wheel events —
including the momentum-tail case, which must not double-fire.

## Known rough edges — accepted, not oversights

- **`last_trip_at` is one timestamp per household, not per store.** Finishing at
  Hannaford within two minutes of a partner finishing at BJ's will banner
  spuriously. Fixing it means a schema change for a rare case; not worth it now.
- **Row-level LWW still applies.** Two devices editing the same item's
  `listStore` resolve last-write-wins, so an item can land on the other person's
  chosen list.
- **An empty list may not reach the other device** if the roster setting fails
  to sync. Non-empty lists always arrive, because they are derived from items.
- **The gestures have never been tested on a real phone**, per HANDOFF. The
  state machine is verifiable by dispatched events; the feel is not.

## Deliberate deviations from house guidance

- **Bounce easing on the animation's landing**, chosen by the owner over
  `ease-out-expo` after a live side-by-side. Precedent: `app.js:874`.

## Rollout

`sw.js` `CACHE` bumps — this touches `index.html`, `assets/style.css`,
`assets/app.js` and `assets/store.js`. Without the bump an installed PWA keeps
serving the old files and the feature is invisible on the device.

The `alter table` above runs against the live Supabase project **in the same
change**, before or with the push to `main`.
