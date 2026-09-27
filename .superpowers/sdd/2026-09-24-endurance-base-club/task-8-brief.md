## Task 8: Integration test — full flow through supabase-js and the shim

**Files:**
- Create: `tests/integration/helpers.ts`, `tests/integration/flow.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7 (migrations, shim), `src/lib/types.ts`.
- Produces: `startStack(db: string, port: number): Promise<{ url: string; stop(): void; sql(q: string, params?: unknown[]): Promise<any[]> }>` in `helpers.ts` (reset DB, seed nothing, spawn shim, wait until ready).

- [ ] **Step 1: Write the failing test `tests/integration/flow.test.ts`** (one `describe`, sequential `it`s sharing state):
  1. `sql("select public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')")`; client A signs in; `rpc('admin_me')` → role owner, `must_change_password` true; `auth.updateUser({password:'senha-nova-123'})` + `rpc('admin_password_changed')` → `admin_me().must_change_password` false.
  2. `admin_save_event` (`is_public: true`, levels `["Elite","Base"]`) → event; `admin_save_race` relay (team 2, swim 750 / run 5000) and individual run 5K.
  3. `admin_save_athlete` × 3 (Ana F 1990-06-15, Beto M 1988-01-20, Caio M 1995-03-03); `admin_save_entry` team "Tubarões" (Ana leg 0, Beto leg 1, level Elite) and `admin_bulk_create_entries(run race, [Caio])`.
  4. anon client B: `tk_open(token)`; `tk_register` twice (tk1 "Ana", tk2 "Bia").
  5. A: `admin_set_wave_start(relay wave, T0)`.
  6. tk1 `tk_sync` marks: relay leg 0 at T0+10:00.000, relay leg 1 at T0+30:00.000; tk2: relay leg 0 at T0+10:04.000 (4 s divergence), leg 1 at T0+30:00.500 → all accepted.
  7. A: `admin_live(event, null)` → 4 marks; `admin_set_resolution(entry, 0, 'mark', <tk1 leg0 id>, null, 'foto')` → row mode `mark`.
  8. anon: `pub_event(slug)` → athletes lack `email`, entries include member names, 4 marks; `pub_live(slug, <server_now>)` → 0 marks.
  9. A: `admin_finalize_race(relay, [row])` with a hand-built row (`status 'finished'`, `final_ms 1_800_000`, `overall_pos 1`, `athlete_ids [Ana, Beto]`, `data` minimal object) → count 1; `admin_athlete_profile(Ana)` → 1 result; `admin_list_athletes()` → Ana `wins` 1.
  10. anon cannot call `admin_list_events` (error code `42501` or HTTP 401 surfaced as error).
- [ ] **Step 2:** run `npm run test:integration` → FAIL until helpers exist, then PASS. **Step 3: Commit** (`test: end-to-end RPC flow through supabase-js`).

---

