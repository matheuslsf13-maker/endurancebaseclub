-- Admin RPCs: athletes, import, athlete profile, entries (spec §6 "Organização").
-- Every public entry point below starts with assert_organizer() (from 0002).

-- 1. next_bib: next free numeric bib in an event, as text (max numeric bib + 1, or '1' if none).
create or replace function public.next_bib(p_event_id uuid) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select (coalesce(max(bib::int) filter (where bib ~ '^\d+$'), 0) + 1)::text
  from public.entries where event_id = p_event_id
$$;

-- 2. admin_list_athletes: every athlete plus participations/wins/podiums tallied from results.
create or replace function public.admin_list_athletes() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  return coalesce((
    select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'participations', (
        select count(*) from public.results r
        where a.id = any(r.athlete_ids) and r.status not in ('dns', 'not_started')
      ),
      'wins', (
        select count(*) from public.results r
        where a.id = any(r.athlete_ids) and r.overall_pos = 1
      ),
      'podiums', (
        select count(*) from public.results r
        where a.id = any(r.athlete_ids)
          and exists (
            select 1 from jsonb_array_elements(coalesce(r.data->'podiums', '[]'::jsonb)) p
            where (p->>'podium_pos')::int <= 3
          )
      )
    ) order by lower(a.name))
    from public.athletes a
  ), '[]'::jsonb);
end $$;

