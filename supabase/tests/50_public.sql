begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.as_user(tests.get('owner')::uuid);

-- fixtures: one event (created private), a relay race (swim leg 0, run leg 1), two athletes (one
-- with email/phone/birth_date, one without), a team entry bib 101, and the wave's start time set.
-- the event's date is a fixed literal (not derived from now()) so the age_event/age_year_end
-- assertions below can use literal expected numbers instead of re-deriving the same formula.
do $$ declare ev jsonb; ra jsonb; a jsonb; b jsonb; e jsonb; v_t0 timestamptz := now(); v_event_date constant date := '2026-11-15'; begin
  perform tests.set('t0', v_t0::text);
  ev := public.admin_save_event(jsonb_build_object('name', 'Copa Pública', 'date', v_event_date, 'is_public', false));
  perform tests.set('ev', ev ->> 'id');
  perform tests.set('slug', ev ->> 'public_slug');

  ra := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Revezamento', 'team_size', 2,
        'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race', ra -> 'race' ->> 'id');
  perform public.admin_set_wave_start((ra -> 'waves' -> 0 ->> 'id')::uuid, v_t0);

  -- birth_date is late in the year (Dec 31) so that, as of the Nov 15 event date, age_event
  -- (35 -- the birthday hasn't happened yet that year) differs from age_year_end (36 -- plain
  -- calendar-year difference): a discriminating fixture, not one where the two happen to agree.
  a := public.admin_save_athlete('{"name":"Atleta A","sex":"M","email":"a@x.com","phone":"11999999999","birth_date":"1990-12-31"}'::jsonb);
  perform tests.set('ath_a', a ->> 'id');
  b := public.admin_save_athlete('{"name":"Atleta B","sex":"F"}'::jsonb);
  perform tests.set('ath_b', b ->> 'id');

  e := public.admin_save_entry(jsonb_build_object('race_id', ra -> 'race' ->> 'id', 'bib', '101', 'team_name', 'Equipe AB', 'notes', 'segredo da organização',
        'members', jsonb_build_array(
          jsonb_build_object('athlete_id', tests.get('ath_a'), 'legs', jsonb_build_array(0)),
          jsonb_build_object('athlete_id', tests.get('ath_b'), 'legs', jsonb_build_array(1))
        )));
  perform tests.set('entry', e ->> 'id');
end $$;

-- while the event is private: pub_event and pub_events both refuse it.
reset role;
select tests.as_anon();
select tests.assert_raises($$select public.pub_event(tests.get('slug'))$$, 'P0001', 'Evento não encontrado');
do $$ begin
  assert not exists (
    select 1 from jsonb_array_elements(public.pub_events()) x where x ->> 'id' = tests.get('ev')
  ), 'a private event must not appear in pub_events()';
end $$;

-- make it public, then add one live mark and one discarded one (inserted directly, as tk_sync and
-- admin_update_mark belong to Task 6 -- pub_live must return both so clients can drop the discarded one).
reset role;
select tests.as_user(tests.get('owner')::uuid);
do $$ begin perform public.admin_save_event(jsonb_build_object('id', tests.get('ev'), 'is_public', true)); end $$;
reset role;
do $$ declare m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); begin
  insert into public.marks (id, event_id, ts, device_ts, clock_offset_ms, clock_rtt_ms, entry_id, leg_index, discarded, discarded_by)
    values (m1, tests.get('ev')::uuid, tests.get('t0')::timestamptz + interval '10 minutes', now(), 120, 40, tests.get('entry')::uuid, 0, false, null);
  insert into public.marks (id, event_id, ts, device_ts, clock_offset_ms, clock_rtt_ms, entry_id, leg_index, discarded, discarded_by)
    values (m2, tests.get('ev')::uuid, tests.get('t0')::timestamptz + interval '11 minutes', now(), 80, 30, tests.get('entry')::uuid, 1, true, 'organizer');
  perform tests.set('mark_live', m1::text);
  perform tests.set('mark_discarded', m2::text);
end $$;

