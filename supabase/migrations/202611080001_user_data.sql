-- RoadFit private user data.
-- The public vehicle catalog is deliberately static and versioned in the site build;
-- Supabase stores only account-owned data keyed by the catalog's stable vehicle_id.

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  default_budget numeric(12, 2) check (default_budget is null or default_budget between 0 and 100000000),
  preferred_filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferred_filters) = 'object')
    check (octet_length(preferred_filters::text) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collections (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 280),
  color text not null default '#f97316' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text not null default 'bookmark' check (char_length(icon) between 1 and 32),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index collections_user_name_key
  on public.collections (user_id, lower(btrim(name)));
create index collections_user_sort_idx
  on public.collections (user_id, sort_order, created_at);

create table public.saved_vehicles (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  vehicle_id text not null
    check (vehicle_id ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]{4,191}$'),
  notes text check (notes is null or char_length(notes) <= 10000),
  -- A display-only snapshot keeps a favorite understandable if a future catalog
  -- refresh retires an identifier. It is never treated as canonical catalog data.
  vehicle_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(vehicle_snapshot) = 'object')
    check (octet_length(vehicle_snapshot::text) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, vehicle_id),
  unique (id, user_id)
);

create index saved_vehicles_user_created_idx
  on public.saved_vehicles (user_id, created_at desc);
create index saved_vehicles_vehicle_idx
  on public.saved_vehicles (vehicle_id);

create table public.collection_items (
  collection_id uuid not null,
  saved_vehicle_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (collection_id, saved_vehicle_id),
  constraint collection_items_collection_owner_fk
    foreign key (collection_id, user_id)
    references public.collections (id, user_id) on delete cascade,
  constraint collection_items_vehicle_owner_fk
    foreign key (saved_vehicle_id, user_id)
    references public.saved_vehicles (id, user_id) on delete cascade
);

create index collection_items_user_idx
  on public.collection_items (user_id, created_at desc);
create index collection_items_vehicle_idx
  on public.collection_items (saved_vehicle_id);

create table public.saved_searches (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  filters jsonb not null
    check (jsonb_typeof(filters) = 'object')
    check (octet_length(filters::text) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_searches_user_updated_idx
  on public.saved_searches (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger collections_set_updated_at
before update on public.collections
for each row execute function public.set_updated_at();

create trigger saved_vehicles_set_updated_at
before update on public.saved_vehicles
for each row execute function public.set_updated_at();

create trigger saved_searches_set_updated_at
before update on public.saved_searches
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  if profile_name is null then
    profile_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, left(profile_name, 80))
  on conflict (id) do nothing;

  insert into public.collections (user_id, name, color, icon, sort_order, is_default)
  values
    (new.id, 'Affordable', '#22c55e', 'wallet', 0, true),
    (new.id, 'Considering', '#f97316', 'scale', 1, true),
    (new.id, 'Dream Cars', '#a855f7', 'sparkles', 2, true)
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- A narrowly scoped self-service deletion RPC. The definer privilege is needed
-- to remove the caller's auth.users row; the predicate can only ever use the
-- verified JWT subject. Cascading foreign keys remove all RoadFit user data.
create or replace function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
begin
  if requesting_user is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;

  delete from auth.users where id = requesting_user;
  if not found then
    raise no_data_found using message = 'Authenticated user no longer exists';
  end if;
end;
$$;

revoke all on function public.request_account_deletion() from public;
revoke all on function public.request_account_deletion() from anon;
grant execute on function public.request_account_deletion() to authenticated;

-- Backfill projects that enabled RoadFit after users had already registered.
insert into public.profiles (id, display_name)
select
  u.id,
  left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                nullif(split_part(coalesce(u.email, ''), '@', 1), '')), 80)
from auth.users as u
on conflict (id) do nothing;

insert into public.collections (user_id, name, color, icon, sort_order, is_default)
select p.id, defaults.name, defaults.color, defaults.icon, defaults.sort_order, true
from public.profiles as p
cross join (
  values
    ('Affordable'::text, '#22c55e'::text, 'wallet'::text, 0),
    ('Considering'::text, '#f97316'::text, 'scale'::text, 1),
    ('Dream Cars'::text, '#a855f7'::text, 'sparkles'::text, 2)
) as defaults(name, color, icon, sort_order)
on conflict do nothing;

alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.saved_vehicles enable row level security;
alter table public.collection_items enable row level security;
alter table public.saved_searches enable row level security;

create policy "profiles_select_own"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "profiles_insert_own"
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy "profiles_update_own"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "collections_manage_own"
on public.collections for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "saved_vehicles_manage_own"
on public.saved_vehicles for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "collection_items_manage_own"
on public.collection_items for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "saved_searches_manage_own"
on public.saved_searches for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.profiles from anon;
revoke all on public.collections from anon;
revoke all on public.saved_vehicles from anon;
revoke all on public.collection_items from anon;
revoke all on public.saved_searches from anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.collections to authenticated;
grant select, insert, update, delete on public.saved_vehicles to authenticated;
grant select, insert, update, delete on public.collection_items to authenticated;
grant select, insert, update, delete on public.saved_searches to authenticated;

comment on column public.saved_vehicles.vehicle_id is
  'Stable identifier from the versioned static RoadFit catalog; never a live-listing ID.';
comment on column public.saved_vehicles.vehicle_snapshot is
  'Untrusted display fallback only. Canonical specs and prices come from the static catalog.';
