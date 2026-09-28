# Public Athlete Profiles and Club Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone, without logging in, browse the public athletes, open any profile with a year filter, compare two athletes ("Nós dois": side by side, together in a team, head-to-head) and see the club's leaders and records.

**Architecture:** One new public RPC, `pub_stats()` (migration 0010), returns the public athletes and every finalized result of a public event that has at least one of them. The browser computes everything else with pure TypeScript in `src/domain/` (the same `computeAthleteStats` the profile already uses), so every page agrees. Four lazy-loaded public pages share one TanStack Query cache entry (`['pub-stats']`).

**Tech Stack:** React 19 + react-router 8 (HashRouter, `useSearchParams`), TanStack Query 5, Tailwind v4, strict TypeScript, Vitest 5 + Testing Library, Postgres (Supabase RPC, `security definer`), agent-browser E2E.

**Spec:** `docs/superpowers/specs/2026-09-28-perfis-publicos-estatisticas-design.md` (approved 2026-09-28). It extends `docs/superpowers/specs/2026-09-24-endurance-base-club-design.md` §6/§10/§12. Read both before starting.

## Global Constraints

- UI text in **pt-BR**; code, identifiers, comments and commit messages in English.
- DTO/JSON fields in **snake_case**, mirroring the columns (`src/lib/types.ts`).
- Dates shown with `formatDateBR` and durations with `formatDuration` (`src/lib/format.ts`). Never call `toLocale*` without a time zone.
- **Privacy:**
  - public pages see only athletes with `public_profile`, and only `id, name, sex, city, team_club`;
  - never `birth_date`, `email`, `phone`, `notes` or the `public_profile` flag itself.
- **Data scope:** only finalized results (`public.results`) of public events (`events.is_public`).
- **SQL functions:**
  - `language plpgsql stable security definer set search_path = public, extensions, pg_temp`;
  - the migration **repeats the 0006 grant block** at its end (DEPLOY.md), so `pub_*` becomes executable by `anon, authenticated`;
  - files in `supabase/tests/` contain no psql meta-commands, because they also run in production through MCP.
- **Year of a result:** `data.event.date.slice(0, 4)`.
  - The filter lives in the URL as `?ano=AAAA`.
  - A missing value, or one that is not in the page's year list, means "Carreira" (the whole career).
- **Ranking filter:** `?sexo=M|F`; anything else means "Geral".
- **Query:**
  - `usePublicStats()`: query key `['pub-stats']`, `staleTime` 5 min, `refetchOnWindowFocus: true`;
  - load error: "Não foi possível carregar os atletas." plus the button "Tentar novamente"; an `ApiError` shows its own message.
- **Routes:**
  - `#/perfis`, `#/atleta/:athleteId`, `#/comparar/:a/:b` and `#/ranking`, all `React.lazy` (Ruling 30);
  - the timekeeper chunk must not grow.
- **Compatibility:** `pub_athlete` and `api.pub.athlete` stay (Ruling 26: old PWA builds still call them).
- **Test IDs (exact):**
  - navigation: `public-nav-events`, `public-nav-athletes`, `public-nav-ranking`;
  - directory: `public-athletes`, `athlete-search`, `athlete-row`;
  - profile and filters: `year-filter`, `compare-with`, `compare-picker`, `sex-filter`;
  - compare page: `public-compare`, `compare-side-by-side`, `compare-together`, `compare-head-to-head`;
  - ranking page: `public-ranking`;
  - kept from before: `public-athlete`.
- **Commits** are conventional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) and end with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Where to run what:**
  - on Windows: `npm run typecheck`, `npx vitest run` and `npm run build`;
  - on Linux (WSL2 Ubuntu 24.04, see README "Rodando localmente"): `bash scripts/test-sql.sh`, `npm run test:integration` and `bash tests/e2e/run.sh`.
- **Branch:** `feat/public-stats` (already created from `main`; the spec lives there). Never commit to `main`.

## Review Focus

1. **A garbage or foreign `?ano=`** (`?ano=abc`, or a year in which this athlete never raced): the page shows "Carreira" and career numbers instead of empty stats. Owned by Task 5 (profile) and Task 6 (compare).
2. **A head-to-head where both share the same overall position** (a tie): it is listed as "sem decisão" and scores for nobody, instead of being credited to one side. Owned by Task 3.
3. **km totals computed from float sums**: 100 m + 200 m must tie with one 300 m leg, so totals are summed in integer meters before ranking. Owned by Task 4.
4. **Search with surrounding spaces, capitals and accents** (`"  JOAO "`): it still finds "João Núñez". Owned by Task 5.
5. **Phone width (390 px):** the new pages (`#/perfis`, `#/atleta/:id`, `#/comparar/:a/:b`, `#/ranking`) never scroll sideways. Owned by Task 8 (E2E `no_hscroll`).

---

### Task 1: `pub_stats()` in the database

**Files:**
- Create: `supabase/migrations/0010_pub_stats.sql`
- Create: `supabase/tests/70_pub_stats.sql`
- Modify: `tests/integration/flow.test.ts` (new step after step 9)

**Interfaces:**
- Consumes: tables `public.athletes`, `public.events`, `public.results`; the existing `public.pub_athlete(uuid)`.
- Produces: `public.pub_stats() returns jsonb`, shaped `{ "athletes": [{id,name,sex,city,team_club}], "results": [<public.results row as to_jsonb>] }`, executable by `anon`.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/70_pub_stats.sql`.

  The assertions are scoped to the fixture ids, so the file also runs in production (inside `begin … rollback`) next to real data.

```sql
begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.as_user(tests.get('owner')::uuid);

-- Fixtures (spec §4.1/§7): public event P (2026-05-10) with a solo race R1 and a relay R2; an
-- older public event O (2025-03-01) with a solo race R3; a private event Q (2026-06-01) with a
-- solo race R4. Athletes: Ana (public, with e-mail/phone/birth date/notes), Beto (public), Caio
-- and Duda (private). Results: R1 Ana (in) and Caio alone (out: no public athlete); R2 Beto+Duda
-- (in: one public member); R3 Beto (in, older event); R4 Ana (out: private event).
do $$ declare
  p jsonb; o jsonb; q jsonb; r1 uuid; r2 uuid; r3 uuid; r4 uuid;
  ana uuid; beto uuid; caio uuid; duda uuid;
  e_ana1 jsonb; e_caio1 jsonb; e_team2 jsonb; e_beto3 jsonb; e_ana4 jsonb;
  dp jsonb; dop jsonb; dq jsonb;
