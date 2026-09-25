-- Admin RPCs: organizers, events, races, waves (spec §6 "Organização").
-- Every public entry point below starts with assert_organizer()/assert_owner() (from 0002).

-- 1. entry_json: shared projection of one entry row used by admin/tk/pub endpoints.
create or replace function public.entry_json(p_entry_id uuid, p_with_names boolean default false) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select to_jsonb(e) || jsonb_build_object('members', coalesce((
    select jsonb_agg(jsonb_build_object('athlete_id', m.athlete_id, 'position', m.position, 'legs', to_jsonb(m.legs))
                     || case when p_with_names then jsonb_build_object('name', a.name) else '{}'::jsonb end
                     order by m.position)
    from public.entry_members m join public.athletes a on a.id = m.athlete_id
    where m.entry_id = e.id), '[]'::jsonb))
  from public.entries e where e.id = p_entry_id
$$;

-- 2. next_unique_public_slug: p_base with -2, -3, ... appended until no other event has it.
create or replace function public.next_unique_public_slug(p_base text, p_exclude_id uuid default null) returns text
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v_candidate text := p_base; v_n int := 1;
begin
  while exists (
    select 1 from public.events e
    where e.public_slug = v_candidate and (p_exclude_id is null or e.id <> p_exclude_id)
  ) loop
    v_n := v_n + 1;
    v_candidate := p_base || '-' || v_n;
  end loop;
  return v_candidate;
end $$;

-- 3. validate_race_config: raises P0001 on the first invalid field of an already-merged RaceConfig.
create or replace function public.validate_race_config(p_config jsonb, p_event_id uuid) returns void
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_rk jsonb; v_ag jsonb;
  v_ids text[] := '{}'; v_id text;
  v_prev_max numeric; v_min numeric; v_max numeric; v_first boolean := true;
  v_ref_tk uuid;