-- 3. admin_save_athlete: create/update; trims strings (empty -> null), lowercases email,
--    validates sex and birth_date.
create or replace function public.admin_save_athlete(p_athlete jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  is_insert boolean := (p_athlete->>'id') is null;
  v_id uuid;
  v_existing public.athletes;
  v_name text;
  v_sex text;
  v_birth_date date;
  v_email text;
  v_phone text;
  v_city text;
  v_team_club text;
  v_notes text;
  v_public_profile boolean;
  a public.athletes;
begin
  perform public.assert_organizer();

  if is_insert then
    v_id := gen_random_uuid();
  else
    v_id := (p_athlete->>'id')::uuid;
    select * into v_existing from public.athletes where id = v_id;
    if not found then raise exception 'Atleta não encontrado' using errcode = 'P0001'; end if;
  end if;

  if p_athlete ? 'name' then
    v_name := btrim(p_athlete->>'name');
  elsif not is_insert then
    v_name := v_existing.name;
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'Informe o nome do atleta' using errcode = 'P0001';
  end if;

  if p_athlete ? 'sex' then
    v_sex := p_athlete->>'sex';
  elsif not is_insert then
    v_sex := v_existing.sex;
  end if;
  if v_sex is null or v_sex not in ('M', 'F') then
    raise exception 'Sexo inválido' using errcode = 'P0001';
  end if;

  if p_athlete ? 'birth_date' then
    v_birth_date := nullif(p_athlete->>'birth_date', '')::date;
  elsif is_insert then
    v_birth_date := null;
  else
    v_birth_date := v_existing.birth_date;
  end if;
  if v_birth_date is not null and v_birth_date > current_date then
    raise exception 'A data de nascimento não pode ser no futuro' using errcode = 'P0001';
  end if;
  if v_birth_date is not null and extract(year from v_birth_date) < 1900 then
    raise exception 'Data de nascimento inválida' using errcode = 'P0001';
  end if;

  if p_athlete ? 'email' then
    v_email := lower(nullif(btrim(p_athlete->>'email'), ''));
  elsif is_insert then
    v_email := null;
  else
    v_email := v_existing.email;
  end if;

  if p_athlete ? 'phone' then
    v_phone := nullif(btrim(p_athlete->>'phone'), '');
  elsif is_insert then
    v_phone := null;
  else
    v_phone := v_existing.phone;
  end if;

  if p_athlete ? 'city' then
    v_city := nullif(btrim(p_athlete->>'city'), '');
  elsif is_insert then
    v_city := null;
  else
    v_city := v_existing.city;
  end if;

  if p_athlete ? 'team_club' then
    v_team_club := nullif(btrim(p_athlete->>'team_club'), '');
  elsif is_insert then
    v_team_club := null;
  else
    v_team_club := v_existing.team_club;
  end if;

  if p_athlete ? 'notes' then
    v_notes := coalesce(p_athlete->>'notes', '');
  elsif is_insert then
    v_notes := '';
  else
    v_notes := v_existing.notes;
  end if;

  if p_athlete ? 'public_profile' then
    v_public_profile := (p_athlete->>'public_profile')::boolean;
  elsif is_insert then
    v_public_profile := true;
  else
    v_public_profile := v_existing.public_profile;
  end if;

  if is_insert then
    insert into public.athletes (id, name, sex, birth_date, email, phone, city, team_club, notes, public_profile)
    values (v_id, v_name, v_sex, v_birth_date, v_email, v_phone, v_city, v_team_club, v_notes, v_public_profile)
    returning * into a;
  else
    update public.athletes set
      name = v_name, sex = v_sex, birth_date = v_birth_date, email = v_email, phone = v_phone,
      city = v_city, team_club = v_team_club, notes = v_notes, public_profile = v_public_profile
    where id = v_id
    returning * into a;
  end if;

  return to_jsonb(a);
end $$;

-- 4. admin_delete_athlete: refuses while the athlete still has entries.
create or replace function public.admin_delete_athlete(p_athlete_id uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  if exists (select 1 from public.entry_members m where m.athlete_id = p_athlete_id) then
    raise exception 'Atleta tem inscrições; remova-as antes de excluir' using errcode = 'P0001';
  end if;
  delete from public.athletes where id = p_athlete_id;
end $$;

-- 5. admin_import_athletes: per row (1-based), soft-validate name/sex (bad rows become error
--    entries and processing continues); match existing athlete by email or by name+birth_date;
--    update non-null incoming fields or insert; optionally enter the athlete in a matching
--    individual race of p_event_id. A row's own unexpected error is also reported, not raised.
create or replace function public.admin_import_athletes(p_event_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_rowrec record;
  v_row jsonb;
  v_idx int;
  v_inserted int := 0;
  v_updated int := 0;
  v_entries_created int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_name text;
  v_sex text;
  v_birth_date date;
  v_email text;
  v_phone text;
  v_city text;
  v_team_club text;
  v_race_name text;
  v_athlete_id uuid;
  v_race public.races;
  v_entry_id uuid;
  v_bib text;
  v_wave_id uuid;
  v_legs int[];
begin
  perform public.assert_organizer();

  for v_rowrec in
    select el, ord::int as idx from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(el, ord)
  loop
    v_row := v_rowrec.el;
    v_idx := v_rowrec.idx;
    begin
      v_name := btrim(coalesce(v_row->>'name', ''));
      v_sex := v_row->>'sex';
      if length(v_name) = 0 then
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'message', 'Informe o nome do atleta');
        continue;
      end if;
      if v_sex is null or v_sex not in ('M', 'F') then
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'message', 'Sexo inválido');
        continue;
      end if;

      v_birth_date := nullif(v_row->>'birth_date', '')::date;
      v_email := lower(nullif(btrim(v_row->>'email'), ''));
      v_phone := nullif(btrim(v_row->>'phone'), '');
      v_city := nullif(btrim(v_row->>'city'), '');
      v_team_club := nullif(btrim(v_row->>'team_club'), '');
      v_race_name := nullif(btrim(v_row->>'race_name'), '');

      v_athlete_id := null;
      if v_email is not null then
        select a.id into v_athlete_id from public.athletes a where lower(a.email) = v_email limit 1;
      else
        select a.id into v_athlete_id from public.athletes a
        where lower(btrim(a.name)) = lower(v_name) and a.birth_date is not distinct from v_birth_date
        limit 1;
      end if;

      if v_athlete_id is not null then
        update public.athletes set
          name = v_name,
          sex = v_sex,
          birth_date = coalesce(v_birth_date, birth_date),
          email = coalesce(v_email, email),
          phone = coalesce(v_phone, phone),
          city = coalesce(v_city, city),
          team_club = coalesce(v_team_club, team_club)
        where id = v_athlete_id;
        v_updated := v_updated + 1;
      else
        insert into public.athletes (name, sex, birth_date, email, phone, city, team_club)
        values (v_name, v_sex, v_birth_date, v_email, v_phone, v_city, v_team_club)
        returning id into v_athlete_id;
        v_inserted := v_inserted + 1;
      end if;

      if p_event_id is not null and v_race_name is not null then
        select * into v_race from public.races r where r.event_id = p_event_id and lower(btrim(r.name)) = lower(v_race_name);
        if not found then
          v_errors := v_errors || jsonb_build_object('row', v_idx, 'message', format('Prova "%s" não encontrada', v_race_name));
        elsif v_race.team_size > 1 then
          v_errors := v_errors || jsonb_build_object('row', v_idx, 'message',
            format('Prova "%s" é por equipes; inscreva pela tela de inscrições', v_race_name));
        elsif not exists (
          select 1 from public.entry_members m join public.entries e on e.id = m.entry_id
          where m.athlete_id = v_athlete_id and e.race_id = v_race.id
        ) then
          select w.id into v_wave_id from public.waves w where w.race_id = v_race.id order by w.position limit 1;
          select array_agg(g) into v_legs from generate_series(0, jsonb_array_length(v_race.legs) - 1) as g;
          v_bib := public.next_bib(p_event_id);
          v_entry_id := gen_random_uuid();
          insert into public.entries (id, event_id, race_id, wave_id, bib)
          values (v_entry_id, p_event_id, v_race.id, v_wave_id, v_bib);
          insert into public.entry_members (entry_id, athlete_id, position, legs)
          values (v_entry_id, v_athlete_id, 0, v_legs);
          v_entries_created := v_entries_created + 1;
        end if;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'entries_created', v_entries_created, 'errors', v_errors);
