/* The app's version, in one place.

   There were three of these and they disagreed: sw.js said v58, the About row
   said v51, and the newest patch note said 50 — eight releases of drift on the
   two screens whose only job is telling the truth about what you are running.

   sw.js deliberately does NOT read this file. Its CACHE constant stays a
   literal, because a stale service-worker cache fails invisibly — the deploy
   succeeds, the app looks unchanged, and nothing anywhere says why. Making
   that mechanism depend on importScripts update semantics would trade a
   problem you can see for one you cannot. tools/check-version.sh keeps the
   three honest instead, and CLAUDE.md points the bump step at it. */
const APP_VERSION = 67;
