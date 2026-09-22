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
- **Deployed:** Cloudflare Pages → https://grocery-app-rie.pages.dev/
  Repo `github.com/purplenerple11-byte/grocery-app`, branch `main`.
  Deploys from `main` root on push — **pushing to main publishes it** (~1 min).
  No build command, no config file: Cloudflare copies the repo and serves it.
- **Household sync (built 2026-08-04).** Supabase Postgres + RLS, joined with an
  invite code. IndexedDB is still the read source of truth and the app is
  fully usable signed-out and offline; the network is a background reconciler.
  Schema and policies live in `supabase/schema.sql`. See "Sync" below.

## Sync (V6, built 2026-08-04)

Supabase Postgres + RLS behind Supabase Auth. Schema, policies and RPCs are
in `supabase/schema.sql` — committed, not left in a dashboard.

**Joining is a code, not an email.** The primary path is
`Sync.joinWithCode(code)`: anonymous sign-in (`signInAnonymously`) first, *then*
`redeem_invite`. That order is deliberate — validating a code while
unauthenticated would turn the RPC into a code-validity oracle. An anonymous
user is a real `authenticated` user with an `is_anonymous` JWT claim, so every
RLS policy applies to them unchanged; it is **not** the `anon` API key.
Email magic link still exists behind a `<details>` in the sync panel, and
Google OAuth is wired but needs a client configured in Google Cloud. Email was
demoted because the free tier allows 2 magic links per hour, which is not
enough to onboard a household in one sitting.

**Anonymous Sign-Ins must stay enabled** in the Supabase dashboard
(Authentication → Providers). If it is ever switched off, code-only join breaks
for everyone and the only remaining path is the rate-limited email one.

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
- **A join never auto-seeds.** `joinWithCode` stamps
  `sync.seededHouseholdId` the moment the code is redeemed, before the user has
  answered replace-or-merge. Without that, a boot or focus trigger could fire
  `sync()` → `seedFromLocal()` in the gap and upload the joiner's list into the
  household they were invited to. `Sync.adoptHousehold('replace' | 'merge')`
  then either wipes local data or enqueues it through `Store.mergeImport`.

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

**⚠ Schema drift silently breaks all writes — the 2026-08-05 outage.** Adding a
field to `Store.toItemRow` puts a new column name on the wire. If the live table
does not have that column, PostgREST rejects **every** upsert with 400 and
nothing uploads. `supabase/schema.sql` is a committed *record*; editing it does
not touch the database. Commit `2e20331` added `added_by` to both the mapper and
`schema.sql`, nobody ran the SQL, and household sync was dead for a day.

The failure was invisible because reads kept working: `sync()` ran push then
pull, pull succeeded, and pull's own `_set('idle')` + `lastSyncAt = Date.now()`
overwrote push's error. The panel read "synced, just now" the entire time. Both
members kept adding items into outboxes that never drained. `sync()` now owns
the verdict — if either half failed, it restores the previous `lastSyncAt` and
reports the error, because half a sync is not a sync.

**So: any change to `toItemRow`/`toMealRow` needs a matching `alter table` run
against the live project, in the same change.** There is no migration runner and
no CI to catch it. Two tests pin the reporting half (`a failed push is not
masked by the pull that follows it`, plus a clean-sync control), but nothing can
pin the drift itself from inside the test suite — the fake client has whatever
columns the fake gives it.

**⚠ Never dedupe by name inside the reconciler — it caused a merge war.**
`Store.deduplicateSnapshot` (added `0c249ab`, removed `0f0c4a2`) ran inside
`reconcileSnapshot` on every pull: group live items by lowercased name, keep the
newest by `updatedAt`, sum their stock, tombstone the rest.

It looked convergent and was not. Two devices holding the same pair could pick
DIFFERENT survivors, so each resurrected the other's victim and pushed it back.
On the live project the whole items table re-stamped at 11:43:09, then 11:44:53,
then 11:49:04, with same-name pairs sitting as one live row plus one tombstone.

Three symptoms, one cause — worth recognising if anything like it returns:

- **Deletes did not stick.** You removed the copy you could see; the other
  device still held the other id and pushed it back alive.
- **Attribution vanished.** The surviving copy was whichever won by `updatedAt`,
  and older copies carry `added_by ''`.
- **"It used to sync on refresh."** It did, before that commit.

