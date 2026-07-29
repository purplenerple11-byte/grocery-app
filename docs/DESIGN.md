---
name: Grocery
description: A warm dark single-column phone UI where serif names what you own and sans counts it
colors:
  canvas: "#141413"
  surface: "#1f1e1b"
  surface-2: "#262521"
  ink: "#faf9f5"
  muted: "#b0aea5"
  hairline: "#3d3d3a"
  clay: "#d97757"
  clay-deep: "#c6613f"
  ok: "#7d9b76"
  low: "#d9a557"
  out: "#c6613f"
typography:
  display:
    fontFamily: "Georgia, 'Source Serif Pro', Charter, serif"
    fontSize: "24px"
    fontWeight: 400
  headline:
    fontFamily: "Georgia, 'Source Serif Pro', Charter, serif"
    fontSize: "20px"
    fontWeight: 400
  title:
    fontFamily: "Georgia, 'Source Serif Pro', Charter, serif"
    fontSize: "16px"
    fontWeight: 400
  body:
    fontFamily: "Inter, system-ui, -apple-system, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
  caption:
    fontFamily: "Inter, system-ui, -apple-system, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, -apple-system, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  sm: "8px"
  md: "12px"
  tile: "14px"
  dialog: "16px"
  sheet: "20px"
  pill: "999px"
  circle: "50%"
spacing:
  tight: "4px"
  snug: "6px"
  base: "8px"
  control: "11px"
  gutter: "16px"
  section: "20px"
components:
  button-primary:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.canvas}"
    rounded: "0 0 8px 8px"
    padding: "12px 28px"
  button-primary-active:
    backgroundColor: "{colors.clay-deep}"
    textColor: "{colors.canvas}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-danger:
    textColor: "{colors.out}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  chip-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 14px"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "9px 13px"
  inventory-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "6px"
  check-circle:
    textColor: "transparent"
    rounded: "{rounded.circle}"
    size: "22px"
  check-circle-checked:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.circle}"
    size: "22px"
  dialog-surface:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "20px"
    width: "min(90vw, 360px)"
  bottom-sheet:
    backgroundColor: "{colors.surface-2}"
    rounded: "20px 20px 0 0"
    height: "64px"
---

# Design System: Grocery

## Overview

**Creative North Star: "Modern and Navigable"**

Grocery is a warm dark phone interface built for one hand and partial attention.
It is a single 480px column: a list you scan top-to-bottom, and a bottom sheet
you pull up to see everything you own. Nothing floats, nothing decorates, and
there is exactly one accent colour — so the one orange thing on screen is always
the thing you can act on.

Depth is tonal, not cast. Three near-black warm greys stack in a fixed order
(canvas → surface → surface-2), separated by 1px hairlines. That ladder does the
work shadows usually do, which keeps every surface flat and keeps contrast
predictable in a supermarket aisle under bad light.

The type system carries the personality instead. A serif names things the user
owns and typed — item names, meal names, headings. A sans handles everything the
machine contributes — counts, units, prices, labels, buttons. That split is the
system's most visible rule and the fastest way to tell whether new UI belongs.

This system began as a deliberate dark inversion of the Anthropic "scientific
field journal" parchment reference, which previously occupied this file and
remains in git history (`git log -- docs/DESIGN.md`). The inversion kept that
reference's rules — warm earth tones, serif for voice, flat surfaces, hairline
borders, accent reserved for action — and discarded its light canvas.

**Confirmed rejections:** ornamental or period framing. The system is not a
field notebook, an apothecary cabinet, or any other costume; describing it that
way leads to decoration that costs scanability. Modern and easy to navigate is
the goal, and where the two conflict, navigation wins.

**Key Characteristics:**

- One centred 480px column; identical layout on phone and desktop.
- Three-step tonal ladder plus hairlines; no shadows on anything at rest.
- Serif for user-authored nouns, sans for machine-authored numbers.
- A single accent hue family; status stays inside it.
- Round shapes for state (circles, pills), soft rectangles for content.

## Colors

A warm, near-monochrome dark palette with one accent hue family — every
chromatic colour on screen is a clay, a lichen, or an ochre, and there is no
second family to compete with them.

### Primary

- **Terracotta Slip** (`#d97757`): the only action colour. It fills the
  check-off circle when an item is in the basket, the 45° corner ribbon on an
  inventory tile that is on the list, the primary submit button in every dialog,
  and the border of a row or tile while a long-press is armed. It appears
  nowhere else.
