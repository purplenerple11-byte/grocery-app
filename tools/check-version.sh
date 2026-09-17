#!/bin/sh
# Three files carry the version and nothing kept them in step: sw.js reached
# v58 while About said v51 and the newest patch note said 50. Run this before
# merging anything that bumps a version.
#
#   sh tools/check-version.sh
#
# sw.js is intentionally not generated from assets/version.js — see the comment
# in that file. This script is what replaces that coupling.
set -eu
cd "$(dirname "$0")/.."

cache=$(sed -n "s/^const CACHE = 'grocery-v\([0-9]*\)';.*/\1/p" sw.js)
app=$(sed -n 's/^const APP_VERSION = \([0-9]*\);.*/\1/p' assets/version.js)
note=$(sed -n 's/^ *version: \([0-9]*\),.*/\1/p' assets/patch-notes.js | head -1)

printf 'sw.js CACHE        v%s\n' "$cache"
printf 'assets/version.js  v%s\n' "$app"
printf 'newest patch note  v%s\n' "$note"

fail=0
[ -n "$cache" ] && [ -n "$app" ] && [ -n "$note" ] || {
  echo "FAIL: could not read all three versions." >&2; exit 1; }
[ "$cache" = "$app" ] || { echo "FAIL: sw.js CACHE and APP_VERSION disagree." >&2; fail=1; }
[ "$cache" = "$note" ] || {
  echo "FAIL: newest patch note is v$note, but this release is v$cache." >&2
  echo "      Add an entry to assets/patch-notes.js, or bump the one on top." >&2
  fail=1; }

[ "$fail" = 0 ] && echo "OK: all three agree on v$cache."
exit "$fail"
