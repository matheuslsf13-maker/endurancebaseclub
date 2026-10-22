begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.as_user(tests.get('owner')::uuid);
select tests.set('helper', public.admin_create_organizer('ajudante@ebc.test', 'senha-forte-2', 'Ajudante') ->> 'user_id');
select tests.set('other', public.admin_create_organizer('outra@ebc.test', 'senha-forte-3', 'Outra') ->> 'user_id');
reset role;
update public.organizers set must_change_password = false;
select tests.as_user(tests.get('owner')::uuid);

-- name + e-mail: trimmed/lowercased, and the login e-mail moves in auth.users and auth.identities
do $$ declare o jsonb; uid uuid := tests.get('helper')::uuid; begin
  o := public.admin_update_organizer(uid, '  Ajudante Nova ', ' Nova@EBC.test ');
  assert o ->> 'name' = 'Ajudante Nova' and o ->> 'email' = 'nova@ebc.test', o::text;
end $$;
reset role;
do $$ declare uid uuid := tests.get('helper')::uuid; begin
  assert (select email from auth.users where id = uid) = 'nova@ebc.test';
  assert (select identity_data ->> 'email' from auth.identities where user_id = uid and provider = 'email') = 'nova@ebc.test';
  assert not (select must_change_password from public.organizers where user_id = uid), 'no password given: flag untouched';
end $$;
select tests.as_user(tests.get('owner')::uuid);

-- a new temporary password works for sign-in and forces a change on the next login
select public.admin_update_organizer(tests.get('helper')::uuid, 'Ajudante Nova', 'nova@ebc.test', 'provisoria-9');
reset role;
do $$ declare uid uuid := tests.get('helper')::uuid; begin
  assert (select encrypted_password = extensions.crypt('provisoria-9', encrypted_password) from auth.users where id = uid);
  assert (select must_change_password from public.organizers where user_id = uid);
end $$;
select tests.as_user(tests.get('owner')::uuid);

-- validation
select tests.assert_raises($$select public.admin_update_organizer(tests.get('helper')::uuid, 'X', 'outra@ebc.test')$$, 'P0001', 'Já existe uma conta com este e-mail');
select tests.assert_raises($$select public.admin_update_organizer(tests.get('helper')::uuid, 'X', 'sem-arroba')$$, 'P0001', 'E-mail inválido');
select tests.assert_raises($$select public.admin_update_organizer(tests.get('helper')::uuid, '  ', 'nova@ebc.test')$$, 'P0001', 'Informe o nome');
select tests.assert_raises($$select public.admin_update_organizer(tests.get('helper')::uuid, 'X', 'nova@ebc.test', 'curta')$$, 'P0001', 'A senha precisa ter pelo menos 8 caracteres');
select tests.assert_raises($$select public.admin_update_organizer(gen_random_uuid(), 'X', 'x@ebc.test')$$, 'P0001', 'Organizador não encontrado');
-- the owner edits her own name/e-mail, but her password only through "Minha conta"
select public.admin_update_organizer(tests.get('owner')::uuid, 'Dona', 'owner@ebc.test');
select tests.assert_raises($$select public.admin_update_organizer(tests.get('owner')::uuid, 'Dona', 'owner@ebc.test', 'outra-senha-1')$$, 'P0001');

-- only the owner
select tests.as_user(tests.get('other')::uuid);
select tests.assert_raises($$select public.admin_update_organizer(tests.get('helper')::uuid, 'X', 'nova@ebc.test')$$, '42501');
select tests.as_anon();
select tests.assert_raises($$select public.admin_update_organizer(tests.get('helper')::uuid, 'X', 'nova@ebc.test')$$, '42501');
reset role;
do $$ begin
  assert has_function_privilege('authenticated', 'public.admin_update_organizer(uuid,text,text,text)', 'execute');
  assert not has_function_privilege('anon', 'public.admin_update_organizer(uuid,text,text,text)', 'execute');
end $$;
rollback;
