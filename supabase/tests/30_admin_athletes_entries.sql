begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.as_user(tests.get('owner')::uuid);

-- fixtures: one event with two races (individual "Corrida 5K", team "Revezamento").
do $$ declare ev jsonb; ra jsonb; rt jsonb; begin
  ev := public.admin_save_event('{"name":"Copa Interna","date":"2026-11-01","levels":["Elite","Base"]}');
  perform tests.set('ev', ev ->> 'id');

  ra := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Corrida 5K', 'team_size', 1,
        'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race_ind', ra -> 'race' ->> 'id');
  perform tests.set('wave_ind', ra -> 'waves' -> 0 ->> 'id');

  rt := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Revezamento', 'team_size', 2,
        'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race_team', rt -> 'race' ->> 'id');
  perform tests.set('wave_team', rt -> 'waves' -> 0 ->> 'id');
end $$;

-- admin_save_athlete: trims strings, lowercases email; rejects birth dates in the future or before 1900.
do $$ declare a jsonb; begin
  a := public.admin_save_athlete('{"name":"  Carlos Silva  ","sex":"M","email":"  CARLOS@X.COM "}'::jsonb);
  assert a ->> 'name' = 'Carlos Silva', 'name should be trimmed, got ' || (a ->> 'name');
  assert a ->> 'email' = 'carlos@x.com', 'email should be trimmed+lowercased, got ' || (a ->> 'email');
  perform tests.set('carlos', a ->> 'id');
end $$;
select tests.assert_raises($$select public.admin_save_athlete(jsonb_build_object('name','Futuro','sex','M','birth_date',(current_date + 1)::text))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_athlete(jsonb_build_object('name','Antigo','sex','M','birth_date','1899-12-31'))$$, 'P0001');

-- athletes used by the entry tests below.
do $$ declare a jsonb; begin
  a := public.admin_save_athlete('{"name":"Atleta A","sex":"F"}'::jsonb); perform tests.set('ath_a', a ->> 'id');
  a := public.admin_save_athlete('{"name":"Atleta B","sex":"M"}'::jsonb); perform tests.set('ath_b', a ->> 'id');
  a := public.admin_save_athlete('{"name":"Atleta C","sex":"M"}'::jsonb); perform tests.set('ath_c', a ->> 'id');
  a := public.admin_save_athlete('{"name":"Atleta D","sex":"F"}'::jsonb); perform tests.set('ath_d', a ->> 'id');
  a := public.admin_save_athlete('{"name":"Atleta E","sex":"M"}'::jsonb); perform tests.set('ath_e', a ->> 'id');
  a := public.admin_save_athlete('{"name":"Atleta F","sex":"F"}'::jsonb); perform tests.set('ath_f', a ->> 'id');
  a := public.admin_save_athlete('{"name":"Atleta G","sex":"F"}'::jsonb); perform tests.set('ath_g', a ->> 'id');
  a := public.admin_save_athlete('{"name":"Atleta H","sex":"M"}'::jsonb); perform tests.set('ath_h', a ->> 'id');
end $$;

-- admin_save_entry (individual race): bib defaults to the next free number, sequentially;
-- a single-leg race assigns leg 0 to the lone member regardless of payload legs.
do $$ declare e1 jsonb; e2 jsonb; e3 jsonb; begin
  e1 := public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_ind'),
          'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_a')))));
  assert e1 ->> 'bib' = '1', 'expected first auto bib to be 1, got ' || (e1 ->> 'bib');
  assert (e1 -> 'members' -> 0 -> 'legs') = '[0]'::jsonb, 'expected member legs [0], got ' || (e1 -> 'members' -> 0 -> 'legs');
  assert e1 -> 'members' -> 0 ->> 'name' = 'Atleta A';
  assert e1 ->> 'wave_id' = tests.get('wave_ind'), 'entry should default to the race''s first wave';
  perform tests.set('entry_a', e1 ->> 'id');

  e2 := public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_ind'),
          'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_b')))));
  assert e2 ->> 'bib' = '2', 'expected second auto bib to be 2, got ' || (e2 ->> 'bib');

  -- payload legs are ignored for individual races: the lone member always gets every leg.
  e3 := public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_ind'),
          'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_c'), 'legs', jsonb_build_array(5)))));
  assert (e3 -> 'members' -> 0 -> 'legs') = '[0]'::jsonb, 'individual entries should ignore payload legs';
