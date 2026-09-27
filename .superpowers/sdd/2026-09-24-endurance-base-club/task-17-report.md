# Task 17 report: App shell (API client, session/auth, router, event data context)

**Status: DONE**

- Branch `task/17` in worktree `/home/claude/ebc-wt/t17`.
- Commits, oldest first:
  1. `3311334` wip(app): API client, session, router and event data context (partial). This is the previous implementer's work.
  2. `8066ba6` Merge branch 'feat/ebc-app' into task/17. The controller made this merge.
  3. `3cd4f76` feat(app): API client, session, router and event data context. This is my completion commit.
- Review BASE: `d648fac` (per ledger).
- Gates: vitest 23 files, 268 tests, all passing, with pristine output. `npm run typecheck` is clean. `npm run build` succeeds.

## What was implemented, by file

The WIP code plus my completion commit give the following.

- **`src/lib/supabase.ts`**: the only Supabase client. It is created with `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false` and `storageKey: 'ebc.auth'`. The URL and key come from `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`.
- **`src/lib/api.ts`**: `ApiError` has `code: string | null`, and `api` matches the contracts' "Libs signatures" exactly (every RPC name and `p_` parameter).
  - A server error becomes `ApiError(message, code)`.
  - A rejected fetch becomes `ApiError('Sem conexão com o servidor', 'network')`. This covers a thrown `TypeError` or `FetchError`, and also the `status: 0` result that postgrest-js resolves with on a failed fetch. I checked that behavior in postgrest-js 2.117.1.
  - `serverTime()` rejects a non-numeric or zero answer, so a bogus value never skews the clock.
- **`src/hooks/useClock.ts`**: a module-level `ClockSync` singleton.
  - On first use it restores `ebc.clock`, and ignores the saved value if it is malformed.
  - The first caller's effect starts sampling: 5 samples 300 ms apart, then one every 20 s, plus one on `visibilitychange` when the page becomes visible.
  - Sampling is single-flight. The state is saved after each successful sample. Failures keep the current offset.
- **`src/hooks/useEventData.ts`**: the query key is `['event', eventId]` and fetches with `api.admin.getEvent`. A polling effect runs once the aggregate has loaded:
  - Timing: every 2 s when `live`, every 15 s otherwise. It pauses while `document.hidden` and polls immediately when the page becomes visible again.
  - Request: `api.admin.live(eventId, since)`, where `since` is the last server_now minus 10 s.
  - Merging: marks are merged with `mergeById`, and resolutions and waves are replaced.
  - When `delta.version !== agg.version` it calls `refresh()`, unless a fetch is already running.
  - The poll is single-flight, including across effect re-runs.
  - A full refetch or a local `patchAgg` that lands during a poll is not overwritten by that poll's older lists.
  - It returns `{ agg, isLoading, error, refresh, patchAgg }`.
- **`src/features/events/EventContext.tsx`**:
  - The value is `{ eventId, agg, index, timing, classifications: Map<raceId, RaceClassification>, nowMs, refresh, patchAgg, clock }`.
  - `index` is memoized on `agg`. `timing` is memoized on `agg` plus a 10 s `useNow` tick. `nowMs` is the tick plus the synced offset. `classifications` is memoized on `agg`, `index` and `timing`.
  - `EventContext` is exported so screen tests can inject a fixture value. `useEventContext()` throws outside a provider.
- **`src/features/events/EventLayout.tsx`**:
  - Calls `useEventData(eventId, { live })`, with live true on `cronometragem`, `revisao` and `resultados`.
  - The header shows the event name, the date (`formatDateBR`) with the location, and a status badge.
  - `Tabs` has ids `geral`, `provas`, `inscricoes`, `cronometragem`, `revisao`, `resultados`. The Task 16 `Tabs` component turns these into the test ids `tab-<id>`. The labels are Geral / Provas / Inscrições / Cronometragem / Revisão / Resultados.
  - The Revisão badge counts error and warning issues (info issues are excluded). It uses the danger tone if there is any error, otherwise warning.
  - While loading it shows a `Spinner`. On error it shows a card with the message, a "Tentar novamente" button and a "Voltar para eventos" link.
  - It provides `EventContext` to `<Outlet/>`.