- **Burnt Sienna** (`#c6613f`): the pressed state of Terracotta Slip, and — at
  the same value — the "out of stock" status. Out-of-stock reads as a deepened
  action colour, which is intentional: something at zero is something to buy.

### Secondary

- **Lichen** (`#7d9b76`): stocked. A desaturated green-grey that sits at the
  same visual weight as the neutrals rather than signalling "success".
- **Beeswax** (`#d9a557`): low stock. Warm yellow-ochre, one step brighter than
  the surface ladder so a low count catches the eye without alarming.

### Neutral

- **Bister** (`#141413`): the page canvas, and the text colour that sits *on*
  clay fills. Near-black with a warm cast, never pure `#000`.
- **Sepia Ground** (`#1f1e1b`): the standard raised surface — list rows,
  inventory tiles, the add field, pills, dialog inputs.
- **Umber Ground** (`#262521`): the second raised step — the bottom sheet, the
  meals drawer, dialogs, the error banner. Reserved for things that overlay the
  page rather than sit in it.
- **Bone** (`#faf9f5`): primary text on every dark surface. Ivory-tinted, never
  pure white.
- **Ash** (`#b0aea5`): secondary text — units, counts, categories, prices,
  helper copy, and the resting stroke of an unchecked circle.
- **Graphite Line** (`#3d3d3a`): every hairline border and divider, the sheet
  grabber, and the drawer tab's grip.

### Named Rules

**The Clay-Is-Action Rule.** Terracotta Slip marks state the user can change or
has just changed: checked, on-list, submit, armed. It is never a hover tint,
never a category colour, never decoration. If a new element wants to be orange,
the question is whether tapping it does something.

**The Earth-Only Rule.** Status is Lichen / Beeswax / Burnt Sienna. Never
signal green, yellow, or red — and never a cool grey, blue, or any hue outside
the warm family, even for informational UI.

**The One-Accent Rule.** There is one accent hue family and no second. A new
colour is a design failure before it is a design choice.

## Typography

**Display / Body Font:** Georgia (with `Source Serif Pro`, Charter, serif)
**UI Font:** Inter (with `system-ui`, `-apple-system`, Arial, sans-serif)

**Character:** A workhorse serif carrying the nouns against a neutral UI sans
carrying the arithmetic. The serif is set at modest sizes — 16px for an item
name, 24px at the largest — so it reads as voice rather than as display
typography. Neither face is loaded from a network; both resolve from system
stacks, which is what keeps the app instant offline.

### Hierarchy

- **Display** (serif, 400, 24px): the app title in the header. One instance.
- **Headline** (serif, 400, 20px): dialog titles and the meals drawer heading.
- **Title** (serif, 400, 16px): item names in list rows, meal names, pre-flight
  rows, and the "Inventory" label on the sheet bar. The most common serif in the
  app. Tile names drop to 12.5px/1.2 and clamp to two lines.
- **Body** (sans, 400, 15px): the add field and the primary button label.
- **Caption** (sans, 400, 11–13px, Ash): units, quantities, prices, stock
  counts, helper notes, price history rows.
- **Label** (sans, 600, 11px, `0.08em`, uppercase): category headers on both the
  list and the inventory grid, and the price-history heading. The only uppercase
  in the system.

### Named Rules

**The Serif-Names-It Rule.** If the string came from the user — an item they
typed, a meal they saved, a heading naming a thing — it is serif. If the app
produced it — a count, a unit, a price, a category, a button label — it is sans.
When unsure, ask who authored the string.

**The One-Line Rule.** Item names never wrap in a list row: `.name` is `flex: 1`
with ellipsis, and the unit and stepper hold their width. A long name truncates
rather than reflowing the row, because a shifting row height makes a moving list
unhittable.

## Layout

A single centred column capped at 480px, applied to `body` and mirrored on the
fixed sheet, drawer, and trip button so they stay pinned to the column's edges
rather than the viewport. Desktop gets the phone layout centred, not a wider
one — there is no responsive breakpoint and no second arrangement.

Vertical structure, top to bottom: sticky error banner (hidden by default),
header, add field, scrolling list, and a fixed bottom sheet. The list carries
`padding-bottom: 140px` so its last row clears both the collapsed sheet (64px)
and the trip button floating above it.

The inventory grid is four equal columns of square tiles (`aspect-ratio: 1`)
with 6px gutters, grouped under collapsible category headers. Four across is a
fixed decision, not a fluid `auto-fill` — it keeps tile size predictable and
name truncation consistent.

Rhythm: 16px page gutters, 6px between stacked rows and tiles, 11px between
controls inside a row, 8px between form fields. Density is deliberately compact;
a row is 9px/13px of padding around 16px type.