begin
  if (p_config->>'age_rule') is null or (p_config->>'age_rule') not in ('year_end', 'event_date') then
    raise exception 'Regra de idade inválida' using errcode = 'P0001';
  end if;
  if (p_config->>'team_age_rule') is null or (p_config->>'team_age_rule') not in ('sum', 'oldest', 'youngest') then
    raise exception 'Regra de idade da equipe inválida' using errcode = 'P0001';
  end if;
  if (p_config->>'time_source') is null or (p_config->>'time_source') not in ('median', 'reference') then
    raise exception 'Fonte de tempo inválida' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_config->'cumulative') <> 'boolean' then
    raise exception 'Premiação cumulativa inválida' using errcode = 'P0001';
  end if;
  if (p_config->>'same_crossing_window_s') is null or (p_config->>'same_crossing_window_s')::numeric not between 1 and 600 then
    raise exception 'A janela de mesma passagem deve ser entre 1 e 600 segundos' using errcode = 'P0001';
  end if;
  if (p_config->>'divergence_threshold_s') is null or (p_config->>'divergence_threshold_s')::numeric not between 0.1 and 600 then
    raise exception 'O limite de divergência deve ser entre 0,1 e 600 segundos' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_config->'rankings', '[]'::jsonb)) <> 'array' then
    raise exception 'Rankings inválidos' using errcode = 'P0001';
  end if;
  for v_rk in select el from jsonb_array_elements(coalesce(p_config->'rankings', '[]'::jsonb)) as t(el) loop
    v_id := btrim(coalesce(v_rk->>'id', ''));
    if length(v_id) = 0 then
      raise exception 'Todo ranking precisa de um identificador' using errcode = 'P0001';
    end if;
    if v_id = any(v_ids) then
      raise exception 'Identificadores de ranking duplicados' using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_id;
    if length(btrim(coalesce(v_rk->>'name', ''))) = 0 then
      raise exception 'Todo ranking precisa de um nome' using errcode = 'P0001';
    end if;
    if jsonb_typeof(coalesce(v_rk->'dims', 'null'::jsonb)) <> 'array' or jsonb_array_length(v_rk->'dims') = 0 then
      raise exception 'Todo ranking precisa de ao menos uma dimensão' using errcode = 'P0001';
    end if;
    if exists (select 1 from jsonb_array_elements_text(v_rk->'dims') as d(val) where d.val not in ('sex', 'age', 'level')) then
      raise exception 'Dimensão de ranking inválida' using errcode = 'P0001';
    end if;
    if (select count(*) from jsonb_array_elements_text(v_rk->'dims') as d(val))
       <> (select count(distinct d.val) from jsonb_array_elements_text(v_rk->'dims') as d(val)) then
      raise exception 'Dimensões de ranking repetidas' using errcode = 'P0001';
    end if;
    if (v_rk->>'size') is null or not ((v_rk->>'size')::int between 1 and 10) then
      raise exception 'O tamanho do pódio deve ser entre 1 e 10' using errcode = 'P0001';
    end if;
  end loop;

  if jsonb_typeof(coalesce(p_config->'age_groups', '[]'::jsonb)) <> 'array' then
    raise exception 'Faixas etárias inválidas' using errcode = 'P0001';
  end if;
  v_prev_max := null; v_first := true;
  for v_ag in select el from jsonb_array_elements(coalesce(p_config->'age_groups', '[]'::jsonb)) as t(el)
              order by (el->>'min')::numeric loop
    v_min := (v_ag->>'min')::numeric;
    v_max := nullif(v_ag->>'max', '')::numeric;
    if v_min is null or v_min < 0 then
      raise exception 'A idade mínima da faixa deve ser maior ou igual a zero' using errcode = 'P0001';
    end if;
    if v_max is not null and v_max < v_min then
      raise exception 'A idade máxima da faixa deve ser maior ou igual à mínima' using errcode = 'P0001';
    end if;
    if not v_first and (v_prev_max is null or v_min <= v_prev_max) then
      raise exception 'Faixas etárias não podem se sobrepor' using errcode = 'P0001';
    end if;
    v_prev_max := v_max;
    v_first := false;
  end loop;

  if (p_config ? 'reference_timekeeper_id') and (p_config->>'reference_timekeeper_id') is not null then
    v_ref_tk := (p_config->>'reference_timekeeper_id')::uuid;
    if not exists (select 1 from public.timekeepers t where t.id = v_ref_tk and t.event_id = p_event_id) then
      raise exception 'Cronometrista de referência inválido' using errcode = 'P0001';
    end if;
  end if;
end $$;

-- 4. admin_me / admin_password_changed
create or replace function public.admin_me() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers := public.assert_organizer();
begin
  return jsonb_build_object('user_id', o.user_id, 'email', o.email, 'name', o.name, 'role', o.role,
                            'must_change_password', o.must_change_password);
end $$;

create or replace function public.admin_password_changed() returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers := public.assert_organizer();
begin
  update public.organizers set must_change_password = false where user_id = o.user_id;
end $$;

