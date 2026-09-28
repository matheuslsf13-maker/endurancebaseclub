-- 0010 (spec 2026-09-28-perfis-publicos-estatisticas-design §4.1): one public bundle behind the
-- athletes directory, the profiles, "Nós dois" and the club rankings, all computed in the browser.
-- Privacy rule (70_pub_stats.sql): `athletes` carries exactly pub_athlete's fields, and `results`
-- is exactly the union of pub_athlete(id) results over the public athletes -- nothing new leaks.
create or replace function public.pub_stats() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  return jsonb_build_object(
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'sex', a.sex, 'city', a.city, 'team_club', a.team_club)
                       order by a.name, a.id)
      from public.athletes a
      where a.public_profile
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(to_jsonb(r) order by (r.data -> 'event' ->> 'date') desc nulls last, r.race_id, r.entry_id)
      from public.results r
      join public.events ev on ev.id = r.event_id
      where ev.is_public
        and exists (select 1 from public.athletes a where a.id = any(r.athlete_ids) and a.public_profile)
    ), '[]'::jsonb)
  );
end $$;

-- Grants: the 0006 block, repeated as DEPLOY.md requires for every migration that adds an RPC.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
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
