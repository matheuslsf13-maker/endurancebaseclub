-- Public RPCs (spec §6 "Público") and the final grant model (spec §14, Ruling 15): after this
-- migration, anon/authenticated can execute only admin_* (authenticated), tk_*/pub_*/server_time
-- (anon + authenticated) -- every other function in schema public becomes uncallable through
-- PostgREST, and direct table access is gone for anon/authenticated entirely.

-- 1. resolve_public_event: p_slug -> the event, only if it is public; else the standard "not
--    found" message. Shared by pub_event/pub_live. Deliberately NOT pub_-prefixed: like tk_event,
--    it must stay ungranted (it is only ever called from inside another security definer function).
create or replace function public.resolve_public_event(p_slug text) returns public.events
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events;
begin
  select * into ev from public.events where public_slug = p_slug and is_public;
  if not found then raise exception 'Evento não encontrado' using errcode = 'P0001'; end if;
  return ev;
end $$;

-- 2. mark_public_json: the public mark projection (Ruling 4) -- strips the clock-audit fields
--    (device_ts, clock_offset_ms, clock_rtt_ms) and the organizer-only org_edited flag (Ruling 27,
--    added by Task 6's fix round to public.marks). Declared `stable`, not `immutable`: to_jsonb of
--    a timestamptz column renders using the session's TimeZone setting, so the result isn't a pure
--    function of the input row alone.
create or replace function public.mark_public_json(m public.marks) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select to_jsonb(m) - 'device_ts' - 'clock_offset_ms' - 'clock_rtt_ms' - 'org_edited'
$$;

-- 3. pub_events: public event list for the public home page.
create or replace function public.pub_events() returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'public_slug', e.public_slug, 'name', e.name, 'date', e.date,
    'location', e.location, 'status', e.status
  ) order by e.date desc), '[]'::jsonb)
  from public.events e where e.is_public
$$;

-- 4. pub_event: the full public snapshot for one event (PubEventPayload), shaped like
--    admin_get_event/tk_open minus tk_token/tk_enabled and every organizer-only field:
--    entries never carry `notes` (Ruling 29), athletes never carry email/phone/birth_date, marks
--    never carry the clock-audit fields (mark_public_json above), and resolutions never carry
--    `note` (free text the organizer typed in the Review editor) or `decided_by` (their user id).
create or replace function public.pub_event(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events := public.resolve_public_event(p_slug);
begin
  return jsonb_build_object(
    'event', to_jsonb(ev) - 'tk_token' - 'tk_enabled',
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
      select jsonb_agg(public.entry_json(en.id, true) - 'notes'
                        order by case when en.bib ~ '^\d+$' then lpad(en.bib, 20, '0') else en.bib end)
      from public.entries en where en.event_id = ev.id
    ), '[]'::jsonb),
    'athletes', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'id', a.id, 'name', a.name, 'sex', a.sex, 'team_club', a.team_club, 'city', a.city,
        'public_profile', a.public_profile,
        -- explicit ::timestamp casts: `age(date, date)` otherwise resolves to the timestamptz
        -- overload, which converts each date through the session TimeZone and can be off by a
        -- day on a Brazilian DST-start date (that midnight doesn't exist, e.g. 2018-11-04 becomes
        -- 01:00 local -- verified empirically to shift date_part('year', age(...)) by one).
        'age_event', date_part('year', age(ev.date::timestamp, a.birth_date::timestamp)),
        'age_year_end', extract(year from ev.date) - extract(year from a.birth_date)
      ))
      from public.athletes a
      join public.entry_members m on m.athlete_id = a.id
      join public.entries en on en.id = m.entry_id
      where en.event_id = ev.id
    ), '[]'::jsonb),
    'timekeepers', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.created_at)
      from public.timekeepers t where t.event_id = ev.id
    ), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(public.mark_public_json(mk) order by mk.ts)
      from public.marks mk where mk.event_id = ev.id
    ), '[]'::jsonb),
    'resolutions', coalesce((
      select jsonb_agg(to_jsonb(res) - 'note' - 'decided_by') from public.resolutions res where res.event_id = ev.id
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(to_jsonb(res)) from public.results res where res.event_id = ev.id
    ), '[]'::jsonb),
    'version', ev.version,
    'server_now', now()
  );
end $$;

-- 5. pub_live: like admin_live, with the same public mark projection as pub_event (marks are a
--    delta since p_since -- including discarded ones, so clients can drop them; resolutions and
--    waves always come back in full).
create or replace function public.pub_live(p_slug text, p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events := public.resolve_public_event(p_slug);
begin
  return jsonb_build_object(
    'server_now', now(),
    'version', ev.version,
    'marks', coalesce((
      select jsonb_agg(public.mark_public_json(mk) order by mk.ts) from public.marks mk
      where mk.event_id = ev.id and (p_since is null or mk.updated_at >= p_since)
    ), '[]'::jsonb),
    'resolutions', coalesce((
      select jsonb_agg(to_jsonb(res) - 'note' - 'decided_by') from public.resolutions res where res.event_id = ev.id
    ), '[]'::jsonb),
    'waves', coalesce((
      select jsonb_agg(to_jsonb(w) order by r.position, r.name, w.position)
      from public.waves w join public.races r on r.id = w.race_id
      where r.event_id = ev.id
    ), '[]'::jsonb)
  );
end $$;

-- 6. pub_athlete: only for athletes who opted into a public profile; results restricted to those
--    whose event is public (never a private event's result, even for a public-profile athlete).
create or replace function public.pub_athlete(p_athlete_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare a public.athletes;
begin
  select * into a from public.athletes where id = p_athlete_id and public_profile;
  if not found then raise exception 'Perfil não encontrado' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'athlete', jsonb_build_object('id', a.id, 'name', a.name, 'sex', a.sex, 'city', a.city, 'team_club', a.team_club),
    'results', coalesce((
      select jsonb_agg(to_jsonb(r) order by (r.data->'event'->>'date') desc)
      from public.results r
      join public.events ev on ev.id = r.event_id
      where p_athlete_id = any(r.athlete_ids) and ev.is_public
    ), '[]'::jsonb)
  );
end $$;

-- 7. Grants (Ruling 15): revoke everything from anon/authenticated -- tables, sequences, function
--    execute, and the default privileges dev/db/bootstrap.sql granted at schema level -- then walk
--    every function in schema public and grant execute back explicitly by name prefix. Nothing
--    without an admin_/tk_/pub_ prefix (or server_time) is granted; tk_event stays ungranted too.
--    Every later migration that adds an RPC must repeat this same block at its end.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- Ruling 35: the schema-scoped form above cannot remove Postgres's built-in "PUBLIC gets EXECUTE
-- on new functions" default (verified empirically: once a schema-scoped REVOKE from PUBLIC leaves
-- nothing else granted, Postgres just drops that override row instead of storing it, so CREATE
-- FUNCTION falls back to the hard-coded default again). Only the role-global form (no `in schema`)
-- actually suppresses it, so every function created from now on -- in any schema, by anything this
-- migration runs as -- starts truly PUBLIC-execute-free; this only needs to be set once (it is not
-- schema-scoped, so later migrations don't need to repeat it). The schema-scoped anon/authenticated
-- revokes above stay too, since they also undo dev/db/bootstrap.sql's (and Supabase's own) default
-- grants to those two roles specifically.
alter default privileges revoke execute on functions from public;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    if f.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    elsif f.proname like 'tk\_%' and f.proname <> 'tk_event' or f.proname like 'pub\_%' or f.proname = 'server_time' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
