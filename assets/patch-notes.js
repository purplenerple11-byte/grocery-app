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
    date: '2026-09-22',
    version: 67,
    notes: [
      'Completing a trip no longer sweeps in items you had checked off on your other lists \u2014 the trip screen now shows only the list you are standing on.',
      'Signing in on a new phone, or after clearing your data, no longer invents a Groceries list and reshuffles the order of the ones you already had.'
    ]
  },
  {
    date: '2026-09-22',
    version: 66,
    notes: [
      'Settings \u2192 Sync now has Delete account. It removes your account and erases this device; if anyone else is in your household, their list stays put.'
    ]
  },
  {
    date: '2026-09-18',
    version: 65,
    notes: [
      'Settings now has a Privacy page: what stays on your phone, what the rest of your household can see, and how to delete the lot.'
    ]
  },
  {
    date: '2026-09-18',
    version: 64,
    notes: [
      'The list name and count now slide with the swipe instead of cutting to the new one.',
      'Fixed the Category and List dropdowns showing the field behind them through the options.'
    ]
  },
  {
    date: '2026-09-17',
    version: 63,
    notes: [
      'Renaming a list, adding a category, deleting a list and restoring a backup used to pop the browser\u2019s own grey box with the web address across the top. They now ask the way the rest of the app does.'
    ]
  },
  {
    date: '2026-09-17',
    version: 62,
    notes: [
      'After you ask for a sign-in link or add an email, Settings now keeps a notice at the top until you actually open the link \u2014 with a Resend button. Nothing is signed in or linked until that link is opened, and the old one-line note vanished the moment you closed the dialog.'
    ]
  },
  {
    date: '2026-09-17',
    version: 61,
    notes: [
      'Once you are in a household, Settings now asks for your name and takes you straight to the box. Without it, items you add turn up on everyone else\u2019s phone with no idea who put them there.'
    ]
  },
  {
    date: '2026-09-17',
    version: 60,
    notes: [
      'You can now start a household without an email address — tap Start a household in Settings. Previously only someone with an invite code could get in, which meant nobody could be first.',
      'If you signed in without an email, Settings now offers to add one, so a cleared browser or a new phone does not lock you out.'
    ]
  },
  {
    date: '2026-09-17',
    version: 59,
    notes: [
      'A new install now starts with a list called Groceries instead of Hannaford, and a short card explaining how the list and inventory work together.',
      'The Recipes button can be turned off in Settings.',
      'The version shown here is the one you are actually running. It had been wrong by eight releases.'
    ]
  },
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
