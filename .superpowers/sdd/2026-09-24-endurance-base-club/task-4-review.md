# Task 4 — task review (sonnet), diff 11c9660..b9cb55e — verdict: Needs fixes

Saved verbatim by the controller at handoff (the reviewer's message only existed in the Cowork session).

### Spec Compliance

❌ Issues found (Ruling 12 non-compliance, confirmed in code and in a test that pins the wrong behavior; plus one plan-mandated risk of the same shape). Everything else checked — permission gating, pt-BR/P0001 conventions, the legs/team_size mark-lock, event duplication, token rotation, RPC name/param parity with contracts.md — is compliant.

### Strengths

- All 17 functions (14 `admin_*` RPCs + 3 internal helpers) consistently follow `security definer set search_path = public, extensions, pg_temp`, `p_`-prefixed params, pt-BR `P0001` validation errors, and every `admin_*` call starts with `assert_organizer()`/`assert_owner()` (e.g. `admin_create_organizer`/`admin_delete_organizer` use `assert_owner()` — `0003_admin_events.sql:172,182` — everything else uses `assert_organizer()`).
- Every RPC name and parameter list matches contracts.md's authoritative list exactly.
- `entry_json`/`admin_me` (`0003_admin_events.sql:5-14,119-125`) are byte-for-byte the brief's given snippets.
- `validate_race_config` (`0003_admin_events.sql:32-116`) covers every field the brief lists; the age-group overlap check (`93-108`) handles an open-ended "60+" range and tied `min` values.
- The legs/team_size mark-lock (`0003_admin_events.sql:526-539`) matches the brief (locks on leg-count/modality-order/team_size only) and is tested both ways (`20_admin_events.sql:60-69` blocked, `73-83` allowed).
- The test-file departure from the brief's literal SQL (RPC-return verification instead of direct `SELECT`s) is legitimate: `tests.as_user` sets the role with `set_config(..., true)` (transaction-scoped), RLS has no policies, and every literal value from the brief is preserved.
- `admin_get_event`'s `timekeepers[].marks_count` filters `mk.event_id = ev.id` as well as `mk.timekeeper_id = t.id`.
- `version` bumping for live polling is left to Task 3's triggers (`bump_event_version`, `tg_events_before_update` in `0002_internal.sql:23-101`).

### Issues

#### Important (Should Fix)

1. **Ruling 12 violation: `admin_save_race` wipes existing waves (including recorded `start_at`) when `waves` is omitted on an update.** `supabase/migrations/0003_admin_events.sql:553-571`. The wave block iterates `jsonb_array_elements(coalesce(p_race->'waves', '[]'::jsonb))` unconditionally; with no `waves` key the loop never runs, `v_keep_ids` stays empty, `delete from public.waves where race_id = v_race_id and not (id = any(v_keep_ids))` (line 567) deletes every wave, and lines 569-571 insert a fresh default wave with `start_at = null`. Any later save of just the race name/legs/config (e.g. Task 19's RaceEditor) silently destroys recorded wave start times.
   The test at `supabase/tests/20_admin_events.sql:84-93` pins the wrong behavior (asserts the reset instead of asserting the previously set wave, `start_at = 2026-10-11T11:00:00Z`, survives).
   Fix: gate the whole wave block (loop + delete + default insert) on `is_insert or (p_race ? 'waves')`; on update with the key absent, skip it. `p_race ? 'waves'` is also true for an explicit JSON `null`, and `coalesce(p_race->'waves', '[]')` does not catch it (`->` keeps JSON null as a jsonb scalar) — `jsonb_array_elements` then raises a raw error instead of P0001; treat explicit null like an absent key. Rewrite test lines 91-92 to assert the wave is unchanged.

2. **Plan-mandated, same risk shape: `config` is reset to bare defaults on any update that omits `config`.** `0003_admin_events.sql:523-524`: `v_config := public.default_race_config(v_team_size) || coalesce(p_race->'config', '{}'::jsonb);` runs for inserts and updates with no fallback to `v_existing.config`, so a details-only save discards customized age groups, rankings, `divergence_threshold_s` or `reference_timekeeper_id`. Matches the brief's literal formula (the implementer flagged it as Concern #4). → Controller **Ruling 14**: on UPDATE, `config = default_race_config(new team_size) || existing.config || coalesce(payload.config, '{}')`.

#### Minor (Nice to Have)

1. NULL bypass in `validate_race_config` enum/range checks (`0003_admin_events.sql:40,43,46` `not in (...)`, `52,55,84` `not between`): in plpgsql `IF NULL` is false, so an explicit JSON `null` for `age_rule`/`team_age_rule`/`time_source`/`same_crossing_window_s`/`divergence_threshold_s`/ranking `size` passes validation. Mirror the `age_groups.min` pattern (`is null or ...`).
2. TOCTOU on `public_slug` uniqueness (`0003_admin_events.sql:346-364`): a concurrent collision surfaces as raw `23505` instead of the pt-BR P0001 "Endereço público já em uso"; integrity is preserved by the unique constraint.

### ⚠️ Cannot verify from diff

- Execute grants on internal helpers (`entry_json`, `next_unique_public_slug`, `validate_race_config`, and Task 3's `bootstrap_owner`/`internal_create_auth_user`): no revoke exists yet, and Postgres grants EXECUTE to PUBLIC by default, so they are callable by `anon`/`authenticated` through PostgREST until Task 7. → Controller **Ruling 15**: Task 7 revokes EXECUTE on all functions in `public` from `public, anon, authenticated` (plus default privileges) before granting only `admin_*` / `tk_*` / `pub_*`; `60_security.sql` asserts the helpers are not callable.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** RPC surface, validation depth and security conventions are solid, and the RLS test rewrite is correct; but `admin_save_race`'s wave handling contradicts Ruling 12 (data loss of recorded `start_at` on an ordinary race-details save) and a test pins the wrong behavior.

---

### Controller addendum (handoff) — Ruling 16, same fix round

`0003_admin_events.sql:555-563`: the wave upsert does `on conflict (id) do update set ... start_at = excluded.start_at`, taking `start_at` from the payload. A race editor (Task 19) that loaded the race before "Largar" was pressed would, on save, overwrite the recorded start with its stale `null`. **Ruling 16:** `admin_save_race` never changes `start_at` of an existing wave (`do update` sets only `race_id`, `name`, `position`); new waves inserted by `admin_save_race` start with `start_at = null`; start times change only via `admin_set_wave_start`. Add a test: set a start with `admin_set_wave_start`, then save the race sending that wave with `"start_at": null` → the start survives.
