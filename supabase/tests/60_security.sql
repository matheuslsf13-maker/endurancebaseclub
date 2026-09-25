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

select tests.as_anon();
select tests.assert_raises($$select * from public.events$$, '42501');
select tests.assert_raises($$select * from public.marks$$, '42501');
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select public.internal_create_auth_user('a@b.co','12345678')$$, '42501');
select tests.assert_raises($$select public.bootstrap_owner('a@b.co','12345678','x')$$, '42501');
select tests.assert_raises($$select public.tk_event('x')$$, '42501');
select tests.assert_raises($$select public.entry_json(gen_random_uuid(), true)$$, '42501');
do $$ begin assert public.server_time() > 0; assert jsonb_typeof(public.pub_events()) = 'array'; end $$;
reset role;
select tests.as_user(tests.get('stranger')::uuid);
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select * from public.athletes$$, '42501');
reset role;
rollback;
