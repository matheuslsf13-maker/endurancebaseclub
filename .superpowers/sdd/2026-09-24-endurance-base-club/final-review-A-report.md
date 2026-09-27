# Final review — Area A: database, security, auth, API boundary (e98799a..9cf9614)

Reviewer: final whole-branch review, area A (read-only). The ~294 kB diff was read in passes: (1) migrations 0001/0002 + bootstrap, (2) 0006 grants/public, (3) 0005 timing, (4) 0003/0004 admin, (5) shim + JWT, (6) api.ts/supabase.ts/.env*, (7) features/auth, (8) SQL tests 00/10/40/50/60, (9) integration tests + scripts. Full files were read at HEAD 9cf9614 where a hunk needed context. No suites were re-run (evidence given: test-sql 7/7, integration 16/16, vitest 620, typecheck, E2E). Library behaviour was checked in the installed sources (supabase-js/postgrest-js/auth-js 2.117.1).

Mechanical checks run for this review:
- Every function in the migrations was classified (definer/invoker, volatility, search_path, grant bucket): all granted RPCs except `server_time` are `security definer`; every function pins `search_path = public, extensions, pg_temp`; **no `stable`/`immutable` function writes**. This matters because PostgREST runs stable/immutable RPCs in a read-only transaction and the shim does not.
- All 30 `admin_*` bodies call `assert_organizer()`/`assert_owner()` before any data access.
- All 35 RPC calls in `src/lib/api.ts` use the exact SQL parameter names (PostgREST answers 404 PGRST202 on an unknown key; the shim silently drops it).
- There are no committed secrets: `.env.production` holds only the project URL and the publishable key, and `.mcp.json` holds no tokens.

## Strengths

- **Grant model (Rulings 15/35/37).** 0006 revokes table, sequence and function privileges plus the schema default privileges from anon/authenticated. It then runs the role-global `alter default privileges revoke execute on functions from public` and grants back by name prefix. The result holds whatever role owns the functions. 60_security proves the internals are not executable (`tk_event`, `resolve_public_event`, `entry_json`, `bootstrap_owner`, `internal_create_auth_user`), proves table reads fail with 42501, and uses `zz_probe` to show a function created later is not PUBLIC-executable. T29 Step 2 runs this file on production, which is the real answer to "will the grants hold under the Supabase migration role".
- **Privacy projections are explicit and tested (Rulings 4/29/42/43):**
  - `tk_token` and `tk_enabled` are removed from the public event.
  - Entry `notes` are removed from both `tk_open` and `pub_event`.
  - Athletes are built field by field, so email, phone and birth_date never leave.
  - Marks lose the clock-audit fields and `org_edited`.
  - Resolutions lose `note` and `decided_by`.
  - `pub_athlete` requires `public_profile` and only returns results from public events.
  - Ages use the `::timestamp` overload, which fixes the DST-start off-by-one.
- **tk_sync is robust:**
  - Each mark runs in its own subtransaction.
  - `on conflict (id) do nothing` with a fall-through to the existing row makes replays idempotent.
  - `ts` cannot be changed after insert.
  - Ownership is checked with `timekeeper_id`. Entries are looked up only inside the token's event, so marks cannot cross events.
  - A hint `athlete_id` is kept only if that athlete is a member of the entry.
  - Only P0001 errors reject a mark; any other error leaves it pending, so the device retries it.
  - Ruling 27 (`org_edited`) and Ruling 28 each have a discriminating test.
- **Auth user creation matches what GoTrue expects.** `internal_create_auth_user` sets every token column to `''`, sets `email_confirmed_at`, `aud`/`role`, the provider app metadata, and an identity row with `provider_id = user_id` and `email_verified`. It hashes with pgcrypto bcrypt (`$2a$10$`), which GoTrue's Go bcrypt accepts. 10_schema pins each of these.
- **Version bumps and deltas.** Triggers cover every structural table, and the double-bump guard works. Live feeds return mark deltas by `updated_at` (with the 10 s client overlap) and return resolutions and waves in full, so deletions propagate.
- **api.ts:**
  - A hard per-call timeout via AbortController (safe on Safari < 16): 15 s, and 5 s for `server_time`.
  - Both the resolved status-0 failure and a rejected abort map to `'network'`.
  - postgrest-js 2.117 never retries POST RPCs, so the library cannot duplicate writes.
  - `server_time` is sanity-checked.
