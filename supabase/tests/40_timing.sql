begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.as_user(tests.get('owner')::uuid);

-- fixtures: one event with a relay race (swim leg 0, run leg 1), athletes A/B, a team entry
-- bib 101 (A on leg 0, B on leg 1), and the wave's start time already set. tk_sync validates
-- mark timestamps against the real wall clock (+/- 2 days), so every timestamp below is anchored
-- to "now" (t0) rather than to the event's own (possibly far-future) date.
do $$ declare ev jsonb; ra jsonb; a jsonb; b jsonb; e jsonb; v_t0 timestamptz := now(); begin
  perform tests.set('t0', v_t0::text);
  ev := public.admin_save_event(jsonb_build_object('name', 'Revezamento EBC', 'date', v_t0::date));
  perform tests.set('ev', ev ->> 'id');
  perform tests.set('tk_token', ev ->> 'tk_token');

  ra := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Revezamento', 'team_size', 2,
        'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race', ra -> 'race' ->> 'id');
  perform public.admin_set_wave_start((ra -> 'waves' -> 0 ->> 'id')::uuid, v_t0);

  a := public.admin_save_athlete('{"name":"Atleta A","sex":"M"}'::jsonb); perform tests.set('ath_a', a ->> 'id');
  b := public.admin_save_athlete('{"name":"Atleta B","sex":"F"}'::jsonb); perform tests.set('ath_b', b ->> 'id');

  e := public.admin_save_entry(jsonb_build_object('race_id', ra -> 'race' ->> 'id', 'bib', '101', 'team_name', 'Equipe AB',
        'members', jsonb_build_array(
          jsonb_build_object('athlete_id', tests.get('ath_a'), 'legs', jsonb_build_array(0)),
          jsonb_build_object('athlete_id', tests.get('ath_b'), 'legs', jsonb_build_array(1))
        )));
  perform tests.set('entry', e ->> 'id');
end $$;

-- tk_open / tk_event: an unknown/disabled token is refused with the standard message.
reset role;
select tests.assert_raises($$select public.tk_open('errado')$$, 'P0001', 'Link de cronometragem%');

-- tk_open (as anon): the one race and the one entry come back, member names included.
select tests.as_anon();
do $$ declare s jsonb; begin
  s := public.tk_open(tests.get('tk_token'));
  assert jsonb_array_length(s -> 'races') = 1, 'expected 1 race, got ' || jsonb_array_length(s -> 'races');
  assert jsonb_array_length(s -> 'entries') = 1, 'expected 1 entry, got ' || jsonb_array_length(s -> 'entries');
  assert (s -> 'entries' -> 0 -> 'members' -> 0 ->> 'name') is not null, 'tk_open entries should include member names';
end $$;

-- tk_register: blank name rejected; a valid name returns an id and a 32-char secret.
select tests.assert_raises($$select public.tk_register(tests.get('tk_token'), '  ', '')$$, 'P0001', 'Informe seu nome');
do $$ declare reg jsonb; begin
  reg := public.tk_register(tests.get('tk_token'), 'Ana', 'iPhone');
  assert length(reg ->> 'secret') = 32, 'expected a 32-char secret, got length ' || length(reg ->> 'secret');
  perform tests.set('tk_ana', reg ->> 'timekeeper_id');
  perform tests.set('secret_ana', reg ->> 'secret');
end $$;

-- tk_sync: wrong secret is refused outright.
select tests.assert_raises(
  $$select public.tk_sync(tests.get('tk_token'), tests.get('tk_ana')::uuid, 'secret-errado', '[]'::jsonb, null)$$,
  'P0001', 'Cronometrista não autorizado');

-- tk_sync: two marks in one batch -- one assigned to entry 101 leg 0, one unassigned.
do $$ declare res jsonb; m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); begin
  perform tests.set('mark_assigned', m1::text);
  perform tests.set('mark_unassigned', m2::text);
  res := public.tk_sync(tests.get('tk_token'), tests.get('tk_ana')::uuid, tests.get('secret_ana'), jsonb_build_array(
    jsonb_build_object('id', m1, 'ts', tests.get('t0')::timestamptz + interval '10 minutes', 'entry_id', tests.get('entry'), 'leg_index', 0, 'discarded', false),
    jsonb_build_object('id', m2, 'ts', tests.get('t0')::timestamptz + interval '11 minutes', 'entry_id', null, 'leg_index', null, 'discarded', false)
  ), null);
  assert jsonb_array_length(res -> 'accepted') = 2, 'expected 2 accepted, got ' || jsonb_array_length(res -> 'accepted');
  assert jsonb_array_length(res -> 'rejected') = 0, 'expected 0 rejected, got ' || jsonb_array_length(res -> 'rejected');
  assert jsonb_array_length(res -> 'marks') = 2, 'expected both marks in the delta, got ' || jsonb_array_length(res -> 'marks');
end $$;