The bottom sheet is the app's second screen. Collapsed it is a 64px bar showing a
grabber, the label, and status pills. Open it is `86vh`. It animates on `height`,
and the meals drawer slides in from the column's left edge behind a
`rgba(0,0,0,.45)` scrim.

## Elevation & Depth

The system is flat by default. Depth is tonal: `#141413` → `#1f1e1b` →
`#262521`, each step paired with a 1px `#3d3d3a` hairline. A dialog is not
"above" the page because it casts a shadow; it is above because it is the
lightest surface in the ladder, sitting over a `rgba(0,0,0,.55)` backdrop.

Shadows exist in exactly one situation: an element that has physically detached
from the layout and is moving under the user's finger or on its own.

### Shadow Vocabulary

- **Lifted row** (`box-shadow: 0 6px 16px 2px rgba(0,0,0,.25)`): a list row
  picked up by a swipe. Applied on a 120ms hold, faded in over
  `box-shadow 0.15s ease-out`, then the transition is stripped so dragging tracks
  the finger with no lag. Offset, blur, spread, and alpha are all recomputed
  inline from drag distance.
- **In-flight clone** (`box-shadow: 0 4px 16px rgba(0,0,0,.12)`): a cloned
  pre-flight row travelling to its landing place in the list.
- **Popover** (`box-shadow: 0 4px 12px rgba(0,0,0,0.15)`): the autocomplete menu
  under the add field — the one static shadow, because the menu overlays content
  it does not belong to.

### Named Rules

**The Flat-Unless-Detached Rule.** If an element is in the layout, it has no
shadow. Shadow is the signal that something has left the page — lifted, flying,
or overlaying. Never use it to make a resting card look elevated; move it up the
tonal ladder instead.

## Shapes

A radius ladder that scales with the size of the thing: 8px for controls
(buttons, dialog inputs, the autocomplete menu), 12px for rows, the add field,
and meal cards, 14px for inventory tiles, 16px for dialogs, 20px for the top
corners of the bottom sheet. Larger surfaces get rounder corners, so the sheet
reads as a sheet and a button reads as a button.

Two shapes are fully round rather than on the ladder: `999px` pills for status
and toggle chips (`.pill`, `＋ Add`, `＋ Save list`, the track toggle), and true
circles (`50%`) for the check-off control (22px) and steppers (26px / 20px).
Round means state; soft rectangles mean content.

Borders are always exactly 1px `#3d3d3a`, except the check circle's 1.5px
stroke, which needs the extra weight to read at 22px.

The one clipped shape in the system is the on-list ribbon: a 28px square in the
tile's top-right corner cut to a triangle with
`clip-path: polygon(0 0, 100% 0, 100% 100%)`, filled clay, holding a small ✓.

### Named Rules

**The Bottom-Corner Rule.** The primary commit button — `#complete-trip` and
every `.btn-clay` — uses `border-radius: 0 0 8px 8px`: square on top, rounded
below. This is inherited from the parchment reference's signature bottom-only
radius and is the one asymmetric shape in the app. Never round it uniformly;
never apply it to a non-committing button.

## Components

### Buttons

- **Shape:** gently rounded (8px), except the primary commit button's
  bottom-only radius (`0 0 8px 8px`).
- **Primary:** clay fill, canvas-coloured text, 600 weight, no border, 12px/28px
  padding. Pressed state deepens to Burnt Sienna. Used for "Complete trip",
  "Finish trip", "Save", "Add to list" — one per dialog.
- **Ghost:** transparent, Bone text, 1px hairline, 9px/12px padding, flexed to
  equal width inside a dialog `<menu>`. The default for Cancel and secondary
  actions.
- **Danger:** ghost geometry with text and border in Burnt Sienna. Delete only.
- **Chip:** pill-shaped (999px), transparent or Sepia Ground, hairline border,
  3px/10px padding, 10–12px sans. Used for `＋ Add`, `＋ Save list`, and the
  per-row track toggle. Disabled chips drop to Ash at 50% opacity.
- **Icon:** the settings gear is a bordered 8px-radius chip at 14px, Ash text.

### Cards / Containers

- **List row:** Sepia Ground, 12px radius, hairline border, 9px/13px padding, 6px
  below. Contents in a single flex line: check circle, serif name (flex,
  ellipsised), unit, stepper.
- **Inventory tile:** Sepia Ground, 14px radius, hairline border, square, 6px
  padding. Name clamps to two lines at the top; a bottom row holds the status
  dot, the count, and — pushed right — the last price at 9.5px Ash.