- **session.tsx:**
  - Sign-out uses `scope: 'local'`, so a phone logging out never kills the master laptop.
  - The TanStack cache, which holds athlete contacts, is cleared on sign-out.
  - It separates a server that rejected the session from a transient failure, so the organizer is never logged out by a network hiccup.
  - Non-organizer accounts are handled (forbidden, then signed out).
  - GoTrue errors are mapped to pt-BR, including `same_password`, `weak_password` and 429.

## Issues

### Critical

None.

### Important

**I1. A duplicated event copies another event's `reference_timekeeper_id`, and the copied races can then no longer be saved.**
- Where:
  - `supabase/migrations/0003_admin_events.sql:423-426` (admin_duplicate_event copies `r.config` verbatim).
  - `0003_admin_events.sql:110-115` (validate_race_config requires the reference timekeeper to belong to the event, whatever the `time_source`).
  - `src/features/races/RaceEditor.tsx:284-291` (the select is disabled under "median" and has no option matching a foreign id).
- What: any race whose config has a non-null `reference_timekeeper_id` keeps that id in the copy. That covers the case where the organizer once picked a reference timekeeper and later switched back to median, because the id stays in the config. The copied event has no timekeepers.
  - The editor always sends the full config (Ruling 14; `raceForm.ts` formToPayload).
  - So every save of that race in the copy fails with "Cronometrista de referência inválido".
  - The organizer cannot clear the value: under "median" the select is disabled. Under "reference", a controlled `<select>` whose value matches no option shows "Selecione" but cannot emit a change back to "Selecione".
- Why it matters: "duplicar edição" is the intended way to set up the next edition. The server creates an invalid state and the UI has no way out, which blocks configuring races in the new event. This is a cross-task seam (T4 duplicate, T4 validation, T19 editor) that no single task review could see.
- Fix (SQL, one line plus a test in 20_admin_events):
  - In admin_duplicate_event, insert `r.config || jsonb_build_object('reference_timekeeper_id', null, 'time_source', case when r.config->>'time_source' = 'reference' then 'median' else r.config->>'time_source' end)`.
  - Optional hardening: validate `reference_timekeeper_id` only when `time_source = 'reference'`, and have RaceEditor clear the id when switching to median.

**I2. "Sair" while offline with an expired access token does not sign out; the organizer session comes back when the network returns.** (Promoted from the deferred T17 minor after verifying it in auth-js.)
- Where: `src/features/auth/session.tsx:72-78` (dropSession) and `:196-200` (signOut), with the listener at `:152-166`.
- What, verified in auth-js 2.117.1 `GoTrueClient._signOut`:
  - `_useSession` loads the stored session. If the access token has expired, it tries a refresh.
  - An offline or retryable failure keeps the session in storage (`_callRefreshToken`: `if (!isAuthRetryableFetchError(error)) _removeSession()`).
  - `_signOut` then returns `{ error }` **before** `_removeSession()`.
  - `dropSession` swallows the error, and the UI applies ANON. `ebc.auth` (refresh token included) is still in localStorage and the auto-refresh ticker keeps running.
  - When coverage returns, the ticker refreshes and fires `TOKEN_REFRESHED`. The listener sees status `anon` and calls `restore()`, which runs `loadMe()` and restores the full organizer session on that device.
- Why it matters: this is plausible on race day. A phone suspended for more than 1 h has an expired token, the venue has poor coverage, and the organizer taps "Sair" before lending the phone to a volunteer as a timekeeping device. The volunteer later has full organizer access (edit results, delete events). The organizer believes they logged out.
- Fix (about 5 lines plus a test):
  - In `dropSession`, after `signOut({ scope: 'local' })` whatever it returns, remove the stored session: `localStorage.removeItem('ebc.auth')` and `'ebc.auth-user'` inside a try/catch.
  - Alternatively, keep a `signedOut` ref that stops the `TOKEN_REFRESHED`/`SIGNED_IN` branch from restoring until the next explicit `signIn`. Doing both is best.
  - Test: `signOut` resolving `{ error: AuthRetryableFetchError }`, then a later `TOKEN_REFRESHED`, and status must stay `anon`.

### Minor

**M1. Public sign-ups are left enabled in Supabase Auth.** This is production config, not code. Spec §14 says accounts are created only by SQL or the owner, but a new Supabase project ships with "Allow new users to sign up" ON, and the publishable key is public.
- Impact is small: every `admin_*` is gated (verified 30/30), and the built-in SMTP only mails team addresses, so strangers cannot confirm.
- It still allows junk `auth.users` rows. It also lets someone squat an email, after which `admin_create_organizer` fails for that address with "Já existe uma conta com este e-mail".
- Fix: in T29, turn off Authentication → Sign In / Providers → "Allow new users to sign up". Check that `POST /auth/v1/signup` answers `signup_disabled`. Sign-in, password change and SQL-created users are unaffected.