-- re-sending the first mark with a different leg_index is accepted and updates it in place.
do $$ declare res jsonb; begin
  res := public.tk_sync(tests.get('tk_token'), tests.get('tk_ana')::uuid, tests.get('secret_ana'), jsonb_build_array(
    jsonb_build_object('id', tests.get('mark_assigned'), 'ts', tests.get('t0')::timestamptz + interval '10 minutes', 'entry_id', tests.get('entry'), 'leg_index', 1, 'discarded', false)
  ), null);
  assert jsonb_array_length(res -> 'accepted') = 1;
  assert exists (
    select 1 from jsonb_array_elements(res -> 'marks') mk
    where mk ->> 'id' = tests.get('mark_assigned') and (mk ->> 'leg_index')::int = 1
  ), 'expected mark_assigned to be updated to leg_index 1';
end $$;

-- re-sending the same mark with a different ts leaves the stored ts unchanged (ts is immutable).
do $$ declare res jsonb; begin
  res := public.tk_sync(tests.get('tk_token'), tests.get('tk_ana')::uuid, tests.get('secret_ana'), jsonb_build_array(
    jsonb_build_object('id', tests.get('mark_assigned'), 'ts', tests.get('t0')::timestamptz + interval '1 hour', 'entry_id', tests.get('entry'), 'leg_index', 1, 'discarded', false)
  ), null);
  assert jsonb_array_length(res -> 'accepted') = 1;
  assert exists (
    select 1 from jsonb_array_elements(res -> 'marks') mk
    where mk ->> 'id' = tests.get('mark_assigned') and (mk ->> 'ts')::timestamptz = tests.get('t0')::timestamptz + interval '10 minutes'
  ), 'ts should stay at its original value once the mark exists';
end $$;

-- an out-of-range leg and a wildly-off ts are both rejected, with the exact pt-BR reasons.
do $$ declare res jsonb; begin
  res := public.tk_sync(tests.get('tk_token'), tests.get('tk_ana')::uuid, tests.get('secret_ana'), jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'ts', now(), 'entry_id', tests.get('entry'), 'leg_index', 2, 'discarded', false),
    jsonb_build_object('id', gen_random_uuid(), 'ts', now() + interval '3 days', 'entry_id', null, 'leg_index', null, 'discarded', false)
  ), null);
  assert jsonb_array_length(res -> 'accepted') = 0, 'expected both marks to be rejected';
  assert jsonb_array_length(res -> 'rejected') = 2, 'expected 2 rejected, got ' || jsonb_array_length(res -> 'rejected');
  assert exists (select 1 from jsonb_array_elements(res -> 'rejected') r where r ->> 'reason' = 'Perna inválida');
  assert exists (select 1 from jsonb_array_elements(res -> 'rejected') r where r ->> 'reason' = 'Horário inválido');
end $$;

-- a second timekeeper cannot touch the first one's mark.
do $$ declare reg jsonb; begin
  reg := public.tk_register(tests.get('tk_token'), 'Beto', 'Android');
  perform tests.set('tk_beto', reg ->> 'timekeeper_id');
  perform tests.set('secret_beto', reg ->> 'secret');
end $$;
do $$ declare res jsonb; begin
  res := public.tk_sync(tests.get('tk_token'), tests.get('tk_beto')::uuid, tests.get('secret_beto'), jsonb_build_array(
    jsonb_build_object('id', tests.get('mark_assigned'), 'ts', tests.get('t0')::timestamptz + interval '10 minutes', 'entry_id', tests.get('entry'), 'leg_index', 1, 'discarded', false)
  ), null);
  assert jsonb_array_length(res -> 'rejected') = 1;
  assert (res -> 'rejected' -> 0 ->> 'reason') = 'Marcação pertence a outro cronometrista';
end $$;

-- as owner: admin_update_mark discards mark_assigned; the timekeeper can no longer un-discard it.
reset role;
select tests.as_user(tests.get('owner')::uuid);
do $$ declare m jsonb; begin
  m := public.admin_update_mark(tests.get('mark_assigned')::uuid, '{"discarded":true}'::jsonb);
  assert (m ->> 'discarded')::boolean = true and m ->> 'discarded_by' = 'organizer',
    'expected discarded_by=organizer, got ' || (m ->> 'discarded_by');
end $$;
reset role;
select tests.as_anon();
do $$ declare res jsonb; begin
  res := public.tk_sync(tests.get('tk_token'), tests.get('tk_ana')::uuid, tests.get('secret_ana'), jsonb_build_array(
    jsonb_build_object('id', tests.get('mark_assigned'), 'ts', tests.get('t0')::timestamptz + interval '10 minutes', 'entry_id', tests.get('entry'), 'leg_index', 1, 'discarded', false)
  ), null);
  assert (res -> 'rejected' -> 0 ->> 'reason') = 'Descartada pela organização';
end $$;

-- extra: admin_update_mark can also unassign a mark (entry_id present & null clears leg_index too).
reset role;
select tests.as_user(tests.get('owner')::uuid);
do $$ declare m jsonb; begin
  m := public.admin_update_mark(tests.get('mark_assigned')::uuid, '{"entry_id":null}'::jsonb);
  assert (m ->> 'entry_id') is null and (m ->> 'leg_index') is null,
    'unassigning a mark should clear both entry_id and leg_index';