**Reconciliation is keyed on id and nothing else.** Two records that share a
name are two records. Merging them is a user decision, not a sync one — if
duplicate cleanup is wanted again it belongs behind an explicit button, applied
once to local state, never inside the pull path. The regression tests to keep
green are `reconcile never tombstones a record just for sharing a name` and
`reconcile is idempotent — a second pass pushes nothing new`; the second is the
one the loop would have failed.

**Security.** The publishable key is public by design and safe *only* because
RLS is on for all five tables and every policy is `to authenticated`, with
`anon` revoked outright. Verified against the live project: anonymous select,
insert and RPC all return `42501`. The `service_role` key must never enter the
repo — that is also why invites are codes rather than emails.

**Hosting moved off GitHub Pages (2026-08-04), for a security reason worth
remembering.** `*.github.io` is ONE origin shared by every repo on the account,
and `localStorage` — where the Supabase session lives — is per-origin, not
per-path. Any other Pages site published under the same account could therefore
read this app's session token and take over the household. `github.io` is on
the Public Suffix List, so other *users* were isolated; other *repos of the
same user* were not.

Cloudflare Pages gives the app its own origin, which removes the problem rather
than mitigating it. Deployment stays build-free: no command, no config file, no
npm. The Workers path was rejected during setup precisely because it required
`npx wrangler deploy`, which Product Principle #5 disallows regardless of it
only running in CI.

If the old GitHub Pages deployment is still installed anywhere, sign out of it
— its session token remains valid until it is.

## Layout

```
index.html                 all markup incl. dialogs (#item-dialog, #trip-dialog,
                           #settings-dialog, #ask-dialog — the shared prompt/confirm)
assets/style.css           every style; design tokens at :root
assets/store.js            Store = pure state fns + DB = IndexedDB adapter. No DOM.
assets/app.js              all UI: rendering, event delegation, dialogs
assets/version.js          APP_VERSION — the single source for the About row
privacy.html               standalone privacy policy; Play requires the URL and
                           the Data Safety form must agree with it. Its #delete
                           section is also Play's required web deletion-request
                           URL. Deliberately does NOT use assets/style.css.
.well-known/assetlinks.json  Digital Asset Links. Without it the installed APK
                           opens with a Chrome URL bar. ⚠ its
                           `sha256_cert_fingerprints` is an EMPTY ARRAY — JSON
                           takes no comments, so it is recorded here instead.
                           It ships empty on purpose, to prove Cloudflare
                           serves the path at all (see gotcha #18). It verifies
                           nothing until both fingerprints go in: the local key
                           for the sideloaded APK, and Play App Signing's
                           certificate for the store build. Two entries, one
                           target — they are signed differently.
sw.js                      service worker; bump `const CACHE` when assets change
tools/make_icons.py        regenerates icons/ (stdlib only, no Pillow)
tools/check-version.sh     fails if sw.js, version.js and patch-notes disagree
tests/run-tests.html       open in browser to run tests
tests/fake-supabase.js     hand-written Supabase stand-in; no network in tests
assets/sync.js             sync engine: auth, outbox push, delta pull. No DOM.
assets/sync-config.js      Supabase URL + publishable key (public by design)
supabase/schema.sql        tables, RLS policies, RPCs — paste into the SQL editor
                           ⚠ a RECORD, not a migration. Editing it changes
                           nothing until someone runs it. See "schema drift".
tests/store.test.js        191 tests, all passing (incl. sync reconciliation)
PRODUCT.md                 durable product truth (users, mechanism, constraints)
STYLE_GUIDE.md             the house visual system (source of truth for look)
docs/superpowers/specs/    the design spec — read this first
docs/superpowers/plans/    v1 implementation plan (historical)
.superpowers/sdd/          v1 build ledger + per-task reports (historical)
```