-- a resolution on leg 0 pointing at the live mark, carrying an organizer-only note and (via
-- decided_by) the organizer's own user id: pub_event/pub_live must never leak either field.
select tests.as_user(tests.get('owner')::uuid);
do $$ begin
  perform public.admin_set_resolution(tests.get('entry')::uuid, 0, 'mark', tests.get('mark_live')::uuid, null,
    'ajuste interno da organização, não divulgar');
end $$;

-- pub_events(): now public.
select tests.as_anon();
do $$ begin
  assert exists (
    select 1 from jsonb_array_elements(public.pub_events()) x where x ->> 'id' = tests.get('ev')
  ), 'the event should appear in pub_events() once public';
end $$;

-- pub_event: event has no tk_token/tk_enabled, entries include member names but not notes,
-- athletes never carry email/phone/birth_date, age_year_end/age_event are computed (null when
-- there is no birth_date), marks include the discarded one and never carry clock-audit fields.
do $$ declare pub jsonb; v_athlete jsonb; v_a jsonb; v_b jsonb; begin
  pub := public.pub_event(tests.get('slug'));

  assert not (pub -> 'event' ? 'tk_token'), 'public event payload must not carry tk_token';
  assert not (pub -> 'event' ? 'tk_enabled'), 'public event payload must not carry tk_enabled';

  assert jsonb_array_length(pub -> 'entries') = 1;
  assert (pub -> 'entries' -> 0 -> 'members' -> 0 ->> 'name') is not null, 'pub_event entries should include member names';
  assert not (pub -> 'entries' -> 0 ? 'notes'), 'pub_event entries must not carry the organizer-only notes field';
  assert (pub -> 'entries' -> 0 ->> 'status') is not null, 'pub_event entries should keep status';
  assert (pub -> 'entries' -> 0 ->> 'penalty_ms') is not null, 'pub_event entries should keep penalty_ms';

  assert jsonb_array_length(pub -> 'athletes') = 2;
  for v_athlete in select el from jsonb_array_elements(pub -> 'athletes') as t(el) loop
    assert not (v_athlete ? 'email'), 'pub_event athletes must not carry email';
    assert not (v_athlete ? 'phone'), 'pub_event athletes must not carry phone';
    assert not (v_athlete ? 'birth_date'), 'pub_event athletes must not carry birth_date';
  end loop;

  select el into v_a from jsonb_array_elements(pub -> 'athletes') as t(el) where el ->> 'id' = tests.get('ath_a');
  -- literal expected numbers (event date 2026-11-15, birth_date 1990-12-31), not re-derived with
  -- the same age()/extract() formula under test: age_event=35 (birthday not yet reached that
  -- year) is deliberately one less than age_year_end=36 (plain calendar-year difference).
  assert (v_a ->> 'age_year_end')::int = 36, 'expected age_year_end 36, got ' || (v_a ->> 'age_year_end');
  assert (v_a ->> 'age_event')::int = 35, 'expected age_event 35, got ' || (v_a ->> 'age_event');

  select el into v_b from jsonb_array_elements(pub -> 'athletes') as t(el) where el ->> 'id' = tests.get('ath_b');
  assert (v_b ->> 'age_year_end') is null, 'age_year_end should be null without a birth_date';
  assert (v_b ->> 'age_event') is null, 'age_event should be null without a birth_date';

  assert jsonb_array_length(pub -> 'marks') = 2, 'pub_event marks should include the discarded one too';
  assert not (pub -> 'marks' -> 0 ? 'device_ts'), 'pub_event marks must not carry device_ts';
  assert not (pub -> 'marks' -> 0 ? 'clock_offset_ms'), 'pub_event marks must not carry clock_offset_ms';
  assert not (pub -> 'marks' -> 0 ? 'clock_rtt_ms'), 'pub_event marks must not carry clock_rtt_ms';
  assert not (pub -> 'marks' -> 0 ? 'org_edited'), 'pub_event marks must not carry org_edited';

  assert jsonb_array_length(pub -> 'resolutions') = 1;
  assert not (pub -> 'resolutions' -> 0 ? 'note'), 'pub_event resolutions must not carry the organizer note';
  assert not (pub -> 'resolutions' -> 0 ? 'decided_by'), 'pub_event resolutions must not carry decided_by';