end $$;

-- admin_update_timekeeper deactivates Ana; her tk_sync now fails outright, and the row never
-- carries the secret back.
do $$ declare t jsonb; begin
  t := public.admin_update_timekeeper(tests.get('tk_ana')::uuid, '{"active":false}'::jsonb);
  assert (t ->> 'active')::boolean = false;
  assert not (t ? 'secret'), 'admin_update_timekeeper must never return the secret';
end $$;
reset role;
select tests.as_anon();
select tests.assert_raises(
  $$select public.tk_sync(tests.get('tk_token'), tests.get('tk_ana')::uuid, tests.get('secret_ana'), '[]'::jsonb, null)$$,
  'P0001', 'Seu acesso foi desativado%');

-- fixture: a fresh, non-discarded mark on leg 0 of the entry, inserted directly (bypassing tk_sync)
-- so the resolution tests below have something valid to point at.
reset role;
do $$ declare v_mark uuid := gen_random_uuid(); begin
  insert into public.marks (id, event_id, timekeeper_id, ts, entry_id, leg_index, discarded)
  values (v_mark, tests.get('ev')::uuid, tests.get('tk_beto')::uuid, tests.get('t0')::timestamptz + interval '9 minutes', tests.get('entry')::uuid, 0, false);
  perform tests.set('mark_leg0', v_mark::text);
end $$;
select tests.as_user(tests.get('owner')::uuid);

-- admin_set_resolution: a mark from the wrong leg is refused; a matching one is accepted; manual
-- mode without a timestamp is refused; admin_clear_resolution removes it again.
select tests.assert_raises(
  $$select public.admin_set_resolution(tests.get('entry')::uuid, 0, 'mark', tests.get('mark_assigned')::uuid, null, '')$$,
  'P0001', 'Marcação não pertence a esta passagem');
do $$ declare res jsonb; begin
  res := public.admin_set_resolution(tests.get('entry')::uuid, 0, 'mark', tests.get('mark_leg0')::uuid, null, 'confirmado pela dupla');
  assert res ->> 'mode' = 'mark' and res ->> 'mark_id' = tests.get('mark_leg0');
end $$;
select tests.assert_raises(
  $$select public.admin_set_resolution(tests.get('entry')::uuid, 0, 'manual', null, null, '')$$, 'P0001');

-- admin_live: sees every mark, the one resolution and the one wave of the event.
do $$ declare live jsonb; begin
  live := public.admin_live(tests.get('ev')::uuid, null);
  assert jsonb_array_length(live -> 'marks') = 3, 'expected 3 marks, got ' || jsonb_array_length(live -> 'marks');
  assert jsonb_array_length(live -> 'resolutions') = 1, 'expected 1 resolution, got ' || jsonb_array_length(live -> 'resolutions');
  assert jsonb_array_length(live -> 'waves') = 1, 'expected 1 wave, got ' || jsonb_array_length(live -> 'waves');
end $$;
-- ... but with a p_since in the future, marks are empty while waves/resolutions still come in full.
do $$ declare live jsonb; begin
  live := public.admin_live(tests.get('ev')::uuid, now() + interval '1 hour');
  assert jsonb_array_length(live -> 'marks') = 0, 'expected 0 marks after the cutoff, got ' || jsonb_array_length(live -> 'marks');
  assert jsonb_array_length(live -> 'waves') = 1, 'waves should always come back in full';
end $$;

do $$ begin
  perform public.admin_clear_resolution(tests.get('entry')::uuid, 0);
  assert jsonb_array_length(public.admin_live(tests.get('ev')::uuid, null) -> 'resolutions') = 0,
    'admin_clear_resolution should remove the resolution';
end $$;

-- admin_finalize_race / admin_unfinalize_race.
do $$ declare res jsonb; agg jsonb; begin
  res := public.admin_finalize_race(tests.get('race')::uuid, jsonb_build_array(jsonb_build_object(
    'entry_id', tests.get('entry'), 'athlete_ids', jsonb_build_array(tests.get('ath_a'), tests.get('ath_b')),
    'status', 'finished', 'final_ms', 1800000, 'overall_pos', 1, 'data', '{}'::jsonb
  )));
  assert (res ->> 'count')::int = 1, 'expected count=1, got ' || (res ->> 'count');
  assert (res ->> 'finalized_at') is not null;

  agg := public.admin_get_event(tests.get('ev')::uuid);
  assert (agg -> 'races' -> 0 ->> 'finalized_at') is not null, 'races.finalized_at should be set';
  assert jsonb_array_length(agg -> 'results') = 1;

  perform public.admin_unfinalize_race(tests.get('race')::uuid);
  agg := public.admin_get_event(tests.get('ev')::uuid);
  assert (agg -> 'races' -> 0 ->> 'finalized_at') is null, 'races.finalized_at should be cleared';
  assert jsonb_array_length(agg -> 'results') = 0, 'results should be deleted';
end $$;
select tests.assert_raises($$select public.admin_unfinalize_race(gen_random_uuid())$$, 'P0001');

reset role;
rollback;
