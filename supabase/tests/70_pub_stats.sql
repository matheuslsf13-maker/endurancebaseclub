begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.as_user(tests.get('owner')::uuid);

-- Fixtures (spec §4.1/§7): public event P (2026-05-10) with a solo race R1 and a relay R2; an
-- older public event O (2025-03-01) with a solo race R3; a private event Q (2026-06-01) with a
-- solo race R4. Athletes: Ana (public, with e-mail/phone/birth date/notes), Beto (public), Caio
-- and Duda (private). Results: R1 Ana (in) and Caio alone (out: no public athlete); R2 Beto+Duda
-- (in: one public member); R3 Beto (in, older event); R4 Ana (out: private event).
do $$ declare
  p jsonb; o jsonb; q jsonb; r1 uuid; r2 uuid; r3 uuid; r4 uuid;
  ana uuid; beto uuid; caio uuid; duda uuid;
  e_ana1 jsonb; e_caio1 jsonb; e_team2 jsonb; e_beto3 jsonb; e_ana4 jsonb;
  dp jsonb; dop jsonb; dq jsonb;
begin
  p := public.admin_save_event('{"name":"Copa Pública","date":"2026-05-10","is_public":true}');
  o := public.admin_save_event('{"name":"Copa Antiga","date":"2025-03-01","is_public":true}');
  q := public.admin_save_event('{"name":"Copa Privada","date":"2026-06-01","is_public":false}');
  perform tests.set('ev_p', p ->> 'id'); perform tests.set('ev_o', o ->> 'id'); perform tests.set('ev_q', q ->> 'id');
  r1 := (public.admin_save_race(jsonb_build_object('event_id', p ->> 'id', 'name', 'Corrida', 'team_size', 1,
          'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;
  r2 := (public.admin_save_race(jsonb_build_object('event_id', p ->> 'id', 'name', 'Revezamento', 'team_size', 2,
          'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;
  r3 := (public.admin_save_race(jsonb_build_object('event_id', o ->> 'id', 'name', 'Corrida', 'team_size', 1,
          'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;
  r4 := (public.admin_save_race(jsonb_build_object('event_id', q ->> 'id', 'name', 'Corrida', 'team_size', 1,
          'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;

  ana := (public.admin_save_athlete('{"name":"Ana","sex":"F","email":"ana@x.com","phone":"27999990000","birth_date":"1990-06-15","notes":"segredo-da-org"}') ->> 'id')::uuid;
  beto := (public.admin_save_athlete('{"name":"Beto","sex":"M","city":"Vitória","team_club":"Tubarões"}') ->> 'id')::uuid;
  caio := (public.admin_save_athlete('{"name":"Caio","sex":"M","public_profile":false}') ->> 'id')::uuid;
  duda := (public.admin_save_athlete('{"name":"Duda","sex":"F","public_profile":false}') ->> 'id')::uuid;
  perform tests.set('ana', ana::text); perform tests.set('beto', beto::text);
  perform tests.set('caio', caio::text); perform tests.set('duda', duda::text);

  e_ana1 := public.admin_save_entry(jsonb_build_object('race_id', r1, 'members', jsonb_build_array(jsonb_build_object('athlete_id', ana))));
  e_caio1 := public.admin_save_entry(jsonb_build_object('race_id', r1, 'members', jsonb_build_array(jsonb_build_object('athlete_id', caio))));
  e_team2 := public.admin_save_entry(jsonb_build_object('race_id', r2, 'team_name', 'Mista', 'members', jsonb_build_array(
               jsonb_build_object('athlete_id', beto, 'legs', jsonb_build_array(0)),
               jsonb_build_object('athlete_id', duda, 'legs', jsonb_build_array(1)))));
  e_beto3 := public.admin_save_entry(jsonb_build_object('race_id', r3, 'members', jsonb_build_array(jsonb_build_object('athlete_id', beto))));
  e_ana4 := public.admin_save_entry(jsonb_build_object('race_id', r4, 'members', jsonb_build_array(jsonb_build_object('athlete_id', ana))));
  perform tests.set('e_ana1', e_ana1 ->> 'id'); perform tests.set('e_team2', e_team2 ->> 'id'); perform tests.set('e_beto3', e_beto3 ->> 'id');

  -- `data` carries the event date that pub_stats orders by (a real snapshot carries much more).
  dp := jsonb_build_object('event', jsonb_build_object('id', p ->> 'id', 'name', 'Copa Pública', 'date', '2026-05-10'));
  dop := jsonb_build_object('event', jsonb_build_object('id', o ->> 'id', 'name', 'Copa Antiga', 'date', '2025-03-01'));
  dq := jsonb_build_object('event', jsonb_build_object('id', q ->> 'id', 'name', 'Copa Privada', 'date', '2026-06-01'));
  perform public.admin_finalize_race(r1, jsonb_build_array(
    jsonb_build_object('entry_id', e_ana1 ->> 'id', 'athlete_ids', jsonb_build_array(ana), 'status', 'finished', 'final_ms', 1500000, 'overall_pos', 1, 'data', dp),
    jsonb_build_object('entry_id', e_caio1 ->> 'id', 'athlete_ids', jsonb_build_array(caio), 'status', 'finished', 'final_ms', 1600000, 'overall_pos', 2, 'data', dp)));
  perform public.admin_finalize_race(r2, jsonb_build_array(
    jsonb_build_object('entry_id', e_team2 ->> 'id', 'athlete_ids', jsonb_build_array(beto, duda), 'status', 'finished', 'final_ms', 2400000, 'overall_pos', 1, 'data', dp)));
  perform public.admin_finalize_race(r3, jsonb_build_array(
    jsonb_build_object('entry_id', e_beto3 ->> 'id', 'athlete_ids', jsonb_build_array(beto), 'status', 'finished', 'final_ms', 1550000, 'overall_pos', 1, 'data', dop)));
  perform public.admin_finalize_race(r4, jsonb_build_array(
    jsonb_build_object('entry_id', e_ana4 ->> 'id', 'athlete_ids', jsonb_build_array(ana), 'status', 'finished', 'final_ms', 1400000, 'overall_pos', 1, 'data', dq)));
end $$;

reset role;
select tests.as_anon();
do $$ declare s jsonb; a jsonb; names text[]; got text[]; fixture_athletes text[]; fixture_events text[]; begin
  s := public.pub_stats();
  fixture_athletes := array[tests.get('ana'), tests.get('beto'), tests.get('caio'), tests.get('duda')];
  fixture_events := array[tests.get('ev_p'), tests.get('ev_o'), tests.get('ev_q')];

  -- athletes: of the fixtures, only the public ones, by name, with exactly pub_athlete's fields
  names := (select array_agg(x ->> 'name' order by n) from jsonb_array_elements(s -> 'athletes') with ordinality t(x, n)
            where x ->> 'id' = any(fixture_athletes));
  assert names = array['Ana', 'Beto'], 'public fixture athletes by name, got ' || coalesce(names::text, '<none>');
  for a in select x from jsonb_array_elements(s -> 'athletes') x loop
    assert a = public.pub_athlete((a ->> 'id')::uuid) -> 'athlete', 'athlete fields must equal pub_athlete''s, got ' || a::text;
  end loop;
  assert position('ana@x.com' in s::text) = 0 and position('27999990000' in s::text) = 0
     and position('1990-06-15' in s::text) = 0 and position('segredo-da-org' in s::text) = 0
     and position('public_profile' in s::text) = 0,
    'pub_stats must not carry e-mail, phone, birth date, notes or the public_profile flag';

  -- results of the fixtures: newest event first; Caio alone and the private event stay out
  got := (select array_agg(x ->> 'entry_id' order by n) from jsonb_array_elements(s -> 'results') with ordinality t(x, n)
          where x ->> 'event_id' = any(fixture_events));
  assert array_length(got, 1) = 3, 'expected Ana R1, the Beto+Duda team and Beto R3, got ' || coalesce(got::text, '<none>');
  assert got[3] = tests.get('e_beto3'), 'the older event''s result comes last, got ' || got::text;
  assert (select array_agg(v order by v) from unnest(got[1:2]) v)
       = (select array_agg(v order by v) from unnest(array[tests.get('e_ana1'), tests.get('e_team2')]) v),
    'the 2026 results come first (Ana R1, the Beto+Duda team), got ' || got::text;

  -- the privacy rule (spec §4.1): results == the union of pub_athlete(id) results over the public athletes
  assert (select jsonb_agg(x order by x ->> 'race_id', x ->> 'entry_id') from jsonb_array_elements(s -> 'results') x)
       is not distinct from
         (select jsonb_agg(u.x order by u.x ->> 'race_id', u.x ->> 'entry_id') from (
            select distinct x from jsonb_array_elements(s -> 'athletes') pa,
                   lateral jsonb_array_elements(public.pub_athlete((pa ->> 'id')::uuid) -> 'results') x) u),
    'pub_stats results must be exactly the union of pub_athlete results';
end $$;
-- the 60_security matrix already checks every pub_* by name; this pins the new function.
do $$ begin assert has_function_privilege('anon', 'public.pub_stats()', 'execute'), 'anon must execute pub_stats'; end $$;
reset role;
rollback;