**M2. `api.ts` passes raw English PostgREST/Postgres messages through for every code except P0001/42501** (`src/lib/api.ts:61-65`).
- Messages reachable in production include:
  - 57014 statement timeout (Supabase roles: anon 3 s, authenticated 8 s; the shim has no timeout)
  - 23505/23503 (the deferred check-then-insert races)
  - 22P02 cast errors, 23502
  - PGRST202 (frontend deployed before the migrations or a stale schema cache)
  - PGRST002 / 503 (schema cache loading)
  - 40P01 deadlock
  - 5xx gateway bodies
- Why: CLAUDE.md requires pt-BR UI text.
- Fix: a small code→pt-BR map in `call()`. Keep P0001/42501 messages verbatim, map `status >= 500` to a "servidor indisponível" network-class error, and use a generic "Não foi possível concluir a operação" as the fallback. This also covers most of the deferred T5 raw-error minors.

**M3. `admin_get_event` sends every timekeeper's `secret` to the organizer client** (`0003_admin_events.sql:220`, `to_jsonb(t) || …`).
- This contradicts the stated design ("the secret never leaves the server after tk_register", 0005:309, and the 40_timing assert on admin_update_timekeeper).
- Organizers are trusted, but the secret sits in the browser cache and devtools for no reason.
- Fix: `(to_jsonb(t) - 'secret') || …`, plus an assert in 40_timing.

**M4. tk_sync and admin_update_mark read then write without a row lock** (`0005_timing.sql:129` and `:214`).
- Under READ COMMITTED, if an organizer move commits between tk_sync's `select … into ex` and its `update`, the update re-evaluates only `id = v_id` and overwrites the organizer's placement. `org_edited` stays true. This defeats Ruling 27 inside a millisecond window.
- In the other direction, admin_update_mark can restore a stale `discarded` flag.
- Fix: `select … for update` in both places (tk_sync's first select and its re-select after the lost insert race, and admin_update_mark's select).

**M5. Event creation fails for long names with an error about a field the organizer never touched** (`0003_admin_events.sql:346, 354, 359`).
- On every insert, even for private events, the slug is `slugify(name || '-' || date)` and must match `^[a-z0-9-]{3,80}$`.
- A name slug over 69 characters raises "Endereço público inválido". The same happens when making public a long-named event that has no slug, and the `-N` suffix can also push past 80. The UI has no maxLength on the name.
- Fix: `left(slugify(v_name), 60)` (trim a trailing `-`) before appending the date, and cap the base in `next_unique_public_slug`.

