# Task 6 — task review (opus), diff d415c39..2bfd23f — verdict: Needs fixes
(saved by the controller from the reviewer's message)

Spec: ❌ one item — the brief's Step-1 case `admin_set_resolution(entry, 0, 'mark', <a mark of leg 1>)` → P0001 is not really tested: 40_timing.sql:172-174 uses `mark_assigned`, which by then is discarded (line 124) and unassigned (line 142), so it is rejected for another reason. Everything else matches (tk_sync byte-identical to the brief; signatures, shapes, conventions OK; auth order token → secret → active verified by probes).

## Important
1. Leg-mismatch guard of admin_set_resolution (0005:218) has no discriminating test — mutation (removing `and leg_index = p_leg_index`) still passes; the `not discarded` predicate is not tested alone either. Fix: non-discarded mark on the same entry at leg 1 (e.g. assign mark_unassigned to (entry,1) via admin_update_mark) + a separate case for a discarded mark on the right leg.
2. (plan-mandated) tk_sync update path is not replay-safe: a committed request whose response was lost is re-sent later and silently reverts an organizer move made meanwhile (admin_update_mark + a mode='mark' resolution pinned to it) — reproduced by probe. Discards are protected, moves are not.
3. (plan-mandated) the per-mark `exception when others` (0005:107-108) turns non-validation errors into permanent rejections with raw English text: a concurrent duplicate send of the same mark returns "duplicate key value violates unique constraint marks_pkey" although the mark is stored (outbox then shows ⚠ rejected); an unknown athlete_id (FK) or non-integer clock_offset_ms ("12.5") rejects the whole mark including its ts. Suggested: `insert … on conflict (id) do nothing` then fall through to the ownership/update path; null-out invalid hint/audit fields instead of rejecting the time.

## Minor
- Untested security branches: tk_sync with tk_enabled=false; cross-event entry_id; another event's token; last_seen_at update; timekeeper discard (discarded_by='timekeeper'); organizer-discarded mark re-sent with discarded:true keeps 'organizer'; DB row after a Descartada rejection; non-null p_since in tk_sync; accepted ids (only counts checked); admin_update_mark rejections; admin_finalize_race with a foreign entry; tk_open('errado') runs as superuser not anon (40:32-33); manual-without-ts checks only errcode (179-180); p_since-in-future case doesn't assert resolutions come back (188-194).
- Non-P0001 escapes: p_mode null → 23502 (0005:212); "discarded": null in admin_update_mark → 23502 (182/189); "active": null → 23502 (267); missing status in admin_finalize_race → 23502 (298); bad uuid in athlete_ids → 22P02; duplicate rows → 23505.
- admin_update_mark leaves athlete_id stale on reassign/unassign; silently ignores leg_index when unassigned; does not clean resolutions pinned to a moved mark (189-192, 165-166).
- admin_update_timekeeper has no 60-char name cap (tk_register has); device_label unbounded.
- (plan-mandated) tk_open exposes whole entry rows via entry_json → to_jsonb(e) (notes, penalty_ms, level) to anyone with the link; spec §6 lists fewer fields; pub_event reuses the shape.
- Leg-range check duplicated 3× (tk_sync, 175-178, 208-211); waves query duplicated in tk_open and admin_live.
