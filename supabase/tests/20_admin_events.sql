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

-- C-I3: a wave that already started, or that still has entries, is never deleted by a save that
-- leaves it out -- the recorded start (and every entry's leg-1 time) would silently vanish. The
-- refusal names the wave.
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object(
  'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada 2)', 'team_size', 2,
  'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'waves', '[]'::jsonb
))$$, 'P0001', 'Não é possível remover a onda "Largada geral" porque ela já largou');
do $$ declare r6 jsonb; begin
  r6 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada 2)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'waves', jsonb_build_array(
      jsonb_build_object('id', tests.get('wave'), 'name', 'Largada geral', 'position', 0),
      jsonb_build_object('name', 'Onda 2', 'position', 1))
  ));
  assert jsonb_array_length(r6 -> 'waves') = 2;
  perform tests.set('wave2', r6 -> 'waves' -> 1 ->> 'id');
end $$;
reset role;
update public.entries set wave_id = tests.get('wave2')::uuid where race_id = tests.get('race')::uuid;
select tests.as_user(tests.get('owner')::uuid);
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object(
  'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada 2)', 'team_size', 2,
  'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'waves', jsonb_build_array(jsonb_build_object('id', tests.get('wave'), 'name', 'Largada geral', 'position', 0))
))$$, 'P0001', 'Não é possível remover a onda "Onda 2" porque ela tem 1 inscrição');
-- once its entry moves back to the first wave, "Onda 2" (no start, no entries) can be removed.
reset role;
update public.entries set wave_id = null where race_id = tests.get('race')::uuid;
select tests.as_user(tests.get('owner')::uuid);
do $$ declare r7 jsonb; begin
  r7 := public.admin_save_race(jsonb_build_object(
    'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada 2)', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'waves', jsonb_build_array(jsonb_build_object('id', tests.get('wave'), 'name', 'Largada geral', 'position', 0))
  ));
  assert jsonb_array_length(r7 -> 'waves') = 1 and (r7 -> 'waves' -> 0 ->> 'id') = tests.get('wave'),
    'a wave with no start and no entries is still removed by a save that leaves it out';
  -- clear the recorded start so the next block can exercise the "zero waves" path.
  perform public.admin_set_wave_start(tests.get('wave')::uuid, null);
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

-- A-M8: the wave upsert never re-parents another race's wave (with its start_at), and an UPDATE
-- never moves a race to another event.
do $$ declare other jsonb; begin
  other := public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'Outra prova',
    'legs', '[{"modality":"run","label":"Corrida","distance_m":3000}]'::jsonb));
  perform tests.set('race_other', other -> 'race' ->> 'id');
  perform tests.set('wave_other', other -> 'waves' -> 0 ->> 'id');
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object(
  'id', tests.get('race'), 'event_id', tests.get('ev'), 'name', 'Revezamento (renomeada 2)', 'team_size', 2,
  'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'waves', jsonb_build_array(jsonb_build_object('id', tests.get('wave_other'), 'name', 'Roubada', 'position', 0))
))$$, 'P0001', 'Onda inválida');
do $$ declare agg jsonb; begin
  agg := public.admin_get_event(tests.get('ev')::uuid);
  assert exists (
    select 1 from jsonb_array_elements(agg -> 'waves') w
    where w ->> 'id' = tests.get('wave_other') and w ->> 'race_id' = tests.get('race_other') and w ->> 'name' = 'Largada geral'
  ), 'another race''s wave must stay where it was, untouched';
end $$;
do $$ declare ev_b jsonb; begin
  ev_b := public.admin_save_event('{"name":"Outro evento","date":"2026-12-01"}');
  perform tests.set('ev_b', ev_b ->> 'id');
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object(
  'id', tests.get('race_other'), 'event_id', tests.get('ev_b'), 'name', 'Outra prova',
  'legs', '[{"modality":"run","label":"Corrida","distance_m":3000}]'::jsonb
))$$, 'P0001', 'Não é possível mover a prova para outro evento');

