## Task 4: Admin RPCs — organizers, events, races, waves

**Files:**
- Create: `supabase/migrations/0003_admin_events.sql`, `supabase/tests/20_admin_events.sql`

**Interfaces:**
- Consumes: Task 3 functions.
- Produces (spec §6): `admin_me()`, `admin_password_changed()`, `admin_list_organizers()`, `admin_create_organizer(p_email text, p_password text, p_name text)`, `admin_delete_organizer(p_user_id uuid)`, `admin_list_events()`, `admin_get_event(p_event_id uuid)`, `admin_save_event(p_event jsonb)`, `admin_delete_event(p_event_id uuid)`, `admin_duplicate_event(p_event_id uuid, p_name text, p_date date) returns uuid`, `admin_rotate_tk_token(p_event_id uuid) returns text`, `admin_save_race(p_race jsonb)`, `admin_delete_race(p_race_id uuid)`, `admin_set_wave_start(p_wave_id uuid, p_start_at timestamptz)`, plus internal helpers `entry_json(p_entry_id uuid, p_with_names boolean default false) returns jsonb` and `validate_race_payload(...)` as you see fit. All return shapes exactly as the TS types (`AdminMe`, `OrganizerRow[]`, `EventSummary[]`, `EventAggregate`, `EventRow`, `{race, waves}`, `WaveRow`).

Pattern every admin function follows:

```sql
create or replace function public.admin_me() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers := public.assert_organizer();
begin
  return jsonb_build_object('user_id', o.user_id, 'email', o.email, 'name', o.name, 'role', o.role,
                            'must_change_password', o.must_change_password);
end $$;

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
```

Behavior details:
- `admin_save_event(p_event)`: keys `id?, name, date, location, description, levels (text[]), status, is_public, public_slug, tk_enabled`. Insert when `id` is null: `public_slug` = `slugify(name || '-' || date)` with `-2`, `-3`… suffix until unique (also when `is_public` turns true and slug is null). Validate `name` non-empty, `levels` trimmed/non-empty/unique, `status` valid, slug `^[a-z0-9-]{3,80}$` and unique (error `Endereço público já em uso`). Returns the event row (`to_jsonb(ev)`, including `tk_token`).
- `admin_get_event`: `{event, races (order by position, name), waves (order by race, position), entries (entry_json, order by bib numeric-aware: lpad when numeric), athletes (distinct athletes of entries: id,name,sex,birth_date,team_club,city,public_profile), timekeepers (with marks_count), marks (all, order by ts), resolutions, results, version, server_now: now()}`. Unknown id → `Evento não encontrado` (P0001).
- `admin_list_events`: all events (`order by date desc`) + `races_count`, `entries_count`.
- `admin_delete_event`: deletes (cascades).
- `admin_duplicate_event`: new event with same levels/description/location, new token, `status 'planejado'`, `is_public false`; copies races (same legs/config/team_size/position, `finalized_at null`) and their waves (same names/positions, `start_at null`). Returns new id.
- `admin_rotate_tk_token`: sets a new `random_token(24)`; returns it.
- `admin_save_race(p_race)`: keys `id?, event_id, name, position?, team_size, legs[], config{}, waves[] ({id?, name, position, start_at?})`. Validate: event exists; name non-empty; `team_size` 1..10; legs array ≥ 1, each `modality` in (swim,bike,run,other), `label` non-empty, `distance_m` null or > 0 (null only allowed for `other`); config = `default_race_config(team_size) || coalesce(config,'{}')` then validate `age_rule`, `team_age_rule`, `time_source`, `cumulative` boolean, `same_crossing_window_s` 1..600, `divergence_threshold_s` 0.1..600, each ranking `{id non-empty unique, name non-empty, dims ⊆ {sex,age,level} unique, size 1..10}`, age groups `min >= 0`, `max null or >= min`, non-overlapping; `reference_timekeeper_id` null or a timekeeper of the event. If the race exists and has non-discarded marks on its entries: reject changes to `jsonb_array_length(legs)`, the modality order, or `team_size` (`Não é possível alterar pernas ou tamanho da equipe depois que há marcações`). Waves: upsert by id; delete waves of the race not in the payload; if the payload has no waves, ensure one `Largada geral` exists. Returns `{race, waves}`.
- `admin_set_wave_start(p_wave_id, p_start_at)`: sets/clears `start_at`; returns the wave row.
- Organizers: `admin_list_organizers` (any organizer); `admin_create_organizer` (owner) → `internal_create_auth_user` + organizers row `role 'admin'`, `must_change_password true` → returns `OrganizerRow`; `admin_delete_organizer` (owner; `Você não pode remover a si mesma` if self) → `delete from auth.users where id = p_user_id` (cascades organizer); `admin_password_changed` → `must_change_password = false` for `auth.uid()`.

