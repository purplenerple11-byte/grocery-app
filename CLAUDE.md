# CLAUDE.md

Read `HANDOFF.md` first — it covers the stack, file layout, and the data model.
This file is only the things that are easy to get wrong.

## Git workflow

**Merge finished work straight into `main`. Do not open a pull request unless
explicitly asked for one.** Develop on a branch if you like, but land it on
`main` yourself rather than leaving it for review.

⚠️ **`main` is production.** Cloudflare Pages deploys from `main` root, so every
push publishes to
https://grocery-app-rie.pages.dev/ within about a minute.
Make sure the tests pass before merging.

(This said GitHub Pages until 2026-08-13. It was never enabled — the
github.io URL 404s and always has. HANDOFF.md had it right.)

A merged pull request is finished — never reuse it or stack new commits on
already-merged history. Start follow-up work from the latest `main`.

## Before you merge anything that touches assets

**Bump `const CACHE` in `sw.js`** (`grocery-v17` → `v18`, …) whenever you change
`index.html`, `assets/*`, or the icons. The service worker is cache-first, so
without a bump an already-installed PWA keeps serving the old files and your
change is invisible on the device — the app looks unchanged even though the
deploy succeeded. This is the single easiest mistake to make here.

Then bump `APP_VERSION` in `assets/version.js` to match, add a patch note, and
run the check:

```bash
sh tools/check-version.sh
```

It fails if `sw.js`, `assets/version.js` and the newest entry in
`assets/patch-notes.js` disagree. They drifted eight releases apart once —
About said v51 while the cache was v58 — which made both the version row and
the What's new screen lie about what you were running. `sw.js` keeps its own
literal on purpose; `assets/version.js` says why.

## Tests

`tests/run-tests.html` in a browser; the page title shows ✓/✗. There is no test
runner and no CI.

**Serve it, don't open it as a file.** The relative `<script src>` tags do not
resolve over `file://` in a sandboxed viewer and you get a blank "running…"
that reads like a hang:

```bash
python3 -m http.server 8777
```

then open `/tests/run-tests.html` and read `document.title`. Use exactly ONE
tab — a second holds IndexedDB open and the DB tests hang for real.

There is **no Playwright on this machine** and no Chromium at
`/opt/pw-browsers/`, whatever earlier notes said. Don't install one; the
no-toolchain rule is why it isn't there.

New `Store` functions get tests in `tests/store.test.js`.

## Constraints that are deliberate, not oversights

- **No npm, no build step, no ES modules.** Plain `<script>` tags so the tests
  run over `file://`. Don't introduce a toolchain.
- **`assets/store.js` stays pure** — no DOM access. That is what makes it
  testable. Put UI concerns in `app.js`. When logic is worth testing, it belongs
  in `Store`, not in a handler.
- **Categories are open-ended.** `CATEGORY_ORDER` is the built-in shelf order,
  but an item's `category` is just a string and import accepts any value, so
  `groupByCategory` and `categoryChoices` both handle unknown categories. Never
  silently coerce an unrecognized category to `Other` — that destroys user data.
- **Single user, single device.** No accounts, no backend, no sync, not planned.

## Export formats

Two deliberately different shapes:

- **Export JSON** (`Store.serialize`) — the full, re-importable backup.
- **Export pantry** (`Store.serializePantry`) — only tracked items with
  `stock > 0`, minimal fields, for handing to an AI to suggest a meal. Not
  re-importable by design; don't "fix" it into a backup format.
