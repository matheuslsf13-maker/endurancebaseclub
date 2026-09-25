# Task 13 Report: Synced clock and offline outbox

Worktree: `/home/claude/ebc-wt/t13` (branch `task/13`)
Commit: `59761d1` — `feat(lib): synced clock and offline outbox`

## What was implemented

### `src/lib/clock.ts`
- `ClockSample { t0, t1, server }`, `ClockState { offset_ms, rtt_ms, synced_at }`.
- `ClockSync` class:
  - `constructor(opts?: { maxSamples?, now?, initial? })` — `maxSamples` defaults to 10, `now` defaults to `Date.now`, `initial` defaults to `null`.
  - `addSample(s)`: computes `rtt = t1 - t0`; ignores the sample if `rtt < 0`; otherwise computes `offset = Math.round(server - (t0 + t1) / 2)` and pushes `{offset, rtt, addedAt: now()}` into a ring buffer trimmed to the last `maxSamples` (oldest evicted first).
  - Effective sample = the min-`rtt` entry in the buffer; if the buffer is empty, falls back to `initial` (so a reloaded page stays "synced" using yesterday's persisted offset until a fresh sample arrives); if neither exists, `null`.
  - `offsetMs`, `rttMs`, `synced`, `syncedAt` are read-only getters derived from the effective sample.
  - `now()` = `now() + (offsetMs ?? 0)` — falls back to the raw device clock when never synced.
  - `state()` returns `{offset_ms, rtt_ms, synced_at}` of the effective sample, or `null`.
- `takeSample(serverTime, now = Date.now)`: `t0 = now()`, `server = await serverTime()`, `t1 = now()`, returns `{t0, t1, server}` — brackets the RPC call for NTP-style sampling.

### `src/lib/outbox.ts`
- `LocalMark extends TkMarkInput { local_updated_at: number }`, `OutboxState = 'pending'|'synced'|'rejected'`, `OutboxItem { mark, state, reason?, sent_at_version? }`.
- `Outbox` class, backed by `KeyValueStorage` via `storage.ts`'s `readJSON`/`writeJSON`:
  - Persists `{ items: Record<id, OutboxItem> }` under the given key, rewritten after every mutating call (`upsert`, `markSent`, `applyResult`). `readJSON`'s existing try/catch means corrupted JSON silently becomes `{ items: {} }`.
  - `upsert(mark)` stamps `local_updated_at = now()` and always replaces the item with a **fresh** `{mark, state: 'pending'}` (dropping any prior `reason`/`sent_at_version`) — this is what makes editing a rejected mark, or an in-flight one, re-queue it for sending.
  - `all()` returns items sorted by `mark.ts` ascending; `pending(limit?)` filters `state === 'pending'` off that same ordering and optionally slices.
  - `markSent(marks)` snapshots each mark's current `local_updated_at` into `sent_at_version` — this is the "version that was sent," per the brief's doc comment — without touching `state` (an in-flight mark still shows as `pending`).
  - `applyResult(accepted, rejected)`: an accepted id only flips to `'synced'` when `mark.local_updated_at === sent_at_version` (i.e. nothing changed locally after it was sent); otherwise it's left `pending` so the newer edit gets resent. A rejected id gets `state: 'rejected'` and `reason` set.
  - `pendingCount()` counts `state === 'pending'` items.

Both files are additions only; `storage.ts` and `types.ts` were read but not modified.

## TDD evidence

**Step 1 — tests written verbatim from the brief:** `src/lib/clock.test.ts`, `src/lib/outbox.test.ts`.

**Step 2 — RED** (`npx vitest run src/lib`, before `clock.ts`/`outbox.ts` existed):
```
FAIL  src/lib/clock.test.ts [ src/lib/clock.test.ts ]
Error: Failed to resolve import "./clock" from "src/lib/clock.test.ts". Does the file exist?
FAIL  src/lib/outbox.test.ts [ src/lib/outbox.test.ts ]
Error: Failed to resolve import "./outbox" from "src/lib/outbox.test.ts". Does the file exist?

 Test Files  2 failed | 2 passed (4)
      Tests  11 passed (11)
```
(The 2 passed files/11 tests are the pre-existing `format.test.ts`/`storage.test.ts` from Task 1; both new suites failed to even load, confirming a genuine RED.)

**Step 3 — implemented** `src/lib/clock.ts` and `src/lib/outbox.ts`.

**Step 4 — GREEN** (`npx vitest run src/lib`, `--reporter=verbose`):
```
✓ src/lib/format.test.ts > format (independent of device time zone) > ... (9 tests)
✓ src/lib/storage.test.ts > storage > ... (2 tests)
✓ src/lib/clock.test.ts > ClockSync > falls back to the device clock until synced
✓ src/lib/clock.test.ts > ClockSync > uses the minimum-RTT sample
✓ src/lib/clock.test.ts > ClockSync > keeps only the last N samples and ignores negative RTT
✓ src/lib/clock.test.ts > ClockSync > persists and restores state
✓ src/lib/clock.test.ts > ClockSync > takeSample brackets the server call
✓ src/lib/outbox.test.ts > Outbox > stores new marks as pending and persists them
✓ src/lib/outbox.test.ts > Outbox > only confirms marks that did not change while in flight
✓ src/lib/outbox.test.ts > Outbox > records rejections and re-queues on edit
✓ src/lib/outbox.test.ts > Outbox > orders by ts and honors limits
✓ src/lib/outbox.test.ts > Outbox > survives corrupted storage

 Test Files  4 passed (4)
      Tests  21 passed (21)
```

**Full repo suite** (`npx vitest run`): `Test Files  4 passed (4)`, `Tests  21 passed (21)` — no other test files exist yet in this worktree (other tasks are on parallel branches), so this equals the `src/lib` run.

**Typecheck** (`npm run typecheck` → `tsc --noEmit -p tsconfig.json`): no output, exit clean — zero errors.

**Step 5 — commit:** `59761d1 feat(lib): synced clock and offline outbox` (`git status --porcelain` clean afterward; diff is 4 new files / 267 insertions, no existing files touched).

## Files changed
- `/home/claude/ebc-wt/t13/src/lib/clock.ts` (new)
- `/home/claude/ebc-wt/t13/src/lib/clock.test.ts` (new, verbatim from brief)
- `/home/claude/ebc-wt/t13/src/lib/outbox.ts` (new)
- `/home/claude/ebc-wt/t13/src/lib/outbox.test.ts` (new, verbatim from brief)

## Self-review findings

Went through each exported symbol against the `contracts.md` "Libs signatures" block field-by-field (constructor option shapes, method signatures, return types) — all match exactly, including the extra types (`ClockSample`, `OutboxState`) that the signature block requires as exported even though the brief's one-line summary only names the headline types.

Traced every test through the implementation by hand before running (RTT/offset arithmetic, ring-buffer eviction order, the `sent_at_version`-vs-`local_updated_at` comparison in `applyResult`, the `all()`/`pending()` sort-then-filter order) to make sure the design wasn't just curve-fit to pass — it follows directly from the brief's stated rules and the design spec's §7.2/§7.4 prose.

One deliberate design decision worth flagging since it's underspecified by the given tests: `upsert()` replaces the whole `OutboxItem` (so a re-edit clears a stale `reason`/`sent_at_version` rather than carrying them forward). I checked this against every test scenario, including the "in-flight edit" case in outbox.test.ts #2 — carrying the stale `sent_at_version` forward instead would produce identical observable behavior there (a strict `!==` against a stale value and against `undefined` both fail), so both designs pass the given contract; I chose the cleaner one (a fresh pending edit shouldn't carry a dead in-flight marker or an old rejection reason).