**Keep `store.js` pure** — it has no DOM access, which is why it's testable
without a browser DB. Don't leak UI concerns into it. (V7 adds `item.listStore`,
the six pure list functions, and list-scoped trip completion).

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

   **Clearing the service worker is not enough.** `python3 -m http.server` sends
   no cache headers, so the browser caches every asset on its own — with zero
   registrations and zero caches you can still be running yesterday's file. A
   `?v=N` on the *page* does not revalidate its `<script>` sub-resources either,
   so the one file you forgot is the one still stale. Refetch **every** file you
   touched, then reload:
   ```js
   Promise.all(['/assets/sync.js','/assets/store.js','/tests/fake-supabase.js',
                '/tests/store.test.js','/tests/harness.js']
     .map((u) => fetch(u, { cache: 'reload' })))
     .then(() => location.replace('/tests/run-tests.html?fresh=' + performance.now()));
   ```
   **`cache: 'reload'` does NOT bypass the service worker.** It only bypasses
   the HTTP cache. If anything opened the app root, a SW is registered at scope
   `/` and it serves `/assets/` and `/tests/` from ITS cache no matter what
   `fetch` options you pass. Opening the preview at `http://localhost:8080` is
   enough to register one. Unregister first, every time — the snippet above
   reports how many it killed, and a non-zero count means you were about to
   test yesterday's code.

   This bites in both directions and the false **pass** is the cheap one. On
   2026-08-05 a stale `fake-supabase.js` produced a false *failure* that looked
   exactly like a broken fix, and two rounds went into "fixing" working code.
   **Before trusting any red OR green, confirm the loaded source is yours:**
   ```js
   /myNewThing/.test(Store.reconcileRecords.toString())   // false = stale
   ```
   That one line would have saved three rounds in a single session.
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
6. **`.github/` is in `.gitignore`.** `.github/workflows/supabase-keepalive.yml`
   exists on disk and has never been pushed, so the Supabase free-tier
   keep-alive cron **is not running** — the project will pause after a week of
   inactivity and every device will show a sync error until someone opens the
   dashboard. Shipping it needs two things: remove `.github/` from
   `.gitignore`, and `gh auth refresh -h github.com -s workflow` (the current
   token has `gist, read:org, repo` only, and GitHub rejects a push that adds a
   workflow file without the `workflow` scope).
7. **`grocery_attr_seen` grows without bound.** The attribution fade-out stores
   one `localStorage` key per item id, first-seen timestamp, and never prunes.
   Harmless at household scale, but it is not self-cleaning.
8. **Adding a field to an item silently breaks every write.** `supabase/schema.sql`
   is a committed **record, not a migration** — editing it changes nothing until
   someone pastes it into the SQL editor. The moment `Store.toItemRow` puts a
   new column name on the wire, PostgREST rejects every upsert with 400 until
   that column exists on the live table. Reads keep working, so the app looks
   fine.

   **Any change to `toItemRow`/`toMealRow` needs its `alter table` run against
   the live project in the same change.** There is no migration runner, no CI,
   and the test suite cannot catch it — the fake client has whatever columns the
   fake gives it, so the tests stay green while production is dead.

   This is not hypothetical: it took household sync down for a full day on
   2026-08-05. Full account, including why the status panel reported "synced"
   throughout, is under "schema drift" in the Sync section.

9. **Adding a field to `createItem` makes every existing record push forever.**
   Records already in IndexedDB have no such KEY, the server's copy always does,
   and `sameRecord` compares `Object.keys()`. Mismatched key sets put the record
   in `toPush` on every pull; pushing bumps its server `updated_at`, which puts
   it in the next delta. Self-sustaining. It shows up as a **stuck outbox with a
   green status** — `outbox: 37, status: "idle", lastError: null` — because push
   genuinely succeeds and pull immediately re-queues the same records.

   `reconcileRecords` now normalises both sides through `Store.normalizeShape`,
   so this is handled for any future field. The diagnostic to reach for when
   sync looks fine but changes do not stick:
   ```js
   (async () => { console.log(JSON.stringify({ cursor: await DB.getSetting('sync.cursor', null),
     outbox: (await DB.outboxAll()).length, status: Sync.status, lastError: Sync.lastError })); })()
   ```
   A non-zero outbox that does not fall to zero across two syncs is this bug.
10. **There are two normalisers and they must not be merged.**
   `Store.normalizeRecord` backfills timestamps on **import** and preserves
   unknown keys. `Store.normalizeShape` rebuilds a record to the **current**
   field set and drops unknown keys — right for convergence, wrong for import.
   They are both plain keys in one object literal, so giving them the same name
   silently shadows one with no error at all. That nearly shipped.


11. **Postgres `jsonb` does not preserve object key order.** A price written as
   `{price, store, at}` returns from the server as `{at, price, store}`. Any
   equality check on a record with nested objects must canonicalise
   RECURSIVELY — `Store.sameRecord` sorted only top-level keys and so compared
   `prices` as raw JSON, which never matched. Result: every record with price
   history re-queued on every pull. Same visible symptom as gotcha #9 (stuck
   outbox, green status), different cause, found only because one device had
   17 stuck entries and another had 0 — the difference being whether that
   device's copies had arrived via a pull and were already in jsonb order.

   If a stuck outbox reappears, check the FIELD CONTENT, not just the field
   list: ⚙ → "Copy sync report" dumps both from any device, no console needed.


