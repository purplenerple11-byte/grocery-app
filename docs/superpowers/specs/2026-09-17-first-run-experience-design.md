# First-run experience — design

Date: 2026-09-17
Status: approved, not yet implemented

## Problem

A walkthrough of https://grocery-app-rie.pages.dev/ in a clean mobile viewport
found six things that fail a stranger. The app is built for one household that
already knows how it works; a new install leaks that assumption in six places.

## Shared primitive: `isFreshInstall`

Three of the six fixes need the same question answered: is this a brand-new
install, or the owner's existing device?

The boot migration at `assets/app.js:2228` already computes this without naming
it. `roster === null` is the "not yet migrated" marker, and a fresh install
additionally has zero stored items.

```js
const isFreshInstall = roster === null && state.items.length === 0;
```

Name it inside that block and use it to write defaults **once**. No new durable
flag is introduced: each consequence is persisted as its own setting, so later
boots never re-ask.

---

## 1 · Default list name

**Now:** `'Hannaford'` is hardcoded at `app.js:2236`, `:2241` and `:2245`. Every
fresh install is seeded with the owner's supermarket.

**Change:** two constants in `assets/store.js`:

```js
const MIGRATED_LIST = 'Hannaford';  // the owner's pre-roster list
const DEFAULT_LIST  = 'Groceries';  // a fresh install
```

- The stamping loop (`:2236`) keeps `MIGRATED_LIST`. It only runs when on-list
  items exist, which is by definition not a fresh install.
- The roster seed (`:2241`) becomes `isFreshInstall ? DEFAULT_LIST : MIGRATED_LIST`.
- The empty-roster fallback (`:2245`) becomes `DEFAULT_LIST`. This is a repair
  path for a corrupt roster on any install; the honest fallback is the generic
  name, and `Store.listRoster` derives from items so an owner with Hannaford
  items never reaches it.

Renaming a list is already supported, so a stranger makes it theirs in one tap.
No new UI.

## 2 · Recipes link

**Now:** `index.html:35` links to the owner's personal Recipe Holder site with no
explanation, in prime header space.

**Constraint worth recording:** "hide it unless the recipes app is installed" is
not achievable. `getInstalledRelatedApps()` only reports apps declared as
related in this app's own `manifest.json`, and Recipe Holder is a different
origin. This page cannot learn whether that WebAPK exists.

**Change:** a `recipesLink` boolean setting, defaulted in the migration block —
`true` when not fresh, `false` when fresh. Settings gains a toggle. Boot hides
`#recipes-link` when the setting is off.

The owner's device is untouched, including the Android `intent://` rewrite at
`app.js:339`. A stranger never sees an unexplained link.

## 3 · First-run card

**Now:** the empty state (`app.js:238`) reads "Add an item above, or open
Inventory and tap what you're out of." Nothing states the core loop: check items
off, tap Complete trip, tracked items restock.

**Change:** fold the card into the existing empty-state render, so one place
owns "nothing here yet". It shows when the item list is empty **and** a
`firstRun.seen` setting is unset.

Copy:

> **How this works**
> 1. Add what you need
> 2. Check items off as you shop
> 3. Tap Complete trip — tracked items restock
> [Got it]

"Got it" stamps `firstRun.seen` and the empty state reverts to today's one-line
hint.

Non-fresh installs get `firstRun.seen` stamped during migration, so emptying the
list later never resurrects the card. This mirrors the `notesLastSeen` stamp at
`app.js:2217`, which already solves the identical problem for patch notes.

Rejected: seeding sample items. It writes rows a new user must delete and risks
colliding with both the migration path and a device about to join a household.

## 4 · Start a household without email

**Now:** signed out, the panel offers only "Join with code" (needs a code from
someone already in a household) and "Sign in with email instead" (two magic
links an hour on the free tier). "Start a household" exists only in the
`choosing` state, reachable only via email. The first person in a household is
stuck.

**This is a UI gap, not an engine gap.** `Sync.signInAnonymously` and
`Sync.startHousehold()` both already exist (`sync.js:158`, `sync.js:205`).

**Change:** `Sync.startHouseholdAnonymously()`, mirroring `joinWithCode`'s shape:

1. If no session, `signInAnonymously()`.
2. `ensure_household`.
3. On failure, sign back out — otherwise a brand-new anonymous session is
   stranded in `choosing` with no way to recover. `joinWithCode` already does
   this at `sync.js:187`.

**Deliberately does NOT stamp `sync.seededHouseholdId`.** Unlike joining, this
device's list genuinely is the new household's list, so `seedFromLocal` should
run. This is exactly the case the comment at `sync.js:217` describes.

The signed-out panel gains "Start a household" as the secondary action beneath
"Join with code".

## 5 · Anonymous identity durability

**Now:** an anonymous identity lives in one browser's localStorage. Clear site
data or reinstall without a saved invite code and the household is unreachable.
`sync.js:154` is already honest about this in a comment; the UI is silent.

**Change:** when `Sync.isAnonymous`, the signed-in panel shows a plain line
stating the risk, plus an "Add an email" action calling
`client.auth.updateUser({ email })` to convert the anonymous user into a
permanent one.

Record honestly: that send comes out of the same two-per-hour mailer budget, and
it needs a confirmation click to take effect.

## 6 · Small things

**Version drift is three-way, not two-way.** `sw.js` says `grocery-v58`,
`index.html:206` says `v51`, and `PATCH_NOTES[0].version` says 50 — patch notes
stopped being written eight releases ago.

Fix: a new `assets/version.js` holding `APP_VERSION`. The About row renders it,
and patch notes are checked against it.

`CACHE` stays a literal in `sw.js`. Making the one mechanism whose failure is
*invisible* depend on `importScripts` update semantics is not a trade worth
taking. Instead `tools/check-version.sh` greps all three sources and exits
nonzero on disagreement, and the bump step in CLAUDE.md points at it.

**Sync panel button width.** Buttons in `#sync-body` are not inside a
`dialog menu`, so they never receive `flex: 1` from `style.css:606` and shrink
to fit. `.btn-clay`'s `border-radius: 0 0 6px 6px !important` is shaped for a
dialog footer, which is why "Join with code" reads as stranded mid-panel. Fix
with `#sync-body button { width: 100% }` plus a local radius override, following
the precedent already set for the new-list card at `style.css:651`.

**Google button.** Add `googleEnabled: false` to `SYNC_CONFIG` and render
`#sync-google-btn` only when true. One line to flip once OAuth is configured.

**"Your name".** Help text under the label at `index.html:171` naming what it
powers: the "by Alex" badge other household members see.

---

## Testing

- `DEFAULT_LIST` / `MIGRATED_LIST` selection and the roster fallback are pure
  and get cases in `tests/store.test.js`, per the CLAUDE.md rule that testable
  logic belongs in `Store`.
- The card, the toggle and the sync panel are UI. Verified by running
  `tests/run-tests.html` plus a manual pass in the browser pane against a
  cleared-storage profile.
- Item 4 and 5 need a manual pass against live Supabase: start a household
  anonymously on a clean profile, confirm local items seed, confirm a failed
  `ensure_household` leaves no stranded session.

## Cache

Bump `const CACHE` in `sw.js` from `grocery-v58` to `v59`. This work touches
`index.html`, `assets/app.js`, `assets/store.js`, `assets/style.css` and adds
`assets/version.js`.

## Delivery

Two commits, both landing on `main`:

- **A** — items 1, 2, 3, 6. No auth surface.
- **B** — items 4, 5. Auth surface.

Split so a sync regression stays easy to bisect away from a first-run
regression.
