# CLAUDE.md

Read `HANDOFF.md` first — it covers the stack, file layout, and the data model.
This file is only the things that are easy to get wrong.

## Git workflow

**Merge finished work straight into `main`. Do not open a pull request unless
explicitly asked for one.** Develop on a branch if you like, but land it on
`main` yourself rather than leaving it for review.

⚠️ **`main` is production.** GitHub Pages deploys from `main` root, so every
push publishes to
https://purplenerple11-byte.github.io/grocery-app/ within about a minute.
Make sure the tests pass before merging.

A merged pull request is finished — never reuse it or stack new commits on
already-merged history. Start follow-up work from the latest `main`.

## Before you merge anything that touches assets

**Bump `const CACHE` in `sw.js`** (`grocery-v17` → `v18`, …) whenever you change
`index.html`, `assets/*`, or the icons. The service worker is cache-first, so
without a bump an already-installed PWA keeps serving the old files and your
change is invisible on the device — the app looks unchanged even though the
deploy succeeded. This is the single easiest mistake to make here.

## Tests

`tests/run-tests.html` in a browser; the page title shows ✓/✗. There is no test
runner and no CI — if you want them verified headlessly, drive the page with
Playwright (Chromium is at `/opt/pw-browsers/`), then remove any `node_modules`
you installed so it never gets committed.

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
