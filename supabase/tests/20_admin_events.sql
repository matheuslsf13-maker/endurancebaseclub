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

-- Ruling 14: on UPDATE, config = default_race_config(new team_size) || existing.config ||
-- coalesce(payload.config, '{}') -- an absent config key must keep the organizer's
-- customizations, and a later partial config must merge onto that customization instead of
-- resetting it to bare defaults.
do $$ declare rc1 jsonb; rc2 jsonb; rc3 jsonb; begin
  -- customize divergence_threshold_s away from the default (3)
  rc1 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'config', '{"divergence_threshold_s": 5}'::jsonb
  ));
  assert (rc1 -> 'race' -> 'config' ->> 'divergence_threshold_s')::numeric = 5;

  -- save without a config key at all -> the customization must survive
  rc2 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (v2)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb
  ));
  assert (rc2 -> 'race' -> 'config' ->> 'divergence_threshold_s')::numeric = 5,
    'omitting config on UPDATE must keep the existing customization (Ruling 14), got ' ||
    coalesce(rc2 -> 'race' -> 'config' ->> 'divergence_threshold_s', '<null>');

  -- save with a different partial config -> merges onto the existing customization
  rc3 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (v2)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'config', '{"same_crossing_window_s": 45}'::jsonb
  ));
  assert (rc3 -> 'race' -> 'config' ->> 'same_crossing_window_s')::numeric = 45;
  assert (rc3 -> 'race' -> 'config' ->> 'divergence_threshold_s')::numeric = 5,
    'a partial config update must merge onto the existing customization, not replace it (Ruling 14)';
end $$;

select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"fly","label":"?","distance_m":1}]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"run","label":"C","distance_m":1000}]'::jsonb, 'config', '{"age_groups":[{"label":"a","min":20,"max":29},{"label":"b","min":25,"max":34}]}'::jsonb))$$, 'P0001');
-- NULL bypass (Minor finding): an explicit JSON null for a validated config field must be
-- rejected, not silently treated as "unset" (plpgsql `IF NULL` is otherwise false).
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"run","label":"C","distance_m":1000}]'::jsonb, 'config', '{"same_crossing_window_s": null}'::jsonb))$$, 'P0001');

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
-- same leg count/order/team_size still succeeds despite the mark (only structural changes are blocked).
-- Ruling 16: admin_save_race must NEVER take start_at from the payload for an existing wave --
-- resending the existing wave (by id, from tests.set('wave', ...) above) with an explicit
-- "start_at": null must not clear the start recorded earlier by admin_set_wave_start, and must
-- keep updating that same row instead of creating a duplicate.
do $$ declare r2 jsonb; begin
  r2 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (ajustada)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'waves', jsonb_build_array(jsonb_build_object('id', tests.get('wave'), 'name', 'Largada geral', 'position', 0, 'start_at', null))
  ));
  assert r2 -> 'race' ->> 'name' = 'Revezamento (ajustada)';
  assert jsonb_array_length(r2 -> 'waves') = 1, 'resending the same wave id should not duplicate it';
  assert (r2 -> 'waves' -> 0 ->> 'id') = tests.get('wave');
  assert (r2 -> 'waves' -> 0 ->> 'start_at')::timestamptz = '2026-10-11T11:00:00Z'::timestamptz,
    'admin_save_race must never take start_at from the payload (Ruling 16) -- the recorded start ' ||
    'must survive a "start_at": null in the wave payload, got ' || coalesce(r2 -> 'waves' -> 0 ->> 'start_at', '<null>');
end $$;

-- Ruling 12: an ABSENT "waves" key on UPDATE must leave existing waves -- and their start_at --
-- completely untouched. A race-details-only save (e.g. renaming the race) must not wipe a
-- recorded wave start.
do $$ declare r3 jsonb; begin
  r3 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb
  ));
  assert r3 -> 'race' ->> 'name' = 'Revezamento (renomeada)';
  assert jsonb_array_length(r3 -> 'waves') = 1,
    'an absent waves key must leave the existing wave(s) untouched, not reset to a fresh default';
  assert (r3 -> 'waves' -> 0 ->> 'id') = tests.get('wave'),
    'the surviving wave must be the SAME row (same id), not a freshly created default';
  assert (r3 -> 'waves' -> 0 ->> 'start_at')::timestamptz = '2026-10-11T11:00:00Z'::timestamptz,
    'omitting waves must not clear the recorded start_at (Ruling 12), got ' ||
    coalesce(r3 -> 'waves' -> 0 ->> 'start_at', '<null>');
end $$;

-- Ruling 12: an explicit JSON null for "waves" must behave exactly like an absent key.
do $$ declare r4 jsonb; begin
  r4 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada 2)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'waves', null
  ));
  assert jsonb_array_length(r4 -> 'waves') = 1
    and (r4 -> 'waves' -> 0 ->> 'id') = tests.get('wave')
    and (r4 -> 'waves' -> 0 ->> 'start_at')::timestamptz = '2026-10-11T11:00:00Z'::timestamptz,
    'an explicit "waves": null must behave exactly like an absent key (Ruling 12)';
end $$;

-- A present, non-empty waves array still upserts by id and deletes waves missing from it; when
-- it ends with zero waves, a fresh "Largada geral" is created (unlike the absent/null cases above).
do $$ declare r5 jsonb; begin
  r5 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada 2)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'waves', '[]'::jsonb
  ));
  assert jsonb_array_length(r5 -> 'waves') = 1
    and (r5 -> 'waves' -> 0 ->> 'name') = 'Largada geral'
    and (r5 -> 'waves' -> 0 ->> 'start_at') is null,
    'a present empty waves array must delete existing waves and create a fresh default, unlike an absent/null key';
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