- **`src/features/auth/session.tsx`**: `SessionProvider` and `useSession()` provide `{ status, me, signIn, signOut, changePassword, refreshMe }`. `SessionContext` is exported for tests.
  - `signIn` trims the e-mail and maps `Invalid login credentials` / `invalid_credentials` to `ApiError('E-mail ou senha incorretos')`. Network failures map to `'Sem conexão com o servidor'` with code `network`.
  - After sign-in and after a session restore, it calls `admin.me()`. A `42501` answer sets status `forbidden` and signs the account out.
  - `changePassword` runs `updateUser({ password })`, then `admin.passwordChanged()`, then `refreshMe()`.
  - A restore that fails with a network error stays `loading` and retries every 3 s. Any other restore failure drops the session and becomes `anon`.
  - A `SIGNED_OUT` event from elsewhere (another tab, a revoked refresh token) becomes `anon` and clears the query cache. Signing out also clears the cache.
- **`src/features/auth/RequireOrganizer.tsx`**:
  - `loading` shows a `Spinner`.
  - `anon` renders `<Navigate to="/entrar" replace state={{ from }}>`.
  - `forbidden` shows "Esta conta não tem acesso de organização" plus a Sair button (`data-testid="logout"`).
  - `me.must_change_password` renders `<Navigate to="/trocar-senha">`.
  - Otherwise it renders its children or the `<Outlet/>`.
- **`src/features/auth/LoginPage.tsx`**: logo, `login-email`, `login-password`, `login-submit` and an error line (`role="alert"`). On success it returns to the `from` path it was redirected from (only if that is an in-app path), otherwise `/eventos`. An organizer who is already signed in is redirected.
- **`src/features/auth/ChangePasswordPage.tsx`**: `newpass-1`, `newpass-2`, `newpass-submit` and a `logout` button.
  - Messages: "A senha precisa ter pelo menos 8 caracteres" and "As senhas não conferem".
  - On success it shows the toast "Senha alterada" and goes to `/eventos`. Visitors without a session are sent to `/entrar`.
- **`src/features/NotFound.tsx`**: "Página não encontrada" with a link to `/`.
- **`src/App.tsx`**: `export const routes` and `createHashRouter(routes)`, exactly as the brief lists:
  - `/`: an organizer gets `<Navigate to="/eventos">`, anyone else gets `PublicHome`. It shows a spinner while the session is loading.
  - `/entrar`, `/trocar-senha`.
  - The admin group (`RequireOrganizer` + Task 16 `Layout`, whose own `logout` button calls `signOut`):
    - `/eventos`
    - `/eventos/:eventId` (`EventLayout`; the index redirects to `geral`; tabs `geral`, `provas`, `inscricoes`, `cronometragem`, `revisao`, `resultados`)
    - `/atletas`, `/atletas/:athleteId`, `/ajuda`, `/config`
  - `/c/:token`, `/p/:slug`, `/atleta/:athleteId`, `*` (NotFound).
- **`src/main.tsx`**: the provider order is `QueryClientProvider` (staleTime 5 s), then `SessionProvider`, `ToastProvider`, `ConfirmProvider`, and `App`, which renders `RouterProvider`. Queries are retried at most twice, and only on `ApiError` code `network`.
- **Stubs** (15 files, exactly `export default function X() { return <h1 className="p-6 brand-title">X</h1>; }`):
  - `EventsPage`, `EventGeneralTab`, `SettingsPage`, `HelpPage`
  - `RacesTab`, `EntriesTab`, `AthletesPage`, `AthleteProfilePage`
  - `TimingTab`, `ReviewTab`, `ResultsTab`
  - `TimekeeperPage`, `PublicHome`, `PublicEventPage`, `PublicAthletePage`
- **`src/test/setup.ts`** (Ruling 7): `afterEach(() => cleanup())` from `@testing-library/react`, next to the jest-dom import.

## What I changed vs the WIP, and why

1. **`useClock`: the 20 s interval now starts after the initial burst, and sampling is single-flight.**
   - Before: the WIP started `setInterval(20 s)` at the same moment as the 5-sample burst, and had no guard against concurrent samples. A slow network could overlap the interval sample with the burst, and a `visibilitychange` during a slow request fired a second request. Overlapping requests inflate each other's round-trip time, which is the quality measure.
   - Now: the brief says "5 samples 300 ms apart, *then* one every 20 s". Concurrent callers join the pending sample.
   - Pinned by `useClock.test.ts`. Its cadence test and single-flight visibility test fail against the WIP file and pass now.