end $$;

-- pub_live: same delta semantics as admin_live, same mark projection, discarded included.
do $$ declare live jsonb; begin
  live := public.pub_live(tests.get('slug'), null);
  assert jsonb_array_length(live -> 'marks') = 2, 'pub_live should include the discarded mark too';
  assert jsonb_array_length(live -> 'waves') = 1;
  assert not (live -> 'marks' -> 0 ? 'device_ts');
  assert not (live -> 'marks' -> 0 ? 'org_edited'), 'pub_live marks must not carry org_edited';

  assert jsonb_array_length(live -> 'resolutions') = 1;
  assert not (live -> 'resolutions' -> 0 ? 'note'), 'pub_live resolutions must not carry the organizer note';
  assert not (live -> 'resolutions' -> 0 ? 'decided_by'), 'pub_live resolutions must not carry decided_by';

  live := public.pub_live(tests.get('slug'), now() + interval '1 hour');
  assert jsonb_array_length(live -> 'marks') = 0, 'marks after the cutoff should be empty';
  assert jsonb_array_length(live -> 'waves') = 1, 'waves should always come back in full';
end $$;
select tests.assert_raises($$select public.pub_live('errado', null)$$, 'P0001', 'Evento não encontrado');

-- pub_athlete: finalize the public race (one result for both athletes of entry 101), plus a
-- second, private event+race+result for Atleta A only.
reset role;
select tests.as_user(tests.get('owner')::uuid);
do $$ begin
  perform public.admin_finalize_race(tests.get('race')::uuid, jsonb_build_array(jsonb_build_object(
    'entry_id', tests.get('entry'), 'athlete_ids', jsonb_build_array(tests.get('ath_a'), tests.get('ath_b')),
    'status', 'finished', 'final_ms', 1800000, 'overall_pos', 1, 'data', '{}'::jsonb
  )));
end $$;
do $$ declare ev2 jsonb; ra2 jsonb; e2 jsonb; begin
  ev2 := public.admin_save_event(jsonb_build_object('name', 'Copa Privada', 'date', tests.get('t0')::date));
  perform tests.set('ev2', ev2 ->> 'id');
  ra2 := public.admin_save_race(jsonb_build_object('event_id', ev2 ->> 'id', 'name', 'Corrida', 'team_size', 1,
        'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  e2 := public.admin_save_entry(jsonb_build_object('race_id', ra2 -> 'race' ->> 'id',
        'members', jsonb_build_array(jsonb_build_object('athlete_id', tests.get('ath_a')))));
  perform public.admin_finalize_race((ra2 -> 'race' ->> 'id')::uuid, jsonb_build_array(jsonb_build_object(
    'entry_id', e2 ->> 'id', 'athlete_ids', jsonb_build_array(tests.get('ath_a')),
    'status', 'finished', 'final_ms', 1500000, 'overall_pos', 1, 'data', '{}'::jsonb
  )));
end $$;

reset role;
select tests.as_anon();
do $$ declare prof jsonb; begin
  prof := public.pub_athlete(tests.get('ath_a')::uuid);
  assert prof -> 'athlete' ->> 'name' = 'Atleta A';
  assert not (prof -> 'athlete' ? 'email'), 'pub_athlete must not carry email';
  assert not (prof -> 'athlete' ? 'birth_date'), 'pub_athlete must not carry birth_date';
  assert jsonb_array_length(prof -> 'results') = 1,
    'pub_athlete should omit results from private events, got ' || jsonb_array_length(prof -> 'results');
  assert (prof -> 'results' -> 0 ->> 'race_id') = tests.get('race'), 'expected only the public race''s result';
end $$;

-- pub_athlete: an athlete with public_profile=false is refused, even though they exist.
reset role;
select tests.as_user(tests.get('owner')::uuid);
do $$ begin perform public.admin_save_athlete(jsonb_build_object('id', tests.get('ath_b'), 'public_profile', false)); end $$;
reset role;
select tests.as_anon();
select tests.assert_raises($$select public.pub_athlete(tests.get('ath_b')::uuid)$$, 'P0001', 'Perfil não encontrado');

reset role;
rollback;
