# House style

The visual system behind Recipe Holder, written down so another app can be
built to match. Copy this file into a new project and an agent can follow it.

The premise: **a calm paper surface you operate one-handed, often with wet
hands, often in bad light.** Everything below follows from that. Warm neutrals
because a kitchen is not an IDE. Large touch targets because a thumb is not a
mouse. One accent, used sparingly, because the content is the recipe.

---

## 1. Colour

### Light

| Role | Token | Hex |
|---|---|---|
| The page | `stone-50` | `#fff7ed` — warm paper, not white |
| Cards, inputs | `white` | `#ffffff` |
| Hairlines | `stone-200` | `#e7e5e4` |
| Input borders | `stone-300` | `#d6d3d1` |
| Faint text, icons | `stone-400` | `#a8a29e` |
| Muted text | `stone-500` | `#78716c` |
| Body text | `stone-800` | `#292524` |
| Headings, primary buttons | `stone-900` | `#1c1917` |
| Accent (focus, links, timers) | `amber-500` / `amber-800` | `#f59e0b` / `#92400e` |
| Destructive | `red-600` | `#dc2626` |
| Brand (manifest, status bar) | — | `#c2410c` |

Neutrals are **stone**, never slate or zinc. Stone is warm; the page reads as
paper rather than as a screen.

### Dark

Dark mode is one CSS block and **zero component edits**. Tailwind v4 compiles
every colour utility to `var(--color-*)`, so redefining those variables under
`.dark` re-points the whole app at once. The ramp is *inverted*, not dimmed —
`stone-50` was the lightest surface and becomes the page; `stone-900` was
near-black text and becomes near-white. Every existing pairing keeps its
contrast.

```css
.dark {
  --color-white: #4a4a4a;     /* cards, one step up from the page */
  --color-stone-50: #3d3d3d;  /* the page itself */
  --color-stone-100: #4f4f4f; /* hover fills */
  --color-stone-200: #5c5c5c; /* hairlines */
  --color-stone-300: #6e6e6e; /* input borders */
  --color-stone-400: #9a9a9a; /* faint text, icons */
  --color-stone-500: #b4b4b4; /* muted text */
  --color-stone-600: #cfcfcf;
  --color-stone-700: #e2e2e2;
  --color-stone-800: #efefef;
  --color-stone-900: #f8f8f8; /* headings */

  background: #3d3d3d;
  color: #f8f8f8;
}
```

Two traps this hit, both worth inheriting as rules:

1. **Invert a whole ramp or none of it.** Overriding `amber-50/100/200` but not
   `amber-300` and `amber-900` left the timer pills with a bright outline and
   near-black text on brown — **1.6:1**. Fix the entire ramp a component
   touches. The corrected accent ramp for dark: fill `#37342d`, outline and
   text `#c4b393` (8.2:1), hover `#403c33`, pressed `#4a453a`.
2. **A shared token sometimes needs a per-utility escape.** Primary buttons are
   `bg-stone-900`, the same token as heading text. Inverted wholesale they
   become near-white and glare. Headings still want that contrast, so override
   the background utility alone:
   ```css
   .dark .bg-stone-900 { background-color: #d4d4d4; }
   ```

Set the class before first paint or every load flashes light:

```html
<script>(function(){try{var t=localStorage.getItem("theme");
var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;
if(d)document.documentElement.classList.add("dark")}catch(e){}})()</script>
```

In Next.js that is `next/script` with `strategy="beforeInteractive"`, plus
`suppressHydrationWarning` on `<html>` — the server legitimately can't know the
theme. The toggle reads the DOM class through `useSyncExternalStore`, never its
own state, or the two disagree on first render.

---

## 2. Type

Three faces, three jobs:

| Role | Face | Used for |
|---|---|---|
| Display | **Fraunces** | Recipe titles, page headings, the wordmark |
| Body | **Geist** | Everything else |
| Data | **Geist Mono** | Countdowns, quantities |

The serif is the whole personality of the app, and it appears **only on names
of things** — titles, headings, the wordmark. Never on UI chrome, never on body
copy. That restraint is what stops it reading as decoration.

Scale, in Tailwind terms:

- `text-3xl font-serif` — page title
- `text-lg font-serif leading-snug` — item titles in a list
- `text-sm` — body, buttons, most UI
- `text-xs font-semibold uppercase tracking-wide text-stone-500` — section
  labels. This one device carries the whole document structure; it is the only
  place uppercase appears.
- `text-xs text-stone-400` — hints, timestamps

Titles **wrap, never truncate**. On a phone, truncation put half the list in an
ellipsis. `min-w-0 flex-1` on the text column, no `truncate`.

Inputs are `font-size: 16px` on screens under 768px, or iOS zooms the page on
focus:

```css
@media (max-width: 767px) {
  input, textarea, select { font-size: 16px; }
}
```

---

## 3. Shape and space

- **Radii**: `rounded-xl` (12px) for cards, tiles and thumbnails;
  `rounded-md` (6px) for buttons and inputs; `rounded-full` for chips and
  pills. Nothing else.
- **Borders**: 1px, `stone-200` for hairlines and `stone-300` for anything you
  can type into. Shadows are for things that float — menus, toasts — never for
  cards.
- **Page**: `max-w-3xl mx-auto px-4 py-8`. One column. No sidebars.
- **Rows**: `px-4 py-3.5`, `gap-4`. Roughly a 44px minimum tap target.
- **Sections**: `mt-8` between them, `space-y-8` inside a form.
- **Thumbnails**: `h-20 w-20 rounded-xl object-cover`, right-aligned at the far
  edge of the row.