begin
  p := public.admin_save_event('{"name":"Copa Pública","date":"2026-05-10","is_public":true}');
  o := public.admin_save_event('{"name":"Copa Antiga","date":"2025-03-01","is_public":true}');
  q := public.admin_save_event('{"name":"Copa Privada","date":"2026-06-01","is_public":false}');
  perform tests.set('ev_p', p ->> 'id'); perform tests.set('ev_o', o ->> 'id'); perform tests.set('ev_q', q ->> 'id');
  r1 := (public.admin_save_race(jsonb_build_object('event_id', p ->> 'id', 'name', 'Corrida', 'team_size', 1,
          'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;
  r2 := (public.admin_save_race(jsonb_build_object('event_id', p ->> 'id', 'name', 'Revezamento', 'team_size', 2,
          'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;
  r3 := (public.admin_save_race(jsonb_build_object('event_id', o ->> 'id', 'name', 'Corrida', 'team_size', 1,
          'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;
  r4 := (public.admin_save_race(jsonb_build_object('event_id', q ->> 'id', 'name', 'Corrida', 'team_size', 1,
          'legs', '[{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb)) -> 'race' ->> 'id')::uuid;

  ana := (public.admin_save_athlete('{"name":"Ana","sex":"F","email":"ana@x.com","phone":"27999990000","birth_date":"1990-06-15","notes":"segredo-da-org"}') ->> 'id')::uuid;
  beto := (public.admin_save_athlete('{"name":"Beto","sex":"M","city":"Vitória","team_club":"Tubarões"}') ->> 'id')::uuid;
  caio := (public.admin_save_athlete('{"name":"Caio","sex":"M","public_profile":false}') ->> 'id')::uuid;
  duda := (public.admin_save_athlete('{"name":"Duda","sex":"F","public_profile":false}') ->> 'id')::uuid;
  perform tests.set('ana', ana::text); perform tests.set('beto', beto::text);
  perform tests.set('caio', caio::text); perform tests.set('duda', duda::text);

  e_ana1 := public.admin_save_entry(jsonb_build_object('race_id', r1, 'members', jsonb_build_array(jsonb_build_object('athlete_id', ana))));
  e_caio1 := public.admin_save_entry(jsonb_build_object('race_id', r1, 'members', jsonb_build_array(jsonb_build_object('athlete_id', caio))));
  e_team2 := public.admin_save_entry(jsonb_build_object('race_id', r2, 'team_name', 'Mista', 'members', jsonb_build_array(
               jsonb_build_object('athlete_id', beto, 'legs', jsonb_build_array(0)),
               jsonb_build_object('athlete_id', duda, 'legs', jsonb_build_array(1)))));
  e_beto3 := public.admin_save_entry(jsonb_build_object('race_id', r3, 'members', jsonb_build_array(jsonb_build_object('athlete_id', beto))));
  e_ana4 := public.admin_save_entry(jsonb_build_object('race_id', r4, 'members', jsonb_build_array(jsonb_build_object('athlete_id', ana))));
  perform tests.set('e_ana1', e_ana1 ->> 'id'); perform tests.set('e_team2', e_team2 ->> 'id'); perform tests.set('e_beto3', e_beto3 ->> 'id');

  -- `data` carries the event date that pub_stats orders by (a real snapshot carries much more).
  dp := jsonb_build_object('event', jsonb_build_object('id', p ->> 'id', 'name', 'Copa Pública', 'date', '2026-05-10'));
  dop := jsonb_build_object('event', jsonb_build_object('id', o ->> 'id', 'name', 'Copa Antiga', 'date', '2025-03-01'));
  dq := jsonb_build_object('event', jsonb_build_object('id', q ->> 'id', 'name', 'Copa Privada', 'date', '2026-06-01'));
  perform public.admin_finalize_race(r1, jsonb_build_array(
    jsonb_build_object('entry_id', e_ana1 ->> 'id', 'athlete_ids', jsonb_build_array(ana), 'status', 'finished', 'final_ms', 1500000, 'overall_pos', 1, 'data', dp),
    jsonb_build_object('entry_id', e_caio1 ->> 'id', 'athlete_ids', jsonb_build_array(caio), 'status', 'finished', 'final_ms', 1600000, 'overall_pos', 2, 'data', dp)));
  perform public.admin_finalize_race(r2, jsonb_build_array(
    jsonb_build_object('entry_id', e_team2 ->> 'id', 'athlete_ids', jsonb_build_array(beto, duda), 'status', 'finished', 'final_ms', 2400000, 'overall_pos', 1, 'data', dp)));
  perform public.admin_finalize_race(r3, jsonb_build_array(
    jsonb_build_object('entry_id', e_beto3 ->> 'id', 'athlete_ids', jsonb_build_array(beto), 'status', 'finished', 'final_ms', 1550000, 'overall_pos', 1, 'data', dop)));
  perform public.admin_finalize_race(r4, jsonb_build_array(
    jsonb_build_object('entry_id', e_ana4 ->> 'id', 'athlete_ids', jsonb_build_array(ana), 'status', 'finished', 'final_ms', 1400000, 'overall_pos', 1, 'data', dq)));
end $$;

reset role;
select tests.as_anon();
do $$ declare s jsonb; a jsonb; names text[]; got text[]; fixture_athletes text[]; fixture_events text[]; begin
  s := public.pub_stats();
  fixture_athletes := array[tests.get('ana'), tests.get('beto'), tests.get('caio'), tests.get('duda')];
  fixture_events := array[tests.get('ev_p'), tests.get('ev_o'), tests.get('ev_q')];

  -- athletes: of the fixtures, only the public ones, by name, with exactly pub_athlete's fields
  names := (select array_agg(x ->> 'name' order by n) from jsonb_array_elements(s -> 'athletes') with ordinality t(x, n)
            where x ->> 'id' = any(fixture_athletes));
  assert names = array['Ana', 'Beto'], 'public fixture athletes by name, got ' || coalesce(names::text, '<none>');
  for a in select x from jsonb_array_elements(s -> 'athletes') x loop
    assert a = public.pub_athlete((a ->> 'id')::uuid) -> 'athlete', 'athlete fields must equal pub_athlete''s, got ' || a::text;
  end loop;
  assert position('ana@x.com' in s::text) = 0 and position('27999990000' in s::text) = 0
     and position('1990-06-15' in s::text) = 0 and position('segredo-da-org' in s::text) = 0
     and position('public_profile' in s::text) = 0,
    'pub_stats must not carry e-mail, phone, birth date, notes or the public_profile flag';

  -- results of the fixtures: newest event first; Caio alone and the private event stay out
  got := (select array_agg(x ->> 'entry_id' order by n) from jsonb_array_elements(s -> 'results') with ordinality t(x, n)
          where x ->> 'event_id' = any(fixture_events));
  assert array_length(got, 1) = 3, 'expected Ana R1, the Beto+Duda team and Beto R3, got ' || coalesce(got::text, '<none>');
  assert got[3] = tests.get('e_beto3'), 'the older event''s result comes last, got ' || got::text;
  assert (select array_agg(v order by v) from unnest(got[1:2]) v)
       = (select array_agg(v order by v) from unnest(array[tests.get('e_ana1'), tests.get('e_team2')]) v),
    'the 2026 results come first (Ana R1, the Beto+Duda team), got ' || got::text;

  -- the privacy rule (spec §4.1): results == the union of pub_athlete(id) results over the public athletes
  assert (select jsonb_agg(x order by x ->> 'race_id', x ->> 'entry_id') from jsonb_array_elements(s -> 'results') x)
       is not distinct from
         (select jsonb_agg(u.x order by u.x ->> 'race_id', u.x ->> 'entry_id') from (
            select distinct x from jsonb_array_elements(s -> 'athletes') pa,
                   lateral jsonb_array_elements(public.pub_athlete((pa ->> 'id')::uuid) -> 'results') x) u),
    'pub_stats results must be exactly the union of pub_athlete results';
end $$;
-- the 60_security matrix already checks every pub_* by name; this pins the new function.
do $$ begin assert has_function_privilege('anon', 'public.pub_stats()', 'execute'), 'anon must execute pub_stats'; end $$;
reset role;
rollback;
```

- [ ] **Step 2: Run it and confirm it fails.**
  - Run (Linux/WSL): `EBC_DB=ebc_pubstats bash scripts/test-sql.sh`
  - Expected: `FAIL supabase/tests/70_pub_stats.sql` with `function public.pub_stats() does not exist`; every other file PASS.

- [ ] **Step 3: Write the migration** `supabase/migrations/0010_pub_stats.sql`.

```sql
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
```

- [ ] **Step 4: Run the SQL suite again.**
  - Run (Linux/WSL): `EBC_DB=ebc_pubstats bash scripts/test-sql.sh`
  - Expected: every file PASS, including `60_security.sql`, whose A-M6 matrix now also sees `pub_stats`.

- [ ] **Step 5: Add the integration step** in `tests/integration/flow.test.ts`, right after the `it('9. finalizes the relay race …')` block.

  At that point the event is public (step 8) and Ana and Beto have the default `public_profile = true`.

```ts
  it('9b. pub_stats (anon) carries the public athletes and the finalized result, never private fields', async () => {
    const { data, error } = await anon().rpc('pub_stats');
    expect(error).toBeNull();
    const ids = data.athletes.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([anaId, betoId]));
    for (const a of data.athletes) expect(Object.keys(a).sort()).toEqual(['city', 'id', 'name', 'sex', 'team_club']);
    expect(data.results.map((r: { entry_id: string }) => r.entry_id)).toContain(teamEntryId);
  });
```

- [ ] **Step 6: Run the integration suite.**
  - Run (Linux/WSL): `npm run test:integration`
  - Expected: PASS (17 tests).

- [ ] **Step 7: Commit.**

```bash
git add supabase/migrations/0010_pub_stats.sql supabase/tests/70_pub_stats.sql tests/integration/flow.test.ts
git commit -m "feat(db): pub_stats, the public bundle for athlete profiles and club stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client foundations (text/format helpers, types and API, year helpers, qualifying legs, test builder)

**Files:**
- Create: `src/lib/text.ts`, `src/lib/text.test.ts`
- Modify:
  - `src/features/entries/entryFormState.ts:153-157`: the `foldAccents` function becomes a re-export;
  - `src/features/athletes/AthletesPage.tsx:11-13`: the local copy is dropped and the helper imported;
  - `src/lib/format.ts`: adds `formatDistance` and `formatKm`;
  - `src/lib/format.test.ts`;
  - `src/features/athletes/StatsView.tsx:35-46`: its local `formatDistance`/`formatKm` are replaced by the imports;
  - `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/api.test.ts`;
  - `src/domain/stats.ts`, `src/domain/stats.test.ts`.
- Create: `src/domain/testing/results.ts`

**Interfaces:**
- Produces:
  - `foldAccents(s: string): string` from `src/lib/text.ts`;
  - `formatDistance(m: number): string` ("750 m", "5 km", "21,1 km") and `formatKm(km: number): string` ("10,75 km") from `src/lib/format.ts`;
  - `type PublicAthleteRow = Pick<AthleteRow, 'id'|'name'|'sex'|'city'|'team_club'>` and `interface PubStatsPayload { athletes: PublicAthleteRow[]; results: ResultRow[] }` from `src/lib/types.ts`;
  - `api.pub.stats(): Promise<PubStatsPayload>`, which calls RPC `pub_stats` with no params;
  - from `src/domain/stats.ts`:
    - `interface QualifyingLeg { athlete_id: string; modality: Modality; distance_m: number; time_ms: number; label: string; date: string; event_name: string }`;
    - `qualifyingLegs(results: ResultRow[]): QualifyingLeg[]`;
    - `resultYear(r: ResultRow): string`;
    - `resultYears(results: ResultRow[]): string[]` (newest first);
    - `filterResultsByYear(results: ResultRow[], year: string | null): ResultRow[]`;
    - `participationCounts(results: ResultRow[]): Map<string, number>`;
  - `makeResult(spec: ResultSpec): ResultRow` from `src/domain/testing/results.ts`, a test-only builder.

- [ ] **Step 1: Write the failing tests.**

`src/lib/text.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { foldAccents } from './text';

describe('foldAccents', () => {
  it('drops accents and case', () => {
    expect(foldAccents('João Núñez')).toBe('joao nunez');
    expect(foldAccents('ÂNGELA')).toBe('angela');
  });
});
```

Append to `src/lib/format.test.ts`, and add `formatDistance, formatKm` to its import from `./format`:
```ts
describe('distances (moved from StatsView for the public pages)', () => {
  it('formats meters and km in pt-BR', () => {
    expect(formatDistance(750)).toBe('750 m');
    expect(formatDistance(5000)).toBe('5 km');
    expect(formatDistance(21097)).toBe('21,1 km');
    expect(formatKm(10.75)).toBe('10,75 km');
    expect(formatKm(6)).toBe('6 km');
  });
});
```

In `src/lib/api.test.ts`, add one row to the `it.each` table, right after the `'pub.athlete'` row:
```ts
    ['pub.stats', () => api.pub.stats(), 'pub_stats', undefined],
```

Append to `src/domain/stats.test.ts`:
- change its first import to `import { computeAthleteStats, filterResultsByYear, participationCounts, qualifyingLegs, resultYears } from './stats';`;
- add `import { makeResult } from './testing/results';`.

```ts
describe('year helpers (spec §5.1)', () => {
  const r2025 = makeResult({ race_id: 'r1', entry_id: 'e1', date: '2025-11-02', members: [{ athlete_id: 'a1', name: 'Ana' }], final_ms: 1_500_000, overall_pos: 1 });
  const r2026a = makeResult({ race_id: 'r2', entry_id: 'e2', date: '2026-03-10', members: [{ athlete_id: 'a1', name: 'Ana' }], final_ms: 1_450_000, overall_pos: 2 });
  const r2026b = makeResult({ race_id: 'r3', entry_id: 'e3', date: '2026-09-01', members: [{ athlete_id: 'a2', name: 'Bia' }], status: 'dns' });

  it('lists the distinct years newest first', () => {
    expect(resultYears([r2025, r2026a, r2026b])).toEqual(['2026', '2025']);
    expect(resultYears([])).toEqual([]);
  });
  it('filters by year; null is the whole career', () => {
    expect(filterResultsByYear([r2025, r2026a, r2026b], '2025')).toEqual([r2025]);
    expect(filterResultsByYear([r2025, r2026a, r2026b], null)).toHaveLength(3);
  });
  it('counts participations per athlete with the §10 rule (DNS and not started do not count)', () => {
    const team = makeResult({ race_id: 'r4', entry_id: 'e4', date: '2026-05-05', members: [{ athlete_id: 'a1', name: 'Ana' }, { athlete_id: 'a2', name: 'Bia' }], status: 'dnf' });
    const counts = participationCounts([r2025, r2026a, r2026b, team]);
    expect(counts.get('a1')).toBe(3);
    expect(counts.get('a2')).toBe(1); // her DNS does not count, the team DNF does
  });
});

describe('qualifyingLegs (shared by the profile and the club records)', () => {
  it('keeps timed legs with a distance and an athlete, never a DSQ result', () => {
    const ok = makeResult({
      race_id: 'r1', entry_id: 'e1', date: '2026-03-10', members: [{ athlete_id: 'a1', name: 'Ana' }, { athlete_id: 'a2', name: 'Bia' }],
      final_ms: 2_400_000, overall_pos: 1,
      legs: [
        { athlete_id: 'a1', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 750_000 },
        { athlete_id: null, modality: 'run', label: 'Corrida', distance_m: 5000, time_ms: 1_650_000 },
      ],
    });
    const noDistance = makeResult({
      race_id: 'r2', entry_id: 'e2', date: '2026-04-01', members: [{ athlete_id: 'a1', name: 'Ana' }], final_ms: 600_000, overall_pos: 1,
      legs: [{ athlete_id: 'a1', modality: 'other', label: 'Outro', distance_m: null, time_ms: 600_000 }],
    });
    const zero = makeResult({
      race_id: 'r3', entry_id: 'e3', date: '2026-05-01', members: [{ athlete_id: 'a1', name: 'Ana' }], status: 'finished', final_ms: 0,
      legs: [{ athlete_id: 'a1', time_ms: 0 }],
    });
    const dsq = makeResult({ race_id: 'r4', entry_id: 'e4', date: '2026-06-01', members: [{ athlete_id: 'a2', name: 'Bia' }], status: 'dsq', final_ms: 1_200_000 });
    expect(qualifyingLegs([ok, noDistance, zero, dsq])).toEqual([
      { athlete_id: 'a1', modality: 'swim', distance_m: 750, time_ms: 750_000, label: 'Natação', date: '2026-03-10', event_name: 'Evento 2026-03-10' },
    ]);
  });
});
```

- [ ] **Step 2: Create the test builder** `src/domain/testing/results.ts`. The tests above import it, so they fail on the missing `stats.ts` exports, not on a missing module.

```ts
import type { EntrySex, Modality, ResultRow, ResultSnapshot, SnapshotStatus } from '../../lib/types';

export interface ResultLegSpec { athlete_id: string | null; modality?: Modality; label?: string; distance_m?: number | null; time_ms: number | null }
export interface ResultSpec {
  race_id: string; entry_id: string; date: string;
  members: { athlete_id: string; name: string }[];
  event?: string; race?: string; team_name?: string | null; sex?: EntrySex;
  legs?: ResultLegSpec[]; status?: SnapshotStatus; final_ms?: number | null; overall_pos?: number | null;
  finishers?: number; podiums?: ResultSnapshot['podiums'];
}

/**
 * A finalized result row (spec §10 snapshot) for domain and UI tests. Defaults: event
 * "Evento <date>", race "Corrida 5 km", one run 5 km leg by the first member timed at `final_ms`,
 * status finished when `final_ms` is set (else dnf), 10 finishers, no podium, team name "Equipe"
 * for more than one member.
 */
export function makeResult(s: ResultSpec): ResultRow {
  const final_ms = s.final_ms ?? null;
  const status: SnapshotStatus = s.status ?? (final_ms !== null ? 'finished' : 'dnf');
  const legs = (s.legs ?? [{ athlete_id: s.members[0]?.athlete_id ?? null, time_ms: final_ms }]).map((l, i) => ({
    leg_index: i,
    modality: l.modality ?? 'run',
    label: l.label ?? 'Corrida',
    distance_m: l.distance_m === undefined ? 5000 : l.distance_m,
    athlete_id: l.athlete_id,
    time_ms: l.time_ms,
  }));
  const data: ResultSnapshot = {
    event: { id: `ev-${s.date}`, name: s.event ?? `Evento ${s.date}`, date: s.date },
    race: { id: s.race_id, name: s.race ?? 'Corrida 5 km', team_size: s.members.length },
    bib: '1',
    team_name: s.team_name ?? (s.members.length > 1 ? 'Equipe' : null),
    members: s.members.map((m) => ({
      athlete_id: m.athlete_id, name: m.name,
      legs: legs.filter((l) => l.athlete_id === m.athlete_id).map((l) => l.leg_index),
    })),
    legs,
    category: { sex: s.sex ?? 'F', age: null, age_group: null, level: null },
    status, total_ms: final_ms, penalty_ms: 0, final_ms,
    positions: { overall: s.overall_pos ?? null, sex: null, finishers: s.finishers ?? 10 },
    podiums: s.podiums ?? [],
  };
  return {
    race_id: s.race_id, entry_id: s.entry_id, event_id: data.event.id, athlete_ids: s.members.map((m) => m.athlete_id),
    status, final_ms, overall_pos: s.overall_pos ?? null, data, finalized_at: `${s.date}T20:00:00Z`,
  };
}
```

- [ ] **Step 3: Run the tests and confirm they fail.**
  - Run: `npx vitest run src/lib src/domain/stats.test.ts`
  - Expected: FAIL. `./text` cannot be resolved; `formatDistance`, `resultYears` and the others are not exported; `api.pub.stats` is not a function.

- [ ] **Step 4: Implement.**

`src/lib/text.ts`:
```ts
/** Diacritic- and case-insensitive fold for name searches ("joao" must find "João"). Shared by the
 * organizer screens and the public pages (so a public chunk never imports the entries feature). */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
```

`src/features/entries/entryFormState.ts`: replace the `foldAccents` function and its doc comment (lines 153-157) with:
```ts
export { foldAccents } from '../../lib/text';
```

`src/features/athletes/AthletesPage.tsx`: delete the local `function foldAccents` (lines 11-13) and add `import { foldAccents } from '../../lib/text';`.

`src/lib/format.ts`: append:
```ts
/** A leg distance for display: "750 m", "5 km", "21,1 km" (pt-BR decimals, at most 2). */
export function formatDistance(m: number): string {
  if (m >= 1000) {
    const km = m / 1000;
    const value = Number.isInteger(km) ? String(km) : km.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    return `${value} km`;
  }
  return `${m} m`;
}

/** A km total for display: "10,75 km". */
export function formatKm(km: number): string {
  return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`;
}
```

`src/features/athletes/StatsView.tsx`: delete the local `formatDistance` and `formatKm` functions (lines 35-46), and change the format import to `import { formatDateBR, formatDistance, formatDuration, formatKm } from '../../lib/format';`.

`src/lib/types.ts`: next to `AthleteProfile`, add:
```ts
/** 0010: an athlete as the public pages see it (exactly pub_athlete's fields, never private ones). */
export type PublicAthleteRow = Pick<AthleteRow, 'id' | 'name' | 'sex' | 'city' | 'team_club'>;
/** 0010 pub_stats(): the public athletes and every finalized result of a public event that has at
 * least one of them (spec 2026-09-28 §4.1). */
export interface PubStatsPayload { athletes: PublicAthleteRow[]; results: ResultRow[] }
```

`src/lib/api.ts`:
- in the `pub:` block of the `Api` interface, add `stats(): Promise<PubStatsPayload>;`;
- in the implementation's `pub:` object, add `stats: () => call('pub_stats'),`;
- import `PubStatsPayload` with the other types.

`src/domain/stats.ts`:
- replace the `OwnLeg` interface and the `ownLegs` function with the block below;
- in `computeAthleteStats`, replace `const legs = ownLegs(athleteId, results);` with `const legs = qualifyingLegs(results).filter(l => l.athlete_id === athleteId);`.
```ts
/** A leg an athlete personally ran with a known time and distance: a "qualifying" leg for the
 * profile's records/pace/km/evolution and for the club records (clubStats.ts). A disqualified
 * result never qualifies, nor does a leg time that is zero or negative (a finalized `order` error)
 * — B1-M3. */
export interface QualifyingLeg { athlete_id: string; modality: Modality; distance_m: number; time_ms: number; label: string; date: string; event_name: string }

export function qualifyingLegs(results: ResultRow[]): QualifyingLeg[] {
  const legs: QualifyingLeg[] = [];
  for (const r of results) {
    if (r.status === 'dsq') continue;
    for (const leg of r.data.legs) {
      if (leg.athlete_id == null) continue;
      if (leg.time_ms == null || leg.time_ms <= 0 || leg.distance_m == null) continue;
      legs.push({
        athlete_id: leg.athlete_id, modality: leg.modality, distance_m: leg.distance_m, time_ms: leg.time_ms,
        label: leg.label, date: r.data.event.date, event_name: r.data.event.name,
      });
    }
  }
  return legs;
}

/** The calendar year of a result (its event date, "AAAA-MM-DD"). */
export function resultYear(r: ResultRow): string {
  return r.data.event.date.slice(0, 4);
}

/** The distinct years with results, newest first (spec 2026-09-28 §5.1). */
export function resultYears(results: ResultRow[]): string[] {
  return [...new Set(results.map(resultYear))].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** The results of `year`; null = the whole career. */
export function filterResultsByYear(results: ResultRow[], year: string | null): ResultRow[] {
  return year === null ? results : results.filter(r => resultYear(r) === year);
}

/** Participations per athlete id with §10's rule (every status but DNS / not started counts). */
export function participationCounts(results: ResultRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.status === 'dns' || r.status === 'not_started') continue;
    for (const id of r.athlete_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
```

- [ ] **Step 5: Run the tests, typecheck and the full suite.**
  - Run: `npm run typecheck && npx vitest run`
  - Expected: typecheck clean; every test passes. The existing `computeAthleteStats`, StatsView and entries tests are unchanged and must stay green.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/text.ts src/lib/text.test.ts src/lib/format.ts src/lib/format.test.ts src/lib/types.ts src/lib/api.ts src/lib/api.test.ts src/domain/stats.ts src/domain/stats.test.ts src/domain/testing/results.ts src/features/entries/entryFormState.ts src/features/athletes/AthletesPage.tsx src/features/athletes/StatsView.tsx
git commit -m "feat: client foundations for public stats (pub.stats, year helpers, qualifying legs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: "Nós dois" calculations (together, head-to-head)

**Files:**
- Create: `src/domain/pairStats.ts`, `src/domain/pairStats.test.ts`

**Interfaces:**
- Consumes: `computeAthleteStats`, `AthleteStats` (`src/domain/stats.ts`); `makeResult` (tests).
- Produces:
  - `type TogetherSummary = Pick<AthleteStats, 'participations'|'finishes'|'wins_overall'|'wins_category'|'podiums'|'best_overall_pos'|'avg_percentile'>`;
  - `interface TogetherRace { race_id; entry_id; event_name; event_date; race_name; team_name: string|null; status: SnapshotStatus; final_ms: number|null; overall_pos: number|null; finishers: number; members: { athlete_id; name; legs: { label: string; time_ms: number|null }[] }[] }`;
  - `interface TogetherStats { summary: TogetherSummary; races: TogetherRace[] }`;
  - `computeTogether(a: string, b: string, results: ResultRow[]): TogetherStats | null`;
  - `interface HeadToHeadSide { entry_id: string; status: SnapshotStatus; final_ms: number|null; overall_pos: number|null }`;
  - `interface HeadToHeadRace { race_id; event_name; event_date; race_name; a: HeadToHeadSide; b: HeadToHeadSide; winner: 'a'|'b'|null; diff_ms: number|null }`;
  - `interface HeadToHead { a_wins: number; b_wins: number; no_decision: number; races: HeadToHeadRace[] }`;
  - `computeHeadToHead(a: string, b: string, results: ResultRow[]): HeadToHead | null`.

- [ ] **Step 1: Write the failing test** `src/domain/pairStats.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { computeHeadToHead, computeTogether } from './pairStats';
import { makeResult } from './testing/results';

const ANA = { athlete_id: 'a', name: 'Ana' };
const BETO = { athlete_id: 'b', name: 'Beto' };
const CAIO = { athlete_id: 'c', name: 'Caio' };

describe('computeTogether (spec §5.2)', () => {
  const relayWin = makeResult({
    race_id: 'r1', entry_id: 'e1', date: '2026-03-10', race: 'Revezamento', team_name: 'Tubarões',
    members: [ANA, BETO], final_ms: 2_400_000, overall_pos: 1, finishers: 8,
    podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Geral', podium_pos: 1 }],
    legs: [
      { athlete_id: 'a', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 },
      { athlete_id: 'b', label: 'Corrida', time_ms: 1_600_000 },
    ],
  });
  const relayDnf = makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-09-01', race: 'Revezamento', team_name: 'Tubarões',
    members: [ANA, BETO], status: 'dnf', legs: [{ athlete_id: 'a', time_ms: 900_000 }, { athlete_id: 'b', time_ms: null }],
  });
  const anaWithCaio = makeResult({ race_id: 'r3', entry_id: 'e3', date: '2026-05-01', members: [ANA, CAIO], final_ms: 2_000_000, overall_pos: 2 });
  const anaSolo = makeResult({ race_id: 'r4', entry_id: 'e4', date: '2026-06-01', members: [ANA], final_ms: 1_500_000, overall_pos: 1 });

  it('summarizes only the results where both were in the same entry', () => {
    const t = computeTogether('a', 'b', [relayWin, relayDnf, anaWithCaio, anaSolo])!;
    expect(t.summary).toEqual({ participations: 2, finishes: 1, wins_overall: 1, wins_category: 1, podiums: 1, best_overall_pos: 1, avg_percentile: 1 / 8 });
  });
  it('lists the races newest first with each member own legs', () => {
    const t = computeTogether('a', 'b', [relayWin, relayDnf])!;
    expect(t.races.map((r) => r.entry_id)).toEqual(['e2', 'e1']);
    expect(t.races[1]).toMatchObject({ race_name: 'Revezamento', team_name: 'Tubarões', status: 'finished', final_ms: 2_400_000, overall_pos: 1, finishers: 8 });
    expect(t.races[1].members).toEqual([
      { athlete_id: 'a', name: 'Ana', legs: [{ label: 'Natação', time_ms: 800_000 }] },
      { athlete_id: 'b', name: 'Beto', legs: [{ label: 'Corrida', time_ms: 1_600_000 }] },
    ]);
  });
  it('is null when they never shared an entry', () => {
    expect(computeTogether('a', 'b', [anaWithCaio, anaSolo])).toBeNull();
  });
});

describe('computeHeadToHead (spec §5.3)', () => {
  const results = [
    // r1: both placed -> a (2nd) beats b (5th) by 30 s
    makeResult({ race_id: 'r1', entry_id: 'r1a', date: '2026-01-10', members: [ANA], final_ms: 1_500_000, overall_pos: 2 }),
    makeResult({ race_id: 'r1', entry_id: 'r1b', date: '2026-01-10', members: [BETO], final_ms: 1_530_000, overall_pos: 5 }),
    // r2: b placed, a DNF -> b wins, no difference
    makeResult({ race_id: 'r2', entry_id: 'r2a', date: '2026-02-10', members: [ANA], status: 'dnf' }),
    makeResult({ race_id: 'r2', entry_id: 'r2b', date: '2026-02-10', members: [BETO], final_ms: 1_600_000, overall_pos: 3 }),
    // r3: both DNF -> no decision
    makeResult({ race_id: 'r3', entry_id: 'r3a', date: '2026-03-10', members: [ANA], status: 'dnf' }),
    makeResult({ race_id: 'r3', entry_id: 'r3b', date: '2026-03-10', members: [BETO], status: 'dnf' }),
    // r4: a shared position (a tie) -> no decision, difference 0 (Review Focus 2)
    makeResult({ race_id: 'r4', entry_id: 'r4a', date: '2026-04-10', members: [ANA], final_ms: 1_400_000, overall_pos: 4 }),
    makeResult({ race_id: 'r4', entry_id: 'r4b', date: '2026-04-10', members: [BETO], final_ms: 1_400_000, overall_pos: 4 }),
    // r5: b DNS -> not a confrontation
    makeResult({ race_id: 'r5', entry_id: 'r5a', date: '2026-05-10', members: [ANA], final_ms: 1_450_000, overall_pos: 1 }),
    makeResult({ race_id: 'r5', entry_id: 'r5b', date: '2026-05-10', members: [BETO], status: 'dns' }),
    // r6: the same entry (a team) -> "together", not a confrontation
    makeResult({ race_id: 'r6', entry_id: 'r6ab', date: '2026-06-10', members: [ANA, BETO], final_ms: 2_000_000, overall_pos: 1 }),
    // r7: a DSQ with a time, b placed -> b wins; both have final_ms, so the difference shows
    makeResult({ race_id: 'r7', entry_id: 'r7a', date: '2026-07-10', members: [ANA], status: 'dsq', final_ms: 1_300_000 }),
    makeResult({ race_id: 'r7', entry_id: 'r7b', date: '2026-07-10', members: [BETO], final_ms: 1_350_000, overall_pos: 1 }),
    // r8: only a ran -> nothing
    makeResult({ race_id: 'r8', entry_id: 'r8a', date: '2026-08-10', members: [ANA], final_ms: 1_500_000, overall_pos: 1 }),
  ];

  it('scores the races where both started in their own entries, newest first', () => {
    const h = computeHeadToHead('a', 'b', results)!;
    expect({ a: h.a_wins, b: h.b_wins, none: h.no_decision }).toEqual({ a: 1, b: 2, none: 2 });
    expect(h.races.map((r) => [r.race_id, r.winner, r.diff_ms])).toEqual([
      ['r7', 'b', 50_000], ['r4', null, 0], ['r3', null, null], ['r2', 'b', null], ['r1', 'a', 30_000],
    ]);
    expect(h.races[4]).toMatchObject({ a: { entry_id: 'r1a', overall_pos: 2 }, b: { entry_id: 'r1b', overall_pos: 5 } });
  });
  it('is null without a race in common', () => {
    expect(computeHeadToHead('a', 'b', [results[0], results[13]])).toBeNull();
    expect(computeHeadToHead('a', 'c', results)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**
  - Run: `npx vitest run src/domain/pairStats.test.ts`
  - Expected: FAIL, because `./pairStats` cannot be resolved.

- [ ] **Step 3: Implement** `src/domain/pairStats.ts`.

```ts
import type { ResultRow, SnapshotStatus } from '../lib/types';
import { computeAthleteStats } from './stats';
import type { AthleteStats } from './stats';

export type TogetherSummary = Pick<AthleteStats, 'participations' | 'finishes' | 'wins_overall' | 'wins_category' | 'podiums' | 'best_overall_pos' | 'avg_percentile'>;
export interface TogetherRace {
  race_id: string; entry_id: string; event_name: string; event_date: string; race_name: string;
  team_name: string | null; status: SnapshotStatus; final_ms: number | null; overall_pos: number | null; finishers: number;
  members: { athlete_id: string; name: string; legs: { label: string; time_ms: number | null }[] }[];
}
export interface TogetherStats { summary: TogetherSummary; races: TogetherRace[] }

export interface HeadToHeadSide { entry_id: string; status: SnapshotStatus; final_ms: number | null; overall_pos: number | null }
export interface HeadToHeadRace {
  race_id: string; event_name: string; event_date: string; race_name: string;
  a: HeadToHeadSide; b: HeadToHeadSide; winner: 'a' | 'b' | null; diff_ms: number | null;
}
export interface HeadToHead { a_wins: number; b_wins: number; no_decision: number; races: HeadToHeadRace[] }

/** Newest event first, then race name (pt-BR). */
function byDateDesc(x: { event_date: string; race_name: string }, y: { event_date: string; race_name: string }): number {
  if (x.event_date !== y.event_date) return x.event_date < y.event_date ? 1 : -1;
  return x.race_name.localeCompare(y.race_name, 'pt-BR');
}

/**
 * Spec 2026-09-28 §5.2: the results where `a` and `b` were in the same entry (a team). The summary
 * uses §10's definitions through computeAthleteStats, so it matches the profiles; the numbers are
 * the entry's, identical for both members. null when they never shared an entry.
 */
export function computeTogether(a: string, b: string, results: ResultRow[]): TogetherStats | null {
  const together = results.filter(r => r.athlete_ids.includes(a) && r.athlete_ids.includes(b));
  if (together.length === 0) return null;
  const s = computeAthleteStats(a, together);
  const summary: TogetherSummary = {
    participations: s.participations, finishes: s.finishes, wins_overall: s.wins_overall, wins_category: s.wins_category,
    podiums: s.podiums, best_overall_pos: s.best_overall_pos, avg_percentile: s.avg_percentile,
  };
  const races: TogetherRace[] = together.map(r => ({
    race_id: r.race_id, entry_id: r.entry_id, event_name: r.data.event.name, event_date: r.data.event.date,
    race_name: r.data.race.name, team_name: r.data.team_name, status: r.status, final_ms: r.final_ms,
    overall_pos: r.overall_pos, finishers: r.data.positions.finishers,
    members: r.data.members.map(m => ({
      athlete_id: m.athlete_id, name: m.name,
      legs: r.data.legs.filter(l => l.athlete_id === m.athlete_id).map(l => ({ label: l.label, time_ms: l.time_ms })),
    })),
  }));
  races.sort(byDateDesc);
  return { summary, races };
}

const started = (s: SnapshotStatus): boolean => s !== 'dns' && s !== 'not_started';
const side = (r: ResultRow): HeadToHeadSide => ({ entry_id: r.entry_id, status: r.status, final_ms: r.final_ms, overall_pos: r.overall_pos });

/**
 * Spec 2026-09-28 §5.3: the same race (`race_id`), `a` and `b` each in their own entry, both
 * started (a DNS or not-started side drops the race). Both placed: the better position wins, and a
 * shared position is no decision. Only one placed (the other DNF/DSQ/on course): the placed one
 * wins. Neither placed: no decision. `diff_ms` = b.final_ms − a.final_ms when both have one.
 * null when there is no such race.
 */
export function computeHeadToHead(a: string, b: string, results: ResultRow[]): HeadToHead | null {
  const aByRace = new Map<string, ResultRow>();
  const bByRace = new Map<string, ResultRow>();
  for (const r of results) {
    const hasA = r.athlete_ids.includes(a);
    const hasB = r.athlete_ids.includes(b);
    if (hasA && !hasB) aByRace.set(r.race_id, r);
    else if (hasB && !hasA) bByRace.set(r.race_id, r);
  }

  const races: HeadToHeadRace[] = [];
  let a_wins = 0, b_wins = 0, no_decision = 0;
  for (const [raceId, ra] of aByRace) {
    const rb = bByRace.get(raceId);
    if (!rb || !started(ra.status) || !started(rb.status)) continue;
    const pa = ra.overall_pos, pb = rb.overall_pos;
    let winner: 'a' | 'b' | null = null;
    if (pa !== null && pb !== null) winner = pa < pb ? 'a' : pb < pa ? 'b' : null;
    else if (pa !== null) winner = 'a';
    else if (pb !== null) winner = 'b';
    if (winner === 'a') a_wins++;
    else if (winner === 'b') b_wins++;
    else no_decision++;
    races.push({
      race_id: raceId, event_name: ra.data.event.name, event_date: ra.data.event.date, race_name: ra.data.race.name,
      a: side(ra), b: side(rb), winner,
      diff_ms: ra.final_ms !== null && rb.final_ms !== null ? rb.final_ms - ra.final_ms : null,
    });
  }
  if (races.length === 0) return null;
  races.sort(byDateDesc);
  return { a_wins, b_wins, no_decision, races };
}
```

- [ ] **Step 4: Run the tests and typecheck.**
  - Run: `npx vitest run src/domain/pairStats.test.ts && npm run typecheck`
  - Expected: PASS and clean.

- [ ] **Step 5: Commit.**

```bash
git add src/domain/pairStats.ts src/domain/pairStats.test.ts
git commit -m "feat(domain): together and head-to-head stats for two athletes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Club calculations (leaders and records)

**Files:**
- Create: `src/domain/clubStats.ts`, `src/domain/clubStats.test.ts`

**Interfaces:**
- Consumes: `computeAthleteStats`, `filterResultsByYear`, `qualifyingLegs`, `QualifyingLeg` (`stats.ts`); `formatDistance`, `formatPace` (`lib/format.ts`); `MODALITY_LABEL` (`presets.ts`); `PublicAthleteRow`.
- Produces:
  - `type SexFilter = 'M' | 'F' | null`;
  - `interface ClubFilter { year: string | null; sex: SexFilter }`;
  - `interface LeaderRow { athlete_id: string; name: string; value: number; pos: number }`;
  - `interface Leaders { wins: LeaderRow[]; podiums: LeaderRow[]; finishes: LeaderRow[]; km: LeaderRow[] }` (km `value` in km);
  - `rankLeaders(rows: { athlete_id: string; name: string; value: number }[]): LeaderRow[]`;
  - `computeLeaders(athletes: PublicAthleteRow[], results: ResultRow[], filter: ClubFilter): Leaders`;
  - `interface ClubRecordEntry { athlete_id; name; time_ms: number; pace: string; event_name; event_date }`;
  - `interface ClubRecordGroup { modality: Modality; distance_m: number; title: string; entries: ClubRecordEntry[] }`;
  - `computeClubRecords(athletes, results, filter): ClubRecordGroup[]`;
  - `MODALITY_ORDER: Modality[]` (`['run','swim','bike','other']`).

- [ ] **Step 1: Write the failing test** `src/domain/clubStats.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { computeClubRecords, computeLeaders, rankLeaders } from './clubStats';
import { makeResult } from './testing/results';
import type { PublicAthleteRow } from '../lib/types';

const ANA: PublicAthleteRow = { id: 'ana', name: 'Ana', sex: 'F', city: null, team_club: null };
const BIA: PublicAthleteRow = { id: 'bia', name: 'Bia', sex: 'F', city: null, team_club: null };
const CARLOS: PublicAthleteRow = { id: 'carlos', name: 'Carlos', sex: 'M', city: null, team_club: null };
const DAVI: PublicAthleteRow = { id: 'davi', name: 'Davi', sex: 'M', city: null, team_club: null };
const athletes = [ANA, BIA, CARLOS, DAVI];
const m = (a: PublicAthleteRow) => ({ athlete_id: a.id, name: a.name });
const podium = (pos: number) => [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Geral', podium_pos: pos }];

const results = [
  // 2026: Ana wins a solo 5 km (podium 1)
  makeResult({ race_id: 'r1', entry_id: 'e1', date: '2026-03-10', members: [m(ANA)], final_ms: 1_500_000, overall_pos: 1, podiums: podium(1) }),
  // 2026: relay Ana (swim 750 m) + Carlos (run 5 km) wins -> a win for each
  makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-05-01', members: [m(ANA), m(CARLOS)], final_ms: 2_200_000, overall_pos: 1,
    legs: [{ athlete_id: 'ana', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'carlos', time_ms: 1_400_000 }],
  }),
  // 2025: Bia wins a solo 5 km; Ana 2nd in the same race (podium 2)
  makeResult({ race_id: 'r3', entry_id: 'e3', date: '2025-10-05', members: [m(BIA)], final_ms: 1_450_000, overall_pos: 1 }),
  makeResult({ race_id: 'r3', entry_id: 'e4', date: '2025-10-05', members: [m(ANA)], final_ms: 1_550_000, overall_pos: 2, podiums: podium(2) }),
  // 2026: Davi DSQ (never counts) and a private athlete's winning 5 km (not in `athletes`)
  makeResult({ race_id: 'r4', entry_id: 'e5', date: '2026-06-01', members: [m(DAVI)], status: 'dsq', final_ms: 1_200_000 }),
  makeResult({ race_id: 'r4', entry_id: 'e6', date: '2026-06-01', members: [{ athlete_id: 'priv', name: 'Privado' }], final_ms: 1_100_000, overall_pos: 1 }),
];
const row = (r: { pos: number; name: string; value: number }) => [r.pos, r.name, r.value];

describe('computeLeaders (spec §5.4)', () => {
  it('ranks with §10 definitions; ties share the position; zero is left out', () => {
    const l = computeLeaders(athletes, results, { year: null, sex: null });
    expect(l.wins.map(row)).toEqual([[1, 'Ana', 2], [2, 'Bia', 1], [2, 'Carlos', 1]]);
    expect(l.podiums.map(row)).toEqual([[1, 'Ana', 2]]);
    expect(l.finishes.map(row)).toEqual([[1, 'Ana', 3], [2, 'Bia', 1], [2, 'Carlos', 1]]);
    expect(l.km.map(row)).toEqual([[1, 'Ana', 10.75], [2, 'Bia', 5], [2, 'Carlos', 5]]);
  });
  it('filters by year and by the registered sex', () => {
    expect(computeLeaders(athletes, results, { year: '2026', sex: null }).wins.map((r) => r.name)).toEqual(['Ana', 'Carlos']);
    expect(computeLeaders(athletes, results, { year: null, sex: 'F' }).wins.map((r) => r.name)).toEqual(['Ana', 'Bia']);
    expect(computeLeaders(athletes, results, { year: null, sex: 'M' }).km.map((r) => [r.name, r.value])).toEqual([['Carlos', 5]]);
  });
  it('sums km in meters, so 100 m + 200 m ties with 300 m (Review Focus 3)', () => {
    const split = [
      makeResult({ race_id: 'k1', entry_id: 'k1', date: '2026-01-01', members: [m(BIA)], final_ms: 60_000, overall_pos: 1, legs: [{ athlete_id: 'bia', distance_m: 100, time_ms: 60_000 }] }),
      makeResult({ race_id: 'k2', entry_id: 'k2', date: '2026-01-02', members: [m(BIA)], final_ms: 90_000, overall_pos: 1, legs: [{ athlete_id: 'bia', distance_m: 200, time_ms: 90_000 }] }),
      makeResult({ race_id: 'k3', entry_id: 'k3', date: '2026-01-03', members: [m(CARLOS)], final_ms: 120_000, overall_pos: 1, legs: [{ athlete_id: 'carlos', distance_m: 300, time_ms: 120_000 }] }),
    ];
    expect(computeLeaders(athletes, split, { year: null, sex: null }).km.map((r) => [r.pos, r.name, r.value])).toEqual([[1, 'Bia', 0.3], [1, 'Carlos', 0.3]]);
  });
});

describe('rankLeaders', () => {
  it('keeps positions up to 10, including everyone tied with the 10th', () => {
    const rows = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1].map((v, i) => ({ athlete_id: `x${i}`, name: `Atleta ${String(i).padStart(2, '0')}`, value: v }));
    expect(rankLeaders(rows).map((r) => r.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
  });
});

describe('computeClubRecords (spec §5.5)', () => {
  it('keeps the best leg of each athlete, the 3 best athletes per group, groups by modality then distance', () => {
    const extra = [
      makeResult({ race_id: 'x1', entry_id: 'x1', date: '2026-08-01', members: [m(ANA)], final_ms: 1_700_000, overall_pos: 3 }),
      makeResult({ race_id: 'x2', entry_id: 'x2', date: '2026-08-02', members: [m(CARLOS)], final_ms: 3_000_000, overall_pos: 1, legs: [{ athlete_id: 'carlos', distance_m: 10_000, time_ms: 3_000_000 }] }),
    ];
    const g = computeClubRecords(athletes, [...results, ...extra], { year: null, sex: null });
    expect(g.map((x) => x.title)).toEqual(['Corrida 5 km', 'Corrida 10 km', 'Natação 750 m']);
    expect(g[0].entries.map((e) => [e.name, e.time_ms])).toEqual([['Carlos', 1_400_000], ['Bia', 1_450_000], ['Ana', 1_500_000]]);
    expect(g[0].entries[0]).toMatchObject({ pace: '4:40 /km', event_name: 'Evento 2026-05-01', event_date: '2026-05-01' });
  });
  it('a time tie goes to the earlier date; the sex filter and private athletes are respected', () => {
    const tie = [
      makeResult({ race_id: 't1', entry_id: 't1', date: '2026-04-01', members: [m(BIA)], final_ms: 1_450_000, overall_pos: 1 }),
      makeResult({ race_id: 't2', entry_id: 't2', date: '2024-04-01', members: [m(ANA)], final_ms: 1_450_000, overall_pos: 1 }),
    ];
    const g = computeClubRecords(athletes, [...results, ...tie], { year: null, sex: 'F' });
    expect(g[0].title).toBe('Corrida 5 km');
    expect(g[0].entries.map((e) => [e.name, e.event_date])).toEqual([['Ana', '2024-04-01'], ['Bia', '2025-10-05']]);
  });
  it('filters by year', () => {
    const g = computeClubRecords(athletes, results, { year: '2025', sex: null });
    expect(g.map((x) => x.title)).toEqual(['Corrida 5 km']);
    expect(g[0].entries.map((e) => e.name)).toEqual(['Bia', 'Ana']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**
  - Run: `npx vitest run src/domain/clubStats.test.ts`
  - Expected: FAIL, because `./clubStats` cannot be resolved.

- [ ] **Step 3: Implement** `src/domain/clubStats.ts`.

```ts
import type { Modality, PublicAthleteRow, ResultRow } from '../lib/types';
import { formatDistance, formatPace } from '../lib/format';
import { MODALITY_LABEL } from './presets';
import { computeAthleteStats, filterResultsByYear, qualifyingLegs } from './stats';
import type { QualifyingLeg } from './stats';

export type SexFilter = 'M' | 'F' | null;
export interface ClubFilter { year: string | null; sex: SexFilter }
export interface LeaderRow { athlete_id: string; name: string; value: number; pos: number }
export interface Leaders { wins: LeaderRow[]; podiums: LeaderRow[]; finishes: LeaderRow[]; km: LeaderRow[] }
export interface ClubRecordEntry { athlete_id: string; name: string; time_ms: number; pace: string; event_name: string; event_date: string }
export interface ClubRecordGroup { modality: Modality; distance_m: number; title: string; entries: ClubRecordEntry[] }

export const LEADERS_CUTOFF = 10;
export const RECORDS_PER_GROUP = 3;
export const MODALITY_ORDER: Modality[] = ['run', 'swim', 'bike', 'other'];

function eligible(athletes: PublicAthleteRow[], sex: SexFilter): PublicAthleteRow[] {
  return sex === null ? athletes : athletes.filter(a => a.sex === sex);
}

/** Competition ranking by value (desc; ties share the position: 1, 1, 3), names A→Z (pt-BR) inside
 * a tie; zero values left out; cut at position LEADERS_CUTOFF, so everyone tied with the 10th stays. */
export function rankLeaders(rows: { athlete_id: string; name: string; value: number }[]): LeaderRow[] {
  const sorted = rows.filter(r => r.value > 0).sort((x, y) => y.value - x.value || x.name.localeCompare(y.name, 'pt-BR'));
  const out: LeaderRow[] = [];
  sorted.forEach((r, i) => {
    const pos = i > 0 && r.value === sorted[i - 1].value ? out[i - 1].pos : i + 1;
    out.push({ ...r, pos });
  });
  return out.filter(r => r.pos <= LEADERS_CUTOFF);
}

/**
 * Spec 2026-09-28 §5.4: per public athlete (optionally one registered sex), over the year's
 * results, with §10's definitions — computeAthleteStats, the same function behind the profile, so a
 * board never disagrees with a profile (a team win counts for every member). km comes from the
 * athlete's own qualifying legs, summed in integer meters, so equal totals tie exactly.
 */
export function computeLeaders(athletes: PublicAthleteRow[], results: ResultRow[], filter: ClubFilter): Leaders {
  const inYear = filterResultsByYear(results, filter.year);
  const rows = eligible(athletes, filter.sex).map(a => {
    const mine = inYear.filter(r => r.athlete_ids.includes(a.id));
    const s = computeAthleteStats(a.id, mine);
    const meters = qualifyingLegs(mine).filter(l => l.athlete_id === a.id).reduce((sum, l) => sum + l.distance_m, 0);
    return { athlete_id: a.id, name: a.name, wins: s.wins_overall, podiums: s.podiums, finishes: s.finishes, meters };
  });
  const board = (pick: (r: (typeof rows)[number]) => number) => rankLeaders(rows.map(r => ({ athlete_id: r.athlete_id, name: r.name, value: pick(r) })));
  return {
    wins: board(r => r.wins),
    podiums: board(r => r.podiums),
    finishes: board(r => r.finishes),
    km: board(r => r.meters).map(r => ({ ...r, value: r.value / 1000 })),
  };
}

/** Spec 2026-09-28 §5.5: the best qualifying leg of each public athlete (optionally one sex) per
 * (modality, distance) over the year; the RECORDS_PER_GROUP best athletes of each group. A time tie
 * goes to the earlier date (who did it first holds the record), then to the name. Groups by
 * MODALITY_ORDER, then distance ascending. */
export function computeClubRecords(athletes: PublicAthleteRow[], results: ResultRow[], filter: ClubFilter): ClubRecordGroup[] {
  const byId = new Map(eligible(athletes, filter.sex).map(a => [a.id, a]));
  const best = new Map<string, Map<string, QualifyingLeg>>(); // "modality|distance" -> athlete id -> best leg
  for (const leg of qualifyingLegs(filterResultsByYear(results, filter.year))) {
    if (!byId.has(leg.athlete_id)) continue;
    const key = `${leg.modality}|${leg.distance_m}`;
    const group = best.get(key) ?? new Map<string, QualifyingLeg>();
    const current = group.get(leg.athlete_id);
    if (!current || leg.time_ms < current.time_ms || (leg.time_ms === current.time_ms && leg.date < current.date)) {
      group.set(leg.athlete_id, leg);
    }
    best.set(key, group);
  }

  const nameOf = (id: string) => byId.get(id)!.name;
  const groups: ClubRecordGroup[] = [];
  for (const group of best.values()) {
    const legs = [...group.values()].sort((x, y) =>
      x.time_ms - y.time_ms || (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || nameOf(x.athlete_id).localeCompare(nameOf(y.athlete_id), 'pt-BR'));
    const { modality, distance_m } = legs[0];
    groups.push({
      modality, distance_m, title: `${MODALITY_LABEL[modality]} ${formatDistance(distance_m)}`,
      entries: legs.slice(0, RECORDS_PER_GROUP).map(l => ({
        athlete_id: l.athlete_id, name: nameOf(l.athlete_id), time_ms: l.time_ms,
        pace: formatPace(l.time_ms, l.distance_m, l.modality), event_name: l.event_name, event_date: l.date,
      })),
    });
  }
  return groups.sort((x, y) => MODALITY_ORDER.indexOf(x.modality) - MODALITY_ORDER.indexOf(y.modality) || x.distance_m - y.distance_m);
}
```

- [ ] **Step 4: Run the tests and typecheck.**
  - Run: `npx vitest run src/domain/clubStats.test.ts && npm run typecheck`
  - Expected: PASS and clean.

- [ ] **Step 5: Commit.**

```bash
git add src/domain/clubStats.ts src/domain/clubStats.test.ts
git commit -m "feat(domain): club leaders and records from the public results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Public shell, athletes directory and profile (plus the organizer's year filter)

**Files:**
- Create:
  - `src/features/public/PublicShell.tsx` (moved out of `PublicHome.tsx`, plus the navigation);
  - `src/features/public/usePublicStats.ts`, `src/features/public/PublicStatsFallback.tsx`;
  - `src/features/public/athleteSearch.ts`, `src/features/public/SexFilterButtons.tsx`, `src/features/public/AthletePicker.tsx`;
  - `src/features/public/PublicAthletesPage.tsx`;
  - `src/lib/useYearParam.ts`, `src/components/YearSelect.tsx`;
  - `src/features/public/publicAthletes.test.tsx`.
- Modify:
  - `src/features/public/PublicHome.tsx` (drop `PublicShell` and import it) and `src/features/public/PublicEventPage.tsx:13` (import `PublicShell` from `./PublicShell`);
  - `src/features/public/PublicAthletePage.tsx` (rewritten);
  - `src/features/public/public.test.tsx` (drop the old `PublicAthletePage` block);
  - `src/features/athletes/StatsView.tsx` (`athlete` prop type, `partnerLink` prop);
  - `src/features/athletes/AthleteProfilePage.tsx` (year filter) and `src/features/athletes/athletes.test.tsx`;
  - `src/App.tsx` (route `/perfis`).

**Interfaces:**
- Consumes (Tasks 2 and 4):
  - `api.pub.stats`, `PubStatsPayload`, `PublicAthleteRow`, `foldAccents`;
  - `resultYears`, `filterResultsByYear`, `participationCounts`;
  - `SexFilter`, `makeResult`.
- Produces (used by Tasks 6 and 7):
  - `PublicShell({ children })` from `./PublicShell`;
  - `usePublicStats(): UseQueryResult<PubStatsPayload>` from `./usePublicStats`;
  - `PublicStatsFallback({ query, testId })` from `./PublicStatsFallback`;
  - `useYearParam(years: string[]): [string | null, (year: string | null) => void]` from `src/lib/useYearParam.ts`;
  - `YearSelect({ years, value, onChange })` from `src/components/YearSelect.tsx`;
  - `SexFilterButtons({ value, onChange, allLabel, testId? })`;
  - `searchAthletes<T extends { name: string }>(athletes: T[], term: string): T[]`;
  - `AthletePicker({ open, athletes, excludeId, onPick, onClose })`;
  - `StatsView` accepts `athlete: Pick<AthleteRow, 'id'>` and `partnerLink?: (athleteId: string) => string | null`.

- [ ] **Step 1: Write the failing tests.**

  Create `src/features/public/publicAthletes.test.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeResult } from '../../domain/testing/results';
import type { PubStatsPayload, PublicAthleteRow } from '../../lib/types';
import PublicAthletesPage from './PublicAthletesPage';
import PublicAthletePage from './PublicAthletePage';

const mocks = vi.hoisted(() => ({ stats: vi.fn<() => Promise<PubStatsPayload>>() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { pub: { stats: mocks.stats } },
}));

const joao: PublicAthleteRow = { id: 'jo', name: 'João Núñez', sex: 'M', city: 'Vitória', team_club: 'Tubarões' };
const ana: PublicAthleteRow = { id: 'an', name: 'Ana Souza', sex: 'F', city: 'Vila Velha', team_club: null };
const bia: PublicAthleteRow = { id: 'bi', name: 'Bia Lima', sex: 'F', city: null, team_club: null };
const results = [
  makeResult({ race_id: 'r1', entry_id: 'e1', date: '2025-10-05', members: [{ athlete_id: 'an', name: 'Ana Souza' }], final_ms: 1_500_000, overall_pos: 1 }),
  makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-03-10', race: 'Revezamento', final_ms: 2_400_000, overall_pos: 2,
    members: [{ athlete_id: 'an', name: 'Ana Souza' }, { athlete_id: 'jo', name: 'João Núñez' }],
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'jo', time_ms: 1_600_000 }],
  }),
  makeResult({
    race_id: 'r3', entry_id: 'e3', date: '2026-05-01', race: 'Revezamento', final_ms: 2_500_000, overall_pos: 3,
    members: [{ athlete_id: 'an', name: 'Ana Souza' }, { athlete_id: 'px', name: 'Privada' }],
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 790_000 }, { athlete_id: 'px', time_ms: 1_710_000 }],
  }),
];
const payload: PubStatsPayload = { athletes: [joao, ana, bia], results };

beforeEach(() => {
  mocks.stats.mockReset().mockResolvedValue(payload);
});

const renderDirectory = () => renderWithProviders(<PublicAthletesPage />, { route: '/perfis', path: '/perfis' });
const renderProfile = (route = '/atleta/an') => renderWithProviders(<PublicAthletePage />, { route, path: '/atleta/:athleteId' });
const tile = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe('PublicAthletesPage (#/perfis)', () => {
  it('lists the public athletes A→Z with city, club and how many races', async () => {
    renderDirectory();
    const rows = await screen.findAllByTestId('athlete-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Ana Souza'), expect.stringContaining('Bia Lima'), expect.stringContaining('João Núñez'),
    ]);
    expect(rows[0]).toHaveTextContent('Vila Velha');
    expect(rows[0]).toHaveTextContent('3 provas');
    expect(rows[1]).toHaveTextContent('0 provas');
    expect(rows[2]).toHaveTextContent('Vitória · Tubarões');
    expect(rows[2]).toHaveTextContent('1 prova');
    expect(rows[0]).toHaveAttribute('href', '/atleta/an');
  });

  it('searches ignoring accents, case and surrounding spaces (Review Focus 4)', async () => {
    const user = userEvent.setup();
    renderDirectory();
    await user.type(await screen.findByTestId('athlete-search'), '  JOAO ');
    expect(screen.getAllByTestId('athlete-row').map((r) => r.textContent)).toEqual([expect.stringContaining('João Núñez')]);
    await user.clear(screen.getByTestId('athlete-search'));
    await user.type(screen.getByTestId('athlete-search'), 'zzz');
    expect(screen.getByText('Nenhum atleta encontrado')).toBeInTheDocument();
  });

  it('filters by sex', async () => {
    const user = userEvent.setup();
    renderDirectory();
    await screen.findAllByTestId('athlete-row');
    await user.click(screen.getByRole('button', { name: 'Feminino' }));
    expect(screen.getAllByTestId('athlete-row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Ana Souza'), expect.stringContaining('Bia Lima'),
    ]);
  });

  it('says when there is no public athlete yet', async () => {
    mocks.stats.mockResolvedValue({ athletes: [], results: [] });
    renderDirectory();
    expect(await screen.findByText('Nenhum atleta com perfil público ainda')).toBeInTheDocument();
  });

  it('offers a retry after a load error', async () => {
    const user = userEvent.setup();
    mocks.stats.mockRejectedValueOnce(new Error('offline'));
    renderDirectory();
    expect(await screen.findByText('Não foi possível carregar os atletas.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findAllByTestId('athlete-row')).toHaveLength(3);
  });

  it('the header navigation marks "Atletas" as the current page', async () => {
    renderDirectory();
    await screen.findAllByTestId('athlete-row');
    expect(screen.getByTestId('public-nav-events')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('public-nav-ranking')).toHaveAttribute('href', '/ranking');
    expect(screen.getByTestId('public-nav-athletes')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('public-nav-events')).not.toHaveAttribute('aria-current');
  });
});

describe('PublicAthletePage (#/atleta/:id)', () => {
  it('shows the header and the career by default, with the years to choose from', async () => {
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument();
    const year = screen.getByTestId('year-filter');
    expect(within(year).getAllByRole('option').map((o) => o.textContent)).toEqual(['Carreira', '2026', '2025']);
    expect(year).toHaveValue('carreira');
    expect(tile('Participações')).toBe('3');
  });

  it('?ano=2025 filters every number', async () => {
    renderProfile('/atleta/an?ano=2025');
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByTestId('year-filter')).toHaveValue('2025');
    expect(tile('Participações')).toBe('1');
  });

  it('an unknown ?ano is the career (Review Focus 1)', async () => {
    renderProfile('/atleta/an?ano=abc');
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByTestId('year-filter')).toHaveValue('carreira');
    expect(tile('Participações')).toBe('3');
  });

  it('choosing a year writes ?ano to the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderProfile();
    await screen.findByRole('heading', { name: 'Ana Souza' });
    await user.selectOptions(screen.getByTestId('year-filter'), '2026');
    expect(router.state.location.search).toBe('?ano=2026');
    expect(tile('Participações')).toBe('2');
  });

  it('links a public partner to "Nós dois" (keeping the year) and leaves a private one as text', async () => {
    renderProfile('/atleta/an?ano=2026');
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByRole('link', { name: 'João Núñez' })).toHaveAttribute('href', '/comparar/an/jo?ano=2026');
    expect(screen.getByText('Privada')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Privada' })).not.toBeInTheDocument();
  });

  it('"Comparar com…" picks another athlete (never the same one) and opens "Nós dois"', async () => {
    const user = userEvent.setup();
    const { router } = renderProfile();
    await screen.findByRole('heading', { name: 'Ana Souza' });
    await user.click(screen.getByTestId('compare-with'));
    const picker = screen.getByTestId('compare-picker');
    expect(within(picker).queryByRole('button', { name: /Ana Souza/ })).not.toBeInTheDocument();
    await user.type(within(picker).getByLabelText('Buscar atleta'), 'bia');
    await user.click(within(picker).getByRole('button', { name: /Bia Lima/ }));
    expect(router.state.location.pathname).toBe('/comparar/an/bi');
  });

  it('a private or unknown athlete gets the not-found message', async () => {
    renderProfile('/atleta/px');
    expect(await screen.findByText('Atleta não encontrado ou perfil privado')).toBeInTheDocument();
  });

  it('sets and resets the page title (C-Minor-15)', async () => {
    const { unmount } = renderProfile();
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(document.title).toBe('Ana Souza – EnduranceBaseClub');
    unmount();
    expect(document.title).toBe('EnduranceBaseClub');
  });
});
```

  In `src/features/athletes/athletes.test.tsx`:
  - add `import { makeResult } from '../../domain/testing/results';`;
  - add this test inside the `describe` that already renders `<AthleteProfilePage />`:
```tsx
  it('has the same year filter as the public profile (spec §3.6)', async () => {
    athleteProfile.mockResolvedValue({
      athlete: makeAthlete({ id: 'a1', name: 'Ana Souza' }),
      results: [
        makeResult({ race_id: 'r1', entry_id: 'e1', date: '2025-10-05', members: [{ athlete_id: 'a1', name: 'Ana Souza' }], final_ms: 1_500_000, overall_pos: 1 }),
        makeResult({ race_id: 'r2', entry_id: 'e2', date: '2026-03-10', members: [{ athlete_id: 'a1', name: 'Ana Souza' }], final_ms: 1_450_000, overall_pos: 2 }),
      ],
    });
    renderWithProviders(<AthleteProfilePage />, { route: '/atletas/a1?ano=2025', path: '/atletas/:athleteId' });
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByTestId('year-filter')).toHaveValue('2025');
    expect(screen.getByText('Participações').nextElementSibling).toHaveTextContent('1');
  });
```

  In `src/features/public/public.test.tsx`, remove the old `describe('PublicAthletePage', …)` block. Also remove what it leaves unused, since typecheck flags it:
  - the `renderAthletePage` helper;
  - the `athlete` entry in `mocks`, in the `api.pub` mock and in `beforeEach`;
  - the `PublicAthletePage` import;
  - `AthleteProfile` from the type import.

  The new file covers the page now.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `npx vitest run src/features/public src/features/athletes`
  - Expected: FAIL. `./PublicAthletesPage` cannot be resolved, and the profile tests fail because the page still calls `pub.athlete`.

- [ ] **Step 3: Implement the shared pieces.**

`src/features/public/PublicShell.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const NAV: { to: string; label: string; testId: string; match(pathname: string): boolean }[] = [
  { to: '/', label: 'Eventos', testId: 'public-nav-events', match: (p) => p === '/' || p.startsWith('/p/') },
  { to: '/perfis', label: 'Atletas', testId: 'public-nav-athletes', match: (p) => p.startsWith('/perfis') || p.startsWith('/atleta/') || p.startsWith('/comparar/') },
  { to: '/ranking', label: 'Rankings', testId: 'public-nav-ranking', match: (p) => p.startsWith('/ranking') },
];

/**
 * Shell for every public page (spec §6/§12; 2026-09-28 §3.1): logo + brand name, the public
 * navigation (Eventos · Atletas · Rankings, current one marked with aria-current), the theme
 * toggle and a link to the organizer login — no admin navigation.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-full flex-col bg-bg text-fg">
      <header className="border-b border-border">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className={`flex shrink-0 items-center gap-3 ${FOCUS}`}>
            <Logo size={32} />
            <span className="brand-title text-sm font-semibold sm:text-base">ENDURANCE BASE CLUB</span>
          </Link>
          <nav aria-label="Páginas públicas" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  data-testid={item.testId}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium ${FOCUS} ${active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link
              to="/entrar"
              className={`inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-sm font-medium text-fg hover:bg-surface-2 ${FOCUS}`}
            >
              Área da organização
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

`src/features/public/PublicHome.tsx`:
- delete the `PublicShell` function and its doc comment (lines 27-55);
- add `import { PublicShell } from './PublicShell';`;
- remove the imports that are now unused: `ReactNode`, `Logo`, `ThemeToggle`.

`src/features/public/PublicEventPage.tsx:13`: change it to `import { EVENT_STATUS_LABEL } from './PublicHome';` plus `import { PublicShell } from './PublicShell';`.

`src/features/public/usePublicStats.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { PubStatsPayload } from '../../lib/types';

/** Spec 2026-09-28 §4.3: the one public bundle behind the athletes directory, the profiles, "Nós
 * dois" and the rankings — fetched once, fresh for 5 minutes, refetched when the tab regains focus
 * (results only change when the organizer finalizes a race). */
export function usePublicStats(): UseQueryResult<PubStatsPayload> {
  return useQuery({ queryKey: ['pub-stats'], queryFn: () => api.pub.stats(), staleTime: 5 * 60_000, refetchOnWindowFocus: true });
}
```

`src/features/public/PublicStatsFallback.tsx`:
```tsx
import type { UseQueryResult } from '@tanstack/react-query';
import { Button, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import type { PubStatsPayload } from '../../lib/types';

/** Loading spinner or load error (+ "Tentar novamente") of a page built on usePublicStats. */
export function PublicStatsFallback({ query, testId }: { query: UseQueryResult<PubStatsPayload>; testId: string }) {
  return (
    <div data-testid={testId} className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      {query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-danger-text">
            {query.error instanceof ApiError ? query.error.message : 'Não foi possível carregar os atletas.'}
          </p>
          <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="flex justify-center py-16">
          <Spinner size={32} />
        </div>
      )}
    </div>
  );
}
```

`src/lib/useYearParam.ts`:
```ts
import { useSearchParams } from 'react-router';

/** Spec 2026-09-28 §3.3: the year filter lives in the URL (`?ano=AAAA`) so a shared link keeps it.
 * A missing year, or one not in `years`, is the career (null). Other query params are preserved. */
export function useYearParam(years: string[]): [string | null, (year: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('ano');
  const year = raw !== null && years.includes(raw) ? raw : null;
  const setYear = (next: string | null) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === null) p.delete('ano');
      else p.set('ano', next);
      return p;
    }, { replace: true });
  };
  return [year, setYear];
}
```

`src/components/YearSelect.tsx`:
```tsx
import { Select } from './ui';

const CAREER = 'carreira';

/** "Período" select: "Carreira" (null) or one of `years` (newest first). */
export function YearSelect({ years, value, onChange }: { years: string[]; value: string | null; onChange(year: string | null): void }) {
  return (
    <div className="w-40">
      <Select
        label="Período"
        data-testid="year-filter"
        value={value ?? CAREER}
        options={[{ value: CAREER, label: 'Carreira' }, ...years.map((y) => ({ value: y, label: y }))]}
        onChange={(e) => onChange(e.target.value === CAREER ? null : e.target.value)}
      />
    </div>
  );
}
```

`src/features/public/athleteSearch.ts`:
```ts
import { foldAccents } from '../../lib/text';

/** Spec 2026-09-28 §3.2: name search ignoring accents, case and surrounding spaces; an empty term
 * keeps everyone. */
export function searchAthletes<T extends { name: string }>(athletes: T[], term: string): T[] {
  const t = foldAccents(term.trim());
  return t ? athletes.filter((a) => foldAccents(a.name).includes(t)) : athletes;
}
```

`src/features/public/SexFilterButtons.tsx`:
```tsx
import type { SexFilter } from '../../domain/clubStats';

/** Segmented Todos/Geral · Masculino · Feminino buttons (aria-pressed marks the current one). */
export function SexFilterButtons({ value, onChange, allLabel, testId }: { value: SexFilter; onChange(v: SexFilter): void; allLabel: string; testId?: string }) {
  const options: { v: SexFilter; label: string }[] = [{ v: null, label: allLabel }, { v: 'M', label: 'Masculino' }, { v: 'F', label: 'Feminino' }];
  return (
    <div role="group" aria-label="Sexo" data-testid={testId} className="inline-flex gap-1 rounded-xl border border-border p-1">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`min-h-11 rounded-lg px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${value === o.v ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

`src/features/public/AthletePicker.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { Input, Modal } from '../../components/ui';
import type { PublicAthleteRow } from '../../lib/types';
import { searchAthletes } from './athleteSearch';

export interface AthletePickerProps {
  open: boolean;
  athletes: PublicAthleteRow[];
  excludeId: string;
  onPick(athleteId: string): void;
  onClose(): void;
}

/** "Comparar com…" (spec 2026-09-28 §3.3): search another public athlete, never the current one. */
export function AthletePicker({ open, athletes, excludeId, onPick, onClose }: AthletePickerProps) {
  const [term, setTerm] = useState('');
  const matches = useMemo(() => searchAthletes(athletes.filter((a) => a.id !== excludeId), term), [athletes, excludeId, term]);
  return (
    <Modal open={open} onClose={onClose} title="Comparar com…">
      <div data-testid="compare-picker" className="flex flex-col gap-3">
        <Input label="Buscar atleta" type="search" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
        {matches.length === 0 ? (
          <p className="text-sm text-muted">Nenhum atleta encontrado</p>
        ) : (
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {matches.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => onPick(a.id)}
                >
                  {a.name}
                  {a.city ? <span className="text-muted">{a.city}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Implement the pages and wiring.**

`src/features/public/PublicAthletesPage.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, Input } from '../../components/ui';
import type { SexFilter } from '../../domain/clubStats';
import { participationCounts } from '../../domain/stats';
import { searchAthletes } from './athleteSearch';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { SexFilterButtons } from './SexFilterButtons';
import { usePublicStats } from './usePublicStats';

const races = (n: number) => (n === 1 ? '1 prova' : `${n} provas`);

/** #/perfis (spec 2026-09-28 §3.2): every public athlete, A→Z, with name search and a sex filter. */
export default function PublicAthletesPage() {
  const query = usePublicStats();
  const [term, setTerm] = useState('');
  const [sex, setSex] = useState<SexFilter>(null);
  const counts = useMemo(() => participationCounts(query.data?.results ?? []), [query.data]);

  useEffect(() => {
    document.title = 'Atletas – EnduranceBaseClub';
    return () => { document.title = 'EnduranceBaseClub'; };
  }, []);

  if (!query.data) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-athletes" />
      </PublicShell>
    );
  }

  const { athletes } = query.data;
  const shown = searchAthletes(sex === null ? athletes : athletes.filter((a) => a.sex === sex), term)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <PublicShell>
      <div data-testid="public-athletes" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <h1 className="brand-title text-xl font-semibold">Atletas</h1>
        {athletes.length === 0 ? (
          <EmptyState title="Nenhum atleta com perfil público ainda" />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-80">
                <Input label="Buscar por nome" type="search" data-testid="athlete-search" value={term} onChange={(e) => setTerm(e.target.value)} />
              </div>
              <SexFilterButtons value={sex} onChange={setSex} allLabel="Todos" />
            </div>
            {shown.length === 0 ? (
              <EmptyState title="Nenhum atleta encontrado" />
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/atleta/${a.id}`}
                      data-testid="athlete-row"
                      className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border px-4 py-3 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="font-medium">{a.name}</span>
                      <span className="text-sm text-muted">{[a.city, a.team_club].filter(Boolean).join(' · ')}</span>
                      <span className="ml-auto text-sm text-muted tabular">{races(counts.get(a.id) ?? 0)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PublicShell>
  );
}
```

`src/features/public/PublicAthletePage.tsx` (replace the whole file):
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card } from '../../components/ui';
import { YearSelect } from '../../components/YearSelect';
import { sexLabel } from '../../domain/categories';
import { filterResultsByYear, resultYears } from '../../domain/stats';
import { useYearParam } from '../../lib/useYearParam';
import { StatsView } from '../athletes/StatsView';
import { AthletePicker } from './AthletePicker';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { usePublicStats } from './usePublicStats';

/**
 * Public athlete profile (spec §6/§12; 2026-09-28 §3.3). Built on the pub_stats bundle, so it only
 * ever sees `{id,name,sex,city,team_club}` of public athletes (pub_athlete stays in the database
 * for older app builds, Ruling 26). Year filter in `?ano`, team partners with a public profile link
 * to "Nós dois", and "Comparar com…" picks anyone else.
 */
export default function PublicAthletePage() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const navigate = useNavigate();
  const query = usePublicStats();
  const [picking, setPicking] = useState(false);
  const athlete = query.data?.athletes.find((a) => a.id === athleteId);
  const mine = useMemo(
    () => (athlete && query.data ? query.data.results.filter((r) => r.athlete_ids.includes(athlete.id)) : []),
    [athlete, query.data],
  );
  const years = useMemo(() => resultYears(mine), [mine]);
  const [year, setYear] = useYearParam(years);
  const shown = useMemo(() => filterResultsByYear(mine, year), [mine, year]);
  const publicIds = useMemo(() => new Set((query.data?.athletes ?? []).map((a) => a.id)), [query.data]);

  useEffect(() => {
    document.title = athlete ? `${athlete.name} – EnduranceBaseClub` : 'EnduranceBaseClub';
  }, [athlete]);
  // C-Minor-15: reset on unmount only.
  useEffect(() => () => { document.title = 'EnduranceBaseClub'; }, []);

  if (!query.data) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-athlete" />
      </PublicShell>
    );
  }

  if (!athlete) {
    return (
      <PublicShell>
        <div data-testid="public-athlete" className="mx-auto w-full max-w-md px-4 py-12">
          <Card className="flex flex-col gap-4">
            <p role="alert" className="text-sm text-danger-text">Atleta não encontrado ou perfil privado</p>
            <Link to="/perfis" className="text-sm text-muted underline underline-offset-2 hover:text-fg">Ver todos os atletas</Link>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const search = year ? `?ano=${year}` : '';
  const compareHref = (otherId: string) => `/comparar/${athlete.id}/${otherId}${search}`;

  return (
    <PublicShell>
      <div data-testid="public-athlete" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Link to="/perfis" className="text-sm text-muted underline underline-offset-2 hover:text-fg">← Atletas</Link>

        <Card className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="brand-title text-xl font-semibold">{athlete.name}</h1>
            <p className="text-sm text-muted">
              {sexLabel(athlete.sex)}
              {athlete.city ? ` · ${athlete.city}` : ''}
              {athlete.team_club ? ` · ${athlete.team_club}` : ''}
            </p>
          </div>
          <Button variant="secondary" data-testid="compare-with" onClick={() => setPicking(true)}>
            Comparar com…
          </Button>
        </Card>

        <div className="mt-4">
          <YearSelect years={years} value={year} onChange={setYear} />
        </div>

        <div className="mt-6">
          <StatsView
            athlete={athlete}
            results={shown}
            publicMode
            partnerLink={(id) => (publicIds.has(id) ? compareHref(id) : null)}
          />
        </div>

        <AthletePicker
          open={picking}
          athletes={query.data.athletes}
          excludeId={athlete.id}
          onClose={() => setPicking(false)}
          onPick={(id) => navigate(compareHref(id))}
        />
      </div>
    </PublicShell>
  );
}
```

`src/features/athletes/StatsView.tsx`:
- change the prop type to `athlete: Pick<AthleteRow, 'id'>;` (only its id is read);
- add the `partnerLink` prop to the props interface and to the destructuring: `export function StatsView({ athlete, results, publicMode = false, partnerLink }: StatsViewProps)`;
```ts
  /** Where a team partner's name links to; null = plain text. Without it: the organizer profile
   * (`/atletas/:id`) outside public mode, plain text in public mode (C-Minor-16). The public
   * profile passes one that links public partners to "Nós dois" (2026-09-28 §3.3). */
  partnerLink?: (athleteId: string) => string | null;
```
- delete the `partnerHref` constant;
- in the partners list, replace the `publicMode ? <span> : <Link>` ternary and its C-Minor-16 comment with:
```tsx
                {(() => {
                  const href = partnerLink ? partnerLink(p.athlete_id) : publicMode ? null : `/atletas/${p.athlete_id}`;
                  return href ? (
                    <Link to={href} className="text-sm text-fg underline underline-offset-2 hover:text-muted">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="text-sm text-fg">{p.name}</span>
                  );
                })()}
```

`src/features/athletes/AthleteProfilePage.tsx`:
- add the imports:
  - `import { useMemo, useState } from 'react';` (merged with the existing `useState` import);
  - `import { YearSelect } from '../../components/YearSelect';`;
  - `import { useYearParam } from '../../lib/useYearParam';`;
  - `import { filterResultsByYear, resultYears } from '../../domain/stats';`.
- right after the `useQuery` call, before any early return, add:
```tsx
  const years = useMemo(() => resultYears(query.data?.results ?? []), [query.data]);
  const [year, setYear] = useYearParam(years);
```
- replace `<div className="mt-6">\n        <StatsView athlete={athlete} results={results} />\n      </div>` with:
```tsx
      <div className="mt-6 flex flex-col gap-4">
        <YearSelect years={years} value={year} onChange={setYear} />
        <StatsView athlete={athlete} results={filterResultsByYear(results, year)} />
      </div>
```

`src/App.tsx`:
- after `const PublicAthletePage = lazy(…);`, add `const PublicAthletesPage = lazy(() => import('./features/public/PublicAthletesPage'));`;
- insert this route right before the `path: '/atleta/:athleteId'` route:
```tsx
  {
    path: '/perfis',
    element: (
      <Lazy>
        <PublicAthletesPage />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
```

- [ ] **Step 5: Run the tests, typecheck and build.**
  - Run: `npm run typecheck && npx vitest run && npm run build`
  - Expected: all green.
  - In the build output, check that the `PublicAthletesPage` chunk is separate and the `TimekeeperPage` chunk did not grow.

- [ ] **Step 6: Commit.**

```bash
git add src/features/public src/lib/useYearParam.ts src/components/YearSelect.tsx src/features/athletes/StatsView.tsx src/features/athletes/AthleteProfilePage.tsx src/features/athletes/athletes.test.tsx src/App.tsx
git commit -m "feat: public athletes directory, profile year filter and compare entry points

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "Nós dois" page (`#/comparar/:a/:b`)

**Files:**
- Create: `src/features/athletes/statsFormat.ts`, `src/features/public/PublicComparePage.tsx`, `src/features/public/compare.test.tsx`
- Modify: `src/features/athletes/StatsView.tsx` (use `statsFormat.ts`); `src/App.tsx` (route)

**Interfaces:**
- Consumes:
  - `computeTogether`, `computeHeadToHead`, `TogetherStats`, `HeadToHead`, `HeadToHeadSide` (Task 3);
  - `MODALITY_ORDER` (Task 4);
  - `computeAthleteStats`, `AthleteStats`, `resultYears`, `filterResultsByYear` (Task 2);
  - `PublicShell`, `usePublicStats`, `PublicStatsFallback`, `useYearParam`, `YearSelect` (Task 5).
- Produces:
  - `STATUS_LABEL`, `STATUS_TONE`, `ordinal(pos)` and `percent(v)` from `src/features/athletes/statsFormat.ts`;
  - the default export `PublicComparePage`.

- [ ] **Step 1: Write the failing test** `src/features/public/compare.test.tsx`.

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeResult } from '../../domain/testing/results';
import type { PubStatsPayload, PublicAthleteRow } from '../../lib/types';
import PublicComparePage from './PublicComparePage';

const mocks = vi.hoisted(() => ({ stats: vi.fn<() => Promise<PubStatsPayload>>() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { pub: { stats: mocks.stats } },
}));

const ana: PublicAthleteRow = { id: 'an', name: 'Ana Souza', sex: 'F', city: null, team_club: null };
const beto: PublicAthleteRow = { id: 'be', name: 'Beto Alves', sex: 'M', city: null, team_club: null };
const caio: PublicAthleteRow = { id: 'ca', name: 'Caio Dias', sex: 'M', city: null, team_club: null };
const A = { athlete_id: 'an', name: 'Ana Souza' };
const B = { athlete_id: 'be', name: 'Beto Alves' };
const results = [
  // together: relay Ana (swim) + Beto (run), 1st of 6
  makeResult({
    race_id: 'r1', entry_id: 'e1', date: '2026-03-10', race: 'Revezamento', team_name: 'Tubarões', members: [A, B],
    final_ms: 2_400_000, overall_pos: 1, finishers: 6,
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'be', time_ms: 1_600_000 }],
  }),
  // head-to-head: r2 Ana 2nd vs Beto 5th (Ana by 0:30); r3 Ana DNF vs Beto 3rd; r4 both DNF
  makeResult({ race_id: 'r2', entry_id: 'e2a', date: '2026-05-01', members: [A], final_ms: 1_500_000, overall_pos: 2 }),
  makeResult({ race_id: 'r2', entry_id: 'e2b', date: '2026-05-01', members: [B], final_ms: 1_530_000, overall_pos: 5 }),
  makeResult({ race_id: 'r3', entry_id: 'e3a', date: '2025-10-05', members: [A], status: 'dnf' }),
  makeResult({ race_id: 'r3', entry_id: 'e3b', date: '2025-10-05', members: [B], final_ms: 1_600_000, overall_pos: 3 }),
  makeResult({ race_id: 'r4', entry_id: 'e4a', date: '2026-06-01', members: [A], status: 'dnf' }),
  makeResult({ race_id: 'r4', entry_id: 'e4b', date: '2026-06-01', members: [B], status: 'dnf' }),
  // Caio races alone
  makeResult({ race_id: 'r5', entry_id: 'e5', date: '2026-07-01', members: [{ athlete_id: 'ca', name: 'Caio Dias' }], final_ms: 1_450_000, overall_pos: 1 }),
];

beforeEach(() => {
  mocks.stats.mockReset().mockResolvedValue({ athletes: [ana, beto, caio], results });
});

const renderCompare = (route: string) => renderWithProviders(<PublicComparePage />, { route, path: '/comparar/:a/:b' });
const cells = (label: string) =>
  [...screen.getByRole('rowheader', { name: label }).closest('tr')!.querySelectorAll('td')].map((td) => td.textContent);

describe('PublicComparePage (#/comparar/:a/:b)', () => {
  it('puts both athletes side by side, with paces and records', async () => {
    renderCompare('/comparar/an/be');
    const side = await screen.findByTestId('compare-side-by-side');
    expect(within(side).getByRole('columnheader', { name: 'Ana Souza' })).toBeInTheDocument();
    expect(within(side).getByRole('columnheader', { name: 'Beto Alves' })).toBeInTheDocument();
    expect(cells('Participações')).toEqual(['4', '4']);
    expect(cells('Conclusões')).toEqual(['2', '3']);
    expect(cells('Vitórias gerais')).toEqual(['1', '1']);
    expect(cells('Ritmo · Corrida')).toEqual(['5:00 /km', '5:15 /km']);
    expect(cells('Ritmo · Natação')).toEqual(['1:47 /100m', '—']);
    expect(cells('Recorde · Corrida 5 km')).toEqual(['25:00', '25:30']);
    expect(cells('Recorde · Natação 750 m')).toEqual(['13:20', '—']);
  });

  it('"Juntos" shows the team numbers and each member leg', async () => {
    renderCompare('/comparar/an/be');
    const t = await screen.findByTestId('compare-together');
    expect(within(t).getByText('Provas juntos').nextElementSibling).toHaveTextContent('1');
    expect(t).toHaveTextContent('Tubarões');
    expect(t).toHaveTextContent('Ana Souza: Natação 13:20');
    expect(t).toHaveTextContent('Beto Alves: Corrida 26:40');
    expect(t).toHaveTextContent('1º de 6');
  });

  it('"Confronto direto" scores the races in common', async () => {
    renderCompare('/comparar/an/be');
    const h = await screen.findByTestId('compare-head-to-head');
    expect(h).toHaveTextContent('Ana Souza 1 × 1 Beto Alves');
    expect(h).toHaveTextContent('1 sem decisão');
    expect(h).toHaveTextContent('Ana Souza por 0:30');
  });

  it('?ano=2026 restricts every section; an unknown ?ano is the career (Review Focus 1)', async () => {
    const { unmount } = renderCompare('/comparar/an/be?ano=2026');
    expect(await screen.findByTestId('compare-head-to-head')).toHaveTextContent('Ana Souza 1 × 0 Beto Alves');
    unmount();
    renderCompare('/comparar/an/be?ano=1999');
    expect(await screen.findByTestId('compare-head-to-head')).toHaveTextContent('Ana Souza 1 × 1 Beto Alves');
    expect(screen.getByTestId('year-filter')).toHaveValue('carreira');
  });

  it('says so when they never met; the side-by-side stays', async () => {
    renderCompare('/comparar/an/ca');
    expect(await screen.findByText('Vocês ainda não correram juntos nem na mesma prova.')).toBeInTheDocument();
    expect(screen.queryByTestId('compare-together')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compare-head-to-head')).not.toBeInTheDocument();
    expect(screen.getByTestId('compare-side-by-side')).toBeInTheDocument();
  });

  it('the same athlete twice asks for two different ones', async () => {
    renderCompare('/comparar/an/an');
    expect(await screen.findByText('Escolha dois atletas diferentes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver o perfil' })).toHaveAttribute('href', '/atleta/an');
  });

  it('a private or unknown athlete is not found', async () => {
    renderCompare('/comparar/an/px');
    expect(await screen.findByText('Atleta não encontrado ou perfil privado')).toBeInTheDocument();
  });

  it('sets and resets the page title', async () => {
    const { unmount } = renderCompare('/comparar/an/be');
    await screen.findByTestId('compare-side-by-side');
    expect(document.title).toBe('Ana Souza × Beto Alves – EnduranceBaseClub');
    unmount();
    expect(document.title).toBe('EnduranceBaseClub');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**
  - Run: `npx vitest run src/features/public/compare.test.tsx`
  - Expected: FAIL, because `./PublicComparePage` cannot be resolved.

- [ ] **Step 3: Extract the shared formatting.**

Create `src/features/athletes/statsFormat.ts`, moving these definitions verbatim out of `StatsView.tsx`:
```ts
import type { SnapshotStatus } from '../../lib/types';

export const STATUS_LABEL: Record<SnapshotStatus, string> = {
  finished: 'Concluído', on_course: 'Em prova', not_started: 'Não iniciado', dnf: 'DNF', dns: 'DNS', dsq: 'DSQ',
};
export const STATUS_TONE: Record<SnapshotStatus, 'success' | 'danger' | 'neutral'> = {
  finished: 'success', dnf: 'danger', dsq: 'danger', on_course: 'neutral', not_started: 'neutral', dns: 'neutral',
};

export function ordinal(pos: number | null): string {
  return pos === null ? '—' : `${pos}º`;
}

export function percent(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}
```
In `StatsView.tsx`:
- delete the local `STATUS_LABEL`, `STATUS_TONE`, `ordinal` and `percent`;
- add `import { STATUS_LABEL, STATUS_TONE, ordinal, percent } from './statsFormat';`;
- drop `SnapshotStatus` from its type import if it becomes unused.

- [ ] **Step 4: Implement** `src/features/public/PublicComparePage.tsx`.

```tsx
import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Card, Table } from '../../components/ui';
import { YearSelect } from '../../components/YearSelect';
import { MODALITY_ORDER } from '../../domain/clubStats';
import { computeHeadToHead, computeTogether } from '../../domain/pairStats';
import type { HeadToHead, HeadToHeadSide, TogetherStats } from '../../domain/pairStats';
import { MODALITY_LABEL } from '../../domain/presets';
import { computeAthleteStats, filterResultsByYear, resultYears } from '../../domain/stats';
import type { AthleteStats } from '../../domain/stats';
import { formatDateBR, formatDistance, formatDuration } from '../../lib/format';
import type { Modality, PublicAthleteRow } from '../../lib/types';
import { useYearParam } from '../../lib/useYearParam';
import { STATUS_LABEL, STATUS_TONE, ordinal, percent } from '../athletes/statsFormat';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { usePublicStats } from './usePublicStats';

const PACE_ORDER: Modality[] = ['run', 'swim', 'bike']; // Ruling 20: no pace for 'other'

/** Side-by-side rows (spec 2026-09-28 §3.4): the profile tiles, then pace per modality and personal
 * records per (modality, distance) that at least one of the two has ("—" on the other side). */
function sideBySideRows(sa: AthleteStats, sb: AthleteStats): { label: string; a: string; b: string }[] {
  const rows = [
    { label: 'Participações', a: String(sa.participations), b: String(sb.participations) },
    { label: 'Conclusões', a: String(sa.finishes), b: String(sb.finishes) },
    { label: 'Vitórias gerais', a: String(sa.wins_overall), b: String(sb.wins_overall) },
    { label: 'Vitórias na categoria', a: String(sa.wins_category), b: String(sb.wins_category) },
    { label: 'Pódios', a: String(sa.podiums), b: String(sb.podiums) },
    { label: 'Melhor colocação', a: ordinal(sa.best_overall_pos), b: ordinal(sb.best_overall_pos) },
    { label: 'Top X% médio', a: percent(sa.avg_percentile), b: percent(sb.avg_percentile) },
  ];
  for (const m of PACE_ORDER) {
    const pa = sa.pace_by_modality.find((p) => p.modality === m);
    const pb = sb.pace_by_modality.find((p) => p.modality === m);
    if (pa || pb) rows.push({ label: `Ritmo · ${MODALITY_LABEL[m]}`, a: pa?.pace || '—', b: pb?.pace || '—' });
  }
  const keys = new Map<string, { modality: Modality; distance_m: number }>();
  for (const r of [...sa.records, ...sb.records]) keys.set(`${r.modality}|${r.distance_m}`, { modality: r.modality, distance_m: r.distance_m });
  const sorted = [...keys.values()].sort((x, y) => MODALITY_ORDER.indexOf(x.modality) - MODALITY_ORDER.indexOf(y.modality) || x.distance_m - y.distance_m);
  for (const k of sorted) {
    const ra = sa.records.find((r) => r.modality === k.modality && r.distance_m === k.distance_m);
    const rb = sb.records.find((r) => r.modality === k.modality && r.distance_m === k.distance_m);
    rows.push({
      label: `Recorde · ${MODALITY_LABEL[k.modality]} ${formatDistance(k.distance_m)}`,
      a: ra ? formatDuration(ra.time_ms) : '—',
      b: rb ? formatDuration(rb.time_ms) : '—',
    });
  }
  return rows;
}

function sideText(s: HeadToHeadSide): string {
  return s.overall_pos !== null ? `${formatDuration(s.final_ms)} · ${s.overall_pos}º` : STATUS_LABEL[s.status];
}

function diffText(diff: number | null, a: string, b: string): string {
  if (diff === null) return '—';
  if (diff === 0) return 'mesmo tempo';
  return `${diff > 0 ? a : b} por ${formatDuration(Math.abs(diff))}`;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <PublicShell>
      <div data-testid="public-compare" className="mx-auto w-full max-w-md px-4 py-12">
        <Card className="flex flex-col gap-4">{children}</Card>
      </div>
    </PublicShell>
  );
}

function TogetherSection({ together }: { together: TogetherStats }) {
  const s = together.summary;
  const tiles = [
    { label: 'Provas juntos', value: String(s.participations) },
    { label: 'Conclusões', value: String(s.finishes) },
    { label: 'Vitórias gerais', value: String(s.wins_overall) },
    { label: 'Vitórias na categoria', value: String(s.wins_category) },
    { label: 'Pódios', value: String(s.podiums) },
    { label: 'Melhor colocação', value: ordinal(s.best_overall_pos) },
    { label: 'Top X% médio', value: percent(s.avg_percentile) },
  ];
  return (
    <section data-testid="compare-together" className="flex flex-col gap-3">
      <h2 className="brand-title text-sm font-semibold">Juntos</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t.label}</span>
            <span className="text-2xl font-semibold text-fg">{t.value}</span>
          </Card>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {together.races.map((r) => (
          <li key={r.entry_id} className="rounded-xl border border-border p-3">
            <p className="font-medium">
              {r.event_name} · {formatDateBR(r.event_date)} · {r.race_name}
              {r.team_name ? ` · ${r.team_name}` : ''}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              <span className="tabular">{formatDuration(r.final_ms)}</span>
              {r.overall_pos !== null && <span className="text-muted tabular">{r.overall_pos}º de {r.finishers}</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              {r.members.map((m) => `${m.name}: ${m.legs.map((l) => `${l.label} ${formatDuration(l.time_ms)}`).join(', ')}`).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HeadToHeadSection({ h2h, a, b }: { h2h: HeadToHead; a: PublicAthleteRow; b: PublicAthleteRow }) {
  return (
    <section data-testid="compare-head-to-head" className="flex flex-col gap-3">
      <h2 className="brand-title text-sm font-semibold">Confronto direto</h2>
      <p className="text-2xl font-semibold tabular">
        {a.name} {h2h.a_wins} × {h2h.b_wins} {b.name}
      </p>
      {h2h.no_decision > 0 && (
        <p className="text-sm text-muted">{h2h.no_decision} sem decisão (nenhum dos dois terminou com colocação, ou empataram)</p>
      )}
      <Table>
        <thead>
          <tr>
            <th className="px-3 py-2" scope="col">Prova</th>
            <th className="px-3 py-2" scope="col">{a.name}</th>
            <th className="px-3 py-2" scope="col">{b.name}</th>
            <th className="px-3 py-2" scope="col">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {h2h.races.map((r) => (
            <tr key={r.race_id} className="border-t border-border">
              <td className="px-3 py-2">{r.event_name} · {formatDateBR(r.event_date)} · {r.race_name}</td>
              <td className={`px-3 py-2 tabular ${r.winner === 'a' ? 'font-semibold' : ''}`}>{sideText(r.a)}</td>
              <td className={`px-3 py-2 tabular ${r.winner === 'b' ? 'font-semibold' : ''}`}>{sideText(r.b)}</td>
              <td className="px-3 py-2 tabular">{diffText(r.diff_ms, a.name, b.name)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

/** #/comparar/:a/:b — "Nós dois" (spec 2026-09-28 §3.4): side by side, together, head-to-head. */
export default function PublicComparePage() {
  const { a: aId, b: bId } = useParams<{ a: string; b: string }>();
  const query = usePublicStats();
  const data = query.data;
  const a = data?.athletes.find((x) => x.id === aId);
  const b = data?.athletes.find((x) => x.id === bId);
  const results = useMemo(() => data?.results ?? [], [data]);
  const years = useMemo(
    () => resultYears(results.filter((r) => (a !== undefined && r.athlete_ids.includes(a.id)) || (b !== undefined && r.athlete_ids.includes(b.id)))),
    [results, a, b],
  );
  const [year, setYear] = useYearParam(years);
  const view = useMemo(() => {
    if (!a || !b || a.id === b.id) return null;
    const inYear = filterResultsByYear(results, year);
    const of = (id: string) => inYear.filter((r) => r.athlete_ids.includes(id));
    return {
      sa: computeAthleteStats(a.id, of(a.id)),
      sb: computeAthleteStats(b.id, of(b.id)),
      together: computeTogether(a.id, b.id, inYear),
      h2h: computeHeadToHead(a.id, b.id, inYear),
    };
  }, [a, b, results, year]);

  useEffect(() => {
    if (a && b) document.title = `${a.name} × ${b.name} – EnduranceBaseClub`;
  }, [a, b]);
  useEffect(() => () => { document.title = 'EnduranceBaseClub'; }, []);

  if (!data) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-compare" />
      </PublicShell>
    );
  }
  if (aId === bId) {
    return (
      <Notice>
        <p role="alert" className="text-sm text-fg">Escolha dois atletas diferentes</p>
        <Link to={`/atleta/${aId}`} className="text-sm text-muted underline underline-offset-2 hover:text-fg">Ver o perfil</Link>
      </Notice>
    );
  }
  if (!a || !b || !view) {
    return (
      <Notice>
        <p role="alert" className="text-sm text-danger-text">Atleta não encontrado ou perfil privado</p>
        <Link to="/perfis" className="text-sm text-muted underline underline-offset-2 hover:text-fg">Ver todos os atletas</Link>
      </Notice>
    );
  }

  const search = year ? `?ano=${year}` : '';
  return (
    <PublicShell>
      <div data-testid="public-compare" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="brand-title text-xl font-semibold">
            <Link to={`/atleta/${a.id}${search}`} className="hover:underline">{a.name}</Link>
            {' × '}
            <Link to={`/atleta/${b.id}${search}`} className="hover:underline">{b.name}</Link>
          </h1>
          <YearSelect years={years} value={year} onChange={setYear} />
        </div>

        <section data-testid="compare-side-by-side" className="flex flex-col gap-2">
          <h2 className="brand-title text-sm font-semibold">Lado a lado</h2>
          <Table>
            <thead>
              <tr>
                <th className="px-3 py-2" scope="col"><span className="sr-only">Estatística</span></th>
                <th className="px-3 py-2" scope="col">{a.name}</th>
                <th className="px-3 py-2" scope="col">{b.name}</th>
              </tr>
            </thead>
            <tbody>
              {sideBySideRows(view.sa, view.sb).map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted">{r.label}</th>
                  <td className="px-3 py-2 tabular">{r.a}</td>
                  <td className="px-3 py-2 tabular">{r.b}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>

        {view.together && <TogetherSection together={view.together} />}
        {view.h2h && <HeadToHeadSection h2h={view.h2h} a={a} b={b} />}
        {!view.together && !view.h2h && (
          <p className="text-sm text-muted">Vocês ainda não correram juntos nem na mesma prova.</p>
        )}
      </div>
    </PublicShell>
  );
}
```

`src/App.tsx`:
- after `const PublicAthletesPage = lazy(…);`, add `const PublicComparePage = lazy(() => import('./features/public/PublicComparePage'));`;
- insert right after the `/atleta/:athleteId` route:
```tsx
  {
    path: '/comparar/:a/:b',
    element: (
      <Lazy>
        <PublicComparePage />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
```

- [ ] **Step 5: Run the tests, typecheck and build.**
  - Run: `npm run typecheck && npx vitest run && npm run build`
  - Expected: all green, including the existing StatsView tests after the `statsFormat.ts` move.

- [ ] **Step 6: Commit.**

```bash
git add src/features/athletes/statsFormat.ts src/features/athletes/StatsView.tsx src/features/public/PublicComparePage.tsx src/features/public/compare.test.tsx src/App.tsx
git commit -m "feat: \"Nós dois\" public page (side by side, together, head-to-head)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Rankings page (`#/ranking`)

**Files:**
- Create: `src/features/public/PublicRankingPage.tsx`, `src/features/public/ranking.test.tsx`
- Modify: `src/App.tsx` (route)

**Interfaces:**
- Consumes:
  - `computeLeaders`, `computeClubRecords`, `LeaderRow`, `SexFilter` (Task 4);
  - `resultYears` (Task 2);
  - `formatKm`, `formatDuration`, `formatDateBR`;
  - `PublicShell`, `usePublicStats`, `PublicStatsFallback`, `useYearParam`, `YearSelect`, `SexFilterButtons` (Task 5).
- Produces: the default export `PublicRankingPage`.

- [ ] **Step 1: Write the failing test** `src/features/public/ranking.test.tsx`.

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeResult } from '../../domain/testing/results';
import type { PubStatsPayload, PublicAthleteRow } from '../../lib/types';
import PublicRankingPage from './PublicRankingPage';

const mocks = vi.hoisted(() => ({ stats: vi.fn<() => Promise<PubStatsPayload>>() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { pub: { stats: mocks.stats } },
}));

const ana: PublicAthleteRow = { id: 'an', name: 'Ana Souza', sex: 'F', city: null, team_club: null };
const bia: PublicAthleteRow = { id: 'bi', name: 'Bia Lima', sex: 'F', city: null, team_club: null };
const carlos: PublicAthleteRow = { id: 'ca', name: 'Carlos Dias', sex: 'M', city: null, team_club: null };
const m = (a: PublicAthleteRow) => ({ athlete_id: a.id, name: a.name });
const podium = (pos: number) => [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Geral', podium_pos: pos }];
const results = [
  makeResult({ race_id: 'r1', entry_id: 'e1', date: '2026-03-10', members: [m(ana)], final_ms: 1_500_000, overall_pos: 1, podiums: podium(1) }),
  makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-05-01', members: [m(ana), m(carlos)], final_ms: 2_200_000, overall_pos: 1,
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'ca', time_ms: 1_400_000 }],
  }),
  makeResult({ race_id: 'r3', entry_id: 'e3', date: '2025-10-05', members: [m(bia)], final_ms: 1_450_000, overall_pos: 1 }),
  makeResult({ race_id: 'r3', entry_id: 'e4', date: '2025-10-05', members: [m(ana)], final_ms: 1_550_000, overall_pos: 2, podiums: podium(2) }),
  makeResult({
    race_id: 'r5', entry_id: 'e5', date: '2026-06-01', members: [m(carlos)], final_ms: 300_000, overall_pos: 1,
    legs: [{ athlete_id: 'ca', modality: 'other', label: 'Outro', distance_m: 1000, time_ms: 300_000 }],
  }),
];

beforeEach(() => {
  mocks.stats.mockReset().mockResolvedValue({ athletes: [ana, bia, carlos], results });
});

const renderRanking = (route = '/ranking') => renderWithProviders(<PublicRankingPage />, { route, path: '/ranking' });
const board = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;
const lines = (title: string) => within(board(title)).queryAllByRole('listitem').map((li) => li.textContent);

describe('PublicRankingPage (#/ranking)', () => {
  it('shows the four leader boards with shared positions and profile links', async () => {
    renderRanking();
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    expect(lines('Vitórias gerais')).toEqual(['1º Ana Souza 2', '1º Carlos Dias 2', '3º Bia Lima 1']);
    expect(lines('Pódios')).toEqual(['1º Ana Souza 2']);
    expect(lines('Provas concluídas')).toEqual(['1º Ana Souza 3', '2º Carlos Dias 2', '3º Bia Lima 1']);
    expect(lines('Km em prova')).toEqual(['1º Ana Souza 10,75 km', '2º Carlos Dias 6 km', '3º Bia Lima 5 km']);
    expect(within(board('Vitórias gerais')).getByRole('link', { name: 'Bia Lima' })).toHaveAttribute('href', '/atleta/bi');
  });

  it('filters by sex (buttons write ?sexo) and by year (?ano)', async () => {
    const user = userEvent.setup();
    const { router } = renderRanking();
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    await user.click(within(screen.getByTestId('sex-filter')).getByRole('button', { name: 'Feminino' }));
    expect(router.state.location.search).toBe('?sexo=F');
    expect(lines('Vitórias gerais')).toEqual(['1º Ana Souza 2', '2º Bia Lima 1']);
  });

  it('?ano=2025 shows only that year', async () => {
    renderRanking('/ranking?ano=2025');
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    expect(lines('Vitórias gerais')).toEqual(['1º Bia Lima 1']);
  });

  it('lists the club records per modality and distance with the 3 best athletes', async () => {
    renderRanking();
    const run = (await screen.findByRole('heading', { name: 'Corrida 5 km' })).closest('section')!;
    const rows = within(run).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['Carlos Dias', 'Bia Lima', 'Ana Souza']);
    expect(rows[0]).toHaveTextContent('23:20');
    expect(rows[0]).toHaveTextContent('4:40 /km');
    const other = within(screen.getByRole('heading', { name: 'Outro 1 km' }).closest('section')!).getAllByRole('row')[1];
    expect(other).toHaveTextContent('—');
  });

  it('says when the period has no official result', async () => {
    mocks.stats.mockResolvedValue({ athletes: [ana], results: [] });
    renderRanking();
    expect(await screen.findByText('Ainda não há resultados oficiais neste período')).toBeInTheDocument();
  });

  it('sets and resets the page title', async () => {
    const { unmount } = renderRanking();
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    expect(document.title).toBe('Rankings – EnduranceBaseClub');
    unmount();
    expect(document.title).toBe('EnduranceBaseClub');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**
  - Run: `npx vitest run src/features/public/ranking.test.tsx`
  - Expected: FAIL, because `./PublicRankingPage` cannot be resolved.

- [ ] **Step 3: Implement** `src/features/public/PublicRankingPage.tsx`.

```tsx
import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, Table } from '../../components/ui';
import { YearSelect } from '../../components/YearSelect';
import { computeClubRecords, computeLeaders } from '../../domain/clubStats';
import type { LeaderRow, SexFilter } from '../../domain/clubStats';
import { resultYears } from '../../domain/stats';
import { formatDateBR, formatDuration, formatKm } from '../../lib/format';
import { useYearParam } from '../../lib/useYearParam';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { SexFilterButtons } from './SexFilterButtons';
import { usePublicStats } from './usePublicStats';

function Board({ title, rows, format }: { title: string; rows: LeaderRow[]; format(value: number): string }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="brand-title mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Ninguém ainda</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.athlete_id} className="flex items-center gap-2 text-sm">
              <span className="w-8 tabular text-muted">{r.pos}º</span>{' '}
              <Link to={`/atleta/${r.athlete_id}`} className="underline-offset-2 hover:underline">{r.name}</Link>{' '}
              <span className="ml-auto tabular font-medium">{format(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** #/ranking (spec 2026-09-28 §3.5): leader boards and club records, filtered by year and sex. */
export default function PublicRankingPage() {
  const query = usePublicStats();
  const [params, setParams] = useSearchParams();
  const rawSex = params.get('sexo');
  const sex: SexFilter = rawSex === 'M' || rawSex === 'F' ? rawSex : null;
  const setSex = (next: SexFilter) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === null) p.delete('sexo');
      else p.set('sexo', next);
      return p;
    }, { replace: true });
  const years = useMemo(() => resultYears(query.data?.results ?? []), [query.data]);
  const [year, setYear] = useYearParam(years);
  const leaders = useMemo(() => (query.data ? computeLeaders(query.data.athletes, query.data.results, { year, sex }) : null), [query.data, year, sex]);
  const records = useMemo(() => (query.data ? computeClubRecords(query.data.athletes, query.data.results, { year, sex }) : []), [query.data, year, sex]);

  useEffect(() => {
    document.title = 'Rankings – EnduranceBaseClub';
    return () => { document.title = 'EnduranceBaseClub'; };
  }, []);

  if (!query.data || !leaders) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-ranking" />
      </PublicShell>
    );
  }

  const empty = leaders.wins.length + leaders.podiums.length + leaders.finishes.length + leaders.km.length === 0 && records.length === 0;

  return (
    <PublicShell>
      <div data-testid="public-ranking" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="brand-title text-xl font-semibold">Rankings</h1>
        <div className="flex flex-wrap items-end gap-3">
          <YearSelect years={years} value={year} onChange={setYear} />
          <SexFilterButtons value={sex} onChange={setSex} allLabel="Geral" testId="sex-filter" />
        </div>

        {empty ? (
          <EmptyState title="Ainda não há resultados oficiais neste período" />
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="brand-title text-lg font-semibold">Líderes</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Board title="Vitórias gerais" rows={leaders.wins} format={String} />
                <Board title="Pódios" rows={leaders.podiums} format={String} />
                <Board title="Provas concluídas" rows={leaders.finishes} format={String} />
                <Board title="Km em prova" rows={leaders.km} format={formatKm} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="brand-title text-lg font-semibold">Recordes do clube</h2>
              {records.length === 0 ? (
                <p className="text-sm text-muted">Sem recordes neste período</p>
              ) : (
                records.map((g) => (
                  <section key={g.title} className="rounded-xl border border-border p-4">
                    <h3 className="brand-title mb-2 text-sm font-semibold">{g.title}</h3>
                    <Table>
                      <thead>
                        <tr>
                          <th className="px-3 py-2" scope="col">#</th>
                          <th className="px-3 py-2" scope="col">Atleta</th>
                          <th className="px-3 py-2" scope="col">Tempo</th>
                          <th className="px-3 py-2" scope="col">Ritmo</th>
                          <th className="px-3 py-2" scope="col">Evento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.entries.map((e, i) => (
                          <tr key={e.athlete_id} className="border-t border-border">
                            <td className="px-3 py-2 tabular">{i + 1}º</td>
                            <td className="px-3 py-2"><Link to={`/atleta/${e.athlete_id}`} className="hover:underline">{e.name}</Link></td>
                            <td className="px-3 py-2 tabular">{formatDuration(e.time_ms)}</td>
                            <td className="px-3 py-2 tabular">{e.pace || '—'}</td>
                            <td className="px-3 py-2">{e.event_name} · {formatDateBR(e.event_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </section>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </PublicShell>
  );
}
```

`src/App.tsx`:
- after `const PublicComparePage = lazy(…);`, add `const PublicRankingPage = lazy(() => import('./features/public/PublicRankingPage'));`;
- insert right after the `/comparar/:a/:b` route:
```tsx
  {
    path: '/ranking',
    element: (
      <Lazy>
        <PublicRankingPage />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
```

- [ ] **Step 4: Run the tests, typecheck and build.**
  - Run: `npm run typecheck && npx vitest run && npm run build`
  - Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add src/features/public/PublicRankingPage.tsx src/features/public/ranking.test.tsx src/App.tsx
git commit -m "feat: public club rankings and records page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end, documentation and production

**Files:**
- Modify: `tests/e2e/04_public_offline.sh`, `README.md`, `docs/DEPLOY.md`, `CLAUDE.md`

- [ ] **Step 1: Extend the E2E scenario.** In `tests/e2e/04_public_offline.sh`, insert these steps right after the step "public athlete page never leaks e-mail, phone or birth date (C-Minor-18)" and before "pub_event RPC payload never leaks…".

  The data comes from scenarios 01–03: Ana and Beto are the "Tubarões" relay team, Caio and Duda ran the 5 km, and both races are finalized.
```bash
step "athletes directory → search → profile → partner → Nós dois"
ab pub open "$APP/#/perfis" >/dev/null
wait_tid pub public-athletes
set_value pub "$(tid athlete-search)" "ana"
wait_text pub "$(tid public-athletes)" "Ana"
click_with_text pub "$(tid athlete-row)" "Ana"
wait_tid pub public-athlete
wait_text pub "$(tid public-athlete)" "Participações"
click_with_text pub "$(tid public-athlete) a[href*=\"#/comparar/\"]" "Beto"
wait_tid pub public-compare
wait_text pub "$(tid compare-together)" "Tubarões"
expect_text pub "$(tid compare-side-by-side)" "Participações"
COMPARE_URL=$(ab pub get url)
snap pub 04-public-compare

step "club rankings"
ab pub open "$APP/#/ranking" >/dev/null
wait_tid pub public-ranking
wait_text pub "$(tid public-ranking)" "Vitórias gerais"
expect_text pub "$(tid public-ranking)" "Caio"
snap pub 04-public-ranking
```
  After the existing `PUB_ATHLETE_JSON` check, add:
```bash
PUB_STATS_JSON=$(curl -sS -X POST "http://127.0.0.1:$SHIM_PORT/rest/v1/rpc/pub_stats" \
  -H 'Content-Type: application/json' -H 'apikey: sb_publishable_local_dev' -d '{}')
python3 - "$PUB_STATS_JSON" "$ANA_EMAIL" "$ANA_PHONE" <<'PY' || fail pub "pub_stats RPC payload leaks private athlete data or is malformed"
import json, sys
raw, email, phone = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.loads(raw)
assert email not in raw and phone not in raw, 'pub_stats carries an athlete e-mail or phone'
assert 'birth_date' not in raw and 'public_profile' not in raw, 'pub_stats carries birth_date or public_profile'
assert all(set(a) == {'id', 'name', 'sex', 'city', 'team_club'} for a in data['athletes']), 'unexpected athlete fields'
assert data['results'], 'pub_stats returned no result although scenario 03 finalized the races'
PY
```
  In the step "public pages at 390×844", after the home page snapshot, add (Review Focus 5):
```bash
ab pub open "$APP/#/perfis" >/dev/null
wait_tid pub public-athletes
no_hscroll pub "public athletes"
snap pub 04-public-athletes-mobile
ab pub open "$COMPARE_URL" >/dev/null
wait_tid pub public-compare
no_hscroll pub "public compare"
snap_pages pub 04-public-compare-mobile
ab pub open "$APP/#/ranking" >/dev/null
wait_tid pub public-ranking
no_hscroll pub "public ranking"
snap_pages pub 04-public-ranking-mobile
```

- [ ] **Step 2: Run the full suite.**
  - Run (Linux/WSL): `npm run typecheck && npx vitest run && npm run test:integration && bash scripts/test-sql.sh && bash tests/e2e/run.sh`
  - Expected: all green, ending with `E2E PASS`.
  - Open the new `04-public-*` screenshots and check the layout at 390×844 and at 1280×800.
  - Fix any visual defect with a failing component test first.

- [ ] **Step 3: Update the docs.**
  - `README.md`: in "Páginas públicas", replace the profile bullet with:
```markdown
  - lista e busca de atletas (`#/perfis`) e perfis com histórico e estatísticas, filtráveis por ano, para quem aceitou ter perfil público;
  - "Nós dois" (`#/comparar/…`): dois atletas lado a lado, o desempenho juntos em dupla ou equipe e o confronto direto;
  - rankings e recordes do clube (`#/ranking`), por ano e por sexo.
```
  - `docs/DEPLOY.md`: in "Migrations", add `ebc_0010_pub_stats` (perfis públicos e estatísticas do clube) to the list of applied migrations.
  - `CLAUDE.md`: change "Migrations `0001`–`0009`" to "Migrations `0001`–`0010`".

- [ ] **Step 4: Commit.**

```bash
git add tests/e2e/04_public_offline.sh README.md docs/DEPLOY.md CLAUDE.md
git commit -m "test(e2e): public athletes, Nós dois and rankings; docs for 0010

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Production.** This is the controller's job, not a subagent's. **Confirm with the user before running anything against production.**
  1. Push `feat/public-stats` and open a PR to `main`. Merge the latest `main` into the branch first if it moved.
  2. Apply `supabase/migrations/0010_pub_stats.sql` verbatim with the Supabase MCP `apply_migration`: project `wlishmznbhhcqzncdxnq`, name `ebc_0010_pub_stats`.
  3. Run `supabase/tests/70_pub_stats.sql` in production through `execute_sql`, as one query: `begin;` + the contents of `00_helpers.sql` + the file without its own first `begin;` and last `rollback;` + `rollback;`.
     - Its assertions are scoped to the fixture ids, so real data does not break them.
     - Its privacy-rule assertion runs over all real public athletes too.
  4. Confirm nothing leaked: `select to_regnamespace('tests') is null`, no `owner@ebc.test` user, no event named `Copa Pública`/`Copa Antiga`/`Copa Privada`, `organizers` count unchanged.
  5. Re-run the EXECUTE matrix query of `60_security.sql` (the A-M6 block) in production. Expected: no mismatch.
  6. Merge the PR with a merge commit, then check that the Vercel production deployment of the merge commit is READY.
  7. Smoke-test on https://endurance-base-club.vercel.app:
     - `#/perfis` lists the athletes;
     - a profile opens;
     - `#/ranking` renders.
