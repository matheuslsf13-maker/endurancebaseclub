begin;
-- owner bootstrap
select tests.set('owner', public.bootstrap_owner('Owner@EBC.test', 'senha-forte-1', 'Owner')::text);
do $$ declare u auth.users; o public.organizers; begin
  select * into u from auth.users where id = tests.get('owner')::uuid;
  assert u.email = 'owner@ebc.test', 'email lowercased';
  assert u.encrypted_password = extensions.crypt('senha-forte-1', u.encrypted_password), 'password hash verifies';
  assert u.email_confirmed_at is not null and u.aud = 'authenticated' and u.role = 'authenticated';
  assert u.confirmation_token = '' and u.recovery_token = '' and u.email_change = '' and u.reauthentication_token = '';
  assert (select count(*) from auth.identities where user_id = u.id and provider = 'email' and provider_id = u.id::text) = 1;
  select * into o from public.organizers where user_id = u.id;
  assert o.role = 'owner' and o.must_change_password and o.name = 'Owner';
end $$;
select tests.assert_raises($$select public.bootstrap_owner('owner@ebc.test','outra-senha-1','X')$$, 'P0001', 'Já existe%');
select tests.assert_raises($$select public.internal_create_auth_user('curta@ebc.test','1234567')$$, 'P0001', '%8 caracteres%');
select tests.assert_raises($$select public.internal_create_auth_user('sem-arroba','12345678')$$, 'P0001', 'E-mail inválido');
-- utilities
do $$ begin
  assert length(public.random_token(24)) = 24 and public.random_token(24) ~ '^[A-Za-z0-9]{24}$';
  assert public.slugify('Triathlon Águas Claras 2026!') = 'triathlon-aguas-claras-2026';
  assert public.server_time() between (extract(epoch from now()) * 1000)::bigint - 60000 and (extract(epoch from now()) * 1000)::bigint + 60000;
  assert (public.default_race_config(1) -> 'rankings' -> 1 ->> 'id') = 'faixa';
  assert jsonb_array_length(public.default_race_config(2) -> 'age_groups') = 0;
end $$;
-- events: token default, version bump through child tables, updated_at
insert into public.events (id, name, date) values ('00000000-0000-0000-0000-0000000000e1', 'Evento', '2026-10-11');
do $$ declare v bigint; begin
  assert (select length(tk_token) from public.events where id = '00000000-0000-0000-0000-0000000000e1') = 24;
  select version into v from public.events where id = '00000000-0000-0000-0000-0000000000e1';
  insert into public.races (id, event_id, name, legs, config) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'Corrida', '[{"modality":"run","label":"Corrida","distance_m":5000}]', public.default_race_config(1));
  assert (select version from public.events where id = '00000000-0000-0000-0000-0000000000e1') > v, 'race insert bumps version';
end $$;
-- constraints
insert into public.entries (event_id, race_id, bib) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '10');
select tests.assert_raises($$insert into public.entries (event_id, race_id, bib) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '10')$$, '23505');
select tests.assert_raises($$insert into public.marks (id, event_id, ts, entry_id) select gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', now(), id from public.entries limit 1$$, '23514');
-- RLS denies direct reads for anon (grants are revoked later in 0006; here RLS alone returns no rows)
select tests.as_anon();
do $$ begin assert (select count(*) from public.events) = 0; end $$;
reset role;
rollback;
