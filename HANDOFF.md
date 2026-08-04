# Handoff — Grocery App

**Work in:** `/Users/pigote/projects/grocery-app` (this folder). Not a worktree, no submodules.

## What this is

A personal grocery **shopping list + household inventory tracker**, phone-first.
The two screens are views of one `Item` model, linked by a shopping-trip loop
that restocks inventory by the quantity you actually bought.

- **Stack:** vanilla HTML/CSS/JS. **No framework, no npm, no build step, no ES
  modules** (plain `<script>` tags — deliberate, so tests run over `file://`).
- **Storage:** IndexedDB, write-through on every change. In-memory fallback +
  banner if unavailable. JSON export/import is the account-free backup; signed
  in, data also syncs to the household (see Sync).
- **Deployed:** GitHub Pages → https://purplenerple11-byte.github.io/grocery-app/
  Repo `github.com/purplenerple11-byte/grocery-app`, branch `main`.
  Pages deploys from `main` root — **pushing to main publishes it** (~1 min).
- **Household sync (built 2026-08-04).** Supabase Postgres + RLS behind
  magic-link auth. IndexedDB is still the read source of truth and the app is
  fully usable signed-out and offline; the network is a background reconciler.
  Schema and policies live in `supabase/schema.sql`. See "Sync" below.

## Sync (V6, built 2026-08-04)

Supabase Postgres + RLS behind magic-link auth. Schema, policies and RPCs are
in `supabase/schema.sql` — committed, not left in a dashboard.

**Shape.** IndexedDB stays the read source of truth; the network is a
background reconciler. Signed out, the app is byte-for-byte what it always was
and never even downloads the client. `assets/sync.js` holds the engine and
touches no DOM; the client is injected at `Sync.init` so tests drive the real
engine against `tests/fake-supabase.js` with no network.

**Decisions that are load-bearing — don't undo these casually:**

- **Deletes are tombstones** (`deletedAt`), filtered at exactly one boundary
  (boot and snapshot-apply). `state.items`/`state.meals` never contain one, so
  no render, lookup, export or merge path knows they exist. Hard-deleting makes
  a delete invisible to other devices, which resurrects the record on the next
  pull.
- **`updatedAt` is monotonic per record** (`Store.nextStamp`). Without the
  clamp, a device with a fast clock wins every conflict forever, silently.
- **Two clocks.** `client_updated_at` resolves conflicts; the server's
  `updated_at` is trigger-stamped and used only as the pull cursor. A client
  must never write it — one wrong device clock would poison every other
  device's cursor.
- **`DB.replaceLiveWithMeals`** exists because bulk writes pass `state.items`,
  which excludes tombstones; a plain clear-and-rewrite erased every pending
  delete on each completed trip.
- **`pruneMeals` must not run against the live item set.** It used to, in
  `boot()` and `removeItems()`, and persisted the result — which strips a
  not-yet-synced item out of its meals household-wide. It is now only used on
  self-contained file imports.
- **The outbox is a dirty-key set, not an op log.** Record and outbox entry are
  written in ONE transaction. `outboxRemove` drops only entries whose
  `queuedAt` is unchanged, so an edit made mid-push survives. Never `clear()`.
- **A merge that would remove more than half the local items is refused.** A
  reconciler bug does not throw; it returns a smaller plausible set that then
  propagates looking correct.

**Known and accepted limitations:**

- **`stock`/`listQty` are counters under last-write-wins.** Two people each
  tapping +1 loses one increment. A PN-counter is the correct fix and was
  judged not worth breaking the one-row-per-item model for.
- **Row-level LWW can un-check an item mid-trip.** A whole-row write from a
  stale device overwrites `checked`. Per-field timestamps would fix it.
- **Focus-only sync, by the owner's choice.** Triggers are boot,
  `visibilitychange`→visible, and `online` — no polling, no realtime. While
  shopping the app stays foregrounded, so none of them fire and the list can go
  stale for the whole trip. Two people splitting aisles will duplicate
  purchases. Adding a poll is one condition on `scheduleSync`; adding realtime
  is one `client.channel(...)` call that invokes the existing `pull()`.