---

## 4. Components

**Primary button** — `rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium
text-white transition hover:bg-stone-700 disabled:opacity-60`. One per view.

**Secondary button** — same box, no fill: `text-stone-600 hover:bg-stone-100`.

**Destructive** — `text-red-600 hover:bg-red-50`. Never a filled red button;
the confirm dialog is the safety, not the colour.

**Input** — `rounded-md border border-stone-300 bg-white px-3 py-2
outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200`. The
amber ring is the only place the accent appears on a form.

**Card / row** — `rounded-xl border border-stone-200 bg-white`, contents
`flex items-center gap-4 px-4 py-3.5`, `hover:bg-stone-50`. Add
`select-none` to anything that responds to press-and-hold, or the browser
drag-selects the label under the cursor.

**Chip** (a choice) — `rounded-full border px-3 py-1 text-sm`. Selected:
`border-stone-500 bg-stone-500 text-white`. Unselected: `border-stone-200
text-stone-400`.

**Tag** (a fact) — `rounded-full border border-stone-300 bg-stone-100 px-3 py-1
text-sm text-stone-700`, with an `×` button inside when removable.

**Toast** — `fixed inset-x-4 bottom-6 mx-auto max-w-sm rounded-xl px-4 py-3
text-sm shadow-lg bg-stone-900 text-stone-50`, red for errors. Auto-dismisses
at 4s, so a confirmation never becomes something to tidy up.

**Menu** — `rounded-xl border border-stone-200 bg-white shadow-xl`, minimum
200px wide, items `px-4 py-3`. Positioned **above and centred on** the touch
point, so the finger that summoned it isn't covering it; flips below only when
there is no room above.

---

## 5. Motion

Three animations, each ~250–520ms. That is the whole vocabulary.

**Pop** — anything appearing under a finger.

```css
@keyframes menu-pop {
  from { opacity: 0; transform: scale(0.7); }
  to   { opacity: 1; transform: scale(1); }
}
.animate-menu-pop { animation: menu-pop 240ms cubic-bezier(0.34,1.56,0.64,1) both; }
```

Set `transform-origin` to the edge nearest the touch point (`origin-bottom`
when the menu is above the finger), or it grows from the wrong corner.

**Drop** — a container unfolding. Soft at the start, rigid afterwards: squash,
one release past the resting size, then every step smaller than the last. There
is **no second bounce** — after the peak the overshot edge is simply dragged
back, and the thing stops feeling elastic the moment it is open.

```css
@keyframes stack-drop {
  0%   { transform: scaleY(0.8);   opacity: 0.5; }
  16%  { transform: scaleY(1.11);  opacity: 1; }
  38%  { transform: scaleY(1.05); }
  62%  { transform: scaleY(1.02); }
  82%  { transform: scaleY(1.006); }
  100% { transform: scaleY(1); }
}
.animate-stack-drop {
  animation: stack-drop 460ms linear both;
  transform-origin: top center;
}
```

`linear` on purpose — the deceleration lives in the keyframe stops, and an ease
curve on top rounds off the release. Restart it by changing the element's
`key`, or the browser considers it already played.

**Fade** — 260ms ease, for backdrops only.

Always clamp:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-menu-pop, .animate-fade-in, .animate-stack-drop { animation-duration: 1ms; }
}
```

---

## 6. Interaction rules

**Edit in place.** No edit screens and no forms that save everything at once.
Content is read-only with a pencil that appears on hover (and is always visible
under `md`, since a phone has no hover). A failed save **stays in edit mode
with the typing intact** — discarding the user's words is worse than showing
the error. `Esc` cancels, `⌘↵` saves.

**Chips save immediately.** Anything with no free text to lose — a category, a
toggle — writes on click. A Save button there is a step that buys nothing.

**Press-and-hold for the second action.** Use pointer events, not touch events,
or desktop gets nothing but right-click. 500ms, cancelled by 10px of movement.
Suppress the click that follows with a **deadline set on pointer-up**, not a
flag: a long press often produces no click at all, and a flag nothing clears
silently eats the next ordinary tap.

**Optimistic deletes, rolled back on failure.** Remove the row, then reconcile.

**One accent, one primary.** If a view has two filled dark buttons, one of them
is wrong.

---

## 7. Voice

Sentence case everywhere except the uppercase section labels. No exclamation
marks. No "Oops".

- Buttons name the outcome: **Add to timeline**, **Use this crop**, **Save a
  second copy**.
- Empty states say what to do next: *"No photos yet — add your first attempt
  above."*
- Errors name the cause and the fix: *"Images must be 10MB or smaller."*
- Hints are `text-xs text-stone-400` and appear once, next to the control:
  *"Drag to reposition, pinch or use the slider to zoom."*
- Prefer an em dash to a colon in a hint. Prefer a real "—" and "…" to "--" and
  "...".

---

## 8. Porting it

1. Tailwind v4, `stone` as the neutral, `amber` as the accent.
2. Copy the `.dark` block from §1 into `globals.css`, unlayered.
3. Add the theme script from §1 before first paint.
4. Load Fraunces + Geist + Geist Mono; wire `--font-serif`, `--font-sans`,
   `--font-mono`.
5. Copy the three keyframes and the reduced-motion clamp from §5.
6. Set the manifest `background_color: "#FFF7ED"` and
   `theme_color: "#C2410C"`, and give it `scope: "/"` — Android builds link
   capturing from the scope, and without it every inbound link opens in a
   Custom Tab with a coloured browser bar over the top.
7. Build one screen. If it needs a colour that isn't in §1, the screen is
   probably wrong before the palette is.
