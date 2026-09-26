# Task 27: PWA (offline app shell for timekeepers) + route-level code splitting

## Interruption recovery

The prior attempt at this task was interrupted by the account usage limit before any change was
made (worktree was clean at `4af9aab`, the tip after task/25 merged). Per the coordinator's
instruction I restarted from the brief + Rulings 26/30, and first fast-forward merged
`feat/ebc-app` (now at `3d47624`, which also carries the tasks-8/18/19/24/25 fixes and merges —
in particular the real EventsPage/SettingsPage/HelpPage/RacesTab/ResultsTab/ReviewTab screens,
replacing stubs) so the lazy-route split covers the real pages, not stubs. The merge was a clean
fast-forward, no conflicts.

## What I implemented

- **`vite.config.ts`** — added the `VitePWA` plugin with the brief's manifest/workbox config kept
  verbatim (name, short_name, lang, theme_color, background_color, display, start_url, icons;
  `includeAssets`; `globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}']`; `navigateFallback:
  '/index.html'`; `cleanupOutdatedCaches: true`), but per **Ruling 26**: `registerType: 'prompt'`
  (not `autoUpdate`) and no `workbox.skipWaiting`/`clientsClaim`. `injectRegister: null` since
  registration is done by hand in `main.tsx`.
- **`src/vite-env.d.ts`** — added `/// <reference types="vite-plugin-pwa/client" />`.
- **`src/main.tsx`** — `registerSW({ immediate: true, onNeedRefresh })` from `virtual:pwa-register`,
  called only when `import.meta.env.PROD`. `onNeedRefresh` does nothing when `location.hash` starts
  with `#/c/` (the timekeeper link); otherwise it dispatches a `window` `CustomEvent
  ('ebc:sw-need-refresh', { detail: { update } })` where `update` wraps `updateSW(true)`. Mounted
  `<UpdatePrompt />` once at the app root, inside all the providers (sibling of `<App/>`, inside
  `ConfirmProvider`/`ToastProvider`), so it can use `useToast()`.
- **`src/components/UpdatePrompt.tsx`** (new, granted by Ruling 26) — a tiny component: it only
  listens for `ebc:sw-need-refresh` and calls the kit's `useToast().show(...)` with the message
  "Nova versão disponível" and a non-auto-dismissing (`durationMs: 0`) action button "Atualizar"
  (`data-testid="sw-update"`) that calls the event's `update` callback. It knows nothing about
  `virtual:pwa-register` itself — that stays entirely in `main.tsx`, which is untestable in
  isolation without a real service worker, so keeping the wiring there and the UI here made both
  parts testable.
