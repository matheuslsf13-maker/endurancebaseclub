begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.set('stranger', public.internal_create_auth_user('x@ebc.test','senha-forte-1')::text);

-- Ruling 35: a function created *after* 0006 (here, inside this test transaction) must still not
-- be PUBLIC-executable -- the schema-scoped default-privileges revoke alone cannot suppress
-- Postgres's built-in "PUBLIC gets EXECUTE on new functions" rule; only the role-global form
-- (`alter default privileges revoke execute on functions from public;`, no `in schema`) can.
create function public.zz_probe() returns int language sql as $$ select 1 $$;
do $$ begin
  assert not has_function_privilege('anon', 'public.zz_probe()', 'execute'),
    'a function created after 0006 must not be executable by anon';
  assert not has_function_privilege('authenticated', 'public.zz_probe()', 'execute'),
    'a function created after 0006 must not be executable by authenticated';
end $$;

-- A-M6: the full EXECUTE matrix (Rulings 15/35), run on production too (T29): anon can execute
-- exactly tk_* (except tk_event), pub_* and server_time; authenticated exactly those plus admin_*.
-- Every function of schema public is checked both ways, so a grant slipped in by a later migration
-- (or one missing for a new RPC) fails here by name.
do $$ declare bad text; begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'execute')
      <> ((p.proname like 'tk\_%' and p.proname <> 'tk_event') or p.proname like 'pub\_%' or p.proname = 'server_time');
  assert bad is null, 'anon EXECUTE differs from tk_*/pub_*/server_time for: ' || bad;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('authenticated', p.oid, 'execute')
      <> ((p.proname like 'tk\_%' and p.proname <> 'tk_event') or p.proname like 'pub\_%' or p.proname = 'server_time'
          or p.proname like 'admin\_%');
  assert bad is null, 'authenticated EXECUTE differs from admin_*/tk_*/pub_*/server_time for: ' || bad;
end $$;

select tests.as_anon();
select tests.assert_raises($$select * from public.events$$, '42501');
select tests.assert_raises($$select * from public.marks$$, '42501');
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select public.internal_create_auth_user('a@b.co','12345678')$$, '42501');
select tests.assert_raises($$select public.bootstrap_owner('a@b.co','12345678','x')$$, '42501');
select tests.assert_raises($$select public.tk_event('x')$$, '42501');
select tests.assert_raises($$select public.entry_json(gen_random_uuid(), true)$$, '42501');
-- resolve_public_event returns the full events row (including tk_token): ungranted, like tk_event.
select tests.assert_raises($$select public.resolve_public_event('x')$$, '42501');
do $$ begin assert public.server_time() > 0; assert jsonb_typeof(public.pub_events()) = 'array'; end $$;
reset role;
select tests.as_user(tests.get('stranger')::uuid);
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select * from public.athletes$$, '42501');
select tests.assert_raises($$select public.resolve_public_event('x')$$, '42501');
reset role;
rollback;