12. **Settings do not sync. Only items and meals do.** `DB.putSetting` writes
   to IndexedDB and stops there — there is no settings reconciler. Anything
   parked in a setting is device-local forever. The per-store-lists spec
   claimed the roster synced "as a household setting"; nothing implemented
   that, and it was not caught because the roster's OTHER source — names
   derived from the items themselves — masked it for every non-empty list.

   Before you put shared state in a setting, check that it can actually get
   there. `lists.roster` and `lists.current` are the current occupants.


13. **A device on a stale service worker is an active data source, not just a
   stale view.** The SW is cache-first, so a phone that has not been reopened
   in weeks keeps running the old bundle and keeps WRITING with it — adding
   items that lack every field the old build never heard of. Those rows sync
   up perfectly and then break the new build's assumptions.

   Concretely: a pre-lists device adds items with `list_store = ''`, and
   `itemsForList` matches on equality, so they belonged to no list — invisible
   on every device, counted by nothing, skipped by trip completion. They had
   synced fine; there was no lane to draw them in.

   **When you add a required field to an item, write the repair at the same
   time as the field.** `Store.adoptOrphans` is that repair. A migration that
   only runs at boot on YOUR device does not cover records that arrive later
   from someone else's.


14. **"Works sometimes" usually means state you forgot you were keeping.** The
   `by <name>` badge fired on some adds and not others. It was not the write
   path — every item had `added_by` set correctly. The badge timed its 30s
   window from a localStorage map of item ids that was stamped on first sight
   and never cleared, so an item you had added before was silent forever.
   Staples are exactly what you re-add, so it looked random.

   Attribution is now `Store.attributionState`, timed from `item.updatedAt`.
   Prefer a timestamp already on the record over a per-device map: the map
   cannot survive a reinstall, cannot agree between two devices, and grows
   without bound.

15. **There is no Playwright on this machine.** CLAUDE.md pointed at Chromium in
   `/opt/pw-browsers/` for headless runs. That path does not exist, and
   `playwright` is not installed. Don't go hunting for it or npm-install one —
   the repo's no-toolchain rule is the reason it isn't there.

   Serve the repo and drive the page in a browser instead:
   ```bash
   python3 -m http.server 8777
   ```
   then open `/tests/run-tests.html` and read `document.title`, which is
   `✓ all passing` or lists the failures. `file://` does **not** work for the
   test page any more — the relative `<script src>` tags do not resolve when the
   page is opened as a local file in a sandboxed viewer, and you get a blank
   "running…" that looks like a hang.

16. **An empty list and an empty database are different questions.** `#list`
   renders empty after every completed trip, which is the normal healthy state,
   not a signal about the install. Anything meant to happen once, on a genuinely
   new install, must read `state.items.length` (or a stamped setting), never the
   rendered list. This is what `Store.firstBootDefaults` exists to centralise.

17. **Two tabs is also how you get a stale *parse*, not just a hang.** The
   one-tab rule above is written about the DB tests hanging. It bites in a
   second way: a tab that loaded the app earlier keeps running the JavaScript
   it parsed then, so a freshly edited `assets/sync.js` can be correct on
   disk, correct over `curl`, correct in `fetch(url)` from that very page —
   and still missing from the live object. The symptom is
   `Sync.someNewThing is not a function` while every cache check comes back
   clean, which sends you hunting for a bug that is not there.

   Unregistering the service worker and clearing `caches` does not fix it,
   because neither is the cause. Close the tab and open a new one.


18. **An author `display` beats the UA's `[hidden]` rule, whatever the
   specificity.** `dialog label { display: block }` meant `#ask-field.hidden
   = true` did nothing, and the shared confirm dialog painted an empty text
   box above its buttons. Setting `hidden` is not enough anywhere a rule in
   `style.css` gives that element a `display`; there is now an explicit
   `dialog label[hidden] { display: none }`. Nothing throws and nothing logs —
   it is only visible on screen, which is the argument for screenshotting a
   dialog rather than asserting on `.hidden`.

19. **Re-parsing an edited asset needs the service worker gone AND a fresh
   load.** While iterating on CSS, `fetch('/assets/style.css')` returned the
   new file while `getComputedStyle` still reported the old rule: the page's
   stylesheet had been served by the SW at load. Unregister the registrations,
   `caches.delete` every key, *then* navigate again — clearing without the
   reload proves nothing, and the reload without the clear re-registers it.