- **`src/components/UpdatePrompt.test.tsx`** (new) — TDD for the above (see below).
- **`src/App.tsx`** (granted by Ruling 30) — every routed page component is now
  `lazy(() => import(...))` instead of a static import, each wrapped by a small `<Lazy>` helper
  (`<Suspense fallback={<PageFallback/>}>`, the kit's `Spinner`) at the point where it is used as a
  route `element`. The route table's paths, nesting and guards (`OrganizerArea`/`RequireOrganizer`,
  `EventLayout`'s children) are unchanged — only how each `element` is constructed changed. I also
  lazy-loaded `EventLayout` itself (it is only reachable from admin routes and is non-trivial:
  `useEventData`, tabs, the review badge). `Layout` (the organizer nav shell) and `RequireOrganizer`
  (the guard) stay eager imports: both are tiny, carry no heavy dependency (no xlsx/qrcode/chart),
  and keeping them eager avoids adding a second Suspense boundary around `OrganizerArea` for no
  bundle-size benefit.
- **`src/features/events/eventShell.test.tsx`** — minimal adjustments only, per Ruling 30's explicit
  license, changing 8 synchronous `screen.getByTestId`/`getByText` assertions on a page that had
  never rendered before in that test file to `await screen.findByTestId`/`findByText` (see the list
  below). No other assertion, mock or test structure changed. `src/features/auth/auth.test.tsx` did
  not need any change: it renders `LoginPage`/`ChangePasswordPage`/`RequireOrganizer` directly in
  its own `<Routes>`, not through `App`'s route table, so it never sees the lazy wrapper.
- **`vercel.json`** — added a third header rule, `/manifest.webmanifest` → `Cache-Control:
  no-cache`, alongside the existing `/sw.js` and `/index.html` rules. Judgment call (the brief left
  it optional): the manifest is itself precached by the service worker (workbox re-validates it via
  its own revisioned copy, independent of HTTP caching), so this isn't load-bearing for the
  offline/update-safety mechanics Ruling 26 cares about, but it is a stable filename fetched
  directly by the browser on first load / "add to home screen", so a cheap, safe no-cache header
  avoids a CDN-cached stale manifest after a deploy. Nothing else in the file changed; confirmed the
  generated SW filename is `sw.js` (default), matching the existing rule.

## Test-by-test: what needed `await` and why

`eventShell.test.tsx` mocks every page module with a `data-testid="page-<id>"` marker (Ruling 36),
so any assertion that queries for that marker synchronously right after `renderApp(...)`, for a
route whose page hadn't already been rendered earlier in the same test file, now needs to await the
first paint past the page's `Suspense` boundary. React caches a resolved `lazy()` import after its
first successful render, so `/eventos` (already warmed up earlier by the "sends organizers to
/eventos" test, which was already `await screen.findByTestId`) did not need a change, while
`/atletas`, `/ajuda`, `/config`, etc. (first use in the file) did.

Changed, all trivially (sync → `async`, `getBy…` → `await findBy…`, nothing else touched):
- `/ shows the public home to visitors`
- `/entrar renders the login page`
- `/trocar-senha renders the change-password page`
- `%s renders the %s page for organizers, inside the layout` (it.each) — only the page assertion;
  the following `getByRole('navigation', …)` assertion stayed synchronous (Layout is eager, so the
  nav is already there once the page's Suspense settles)
- `%s renders the %s page without a session` (it.each)
- `unknown paths render NotFound`

Not changed, and verified they didn't need to be: the `polls every 2 s only on the timing, review
and results tabs` test (uses `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)`) still passes
its very first, synchronous `screen.getByTestId('page-event-general')` right after a 5 ms
`advanceTimersByTimeAsync` — that helper flushes pending microtasks (a dynamic import's promise
resolution) between timer steps, same as it already did for the mocked `getEvent()` promise before
this change. Ran the whole file in isolation to confirm before touching anything else.

## TDD evidence

**RED** (`UpdatePrompt.tsx` did not exist yet):
```
$ npx vitest run src/components/UpdatePrompt.test.tsx
 FAIL  src/components/UpdatePrompt.test.tsx [ src/components/UpdatePrompt.test.tsx ]
Error: Failed to resolve import "./UpdatePrompt" from "src/components/UpdatePrompt.test.tsx".
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** (after adding `src/components/UpdatePrompt.tsx`):
```
$ npx vitest run src/components/UpdatePrompt.test.tsx
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**RED** for the App.tsx lazy split (before touching `eventShell.test.tsx`):
```
$ npx vitest run src/features/events/eventShell.test.tsx
 Test Files  1 failed (1)
      Tests  11 failed | 18 passed (29)
```
(11 failures, all `Unable to find an element by [data-testid="page-…"]`/text, on the first render of
a page that had not been rendered earlier in the file — the exact list above.)

**GREEN** after the minimal `await findBy…` adjustments:
```
$ npx vitest run src/features/events/eventShell.test.tsx
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

## Gate outputs

**Full suite** (`npx vitest run`):
```
 Test Files  33 passed (33)
      Tests  399 passed (399)
```
(baseline right after the `feat/ebc-app` merge, before any of my changes: 32 files / 396 tests, all
green — so this task adds the 3 new `UpdatePrompt` tests and touches nothing else's count.)

**Typecheck** (`npm run typecheck` = `tsc --noEmit -p tsconfig.json`): clean, no output.

**Build** (`npm run build` = `vite build`):
```
dist/manifest.webmanifest                          0.31 kB
dist/index.html                                    1.02 kB │ gzip:   0.51 kB
dist/assets/index-Dsv1moZu.css                    25.32 kB │ gzip:   5.90 kB
dist/assets/TimingTab-CVAk6Z7o.js                  0.16 kB │ gzip:   0.16 kB
dist/assets/EntriesTab-BkcXp7jZ.js                 0.16 kB │ gzip:   0.16 kB
dist/assets/PublicHome-B-3kvrdt.js                 0.16 kB │ gzip:   0.16 kB
dist/assets/AthletesPage-DuDUz_SD.js               0.16 kB │ gzip:   0.16 kB
dist/assets/TimekeeperPage-jZ9nBaq8.js             0.16 kB │ gzip:   0.16 kB
dist/assets/PublicEventPage-Du4WZbFL.js            0.16 kB │ gzip:   0.16 kB
dist/assets/PublicAthletePage-TYza4GlC.js          0.17 kB │ gzip:   0.17 kB
dist/assets/AthleteProfilePage-DjbD5JtE.js         0.17 kB │ gzip:   0.17 kB
dist/assets/eventHelpers-CcleTkN0.js               0.32 kB │ gzip:   0.22 kB
dist/assets/NotFound-BKFOzHD_.js                   0.84 kB │ gzip:   0.47 kB
dist/assets/jsx-runtime-BkSabwWG.js                0.96 kB │ gzip:   0.55 kB
dist/assets/labels-BXIEHKQW.js                     0.96 kB │ gzip:   0.55 kB
dist/assets/format-CJHyzmEU.js                     1.62 kB │ gzip:   0.88 kB
dist/assets/LoginPage-C_1_mjij.js                  2.00 kB │ gzip:   0.99 kB
dist/assets/ChangePasswordPage-BOoNy5kF.js         2.28 kB │ gzip:   1.11 kB
dist/assets/EventLayout-B49KOz-c.js                4.68 kB │ gzip:   2.03 kB
dist/assets/EventGeneralTab-B_bEG7lC.js            4.69 kB │ gzip:   1.83 kB
dist/assets/HelpPage-fCJUwpIE.js                   5.55 kB │ gzip:   1.73 kB
dist/assets/workbox-window.prod.es5-Bd17z0YL.js    5.65 kB │ gzip:   2.20 kB
dist/assets/EventsPage-B3_pdAEj.js                 5.88 kB │ gzip:   2.07 kB
dist/assets/SettingsPage-DNWf5DSX.js               6.97 kB │ gzip:   2.37 kB
dist/assets/useQuery-CvTLpjhC.js                   7.98 kB │ gzip:   2.95 kB
dist/assets/EventContext-DxSQA11q.js              13.63 kB │ gzip:   5.36 kB
dist/assets/ReviewTab-DybOYPxA.js                 16.18 kB │ gzip:   5.19 kB
dist/assets/RacesTab-BUb4z9dc.js                  22.95 kB │ gzip:   6.33 kB
dist/assets/ResultsTab-ChNzeBt4.js                31.68 kB │ gzip:  12.17 kB
dist/assets/lib-oR2QZEIc.js                      100.52 kB │ gzip:  33.13 kB
dist/assets/index-BWVGcLrx.js                    480.25 kB │ gzip: 136.80 kB

✓ built in 650ms

PWA v1.3.0
mode      generateSW
precache  38 entries (735.66 KiB)
files generated
  dist/sw.js
  dist/workbox-2fbc6a65.js
```
`dist/sw.js` and `dist/manifest.webmanifest` exist. **The >500 kB chunk-size warning present before
this task (baseline single chunk was 702.57 kB) is gone**: the largest chunk is now the 480.25 kB
entry (react/react-dom/react-router/@tanstack/query core/supabase-js/session/EventContext-adjacent
code that every route needs), under the default 500 kB threshold. No `(!) Some chunks are larger
than 500 kB` warning in the output.

## Chunk graph for `#/c/:token`

Built once more with `vite build --manifest --outDir /tmp/ebc-manifest-check` (a throwaway output
directory via the CLI flag, so no `vite.config.ts` change was needed just for this and no files
were left behind — deleted the temp directory afterwards) and read `.vite/manifest.json`:

- The entry (`index.html`) chunk's own `imports` are only `_jsx-runtime-*.js` and `_lib-oR2QZEIc.js`
  (react/react-dom/react-router/@tanstack-query/supabase-js and friends); its `dynamicImports` list
  every page module (`LoginPage.tsx`, `EventsPage.tsx`, …, `TimekeeperPage.tsx`, …) — i.e. every
  page is a genuine code-split point, none is bundled into the entry.
- `src/features/timekeeper/TimekeeperPage.tsx`'s manifest entry: `imports: ["_jsx-runtime-*.js"]`
  only — nothing else. So `#/c/:token`'s full download is: the entry chunk + `_lib` + `_jsx-runtime`
  (needed by every route) + the `TimekeeperPage` chunk itself (currently 0.16 kB — it is still the
  1-line stub from an earlier task; the point holds regardless of its eventual size, because it
  simply cannot pull in a page it never imports).
- Confirmed the isolation empirically too: `grep -l "qrcode\|xlsx\|fflate" dist/assets/*.js` matches
  only `ResultsTab-*.js` (the XLSX writer, `src/lib/xlsx`, is reachable only through `ResultsTab`'s
  own chunk) and nothing in `_lib-*.js` or the entry chunk. `QrCode.tsx`/`LineChart.tsx` (qrcode,
  the chart) aren't imported by any page yet in this WIP tree (`TimingTab`/`AthleteProfilePage` are
  still the 1-line stubs other tasks own) — nothing in the current build references `qrcode` at all
  — but the mechanism that keeps `ResultsTab`'s xlsx code out of the shared chunks is exactly the
  one that will keep `qrcode`/the chart out of it once those tabs are implemented: each page is its
  own dynamic `import()`, so whatever it imports lands in its own chunk, never in `_lib` or the
  entry. This is a structural guarantee from the code-splitting itself, not something that needs
  those pages to exist first to verify.
- The Workbox `globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}']` precache list in
  `dist/sw.js` includes every one of those per-page chunk files (confirmed by reading the generated
  `precacheAndRoute([...])` call), so a device that has opened every tab it uses at least once has
  them all cached for offline use — the split does not cost offline coverage, only first-visit
  bytes per route.

## Service worker behavior (Ruling 26) — confirmed in the built `dist/sw.js`

- `self.addEventListener("message", s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()})`
  is present (workbox always emits this listener in `generateSW` mode) — but it is **only** invoked
  in response to a message, never automatically on install/activate: no unconditional
  `self.skipWaiting()` call and no `clientsClaim()` call anywhere in the file. That is exactly the
  "waits until all tabs close, applies on next launch" behavior Ruling 26 asks for, with the
  `updateSW(true)` triggered by the `UpdatePrompt`'s "Atualizar" button as the one way to short-cut
  it (by posting `SKIP_WAITING` deliberately, outside the timekeeper route).
- `cleanupOutdatedCaches()` is called; navigation is routed to `/index.html` via
  `createHandlerBoundToURL`.

## Preview check

```
$ npx vite preview --port 4273 --strictPort &
$ curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:4273/                       # 200
$ curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:4273/sw.js                  # 200
$ curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:4273/manifest.webmanifest   # 200
```
Manifest body confirmed matches the brief verbatim (name, short_name, lang pt-BR, both colors
`#191513`, standalone, start_url `/`, both icons). Server stopped afterwards
(confirmed by a failed curl to the same port).

## Files changed

- `vite.config.ts` — VitePWA plugin (Ruling 26 config)
- `src/vite-env.d.ts` — PWA client types reference
- `src/main.tsx` — conditional `registerSW`, timekeeper-route guard, mounts `UpdatePrompt`
- `src/components/UpdatePrompt.tsx` (new) — the update toast
- `src/components/UpdatePrompt.test.tsx` (new) — its tests
- `src/App.tsx` — every route's page component is now lazy + Suspense (Ruling 30); route table,
  paths, guards unchanged
- `src/features/events/eventShell.test.tsx` — 6 spots converted to `await screen.findBy…` (listed
  above); nothing else touched
- `vercel.json` — added the `/manifest.webmanifest` no-cache header

## Self-review

- Double-checked `src/features/auth/auth.test.tsx` needs no change: it renders `LoginPage`,
  `ChangePasswordPage`, `RequireOrganizer` directly through its own `<Routes>`, never through
  `App`'s `routes` export, so App's lazy-loading is invisible to it. Ran it standalone to confirm
  (part of the full 399-test green run).
- Confirmed `EventLayout`, once lazy, does not break the deeply-tested `EventLayout`/`EventProvider`
  describe blocks in `eventShell.test.tsx` (polling, review badge coloring, tab wiring) — all pass
  unmodified.
- Confirmed `Layout`/`RequireOrganizer` stay eager and are not in the Files list, so I did not touch
  either file — only how `App.tsx` imports and composes them changed.
- Verified `dist/` stays gitignored (`git status --ignored` shows `!! dist/`), so the build artifacts
  from all the verification runs are not part of the commit.
- The temp manifest build went to `/tmp/ebc-manifest-check` via the `--outDir` CLI flag, not into
  the project's `dist/`, and was deleted afterwards; no config changes were made or left behind just
  to produce it.

## Concerns

- None blocking. `TimekeeperPage`, `TimingTab`, `EntriesTab`, `AthletesPage`, `AthleteProfilePage`,
  `PublicHome`, `PublicEventPage`, `PublicAthletePage` are still 1-line stubs owned by other, not-yet
  -landed tasks (T20/T21/T22/T23/T26); once they land with real imports (qrcode, the LineChart,
  admin forms), the code-splitting mechanism already in place will keep each in its own chunk
  without further changes here — I verified this is structural (via `ResultsTab`'s xlsx isolation
  today), not something that needs re-checking once those tasks land, but a build after they merge
  is still the fastest way to see it directly.
- The duplicated `manifest.webmanifest` entry in the generated `precacheAndRoute([...])` list (it
  appears twice, once from `includeAssets`-driven processing and once from the `globPatterns` glob)
  is vite-plugin-pwa's own behavior with the brief's verbatim config, not something introduced here;
  it is harmless (same URL/revision both times) and not worth deviating from the given config to
  avoid.

## Fix round 1

New implementer (this session cannot resume the original cloud session). Base: `task/27` merged
with current `feat/ebc-app`, HEAD `5c97fe2` (typecheck clean, `npx vitest run` 35 files / 446 green,
build ok, confirmed before touching anything). Addressed **Important 1** and **Important 3** from
`task-27-review.md`; Important 2 needed no change (Ruling 52); the Minor items are deferred and were
left untouched (in particular I did **not** rename the `UpdatePrompt.test.tsx` "ignores the event…"
test title, even though I drafted that rename at one point — reverted it once I re-read the review's
scope).

### Important 1 — order-dependent test in `eventShell.test.tsx`

**Finding**: `EventLayout > polls every 2 s only on the timing, review and results tabs`
(`src/features/events/eventShell.test.tsx:240`, line 245 in the pre-fix file) did a synchronous
`screen.getByTestId('page-event-general')` right after a 5 ms fake-timer advance. It only passed in
the full-file run because earlier tests in the file had already warmed React's module-level
`lazy()` cache for `EventLayout`/`EventGeneralTab`; run alone it failed exactly as the review said.

**Isolation sweep methodology**: Git Bash on Windows (MSYS) rewrites a `-t` argument starting with
`/` into a Windows path before it reaches Node, silently turning `-t "/ shows the public home..."`
into a pattern that matches nothing (all 29 tests print `↓` skipped, `0` ran) — this must be run with
`MSYS_NO_PATHCONV=1` or the argument passed some other way, otherwise "isolation" runs silently
check nothing. I hit this on the very first sweep and want it on record so the next round doesn't
lose an afternoon to the same silent-no-match failure. Similarly, `-t` is a regex: a title containing
literal parentheses (the `it.each` `(%s page)` titles) needs the parens escaped or a substring
without them — I used the latter (e.g. `"renders the provas tab"`).

**RED — every one of the file's 29 tests run alone** (`MSYS_NO_PATHCONV=1 npx vitest run
src/features/events/eventShell.test.tsx -t "<title>"`, looped over all 29 titles before touching the
file): 28/29 passed alone; only the polling test failed:
```
 × src/features/events/eventShell.test.tsx > EventLayout > polls every 2 s only on the timing, review and results tabs 46ms
   → Unable to find an element by: [data-testid="page-event-general"]
   ...
 ❯ src/features/events/eventShell.test.tsx:245:19
    243|     const router = renderApp('/eventos/ev1/geral', organizer());
    244|     await act(() => vi.advanceTimersByTimeAsync(5));
    245|     expect(screen.getByTestId('page-event-general')).toBeInTheDocument…
 Test Files  1 failed (1)
      Tests  1 failed | 28 skipped (29)
```
(Full sweep output — all 29 individual runs — kept as evidence during the session; not committed,
per the "no scratch files in the repo" rule.)

**Root cause, established by elimination** (documented in code comments at
`src/features/events/eventShell.test.tsx:244-254`): `/eventos/ev1/geral` renders through two nested
`lazy()` boundaries — `EventLayout` and, inside it, `EventGeneralTab`. In an isolated `-t` run this
is the very first time either resolves. I first tried the same fix as the file's other tests
(`await screen.findByTestId(...)`, i.e. `@testing-library/dom`'s real-clock `waitFor`) — it timed
out, because that `waitFor` polls using whatever `setInterval` is on `globalThis` **at the time it
starts**, which is already the fake one once `vi.useFakeTimers()` has run, and nothing re-advances it
from inside. Vitest's own `vi.waitFor` (which nudges the fake clock on every real-clock tick) also
timed out — advancing the fake clock alone does not make Vitest's module loader actually finish
loading `EventLayout.tsx`/`EventGeneralTab.tsx` for the first time, which is genuine async I/O on the
real clock. `vi.dynamicImportSettled()` (documented for exactly this) does wait for that on the real
clock, but confirmed via `document.body.innerHTML` in an ad-hoc debug pass that even after it
resolved, the DOM still showed the outer `<Lazy>` fallback: the underlying `import()` had resolved,
but nothing had told React to re-render and pick it up (this environment's Suspense retry does not
reliably re-fire on its own once timers are involved). Forcing a fresh render pass with
`router.navigate` to the same path — which re-evaluates `lazy()`, and since its promise is now
settled, resolves synchronously instead of suspending — is what actually unblocked it. I also
verified (and reverted) an alternative of doing the initial render + first assertion entirely under
real timers and only switching to fake timers afterwards: that breaks the test for a different
reason — `useEventData`'s polling effect arms its own `setTimeout` on mount, so if the initial mount
happens under real timers, that first interval is a **real** `setTimeout` that `vi.advanceTimersByTimeAsync`
never touches, and `expect(live).toHaveBeenCalledTimes(1)` after the 15 s advance fails with 0 calls.
So timers must stay fake for the whole test; only the `import()` resolution needs the real-clock
`vi.dynamicImportSettled()` + a `router.navigate` poke (done twice, once per nested boundary).

**Fix** (`src/features/events/eventShell.test.tsx:244-259`):
```ts
await vi.dynamicImportSettled();
await act(async () => router.navigate('/eventos/ev1/geral'));
await vi.dynamicImportSettled();
await act(async () => router.navigate('/eventos/ev1/geral'));
await act(() => vi.advanceTimersByTimeAsync(5));
expect(screen.getByTestId('page-event-general')).toBeInTheDocument();
```
(kept `vi.useFakeTimers()` at the top of the test and everything after this block exactly as it was).

**GREEN — isolated**:
```
$ MSYS_NO_PATHCONV=1 npx vitest run src/features/events/eventShell.test.tsx -t "polls every 2 s" --reporter=verbose
 ✓ src/features/events/eventShell.test.tsx > EventLayout > polls every 2 s only on the timing, review and results tabs 103ms
 Test Files  1 passed (1)
      Tests  1 passed | 28 skipped (29)
```
No act()/console warnings in the output.

**GREEN — full file**:
```
$ npx vitest run src/features/events/eventShell.test.tsx --reporter=verbose
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

**Proof every test in the file passes alone** (post-fix isolation sweep, same methodology as the RED
sweep, all 29 titles, each its own `vitest` invocation):
```
[1]  / shows the public home to visitors                                                    1 passed
[2]  / waits for the session before choosing                                                1 passed
[3]  / sends organizers to /eventos inside the organizer layout                              1 passed
[4]  /entrar renders the login page                                                          1 passed
[5]  /trocar-senha renders the change-password page                                          1 passed
[6]  admin routes send visitors to /entrar, remembering where they were going                1 passed
[7]  admin routes explain when the account is not an organizer                                1 passed
[8]  /eventos renders the events page for organizers, inside the layout                       1 passed
[9]  /atletas renders the athletes page for organizers, inside the layout                     1 passed
[10] /atletas/a1 renders the athlete-profile page for organizers, inside the layout           1 passed
[11] /ajuda renders the help page for organizers, inside the layout                           1 passed
[12] /config renders the settings page for organizers, inside the layout                      1 passed
[13] /c/tok123 renders the timekeeper page without a session                                  1 passed
[14] /p/copa-ebc renders the public-event page without a session                              1 passed
[15] /atleta/a1 renders the public-athlete page without a session                             1 passed
[16] unknown paths render NotFound                                                            1 passed
[17] opens the Geral tab and shows the event header, the tabs and the review badge            1 passed
[18] colors the review badge as an error when a crossing is missing                           1 passed
[19] shows no review badge when nothing is pending                                            1 passed
[20-24] renders the {provas,inscricoes,cronometragem,revisao,resultados} tab (…) under the
        event header — matched individually as substrings without the parens (see the `-t`-is-a-
        -regex note above); each                                                              1 passed
[25] polls every 2 s only on the timing, review and results tabs                              1 passed  <- was RED
[26] shows the load error and retries                                                         1 passed
[27] derives the index, timing and classifications from the aggregate                         1 passed
[28] recomputes only when the aggregate changes or every 10 s                                 1 passed
[29] refuses to be used outside an event                                                      1 passed
```
All 29/29 pass alone; only #25 needed a change (already passing tests #1-24, #26-29 were left
untouched, confirming the round-1 review's finding was scoped correctly and no other test in the
file has the same order dependency).

### Important 3 — untested `#/c/` guard

**Finding**: `src/main.tsx:16` (pre-fix) inlined `if (location.hash.startsWith('#/c/')) return;` —
the one line implementing Ruling 26's "never interrupt the timekeeper" — with no test.

**RED** (predicate did not exist yet):
```
$ npx vitest run src/components/UpdatePrompt.test.tsx
 FAIL  src/components/UpdatePrompt.test.tsx > shouldPromptForUpdate > is false on the timekeeper route
TypeError: shouldPromptForUpdate is not a function
 FAIL  src/components/UpdatePrompt.test.tsx > shouldPromptForUpdate > is true everywhere else
TypeError: shouldPromptForUpdate is not a function
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

**Fix**: moved the decision into an exported pure predicate in the file the review suggested
(`src/components/UpdatePrompt.tsx:6-13`, next to the component that already owns Ruling 26's UI
half), rather than a new sibling module — one function, no new file needed:
```ts
export function shouldPromptForUpdate(hash: string): boolean {
  return !hash.startsWith('#/c/');
}
```
`src/main.tsx:8,21` now imports it and calls `if (!shouldPromptForUpdate(location.hash)) return;` —
behaviour is byte-for-byte identical (same substring check, same early return), only where the
decision lives changed. Tests added at `src/components/UpdatePrompt.test.tsx:50-61`:
`shouldPromptForUpdate('#/c/abc')` → `false`; `'#/eventos'`, `'#/'`, `''` → `true` (the exact cases
the review asked for).

**GREEN**:
```
$ npx vitest run src/components/UpdatePrompt.test.tsx --reporter=verbose
 ✓ UpdatePrompt > renders nothing until a new version is announced 21ms
 ✓ UpdatePrompt > shows the update toast and calls back into the service worker on click 110ms
 ✓ UpdatePrompt > ignores the event when rendered without a ToastProvider (nothing to crash) 4ms
 ✓ shouldPromptForUpdate > is false on the timekeeper route 0ms
 ✓ shouldPromptForUpdate > is true everywhere else 0ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Full gates (after both fixes)

```
$ npx vitest run
 Test Files  35 passed (35)
      Tests  448 passed (448)
```
(35 files / 446 tests baseline + 2 new `shouldPromptForUpdate` tests = 448; no other count changed.)

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
```
(clean, no output)

```
$ npm run build
✓ 292 modules transformed.
...
dist/manifest.webmanifest   0.31 kB
dist/assets/index-AG2IusQ7.js   480.50 kB │ gzip: 136.92 kB
✓ built in 579ms
PWA v1.3.0
mode      generateSW
precache  43 entries (814.01 KiB)
files generated
  dist/sw.js
  dist/workbox-2fbc6a65.js
```
`dist/sw.js` and `dist/manifest.webmanifest` present; no `(!) Some chunks are larger than 500 kB`
warning; largest chunk still the 480.5 kB shared entry.

### Files changed

- `src/features/events/eventShell.test.tsx` — `EventLayout > polls every 2 s…` test only
  (lines 244-259): settle-then-poke the two nested `lazy()` boundaries under fake timers before the
  first assertion; nothing else in the file touched (confirmed via the isolation sweep above and via
  `git diff`, which shows exactly this one hunk).
- `src/components/UpdatePrompt.tsx` — added the exported `shouldPromptForUpdate` predicate
  (lines 6-13); no other change.
- `src/components/UpdatePrompt.test.tsx` — added the `describe('shouldPromptForUpdate', …)` block
  (lines 50-61) and the new import; did **not** touch the existing "ignores the event…" test title
  (that rename is a deferred Minor, out of scope this round — I drafted it once by mistake and
  reverted before running any gate).
- `src/main.tsx` — `onNeedRefresh` now calls `shouldPromptForUpdate(location.hash)` instead of
  inlining the `#/c/` check (lines 8, 21); behaviour unchanged.

### Concerns

- None blocking. The `vi.dynamicImportSettled()` + `router.navigate` poke pattern in the polling
  test is a bit more machinery than a typical `await findByTestId`, but it is scoped to the one test
  that actually needs it (mixing fake timers with a first-time lazy-route resolution), is fully
  commented in place, and does not change what the test asserts — only how it gets from "just
  rendered" to "settled" before asserting. If a future task adds another fake-timer test against a
  route that has never been rendered earlier in the same file, the same pattern (or simply
  `await screen.findByTestId(...)` under real timers *before* switching to fake timers, provided that
  route's data hook does not arm a timer on mount) will be needed again.
- Confirmed the `-t` pitfalls above (MSYS path-mangling of leading `/`, and literal parens in
  `it.each` titles needing escaping/avoidance) are environmental to Git Bash on Windows, not bugs in
  the test file; recording them here so later fix rounds on this task don't rediscover them the hard
  way.