- [ ] **Step 1: Write failing `supabase/tests/20_admin_events.sql`** covering, at minimum:

```sql
begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.set('stranger', public.internal_create_auth_user('x@ebc.test','senha-forte-1')::text);
-- non-organizer is rejected
select tests.as_user(tests.get('stranger')::uuid);
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
reset role;
-- owner flow
select tests.as_user(tests.get('owner')::uuid);
do $$ declare ev jsonb; r jsonb; agg jsonb; dup uuid; begin
  assert (public.admin_me() ->> 'role') = 'owner';
  ev := public.admin_save_event('{"name":"Desafio EBC","date":"2026-10-11","levels":["Elite","Base"]}');
  perform tests.set('ev', ev ->> 'id');
  assert ev ->> 'public_slug' = 'desafio-ebc-2026-10-11' and length(ev ->> 'tk_token') = 24;
  r := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Revezamento', 'team_size', 2,
        'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race', r -> 'race' ->> 'id');
  assert jsonb_array_length(r -> 'waves') = 1 and (r -> 'waves' -> 0 ->> 'name') = 'Largada geral';
  assert (r -> 'race' -> 'config' ->> 'divergence_threshold_s')::numeric = 3;
  agg := public.admin_get_event((ev ->> 'id')::uuid);
  assert jsonb_array_length(agg -> 'races') = 1 and agg ? 'server_now' and agg ? 'marks';
  perform public.admin_set_wave_start((r -> 'waves' -> 0 ->> 'id')::uuid, '2026-10-11T11:00:00Z');
  assert (select start_at from public.waves where id = (r -> 'waves' -> 0 ->> 'id')::uuid) = '2026-10-11T11:00:00Z';
  dup := public.admin_duplicate_event((ev ->> 'id')::uuid, 'Desafio EBC 2027', '2027-10-10');
  assert (select count(*) from public.races where event_id = dup) = 1;
  assert (select count(*) from public.waves w join public.races x on x.id = w.race_id where x.event_id = dup and w.start_at is null) = 1;
  assert public.admin_rotate_tk_token((ev ->> 'id')::uuid) <> ev ->> 'tk_token';
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"fly","label":"?","distance_m":1}]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"run","label":"C","distance_m":1000}]'::jsonb, 'config', '{"age_groups":[{"label":"a","min":20,"max":29},{"label":"b","min":25,"max":34}]}'::jsonb))$$, 'P0001');
-- organizers
do $$ declare o jsonb; begin
  o := public.admin_create_organizer('Ajudante@EBC.test', 'senha-forte-2', 'Ajudante');
  assert o ->> 'role' = 'admin' and o ->> 'email' = 'ajudante@ebc.test';
  assert jsonb_array_length(public.admin_list_organizers()) = 2;
end $$;
select tests.assert_raises($$select public.admin_delete_organizer(tests.get('owner')::uuid)$$, 'P0001');
reset role;
rollback;
```

Also add assertions (same file) for: changing `legs` length of a race after a non-discarded mark exists → `P0001`; `admin_create_organizer` called by an `admin` (not owner) → `42501`; `admin_password_changed` clears the flag; slug collision produces `-2`.

- [ ] **Step 2: Run** `bash scripts/test-sql.sh` → FAIL. **Step 3:** implement `0003_admin_events.sql`. **Step 4:** run → PASS. **Step 5: Commit** (`feat(db): admin RPCs for organizers, events, races and waves`).

---

