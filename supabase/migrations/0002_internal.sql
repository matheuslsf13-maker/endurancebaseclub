-- 1. updated_at maintenance, attached to every table that has the column (except events,
--    which gets its own combined trigger below).
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_set_updated_at before update on public.athletes
  for each row execute function public.tg_set_updated_at();
create trigger trg_set_updated_at before update on public.races
  for each row execute function public.tg_set_updated_at();
create trigger trg_set_updated_at before update on public.waves
  for each row execute function public.tg_set_updated_at();
create trigger trg_set_updated_at before update on public.entries
  for each row execute function public.tg_set_updated_at();
create trigger trg_set_updated_at before update on public.marks
  for each row execute function public.tg_set_updated_at();
create trigger trg_set_updated_at before update on public.resolutions
  for each row execute function public.tg_set_updated_at();

-- 2. events: updated_at + version bump, unless the caller already advanced version itself
--    (bump_event_version below sets version directly; this guards against a double bump).
create or replace function public.tg_events_before_update() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  new.updated_at := now();
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create trigger trg_events_before_update before update on public.events
  for each row execute function public.tg_events_before_update();

-- 3. Internal helper used by the child-table triggers below to bump an event's version.
create or replace function public.bump_event_version(p_event_id uuid) returns void
language sql set search_path = public, extensions, pg_temp as $$
  update public.events set version = version + 1 where id = p_event_id
$$;

-- 4. Row triggers that bump the owning event's version whenever structural child data changes.
create or replace function public.tg_races_bump_event_version() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  perform public.bump_event_version(coalesce(new.event_id, old.event_id));
  return coalesce(new, old);
end $$;
create trigger trg_bump_event_version after insert or update or delete on public.races
  for each row execute function public.tg_races_bump_event_version();

create or replace function public.tg_waves_bump_event_version() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v_event_id uuid;
begin
  select r.event_id into v_event_id from public.races r where r.id = coalesce(new.race_id, old.race_id);
  if v_event_id is not null then perform public.bump_event_version(v_event_id); end if;
  return coalesce(new, old);
end $$;
create trigger trg_bump_event_version after insert or update or delete on public.waves
  for each row execute function public.tg_waves_bump_event_version();

create or replace function public.tg_entries_bump_event_version() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  perform public.bump_event_version(coalesce(new.event_id, old.event_id));
  return coalesce(new, old);
end $$;
create trigger trg_bump_event_version after insert or update or delete on public.entries
  for each row execute function public.tg_entries_bump_event_version();

create or replace function public.tg_entry_members_bump_event_version() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v_event_id uuid;
begin
  select e.event_id into v_event_id from public.entries e where e.id = coalesce(new.entry_id, old.entry_id);
  if v_event_id is not null then perform public.bump_event_version(v_event_id); end if;
  return coalesce(new, old);
end $$;
create trigger trg_bump_event_version after insert or update or delete on public.entry_members
  for each row execute function public.tg_entry_members_bump_event_version();

-- An athlete's own record has no event_id; bump every event where the athlete has an entry.
create or replace function public.tg_athletes_bump_event_version() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare r record;
begin
  for r in
    select distinct e.event_id
    from public.entry_members em
    join public.entries e on e.id = em.entry_id
    where em.athlete_id = new.id
  loop
    perform public.bump_event_version(r.event_id);
  end loop;
  return new;
end $$;
create trigger trg_bump_event_version after update on public.athletes
  for each row execute function public.tg_athletes_bump_event_version();

-- 5. slugify: lowercase, strip Portuguese accents, collapse non [a-z0-9] runs to '-', trim '-'.
create or replace function public.slugify(p text) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select trim(both '-' from
    regexp_replace(
      translate(
        lower(coalesce(p, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+', '-', 'g'
    )
  )
$$;

-- 6. server_time: authoritative server clock in epoch milliseconds (clients sync against this).
create or replace function public.server_time() returns bigint
language sql volatile set search_path = public, extensions, pg_temp as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

-- 7. Session helpers: resolve the calling organizer (or the owner), raising 42501 if not one.
create or replace function public.assert_organizer() returns public.organizers
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers;
begin
  select * into o from public.organizers where user_id = auth.uid();
  if not found then raise exception 'Acesso restrito à organização' using errcode = '42501'; end if;
  return o;
end $$;
create or replace function public.assert_owner() returns public.organizers
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers := public.assert_organizer();
begin
  if o.role <> 'owner' then raise exception 'Apenas a organizadora master pode fazer isso' using errcode = '42501'; end if;
  return o;
end $$;

-- 8. Internal Auth user creation (used by bootstrap_owner and, later, admin_create_organizer).
create or replace function public.internal_create_auth_user(p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido' using errcode = 'P0001'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'A senha precisa ter pelo menos 8 caracteres' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Já existe uma conta com este e-mail' using errcode = 'P0001';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
  return v_id;
end $$;

-- 9. bootstrap_owner: one-time creation of the master organizer account.
create or replace function public.bootstrap_owner(p_email text, p_password text, p_name text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_id uuid;
begin
  v_id := public.internal_create_auth_user(p_email, p_password);
  insert into public.organizers (user_id, email, name, role, must_change_password)
  values (v_id, lower(btrim(p_email)), coalesce(p_name, ''), 'owner', true);
  return v_id;
end $$;

-- 10. default_race_config: matches src/domain/presets.ts defaultRaceConfig(teamSize) exactly.
create or replace function public.default_race_config(p_team_size int) returns jsonb
language sql immutable set search_path = public, extensions, pg_temp as $$
  select case when p_team_size > 1 then
    jsonb_build_object(
      'age_rule', 'year_end',
      'team_age_rule', 'sum',
      'age_groups', '[]'::jsonb,
      'rankings', jsonb_build_array(
        jsonb_build_object('id', 'geral', 'name', 'Geral', 'dims', jsonb_build_array('sex'), 'size', 3)
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
        jsonb_build_object('id', 'geral', 'name', 'Geral', 'dims', jsonb_build_array('sex'), 'size', 3),
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