**M6. 60_security has no full EXECUTE-matrix assertion** (`supabase/tests/60_security.sql`). The named negatives plus `zz_probe` are good, but T29 runs this file on production, where it could prove Rulings 15/35 outright. Add one query that finds any function in `public` executable by anon (or authenticated) outside the intended set:

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  and not ((p.proname like 'tk\_%' and p.proname <> 'tk_event') or p.proname like 'pub\_%' or p.proname = 'server_time')
```

The result must be empty; do the same for authenticated with `admin_` added to the allowed set. This is also the open part of the T3 minor.

**M7. Athlete tallies defeat the GIN index** (`0004_admin_athletes_entries.sql:44-56`; also `:311` and `0006_public_grants.sql:137`).
- `a.id = any(r.athlete_ids)` cannot use `results_athletes_idx`, so `admin_list_athletes` runs 3 sequential scans of `results` per athlete.
- It is fine at today's scale. With a few thousand results × athletes it approaches the 8 s authenticated statement timeout.
- Fix: `r.athlete_ids @> array[a.id]`.

**M8. admin_save_race can re-parent another race's wave or move a race to another event** (`0003_admin_events.sql:592-593` and `:566`).
- `on conflict (id) do update set race_id = excluded.race_id` moves a foreign wave, with its `start_at`, into this race. An UPDATE writes `event_id` from the payload, which leaves entries in the old event.
- The current client never sends either.
- Fix: add `where public.waves.race_id = v_race_id` on the conflict update, and reject an `event_id` change on update.

## Minors triage (entries of final-review-minors.md in area A)

| Ledger entry | Verdict | Reason |
|---|---|---|
| T2 (L58): shim caches not-found signatures; unknown body keys dropped; bad JSON body → {}; shim.test hardcodes DB/port | **Defer** | Dev-only. All 35 api.ts keys match the SQL parameter names exactly, so the PostgREST-404-on-unknown-key gap has no current production impact. |
| T3 (L82): cascading race delete bumps version fewer times; slugify param not `p_`; permission matrix / version-delta not asserted | **Fix before production (matrix part only, see M6); defer the rest** | The version still changes on a cascade; slugify is internal. The matrix check is ~10 lines and runs on production in T29. |
| T4 (L105): NULL bypass in validate_race_config; public_slug TOCTOU raw 23505 | **Defer (already closed at HEAD)** | Explicit `is null or` checks at 0003:40-57/84. `cumulative` is always present after the default merge, and an explicit JSON null fails `jsonb_typeof`. The unique_violation handlers at 0003:370-387 cover the TOCTOU. |
| T5 (L135): raw FK error for unknown athlete id; raw cast errors; bib check-then-insert raw 23505; dead `en` | **Defer** | Admin-only and fed by pickers/validated forms. M2's error map turns the raw texts into pt-BR. |
| T4 (L137): explicit `"config": null` on update → generic P0001 | **Defer** | No data loss; the client always sends a full config. |
| T4 (L149): insert catches any unique_violation; Ruling 14 merge keeps old age_groups/rankings across a solo↔team switch without config | **Defer** | An id/tk_token collision is about 2^-143. T19 always sends the full config. |
| T5 (L156): create_individual_entry re-reads first wave/legs per athlete | **Defer** | Admin-only; milliseconds at club scale. |
| T6 (L185): malformed required fields retried forever; identical re-send rejected after org move with stale athlete_id; test gaps; MarkRow lacks org_edited | **Defer** | The client never emits malformed ids or ts (randomUUID/toISOString). The stale-athlete case only gives a spurious "Alterada pela organização" on a mark that is already correctly placed on the server, and `marks.athlete_id` is not read by src/domain. Clearing `athlete_id` in admin_update_mark when `entry_id` changes is an optional one-liner. |
| T7 (L212): pub_athlete sorts by snapshot date; pub_live untested on a private slug; AthleteProfile.athlete type; spec non-discarded vs all marks | **Defer** | Ordering only. `resolve_public_event`, shared with pub_event, is tested on a private slug. Ruling 43 supersedes the spec. The type is only wider than the payload. |
| T8 (L244): "Ana" timekeeper vs athlete name collision in the flow test | **Defer** | Test naming only. |
| T17 (L177), auth parts: changePassword partial-success retry; SIGNED_OUT-clears-cache test gap (the EventLayout/poll parts belong to area C) | **Defer** | No lockout: a retry with the same password gets GoTrue `same_password`, mapped to pt-BR, and the user picks another. Cache clearing is implemented (session.tsx:157). |
| T17 (L217a): offline "Sair" with expired token undone by TOKEN_REFRESHED | **Fix before production (→ I2)** | Verified in auth-js 2.117; it gives organizer access to whoever holds a lent phone. |
| T17 (L217b): restore racing a 42501 sign-in can apply ANON over FORBIDDEN | **Defer** | Cosmetic: the user sees the login page instead of the "sem acesso" card. |
| T17 (L217c): RPC timeout is not a hard deadline while a token refresh hangs | **Defer** | Affects only signed-in calls (`getAccessToken()` runs before the abortable fetch). Timekeeper marks stay pending and persisted, so nothing is lost. |
| T17 (L217d): persistent non-auth restore failure spins with no hint | **Defer** | The admin panel cannot work offline anyway. A "Sem conexão — tentando de novo" hint would be nice. |
| T17 (L217e): timed-out writes may have committed (retry → duplicate) | **Defer** | tk_sync is idempotent by id. Admin duplicates (event/athlete/race) are visible and deletable, and duplicate entries are blocked by the athlete-per-race rule. |
| T17 (L217f): contracts.md ApiError lacks `status` | **Defer** | Documentation only. |

## Declined to judge

- **Server-side enforcement of `must_change_password`.** The spec frames it as a UI step ("força troca"). The provisional password is known only to the owner, who already has full rights.
- **Import dedupe merging relatives who share an email** (0004:250-267 overwrites name and sex). Spec §6 mandates `lower(email)` dedupe and "atualiza campos não vazios". A preview warning when the name differs would help, but that is client or spec scope.
- **Entrants with `public_profile = false` still show name, city, club and age in pub_event and in results.** Spec §6 lists these fields; the flag governs only `#/atleta/:id`.
- **Timekeeper names in pub_event.** The spec says pub_event is "como tk_open", which includes timekeepers `(id, name)`.
- **No server cap on the tk_sync batch size, tk_register rate or `device_label` length.** Link holders are trusted volunteers, and the organizer can disable or rotate the link.
- **`random_token` modulo bias.** It gives about 142.8 bits instead of 143, which is negligible.
- **Plaintext timekeeper secret and non-constant-time `=` compare.** The secret is DB-internal and 190 bits; a remote timing attack is infeasible.
- **team_size or leg-count changes allowed while entries exist but no marks do.** The spec blocks this only when marks exist.
- **Statement timeouts at spec scale.** pub_event, tk_open and tk_sync are estimated well under anon's 3 s at 300 entries / 3,600 marks. Imports of thousands of rows could reach 8 s; that is beyond spec scale.
- **OpenAPI/pg_graphql introspection of function names.** They carry the same authorization as RPC.
- **The role-global default-privileges revoke affects every future function the migration role creates, in any schema.** This is intended and documented in 0006.
- **Deadlock potential from the unordered event bumps in `tg_athletes_bump_event_version`.** With one or two organizers this is improbable, and M2 would at least give it a readable message.
- **A `mode='mark'` resolution pinned to a mark the timekeeper later moves** (such a mark is not `org_edited`). The B1 interface is safe: consolidation.ts:87-94 falls back and flags `chosen_mark_discarded`.
- **A deactivated timekeeper can still call `tk_open`.** It is read-only structural data and link-level access is by design.
- **`service_role` keeps EXECUTE on the internal functions.** Its key is secret and server-only, and it bypasses RLS anyway.
- **`reauthentication_needed` is not mapped.** It only occurs if "Secure password change" is enabled; it is off by default.
- **Which role the Supabase MCP applies migrations as, and whether that role keeps DML on `auth.users`/`auth.identities` after Supabase's 2025 auth-schema restrictions.** Neither can be verified from the repo. T29 Step 2 (60_security, with M6) and Step 4 (bootstrap_owner) prove the grants and INSERT; see the recommendation for DELETE.
- **XLSX formula injection, CSP and headers, and the UI rendering of errors.** These belong to areas B1 and C.

