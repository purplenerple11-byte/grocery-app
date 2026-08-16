/* What's new, newest first. Plain data — no DOM, no logic; app.js renders it
   and Store.unseenNotes decides what counts as unread.

   `date` (ISO) is the identity, not `version`: the cache version only became
   user-visible at v39, so older entries have no number to honour and inventing
   one would be a lie on a screen whose whole job is telling the truth about
   what changed. `version` is shown as a badge when it is known.

   Write for the person holding the phone: what changed for them, not what
   changed in the repo. If a release only moved code around, leave it out —
   an entry that says nothing teaches people to stop reading these. */
const PATCH_NOTES = [
  {
    date: '2026-08-15',
    version: 50,
    notes: [
      'Added this page. Settings now shows what changed in each update, and marks the ones you have not read yet.'
    ]
  },
  {
    date: '2026-08-15',
    version: 49,
    notes: [
      'New app icon and favicon, matching Recipe Holder so the two sit together on your home screen.'
    ]
  },
  {
    date: '2026-08-14',
    version: 48,
    notes: [
      'A new look, shared with Recipe Holder: lighter, warmer, and easier to read.',
      'Dark mode is now a proper switch in Settings. It follows your system until you choose.',
      'Search your saved meals from the meals drawer.',
      'Settings closes from the top corner instead of the bottom of the list.',
      'Clearer stock dots — the low and out colours are easier to tell apart at a glance.'
    ]
  },
  {
    date: '2026-08-12',
    notes: [
      'Send a recipe’s ingredients straight to your list from Recipe Holder.',
      'A link back to Recipe Holder in the top bar.'
    ]
  },
  {
    date: '2026-08-09',
    version: 39,
    notes: [
      'Higher contrast for reading the screen in daylight, in the shop.',
      'Updates now install quietly in the background instead of waiting for a reload.',
      'Fixed a tap on a category header closing the whole inventory sheet.',
      'Settings shows which version you are running.'
    ]
  },
  {
    date: '2026-08-06',
    notes: [
      'Sync status in Settings, with a "Copy sync report" button so a phone can be checked without a computer.',
      'Fixed items that would not save, and a sync loop that kept re-sending things that had not changed.'
    ]
  },
  {
    date: '2026-08-04',
    notes: [
      'Household sync. Join with a code and share one list and inventory across phones — no email, no account to set up.',
      'Add your name in Settings and see who added each item.',
      'The inventory sheet now follows your finger properly, with a flick and a spring.'
    ]
  },
  {
    date: '2026-07-30',
    notes: [
      'Tidied up categories: Spice and Spices are one category again, as are Condiment and Condiments.',
      'Added Grains & Starch, Baking, Oil & Vinegar, and Canned & Jarred.',
      'Fixed editing an item quietly resetting its category to Other.',
      'A new category picker that no longer misplaces its selection dots.'
    ]
  },
  {
    date: '2026-07-22',
    notes: [
      'Export pantry — saves just what you have in stock, to hand to an AI for a meal suggestion.'
    ]
  }
];
