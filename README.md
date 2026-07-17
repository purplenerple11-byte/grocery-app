# Grocery

Personal grocery list + household inventory tracker. Local-first PWA — no backend, no build step.

## Run

    python3 -m http.server 8000

Open http://localhost:8000. Install to home screen from the browser menu.

## Tests

Open `tests/run-tests.html` in a browser. Page title shows ✓/✗.

## Docs

- Spec: `docs/superpowers/specs/2026-07-16-grocery-app-design.md`
- Visual style reference: `docs/DESIGN.md`

## Manual smoke checklist

- [ ] Install as PWA (browser menu → Add to Home Screen / Install)
- [ ] Kill the server, reload the installed app — shell loads offline
- [ ] Add item → check off → adjust qty → Complete trip → tracked stock increases by qty bought
- [ ] Untracked checked item disappears on Complete trip
- [ ] Inventory: tap tile toggles list (clay ✓ ribbon); tap count opens −/＋ stepper
- [ ] Peek bar shows correct out/low pills when collapsed
- [ ] Long-press row/tile opens details; edit + delete work
- [ ] ⚙ Export then Import round-trips with no data change
- [ ] Malformed import shows banner, data untouched
