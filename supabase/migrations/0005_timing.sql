-- Timing RPCs: organizer live tools (admin_live, marks, resolutions, timekeepers, finalize) and
-- the timekeeper link (tk_*) (spec §6 "Cronometrista"/"Organização", §7 "Cronometragem").

-- 1. tk_event: resolves the event behind a p_token, or raises if the link is wrong/disabled.
--    Used by every tk_* endpoint below (anon + authenticated; no assert_organizer here).
create or replace function public.tk_event(p_token text) returns public.events
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events;
begin
  select * into ev from public.events where tk_token = p_token and tk_enabled;
  if not found then
    raise exception 'Link de cronometragem inválido ou desativado' using errcode = 'P0001';
  end if;
  return ev;
end $$;

-- 2. tk_open: structural snapshot the timekeeper app caches and reloads on version change.
create or replace function public.tk_open(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events := public.tk_event(p_token);
begin
  return jsonb_build_object(
    'event', jsonb_build_object('id', ev.id, 'name', ev.name, 'date', ev.date, 'location', ev.location),
    'races', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.position, r.name) from public.races r where r.event_id = ev.id
    ), '[]'::jsonb),
    'waves', coalesce((
      select jsonb_agg(to_jsonb(w) order by r.position, r.name, w.position)
      from public.waves w join public.races r on r.id = w.race_id
      where r.event_id = ev.id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(public.entry_json(en.id, true)
                        order by case when en.bib ~ '^\d+$' then lpad(en.bib, 20, '0') else en.bib end)
      from public.entries en where en.event_id = ev.id
    ), '[]'::jsonb),
    'timekeepers', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.created_at)
      from public.timekeepers t where t.event_id = ev.id
    ), '[]'::jsonb),
    'version', ev.version,
    'server_now', now()
  );
end $$;

-- 3. tk_register: one-time name capture; the device keeps {timekeeper_id, secret} afterwards.
create or replace function public.tk_register(p_token text, p_name text, p_device_label text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  ev public.events := public.tk_event(p_token);
  v_name text := btrim(coalesce(p_name, ''));
  v_secret text := public.random_token(32);
  v_id uuid;
begin
  if length(v_name) = 0 or length(v_name) > 60 then
    raise exception 'Informe seu nome' using errcode = 'P0001';
  end if;
  insert into public.timekeepers (event_id, name, secret, device_label)
  values (ev.id, v_name, v_secret, coalesce(p_device_label, ''))
  returning id into v_id;
  return jsonb_build_object('timekeeper_id', v_id, 'secret', v_secret);
end $$;

-- 4. tk_sync: the sync loop endpoint. Implemented exactly as specified (see task brief) --
--    per-mark failures are caught individually so one bad row never blocks the batch.
create or replace function public.tk_sync(p_token text, p_timekeeper_id uuid, p_secret text, p_marks jsonb, p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events := public.tk_event(p_token);
        tk public.timekeepers; m jsonb; v_id uuid; ex public.marks; v_entry public.entries; v_legs int;
        v_entry_id uuid; v_leg int; v_discarded boolean; v_ts timestamptz;
        accepted jsonb := '[]'; rejected jsonb := '[]';
begin
  select * into tk from public.timekeepers where id = p_timekeeper_id and event_id = ev.id and secret = p_secret;
  if not found then raise exception 'Cronometrista não autorizado' using errcode = 'P0001'; end if;
  if not tk.active then raise exception 'Seu acesso foi desativado pela organização' using errcode = 'P0001'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    begin
      v_id := (m ->> 'id')::uuid;
      v_entry_id := nullif(m ->> 'entry_id', '')::uuid;
      v_leg := (m ->> 'leg_index')::int;
      v_discarded := coalesce((m ->> 'discarded')::boolean, false);
      if v_entry_id is null then v_leg := null;
      else
        select * into v_entry from public.entries where id = v_entry_id and event_id = ev.id;
        if not found then raise exception 'Atleta não encontrado neste evento'; end if;
        select jsonb_array_length(legs) into v_legs from public.races where id = v_entry.race_id;
        if v_leg is null or v_leg < 0 or v_leg >= v_legs then raise exception 'Perna inválida'; end if;
      end if;
      select * into ex from public.marks where id = v_id;
      if not found then
        v_ts := (m ->> 'ts')::timestamptz;
        if v_ts is null or abs(extract(epoch from v_ts - now())) > 172800 then raise exception 'Horário inválido'; end if;
        insert into public.marks (id, event_id, timekeeper_id, ts, device_ts, clock_offset_ms, clock_rtt_ms,
                                  entry_id, leg_index, athlete_id, discarded, discarded_by)
        values (v_id, ev.id, tk.id, v_ts, (m ->> 'device_ts')::timestamptz, (m ->> 'clock_offset_ms')::int,
                (m ->> 'clock_rtt_ms')::int, v_entry_id, v_leg, nullif(m ->> 'athlete_id', '')::uuid,
                v_discarded, case when v_discarded then 'timekeeper' end);
      else
        if ex.timekeeper_id is distinct from tk.id then raise exception 'Marcação pertence a outro cronometrista'; end if;
        if ex.discarded_by = 'organizer' and not v_discarded then raise exception 'Descartada pela organização'; end if;
        update public.marks set entry_id = v_entry_id, leg_index = v_leg,
               athlete_id = nullif(m ->> 'athlete_id', '')::uuid, discarded = v_discarded,
               discarded_by = case when v_discarded then coalesce(ex.discarded_by, 'timekeeper') end
         where id = v_id;
      end if;
      accepted := accepted || to_jsonb(v_id::text);
    exception when others then
      rejected := rejected || jsonb_build_object('id', m ->> 'id', 'reason', sqlerrm);
    end;
  end loop;
  update public.timekeepers set last_seen_at = now() where id = tk.id;
  return jsonb_build_object(
    'accepted', accepted, 'rejected', rejected, 'server_now', now(), 'version', ev.version,
    'marks', coalesce((select jsonb_agg(to_jsonb(k) order by k.ts) from public.marks k
                       where k.event_id = ev.id and (p_since is null or k.updated_at >= p_since)), '[]'::jsonb),
    'waves', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'start_at', w.start_at))
                       from public.waves w join public.races r on r.id = w.race_id where r.event_id = ev.id), '[]'::jsonb));