end $$;

-- 6. admin_athlete_profile: the athlete plus every result they were part of, newest event first.
create or replace function public.admin_athlete_profile(p_athlete_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare a public.athletes;
begin
  perform public.assert_organizer();
  select * into a from public.athletes where id = p_athlete_id;
  if not found then raise exception 'Atleta não encontrado' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'athlete', to_jsonb(a),
    'results', coalesce((
      select jsonb_agg(to_jsonb(r) order by (r.data->'event'->>'date') desc)
      from public.results r where p_athlete_id = any(r.athlete_ids)
    ), '[]'::jsonb)
  );
end $$;

-- 7. admin_save_entry: create/update an entry. See spec §6 for the full rule list; order below
--    matches it: race -> bib -> members/legs -> athlete dedup -> level/team_name -> wave -> persist.
create or replace function public.admin_save_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  is_insert boolean := (p_entry->>'id') is null;
  v_entry_id uuid;
  v_existing public.entries;
  v_race_id uuid;
  v_race public.races;
  v_event_id uuid;
  v_event_levels text[];
  v_bib text;
  v_team_name text;
  v_level text;
  v_notes text;
  v_wave_id uuid;
  v_members jsonb;
  v_leg_count int;
  v_all_legs int[];
  v_assigned_legs int[] := '{}';
  v_computed_members jsonb := '[]'::jsonb;
  v_athlete_ids uuid[] := '{}';
  v_athlete_id uuid;
  v_member jsonb;
  v_member_legs int[];
  v_legs_payload jsonb;
  v_leg int;
  v_pos int;
  v_mrow record;
  v_dup_name text;
  en public.entries;