20. **A hidden Browser pane does not run CSS transitions.** Polling
   `getComputedStyle` through the list-switch animation showed it frozen
   mid-flight with the name at `opacity: 0` — a convincing "the in-phase
   never fires" bug that does not exist. The pane had been hidden, so the
   tab was not rendering; the same run passed six times once a screenshot
   had fronted it. This is the same class of hazard the `void offsetHeight`
   comment in `switchList` is about. Before believing an animation bug found
   by polling, take a screenshot first — it makes the pane visible — or
   prove the inline styles with a MutationObserver, which is what settled it.


21. **Every unknown path on the live site returns index.html with a 200.**
    Cloudflare Pages falls back to the app for anything it cannot match, so
    "did that file deploy?" cannot be answered by a status code — a missing
    file and a present one both say 200. Confirmed 2026-09-18:

        /.well-known/assetlinks.json  ->  200, text/html, 13501 bytes
        /nope-does-not-exist          ->  200, text/html, 13501 bytes

    Check the content-type and the body, never just the code. This matters
    most for `.well-known/assetlinks.json`, because a broken one does not
    error: the APK simply installs with a Chrome URL bar across the top and
    nothing anywhere says why. Cloudflare also excludes most dotfiles from
    upload; `.well-known/` is meant to be the exception, which is exactly the
    kind of "meant to be" worth a curl. If it ever does fall through, the fix
    is a Pages Function at `functions/.well-known/assetlinks.json.js` — no npm,
    no build step, so it stays inside the no-toolchain rule.

22. **Cloudflare Pages strips `.html` and 308s to the extensionless path, and
    the precache survives it — verified, not assumed.** `/privacy.html` returns
    `308 -> /privacy`. That looked like a real hazard: `addAll` rejects
    atomically, so one uncacheable response takes the whole service worker
    down, silently. It does not happen. A `Request` built from a URL string
    defaults to `redirect: 'follow'`, so `cache.put` accepts the result. On the
    live v65 deploy the cache holds 19 entries, keyed under the *requested*
    `/privacy.html`, with `redirected: true`, status 200 and the real 6578-byte
    body.

    The second half is the surprising one. Chrome refuses a **navigation**
    served by a worker from a redirected response — and the fetch handler here
    is `return cached || networkFetch`, so tapping Privacy in the installed app
    is exactly that case. It works anyway: the page renders, console clean.
    Both halves were checked against the live site rather than reasoned about,
    which is the only way to check either — locally `python3 -m http.server`
    serves `/privacy.html` with no redirect at all, so the situation cannot be
    reproduced on 8777. If a future Pages change breaks this, the symptom is
    the whole worker failing to install, not a broken link.

## Status

**V8a — first run for a stranger (built 2026-09-17, shipped v59).** A walkthrough
in a clean mobile viewport found the app leaking "you already know how this
works" in six places. Four are fixed and live; two remain (see next step).

`Store.firstBootDefaults(items)` is the whole decision, pure and tested. An
install holding zero items has never been used by anyone; one arriving at the
migration is full. From that one signal come three defaults: the first list is
called `Groceries` rather than `Hannaford`, the header Recipes link is off, and
the how-it-works card has not been seen. The owner's device takes the other
branch and is bit-for-bit unchanged.

⚠ **The first-run card is gated on `state.items.length`, not on the rendered
list being empty.** The list empties after *every* completed trip. Gating on
what `#list` renders would turn a first-run card into one you see after every
shop. The `notesLastSeen` stamp in `boot()` solves the same problem the same
way — copy that pattern, not the obvious one.

**Versions are single-sourced now, except one on purpose.** There used to be
three and they disagreed: `sw.js` v58, About v51, newest patch note 50.
`assets/version.js` holds `APP_VERSION`; About renders it and patch notes are
checked against it. `sw.js` keeps its own literal deliberately — a stale
service-worker cache fails *invisibly*, so coupling it to `importScripts`
update semantics would trade a visible problem for one you cannot see.
`tools/check-version.sh` is what keeps the three honest. Run it before merging.

**V8b — the first person in a household (built 2026-09-17, shipped v60).**
All six items from the spec are now live.

`Sync.startHouseholdAnonymously()` puts "Start a household" on the signed-out
panel. Before this, the only route to `startHousehold` ran through the
`choosing` state, which you can only reach by email — two magic links an hour —
so the one person who has to go first was the one person sign-in could not
serve. No new engine: `signInAnonymously` and `ensure_household` were both
already there and neither assumed an email.