end $$;

-- 5. admin_live: incremental feed for the timing/review tabs. Marks are a delta (p_since); the
--    (small) resolutions and waves lists always come back in full, so deletions also propagate.
create or replace function public.admin_live(p_event_id uuid, p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events;
begin
  perform public.assert_organizer();
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Evento não encontrado' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'server_now', now(),
    'version', ev.version,
    'marks', coalesce((
      select jsonb_agg(to_jsonb(mk) order by mk.ts) from public.marks mk
      where mk.event_id = ev.id and (p_since is null or mk.updated_at >= p_since)
    ), '[]'::jsonb),
    'resolutions', coalesce((
      select jsonb_agg(to_jsonb(res)) from public.resolutions res where res.event_id = ev.id
    ), '[]'::jsonb),
    'waves', coalesce((
      select jsonb_agg(to_jsonb(w) order by r.position, r.name, w.position)
      from public.waves w join public.races r on r.id = w.race_id
      where r.event_id = ev.id
    ), '[]'::jsonb)
  );
end $$;

-- 6. admin_update_mark: reassign/unassign a mark to a different entry+leg, or discard/restore it
--    from the organizer's side (Review tab).
create or replace function public.admin_update_mark(p_mark_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  m public.marks; v_entry public.entries; v_entry_id uuid; v_leg int; v_legs int;
  v_discarded boolean; v_discarded_by text;
begin
  perform public.assert_organizer();
  select * into m from public.marks where id = p_mark_id;
  if not found then raise exception 'Marcação não encontrada' using errcode = 'P0001'; end if;

  if p_patch ? 'entry_id' then
    v_entry_id := nullif(p_patch->>'entry_id', '')::uuid;
  else
    v_entry_id := m.entry_id;
  end if;

  if v_entry_id is null then
    v_leg := null;
  else
    select * into v_entry from public.entries where id = v_entry_id and event_id = m.event_id;
    if not found then raise exception 'Inscrição não encontrada' using errcode = 'P0001'; end if;
    if p_patch ? 'leg_index' then
      v_leg := nullif(p_patch->>'leg_index', '')::int;
    elsif v_entry_id = m.entry_id then
      v_leg := m.leg_index;
    end if;
    select jsonb_array_length(legs) into v_legs from public.races where id = v_entry.race_id;
    if v_leg is null or v_leg < 0 or v_leg >= v_legs then
      raise exception 'Perna inválida' using errcode = 'P0001';
    end if;
  end if;

  if p_patch ? 'discarded' then
    v_discarded := (p_patch->>'discarded')::boolean;
    v_discarded_by := case when v_discarded then 'organizer' end;
  else
    v_discarded := m.discarded;
    v_discarded_by := m.discarded_by;
  end if;

  update public.marks set
    entry_id = v_entry_id, leg_index = v_leg, discarded = v_discarded, discarded_by = v_discarded_by
  where id = p_mark_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- 7. admin_set_resolution / admin_clear_resolution: the Review tab's per-crossing override.
create or replace function public.admin_set_resolution(
  p_entry_id uuid, p_leg_index int, p_mode text, p_mark_id uuid, p_manual_ts timestamptz, p_note text
) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  o public.organizers := public.assert_organizer();
  v_entry public.entries; v_legs int; v_mark public.marks; res public.resolutions;
begin
  select * into v_entry from public.entries where id = p_entry_id;
  if not found then raise exception 'Inscrição não encontrada' using errcode = 'P0001'; end if;
  select jsonb_array_length(legs) into v_legs from public.races where id = v_entry.race_id;
  if p_leg_index is null or p_leg_index < 0 or p_leg_index >= v_legs then
    raise exception 'Perna inválida' using errcode = 'P0001';
  end if;
  if p_mode not in ('system', 'mark', 'manual') then
    raise exception 'Modo de resolução inválido' using errcode = 'P0001';
  end if;

  if p_mode = 'mark' then
    select * into v_mark from public.marks
      where id = p_mark_id and not discarded and entry_id = p_entry_id and leg_index = p_leg_index;
    if not found then
      raise exception 'Marcação não pertence a esta passagem' using errcode = 'P0001';
    end if;
  elsif p_mode = 'manual' then
    if p_manual_ts is null then
      raise exception 'Informe o horário manual' using errcode = 'P0001';
    end if;
  end if;

  insert into public.resolutions (entry_id, leg_index, event_id, mode, mark_id, manual_ts, note, decided_by)
  values (p_entry_id, p_leg_index, v_entry.event_id, p_mode,
          case when p_mode = 'mark' then p_mark_id end,
          case when p_mode = 'manual' then p_manual_ts end,
          coalesce(p_note, ''), o.user_id)
  on conflict (entry_id, leg_index) do update set
    mode = excluded.mode, mark_id = excluded.mark_id, manual_ts = excluded.manual_ts,
    note = excluded.note, decided_by = excluded.decided_by, updated_at = now()
  returning * into res;

  return to_jsonb(res);
end $$;

create or replace function public.admin_clear_resolution(p_entry_id uuid, p_leg_index int) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  delete from public.resolutions where entry_id = p_entry_id and leg_index = p_leg_index;
end $$;

-- 8. admin_update_timekeeper: rename/deactivate; the secret never leaves the server after tk_register.
create or replace function public.admin_update_timekeeper(p_timekeeper_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t public.timekeepers; v_name text; v_active boolean;
begin
  perform public.assert_organizer();
  select * into t from public.timekeepers where id = p_timekeeper_id;
  if not found then raise exception 'Cronometrista não encontrado' using errcode = 'P0001'; end if;

  if p_patch ? 'name' then
    v_name := btrim(p_patch->>'name');
    if v_name is null or length(v_name) = 0 then
      raise exception 'Informe o nome do cronometrista' using errcode = 'P0001';
    end if;
  else
    v_name := t.name;
  end if;

  if p_patch ? 'active' then
    v_active := (p_patch->>'active')::boolean;
  else
    v_active := t.active;
  end if;

  update public.timekeepers set name = v_name, active = v_active where id = p_timekeeper_id returning * into t;
  return to_jsonb(t) - 'secret';
end $$;

-- 9. admin_finalize_race / admin_unfinalize_race: freeze (or unfreeze) a race's results snapshot,
--    computed client-side and handed back as p_rows.
create or replace function public.admin_finalize_race(p_race_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r public.races; v_row jsonb; v_entry_id uuid; v_count int := 0; v_finalized_at timestamptz;
begin
  perform public.assert_organizer();
  select * into r from public.races where id = p_race_id;
  if not found then raise exception 'Prova não encontrada' using errcode = 'P0001'; end if;

  delete from public.results where race_id = p_race_id;

  for v_row in select el from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as t(el) loop
    v_entry_id := nullif(v_row->>'entry_id', '')::uuid;
    if not exists (select 1 from public.entries e where e.id = v_entry_id and e.race_id = p_race_id) then
      raise exception 'Inscrição não pertence a esta prova' using errcode = 'P0001';
    end if;
    insert into public.results (race_id, entry_id, event_id, athlete_ids, status, final_ms, overall_pos, data, finalized_at)
    values (
      p_race_id, v_entry_id, r.event_id,
      coalesce((select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(v_row->'athlete_ids', '[]'::jsonb)) as t(x)), '{}'::uuid[]),
      v_row->>'status', nullif(v_row->>'final_ms', '')::bigint, nullif(v_row->>'overall_pos', '')::int,
      coalesce(v_row->'data', '{}'::jsonb), now()
    );
    v_count := v_count + 1;
  end loop;

  update public.races set finalized_at = now() where id = p_race_id returning finalized_at into v_finalized_at;

  return jsonb_build_object('finalized_at', v_finalized_at, 'count', v_count);
end $$;

create or replace function public.admin_unfinalize_race(p_race_id uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_n int;
begin
  perform public.assert_organizer();
  delete from public.results where race_id = p_race_id;
  update public.races set finalized_at = null where id = p_race_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Prova não encontrada' using errcode = 'P0001'; end if;
end $$;