begin
  perform public.assert_organizer();

  -- 1. race must exist; event_id derives from it; block changing race once marks exist.
  v_race_id := nullif(p_entry->>'race_id', '')::uuid;
  select * into v_race from public.races where id = v_race_id;
  if not found then raise exception 'Prova não encontrada' using errcode = 'P0001'; end if;
  v_event_id := v_race.event_id;
  v_leg_count := jsonb_array_length(v_race.legs);
  select array_agg(g) into v_all_legs from generate_series(0, v_leg_count - 1) as g;

  if is_insert then
    v_entry_id := gen_random_uuid();
  else
    v_entry_id := (p_entry->>'id')::uuid;
    select * into v_existing from public.entries where id = v_entry_id;
    if not found then raise exception 'Inscrição não encontrada' using errcode = 'P0001'; end if;
    if v_race_id <> v_existing.race_id and exists (
      select 1 from public.marks m where m.entry_id = v_entry_id and not m.discarded
    ) then
      raise exception 'Não é possível trocar a prova de uma inscrição com marcações' using errcode = 'P0001';
    end if;
  end if;

  -- 2. bib: trim or assign the next free one; must be unique in the event.
  if p_entry ? 'bib' then
    v_bib := nullif(btrim(p_entry->>'bib'), '');
  elsif not is_insert then
    v_bib := v_existing.bib;
  end if;
  if v_bib is null then
    v_bib := public.next_bib(v_event_id);
  end if;
  if exists (select 1 from public.entries e where e.event_id = v_event_id and e.bib = v_bib and e.id <> v_entry_id) then
    raise exception 'Nº de peito % já está em uso neste evento', v_bib using errcode = 'P0001';
  end if;

  -- 3. members: exactly team_size distinct existing athletes. Individual races assign every leg
  --    to the lone member (payload legs are ignored); team races need each leg 0..N-1 assigned to
  --    exactly one member. Position mirrors payload order.
  v_members := coalesce(p_entry->'members', '[]'::jsonb);
  if jsonb_typeof(v_members) <> 'array' then
    raise exception 'A prova exige % atleta(s)', v_race.team_size using errcode = 'P0001';
  end if;

  for v_mrow in select el, (ord - 1)::int as pos from jsonb_array_elements(v_members) with ordinality as t(el, ord) loop
    v_member := v_mrow.el;
    v_pos := v_mrow.pos;
    v_athlete_id := nullif(v_member->>'athlete_id', '')::uuid;
    if v_athlete_id is null or not exists (select 1 from public.athletes a where a.id = v_athlete_id) then
      raise exception 'Atleta inválido' using errcode = 'P0001';
    end if;
    if v_athlete_id = any(v_athlete_ids) then
      raise exception 'A prova exige % atleta(s)', v_race.team_size using errcode = 'P0001';
    end if;
    v_athlete_ids := v_athlete_ids || v_athlete_id;

    if v_race.team_size = 1 then
      v_member_legs := v_all_legs;
    else
      v_legs_payload := case when jsonb_typeof(v_member->'legs') = 'array' then v_member->'legs' else '[]'::jsonb end;
      select coalesce(array_agg((x)::int), '{}'::int[]) into v_member_legs from jsonb_array_elements_text(v_legs_payload) as t(x);
      foreach v_leg in array v_member_legs loop
        if v_leg < 0 or v_leg >= v_leg_count then
          raise exception 'Cada perna precisa de exatamente um atleta' using errcode = 'P0001';
        end if;
        if v_leg = any(v_assigned_legs) then
          raise exception 'Cada perna precisa de exatamente um atleta' using errcode = 'P0001';
        end if;
        v_assigned_legs := v_assigned_legs || v_leg;
      end loop;
    end if;

    v_computed_members := v_computed_members || jsonb_build_array(jsonb_build_object(
      'athlete_id', v_athlete_id, 'position', v_pos, 'legs', to_jsonb(v_member_legs)
    ));
  end loop;

  if array_length(v_athlete_ids, 1) is distinct from v_race.team_size then
    raise exception 'A prova exige % atleta(s)', v_race.team_size using errcode = 'P0001';
  end if;
  if v_race.team_size > 1 and array_length(v_assigned_legs, 1) is distinct from v_leg_count then
    raise exception 'Cada perna precisa de exatamente um atleta' using errcode = 'P0001';
  end if;

  -- 4. no athlete may already be in another entry of the same race.
  select a.name into v_dup_name
  from unnest(v_athlete_ids) as t(aid)
  join public.entry_members m on m.athlete_id = t.aid
  join public.entries e on e.id = m.entry_id
  join public.athletes a on a.id = t.aid
  where e.race_id = v_race_id and e.id <> v_entry_id
  limit 1;
  if v_dup_name is not null then
    raise exception '% já está inscrito nesta prova', v_dup_name using errcode = 'P0001';
  end if;

  -- 5. level must be one of the event's levels (or null); team_name required for team races.
  if p_entry ? 'level' then
    v_level := nullif(btrim(p_entry->>'level'), '');
  elsif not is_insert then
    v_level := v_existing.level;
  end if;
  select ev.levels into v_event_levels from public.events ev where ev.id = v_event_id;
  if v_level is not null and not (v_level = any(v_event_levels)) then
    raise exception 'Nível inválido' using errcode = 'P0001';
  end if;

  if p_entry ? 'team_name' then
    v_team_name := nullif(btrim(p_entry->>'team_name'), '');
  elsif not is_insert then
    v_team_name := v_existing.team_name;
  end if;
  if v_race.team_size > 1 and v_team_name is null then
    raise exception 'Informe o nome da equipe' using errcode = 'P0001';
  end if;

  if p_entry ? 'notes' then
    v_notes := coalesce(p_entry->>'notes', '');
  elsif is_insert then
    v_notes := '';
  else
    v_notes := v_existing.notes;
  end if;

  -- 6. wave_id must belong to the race; default = first wave by position. A stale wave from a
  --    race that just changed (rule 1 allows that when there are no marks) is not reused.
  if p_entry ? 'wave_id' then
    v_wave_id := nullif(p_entry->>'wave_id', '')::uuid;
  elsif not is_insert and v_race_id = v_existing.race_id then
    v_wave_id := v_existing.wave_id;
  end if;
  if v_wave_id is not null and not exists (select 1 from public.waves w where w.id = v_wave_id and w.race_id = v_race_id) then
    raise exception 'Onda inválida' using errcode = 'P0001';
  end if;
  if v_wave_id is null then
    select w.id into v_wave_id from public.waves w where w.race_id = v_race_id order by w.position limit 1;
  end if;

  -- 7. persist entry + replace entry_members.
  if is_insert then
    insert into public.entries (id, event_id, race_id, wave_id, bib, team_name, level, notes)
    values (v_entry_id, v_event_id, v_race_id, v_wave_id, v_bib, v_team_name, v_level, v_notes)
    returning * into en;
  else
    update public.entries set
      event_id = v_event_id, race_id = v_race_id, wave_id = v_wave_id, bib = v_bib,
      team_name = v_team_name, level = v_level, notes = v_notes
    where id = v_entry_id
    returning * into en;
  end if;

  delete from public.entry_members where entry_id = v_entry_id;
  insert into public.entry_members (entry_id, athlete_id, position, legs)
  select v_entry_id, (m->>'athlete_id')::uuid, (m->>'position')::int,
         (select coalesce(array_agg((x)::int), '{}'::int[]) from jsonb_array_elements_text(m->'legs') as t(x))
  from jsonb_array_elements(v_computed_members) as t(m);

  return public.entry_json(v_entry_id, true);