-- 5. Organizers
create or replace function public.admin_list_organizers() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', x.user_id, 'email', x.email, 'name', x.name, 'role', x.role, 'created_at', x.created_at
    ) order by x.created_at)
    from public.organizers x
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_create_organizer(p_email text, p_password text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_id uuid; o public.organizers;
begin
  perform public.assert_owner();
  v_id := public.internal_create_auth_user(p_email, p_password);
  insert into public.organizers (user_id, email, name, role, must_change_password)
  values (v_id, lower(btrim(p_email)), coalesce(btrim(p_name), ''), 'admin', true)
  returning * into o;
  return jsonb_build_object('user_id', o.user_id, 'email', o.email, 'name', o.name, 'role', o.role, 'created_at', o.created_at);
end $$;

create or replace function public.admin_delete_organizer(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers := public.assert_owner();
begin
  if p_user_id = o.user_id then
    raise exception 'Você não pode remover a si mesma' using errcode = 'P0001';
  end if;
  delete from auth.users where id = p_user_id;
end $$;

-- 6. Events
create or replace function public.admin_list_events() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  return coalesce((
    select jsonb_agg(
      to_jsonb(e) || jsonb_build_object(
        'races_count', (select count(*) from public.races r where r.event_id = e.id),
        'entries_count', (select count(*) from public.entries en where en.event_id = e.id)
      ) order by e.date desc
    )
    from public.events e
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_get_event(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events;
begin
  perform public.assert_organizer();
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Evento não encontrado' using errcode = 'P0001'; end if;

  return jsonb_build_object(
    'event', to_jsonb(ev),
    'races', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.position, r.name)
      from public.races r where r.event_id = ev.id
    ), '[]'::jsonb),
    'waves', coalesce((
      select jsonb_agg(to_jsonb(w) order by r.position, r.name, w.position)
      from public.waves w join public.races r on r.id = w.race_id
      where r.event_id = ev.id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(public.entry_json(en.id, false)
                        order by case when en.bib ~ '^\d+$' then lpad(en.bib, 20, '0') else en.bib end)
      from public.entries en where en.event_id = ev.id
    ), '[]'::jsonb),
    'athletes', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'id', a.id, 'name', a.name, 'sex', a.sex, 'birth_date', a.birth_date,
        'team_club', a.team_club, 'city', a.city, 'public_profile', a.public_profile
      ))
      from public.athletes a
      join public.entry_members m on m.athlete_id = a.id
      join public.entries en on en.id = m.entry_id
      where en.event_id = ev.id
    ), '[]'::jsonb),
    'timekeepers', coalesce((
      select jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'marks_count', (select count(*) from public.marks mk where mk.timekeeper_id = t.id and mk.event_id = ev.id)
      ))
      from public.timekeepers t where t.event_id = ev.id
    ), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(to_jsonb(mk) order by mk.ts)
      from public.marks mk where mk.event_id = ev.id
    ), '[]'::jsonb),
    'resolutions', coalesce((
      select jsonb_agg(to_jsonb(res)) from public.resolutions res where res.event_id = ev.id
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(to_jsonb(res)) from public.results res where res.event_id = ev.id
    ), '[]'::jsonb),
    'version', ev.version,
    'server_now', now()
  );
end $$;