- **Trip completion is guarded, not serialised.** It pulls first, checks
  `households.last_trip_at`, and banners if another member finished within two
  minutes. That covers the realistic case, not a true race.
- **A departing member keeps their local copy.** Removing their membership
  stops future sync; it cannot reach back.
- **Tombstones purge locally after 90 days.** A device offline longer than that
  can resurrect what it never saw deleted.

**Security.** The publishable key is public by design and safe *only* because
RLS is on for all five tables and every policy is `to authenticated`, with
`anon` revoked outright. Verified against the live project: anonymous select,
insert and RPC all return `42501`. The `service_role` key must never enter the
repo — that is also why invites are codes rather than emails.

**Outstanding:** the app is still on GitHub Pages, where `*.github.io` is one
origin shared by every repo on the account and `localStorage` is per-origin —
so any other Pages site under this account could read the session token. The
plan is to move to Cloudflare Pages, which gives the app its own origin. Until
then, do not publish untrusted code to another repo on this account.

## Layout

```
index.html                 all markup incl. dialogs (#item-dialog, #trip-dialog, #settings-dialog)
assets/style.css           every style; design tokens at :root
assets/store.js            Store = pure state fns + DB = IndexedDB adapter. No DOM.
assets/app.js              all UI: rendering, event delegation, dialogs
sw.js                      service worker; bump `const CACHE` when assets change
tools/make_icons.py        regenerates icons/ (stdlib only, no Pillow)
tests/run-tests.html       open in browser to run tests
tests/fake-supabase.js     hand-written Supabase stand-in; no network in tests
assets/sync.js             sync engine: auth, outbox push, delta pull. No DOM.
assets/sync-config.js      Supabase URL + publishable key (public by design)
supabase/schema.sql        tables, RLS policies, RPCs — paste into the SQL editor
tests/store.test.js        115 tests, all passing (incl. sync reconciliation)
PRODUCT.md                 durable product truth (users, mechanism, constraints)
docs/DESIGN.md             the implemented dark system (source of truth for look)
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
V2 (price + store history), V3 (saved meals), all five V4 items (merge import,
sorting + new categories, UI/interaction tweaks, meal pre-flight modal,
quick-add autocomplete), and V5's pantry export. 63 tests passing.

**Awaiting the user's real-device review of V3, V4-#1, and V4-#2.** Checklists
were given. If they report a bug, that takes priority over new work.

**V5 — pantry export (built, merged as PR #1 on 2026-07-22).** Landed from a
separate Claude session, not this thread. `⚙ → Export pantry` writes only
tracked items with `stock > 0`, via the pure `Store.serializePantry`. The shape
is deliberately *not* the backup format: `{ exportedAt, pantry: [{ name,
category, stock, unit? }] }` — no ids, prices, list state, or timestamps, since
none of those help a recommendation. Items come out in `CATEGORY_ORDER` so the
file reads top-to-bottom like a shelf; `unit` is omitted when empty rather than
emitted blank. Empty stock is a valid empty export, but the button short-circuits
to a banner ("Nothing in stock to export yet.") instead of downloading it.
Blob-download logic was factored out of the existing export into a shared
`downloadJson()`. 4 new tests (filtering, minimal shape, category ordering,
empty stock).

This is the *outbound* half of backlog item #1's AI workflow — "Add from file"
already handled inbound. The pair is now: export pantry → ask an assistant →
add its suggestions back. Note the round trip is still incomplete in one place:
AI-generated *meals* with throwaway ids aren't remapped on merge import.

**V4 item #2 verification note:** unit-test coverage for the new
`Store.groupByCategory`/`CATEGORY_ORDER` logic is solid (59/59 passing, includes
the new categories, the stock-bucket secondary sort, and the name-stable
tie-break). Live in-browser click-through verification hit an unresolved,
reproducible browser-tooling snag late in that session (see: heavy repeated
probing in one tab eventually got network requests silently blocked —
"[BLOCKED: Cookie/query string data]" — while a lightly-used sibling tab kept
working fine throughout, including a full correct render of the real production
code). Treat V4-#2 as logic-verified but **not yet click-verified on a real
device** — extra care warranted on first use.

**V4 item #1 — merge import (built).** Settings now has two import actions
instead of one, a decision the user made — don't collapse them back:
- **Restore from backup** — strict (`Store.validateImport`), replaces everything,
  guarded by a `confirm()`. The old import behaviour, made destructive-explicit.
- **Add from file** — additive merge (`Store.mergeImport`), never deletes. This
  is the AI-supplemental path: tolerates missing UUIDs and partial items. Match
  by uuid id, else trimmed/case-insensitive name; matched items get **only their
  present, non-empty fields** overlaid (so `{name:"Milk"}` won't zero an existing
  stock, and `unit:""` won't blank an existing unit); price history is **unioned**,
  never replaced. Unmatched items are appended with a **freshly minted** UUID (a
  payload id is never trusted as the stored id — preserves the injection guard
  from 635ec6c). A full export's meal `itemIds` are remapped through an idMap so
  meals still resolve after their items are re-minted. Both import paths write
  items+meals in **one IndexedDB transaction** (`DB.replaceAllWithMeals`), so a
  failed write aborts atomically instead of half-committing under a "data
  unchanged" banner. Not yet done from backlog #1: AI *meals* with throwaway ids
  and no matching items still can't be added.
  (These four refinements came from an independent review — a Sonnet subagent —
  that also caught the item's original wholesale-price-overwrite bug.)

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

**Next up — V4 feature backlog (user-authored 2026-07-17).** Not yet designed;
brainstorm before building. Verbatim intent below, with `⚠ note:` lines added by
the implementer where an item collides with existing code.

1. **Data merging & AI additive workflow** — ✅ **BUILT** (see the "V4 item #1"
   note above in Status). Kept the strict path as "Restore from backup" and
   added "Add from file" for the merge. Remaining sub-item: AI-generated *meals*
   with throwaway ids aren't remapped yet.

2. **Sorting & schema expansion** — ✅ **BUILT** (see "V4 item #2" note above).
   `groupByCategory` moved from `app.js` into `Store` (pure, now unit-tested) and
   grew an optional `secondary(item)` bucket param. Design calls made, since the
   spec text left "which view(s)" open:
   - **Inventory sheet** (`renderSheet`) got the stock secondary sort — `stock >
     0` bucket 0, `stock === 0` bucket 1, tie-broken by name. This is the literal
     ask: items you have float to the top of each category block, out-of-stock
     sinks to the bottom.
   - **Shopping list** (`renderList`) got *no* stock secondary — just the
     name-stable tie-break. Reasoning: the list already has V3's `.row.have`
     dimming to de-emphasize stocked items; sorting stocked items to the top too
     would fight that signal and bury what you actually still need to buy. This
     also closes the pre-existing "list order reshuffles across reloads" backlog
     item, since both views now tie-break deterministically instead of relying on
     incidental array order.
   - New categories `Condiments`, `Spices`, `Drinks` inserted between `Pantry`
     and `Household` in `Store.CATEGORY_ORDER`, plus matching `<option>`s in
     `index.html`. Being in `CATEGORY_ORDER` also fixes the pre-existing "unknown
     category resets to Other" bug for these three specifically (not the general
     case — a truly custom user category still falls back on edit).

3. **UI & interaction tweaks** — ✅ **BUILT**
   - *Slide-out button:* enlarged `#meals-tab` (28×84px, was 17×66) for an
     easier touch target on phone.
   - *Swipe-to-remove:* bidirectional swipe on shopping-list rows. The row
     visually "lifts" (shadow + scale + muted opacity via `.row.swiping`), can
     be flung in either direction or dragged past a 90px threshold. Velocity
     detection (>0.6 px/ms) counts as a fling even below the distance threshold.
     On release the row either animates off-screen and commits
     `{ onList: false }`, or snaps back. This also closes the backlog item
     "no remove-from-list in the details dialog."
   - *Collapsible inventory categories:* tapping an `.inv-cat` header toggles
     `.collapsed` which hides the adjacent `.tile-grid` via CSS. State is held
     in a `collapsedCats` Set (in-memory only, resets on reload) and re-applied
     after `renderSheet()` rebuilds the DOM. Chevron rotates to indicate state.
   - *Delayed sorting:* `commit()` gained a `{ deferRender }` option; stock
     `+`/`-` buttons use it to defer `render()` by 1.5 s while updating the
     count and dot color inline, so the tile doesn't jump while the user is
     still tapping.
   - *Unit alignment:* `.row .name` is now `flex: 1` and the `.unit` span is
     rendered just before `.stepper`, so units sit right-aligned next to the
     minus button instead of floating after the item name.