⚠ **It deliberately does NOT stamp `sync.seededHouseholdId`, where
`joinWithCode` does.** Joining means someone else's data is already the truth
and this device must ask before pushing anything. Starting means this device's
list IS the household's list, so `seedFromLocal` should run. Get it backwards
and you either strand a founder with an empty household or upload a joiner's
list over everyone else's. There is a test pinning the difference — keep it.

`Sync.attachEmail()` converts an anonymous account via `updateUser`. The
success message says the link must be opened, **not** that the account is safe:
nothing has changed until it is, and claiming otherwise invites exactly the
loss the action exists to prevent.

Google OAuth is not configured on the project and the button errored on tap.
It now renders only when `SYNC_CONFIG.googleEnabled` is true.

**V8c — asking for a name when it has an audience (shipped v61).** "Your name"
sat at the top of Settings with nothing saying what it was for, which made it
look like a profile field in an app that has no profiles. It is not — it is the
whole of the `by <name>` badge, and it does nothing until someone else is in the
household. The ask now lives in the sync panel and appears only when
`householdId` is set and the name is blank. The button scrolls to the field,
focuses it and flashes the border rather than telling you where to look; you
are already standing in Settings when you read it.

**Backend verified read-only (2026-09-17).** The live write path was not
executed — it creates a real anonymous user and a real `households` row — but
everything it depends on was checked directly against the project:

- `ensure_household()`, `redeem_invite(p_code text)`, `my_household()` and
  `my_household_ids()` all exist, all `SECURITY DEFINER`.
- `ensure_household()` gates on `auth.uid() is not null` only. No email check,
  no `is_anonymous` check — so an anonymous caller is accepted, which is the
  one thing `startHouseholdAnonymously` actually needed to be true. It also
  returns an existing household rather than creating a second one, so a repeat
  tap is harmless.
- Anonymous sign-in is enabled and well used: 18 of 23 users are anonymous.

⚠ **There are 18 anonymous users against 1 household and 10 memberships.** Some
of those are testing leftovers, but the gap is the shape of the problem
`attachEmail` exists for: an anonymous user with no membership has no way back
in and nothing to prove it was ever anyone. Worth a cleanup pass before the
store listing.

**Next step:** run the live end-to-end if you want it — tap Start a household on
a cleared profile and confirm the seed carries. It needs a permission the auto
mode classifier withholds (it writes to the shared Supabase project), so it has
to be approved or done by hand.

**V8d — two things a stranger was left holding (shipped v62, v63).**

*The confirmation link that was never obviously required (v62).* Both email
actions in this app finish somewhere the app cannot see, and until the link is
opened nothing has happened — the magic link has not signed anyone in and
`updateUser` has not attached the address. The copy said so, in a
`.dialog-note` that went away with the dialog. Closing Settings is the normal
next move after typing an email, so the one piece of state you needed to
remember was the one guaranteed to be gone first. A standing card now sits at
the top of the sync panel until the link is opened.

⚠ **The pending state is read from the server, not remembered.** GoTrue parks
an unconfirmed address in `auth.users.email_change` and exposes it as
`user.new_email`, so the card survives a reload and a reinstall and clears
itself the moment the link is clicked. Only the magic-link path — which has no
session to ask — uses a local stamp, cleared on sign-in, on sign-out and by
"Use another address". `Sync.attachEmail` adopts the user object `updateUser`
returns, or `new_email` would not be readable until the next token refresh,
i.e. up to an hour after the action it explains. `Store.pendingEmail` and
`Store.resendWaitLabel` are the pure parts. Resend has a 30-minute cooldown,
half the mailer's two-an-hour budget, so a resend is always available before
the budget is; the label rounds UP, because "1 minute" with 61 seconds left
earns a rate-limit error that reads as the app being broken.

*The browser's own dialogs (v63).* `prompt()` and `confirm()` survived in four
places — renaming a list, adding a category, deleting a list, restoring a
backup. Each painted a browser sheet with the origin across the top and the
platform's blue OK/Cancel. On an installed PWA that is worse than mismatched:
the URL is the one thing the app has otherwise stopped showing you. One shared
`#ask-dialog` replaces all four. `ask()` returns a Promise — pass `value` and
the answer is a string or null, omit it and it is true/false.