end $$;
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_ind'), 'bib', '1',
  'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_h')))))$$, 'P0001', 'Nº de peito % já está em uso%');

-- wave_id must belong to the race (ath_h is still unentered at this point).
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_ind'), 'wave_id', tests.get('wave_team'),
  'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_h')))))$$, 'P0001');

-- admin_save_entry (team race): every leg 0..N-1 must go to exactly one distinct existing member.
do $$ declare et jsonb; begin
  et := public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_team'), 'team_name', 'Equipe DE', 'level', 'Base',
          'members', jsonb_build_array(
            jsonb_build_object('athlete_id', tests.get('ath_d'), 'legs', jsonb_build_array(0)),
            jsonb_build_object('athlete_id', tests.get('ath_e'), 'legs', jsonb_build_array(1))
          )));
  assert et ->> 'team_name' = 'Equipe DE';
  assert (et -> 'members' -> 0 -> 'legs') = '[0]'::jsonb and (et -> 'members' -> 1 -> 'legs') = '[1]'::jsonb;
  perform tests.set('entry_de', et ->> 'id');
end $$;
-- same leg assigned twice
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_team'), 'team_name', 'X',
  'members', jsonb_build_array(
    jsonb_build_object('athlete_id', tests.get('ath_f'), 'legs', jsonb_build_array(0)),
    jsonb_build_object('athlete_id', tests.get('ath_g'), 'legs', jsonb_build_array(0))
  )))$$, 'P0001');
-- missing team name
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_team'),
  'members', jsonb_build_array(
    jsonb_build_object('athlete_id', tests.get('ath_f'), 'legs', jsonb_build_array(0)),
    jsonb_build_object('athlete_id', tests.get('ath_g'), 'legs', jsonb_build_array(1))
  )))$$, 'P0001');
-- wrong member count
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_team'), 'team_name', 'X',
  'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_f'), 'legs', jsonb_build_array(0)))))$$, 'P0001');
-- athlete already entered in this race (ath_d, from the successful entry above)
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_team'), 'team_name', 'X',
  'members', jsonb_build_array(
    jsonb_build_object('athlete_id', tests.get('ath_d'), 'legs', jsonb_build_array(0)),
    jsonb_build_object('athlete_id', tests.get('ath_g'), 'legs', jsonb_build_array(1))
  )))$$, 'P0001', '%já está inscrito nesta prova%');
-- invalid level
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('race_id', tests.get('race_team'), 'team_name', 'X', 'level', 'Pro',
  'members', jsonb_build_array(
    jsonb_build_object('athlete_id', tests.get('ath_f'), 'legs', jsonb_build_array(0)),
    jsonb_build_object('athlete_id', tests.get('ath_g'), 'legs', jsonb_build_array(1))
  )))$$, 'P0001');

-- race-change lock: once an entry has a non-discarded mark, its race_id cannot change.
reset role;
do $$ begin
  insert into public.marks (id, event_id, ts, entry_id, leg_index, discarded)
    values (gen_random_uuid(), tests.get('ev')::uuid, now(), tests.get('entry_a')::uuid, 0, false);
end $$;
select tests.as_user(tests.get('owner')::uuid);
select tests.assert_raises($$select public.admin_save_entry(jsonb_build_object('id', tests.get('entry_a'), 'race_id', tests.get('race_team'),
  'team_name', 'X', 'members', jsonb_build_array(
    jsonb_build_object('athlete_id', tests.get('ath_a'), 'legs', jsonb_build_array(0)),
    jsonb_build_object('athlete_id', tests.get('ath_h'), 'legs', jsonb_build_array(1))
  )))$$, 'P0001', 'Não é possível trocar a prova%');
