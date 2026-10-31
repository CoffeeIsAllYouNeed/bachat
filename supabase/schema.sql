-- Bachat family sync (Supabase free tier).
-- Run once in the Supabase SQL editor, then enable Authentication → Sign In / Providers → "Allow anonymous sign-ins".
--
-- What the server stores: an opaque household id, a SHA-256 hash of the join
-- token, opaque member ids, and each member's snapshot as ciphertext + nonce
-- (tweetnacl secretbox, sealed on the phone). Names and amounts are only inside
-- the ciphertext. The household secret never reaches the server.

-- ---------------------------------------------------------------- tables

create table if not exists public.households (
  id          text primary key check (id ~ '^[0-9a-f]{32}$'),
  join_hash   text not null check (join_hash ~ '^[0-9a-f]{64}$'),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  household_id text not null references public.households (id) on delete cascade,
  member_id    text not null check (member_id ~ '^[0-9a-f]{16}$'),
  user_id      uuid not null default auth.uid(),
  joined_at    timestamptz not null default now(),
  primary key (household_id, member_id)
);
create index if not exists members_user_idx on public.members (user_id);

create table if not exists public.snapshots (
  household_id text not null,
  member_id    text not null,
  ciphertext   text not null check (length(ciphertext) <= 1500000),
  nonce        text not null check (length(nonce) <= 64),
  updated_at   timestamptz not null default now(),
  primary key (household_id, member_id),
  foreign key (household_id, member_id) references public.members (household_id, member_id) on delete cascade
);

-- ---------------------------------------------------------------- helpers
-- security definer so policies can check membership without recursing into members' own RLS.

create or replace function public.is_household_member(hid text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

create or replace function public.owns_member(hid text, mid text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = hid and m.member_id = mid and m.user_id = auth.uid()
  );
$$;

-- Join (or create) a household. The token is derived from the household secret
-- on the phone; only its SHA-256 is stored. The first caller for an id creates
-- the household; later callers must present the same token.
create or replace function public.join_household(p_household text, p_token text, p_member text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'bad token';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  insert into public.households (id, join_hash, created_by)
  values (p_household, v_hash, auth.uid())
  on conflict (id) do nothing;

  if not exists (select 1 from public.households h where h.id = p_household and h.join_hash = v_hash) then
    raise exception 'wrong code';
  end if;

  -- One member id per signed-in user per household; a reinstall (new anonymous
  -- user, same member id) takes the member id over by proving the token again.
  delete from public.members m
  where m.household_id = p_household and m.user_id = auth.uid() and m.member_id <> p_member;

  insert into public.members (household_id, member_id, user_id)
  values (p_household, p_member, auth.uid())
  on conflict (household_id, member_id) do update set user_id = excluded.user_id;
end;
$$;

revoke all on function public.join_household(text, text, text) from public, anon;
grant execute on function public.join_household(text, text, text) to authenticated;
revoke all on function public.is_household_member(text) from public, anon;
grant execute on function public.is_household_member(text) to authenticated;
revoke all on function public.owns_member(text, text) from public, anon;
grant execute on function public.owns_member(text, text) to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.snapshots  enable row level security;

-- households: members can see their household; writes only through join_household().
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (public.is_household_member(id));

-- members: members see each other; any member may remove a member (family trust model);
-- inserts only through join_household().
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists members_delete on public.members;
create policy members_delete on public.members
  for delete to authenticated
  using (public.is_household_member(household_id));

-- snapshots: members read the household's rows; each member writes only its own row.
drop policy if exists snapshots_select on public.snapshots;
create policy snapshots_select on public.snapshots
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists snapshots_insert on public.snapshots;
create policy snapshots_insert on public.snapshots
  for insert to authenticated
  with check (public.owns_member(household_id, member_id));

drop policy if exists snapshots_update on public.snapshots;
create policy snapshots_update on public.snapshots
  for update to authenticated
  using (public.owns_member(household_id, member_id))
  with check (public.owns_member(household_id, member_id));

drop policy if exists snapshots_delete on public.snapshots;
create policy snapshots_delete on public.snapshots
  for delete to authenticated
  using (public.owns_member(household_id, member_id));

-- No access for the anon role (signed-out clients).
-- Supabase's default privileges grant everything to anon and authenticated; start from nothing,
-- then grant only what the policies above use (RLS still applies on top).
revoke all on public.households, public.members, public.snapshots from anon, authenticated;
grant select on public.households to authenticated;
grant select, delete on public.members to authenticated;
grant select, insert, update, delete on public.snapshots to authenticated;
