-- Household sync schema for grocery-app.
-- Paste into Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
--
-- SECURITY: the anon/publishable key ships in a public static site. It grants
-- nothing on its own, but ONLY because every table below has RLS enabled and
-- every policy is scoped `to authenticated`. A table here with RLS off is a
-- public read/write grant to the internet. Verify before trusting it.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables ---

create table if not exists public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default 'Household',
  created_by   uuid references auth.users(id) on delete set null,
  last_trip_at timestamptz,
  last_trip_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user on public.household_members (user_id);

create table if not exists public.household_invites (
  code         text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '24 hours',
  redeemed_at  timestamptz,
  redeemed_by  uuid references auth.users(id) on delete set null
);

-- Ids are `text`, not `uuid`: Store.newId() falls back to a Math.random-based
-- id when crypto.randomUUID is missing, and Store.isUuid actually accepts
-- ^[\w-]{1,64}$. Matching that here means existing local ids migrate verbatim
-- with no remapping step.
create table if not exists public.items (
  id                text primary key check (id ~ '^[\w-]{1,64}$'),
  household_id      uuid not null references public.households(id) on delete cascade,
  name              text    not null check (char_length(name) between 1 and 200),
  category          text    not null default 'Other' check (char_length(category) <= 60),
  unit              text    not null default ''      check (char_length(unit) <= 40),
  tracked           boolean not null default false,
  stock             integer not null default 0 check (stock    between 0 and 100000),
  low_at            integer not null default 1 check (low_at   between 0 and 100000),
  on_list           boolean not null default false,
  list_qty          integer not null default 1 check (list_qty between 1 and 100000),
  checked           boolean not null default false,
  prices            jsonb   not null default '[]'::jsonb
                      check (jsonb_typeof(prices) = 'array'
                             and jsonb_array_length(prices) <= 500
                             and pg_column_size(prices) < 65536),
  -- The app's own Date.now() stamps. These drive conflict resolution.
  client_created_at bigint  not null,
  client_updated_at bigint  not null,
  deleted_at        bigint,                                  -- tombstone; null = live
  -- Server clock, trigger-stamped. Delta-pull cursor ONLY. Never client-written:
  -- one phone with a wrong clock would otherwise poison every device's cursor
  -- and cause permanently missed rows.
  updated_at        timestamptz not null default now()
);
create index if not exists items_household_updated on public.items (household_id, updated_at);

create table if not exists public.meals (
  id                text primary key check (id ~ '^[\w-]{1,64}$'),
  household_id      uuid not null references public.households(id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 200),
  item_ids          jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(item_ids) = 'array'
                             and jsonb_array_length(item_ids) <= 500),
  client_created_at bigint not null,
  client_updated_at bigint not null,
  deleted_at        bigint,
  updated_at        timestamptz not null default now()
);
create index if not exists meals_household_updated on public.meals (household_id, updated_at);

-- --------------------------------------------------------------- trigger ---

create or replace function public.stamp_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists items_stamp on public.items;
create trigger items_stamp before insert or update on public.items
  for each row execute function public.stamp_updated_at();

drop trigger if exists meals_stamp on public.meals;
create trigger meals_stamp before insert or update on public.meals
  for each row execute function public.stamp_updated_at();

-- ------------------------------------------------------------------- RLS ---

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.items             enable row level security;
alter table public.meals             enable row level security;

revoke all on public.households, public.household_members, public.household_invites,
              public.items, public.meals from anon;

-- The obvious membership policy self-references and dies with
--   42P17 infinite recursion detected in policy for relation "household_members"
-- A `security definer` function runs as its owner, bypassing RLS on that table,
-- so the recursion never starts.
-- CONSEQUENCE: never run `alter table ... force row level security` on these
-- tables — that would apply RLS to the owner too and break this pattern.
create or replace function public.my_household_ids()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select household_id from public.household_members where user_id = auth.uid() $$;

revoke execute on function public.my_household_ids() from public, anon;
grant  execute on function public.my_household_ids() to authenticated;

