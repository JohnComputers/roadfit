begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select results_eq(
  $$select policyname::text from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
    order by policyname$$,
  $$values ('profiles_insert_own'::text),
           ('profiles_select_own'::text),
           ('profiles_update_own'::text)$$,
  'profiles exposes only explicit owner policies'
);
select results_eq(
  $$select policyname::text from pg_policies
    where schemaname = 'public' and tablename = 'saved_vehicles'
    order by policyname$$,
  $$values ('saved_vehicles_manage_own'::text)$$,
  'saved vehicles has one owner policy'
);
select results_eq(
  $$select policyname::text from pg_policies
    where schemaname = 'public' and tablename = 'collection_items'
    order by policyname$$,
  $$values ('collection_items_manage_own'::text)$$,
  'collection membership has one owner policy'
);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'one@roadfit.test'),
  ('20000000-0000-4000-8000-000000000002', 'two@roadfit.test');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$insert into public.saved_vehicles (user_id, vehicle_id, notes)
    values ('10000000-0000-4000-8000-000000000001', 'rf:v1:test-car-one', 'mine')$$,
  'user can save a vehicle for themself'
);

select throws_ok(
  $$insert into public.saved_vehicles (user_id, vehicle_id)
    values ('20000000-0000-4000-8000-000000000002', 'rf:v1:cross-owner')$$,
  '42501',
  'new row violates row-level security policy for table "saved_vehicles"',
  'user cannot save a vehicle for somebody else'
);

reset role;
select set_config('request.jwt.claims', '', true);

insert into public.saved_vehicles (user_id, vehicle_id, notes)
values ('20000000-0000-4000-8000-000000000002', 'rf:v1:test-car-two', 'private');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$select count(*)::bigint from public.saved_vehicles$$,
  array[1::bigint],
  'user sees only their saved vehicles'
);

select is(
  (select notes from public.saved_vehicles where vehicle_id = 'rf:v1:test-car-two'),
  null::text,
  'another user saved vehicle is invisible'
);

select lives_ok(
  $$update public.saved_vehicles set notes = 'changed' where vehicle_id = 'rf:v1:test-car-two'$$,
  'cross-owner update does not leak an error'
);

select results_eq(
  $$select count(*)::bigint from public.saved_vehicles
    where vehicle_id = 'rf:v1:test-car-two' and notes = 'changed'$$,
  array[0::bigint],
  'cross-owner update affects no visible row'
);

select lives_ok(
  $$insert into public.collections (user_id, name)
    values ('10000000-0000-4000-8000-000000000001', 'Weekend shortlist')$$,
  'user can create a collection'
);

reset role;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$insert into public.collection_items (collection_id, saved_vehicle_id, user_id)
    select c.id, v.id, '10000000-0000-4000-8000-000000000001'
    from public.collections c
    cross join public.saved_vehicles v
    where c.name = 'Weekend shortlist' and v.vehicle_id = 'rf:v1:test-car-two'$$,
  '23503',
  null,
  'composite owner foreign key prevents cross-owner collection membership'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$select public.request_account_deletion()$$,
  'an authenticated user can delete exactly their own account'
);

reset role;
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$select id from auth.users order by id$$,
  array['20000000-0000-4000-8000-000000000002'::uuid],
  'account deletion preserves other auth users'
);

set local role anon;

select throws_ok(
  $$select count(*)::bigint from public.saved_vehicles$$,
  '42501',
  null,
  'anonymous visitors cannot read private saves'
);

select throws_ok(
  $$insert into public.saved_vehicles (user_id, vehicle_id)
    values ('10000000-0000-4000-8000-000000000001', 'rf:v1:anonymous-save')$$,
  '42501',
  null,
  'anonymous visitors cannot create private saves'
);

reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon has no profile table grant'
);

select ok(
  not has_function_privilege('anon', 'public.request_account_deletion()', 'EXECUTE'),
  'anon cannot execute account deletion'
);

select * from finish();
rollback;