-- A-I1: a duplicated event has no timekeepers, so a copied race must not keep the source event's
-- reference timekeeper (not even a stale one left behind after switching back to the median) --
-- otherwise every later save of the copy, which always sends the full config (Ruling 14), fails.
do $$ declare ev jsonb; reg jsonb; dup uuid; agg jsonb; rc jsonb; rr jsonb; begin
  ev := public.admin_save_event('{"name":"Copa Referência","date":"2026-10-18"}');
  reg := public.tk_register(ev ->> 'tk_token', 'Ana', 'iPhone');
  perform tests.set('tk_ref', reg ->> 'timekeeper_id');
  perform public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'A Referência', 'position', 0,
    'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'config', jsonb_build_object('time_source', 'reference', 'reference_timekeeper_id', reg ->> 'timekeeper_id')));
  perform public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'B Mediana', 'position', 1,
    'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'config', jsonb_build_object('time_source', 'median', 'reference_timekeeper_id', reg ->> 'timekeeper_id')));

  dup := public.admin_duplicate_event((ev ->> 'id')::uuid, 'Copa Referência 2027', '2027-10-17');
  perform tests.set('ev_dup', dup::text);
  agg := public.admin_get_event(dup);
  assert jsonb_array_length(agg -> 'races') = 2;
  for rr in select el from jsonb_array_elements(agg -> 'races') as t(el) loop
    rc := rr -> 'config';
    assert (rc -> 'reference_timekeeper_id') = 'null'::jsonb,
      'the copy must not keep the source event''s reference timekeeper, got ' || coalesce(rc ->> 'reference_timekeeper_id', '<null>');
    assert rc ->> 'time_source' = 'median', 'a copied "reference" race falls back to the median, got ' || (rc ->> 'time_source');
    -- the copied race saves again exactly as the race editor sends it (full config).
    perform public.admin_save_race(jsonb_build_object('id', rr ->> 'id', 'event_id', dup, 'name', rr ->> 'name',
      'team_size', (rr ->> 'team_size')::int, 'legs', rr -> 'legs', 'config', rc));
  end loop;
end $$;
-- the reference timekeeper is validated only when the time source actually uses it.
do $$ declare r jsonb; begin
  r := public.admin_save_race(jsonb_build_object('event_id', tests.get('ev_dup'), 'name', 'C Mediana',
    'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
    'config', jsonb_build_object('time_source', 'median', 'reference_timekeeper_id', tests.get('tk_ref'))));
  assert r -> 'race' -> 'config' ->> 'time_source' = 'median';
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev_dup'), 'name', 'D Referência',
  'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'config', jsonb_build_object('time_source', 'reference', 'reference_timekeeper_id', tests.get('tk_ref'))))$$,
  'P0001', 'Cronometrista de referência inválido');

