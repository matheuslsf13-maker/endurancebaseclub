-- admin_update_organizer: the master organizer edits an organizer's name and e-mail and, for
-- someone else, can set a new temporary password (forces a change on the next login). The e-mail
-- is the login, so it changes in auth.users/auth.identities too, keeping the three in step.
create or replace function public.admin_update_organizer(p_user_id uuid, p_name text, p_email text, p_new_password text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me public.organizers := public.assert_owner(); o public.organizers;
  v_email text := lower(btrim(coalesce(p_email, ''))); v_name text := btrim(coalesce(p_name, ''));
begin
  select * into o from public.organizers where user_id = p_user_id;
  if not found then raise exception 'Organizador não encontrado' using errcode = 'P0001'; end if;
  if v_name = '' then raise exception 'Informe o nome' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user_id) then
    raise exception 'Já existe uma conta com este e-mail' using errcode = 'P0001';
  end if;
  if p_new_password is not null then
    if p_user_id = me.user_id then
      raise exception 'Troque a sua própria senha em "Minha conta"' using errcode = 'P0001';
    end if;
    if length(p_new_password) < 8 then raise exception 'A senha precisa ter pelo menos 8 caracteres' using errcode = 'P0001'; end if;
  end if;

  if v_email <> o.email then
    update auth.users set email = v_email, updated_at = now() where id = p_user_id;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
    where user_id = p_user_id and provider = 'email';
  end if;
  if p_new_password is not null then
    update auth.users set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)), updated_at = now()
    where id = p_user_id;
  end if;
  update public.organizers
  set name = v_name, email = v_email, must_change_password = must_change_password or p_new_password is not null
  where user_id = p_user_id
  returning * into o;
  return jsonb_build_object('user_id', o.user_id, 'email', o.email, 'name', o.name, 'role', o.role, 'created_at', o.created_at);
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
