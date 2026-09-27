## Task 3: Schema migration and internal functions

**Files:**
- Create: `supabase/migrations/0001_schema.sql`, `supabase/migrations/0002_internal.sql`, `supabase/tests/10_schema.sql`

**Interfaces:**
- Consumes: Task 2 scripts and `tests.*` helpers.
- Produces: all tables (spec §5); `public.random_token(int)`, `public.slugify(text)`, `public.server_time()`, `public.assert_organizer() returns public.organizers`, `public.assert_owner() returns public.organizers`, `public.internal_create_auth_user(text,text) returns uuid`, `public.bootstrap_owner(text,text,text) returns uuid`, `public.default_race_config(int) returns jsonb`; triggers maintaining `updated_at` and `events.version`.

- [ ] **Step 1: Write the failing SQL test `supabase/tests/10_schema.sql`**

```sql
begin;
-- owner bootstrap
select tests.set('owner', public.bootstrap_owner('Owner@EBC.test', 'senha-forte-1', 'Owner')::text);
do $$ declare u auth.users; o public.organizers; begin
  select * into u from auth.users where id = tests.get('owner')::uuid;
  assert u.email = 'owner@ebc.test', 'email lowercased';
  assert u.encrypted_password = extensions.crypt('senha-forte-1', u.encrypted_password), 'password hash verifies';
  assert u.email_confirmed_at is not null and u.aud = 'authenticated' and u.role = 'authenticated';
  assert u.confirmation_token = '' and u.recovery_token = '' and u.email_change = '' and u.reauthentication_token = '';
  assert (select count(*) from auth.identities where user_id = u.id and provider = 'email' and provider_id = u.id::text) = 1;
  select * into o from public.organizers where user_id = u.id;
  assert o.role = 'owner' and o.must_change_password and o.name = 'Owner';
end $$;
select tests.assert_raises($$select public.bootstrap_owner('owner@ebc.test','outra-senha-1','X')$$, 'P0001', 'Já existe%');
select tests.assert_raises($$select public.internal_create_auth_user('curta@ebc.test','1234567')$$, 'P0001', '%8 caracteres%');
select tests.assert_raises($$select public.internal_create_auth_user('sem-arroba','12345678')$$, 'P0001', 'E-mail inválido');
-- utilities
do $$ begin
  assert length(public.random_token(24)) = 24 and public.random_token(24) ~ '^[A-Za-z0-9]{24}$';
  assert public.slugify('Triathlon Águas Claras 2026!') = 'triathlon-aguas-claras-2026';
  assert public.server_time() between (extract(epoch from now()) * 1000)::bigint - 60000 and (extract(epoch from now()) * 1000)::bigint + 60000;
  assert (public.default_race_config(1) -> 'rankings' -> 1 ->> 'id') = 'faixa';
  assert jsonb_array_length(public.default_race_config(2) -> 'age_groups') = 0;
end $$;
-- events: token default, version bump through child tables, updated_at
insert into public.events (id, name, date) values ('00000000-0000-0000-0000-0000000000e1', 'Evento', '2026-10-11');
do $$ declare v bigint; begin
  assert (select length(tk_token) from public.events where id = '00000000-0000-0000-0000-0000000000e1') = 24;
  select version into v from public.events where id = '00000000-0000-0000-0000-0000000000e1';
  insert into public.races (id, event_id, name, legs, config) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'Corrida', '[{"modality":"run","label":"Corrida","distance_m":5000}]', public.default_race_config(1));
  assert (select version from public.events where id = '00000000-0000-0000-0000-0000000000e1') > v, 'race insert bumps version';
end $$;
-- constraints
insert into public.entries (event_id, race_id, bib) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '10');
select tests.assert_raises($$insert into public.entries (event_id, race_id, bib) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '10')$$, '23505');
select tests.assert_raises($$insert into public.marks (id, event_id, ts, entry_id) select gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', now(), id from public.entries limit 1$$, '23514');
-- RLS denies direct reads for anon (grants are revoked later in 0006; here RLS alone returns no rows)
select tests.as_anon();
do $$ begin assert (select count(*) from public.events) = 0; end $$;
reset role;
rollback;
```

- [ ] **Step 2: Run** `bash scripts/test-sql.sh` → `FAIL supabase/tests/10_schema.sql` (functions/tables missing).

- [ ] **Step 3: Write `supabase/migrations/0001_schema.sql`**