2. **`useEventData`: the live poll is single-flight across effect runs.**
   - Before: the WIP's in-flight flag was local to one effect run. Switching from an idle tab to a live tab while a request was out (the interval changes, so the effect re-runs) could start a second `admin_live` request alongside the first.
   - Now: the flag is a hook-level ref. A tick that finds a request still out just reschedules itself.
   - Pinned by the test "stays single-flight when switching between an idle and a live tab mid-request", which fails on the WIP.
3. **`session.tsx`: more Supabase Auth errors are shown in Portuguese.** Unmapped errors used to surface in English. Added: `email_not_confirmed`, `user_banned`, HTTP 429 / `over_*` rate limits, and a missing or expired session during `changePassword` ("Sua sessão expirou. Entre novamente.").
4. **Scratch files deleted.** `src/zz-tmp-verify-clock.test.tsx` and `src/zz-tmp-verify-shell.test.tsx` held valuable checks the committed tests lacked: clock cadence, singleton and persistence; all of `useEventData`; the route table; `EventLayout`. I moved every assertion into properly named test files and extended them (listed below).
5. **Ruling 7 confirmed.** `src/test/setup.ts` registers `afterEach(cleanup)`. The new `src/test/setup.test.tsx` proves it: the second test asserts that the body is empty after the first test rendered. The auth tests also depend on it, because they use `getByTestId` across tests.

I reviewed everything else against the brief line by line and found it correct; no other changes were needed.

## Tests

This task owns 115 of the 268 tests.

- **`src/lib/api.test.ts`** (42): every case listed in the brief: `admin_save_event` / `p_event`, `tk_sync` with 5 `p_` params, `pub_live`, `admin_set_resolution` with 6 `p_` params, `{error:{message:'Falhou',code:'P0001'}}` throwing `ApiError`, `TypeError('Failed to fetch')` becoming a network `ApiError`. It also covers the status-0 result, `serverTime`, and a table asserting the RPC name and `p_` params of every `api` method.
- **`src/features/auth/auth.test.tsx`** (24; +4 in this commit), using a mocked session context and a mocked Supabase client:
  - LoginPage: submits and navigates to `/eventos`; shows "E-mail ou senha incorretos" on failure; returns to the page it was redirected from.
  - RequireOrganizer: sends `anon` to `/entrar` (with `from` state) and `must_change_password` to `/trocar-senha`; renders for organizers; spinner while loading; forbidden message plus logout.
  - ChangePasswordPage: validation messages, save, redirect.
  - SessionProvider: restore, sign-in, Supabase error mapping (new: 3 more codes, and the session-missing case during `changePassword`), `42501` leading to forbidden plus sign-out, the `changePassword` call sequence, the offline restore retry, external `SIGNED_OUT`, sign-out.
- **`src/hooks/useClock.test.ts`** (6, new):
  - Restores `ebc.clock` before the first answer; ignores a corrupted value.
  - Samples at 0 / 300 / 600 / 900 / 1200 ms, then 21 200 and 41 200 ms, saving after each sample.
  - One shared instance, with no duplicate sampling.
  - Samples on visibility → visible, single-flight.
  - Keeps the saved offset while offline.
- **`src/hooks/useEventData.test.tsx`** (12, new):
  - Loads under `['event', id]`.
  - Idle polls every 15 s and live every 2 s, with `since` as last server_now − 10 s; marks merged, resolutions and waves replaced.
  - Refetches on a version change, then continues from the refetched server_now.
  - Pauses while hidden and resumes on visible; survives a failed request.
  - Single-flight within a run and across a live/idle switch.
  - An in-flight poll does not clobber `patchAgg`.
  - `refresh()` refetches; no polling after unmount; load error exposed, with no polling.
