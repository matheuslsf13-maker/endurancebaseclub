-- 0008: the overall podium. A ranking with no division ("dims": []) ranks everyone together --
-- spec §9 always allowed it and the domain already computes it (group "Geral"), but
-- validate_race_config refused an empty list, so the organizer could not save a race whose podium
-- is the plain overall one. New races now also come with it: "Geral" (everyone), then
-- "Geral por sexo", then "Faixa etária" for solo races; with cumulative off (the default) the
-- overall top places are not awarded again by sex or age group. Existing races keep their config.
-- Both functions are replaced whole (bodies otherwise identical to 0002/0003); neither is an RPC,
-- so no grant changes: create or replace keeps their (revoked) privileges.

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
    -- 0008: an empty list is the overall podium (spec §9: `[]` = geral absoluto).
    if jsonb_typeof(coalesce(v_rk->'dims', 'null'::jsonb)) <> 'array' then
      raise exception 'Dimensões de ranking inválidas' using errcode = 'P0001';
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

  -- A-I1: the reference timekeeper only matters (and is only validated) when the time source uses
  -- it; a stale id left behind after switching back to the median never blocks a save.
  if (p_config->>'time_source') = 'reference' and (p_config->>'reference_timekeeper_id') is not null then
    v_ref_tk := (p_config->>'reference_timekeeper_id')::uuid;
    if not exists (select 1 from public.timekeepers t where t.id = v_ref_tk and t.event_id = p_event_id) then
      raise exception 'Cronometrista de referência inválido' using errcode = 'P0001';
    end if;
  end if;
end $$;

create or replace function public.default_race_config(p_team_size int) returns jsonb
language sql immutable set search_path = public, extensions, pg_temp as $$
  select case when p_team_size > 1 then
    jsonb_build_object(
      'age_rule', 'year_end',
      'team_age_rule', 'sum',
      'age_groups', '[]'::jsonb,
      'rankings', jsonb_build_array(
        jsonb_build_object('id', 'geral', 'name', 'Geral', 'dims', '[]'::jsonb, 'size', 3),
        jsonb_build_object('id', 'geral-sexo', 'name', 'Geral por sexo', 'dims', jsonb_build_array('sex'), 'size', 3)
      ),
      'cumulative', false,
      'same_crossing_window_s', 30,
      'divergence_threshold_s', 3,
      'time_source', 'median',
      'reference_timekeeper_id', null
    )
  else
    jsonb_build_object(
      'age_rule', 'year_end',
      'team_age_rule', 'sum',
      'age_groups', jsonb_build_array(
        jsonb_build_object('label', 'até 19', 'min', 0, 'max', 19),
        jsonb_build_object('label', '20-29', 'min', 20, 'max', 29),
        jsonb_build_object('label', '30-39', 'min', 30, 'max', 39),
        jsonb_build_object('label', '40-49', 'min', 40, 'max', 49),
        jsonb_build_object('label', '50-59', 'min', 50, 'max', 59),
        jsonb_build_object('label', '60+', 'min', 60, 'max', null)
      ),
      'rankings', jsonb_build_array(
        jsonb_build_object('id', 'geral', 'name', 'Geral', 'dims', '[]'::jsonb, 'size', 3),
        jsonb_build_object('id', 'geral-sexo', 'name', 'Geral por sexo', 'dims', jsonb_build_array('sex'), 'size', 3),
        jsonb_build_object('id', 'faixa', 'name', 'Faixa etária', 'dims', jsonb_build_array('sex', 'age'), 'size', 3)
      ),
      'cumulative', false,
      'same_crossing_window_s', 30,
      'divergence_threshold_s', 3,
      'time_source', 'median',
      'reference_timekeeper_id', null
    )
  end
$$;
