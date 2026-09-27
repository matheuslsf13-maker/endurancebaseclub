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