-- B1-I2: entry_members.legs are materialized when an entry is created, so a race's format cannot
-- silently drift away from them. Individual race: a leg-count change rewrites every entry's lone
-- member to cover legs 0..N-1. Team size, and a team race's leg count, cannot change with entries.
do $$ declare ev jsonb; ri jsonb; a1 jsonb; a2 jsonb; agg jsonb; begin
  ev := public.admin_save_event('{"name":"Copa Formato","date":"2026-10-25"}');
  perform tests.set('ev_fmt', ev ->> 'id');
  ri := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Corrida 5 km', 'team_size', 1,
        'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race_fmt', ri -> 'race' ->> 'id');
  a1 := public.admin_save_athlete('{"name":"Formato Um","sex":"F"}'::jsonb);
  a2 := public.admin_save_athlete('{"name":"Formato Dois","sex":"M"}'::jsonb);
  perform tests.set('ath_fmt_1', a1 ->> 'id');
  perform tests.set('ath_fmt_2', a2 ->> 'id');
  perform public.admin_bulk_create_entries((ri -> 'race' ->> 'id')::uuid, array[(a1 ->> 'id')::uuid, (a2 ->> 'id')::uuid]);

  perform public.admin_save_race(jsonb_build_object('id', tests.get('race_fmt'), 'event_id', ev ->> 'id', 'name', 'Duathlon', 'team_size', 1,
    'legs', '[{"modality":"run","label":"Corrida 1","distance_m":2500},{"modality":"bike","label":"Ciclismo","distance_m":10000},{"modality":"run","label":"Corrida 2","distance_m":2500}]'::jsonb));
  agg := public.admin_get_event((ev ->> 'id')::uuid);
  assert jsonb_array_length(agg -> 'entries') = 2;
  assert not exists (
    select 1 from jsonb_array_elements(agg -> 'entries') en, jsonb_array_elements(en -> 'members') m
    where m -> 'legs' <> '[0, 1, 2]'::jsonb
  ), 'an individual race going from 1 to 3 legs must give every lone member legs [0,1,2], got ' || (agg -> 'entries')::text;

  perform public.admin_save_race(jsonb_build_object('id', tests.get('race_fmt'), 'event_id', ev ->> 'id', 'name', 'Corrida', 'team_size', 1,
    'legs', '[{"modality":"run","label":"Corrida","distance_m":5000},{"modality":"run","label":"Volta extra","distance_m":1000}]'::jsonb));
  agg := public.admin_get_event((ev ->> 'id')::uuid);
  assert not exists (
    select 1 from jsonb_array_elements(agg -> 'entries') en, jsonb_array_elements(en -> 'members') m
    where m -> 'legs' <> '[0, 1]'::jsonb
  ), 'shrinking to 2 legs must give every lone member legs [0,1], got ' || (agg -> 'entries')::text;
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('id', tests.get('race_fmt'), 'event_id', tests.get('ev_fmt'),
  'name', 'Corrida', 'team_size', 2,
  'legs', '[{"modality":"run","label":"Corrida","distance_m":5000},{"modality":"run","label":"Volta extra","distance_m":1000}]'::jsonb))$$,
  'P0001', 'Não é possível alterar o tamanho da equipe com inscrições');
