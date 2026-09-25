begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.set('stranger', public.internal_create_auth_user('x@ebc.test','senha-forte-1')::text);
-- non-organizer is rejected
select tests.as_user(tests.get('stranger')::uuid);
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
reset role;
-- owner flow
select tests.as_user(tests.get('owner')::uuid);
do $$ declare ev jsonb; ev2 jsonb; r jsonb; agg jsonb; agg2 jsonb; dup uuid; wstart jsonb; begin
  assert (public.admin_me() ->> 'role') = 'owner';

  -- admin_password_changed clears the flag
  assert (public.admin_me() ->> 'must_change_password') = 'true';
  perform public.admin_password_changed();
  assert (public.admin_me() ->> 'must_change_password') = 'false';

  ev := public.admin_save_event('{"name":"Desafio EBC","date":"2026-10-11","levels":["Elite","Base"]}');
  perform tests.set('ev', ev ->> 'id');
  assert ev ->> 'public_slug' = 'desafio-ebc-2026-10-11' and length(ev ->> 'tk_token') = 24;

  -- slug collision produces -2
  ev2 := public.admin_save_event('{"name":"Desafio EBC","date":"2026-10-11"}');
  assert ev2 ->> 'public_slug' = 'desafio-ebc-2026-10-11-2',
    'expected slug collision suffix -2, got ' || coalesce(ev2 ->> 'public_slug', '<null>');

  r := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Revezamento', 'team_size', 2,
        'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race', r -> 'race' ->> 'id');
  perform tests.set('wave', r -> 'waves' -> 0 ->> 'id');
  assert jsonb_array_length(r -> 'waves') = 1 and (r -> 'waves' -> 0 ->> 'name') = 'Largada geral';
  assert (r -> 'race' -> 'config' ->> 'divergence_threshold_s')::numeric = 3;
  agg := public.admin_get_event((ev ->> 'id')::uuid);
  assert jsonb_array_length(agg -> 'races') = 1 and agg ? 'server_now' and agg ? 'marks';
  assert exists (
    select 1 from jsonb_array_elements(public.admin_list_events()) x
    where x ->> 'id' = ev ->> 'id' and (x ->> 'races_count')::int = 1 and (x ->> 'entries_count')::int = 0
  ), 'admin_list_events should annotate races_count/entries_count';
  -- (verified via the RPC's own return value, not a direct table read: this whole block runs as
  -- role 'authenticated' per tests.as_user above, and RLS-with-no-policies -- proven by
  -- 10_schema.sql's own anon/count=0 assertion -- would hide the row from a bare `select ... from
  -- public.waves`, independently of whether admin_set_wave_start itself worked correctly.)
  wstart := public.admin_set_wave_start((r -> 'waves' -> 0 ->> 'id')::uuid, '2026-10-11T11:00:00Z');
  assert (wstart ->> 'start_at')::timestamptz = '2026-10-11T11:00:00Z'::timestamptz;
  dup := public.admin_duplicate_event((ev ->> 'id')::uuid, 'Desafio EBC 2027', '2027-10-10');
  agg2 := public.admin_get_event(dup);
  assert jsonb_array_length(agg2 -> 'races') = 1;
  assert jsonb_array_length(agg2 -> 'waves') = 1 and (agg2 -> 'waves' -> 0 ->> 'start_at') is null;
  assert public.admin_rotate_tk_token((ev ->> 'id')::uuid) <> ev ->> 'tk_token';
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"fly","label":"?","distance_m":1}]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"run","label":"C","distance_m":1000}]'::jsonb, 'config', '{"age_groups":[{"label":"a","min":20,"max":29},{"label":"b","min":25,"max":34}]}'::jsonb))$$, 'P0001');

-- extra: changing the number of legs of a race after a non-discarded mark exists on one of its
-- entries -> P0001 ("Não é possível alterar pernas ou tamanho da equipe depois que há marcações").
-- Fixture rows are inserted directly (as the postgres superuser, bypassing RLS) since
-- admin_save_entry / tk_sync belong to later tasks.
reset role;
do $$ declare v_entry uuid := gen_random_uuid(); begin
  insert into public.entries (id, event_id, race_id, bib) values (v_entry, tests.get('ev')::uuid, tests.get('race')::uuid, '1');
  insert into public.marks (id, event_id, ts, entry_id, leg_index, discarded)
    values (gen_random_uuid(), tests.get('ev')::uuid, now(), v_entry, 0, false);
end $$;
select tests.as_user(tests.get('owner')::uuid);
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object(
  'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento', 'team_size', 2,
  'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000},{"modality":"bike","label":"Ciclismo","distance_m":20000}]'::jsonb
))$$, 'P0001');
-- same leg count/order/team_size still succeeds despite the mark (only structural changes are blocked);
-- resending the existing wave (by id, from tests.set('wave', ...) above) keeps updating that same
-- row instead of creating a duplicate.
do $$ declare r2 jsonb; begin
  r2 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (ajustada)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'waves', jsonb_build_array(jsonb_build_object('id', tests.get('wave'), 'name', 'Largada geral', 'position', 0, 'start_at', '2026-10-11T11:00:00Z'))
  ));
  assert r2 -> 'race' ->> 'name' = 'Revezamento (ajustada)';
  assert jsonb_array_length(r2 -> 'waves') = 1, 'resending the same wave id should not duplicate it';
  assert (r2 -> 'waves' -> 0 ->> 'id') = tests.get('wave');
  assert (r2 -> 'waves' -> 0 ->> 'start_at')::timestamptz = '2026-10-11T11:00:00Z'::timestamptz;
end $$;
-- omitting waves entirely resets the race to a single fresh "Largada geral" wave (spec: "if the
-- payload has no waves, ensure one Largada geral exists") -- pinning this documented behavior.
do $$ declare r3 jsonb; begin
  r3 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (ajustada)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb
  ));
  assert jsonb_array_length(r3 -> 'waves') = 1 and (r3 -> 'waves' -> 0 ->> 'start_at') is null,
    'omitting waves resets to a single default wave';
end $$;

-- organizers
do $$ declare o jsonb; begin
  o := public.admin_create_organizer('Ajudante@EBC.test', 'senha-forte-2', 'Ajudante');
  assert o ->> 'role' = 'admin' and o ->> 'email' = 'ajudante@ebc.test';
  assert jsonb_array_length(public.admin_list_organizers()) = 2;
  perform tests.set('helper', o ->> 'user_id');
end $$;
-- extra: admin_create_organizer called by an admin (not owner) -> 42501
select tests.as_user(tests.get('helper')::uuid);
select tests.assert_raises($$select public.admin_create_organizer('outra@ebc.test','senha-forte-3','Outra')$$, '42501');
select tests.as_user(tests.get('owner')::uuid);
select tests.assert_raises($$select public.admin_delete_organizer(tests.get('owner')::uuid)$$, 'P0001');
-- bonus: unknown event id
select tests.assert_raises($$select public.admin_get_event(gen_random_uuid())$$, 'P0001');
reset role;
rollback;
