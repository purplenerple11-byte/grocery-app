# Play and APK readiness — design

Date: 2026-09-18
Status: approved, in progress

Turning the PWA into something installable: first a sideloadable APK with no
Chrome URL bar, then a Google Play listing. This spec covers only the work that
lives in this repo. The Play developer account, ID verification, content rating
questionnaire, signing fingerprints and the upload itself are the owner's, and
are listed at the end so they are not mistaken for gaps in the code.

## Two claims from the original list that turned out to be wrong

**The Supabase keepalive is already shipped and green.** The original note said
the workflow "was never pushed because `.github` is gitignored". `.gitignore`
contains `.superpowers/`, `.DS_Store`, `.claude/` and `.impeccable/` — not
`.github`. `.github/workflows/supabase-keepalive.yml` is tracked, is on
`origin/main` as of commit `fb64cdb`, and has run on schedule six times with
six successes, most recently 2026-09-17 10:43 UTC. No work required.

**Target API 36 is not blocked by the local SDK.** PWABuilder builds in the
cloud, so the machine's SDK level is irrelevant, and `targetSdk` can be read as
plain text out of the generated project's `build.gradle` without an SDK
installed at all. Verification, not work.

**The path fallback is real and was confirmed.** Every unknown path on the live
site returns `index.html`:

    /.well-known/assetlinks.json  ->  200, text/html, 13501 bytes
    /nope-does-not-exist          ->  200, text/html, 13501 bytes

There is no `_headers`, `_redirects` or `_routes.json` in the repo.

## Package name

`dev.pigote.grocery`. Permanent — Play does not allow a change after the first
upload.

## A — Web plumbing

### `.well-known/assetlinks.json`

Without it, the installed APK opens with a Chrome URL bar across the top,
because Android cannot verify that this site and that package belong to the
same owner.

The file ships in this commit with the real package name and an **empty**
fingerprint array. An empty array verifies nothing, which is harmless, and it
buys the thing that actually matters: proof that Cloudflare Pages serves a real
file at that path rather than falling through to `index.html`. Cloudflare
excludes most dotfiles from upload and `.well-known/` is meant to be the
exception, but "meant to be" is not a thing to discover during a Play review.

Acceptance is a curl against the deployed site, checking three things and not
just the status code, since the SPA fallback also returns 200:

    curl -sI https://grocery-app-rie.pages.dev/.well-known/assetlinks.json

- status 200
- `content-type: application/json`
- body is the JSON, not 13501 bytes of HTML

If it falls through, the fallback is a Pages Function at
`functions/.well-known/assetlinks.json.js` returning the JSON directly. Pages
Functions need no npm and no build step, so this stays inside the
no-toolchain rule.

Two fingerprints go in later, because a sideloaded APK and the Play build are
signed by different keys:

1. the local upload/debug key used for the sideloadable APK
2. the certificate Play App Signing holds for the store build

Both are `sha256_cert_fingerprints` entries on the same `dev.pigote.grocery`
target. Filling them in is a one-line edit to a file whose serving is already
proven.

### `privacy.html`

Play requires a privacy policy URL for every app, with no exception for free or
personal ones, and the Data Safety form must agree with it. A static page in
this repo satisfies the URL requirement and keeps the policy in version control
next to the code it describes.

It must describe what the app actually does, which is:

*Stored on the device always* — every item, quantity, category, stock level,
price history and meal, in IndexedDB. A user who never signs in sends nothing
anywhere.

*Sent to Supabase only after joining or starting a household* —
- the item rows: name, category, unit, tracked flag, stock, low-at threshold,
  on-list flag, quantity, checked flag, list/store name, price history, and
  `added_by`
- meals: name and the item ids in them
- household id, membership and invite codes
- `added_by` carries the display name typed in Settings, which is why it is
  worth saying plainly that a name typed there is visible to everyone else in
  the household

*Held by Supabase auth* — an email address if magic-link sign-in was used, and
an anonymous user id otherwise. Nothing else.