-- resaving the same race still works despite the mark (only the race change is blocked).
do $$ declare e jsonb; begin
  e := public.admin_save_entry(jsonb_build_object('id', tests.get('entry_a'), 'race_id', tests.get('race_ind'), 'notes', 'ok',
          'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_a')))));
  assert e ->> 'notes' = 'ok';
end $$;

-- admin_bulk_create_entries: rejected for team races; skips already-entered athletes for individual ones.
select tests.assert_raises($$select public.admin_bulk_create_entries(tests.get('race_team')::uuid, array[tests.get('ath_h')::uuid])$$, 'P0001');
do $$ declare created jsonb; begin
  created := public.admin_bulk_create_entries(tests.get('race_ind')::uuid,
    array[tests.get('ath_a')::uuid, tests.get('ath_g')::uuid, tests.get('ath_h')::uuid]);
  assert jsonb_array_length(created) = 2, 'expected 2 entries (ath_a already entered), got ' || jsonb_array_length(created);
  assert (created -> 0 ->> 'bib') <> (created -> 1 ->> 'bib');
end $$;

-- admin_update_entry_status / admin_delete_entry
do $$ declare e jsonb; begin
  e := public.admin_update_entry_status(tests.get('entry_de')::uuid, 'dnf', 5000, 'caiu na natação');
  assert e ->> 'status' = 'dnf' and (e ->> 'penalty_ms')::int = 5000 and e ->> 'notes' = 'caiu na natação';
end $$;
select tests.assert_raises($$select public.admin_update_entry_status(tests.get('entry_de')::uuid, 'invalido', 0, '')$$, 'P0001');
select tests.assert_raises($$select public.admin_update_entry_status(tests.get('entry_de')::uuid, 'ok', -1, '')$$, 'P0001');

reset role;
do $$ declare v_mark uuid := gen_random_uuid(); begin
  insert into public.marks (id, event_id, ts, entry_id, leg_index, discarded)
    values (v_mark, tests.get('ev')::uuid, now(), tests.get('entry_de')::uuid, 0, false);
  perform tests.set('mark_de', v_mark::text);
end $$;
select tests.as_user(tests.get('owner')::uuid);
do $$ begin perform public.admin_delete_entry(tests.get('entry_de')::uuid); end $$;
reset role;
do $$ begin
  assert (select entry_id from public.marks where id = tests.get('mark_de')::uuid) is null,
    'deleting the entry should unassign its marks via FK';
end $$;
select tests.as_user(tests.get('owner')::uuid);

-- admin_list_athletes / admin_athlete_profile: participations, wins and podiums come from results;
-- a second entry (a different race) gives Atleta A two results to check ordering and counting.
do $$ declare rex jsonb; ee jsonb; begin
  rex := public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'Prova Extra', 'team_size', 1,
          'legs', '[{"modality":"run","label":"Corrida","distance_m":3000}]'::jsonb));
  ee := public.admin_save_entry(jsonb_build_object('race_id', rex -> 'race' ->> 'id',
          'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_a')))));
  perform tests.set('race_extra', rex -> 'race' ->> 'id');
  perform tests.set('entry_a_extra', ee ->> 'id');
end $$;
reset role;
do $$ begin
  insert into public.results (race_id, entry_id, event_id, athlete_ids, status, final_ms, overall_pos, data, finalized_at)
  values (tests.get('race_ind')::uuid, tests.get('entry_a')::uuid, tests.get('ev')::uuid, array[tests.get('ath_a')::uuid],
    'finished', 1200000, 1,
    jsonb_build_object('event', jsonb_build_object('date', '2026-11-01'),
      'podiums', jsonb_build_array(jsonb_build_object('ranking_id','geral','ranking_name','Geral','group_label','Geral','podium_pos',1))),
    now());
  insert into public.results (race_id, entry_id, event_id, athlete_ids, status, final_ms, overall_pos, data, finalized_at)
  values (tests.get('race_extra')::uuid, tests.get('entry_a_extra')::uuid, tests.get('ev')::uuid, array[tests.get('ath_a')::uuid],
    'finished', 900000, 5,
    jsonb_build_object('event', jsonb_build_object('date', '2025-05-01'), 'podiums', '[]'::jsonb),
    now());