## Recommendations (for T29 and the fix dispatch)

1. Fix I1 and I2 with tests, then M3/M4/M5/M6 (all small). Take M2 if the fix budget allows; it closes a whole class of English error texts.
2. T29 checklist additions:
   - Disable public sign-ups (M1).
   - After Step 4, exercise `admin_create_organizer` and then `admin_delete_organizer` once through the deployed app with a throwaway address. This proves the function owner's INSERT and DELETE on `auth.users` in PG17 Supabase; bootstrap_owner proves INSERT only.
   - Run `notify pgrst, 'reload schema'` after the last migration (Supabase's DDL event trigger normally does this; it is cheap insurance against PGRST202 on the first requests).
   - Record the advisor WARNs expected by design: `rls_enabled_no_policy`, and security-definer functions executable by anon/authenticated.
3. The T29 Step 6 smoke test expects the events page to load after logging in as the owner. With `must_change_password = true`, RequireOrganizer redirects to `/trocar-senha`. Adjust the expectation, since the brief also says not to change the password.
4. Longer term, add the missing shim fidelity:
   - `SET LOCAL statement_timeout` per role (3 s anon, 8 s authenticated).
   - 404 PGRST202 on unknown body keys.
   - 409 for 23505/23503.
   - GoTrue `same_password`.
   - A read-only transaction for stable functions.

   Then these production behaviours are exercised locally.

## Assessment

**Ready for production: With fixes.**

The security core is sound and well tested:
- RLS denies everything, and anon/authenticated have no table privileges.
- Every RPC is definer with a pinned search_path.
- The organizer gate is complete (30/30).
- Grants are explicit and prefix-based, and the proof for future functions runs on production in T29.
- Privacy projections cover every organizer-only field named by the spec and Rulings 4/29/42/43.
- tk_sync is idempotent and isolated per event and per timekeeper.

The migrations use nothing PG17 or Supabase lacks, and SQL-created users match the column set GoTrue logs in with. Two Important items should be fixed before real use:
- **I1:** the server itself creates an invalid race config on event duplication, and the editor cannot recover from it.
- **I2:** a verified auth-js path where an offline "Sair" silently restores organizer access on a lent device.

Both are small, testable changes. There are no Critical issues.