4. ~~**Meal selection pre-flight modal**~~ (Built)
   - *Issue:* appending all meal components creates redundant purchases and forces
     manual cleanup of ingredients you already have.
   - *Fix:* intercept the meal-selection click with an intermediate modal / bottom
     sheet **before** modifying the main array.
     - Iterate the meal's `itemIds`, fetch the objects, render sorted by stock
       with `stock === 0` forced to the top.
     - Show the current stock integer next to each item name.
     - Stage a temporary `staged` boolean per row: initialise `true` (checked)
       when `stock === 0` or `stock <= lowAt`; `false` when stock is sufficient.
     - A final **"Add to List"** button sets `onList: true` for only the checked
       UUIDs, then dismisses the modal.
     - Selection checks are custom-styled to match the round orange/clay checks of the shopping list.
   - ⚠ note: this **supersedes the V3 decision** that a meal adds *every* item and
     the user prunes on the list (see the V3 section above). Treat this as an
     intentional reversal, not a contradiction — the "have N" dimming on the list
     may become redundant once pruning moves into this modal.

5. ~~**Intelligent Input Auto-Completion**~~ (Built)
   - *The Issue:* Typing an item name in the quick-add field blindly creates a new object instead of querying the existing database, leading to duplicated entries (e.g., creating a new "lemons" when "Lemons" is already tracked).
   - *The Fix:* Transform the standard text input into a searchable combobox to catch existing items before creation.
   - *Filtering Logic:* Attach an `onInput` event listener to the text field. As characters are typed, convert the string to lowercase and run a `.filter()` against the `items` array, returning any `name` that includes the current input string.
   - *Dropdown UI:* Render the matched results in an absolute-positioned list directly below the input field. Build a custom floating `div` for the dropdown menu rather than relying on the native HTML `<datalist>` tag.
   - *Selection Routing:* If the user taps a suggested item from the dropdown, intercept the submit action. Retrieve that item's UUID, update its `onList` boolean to `true`, and clear the input field.
   - *Creation Routing:* Only execute the new item generation payload if the user submits the form and the exact string does not match an existing item in the array.