create or replace function public.admin_save_event(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  is_insert boolean := (p_event->>'id') is null;
  v_id uuid;
  v_existing public.events;
  v_name text;
  v_date date;
  v_location text;
  v_description text;
  v_levels text[];
  v_status text;
  v_is_public boolean;
  v_tk_enabled boolean;
  v_slug text;
  ev public.events;
begin
  perform public.assert_organizer();

  if is_insert then
    v_id := gen_random_uuid();
  else
    v_id := (p_event->>'id')::uuid;
    select * into v_existing from public.events where id = v_id;
    if not found then raise exception 'Evento não encontrado' using errcode = 'P0001'; end if;
  end if;

  if p_event ? 'name' then
    v_name := btrim(p_event->>'name');
  elsif not is_insert then
    v_name := v_existing.name;
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'Informe o nome do evento' using errcode = 'P0001';
  end if;

  if p_event ? 'date' then
    v_date := (p_event->>'date')::date;
  elsif not is_insert then
    v_date := v_existing.date;
  end if;
  if v_date is null then
    raise exception 'Informe a data do evento' using errcode = 'P0001';
  end if;

  if p_event ? 'location' then
    v_location := coalesce(p_event->>'location', '');
  elsif is_insert then
    v_location := '';
  else
    v_location := v_existing.location;
  end if;

  if p_event ? 'description' then
    v_description := coalesce(p_event->>'description', '');
  elsif is_insert then
    v_description := '';
  else
    v_description := v_existing.description;
  end if;

  if p_event ? 'levels' then
    if jsonb_typeof(p_event->'levels') <> 'array' then
      raise exception 'Níveis inválidos' using errcode = 'P0001';
    end if;
    v_levels := coalesce((select array_agg(btrim(t.val)) from jsonb_array_elements_text(p_event->'levels') as t(val)), '{}'::text[]);
  elsif is_insert then
    v_levels := '{}'::text[];
  else
    v_levels := v_existing.levels;
  end if;
  if exists (select 1 from unnest(v_levels) as l(val) where length(l.val) = 0) then
    raise exception 'Os níveis não podem ser vazios' using errcode = 'P0001';
  end if;
  if (select count(*) from unnest(v_levels) as l(val)) <> (select count(distinct l.val) from unnest(v_levels) as l(val)) then
    raise exception 'Não pode haver níveis repetidos' using errcode = 'P0001';
  end if;

  if p_event ? 'status' then
    v_status := p_event->>'status';
  elsif is_insert then
    v_status := 'planejado';
  else
    v_status := v_existing.status;
  end if;
  if v_status not in ('planejado', 'ao_vivo', 'encerrado') then
    raise exception 'Status inválido' using errcode = 'P0001';
  end if;

  if p_event ? 'is_public' then
    v_is_public := (p_event->>'is_public')::boolean;
  elsif is_insert then
    v_is_public := false;
  else
    v_is_public := v_existing.is_public;
  end if;

  if p_event ? 'tk_enabled' then
    v_tk_enabled := (p_event->>'tk_enabled')::boolean;
  elsif is_insert then
    v_tk_enabled := true;
  else
    v_tk_enabled := v_existing.tk_enabled;
  end if;

  if is_insert then
    v_slug := public.next_unique_public_slug(public.slugify(v_name || '-' || v_date::text));
  else
    if p_event ? 'public_slug' then
      v_slug := nullif(btrim(p_event->>'public_slug'), '');
    else
      v_slug := v_existing.public_slug;
    end if;
    if v_slug is null and v_is_public then
      v_slug := public.next_unique_public_slug(public.slugify(v_name || '-' || v_date::text), v_id);
    end if;
  end if;

  if v_slug is not null then
    if v_slug !~ '^[a-z0-9-]{3,80}$' then
      raise exception 'Endereço público inválido' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.events e where e.public_slug = v_slug and e.id <> v_id) then
      raise exception 'Endereço público já em uso' using errcode = 'P0001';
    end if;
  end if;

  -- The exists-check above closes the common case; this catch is only a backstop for a
  -- concurrent insert/update racing between that check and this statement (TOCTOU), so the
  -- unique constraint still surfaces as the pt-BR P0001 message, not a raw 23505.
  if is_insert then
    begin
      insert into public.events (id, name, date, location, description, levels, status, is_public, public_slug, tk_enabled)
      values (v_id, v_name, v_date, v_location, v_description, v_levels, v_status, v_is_public, v_slug, v_tk_enabled)
      returning * into ev;
    exception when unique_violation then
      raise exception 'Endereço público já em uso' using errcode = 'P0001';
    end;
  else
    begin
      update public.events set
        name = v_name, date = v_date, location = v_location, description = v_description,
        levels = v_levels, status = v_status, is_public = v_is_public, public_slug = v_slug, tk_enabled = v_tk_enabled
      where id = v_id
      returning * into ev;
    exception when unique_violation then
      raise exception 'Endereço público já em uso' using errcode = 'P0001';
    end;
  end if;

  return to_jsonb(ev);
end $$;

create or replace function public.admin_delete_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  delete from public.events where id = p_event_id;
end $$;

create or replace function public.admin_duplicate_event(p_event_id uuid, p_name text, p_date date) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  src public.events;
  v_new_id uuid;
  v_new_race_id uuid;
  v_name text := btrim(p_name);
  r record;
begin
  perform public.assert_organizer();
  select * into src from public.events where id = p_event_id;
  if not found then raise exception 'Evento não encontrado' using errcode = 'P0001'; end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'Informe o nome do evento' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'Informe a data do evento' using errcode = 'P0001';
  end if;

  insert into public.events (name, date, location, description, levels, status, is_public)
  values (v_name, p_date, src.location, src.description, src.levels, 'planejado', false)
  returning id into v_new_id;

  for r in select * from public.races where event_id = p_event_id order by position, name loop
    insert into public.races (event_id, name, position, team_size, legs, config, finalized_at)
    values (v_new_id, r.name, r.position, r.team_size, r.legs, r.config, null)
    returning id into v_new_race_id;

    insert into public.waves (race_id, name, position, start_at)
    select v_new_race_id, w.name, w.position, null from public.waves w where w.race_id = r.id order by w.position;
  end loop;

  return v_new_id;
