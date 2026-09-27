## Task 7: Public RPCs, grants and security tests

**Files:**
- Create: `supabase/migrations/0006_public_grants.sql`, `supabase/tests/50_public.sql`, `supabase/tests/60_security.sql`

**Interfaces:**
- Produces: `pub_events()`, `pub_event(p_slug text)`, `pub_live(p_slug text, p_since timestamptz)`, `pub_athlete(p_athlete_id uuid)`, and the final grant model.

Behavior details:
- `pub_events()`: public events `{id, public_slug, name, date, location, status}` order by date desc.
- `pub_event(p_slug)`: only `is_public`; else `Evento não encontrado` (P0001). Returns `PubEventPayload`: `event` = `to_jsonb(ev) - 'tk_token' - 'tk_enabled'`; races; waves; entries (`entry_json(id,true)`); `athletes` of the event with only `{id, name, sex, team_club, city, public_profile, age_event, age_year_end}` where `age_event = date_part('year', age(ev.date, birth_date))` and `age_year_end = extract(year from ev.date) - extract(year from birth_date)` (nulls when no birth date); timekeepers `{id, name}`; marks (all, including discarded so clients can drop them) without `device_ts`, `clock_offset_ms`, `clock_rtt_ms`; resolutions; results; version; server_now.
- `pub_live(p_slug, p_since)`: like `admin_live` with the same mark projection as `pub_event`.
- `pub_athlete(p_athlete_id)`: athlete must exist and `public_profile` (`Perfil não encontrado`); returns `{athlete: {id,name,sex,city,team_club}, results}` restricted to results whose event `is_public`.
- Grants (end of this migration):

```sql
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
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
```

(Every later migration that adds an RPC must repeat the same DO block at its end.)

- [ ] **Step 1: Write failing tests.** `50_public.sql`: private event → `pub_event` raises; after `admin_save_event` with `is_public true`, `pub_event(slug)` as anon returns entries with member names, athletes without `email`/`phone`/`birth_date` keys (`assert not (x ? 'email')`), `age_year_end` computed, event without `tk_token`; `pub_live` returns discarded marks too; `pub_athlete` for `public_profile=false` raises; `pub_athlete` omits results of private events. `60_security.sql`:

```sql
begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.set('stranger', public.internal_create_auth_user('x@ebc.test','senha-forte-1')::text);
select tests.as_anon();
select tests.assert_raises($$select * from public.events$$, '42501');
select tests.assert_raises($$select * from public.marks$$, '42501');
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select public.internal_create_auth_user('a@b.co','12345678')$$, '42501');
select tests.assert_raises($$select public.bootstrap_owner('a@b.co','12345678','x')$$, '42501');
select tests.assert_raises($$select public.tk_event('x')$$, '42501');
do $$ begin assert public.server_time() > 0; assert jsonb_typeof(public.pub_events()) = 'array'; end $$;
reset role;
select tests.as_user(tests.get('stranger')::uuid);
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select * from public.athletes$$, '42501');
reset role;
rollback;
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `bash scripts/test-sql.sh` → every file PASS. **Step 5: Commit** (`feat(db): public RPCs and least-privilege grants`).

---