end $$;

-- 8. admin_bulk_create_entries: individual races only; sequential bibs; skips already-entered athletes.
create or replace function public.admin_bulk_create_entries(p_race_id uuid, p_athlete_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_race public.races;
  v_wave_id uuid;
  v_legs int[];
  v_athlete_id uuid;
  v_entry_id uuid;
  v_bib text;
  v_created uuid[] := '{}';
begin
  perform public.assert_organizer();
  select * into v_race from public.races where id = p_race_id;
  if not found then raise exception 'Prova não encontrada' using errcode = 'P0001'; end if;
  if v_race.team_size <> 1 then
    raise exception 'Inscrição em lote só para provas individuais' using errcode = 'P0001';
  end if;

  select w.id into v_wave_id from public.waves w where w.race_id = p_race_id order by w.position limit 1;
  select array_agg(g) into v_legs from generate_series(0, jsonb_array_length(v_race.legs) - 1) as g;

  foreach v_athlete_id in array coalesce(p_athlete_ids, '{}'::uuid[]) loop
    if exists (
      select 1 from public.entry_members m join public.entries e on e.id = m.entry_id
      where m.athlete_id = v_athlete_id and e.race_id = p_race_id
    ) then
      continue;
    end if;

    v_bib := public.next_bib(v_race.event_id);
    v_entry_id := gen_random_uuid();
    insert into public.entries (id, event_id, race_id, wave_id, bib)
    values (v_entry_id, v_race.event_id, p_race_id, v_wave_id, v_bib);
    insert into public.entry_members (entry_id, athlete_id, position, legs)
    values (v_entry_id, v_athlete_id, 0, v_legs);
    v_created := v_created || v_entry_id;
  end loop;

  return coalesce((
    select jsonb_agg(public.entry_json(x, true) order by ord)
    from unnest(v_created) with ordinality as t(x, ord)
  ), '[]'::jsonb);
end $$;

-- 9. admin_update_entry_status
create or replace function public.admin_update_entry_status(p_entry_id uuid, p_status text, p_penalty_ms int, p_notes text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  if p_status is null or p_status not in ('ok', 'dns', 'dnf', 'dsq') then
    raise exception 'Status inválido' using errcode = 'P0001';
  end if;
  if p_penalty_ms is null or p_penalty_ms < 0 then
    raise exception 'A penalidade não pode ser negativa' using errcode = 'P0001';
  end if;
  update public.entries set status = p_status, penalty_ms = p_penalty_ms, notes = coalesce(p_notes, '')
  where id = p_entry_id;
  if not found then raise exception 'Inscrição não encontrada' using errcode = 'P0001'; end if;
  return public.entry_json(p_entry_id, true);
end $$;

-- 10. admin_delete_entry: marks referencing the entry become unassigned via FK (on delete set null).
create or replace function public.admin_delete_entry(p_entry_id uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  delete from public.entries where id = p_entry_id;
end $$;