-- `(select fn())` is not cosmetic: it makes the planner hoist the call into an
-- InitPlan evaluated once per statement instead of once per row.
drop policy if exists items_all on public.items;
create policy items_all on public.items for all to authenticated
  using      (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

drop policy if exists meals_all on public.meals;
create policy meals_all on public.meals for all to authenticated
  using      (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

drop policy if exists households_select on public.households;
create policy households_select on public.households for select to authenticated
  using (id in (select public.my_household_ids()));

drop policy if exists households_update on public.households;
create policy households_update on public.households for update to authenticated
  using      (id in (select public.my_household_ids()))
  with check (id in (select public.my_household_ids()));
-- No insert/delete policy: households are created only via ensure_household().

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members for select to authenticated
  using (household_id in (select public.my_household_ids()));

drop policy if exists members_leave on public.household_members;
create policy members_leave on public.household_members for delete to authenticated
  using (user_id = (select auth.uid()));
-- No insert policy: membership is granted only by ensure_household()/redeem_invite().

drop policy if exists invites_select on public.household_invites;
create policy invites_select on public.household_invites for select to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists invites_revoke on public.household_invites;
create policy invites_revoke on public.household_invites for delete to authenticated
  using (created_by = (select auth.uid()));
-- No insert policy: create_invite() only.

-- ------------------------------------------------------------------ RPCs ---

-- Read-only probe. Deliberately separate from ensure_household: auto-creating a
-- household on first sign-in would strand an invited user in an orphan solo
-- household before they got the chance to redeem their code.
create or replace function public.my_household()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select household_id from public.household_members
   where user_id = auth.uid() order by joined_at limit 1
$$;

create or replace function public.ensure_household()
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare hid uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select household_id into hid from public.household_members
    where user_id = uid order by joined_at limit 1;
  if hid is not null then return hid; end if;
  insert into public.households (created_by) values (uid) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, uid, 'owner');
  return hid;
end $$;

-- An invite code is a bearer token: whoever holds it gets full read/write on
-- all household data. Hence single-use, 24h expiry, revocable, and 10 chars of
-- a 32-symbol alphabet (~2^50). Do NOT shorten to 8 (~2^40) — that is
-- brute-forceable against a public RPC.
create or replace function public.create_invite()
returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); hid uuid; c text;
        alpha text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';  -- no I/L/O/U
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select household_id into hid from public.household_members where user_id = uid limit 1;
  if hid is null then raise exception 'no household'; end if;
  -- Schema-qualified: pgcrypto lives in `extensions` on Supabase, and this
  -- function pins search_path to public for safety, so an unqualified call
  -- fails with 42883. gen_random_uuid() is unaffected — it is core Postgres.
  select string_agg(substr(alpha, 1 + (get_byte(b, i) % 32), 1), '')
    into c from (select extensions.gen_random_bytes(10) as b) s, generate_series(0, 9) i;
  insert into public.household_invites (code, household_id, created_by) values (c, hid, uid);
  return c;
end $$;

create or replace function public.redeem_invite(p_code text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); inv public.household_invites;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into inv from public.household_invites
    where code = upper(regexp_replace(p_code, '[^0-9A-Za-z]', '', 'g'))
      and redeemed_at is null and expires_at > now()
    for update;
  if not found then
    perform pg_sleep(0.5);                      -- blunt brute-force damper
    raise exception 'invalid or expired invite';
  end if;
  insert into public.household_members (household_id, user_id)
    values (inv.household_id, uid) on conflict do nothing;
  update public.household_invites
     set redeemed_at = now(), redeemed_by = uid where code = inv.code;
  return inv.household_id;
end $$;

revoke execute on function public.my_household(), public.ensure_household(),
                            public.create_invite(), public.redeem_invite(text)
  from public, anon;
grant  execute on function public.my_household(), public.ensure_household(),
                            public.create_invite(), public.redeem_invite(text)
  to authenticated;

-- ---------------------------------------------------------- keepalive ------
-- Free-tier projects pause after ~1 week of inactivity, which would leave the
-- household with silently failing syncs. A scheduled ping (see
-- .github/workflows/supabase-keepalive.yml) calls this twice a week.
--
-- Deliberately granted to `anon`: it takes no arguments, touches no table, and
-- returns a constant, so it discloses nothing beyond "the project exists".
create or replace function public.keepalive()
returns integer language sql stable
set search_path = pg_temp
as $$ select 1 $$;

grant execute on function public.keepalive() to anon, authenticated;
