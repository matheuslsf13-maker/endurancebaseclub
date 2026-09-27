create schema if not exists tests;
grant usage on schema tests to anon, authenticated;
create table if not exists tests.ctx (k text primary key, v text);
grant all on tests.ctx to anon, authenticated;
create or replace function tests.set(p_k text, p_v text) returns void language sql as
$$ insert into tests.ctx(k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function tests.get(p_k text) returns text language sql stable as
$$ select v from tests.ctx where k = p_k $$;
create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
create or replace function tests.assert_raises(p_sql text, p_errcode text, p_msg_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_errcode then
      raise exception 'expected errcode % but got % (%) for: %', p_errcode, sqlstate, sqlerrm, p_sql;
    end if;
    if p_msg_like is not null and sqlerrm not like p_msg_like then
      raise exception 'expected message like "%" but got "%"', p_msg_like, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but statement succeeded: %', p_errcode, p_sql;
end $$;
grant execute on all functions in schema tests to anon, authenticated;