*Not present* — no analytics, no ads, no third-party trackers, no telemetry.
The page should say so, because Data Safety asks and the honest answer is a
selling point.

A `#delete` section doubles as Play's required web URL for deletion requests,
so one page satisfies two separate Play requirements.

### Wiring

- Both files linked from the About section of the settings dialog
  (`index.html:207`), next to the existing What's new row and version line
- `privacy.html` added to the `ASSETS` precache array in `sw.js` so it works
  offline. `assetlinks.json` is deliberately **not** precached: it is fetched by
  the Android system at install time, never by the page.
- `const CACHE` bumped, `APP_VERSION` bumped, a patch note added, and
  `sh tools/check-version.sh` run — the three-way drift this repo has already
  had once

## B — Account deletion

Play requires an app that lets people create accounts to offer deletion from
inside the app **and** at a public web URL. This app has sign-in, households and
"Sign out", and no deletion path at all.

`delete_my_account()`, SECURITY DEFINER, doing in one transaction:

1. delete this user's `household_members` rows
2. delete any household left with no members — `households` cascades to
   `items`, `meals` and `household_invites`, so a household that still has
   other members must be left alone and its rows must survive
3. delete the `auth.users` row for `auth.uid()`

Gated on `auth.uid() is null -> raise exception`, matching the shape
`ensure_household()` already uses.

In the app: a destructive button in Settings behind a typed confirmation, not a
plain OK/Cancel, since it cannot be undone. Local IndexedDB is cleared too —
"delete my account" that leaves the list sitting on the phone is a lie.

Tests go in `tests/store.test.js` against the fake, including the case that
matters most: a user leaving a household that still has other members must not
take their data with them.

## C — Email confirmation banner

`Sync.attachEmail()` exists so an anonymous user can rescue their identity, and
its current copy is already honest: *"The account is linked once you open it."*
The problem is that it is a `.dialog-note` — small grey text that disappears
the moment the dialog closes. The failure it guards against is someone typing
their email, feeling safe, closing the dialog, and losing the account anyway.

`auth.users.email_change` exists on the live project, which means the JS client
exposes `user.new_email` while a confirmation is outstanding. **A pending
confirmation is server state, not something the app has to remember.** It
survives reload, app restart and a move to another device.

While `new_email` is set, the sync panel shows a standing card at the top —
"Waiting on you: confirm *address*" — with a Resend button. It clears itself
when the link is opened, because the underlying state does.

Two wrinkles:

- **Magic-link sign-in has no session**, so there is no `new_email` to read.
  That path needs a local stamp rendering the same card, cleared on sign-in.
- **Resend is rate limited to two an hour** on the free tier. The button shows
  its cooldown, or tapping it simply throws an error at the user.

## D — Listing assets

- Screenshots: at least two phone screenshots, captured through the browser
  pane at a phone viewport
- Feature graphic: 1024x500, rendered from a small HTML page and captured, in
  the app's own palette (`#C2410C` on `#FFF7ED`, per `manifest.json`)
- Icon: `icons/icon-512.png` already exists and satisfies the 512 requirement
- `docs/play-data-safety.md`: the form answers written to match `privacy.html`
  line for line, so the two cannot drift

## Not in this repo

The owner's, and calendar time rather than work:

- Developer account, one-time fee, ID verification. An account created after
  November 2023 needs a closed test with 12 testers opted in continuously for
  14 days before production access is granted. This is the long pole, it runs
  in parallel with everything above, and an account created before November
  2023 is exempt.
- Content rating questionnaire, contact email, descriptions
- The two signing fingerprints, which only exist once PWABuilder has generated
  a key and Play App Signing has been enabled
- The upload itself

## Delivery

Four commits, landed on `main` in order, each deployed and verified:

- **A** — assetlinks, privacy page, About links, SW precache, version bump
- **B** — deletion RPC, in-app button, tests
- **C** — pending-confirmation banner
- **D** — listing assets and the Data Safety answers