end $$;

create or replace function public.admin_rotate_tk_token(p_event_id uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_token text := public.random_token(24); v_n int;
begin
  perform public.assert_organizer();
  update public.events set tk_token = v_token where id = p_event_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Evento não encontrado' using errcode = 'P0001'; end if;
  return v_token;
end $$;

-- 7. Races and waves
create or replace function public.admin_save_race(p_race jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  is_insert boolean := (p_race->>'id') is null;
  v_race_id uuid;
  v_existing public.races;
  v_event_id uuid;
  v_name text;
  v_team_size int;
  v_legs jsonb;
  v_config jsonb;
  v_position int;
  v_leg jsonb;
  v_modality text;
  v_dist_present boolean;
  v_dist_val numeric;
  v_locked boolean;
  ev_race public.races;
  v_wave jsonb;
  v_wave_id uuid;
  v_keep_ids uuid[] := '{}';
  v_process_waves boolean;
begin
  perform public.assert_organizer();

  v_event_id := nullif(p_race->>'event_id', '')::uuid;
  if v_event_id is null or not exists (select 1 from public.events e where e.id = v_event_id) then
    raise exception 'Evento não encontrado' using errcode = 'P0001';
  end if;

  if is_insert then
    v_race_id := gen_random_uuid();
  else
    v_race_id := (p_race->>'id')::uuid;
    select * into v_existing from public.races where id = v_race_id;
    if not found then raise exception 'Prova não encontrada' using errcode = 'P0001'; end if;
  end if;

  v_name := btrim(p_race->>'name');
  if v_name is null or length(v_name) = 0 then
    raise exception 'Informe o nome da prova' using errcode = 'P0001';
  end if;

  if p_race ? 'team_size' then
    v_team_size := (p_race->>'team_size')::int;
  elsif is_insert then
    v_team_size := 1;
  else
    v_team_size := v_existing.team_size;
  end if;
  if v_team_size is null or v_team_size not between 1 and 10 then
    raise exception 'O tamanho da equipe deve ser entre 1 e 10' using errcode = 'P0001';
  end if;

  v_legs := p_race->'legs';
  if v_legs is null or jsonb_typeof(v_legs) <> 'array' or jsonb_array_length(v_legs) < 1 then
    raise exception 'A prova precisa de ao menos uma perna' using errcode = 'P0001';
  end if;
  for v_leg in select el from jsonb_array_elements(v_legs) as t(el) loop
    v_modality := v_leg->>'modality';
    if v_modality is null or v_modality not in ('swim', 'bike', 'run', 'other') then
      raise exception 'Modalidade de perna inválida' using errcode = 'P0001';
    end if;
    if length(btrim(coalesce(v_leg->>'label', ''))) = 0 then
      raise exception 'Toda perna precisa de um nome' using errcode = 'P0001';
    end if;
    v_dist_present := (v_leg ? 'distance_m') and jsonb_typeof(v_leg->'distance_m') <> 'null';
    if v_dist_present then
      if jsonb_typeof(v_leg->'distance_m') <> 'number' then
        raise exception 'Distância da perna inválida' using errcode = 'P0001';
      end if;
      v_dist_val := (v_leg->>'distance_m')::numeric;
      if v_dist_val <= 0 then
        raise exception 'A distância da perna deve ser maior que zero' using errcode = 'P0001';
      end if;
    elsif v_modality <> 'other' then
      raise exception 'Informe a distância da perna' using errcode = 'P0001';
    end if;
  end loop;

  if p_race ? 'position' then
    v_position := (p_race->>'position')::int;
  elsif is_insert then
    select coalesce(max(position) + 1, 0) into v_position from public.races where event_id = v_event_id;
  else
    v_position := v_existing.position;
  end if;

  -- Ruling 14: on UPDATE, keep the organizer's stored customizations when the payload omits
  -- config (or only sends a partial one) -- defaults fill gaps, existing config wins over
  -- defaults, and an explicitly-sent field wins over the existing value.
  if is_insert then
    v_config := public.default_race_config(v_team_size) || coalesce(p_race->'config', '{}'::jsonb);
  else
    v_config := public.default_race_config(v_team_size) || v_existing.config || coalesce(p_race->'config', '{}'::jsonb);
  end if;
  perform public.validate_race_config(v_config, v_event_id);

  if not is_insert then
    v_locked := exists (
      select 1 from public.marks m join public.entries en on en.id = m.entry_id
      where en.race_id = v_race_id and not m.discarded
    );
    if v_locked and (
      jsonb_array_length(v_legs) <> jsonb_array_length(v_existing.legs)
      or v_team_size <> v_existing.team_size
      or (select jsonb_agg(x->>'modality' order by ord) from jsonb_array_elements(v_legs) with ordinality as t(x, ord))
         <> (select jsonb_agg(x->>'modality' order by ord) from jsonb_array_elements(v_existing.legs) with ordinality as t(x, ord))
    ) then
      raise exception 'Não é possível alterar pernas ou tamanho da equipe depois que há marcações' using errcode = 'P0001';
    end if;
  end if;

  if is_insert then
    insert into public.races (id, event_id, name, position, team_size, legs, config, finalized_at)
    values (v_race_id, v_event_id, v_name, v_position, v_team_size, v_legs, v_config, null)
    returning * into ev_race;
  else
    update public.races set
      event_id = v_event_id, name = v_name, position = v_position, team_size = v_team_size,
      legs = v_legs, config = v_config
    where id = v_race_id
    returning * into ev_race;
  end if;

  -- Ruling 12: on UPDATE, an ABSENT "waves" key -- or an explicit JSON null -- leaves existing
  -- waves (and their recorded start_at) completely untouched: skip the loop, the delete and the
  -- default-wave insert entirely. On INSERT, waves are always processed (absent/null/empty all
  -- fall through to the "no waves" -> default-wave case below). A present array upserts by id and
  -- deletes waves missing from it; if the race ends with zero waves, a default wave is created.
  v_process_waves := is_insert
    or ((p_race ? 'waves') and coalesce(jsonb_typeof(p_race->'waves'), 'null') <> 'null');

  if v_process_waves then
    -- Ruling 16: admin_save_race never changes start_at of an existing wave -- the upsert sets
    -- only race_id/name/position, and a newly inserted wave always starts with start_at null.
    -- Start times change exclusively via admin_set_wave_start.
    for v_wave in select el from jsonb_array_elements(coalesce(p_race->'waves', '[]'::jsonb)) as t(el) loop
      v_wave_id := coalesce(nullif(v_wave->>'id', '')::uuid, gen_random_uuid());
      insert into public.waves (id, race_id, name, position)
      values (
        v_wave_id, v_race_id,
        coalesce(nullif(btrim(v_wave->>'name'), ''), 'Largada geral'),
        coalesce((v_wave->>'position')::int, 0)
      )
      on conflict (id) do update set
        race_id = excluded.race_id, name = excluded.name, position = excluded.position;
      v_keep_ids := v_keep_ids || v_wave_id;
    end loop;

    delete from public.waves where race_id = v_race_id and not (id = any(v_keep_ids));

    if array_length(v_keep_ids, 1) is null then
      insert into public.waves (race_id) values (v_race_id);
    end if;
  end if;

  return jsonb_build_object(
    'race', to_jsonb(ev_race),
    'waves', coalesce((select jsonb_agg(to_jsonb(w) order by w.position) from public.waves w where w.race_id = v_race_id), '[]'::jsonb)
  );
end $$;

create or replace function public.admin_delete_race(p_race_id uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform public.assert_organizer();
  delete from public.races where id = p_race_id;
end $$;

create or replace function public.admin_set_wave_start(p_wave_id uuid, p_start_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare w public.waves;
begin
  perform public.assert_organizer();
  update public.waves set start_at = p_start_at where id = p_wave_id returning * into w;
  if not found then raise exception 'Onda não encontrada' using errcode = 'P0001'; end if;
  return to_jsonb(w);
end $$;