- **`src/features/events/eventShell.test.tsx`** (29, new):
  - Routes: `/` for visitors, while loading and for organizers (plus Layout logout wiring); `/entrar`; `/trocar-senha`; admin redirect with `from`; forbidden; every admin page inside Layout; public and timekeeper routes; NotFound.
  - EventLayout: index redirects to `geral`; header name, date, location and status; all 6 tab test ids, hrefs and labels; Revisão badge count and tone (warning, danger, none); every tab page; the live flag (15 s on geral/provas, 2 s on cronometragem/revisao/resultados); load error with retry.
  - EventProvider: the value shape (index, timing, classifications, `clock` is the `useClock` singleton, `nowMs`); memoization (the same value on re-render with the same `agg`); the 10 s tick making an unassigned mark appear as an issue; the error outside a provider.
- **`src/test/setup.test.tsx`** (2, new): RTL cleanup between tests (Ruling 7).

The timing-sensitive files passed 5 repeated runs (115/115 each time) and also pass with `TZ=Asia/Tokyo`.

## Test evidence

Run on the clean tree at `3cd4f76`.

```
$ npx vitest run
 RUN  v5.0.1 /home/user/ebc-wt/t17

 Test Files  23 passed (23)
      Tests  268 passed (268)
   Start at  12:42:38
   Duration  22.30s (environment 66%, tests 13%, setup 10%, transform 8%, import 3%)

Environment  jsdom was created 23 times · 38.14s total, 66% of tracked time
             create it once per worker with pool: 'vmThreads' (keeps per-file isolation) or isolate: false (shares it across files)
             learn more: https://vitest.dev/guide/improving-performance#test-environments
```

The output has no stderr, act() warnings or unhandled rejections. The "Environment jsdom was created…" lines are Vitest 5's own performance notice.

```
$ npm run typecheck
> endurance-base-club@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json
(exit 0, no diagnostics)
```

```
$ npm run build
> endurance-base-club@1.0.0 build
> vite build

vite v8.3.1 building client environment for production...
transforming...
✓ 229 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.81 kB │ gzip:   0.44 kB
dist/assets/index-3woTnV0h.css   20.76 kB │ gzip:   5.08 kB
dist/assets/index-oNDAbaha.js   604.66 kB │ gzip: 176.67 kB

[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 955ms
```

## Files changed

**In my commit `3cd4f76`:**

- Modified:
  - `src/hooks/useClock.ts`
  - `src/hooks/useEventData.ts`
  - `src/features/auth/session.tsx`
  - `src/features/auth/auth.test.tsx`
