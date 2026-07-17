# Handoff — Grocery App

**Work in:** `/Users/pigote/projects/grocery-app` (this folder). Not a worktree, no submodules.

## What this is

A personal grocery **shopping list + household inventory tracker**, phone-first.
The two screens are views of one `Item` model, linked by a shopping-trip loop
that restocks inventory by the quantity you actually bought.

- **Stack:** vanilla HTML/CSS/JS. **No framework, no npm, no build step, no ES
  modules** (plain `<script>` tags — deliberate, so tests run over `file://`).
- **Storage:** IndexedDB, write-through on every change. In-memory fallback +
  banner if unavailable. JSON export/import is the only backup.
- **Deployed:** GitHub Pages → https://purplenerple11-byte.github.io/grocery-app/
  Repo `github.com/purplenerple11-byte/grocery-app`, branch `main`.
  Pages deploys from `main` root — **pushing to main publishes it** (~1 min).
- **Single user, single device.** No accounts, no backend, no sync. Not planned.

## Layout

```
index.html                 all markup incl. dialogs (#item-dialog, #trip-dialog, #settings-dialog)
assets/style.css           every style; design tokens at :root
assets/store.js            Store = pure state fns + DB = IndexedDB adapter. No DOM.
assets/app.js              all UI: rendering, event delegation, dialogs
sw.js                      service worker; bump `const CACHE` when assets change
tools/make_icons.py        regenerates icons/ (stdlib only, no Pillow)
tests/run-tests.html       open in browser to run tests
tests/store.test.js        26 tests, all passing
docs/DESIGN.md             visual style reference (source of truth for look)
docs/superpowers/specs/    the design spec — read this first
docs/superpowers/plans/    v1 implementation plan (historical)
.superpowers/sdd/          v1 build ledger + per-task reports (historical)
```

**Keep `store.js` pure** — it has no DOM access, which is why it's testable
without a browser DB. Don't leak UI concerns into it.

## Run + test

```bash
python3 -m http.server 8000        # from repo root; service worker needs http
```

- App: http://localhost:8000
- Tests: http://localhost:8000/tests/run-tests.html → title shows `✓ all passing`.
  **Use exactly ONE browser tab** — a second tab holds IndexedDB open and the
  DB tests hang forever (looks like a code bug; isn't).

## Gotchas that will waste your time

1. **The service worker serves stale code.** This has produced fake test results
   more than once. Before verifying anything in the browser:
   ```js
   (async () => { const rs = await navigator.serviceWorker.getRegistrations();
     for (const r of rs) await r.unregister();
     const ks = await caches.keys(); for (const k of ks) await caches.delete(k);
     return 'cleared'; })()
   ```
   then reload with a fresh `?v=N`. A `?v=N` alone does **not** bust the SW cache.
   `python3 -m http.server` also sends no cache headers, so the browser caches
   assets on its own.
2. **Synthetic clicks miss `#complete-trip`** — it's fixed-position and the sheet
   overlays it in hit-testing. Use `document.getElementById('complete-trip').click()`.
3. **Long-press and swipe can't be simulated** reliably in automation. Call
   `openItemDialog(item)` directly instead, and verify gestures by code review —
   **they have never been tested on a real phone.**
   Dispatching `PointerEvent`s by hand *does* drive `onLongPress`'s state machine
   faithfully, so it's worth doing — but **`el.dispatchEvent(new MouseEvent('click'))`
   is not a real click** and will give you a false pass. Synthetic clicks aren't
   hit-tested, so they ignore `<dialog>` backdrop retargeting and reach listeners
   a real tap never would. This exact trap hid a ship-blocking bug in V3 (see
   `onLongPress`'s `swallowClick`). To test a tap, use a real CDP-level click.
4. **Never edit `icons/*.png` by hand** — regenerate via `python3 tools/make_icons.py`.
5. **Git identity isn't configured** — commits carry a placeholder author
   (`Pig Ote <pigote@Hops.lan>`). User has been told; don't "fix" it silently.

## Status

**Shipped and live:** v1 (list, inventory sheet, trip loop, export/import, PWA),
V2 (price + store history), and V3 (saved meals). 38 tests passing.

**Awaiting the user's real-device review of V3.** A checklist was given. If they
report a bug, that takes priority over new work.

**V3 — saved meals (built).** A meal is a named set of item ids — it never copies
item data, so renaming an item updates every meal for free and a deleted item
just drops out (`Store.pruneMeals`). Decisions the user made, don't silently
revisit them:
- Selecting a meal adds **every** item, not just what you're short on — the user
  prunes, the app doesn't guess. The banner reports "N added, M short".
- Items you already have enough of render dimmed (`.row.have` + "have 4"). This
  rule is global, not meal-scoped — no provenance is tracked. `.row.done`
  (strikethrough) still means "in my basket"; the two must stay distinct.
- Meals are created by **saving the current list** (`＋ Save list` in the drawer),
  not by tagging items one at a time.
- Meals live in a left-edge drawer with a vertically-centred tab. Long-press a
  meal to rename/delete. Editing a meal's *contents* is deliberately not
  supported — re-save instead.
- Meals persist in the **`settings` object store**, which has existed unused in
  the v1 schema since day one — so V3 needed no DB version bump and no migration
  over live data. Export is now `version: 2` and carries meals; v1 backups still
  import.

**Backlog** (non-blocking, from the v1 final review):
- Editing an item whose category isn't in `CATEGORY_ORDER` silently resets it to
  "Other" — but the spec calls categories user-extendable.
- No "remove from list" in the details dialog (only Delete).
- List order reshuffles across reloads (no stable sort within a category).
- Export omits the `settings` key the spec mentions.
- Retry-once on failed writes only applies to `commit`, not `replaceAll`/`delete`.
- SW precaches with default HTTP cache semantics; `cache: 'reload'` would pin it.

## How the user likes to work

- **Uses the superpowers skills**: brainstorming → writing-plans →
  subagent-driven-development. They chose the subagent approach for v1.
  For V2 they said *"just build, commit, then I will do the review from a
  checklist you give me at the end"* — so match the ask; don't force the full
  ceremony when they've said to skip it.
- **Converge fast on visual options** — 1-2 mockup rounds, then commit.
- **Verify locally, then push once.** Don't push before verifying.
- **Delegate verification to an independent subagent.** This caught a real
  ship-blocking bug in V2 (native form validation silently killed the
  "Finish trip" button) that the author had missed.
- Design decisions live in `docs/DESIGN.md` and the spec. The dark theme is a
  deliberate inversion of that light "parchment" reference: keep the warm
  earth-tone palette, serif for voice, sans for UI chrome, flat surfaces with
  hairline borders, and **clay reserved for action state only** (status colors
  are sage/ochre/clay — never green/yellow/red).
