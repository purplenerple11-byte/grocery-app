/* Supabase connection details.

   These are PUBLIC by design. The publishable key identifies the project and
   grants nothing on its own — every table has RLS enabled and every policy is
   scoped `to authenticated`, and `anon` has been revoked outright (verified:
   unauthenticated reads, writes and RPC calls all return 42501).

   The `service_role` key must NEVER appear here, or anywhere in this repo. It
   bypasses RLS entirely. */
const SYNC_CONFIG = {
  url: 'https://dplhjgexnkzwbdstwgkj.supabase.co',
  key: 'sb_publishable_rxqE9XHJgPjlyBjbLcCKjg_tZw91R0p',
  /* Session lives in localStorage under this prefix. boot() checks for it to
     decide whether to download the 205 KB client at all, so a signed-out user
     pays nothing. */
  storagePrefix: 'sb-dplhjgexnkzwbdstwgkj-auth-token'
};