end $$;
select tests.as_user(tests.get('owner')::uuid);
do $$ declare list jsonb; arow jsonb; prof jsonb; begin
  list := public.admin_list_athletes();
  select x into arow from jsonb_array_elements(list) x where x ->> 'id' = tests.get('ath_a');
  assert (arow ->> 'participations')::int = 2, 'expected 2 participations, got ' || (arow ->> 'participations');
  assert (arow ->> 'wins')::int = 1, 'expected 1 win, got ' || (arow ->> 'wins');
  assert (arow ->> 'podiums')::int = 1, 'expected 1 podium, got ' || (arow ->> 'podiums');

  prof := public.admin_athlete_profile(tests.get('ath_a')::uuid);
  assert prof -> 'athlete' ->> 'name' = 'Atleta A';
  assert jsonb_array_length(prof -> 'results') = 2;
  assert (prof -> 'results' -> 0 -> 'data' -> 'event' ->> 'date') = '2026-11-01',
    'results should be ordered by event date desc, got ' || (prof -> 'results' -> 0 -> 'data' -> 'event' ->> 'date');
end $$;
select tests.assert_raises($$select public.admin_athlete_profile(gen_random_uuid())$$, 'P0001');

-- admin_import_athletes: soft-validates name/sex per row (continuing past bad rows), dedups by
-- email or by name+birth_date, and creates an entry when the row's race matches an individual race.
do $$ declare res jsonb; begin
  res := public.admin_import_athletes(tests.get('ev')::uuid, jsonb_build_array(
    jsonb_build_object('name','Ana Souza','sex','F','birth_date','1990-06-15','race_name','corrida 5k'),
    jsonb_build_object('name','','sex','F'),
    jsonb_build_object('name','Beto','sex','M','race_name','Revezamento'),
    jsonb_build_object('name','ana souza','sex','F','birth_date','1990-06-15')
  ));
  assert (res ->> 'inserted')::int = 2, 'expected inserted=2, got ' || (res ->> 'inserted');
  assert (res ->> 'updated')::int = 1, 'expected updated=1, got ' || (res ->> 'updated');
  assert (res ->> 'entries_created')::int = 1, 'expected entries_created=1, got ' || (res ->> 'entries_created');
  assert jsonb_array_length(res -> 'errors') = 2, 'expected 2 error rows, got ' || jsonb_array_length(res -> 'errors');
  assert exists (select 1 from jsonb_array_elements(res -> 'errors') e where (e ->> 'row')::int = 2);
  assert exists (select 1 from jsonb_array_elements(res -> 'errors') e where (e ->> 'row')::int = 3);
end $$;
do $$ declare list jsonb; arow jsonb; begin
  list := public.admin_list_athletes();
  select x into arow from jsonb_array_elements(list) x where x ->> 'name' = 'ana souza';
  perform tests.set('ana', arow ->> 'id');
end $$;

-- admin_delete_athlete: blocked while the athlete has entries; succeeds otherwise.
select tests.assert_raises($$select public.admin_delete_athlete(tests.get('ana')::uuid)$$, 'P0001', 'Atleta tem inscrições%');
do $$ declare a jsonb; begin
  a := public.admin_save_athlete('{"name":"Descartável","sex":"F"}'::jsonb);
  perform public.admin_delete_athlete((a ->> 'id')::uuid);
  assert not exists (select 1 from jsonb_array_elements(public.admin_list_athletes()) x where x ->> 'name' = 'Descartável');
end $$;

reset role;
rollback;