- New test files (tests of this task's own code):
  - `src/hooks/useClock.test.ts`
  - `src/hooks/useEventData.test.tsx`
  - `src/features/events/eventShell.test.tsx`
  - `src/test/setup.test.tsx`
- Deleted: `src/zz-tmp-verify-clock.test.tsx`, `src/zz-tmp-verify-shell.test.tsx`

**In the WIP commit `3311334`:**

- `src/lib/{supabase,api,api.test}.ts`
- `src/hooks/{useClock,useEventData}.ts`
- `src/features/events/{EventContext,EventLayout}.tsx`
- `src/features/auth/{session,LoginPage,ChangePasswordPage,RequireOrganizer,auth.test}.tsx`
- `src/features/NotFound.tsx`
- the 15 stubs
- `src/App.tsx`, `src/main.tsx`, `src/test/setup.ts`

Every file is in the brief's Files block, is `src/test/setup.ts`, or is a new test file for this task's code. Shared files such as `package.json` and `types.ts` were not touched.

## Self-review findings

- **"Produces" list:** checked every export name and signature. The `api` surface matches the contract character for character (the typed `Api` interface is annotated on `api`, so typecheck enforces it). `useSession` statuses, `useEventData` return shape and `EventContextValue` all match.
- **Test ids:**
  - Auth: `login-email`, `login-password`, `login-submit`, `newpass-1`, `newpass-2`, `newpass-submit`, `logout`.
  - Tabs: `tab-geral` … `tab-resultados`, rendered by the Task 16 `Tabs` as `tab-<id>`.
  - `logout` lives in three places that never render together: the Task 16 `Layout` header (the admin area), the forbidden screen of `RequireOrganizer` (rendered instead of Layout), and `ChangePasswordPage` (outside Layout).
- **Global constraints:**
  - UI copy is pt-BR; code and comments are English.
  - Displayed dates go through `formatDateBR`. The shell displays no clock times.
  - The only Supabase access is `supabase.rpc` in `api.ts`, apart from `supabase.auth` for login. There is no `supabase.from`.
  - DTOs stay snake_case.
- **Leaks and races:**
  - The polling effect clears its timer and visibility listener on cleanup, and drops the results of cancelled runs.
  - `agg` and `since` are read from the query cache and refs at call time, so there are no stale closures.
  - `refresh()` uses `refetchQueries`, which never rejects. Poll errors are swallowed and retried on the next tick.
  - TanStack's structural sharing keeps `agg` referentially stable when a poll brings nothing new, so derived data is not recomputed every 2 s.
- **Tests:** no act() warnings or unhandled rejections; everything is scoped with fake timers; output is pristine.

## Concerns (none blocking)

1. **Importing the real `src/lib/supabase.ts` in a test throws `supabaseUrl is required.`** Vitest runs in mode `test`, and there is no `.env.test`, so `VITE_SUPABASE_URL` is undefined. Every later screen test that imports `api` (directly or through `session.tsx`) must mock it, for example:
   - `vi.mock('<rel>/lib/supabase', () => ({ supabase: {} }))`, or
   - mock `lib/api` without `importOriginal`.

   `eventShell.test.tsx` shows the pattern. I kept this fail-fast behavior on purpose: a silent fallback URL would let an unmocked test hit `127.0.0.1:54321`. Adding a `.env.test` is outside my Files block.
2. **The build warns that the single chunk is larger than 500 kB** (605 kB, 177 kB gzip). This comes mostly from supabase-js, React, the router and TanStack Query, not from the stubs. Route-level `React.lazy` or `manualChunks` would be the fix, but `vite.config.ts` belongs to Task 27 (PWA), and splitting stub pages now gains nothing. Worth revisiting once the timekeeper page is real, because it is served to phones at the trackside.
3. **`useClock` is a process-wide singleton with an app-lifetime interval and listener.** This is what the brief asks for. Tests that need a fresh clock should use `vi.resetModules()` plus a dynamic import, as in `useClock.test.ts`.

## Fix round 1

**Status: DONE.** Commit `a647630` fix(app): resilient session restore, request timeouts, fresh timekeepers. It sits on top of `3cd4f76`. Nothing was pushed.

Scope: review Important 1 and Rulings 32, 33, 34 and 36. The other review minors are deferred, as instructed.

The work followed TDD. The new tests were written first and failed: 27 failures across `api.test.ts`, `supabase.test.ts`, `auth.test.tsx` and `useEventData.test.tsx`, including `supabaseUrl is required.`. Then came the implementation.

### Important 1: session restore (`src/features/auth/session.tsx`)

- **Transient `getSession()` errors now retry.** The error from `getSession()` is no longer ignored. On an offline reload with an expired token, supabase-js returns `{session: null, error}`, and the error is transient (`AuthRetryableFetchError`, a `TypeError`, status 0 or ≥ 500). In that case supabase-js keeps the session in storage, so the status stays `loading` and we retry. Any other `getSession` error means supabase-js has already removed the session, so the status becomes `anon`. I checked both paths in auth-js 2.117.1: `_callRefreshToken` removes the session only for non-retryable errors.
- **The session is dropped only when the server refuses it.** That means HTTP 401, `PGRST301` or `PGRST303` (the new `ApiError.status` field carries the HTTP status), or `42501`, which gives `forbidden` as before. Everything else stays `loading` and retries with backoff: offline, 5xx, `PGRST002`, a captive portal, or an unexpected error. The backoff starts at 3 s, doubles, and is capped at 30 s. Retries are single-flight.
- **`dropSession()` now uses `signOut({ scope: 'local' })`.** This covers the 42501 path, the refused-JWT path, and the user's own "Sair". A problem on one device no longer revokes the organizer's other sessions.
- **The auth listener re-runs the restore after a token refresh or a sign-in elsewhere.** On `TOKEN_REFRESHED` or `SIGNED_IN`, while the status is `loading` or `anon`, it runs the restore again. The call is deferred with `setTimeout(0)` because supabase-js calls listeners while holding its auth lock. The provider's own `signIn` is excluded through a `signingIn` ref, so the profile is not loaded twice. `SIGNED_OUT` also cancels a pending retry.
- **Tests:** 9 new ones in `auth.test.tsx`, in a nested describe "restoring a stored session" with fake timers:
  - A retryable `getSession` error stays `loading`, calls no sign-out, and recovers on the 3 s retry.
  - `TOKEN_REFRESHED` recovers the session immediately.
  - A 503 `PGRST002` during `admin_me` does not sign out, retries at 3 s and then 6 s, and ends as `organizer`.
  - `PGRST301`, `PGRST303` and a plain 401 each sign out with `{scope:'local'}` and become `anon`.
  - A refused refresh (`refresh_token_not_found`) becomes `anon` with no retries.
  - A `SIGNED_IN` from another tab loads the organizer.
  - The provider's own sign-in loads the profile once, not twice.
- **Updated tests:** the 42501 test and the "Sair" test now assert `signOut` was called with `{ scope: 'local' }`.
- **Test mock change:** the rpc mock now returns a builder with `.abortSignal()`, because of item 4.

### Ruling 32: `.env.test`

- **The file:** `.env.test` at the repo root contains `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_KEY=sb_publishable_local_dev`. These are the local, non-secret values from `.env.e2e`, under the same variable names as `.env.development`. The file is committed; `.gitignore` does not match it.
- **New `src/lib/supabase.test.ts` (2 tests):** the real `./supabase` imports in Vitest, and the brief's client options are in effect: `storageKey 'ebc.auth'`, `persistSession`, `autoRefreshToken`, and `detectSessionInUrl: false`.
- **Production build unaffected:** I checked that `dist/` contains `wlishmznbhhcqzncdxnq.supabase.co` and no `127.0.0.1:54321`.
- **The earlier concern 1 (importing the real client throws) is resolved.** The shell tests still mock the client so that no real GoTrue client is created.

### Ruling 33: fresh timekeepers (`src/hooks/useEventData.ts`)

- **Unknown timekeeper:** when a live delta brings a mark whose `timekeeper_id` is not null and not in `agg.timekeepers`, the hook calls `refresh()`. It uses the same guard as a version change: skipped while a fetch is already running.
- **30 s full refetch while `live`:** skipped while `document.hidden` or while a fetch is in flight.
  - **Why not TanStack's `refetchInterval`:** I tried it first. Its timer restarts on every cache update (`QueryObserver.onQueryUpdate` → `#updateTimers`), so the 2 s delta poll kept postponing it and it never fired. I confirmed this with a probe, so the hook uses an explicit interval effect instead.
  - **Overlap with a delta poll:** handled by the existing check that detects a refetch landing mid-poll. The test shows the next delta poll continues from the refetched `server_now − 10 s`, and the refetched timekeepers survive the delta polls that follow.
- **Tests:** 3 new ones in `useEventData.test.tsx`:
  - An unknown timekeeper triggers a refetch. Known timekeepers and organizer marks (null `timekeeper_id`) do not.
  - Live tabs refetch every 30 s, with polls continuing on the refetched lists, and not while hidden.
  - Idle tabs never do the 30 s refetch.

### Ruling 34: request timeouts (`src/lib/api.ts`)

- **Timeouts:** every RPC is awaited as `supabase.rpc(...).abortSignal(signal)`. The default timeout is 15 s; `server_time` gets 5 s.
- **Why `AbortController` + `setTimeout` instead of `AbortSignal.timeout(ms)`, as the ruling proposed:**
  1. `AbortSignal.timeout` is missing on Safari < 16, which older timekeeper iPhones may run. There every RPC would throw and be mapped to "no connection".
  2. Its timer cannot be cleared once the answer arrives.
  3. I confirmed with a probe that Vitest fake timers do not drive it under jsdom, so the required timeout test would be impossible.

  The timer is cleared in `finally`.
- **Error mapping:** an aborted request resolves in postgrest-js as `status: 0` and maps to `ApiError('Sem conexão com o servidor','network')`. A rejected `AbortError` or `TimeoutError` maps to the same error.
- **`ApiError` now also carries `status: number | null`.** It is an additive, optional third constructor argument.
- **Tests:** 5 new ones in `api.test.ts`, all with fake timers:
  - A never-answering RPC is still pending at 14 999 ms and fails as a network `ApiError` at 15 000 ms.
  - `server_time` gives up at 5 s.
  - An abort that rejects (rather than resolves) maps to network too.
  - The timer is cleared after a normal answer (`vi.getTimerCount() === 0`) and the RPC received an `AbortSignal`.
  - A 401 keeps its HTTP status on the `ApiError`.

### Ruling 36: shell tests independent of the stub pages (`src/features/events/eventShell.test.tsx`)

- **Markers:** every page module the routes lead to is replaced with a tiny marker `<div data-testid="page-<id>">`, created through a hoisted `vi.mock` helper. That is 15 pages: PublicHome, EventsPage, EventGeneralTab, the 5 other tabs, AthletesPage, AthleteProfilePage, HelpPage, SettingsPage, TimekeeperPage, PublicEventPage, PublicAthletePage. The assertions check the markers instead of stub text.
- **Context check:** the Geral marker renders `useEventContext().agg.event.name`, which proves the tab outlet renders inside the event context.
- **Coverage kept or extended:** the tab tests also check the event header, and the public-route tests check that the organizer Layout is absent.
- **Verified:** I temporarily replaced three stub pages with components that throw, and the shell tests still passed (29/29). Stubs restored.
- **No other test asserted stub text** (checked with grep).

### Test evidence (clean tree at `a647630`)

```
$ npx vitest run
 RUN  v5.0.1 /home/user/ebc-wt/t17

 Test Files  24 passed (24)
      Tests  287 passed (287)
   Start at  13:06:38
   Duration  23.84s (environment 65%, tests 15%, setup 12%, transform 6%, import 3%)

Environment  jsdom was created 24 times · 41.12s total, 65% of tracked time
             create it once per worker with pool: 'vmThreads' (keeps per-file isolation) or isolate: false (shares it across files)
             learn more: https://vitest.dev/guide/improving-performance#test-environments

$ npm run typecheck
> endurance-base-club@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json
(exit 0, no diagnostics)

$ npm run build
> endurance-base-club@1.0.0 build
> vite build
vite v8.3.1 building client environment for production...
✓ 229 modules transformed.
dist/index.html                   0.81 kB │ gzip:   0.44 kB
dist/assets/index-3woTnV0h.css   20.76 kB │ gzip:   5.08 kB
dist/assets/index-Dtdq1Ine.js   605.94 kB │ gzip: 177.08 kB
(!) Some chunks are larger than 500 kB after minification. [Ruling 30: T27]
✓ built in 1.21s
```

- The output is pristine: no stderr and no act() warnings.
- Task-owned tests: 134 in total.

| File | Tests |
|---|---|
| `api.test.ts` | 47 |
| `supabase.test.ts` | 2 |
| `auth.test.tsx` | 33 |
| `useClock.test.ts` | 6 |
| `useEventData.test.tsx` | 15 |
| `eventShell.test.tsx` | 29 |
| `setup.test.tsx` | 2 |

- The task test files passed 3 repeated runs (134/134 each).

### Files changed in `a647630`

- `.env.test` (new; granted by Ruling 32)
- `src/lib/api.ts`, `src/lib/api.test.ts`
- `src/lib/supabase.test.ts` (new)
- `src/features/auth/session.tsx`, `src/features/auth/auth.test.tsx`
- `src/hooks/useEventData.ts`, `src/hooks/useEventData.test.tsx`
- `src/features/events/eventShell.test.tsx`

### Notes and concerns (none blocking)

1. **Contract addition:** `ApiError` gained `status: number | null` as an optional third constructor argument. Existing `new ApiError(msg, code)` callers are unaffected.
2. **Timeout implementation:** it uses `AbortController` + `setTimeout` rather than the literal `AbortSignal.timeout`. The reasons are Safari < 16 support and testability, as explained under Ruling 34.
3. **"Sair" offline with an expired token (not fixed; outside this round's scope):** supabase-js cannot refresh the token, so its `signOut` returns an error without clearing storage. The screen shows `anon`, but the session comes back on the next online reload. This is a supabase-js behavior, confirmed in auth-js `_signOut`. The fix would be to clear the stored `ebc.auth` key when `signOut` returns an error; it could be a follow-up minor.