No bugs found on review. No changes made after the initial GREEN run.

## Concerns
None blocking. Two things worth the next consumer (Task 22/23, the timekeeper screen and `useClock` hook) knowing, both already implied by the design spec and out of this task's scope:
- `ClockSync`/`Outbox` are plain classes with injectable clocks/storage for testability; the periodic sampling schedule (5 samples on open, then every 20s / on tab focus per §7.2) and the 2s→10s backoff sync loop (§7.4) are scheduling concerns for the hook/screen layer, not this library.
- `Outbox` never deletes items (matches the spec's "Minhas marcações" list showing pending/synced/rejected); if unbounded growth over a long event is a concern, that's a product/UI decision for a later task, not something the given contract asks this task to solve.

---

## Fix round 1 (review finding)

Commit: `e848e34` — `fix(lib): degrade Outbox to empty on wrong-shaped stored JSON`

### Issue (Important, from task review)
`Outbox` crashed instead of degrading to empty on well-formed-but-wrong-shape stored JSON:
- `src/lib/outbox.ts:37` (old): `this.items = readJSON<OutboxData>(storage, key, { items: {} }).items;` — `readJSON` only catches unparsable JSON syntax, not wrong shape, so a stored `'null'` parses fine to `null` and `null.items` threw `TypeError: Cannot read properties of null (reading 'items')` directly in the constructor.
- `src/lib/outbox.ts:44-45` (old), inside `all()`: `Object.values(this.items)` — a stored `'{}'` or `'[]'` parses fine but has no `.items` key, so `this.items` became `undefined`, and a stored `'{"items":5}'` made `this.items` the number `5`; either way `Object.values(...)` threw `TypeError: Cannot convert undefined or null to object`.

The rule ("corrupted storage → empty") only had a test for unparsable JSON syntax (`'{oops'`); nothing exercised well-formed-but-wrong-shape input.

### What changed
`src/lib/outbox.ts`:
- Added `isRecord(value): value is Record<string, unknown>` (true for non-null, non-array objects).
- Added `sanitizeItems(raw: unknown): Record<string, OutboxItem>`: returns `{}` unless `raw` is a record; otherwise keeps only the entries whose value is itself a record with a record `.mark` (i.e. skips any entry that isn't shaped like an `OutboxItem`), dropping everything else.
- Constructor now reads the stored value as `unknown` (`readJSON<unknown>(storage, key, { items: {} })`) and pipes `data.items` (only read once `data` itself is confirmed to be a record) through `sanitizeItems` before assigning `this.items`. `this.items` is therefore always a valid `Record<string, OutboxItem>` — possibly empty — after construction, so every later `Object.values(this.items)` call (`all()`, `pendingCount()`) is safe by construction; no other method needed to change.
- Removed the now-unused (and no-longer-accurate) private `OutboxData` interface.

`src/lib/outbox.test.ts`: added `'survives well-formed but wrong-shaped stored JSON'`, looping over the four cases the review asked for (`'{}'`, `'null'`, `'[]'`, `'{"items":5}'`), asserting `all()` returns `[]` for each and that a subsequent `upsert` still works (`get('m1')!.state === 'pending'`).

### TDD evidence for the fix

**RED** — added the new test first, ran it against the old code (`npx vitest run src/lib/outbox.test.ts`):
```
FAIL  src/lib/outbox.test.ts > Outbox > survives well-formed but wrong-shaped stored JSON
TypeError: Cannot convert undefined or null to object
 ❯ Outbox.all src/lib/outbox.ts:45:19
   44|   all(): OutboxItem[] {
   45|     return Object.values(this.items).sort((a, b) => (a.mark.ts < b.mar…

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```
This reproduces exactly the crash the review reported (first case in the loop, `'{}'`, hits `all()`).

**GREEN** — after the fix, same command:
```
✓ src/lib/outbox.test.ts > Outbox > stores new marks as pending and persists them
✓ src/lib/outbox.test.ts > Outbox > only confirms marks that did not change while in flight
✓ src/lib/outbox.test.ts > Outbox > records rejections and re-queues on edit
✓ src/lib/outbox.test.ts > Outbox > orders by ts and honors limits
✓ src/lib/outbox.test.ts > Outbox > survives corrupted storage
✓ src/lib/outbox.test.ts > Outbox > survives well-formed but wrong-shaped stored JSON

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Along the way, `npm run typecheck` first caught a real type error of its own (`value as OutboxItem` from a narrowed `Record<string, unknown>` — TS2352, "neither type sufficiently overlaps with the other"), which needed `value as unknown as OutboxItem` since `Record<string, unknown>` and `OutboxItem` don't structurally overlap enough for a direct assertion. Fixed before considering the round done.

**Full re-verification after the fix:**
- `npx vitest run src/lib/outbox.test.ts` → `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- `npm run typecheck` → no output, exit clean.
- `npx vitest run src/lib` → `Test Files 4 passed (4)`, `Tests 22 passed (22)` (21 from before + 1 new).
- `npx vitest run` (whole repo) → same, `4 passed (4)` / `22 passed (22)` — still no other test files exist in this worktree yet.
- `git status --porcelain` touched only `src/lib/outbox.ts` and `src/lib/outbox.test.ts` (2 files changed, 35 insertions, 3 deletions).

### Files changed (this round)
- `/home/claude/ebc-wt/t13/src/lib/outbox.ts`
- `/home/claude/ebc-wt/t13/src/lib/outbox.test.ts`