do $$ declare rt jsonb; a3 jsonb; begin
  rt := public.admin_save_race(jsonb_build_object('event_id', tests.get('ev_fmt'), 'name', 'Dupla', 'team_size', 2,
        'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race_fmt_team', rt -> 'race' ->> 'id');
  a3 := public.admin_save_athlete('{"name":"Formato Três","sex":"F"}'::jsonb);
  perform public.admin_save_entry(jsonb_build_object('race_id', rt -> 'race' ->> 'id', 'team_name', 'Dupla F',
    'members', jsonb_build_array(
      jsonb_build_object('athlete_id', tests.get('ath_fmt_1'), 'legs', jsonb_build_array(0)),
      jsonb_build_object('athlete_id', a3 ->> 'id', 'legs', jsonb_build_array(1)))));
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('id', tests.get('race_fmt_team'), 'event_id', tests.get('ev_fmt'),
  'name', 'Dupla', 'team_size', 2,
  'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"bike","label":"Ciclismo","distance_m":10000},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb))$$,
  'P0001', 'Não é possível alterar o número de pernas de uma prova por equipes com inscrições');
-- the same leg count (only labels/distances edited) still saves.
do $$ declare r jsonb; begin
  r := public.admin_save_race(jsonb_build_object('id', tests.get('race_fmt_team'), 'event_id', tests.get('ev_fmt'),
    'name', 'Dupla', 'team_size', 2,
    'legs', '[{"modality":"swim","label":"Natação 1 km","distance_m":1000},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  assert r -> 'race' -> 'legs' -> 0 ->> 'label' = 'Natação 1 km';
end $$;

-- A-M5: a long event name never makes creation fail on the public address the organizer never
-- typed: the name part of the generated slug is capped, the date is always kept, and the -N
-- suffix never pushes it past 80 characters.
do $$ declare v_long text := repeat('Desafio Internacional ', 6); e1 jsonb; e2 jsonb; e3 jsonb; begin
  e1 := public.admin_save_event(jsonb_build_object('name', v_long, 'date', '2026-10-11'));
  assert length(e1 ->> 'public_slug') <= 80 and (e1 ->> 'public_slug') ~ '^[a-z0-9-]{3,80}$',
    'generated slug must be valid, got ' || coalesce(e1 ->> 'public_slug', '<null>');
  assert (e1 ->> 'public_slug') like 'desafio-internacional-%-2026-10-11' and (e1 ->> 'public_slug') not like '%--%',
    'the capped name keeps the date and has no doubled hyphen, got ' || (e1 ->> 'public_slug');
  e2 := public.admin_save_event(jsonb_build_object('name', v_long, 'date', '2026-10-11'));
  assert (e2 ->> 'public_slug') like '%-2026-10-11-2' and length(e2 ->> 'public_slug') <= 80,
    'the collision suffix keeps the slug valid, got ' || (e2 ->> 'public_slug');
  -- making public an event whose slug was cleared regenerates it the same way.
  e3 := public.admin_save_event(jsonb_build_object('id', e1 ->> 'id', 'public_slug', '', 'is_public', true));
  assert (e3 ->> 'public_slug') ~ '^[a-z0-9-]{3,80}$', 'regenerated slug must be valid, got ' || coalesce(e3 ->> 'public_slug', '<null>');
  -- an 80-character slug already taken: the next candidate is trimmed to fit its suffix.
  e3 := public.admin_save_event('{"name":"Slug longo","date":"2026-10-11"}'::jsonb);
  perform public.admin_save_event(jsonb_build_object('id', e3 ->> 'id', 'public_slug', repeat('a', 80)));
end $$;
reset role;
do $$ declare v text; begin
  v := public.next_unique_public_slug(repeat('a', 80));
  assert v = repeat('a', 78) || '-2', 'next_unique_public_slug must stay within 80 characters, got ' || v;
end $$;
select tests.as_user(tests.get('owner')::uuid);

-- C-Minor-2: an empty or malformed event date is a pt-BR validation error, not a raw cast error.
select tests.assert_raises($$select public.admin_save_event('{"name":"Sem data","date":""}'::jsonb)$$, 'P0001', 'Informe a data do evento');
select tests.assert_raises($$select public.admin_save_event('{"name":"Data ruim","date":"31/02/2026"}'::jsonb)$$, 'P0001', 'Informe a data do evento');
select tests.assert_raises($$select public.admin_save_event(jsonb_build_object('id', tests.get('ev'), 'date', ''))$$, 'P0001', 'Informe a data do evento');

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

-- 0008: a podium with no division ("dims": []) is the overall podium (spec §9) and must save;
-- a missing, non-array, unknown or repeated dimension is still refused.
do $$ declare r jsonb; begin
  r := public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'Corrida geral', 'team_size', 1,
        'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
        'config', jsonb_build_object('rankings', '[{"id":"geral","name":"Geral","dims":[],"size":3}]'::jsonb)));
  assert (r -> 'race' -> 'config' -> 'rankings') = '[{"id":"geral","name":"Geral","dims":[],"size":3}]'::jsonb,
    'the overall podium must be stored as sent, got ' || (r -> 'race' -> 'config' ->> 'rankings');
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'team_size', 1,
  'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'config', jsonb_build_object('rankings', '[{"id":"g","name":"G","size":3}]'::jsonb)))$$, 'P0001', 'Dimensões de ranking inválidas');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'team_size', 1,
  'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'config', jsonb_build_object('rankings', '[{"id":"g","name":"G","dims":"sex","size":3}]'::jsonb)))$$, 'P0001', 'Dimensões de ranking inválidas');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'team_size', 1,
  'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'config', jsonb_build_object('rankings', '[{"id":"g","name":"G","dims":["cor"],"size":3}]'::jsonb)))$$, 'P0001', 'Dimensão de ranking inválida');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'team_size', 1,
  'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb,
  'config', jsonb_build_object('rankings', '[{"id":"g","name":"G","dims":["sex","sex"],"size":3}]'::jsonb)))$$, 'P0001', 'Dimensões de ranking repetidas');
reset role;
rollback;