**Backlog** (non-blocking, from the v1 final review):
- Editing an item whose category isn't in `CATEGORY_ORDER` silently resets it to
  "Other" — but the spec calls categories user-extendable.
- ~~No "remove from list" in the details dialog (only Delete).~~ Resolved by
  swipe-to-remove (V4 item #3).
- ~~List order reshuffles across reloads (no stable sort within a category).~~
  Resolved by V4 item #2 (deterministic name-stable tie-break).
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
- Design decisions live in `docs/DESIGN.md` and the spec. **As of 2026-07-29
  that file documents the app's own dark system**, not the light Anthropic
  "parchment" reference it was inverted from — the reference is still in git
  history if you need it (`git log -- docs/DESIGN.md`). Read the named rules
  before touching UI; the load-bearing ones are **Clay-Is-Action** (clay only
  ever marks checked/on-list/submit/armed), **Serif-Names-It** (serif for
  strings the user typed, sans for numbers the app produced),
  **Flat-Unless-Detached** (shadows only on things that left the layout), and
  status colors staying sage/ochre/clay — never green/yellow/red.
- Product truth lives in `PRODUCT.md` (added 2026-07-29): who uses it, the
  trip-loop mechanism, the no-build/no-npm constraints, and which constraints
  are permanent vs. merely current. Notably, **single-device is today's
  constraint, not a principle** — don't design in a way that forecloses sync.