```sql
create or replace function public.random_token(p_len int) returns text
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        b bytea := extensions.gen_random_bytes(p_len); out text := ''; i int;
begin
  for i in 0 .. p_len - 1 loop out := out || substr(chars, (get_byte(b, i) % 62) + 1, 1); end loop;
  return out;
end $$;

create table public.organizers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null, name text not null default '',
  role text not null default 'admin' check (role in ('owner','admin')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  sex text not null check (sex in ('M','F')),
  birth_date date, email text, phone text, city text, team_club text,
  notes text not null default '', public_profile boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index athletes_name_idx on public.athletes (lower(name));
create index athletes_email_idx on public.athletes (lower(email));
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0), date date not null,
  location text not null default '', description text not null default '',
  levels text[] not null default '{}',
  status text not null default 'planejado' check (status in ('planejado','ao_vivo','encerrado')),
  is_public boolean not null default false, public_slug text unique,
  tk_token text not null unique default public.random_token(24), tk_enabled boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.races (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0), position int not null default 0,
  team_size int not null default 1 check (team_size between 1 and 10),
  legs jsonb not null check (jsonb_typeof(legs) = 'array' and jsonb_array_length(legs) >= 1),
  config jsonb not null, finalized_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index races_event_idx on public.races (event_id);
create table public.waves (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  name text not null default 'Largada geral', position int not null default 0, start_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index waves_race_idx on public.waves (race_id);
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  race_id uuid not null references public.races(id) on delete cascade,
  wave_id uuid references public.waves(id) on delete set null,
  bib text not null check (length(btrim(bib)) > 0), team_name text, level text,
  status text not null default 'ok' check (status in ('ok','dns','dnf','dsq')),
  penalty_ms int not null default 0 check (penalty_ms >= 0), notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (event_id, bib)
);
create index entries_race_idx on public.entries (race_id);
create table public.entry_members (
  entry_id uuid not null references public.entries(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  position int not null default 0, legs int[] not null default '{}',
  primary key (entry_id, athlete_id)
);
create index entry_members_athlete_idx on public.entry_members (athlete_id);
create table public.timekeepers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0), secret text not null,
  device_label text not null default '', active boolean not null default true,
  created_at timestamptz not null default now(), last_seen_at timestamptz
);
create table public.marks (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  timekeeper_id uuid references public.timekeepers(id) on delete set null,
  ts timestamptz not null, device_ts timestamptz, clock_offset_ms int, clock_rtt_ms int,
  entry_id uuid references public.entries(id) on delete set null, leg_index int,
  athlete_id uuid references public.athletes(id) on delete set null,
  discarded boolean not null default false,
  discarded_by text check (discarded_by in ('timekeeper','organizer')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint marks_leg_when_assigned check (entry_id is null or leg_index is not null)
);
create index marks_event_updated_idx on public.marks (event_id, updated_at);
create index marks_entry_idx on public.marks (entry_id);
create table public.resolutions (
  entry_id uuid not null references public.entries(id) on delete cascade,
  leg_index int not null,
  event_id uuid not null references public.events(id) on delete cascade,
  mode text not null check (mode in ('system','mark','manual')),
  mark_id uuid references public.marks(id) on delete cascade,
  manual_ts timestamptz, note text not null default '', decided_by uuid,
  updated_at timestamptz not null default now(),
  primary key (entry_id, leg_index),
  check ((mode = 'mark') = (mark_id is not null)),
  check ((mode = 'manual') = (manual_ts is not null))
);
create index resolutions_event_idx on public.resolutions (event_id, updated_at);
create table public.results (
  race_id uuid not null references public.races(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  athlete_ids uuid[] not null, status text not null, final_ms bigint, overall_pos int,
  data jsonb not null, finalized_at timestamptz not null default now(),
  primary key (race_id, entry_id)
);
create index results_athletes_idx on public.results using gin (athlete_ids);

alter table public.organizers enable row level security;
alter table public.athletes enable row level security;
alter table public.events enable row level security;
alter table public.races enable row level security;
alter table public.waves enable row level security;
alter table public.entries enable row level security;
alter table public.entry_members enable row level security;
alter table public.timekeepers enable row level security;
alter table public.marks enable row level security;
alter table public.resolutions enable row level security;
alter table public.results enable row level security;
```

- [ ] **Step 4: Write `supabase/migrations/0002_internal.sql`**

Contents (all functions `set search_path = public, extensions, pg_temp`):
1. `tg_set_updated_at()` trigger function (`new.updated_at := now()`), attached `before update` on `athletes, races, waves, entries, marks, resolutions`.
2. `tg_events_before_update()`: `new.updated_at := now(); if new.version = old.version then new.version := old.version + 1; end if;` attached `before update on events`.
3. `bump_event_version(p_event_id uuid)`: `update public.events set version = version + 1 where id = p_event_id`.
4. Row triggers (`after insert or update or delete`) calling `bump_event_version`: on `races` (event_id), `waves` (event of the race), `entries` (event_id), `entry_members` (event of the entry; use `coalesce(new.entry_id, old.entry_id)`); `after update on athletes`: bump every event where the athlete has an entry.
5. `slugify(p text) returns text language sql immutable`: lower + `translate` of Portuguese accents (`áàâãäéèêëíìîïóòôõöúùûüçñ` and uppercase → ascii) + `regexp_replace('[^a-z0-9]+','-','g')` + trim `-`.
6. `server_time() returns bigint language sql volatile`: `select (extract(epoch from clock_timestamp()) * 1000)::bigint`.
7. `assert_organizer()` / `assert_owner()`:

```sql
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
```

8. `internal_create_auth_user`:

```sql
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
```

9. `bootstrap_owner(p_email, p_password, p_name) returns uuid`: `v := internal_create_auth_user(...)`; insert organizer `(v, lower(btrim(p_email)), coalesce(p_name,''), 'owner', true)`; return v.
10. `default_race_config(p_team_size int) returns jsonb language sql immutable` returning exactly the TS `defaultRaceConfig` (see Task 9): individual → rankings `geral` (dims `["sex"]`, size 3) and `faixa` (name `Faixa etária`, dims `["sex","age"]`, size 3), age groups `até 19 (0-19), 20-29, 30-39, 40-49, 50-59, 60+ (max null)`; team → only `geral`, `age_groups: []`; plus `age_rule 'year_end'`, `team_age_rule 'sum'`, `cumulative false`, `same_crossing_window_s 30`, `divergence_threshold_s 3`, `time_source 'median'`, `reference_timekeeper_id null`.

- [ ] **Step 5: Run** `bash scripts/test-sql.sh` → all PASS.
- [ ] **Step 6: Commit** (`feat(db): schema, internal helpers and auth user bootstrap`).

---

