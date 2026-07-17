# Grocery App — Design Spec

Date: 2026-07-16
Status: Approved pending user review

## Overview

A personal grocery app combining a shopping list with a household inventory tracker. Single user, single device. The two features share one data model: the shopping list and the inventory are two views of the same items, linked by a shopping-trip loop that restocks inventory counts from what was bought.

## Goals

- Build and check off a grocery list, phone-first, usable in-store.
- Track household stock levels with at-a-glance color status and counts.
- Keep the two in sync automatically via trip completion — no manual bookkeeping.

## Non-goals (v1)

Deferred to later iterations, in order:

- **V2:** price and store tracking per item.
- **V3:** saved meals with item tags; selecting a meal adds its items to the list.

Excluded entirely: multi-user sync, accounts, backend, notifications.

## Platform & Architecture

Local-first PWA at `~/projects/grocery-app`:

- Plain HTML/CSS/JS. No framework, no build step.
- `manifest.json` + service worker for home-screen install and offline use.
- IndexedDB for storage; every mutation persists immediately.
- Dark mode is the default and only theme in v1 (a light theme using the source design system's parchment palette is a possible later addition).

### File layout

```
grocery-app/
  index.html
  manifest.json
  sw.js
  assets/
    style.css        # theme tokens + all styling
    app.js           # UI wiring, rendering, event handlers
    store.js         # data layer: pure state-transition functions + IndexedDB adapter
  docs/
    DESIGN.md        # visual style reference (Anthropic parchment system)
    superpowers/specs/
  tests/
    store.test.js    # data-layer tests, run with a minimal harness
    run-tests.html   # opens in browser, runs tests, shows pass/fail
```

`store.js` separates **pure functions** (state in → state out; all list/inventory/trip logic) from the thin IndexedDB persistence adapter, so logic is testable without a browser database.

## Visual design

Source of truth: `docs/DESIGN.md` (the Anthropic "scientific field journal" style reference), adapted to dark mode. The reference is a light parchment system; this app inverts it onto the system's own dark surface while keeping its rules:

- **Canvas** `#141413` (warm slate), card surface `#1f1e1b`, grouped panel `#262521`.
- **Text** ivory `#faf9f5`, muted `#b0aea5`. Serif (Georgia stack) for headings and item names; sans (system stack) for UI chrome, counts, labels.
- **Flat elevation**: 1px hairline borders `#3d3d3a`, no shadows, no gradients.
- **Clay accent** `#d97757` reserved for action state only: the on-list corner ribbon and checked-off marks.
- **Stock status colors stay in the earth family**: sage `#7d9b76` = stocked, ochre `#d9a557` = low, clay-deep `#c6613f` = out. Never stock green/yellow/red.

Approved mockups live in `.superpowers/brainstorm/mockups/` (gitignored; final look is captured by this spec).

## Data model

One core entity. Stored in IndexedDB store `items`, plus a small `settings` store (category order, future preferences).

```
Item {
  id: string            // uuid
  name: string
  category: string      // "Produce", "Dairy", "Pantry", ... user-extendable
  tracked: boolean      // false = one-off list item, not shown in inventory
  stock: number         // count on hand (tracked items only)
  lowAt: number         // low threshold, default 1
  unit: string | ""     // cosmetic label ("cartons", "gal"); not used in math
  onList: boolean
  listQty: number       // quantity to buy, default 1
  checked: boolean      // checked off in-store
  createdAt, updatedAt: timestamps
}
```

**Derived status** (never stored): `stock === 0` → out (clay), `stock <= lowAt` → low (ochre), else stocked (sage).

## Screens & interactions

Single page, two layers:

### List screen (main view)

- Header: "Shopping List", subtitle with item/checked counts.
- Add bar: type a name, enter to add. New items default to untracked one-offs; an inline toggle on the row can promote an item to tracked (which gives it a tile in inventory).
- Items grouped by category. Each row: check-off circle, serif name, numeric quantity with −/+ stepper (default 1), optional unit label.
- Tapping the circle checks the item off: clay-filled circle, strikethrough name. Tap again to un-check.
- **Complete trip** button appears when ≥1 item is checked. On tap:
  - Checked tracked items: removed from list, `stock += listQty` (eggs at 0, buy 2 → stock 2), `listQty` resets to 1.
  - Checked untracked items: deleted.
  - Unchecked items stay on the list untouched.
- Swipe-to-delete (or a delete affordance in an edit mode) removes a row without buying it.

### Inventory sheet (swipe up from bottom)

- Collapsed: a pinned bar at the bottom of the list screen — grabber, "Inventory" label, count pills ("3 out", "4 low") with status dots. Swipe up (or tap the bar) to expand; swipe down to collapse. No swipe hint text.
- Expanded: bottom sheet covering most of the screen. Items grouped by category in a **4-column grid of square tiles**.
- Each tile: item name at top (serif, up to 2 lines), bottom row with status dot + **stock count**.
- **Tap tile = toggle on/off the shopping list.** On-list tiles show a clay corner ribbon cut at 45° across the top-right with a ✓ (may slightly overlap the name — accepted).
- **Tap the count** (bottom-left area) opens a small −/+ stepper to adjust stock by hand without toggling the list.
- Long-press (or an edit affordance) opens item details: rename, category, unit, low threshold, untrack/delete.

## Data flow: the shopping-trip loop

1. Stock runs low → adjust count (or it's already low from a previous trip) → tile shows ochre/clay.
2. Tap tile → item on list with clay ✓ corner.
3. In store: check items off the list as bought; adjust `listQty` to match what you actually grab.
4. Complete trip → checked tracked items restock by quantity bought; one-offs vanish; list is left with only unbought items.

## Persistence & backup

- IndexedDB, write-through on every mutation. No save button.
- **Export JSON / Import JSON** in a small settings menu. Export downloads a single file of all items + settings. Import validates the shape (version field, array of items with required keys) before replacing anything; invalid files are rejected with a message and no changes.

## Error handling

- IndexedDB unavailable (e.g. some private-browsing modes): app runs in-memory with a persistent banner — "Changes won't be saved in this session."
- Failed writes: retried once, then surfaced in the same banner style.
- Import of malformed JSON: rejected atomically, existing data untouched.

## Testing

- `store.js` pure functions covered by `tests/store.test.js`: add/toggle/check/complete-trip transitions, restock math, derived status thresholds, import validation. Run via `tests/run-tests.html` in a browser (no toolchain).
- Manual smoke checklist (in README): install as PWA, offline load, add/check/complete trip, export/import round-trip, inventory toggle + stepper.

## Milestones

1. **Skeleton**: repo, PWA shell (installable, offline), theme tokens, empty screens.
2. **Data layer**: `store.js` pure functions + IndexedDB adapter, tests passing.
3. **List screen**: add, check off, quantity stepper, complete trip.
4. **Inventory sheet**: collapsed bar, swipe-up sheet, tile grid, toggle + count stepper.
5. **Backup & polish**: export/import, error banner, item detail editing, smoke checklist.