- **Dialog:** Umber Ground, 16px radius, hairline border, 20px padding,
  `min(90vw, 360px)` wide, centred, over a `rgba(0,0,0,.55)` backdrop.
- **Bottom sheet:** Umber Ground, 20px top corners, hairline top border.
- **Banner:** sticky, Umber Ground, hairline bottom, 13px sans, dismiss ✕ in Ash
  pushed to the right.

### Inputs / Fields

- **Style:** Sepia Ground, 12px radius (8px inside dialogs), hairline border,
  Bone text, Ash placeholder, 11px/14px padding, full width.
- **Focus:** no custom treatment — the browser default ring is what ships.
  *(Provisional: an observed gap, not a designed decision.)*
- **Labels:** 12px Ash, stacked above the field with 4px of separation.
- **Number fields** in the trip dialog are pinned to 84px so price rows align.

### Navigation

There is no nav bar. Movement between the two screens is physical: the bottom
sheet bar (tap or swipe up) and a 28×84px tab on the column's left edge for the
meals drawer, styled as Umber Ground with the left border removed and the right
corners rounded 12px, holding a 4×32px Graphite Line grip. The tab fades to
`opacity: 0` while the drawer is open.

### Signature Components

**The check circle.** A 22px circle with a 1.5px Ash stroke and transparent
glyph. Checked, it fills clay with a canvas-coloured ✓ and strikes the name
through in Ash. The pre-flight dialog reuses the identical geometry with a 150ms
transition, so a staged item looks exactly like a basketed one.

**The on-list ribbon.** The clay 45° corner triangle on an inventory tile. It is
allowed to slightly overlap the tile name — an accepted trade for the corner
position.

**The status dot.** A 9px circle in Lichen / Beeswax / Burnt Sienna. It never
appears alone: on a tile it sits beside the count, in the peek bar it sits inside
a pill reading "3 out". Colour is a second channel, never the only one.

**The dimmed row.** A list row for something already in stock renders at
`opacity: .5` with an Ash "have 4" note. This must stay visually distinct from
`.row.done` (clay circle + strikethrough) — dimmed means "you may not need this",
struck means "it's in the basket".

### Motion

Motion is short and physical. State changes use `.15s`–`.25s` ease; anything the
user is dragging tracks the finger with no transition at all.

- Sheet height and drawer transform: `.25s ease`. Category chevron: `.2s ease`.
- Swipe release either flings out (`0.14s`–`0.32s ease-out`, scaled by velocity)
  or snaps back on `transform 0.3s cubic-bezier(.34,1.56,.64,1)` — the one
  overshoot in the system.
- Pre-flight items fly to the list as cloned rows: 640ms, 60ms stagger, motion
  complete at 85% with the remainder a cross-fade hand-off to the real row.
- Stock `＋`/`−` defers its re-render by 1500ms so a tile does not resort itself
  out from under a tapping thumb.

## Do's and Don'ts

### Do:

- **Do** reserve Terracotta Slip (`#d97757`) for action state only — checked,
  on-list, submit, armed.
- **Do** set user-authored nouns in Georgia serif and machine-authored numbers in
  Inter sans.
- **Do** create depth by moving up the tonal ladder (`#141413` → `#1f1e1b` →
  `#262521`) with a 1px `#3d3d3a` hairline.
- **Do** give the primary commit button the bottom-only radius (`0 0 8px 8px`).
- **Do** pair every status colour with a number or a word — "3 out", a count on
  the tile — so hue is never the only channel.
- **Do** scale radius with surface size: 8px controls, 12px rows, 14px tiles,
  16px dialogs, 20px sheet.
- **Do** keep new UI inside the 480px column and pin fixed elements to the
  column's edges, not the viewport's.

### Don't:

- **Don't** introduce a second accent hue, a cool grey, or a blue — even for
  informational UI.
- **Don't** use stock green / yellow / red for status; it is Lichen, Beeswax, and
  Burnt Sienna.
- **Don't** add `box-shadow` to anything at rest. Shadow means detached — lifted,
  in flight, or overlaying.
- **Don't** use pure white (`#ffffff`) or pure black (`#000000`); the system is
  warm-tinted at both ends (`#faf9f5`, `#141413`).
- **Don't** set body copy, counts, or button labels in the serif.
- **Don't** add gradients, glows, or background washes; fills are flat and solid.
- **Don't** let an item name wrap a list row — truncate instead, so row height
  stays stable under a moving thumb.
- **Don't** add ornament in service of a theme or period metaphor. If a
  decoration does not help someone find something faster, it does not ship.