*Two things reported from the phone (v64).* The Category dropdown showed the
List field through its options — not transparency: `dialog .field` gives every
field the same `z-index`, so stacking fell to DOM order and the later sibling
won. Whichever picker is open now takes a higher one. And the header relabelled
itself with a hard cut while every row around it moved; the name and count now
travel with the gesture on the same durations and mirrored easings as the rows.
`.appbar h1 em` needed `display: inline-block` — transforms do not apply to
inline boxes.

**V9a — the two files a store requires (shipped v65).** Spec:
`docs/superpowers/specs/2026-09-18-play-and-apk-readiness-design.md`.

*`privacy.html`.* Play requires a policy URL for every app, free and personal
ones included, and the Data Safety form has to agree with it. It is standalone
and deliberately does **not** load `assets/style.css` — that file is app chrome
and none of it applies to a document. It copies the tokens and follows
`prefers-color-scheme`, because the app's `.dark` class lives in IndexedDB and
a static page should not open a database to pick a colour. Its `#delete`
section doubles as Play's required *web* deletion-request URL, so one page
satisfies two separate requirements. Linked from About as an `a.setting-card`,
matching the What's new row.

*`.well-known/assetlinks.json`.* Without it the installed APK opens with a
Chrome URL bar across the top. Package name is `dev.pigote.grocery` and is
permanent — Play does not allow a change after the first upload.

⚠ **It ships with an EMPTY `sha256_cert_fingerprints` array.** JSON takes no
comments, so this is the record. Empty verifies nothing, which is harmless, and
it buys the only thing worth having early: proof that Cloudflare serves a real
file at that path rather than falling through to `index.html` (gotcha #21 — a
missing file and a present one both answer 200). Two fingerprints go in later,
on the same target: the local key that signs the sideloaded APK, and the
certificate Play App Signing holds for the store build. They are different
keys, so both entries are required or one of the two builds shows the URL bar.

`privacy.html` is precached. `assetlinks.json` is not, on purpose: Android
fetches it at install time, outside the page and outside the worker.

*Struck before it was written: the pending-email banner.* The spec listed it as
commit C. It had already shipped in v62 — see V8d — and matched the design, so
it was removed from the plan rather than rebuilt.

**V9b — in-app account deletion (shipped v66).** The other half of Play's
deletion requirement; `privacy.html#delete` was only the web half. Before this
the app offered "Sign out", which deliberately deletes nothing.

⚠ **`delete_my_account()` does not exist on the live project until someone
pastes it in.** `supabase/schema.sql` is a record, not a migration — same as
every other RPC here. Until it is run, the button returns a 404 from PostgREST.

⚠ **The order inside the function is not interchangeable with letting the
cascades do it.** `household_members.user_id` cascades from `auth.users`, so
deleting the user first drops the memberships before anything can count them,
and every household this person belonged to then looks permanently occupied.
Memberships first, orphan check on what is left, user last. A household with
anyone still in it is theirs as much as it was this person's, so only an empty
one is removed — its deletion cascades to items, meals and invites. The
function returns that count, and `Store.deletionSummary` turns it into the one
sentence worth saying out loud.

⚠ **The client order is forced for the mirror-image reason.** Once the RPC
returns, the access token refers to a user that no longer exists, so the RPC
has to go first while the token is still worth something. `signOut` then fails
against the server, which is expected rather than an error worth surfacing —
hence the catch. The local wipe is last and unconditional. `DB.wipeAll` clears
the three stores rather than calling `indexedDB.deleteDatabase`, which blocks
on any open connection and is already the most reliable way to hang this app
(gotcha #2).

A typed word, not an OK button: this is the only action in the app with nothing
behind it — no tombstone, no undo, and on a single-device household no other
phone holding a copy. `Store.confirmsDeletion` forgives case and surrounding
space; the word exists to interrupt a reflex, not to test typing.

*A layout bug the new button exposed and did not cause.* `.dialog-note` carries
a `-6px` top margin meant to be swallowed by the row-gap of the `dialog menu`
it normally sits in. `#sync-body` is not a menu, so there is no gap to swallow
it and the note rides up **into** the button above, first line clipped by the
border. This had been patched once as a one-off for `#sync-diag`. It was never a
one-off: `#sync-invite-out` and `#sync-attach-out` had it too and are hidden
until used, so they carried it without ever showing it. One rule now covers all
of them. Measured -6px before, +8px after, for the invite code as well.

**Next step:** paste `delete_my_account()` into the Supabase SQL editor, then
tap Delete account once on a throwaway anonymous account to confirm it end to
end. Nothing in the repo can prove that half — `tests/fake-supabase.js` pins the
client's call order and the local wipe, which is all a fake can pin.

After that, commit D — listing assets and `docs/play-data-safety.md`.

*The owner's, not the code's:* developer account and ID verification, the
12-testers-for-14-continuous-days closed test (unless the account predates
Nov 2023), content rating questionnaire, the two signing fingerprints, and the
upload. The account clock is the long pole and runs in parallel with all of the
above. The live Supabase end-to-end from V8c is still unrun and still optional.

*Not a gap: the Supabase keepalive.* `.github/` is not gitignored, the workflow
is on `origin/main` (`fb64cdb`) and it has run on schedule and succeeded every
time. The project is not going to pause.

*Not a gap: target API 36.* PWABuilder builds in the cloud, so the machine's
SDK level is irrelevant, and `targetSdk` reads as plain text out of the
generated project's `build.gradle`. Verification, not work.

**V7 — per-store lists (built 2026-08-25, repaired 2026-08-26).** One list per
store; `item.listStore` holds the name. A list is a name, not a record — the
roster of names lives in the `lists.roster` setting, which exists so an EMPTY
list survives; non-empty lists are derivable from the items.

⚠ **`lists.roster` is a setting, and settings do not sync (gotcha #12).** So an
empty list is device-local. A list with items in it travels on those items and
appears on the other device automatically — `applySnapshot` recomputes the
roster on every pull, so it shows up without an app restart. If empty lists ever
need to travel, that means building settings sync; it does not exist today. Deliberately NOT a `lists` table: that
would have meant new RLS policies, a third reconciler path and tombstones for
lists, roughly doubling the feature for referential integrity over a handful of
strings.

The swipe lives on the header block, not the list body, because a horizontal
swipe on a row already means delete. Do not move it onto the rows.

Because the block is a gesture surface, everything tappable ON it competes with
the swipe — a near miss on the store name changes lists instead of renaming. The
name's hit area is grown with an `::after` inset rather than padding, so the
target is 47px tall while the text stays 12px and the grid does not move. Keep
that pattern for anything else added to the block.

`completeTrip` takes an optional third argument, the list name. Omitted, it
behaves exactly as before — that is what keeps the pre-lists tests honest.

Added `items.list_store` to the live table on 2026-08-25.

**Shipped and live:** v1 (list, inventory sheet, trip loop, export/import, PWA),
V2 (price + store history), V3 (saved meals), all five V4 items (merge import,
sorting + new categories, UI/interaction tweaks, meal pre-flight modal,
quick-add autocomplete), V5's pantry export, and V6 household sync
(code-based join, tombstones, outbox, reconciler). 125 tests passing —
`Store.deduplicateSnapshot` is the one function with no coverage; see the
warning in the Sync section.

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
   - *Category picker overlay:* The category dropdown now uses absolute positioning to float over subsequent fields, rather than pushing the entire layout down when opened.
   - *New category button styling:* The "+ New category..." button inside the picker was restyled to match the list rows, removing the radio-circle ornament.
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
   - *Physical 1:1 vertical inventory sheet drag:* Swiping up/down on `#sheet-bar`
     (or pulling down from the top of the open sheet) follows the finger 1:1 in
     real-time with rubber-banding, velocity-based fling detection, and smooth
     spring snapping (`cubic-bezier(.25, 1, .5, 1)`).
   - *Item creator attribution & display name:* Settings panel (`⚙`) includes a
     "Your name" input field. Items display an italicized `by Name` label on the
     shopping list, which smoothly fades out after 30 seconds of on-screen view time.

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
- Design decisions live in `STYLE_GUIDE.md` (the Recipe Holder house style) and
  the spec. **`docs/DESIGN.md` was deleted 2026-08-26** — it documented the old
  dark-only system and had gone stale on every axis that matters: the app is now
  light-by-default with `.dark` inverting, `--clay` is near-black rather than
  terracotta, and stock status is deliberately green/gold/red, which the old doc
  forbade. It is recoverable via `git log -- docs/DESIGN.md` if you want the
  history, but do not treat it as current. One visual authority, not two.
- Product truth lives in `PRODUCT.md` (added 2026-07-29): who uses it, the
  trip-loop mechanism, the no-build/no-npm constraints, and which constraints
  are permanent vs. merely current. Notably, **single-device is today's
  constraint, not a principle** — don't design in a way that forecloses sync.
