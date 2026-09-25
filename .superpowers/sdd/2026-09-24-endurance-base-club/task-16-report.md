# Task 16 report: UI kit, layout, theme and test utilities

Branch `task/16` in worktree `/home/claude/ebc-wt/t16`, commit `a4456b6`.

## What I implemented

All 20 files from the brief's Files block, exactly as listed, nothing else touched:

**`src/components/ui/`**
- `Button.tsx` — `variant` (`primary|secondary|ghost|danger`), `size` (`sm|md|lg|xl`, all `min-h-11` = 44px), `loading` (renders `Spinner`, forces `disabled` + `aria-busy`), plus full native `button` props passthrough (`data-testid` included via the rest spread).
- `Spinner.tsx` — small `role="status" aria-label="Carregando"` SVG spinner, reused by `Button`.
- `Field.tsx` — `Input`, `Select` (`options: {value,label}[]`), `Textarea`, `Checkbox`, all with `label`/`hint?`/`error?`, shared `aria-invalid`/`aria-describedby` wiring and a `role="alert"` error paragraph.
- `Modal.tsx` — `{open, onClose, title, children, footer?, size}`, `role="dialog" aria-modal aria-labelledby`, portaled to `document.body`, Esc (document-level `keydown` listener while open) and backdrop click (separate sibling div, `data-testid="modal-backdrop"`) both call `onClose`.
- `Confirm.tsx` — `ConfirmProvider` + `useConfirm()` returning `(opts) => Promise<boolean>`; renders one `Modal` with `confirm-ok`/`confirm-cancel` footer buttons; Esc/backdrop also resolve `false`.
- `Tabs.tsx` — `NavLink`-based, `data-testid="tab-<id>"`, `badge` rendered inline, active tab styled via `NavLink`'s `isActive`.
- `Badge.tsx`, `Card.tsx`, `EmptyState.tsx` — thin, token-based wrappers per the brief's signatures.
- `Table.tsx` — horizontal-scroll wrapper (`overflow-x-auto`); walks its direct children and clones a `<thead>` child with `sticky top-0 z-10 bg-surface` so callers don't have to think about it.
- `Toast.tsx` — `ToastProvider` + `useToast()` (`show`/`dismiss`), 5000ms default duration, `tone`-colored cards, action buttons (dismiss the toast after firing), `role="alert"` for `danger` tone else `role="status"`.
- `index.ts` — barrel re-exporting all of the above.

**`src/components/`**
- `Layout.tsx` — header with `Logo` + `ENDURANCE BASE CLUB` (`.brand-title`), nav to `/eventos` `/atletas` `/ajuda` `/config`, `ThemeToggle`, `data-testid="logout"` button calling `onLogout`, `<Outlet/>`; nav wraps to its own `overflow-x-auto` row below `sm:` breakpoint, inline above it.
- `Logo.tsx` — `/logo.png` img wrapper.
- `ThemeToggle.tsx` — reads `document.documentElement.dataset.theme` on mount, flips it and writes `ebc.theme` via `safeLocalStorage()` on click.
- `QrCode.tsx` — `{value, size?, testid?}` → resolves `QRCode.toDataURL(value, {margin:1, width:size})` and renders `<img>` (renders nothing while the promise is pending, to keep the contract "produces an `<img>`" literal rather than a placeholder element of a different tag).
- `LineChart.tsx` — see below.

**Other**
- `src/hooks/useNow.ts` — `useNow(intervalMs=1000)`, `setInterval` + cleanup.
- `src/test/renderWithProviders.tsx` — `QueryClientProvider` (`retry:false` for queries and mutations) → `ToastProvider` → `ConfirmProvider` → a one-route `createMemoryRouter([{path, element}], {initialEntries:[route]})`; returns `{...renderResult, router}`.
- `src/components/ui/ui.test.tsx` — the one test file the brief lists; see TDD evidence below.

### `LineChart` (dataviz skill applied)

Loaded the `dataviz` skill before writing it. This is a single-series "trend over time" chart (line, per `choosing-a-form.md`'s job table), so per the skill: no legend box is needed (title names the one series), color is monochrome (`--fg` for the line/markers/end-label, `--muted` for axis text, `--border` for gridlines — the brand has no categorical palette, so I didn't run the categorical validator; there's nothing to validate). Mark specs followed: 2px round-cap/join line, `vector-effect="non-scaling-stroke"` everywhere so strokes stay crisp under the responsive scale, ≥8px markers (`r=5`, `r=6.5` on hover/focus) with a 2px `--surface` ring, direct label only at the endpoint (skill: "label the endpoint... never a number on every point"), x-axis labels thinned to ≤5 evenly-spaced indices (always including first/last) to avoid collisions. Interaction: crosshair + tooltip on `pointermove`/`pointerdown` (value leads, label/tooltip secondary, per `interaction.md`), and the same tooltip is reachable by keyboard (`tabIndex=0`, Left/Right arrows move a focus index) so hover isn't the only way to reach a value. `role="img"` + a computed `aria-label` summary (first → last point) gives a baseline for screen readers; a sibling `sr-only` `<table>` (outside the `role="img"` subtree, so it isn't suppressed by it) exposes every point's label/value/tooltip without needing pointer or keyboard interaction — the "a table view exists" accessibility rule. A zero-points chart renders the kit's own `EmptyState` instead of an empty plot. The literal "menor é melhor" note (brief's wording) sits next to the title.

One accepted trade-off, noted rather than hidden: the SVG uses a fixed internal `viewBox` (640×height) stretched to the container's actual width via `preserveAspectRatio="none"` — the standard technique for "fixed height, fluid width" without a `ResizeObserver` (which isn't polyfilled in jsdom, so depending on it would make the component untestable without extra plumbing). At aspect ratios far from the viewBox's, the circular markers stretch very slightly into ellipses; the mark specs (stroke width, ring) are protected from this via `vector-effect="non-scaling-stroke"` but circle radii are not. Acceptable for a small stats-page chart; would need a measured-width version to eliminate entirely.

## TDD evidence

**RED** — `npx vitest run src/components/ui/ui.test.tsx` before any implementation file existed:
```
FAIL  src/components/ui/ui.test.tsx [ src/components/ui/ui.test.tsx ]
Error: Failed to resolve import "./Button" from "src/components/ui/ui.test.tsx". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — after implementing every component, `npx vitest run src/components/ui/ui.test.tsx`:
```
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

The test file covers exactly the brief's Step 1 list (Button renders children/calls onClick, shows a spinner and is disabled when loading; `useConfirm` resolves true on `confirm-ok` / false on `confirm-cancel`; `Modal` calls `onClose` on Escape; `ThemeToggle` flips `data-theme` and writes `ebc.theme`; `useToast().show` renders the message and fires an action's handler), plus smoke tests for the rest of the kit (Field's label/hint/error switch, Select options, Checkbox onChange, Modal backdrop-click + closed-render, Tabs `data-testid`/active state via `renderWithProviders`, Badge, Table's sticky `thead`, EmptyState, Layout's brand/nav/logout via `renderWithProviders`, QrCode's resolved `<img>`, LineChart's accessible summary + empty state, `useNow`'s tick under fake timers) — 20 tests total in that one file.

**Note on test isolation**: `vite.config.ts` (owned by Task 1, out of scope here) doesn't set `test.globals: true`, so `@testing-library/react`'s auto-cleanup (which checks for a *global* `afterEach`) silently never registers. I added an explicit `afterEach(() => { cleanup(); vi.useRealTimers(); })` at the top of `ui.test.tsx` instead of touching the shared config — every `it()` renders into a clean DOM.

## Tested and results

- `npx vitest run src/components` → 1 test file, 20 tests, all pass.
- `npx vitest run` (full repo) → 3 test files, 31 tests, all pass (the two Task 1 files unaffected).
- `npm run typecheck` → clean, no errors.
- `npm run build` → succeeds (`vite build`, 16 modules, ~220 kB JS / 18 kB CSS). Verified with `grep` on the built CSS that classes unique to the new files (e.g. `cursor-crosshair`, `outline-accent`) are present in `dist/assets/*.css` — Tailwind v4's Vite plugin scans the whole source tree, not just what `App.tsx` currently imports, so nothing will be missing once Task 17 wires these into the router.
- Also independently verified `qrcode`'s `toDataURL` resolves correctly under Vitest+jsdom (no `canvas` package needed — it resolves to the Node/PNG renderer, not the browser canvas path) with a throwaway probe test before writing `QrCode.tsx`, then deleted the probe.

## Files changed

New files only (`git status` after commit is clean, nothing outside `src/components/`, `src/hooks/`, `src/test/renderWithProviders.tsx` was touched):
`src/components/ui/{Button,Field,Modal,Confirm,Tabs,Badge,Card,Table,Toast,Spinner,EmptyState,index,ui.test}.{tsx,ts}`, `src/components/{Layout,Logo,ThemeToggle,QrCode,LineChart}.tsx`, `src/hooks/useNow.ts`, `src/test/renderWithProviders.tsx`.

Commit: `a4456b6 feat(ui): design system components, layout and test utilities` (20 files, 1436 insertions).

## Self-review findings

- **Interfaces match the brief verbatim**: checked every prop signature in "Interfaces: Produces" against the code (`Button`, `Input/Select/Textarea/Checkbox`, `Modal`, `useConfirm`, `Tabs`, `Badge`, `Table`, `useToast`, `Layout`, `ThemeToggle`, `QrCode`, `LineChart`, `useNow`, `renderWithProviders`) — all present with the exact field names/types given (e.g. `LineChart`'s `formatValue(v: number): string` kept as a method-style signature rather than an arrow-typed property, matching the brief literally).
- **Scope discipline**: `git status` after the commit shows a clean tree; only the 20 files from the Files:Create block were touched. No edits to `src/index.css`, `App.tsx`, `main.tsx`, `types.ts`, `storage.ts`, `package.json`, or `vite.config.ts` (the last of which I considered touching to add `test.globals: true`, but that's a shared config file outside this task's Files block, so I solved test isolation locally in `ui.test.tsx` instead — see TDD notes above).
- **Visual rules checked against every file**: tokens (`bg-bg`/`text-fg`/`bg-surface`/`border-border`/`text-muted`/`bg-accent text-accent-fg`) used throughout, nothing hardcodes a hex color; `rounded-xl` on every card/control/surface; every interactive control is `min-h-11`/`min-w-11` (44px) including `Button`'s `sm` size, `Modal`/`Toast` close buttons, `Tabs`/`Layout` nav links, `Checkbox`'s label row; `focus-visible:outline` rings on every interactive element plus a `focus-visible:ring` on the `LineChart` SVG; `tabular` applied to `Badge` text and every numeric text node in `LineChart` (axis ticks, endpoint label, tooltip value) — I initially missed the axis-tick/endpoint `<text>` elements in `LineChart` on a first pass and added `className="tabular"` to them during self-review before committing.
- **pt-BR / English split**: all UI copy is pt-BR ("Sair", "Modo sol"/"Modo noite", "Cancelar", "Confirmar", "Fechar", "Carregando", "menor é melhor", "Sem dados para exibir", "Rótulo"/"Valor", aria-labels); all identifiers, comments and commit text are English.
- **Accessibility choices documented rather than silently skipped**: `Modal` doesn't implement a focus trap or auto-focus-on-open (the brief only specifies Esc + backdrop close; adding a trap felt like scope creep without a stated requirement — flagging it here in case a later task wants it). `LineChart` uses `role="img"` with a computed summary plus a parallel `sr-only` table rather than full per-point roving-tabindex navigation — a deliberate, lower-complexity accessible-chart pattern (summary + hidden data table + optional pointer/keyboard crosshair) rather than a WCAG-maximal implementation.
- **No dead code**: removed a stray `export type {ReactNode as _ReactNodeReExportCheck}` line I'd left in `Field.tsx` from an earlier draft before running tests.

## Concerns

- `Button`'s `sm` size is `min-h-11` (44px tall) same as `md`, distinguished only by padding/font-size — I chose this over a genuinely smaller `sm` because the brief's own visual rule says "min touch target 44 px" with no exception listed for dense contexts. If a later task wants a visually-denser sub-44px control (e.g. inline table row actions), it isn't `Button`'s `sm` variant as built; flagging so nobody assumes `sm` is small.
- `Table`'s sticky-header trick (`Children`-walk looking for a literal `thead` child) only fires when callers pass `<thead>` as a direct child of `<Table>` (the natural way to use it, and the only way any table will be built in this codebase per the file structure) — it won't find a `thead` nested inside a fragment or a wrapper component.
- `LineChart`'s non-uniform viewBox stretch (see above) is a real, if minor, visual trade-off versus a `ResizeObserver`-measured version. Flagging for whoever builds the athlete stats page in case pixel-perfect circular markers matter there.
- I could not find any existing usage examples of these components in later task briefs (I checked task-17 through task-24's briefs, which describe `Layout`/`Tabs`/`RequireOrganizer` in prose but don't show JSX), so some presentational choices (nav wrap breakpoint, toast position, modal max-widths) are my own reasonable defaults rather than something verified against a consumer.

## Report

Full report at `/home/claude/endurance-base-club/.superpowers/sdd/2026-09-24-endurance-base-club/task-16-report.md` (this file).

---

# Fix round 1

Branch `task/16`, same worktree, commit `668e10d` (on top of `a4456b6`). Addresses the 4 Important issues from the task review. Note: this round **resolves two items** flagged as open "Concerns" in the original report above — the Modal focus-trap gap (line noting "doesn't implement a focus trap or auto-focus-on-open") and the LineChart non-uniform viewBox stretch — both are fixed below; the rest of the original report stands unchanged.

## What changed

**1. `src/components/ui/Modal.tsx` — focus management.**
- A `getFocusable(container)` helper (`querySelectorAll` over links/buttons/inputs/textareas/selects/positive-tabindex elements — deliberately no `offsetParent`/`getBoundingClientRect` visibility check, since jsdom never computes real layout and would make every element look invisible) backs three behaviors, all gated on the dialog's own `dialogRef`:
  - **Focus in on open**: a `useEffect` keyed only on `[open]` (not on `onClose`, so it doesn't re-fire on every re-render while open) captures `document.activeElement` as the trigger, then focuses the first focusable descendant, or the dialog `<div>` itself (now `tabIndex={-1}`) when there is none.
  - **Tab trap**: folded into the existing Escape `keydown` listener. On `Tab`, it recomputes the focusable list fresh (content can change), and when focus is on the last one (or has somehow left the dialog) moves it to the first; `Shift+Tab` does the mirror image from the first back to the last; zero focusable elements pins focus on the container.
  - **Focus out on close**: the same open-effect's cleanup refocuses the captured trigger element, if it's still attached to the document.
- Verified against `@testing-library/user-event`'s source (`dispatchEvent.js`/`getTabDestination.js`) that `userEvent.tab()` only runs its own DOM-order focus advance when the dispatched keydown's `preventDefault()` was **not** called — since the trap calls it, `userEvent.tab()` in tests exercises the trap's own focus logic rather than fighting it.

**2. `src/components/ui/Toast.tsx` — pause/resume on hover and focus.**
- Each toast's timer bookkeeping moved from a bare `setTimeout` handle to a small `TimerState` (`remainingMs`, `startedAt`, `handle`, plus independent `hovering`/`focused` booleans). `pause(id, reason)` sets the given reason's flag and, if the timer is currently running, ticks the elapsed time off `remainingMs`, clears the handle and stops tracking `startedAt`; `resume(id, reason)` clears the flag and only restarts a `setTimeout(remainingMs)` once **both** `hovering` and `focused` are false — so hovering the toast while also tabbed onto its "Desfazer" button, then only releasing one of the two, correctly keeps it paused.
- Wired via React's `onMouseEnter`/`onMouseLeave` (true enter/leave of the toast's subtree, not the bubbling `mouseover`/`mouseout`) and `onFocus`/`onBlur` (React's versions bubble like native `focusin`/`focusout`, unlike raw DOM `focus`/`blur`) directly on each toast's container div, so pausing/resuming works whether the pointer or keyboard focus is on the message, the action button, or the close button.

**3 & 4. `src/components/LineChart.tsx` — touch stickiness and uniform geometry.**
- Selection state split three ways: `hoverIndex` (mouse, continuous, clears on `pointerleave`), `touchIndex` (touch, set on `pointerdown`/`pointermove`, survives `pointerup`/`pointerleave`), `focusIndex` (keyboard, unchanged). `activeIndex = hoverIndex ?? touchIndex ?? focusIndex`.
  - `handlePointerMove` now branches on `e.pointerType`: `'touch'` writes `touchIndex`, anything else writes `hoverIndex` as before.
  - `handlePointerLeave` returns immediately for `'touch'` (no-op — touch has no hover to clear) and only clears `hoverIndex` for mouse/pen, preserving the prior behavior there.
  - A sticky `touchIndex` is cleared by: another tap on the chart (naturally overwrites it), `handleBlur` (now clears `touchIndex` alongside `focusIndex`), or a new `pointerdown` **outside** the chart, detected by a `useEffect` (active only while `touchIndex !== null`) listening on `document` and checking `!svgRef.current.contains(e.target)`.
- The SVG's coordinate system is no longer a fixed 640-wide `viewBox` stretched with `preserveAspectRatio="none"`. A `measuredWidth` state (initialized to the old constant, renamed `FALLBACK_VIEW_W`) drives `viewBox`, `plotW`, gridline extents and the tooltip's percentage positioning; a `useEffect` observes the wrapping `<div>` with a `ResizeObserver` (guarded by `typeof ResizeObserver === 'undefined'`, since jsdom doesn't provide one — confirmed empirically with a throwaway probe test) and updates `measuredWidth` from `contentRect.width`. With no `preserveAspectRatio="none"` and the viewBox matching the real box exactly, one SVG user unit is one CSS pixel: circles render as circles and the line's slope is never skewed, at any container width.
- Added `data-testid="line-chart-tooltip"` on the tooltip so tests (and future consumers) can target it without an ambiguous text query — the active point's label text also appears as an x-axis tick and in the `sr-only` data table, so `getByText` alone would match 2–3 elements at once.

## Tests

All 7 added to `src/components/ui/ui.test.tsx` (no new test files):
- `Modal focus management > moves focus into the dialog on open, traps Tab inside it, and restores focus to the trigger on close` — a stateful harness (real `open`/`onClose` wiring, not a mock) opens the modal, asserts the close button has focus, tabs three times to confirm the header-close → content-button → footer-button → wrap-to-close cycle, shift-tabs once to confirm the reverse wrap, then presses Escape and asserts focus returned to the trigger button.
- `useToast > pauses the auto-dismiss timer while hovered and resumes with the remaining time on mouseleave` — fake timers: advance 2s, `mouseEnter`, advance 10s (still present), `mouseLeave`, advance 2999ms (still present), advance 2 more ms (gone).
- `LineChart touch interaction` (3 tests): a touch `pointerdown`+`pointerup`+`pointerleave` sequence leaves `line-chart-tooltip` in the document; a mouse `pointermove`+`pointerleave` sequence still removes it (guards the "mouse keeps hover behavior" half of the requirement); a touch tap followed by a `pointerdown` on a sibling button outside the chart clears it.
- `LineChart responsive geometry` (2 tests): with no `ResizeObserver` global, the SVG's `viewBox` is `0 0 640 200` and it carries no `preserveAspectRatio="none"`; with a stubbed `ResizeObserver` (`vi.stubGlobal`) whose callback is invoked manually with `contentRect.width: 480`, the `viewBox` updates to `0 0 480 200`.

**RED/GREEN evidence**: wrote all 7 tests first, then ran `git stash push -- src/components/LineChart.tsx src/components/ui/Modal.tsx src/components/ui/Toast.tsx` to put the three source files back to their pre-fix (committed) state while keeping the new tests. `npx vitest run src/components/ui/ui.test.tsx` at that point: **7 failed, 20 passed** — every new test failed for the expected reason (no focus management in `Modal`, no pause/resume in `Toast`, no `pointerType` branching or `line-chart-tooltip` testid in `LineChart`), and none of the 20 original tests regressed. `git stash pop` restored the fixes; the same command then showed **27 passed, 0 failed**.

## Commands and output

```
$ npx vitest run src/components
 Test Files  1 passed (1)
      Tests  27 passed (27)

$ npx vitest run          # full repo, includes Task 1's format/storage tests
 Test Files  3 passed (3)
      Tests  38 passed (38)

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(no output — clean)

$ npm run build
> vite build
✓ 16 modules transformed.
dist/index.html                   0.81 kB │ gzip:  0.44 kB
dist/assets/index-CW14qFdo.css   18.23 kB │ gzip:  4.72 kB
dist/assets/index-DrevRjwI.js   219.66 kB │ gzip: 68.61 kB
✓ built in 180ms
```

`git status` is clean after the commit; `src/test/setup.ts` was not touched (per the coordinator's note that Ruling 7 belongs to a later task) — test isolation continued to rely on `ui.test.tsx`'s own `afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); })` (the last call added this round, to guarantee the `ResizeObserver` stub from the geometry test never leaks into a later test even if an assertion above it throws).

## Files changed (fix round 1)

`src/components/LineChart.tsx`, `src/components/ui/Modal.tsx`, `src/components/ui/Toast.tsx`, `src/components/ui/ui.test.tsx` — 4 files, 350 insertions / 29 deletions. Commit `668e10d fix(ui): modal focus trap, toast hover pause, touch-safe line chart`.

## Self-review / remaining notes

- The Toast pause/resume overlap case (hover and focus both active, only one clears) is implemented with two independent boolean flags and reasoned through carefully (see the `TimerState` comment in the source), but I didn't add a dedicated automated test for that exact overlap — the coordinator's required scenario (hover past duration, leave, wait remaining time) is covered exactly as specified. Flagging in case a reviewer wants that combination locked down too.
- `Modal`'s Tab trap re-queries `getFocusable(container)` on every `Tab` keypress rather than caching — the right call given dialogs can have dynamic content (e.g. a form field appearing/disappearing), and it's cheap (a single `querySelectorAll` over a small subtree).
- No change to `Confirm.tsx`, which already composes `Modal` and now gets the focus trap/restore for free (its own existing tests — resolve true/false on `confirm-ok`/`confirm-cancel` — still pass unmodified, confirming no regression there).

---

# Fix round 2

Branch `task/16`, same worktree, commit `8e8b7c4` (on top of `668e10d`, on top of `a4456b6`). Addresses 1 Important regression found by the re-review of fix round 1's `LineChart` change.

## The regression

`src/components/LineChart.tsx`'s `ResizeObserver` setup effect had `deps = []`, so it ran exactly once, immediately after the component's first commit — but when `points.length === 0` the component returns an `EmptyState` instead of the measured `<div>`, so a chart first rendered with `points={data ?? []}` (e.g. while a query is loading) had a `null` container ref on that one and only run. The effect's guard (`if (!el ...) return;`) bailed out silently, no observer was ever constructed, and because the effect never runs again (empty deps), it got no second chance once real points arrived on a later render and the container actually mounted. `measuredWidth` stayed pinned at the `640` fallback forever — the chart would letterbox (or overflow) at any container width other than exactly 640px, for every chart that can ever start empty, which per the design spec is the normal loading state.

## What changed

`src/components/LineChart.tsx`:
- Replaced the plain `useRef<HTMLDivElement>` + `useEffect(..., [])` pair with a **callback ref backed by state**: `const [container, setContainer] = useState<HTMLDivElement | null>(null)`, passed directly as `ref={setContainer}` on the wrapping `<div>`. React calls a callback ref with the node on every mount (and with `null` on every unmount), so `setContainer` fires exactly when the container's presence changes — including the *first* time it ever mounts, whenever that happens.
- The `ResizeObserver` effect is now keyed on `[container]` instead of `[]`, so it re-runs whenever the container node changes: nothing happens while `container` is `null` (the `EmptyState` case, same as before), and the observer attaches the moment the real container node shows up, whether that's on the initial render (chart starts with data) or a later rerender (chart starts empty, then gets data).
- `svgRef` (used only by the existing outside-tap-dismiss logic, unrelated to sizing) is untouched, still a plain `useRef`.
- No JSX/markup/behavior change beyond the one `ref={containerRef}` → `ref={setContainer}` swap and the hook rewrite above it — the rendered DOM, viewBox math, and all touch/hover/keyboard interaction logic from fix round 1 are unchanged.

## Test

Added to the existing `describe('LineChart responsive geometry', ...)` block in `src/components/ui/ui.test.tsx` (no new test files), using the same `FakeResizeObserver`/`vi.stubGlobal` pattern as its two neighboring tests:
`attaches the ResizeObserver once the chart container mounts, even if it first rendered empty` — renders `<LineChart points={[]} .../>` under a stubbed `ResizeObserver` and asserts nothing was observed yet (the `EmptyState` path renders no container); `rerender`s the *same instance* with two real points; asserts the observer's `observe()` was now called (the regression's exact failure point — this assertion is what catches it); reads the SVG's `viewBox` (still `"0 0 640 200"`, the fallback); fires the stubbed callback with `contentRect.width: 480`; asserts the `viewBox` becomes `"0 0 480 200"`.

**RED**: with the test added but before the source fix, `npx vitest run src/components/ui/ui.test.tsx` — **1 failed, 27 passed**:
```
FAIL  src/components/ui/ui.test.tsx > LineChart responsive geometry > attaches the ResizeObserver once the chart container mounts, even if it first rendered empty
AssertionError: expected null not to be null
 ❯ src/components/ui/ui.test.tsx:540:32
    538|     // The container mounts for the first time on this rerender (not o…
    539|     // component's first-ever commit) — the observer must attach now.
    540|     expect(observedTarget).not.toBeNull();
```
This reproduces the regression exactly as described: the observer never attached after the empty→populated transition. The other 27 tests (fix round 1's two neighboring `ResizeObserver` tests included) were unaffected.

**GREEN**: after the source fix, same command — **28 passed, 0 failed**.

## Commands and output

```
$ npx vitest run src/components
 Test Files  1 passed (1)
      Tests  28 passed (28)

$ npx vitest run          # full repo
 Test Files  3 passed (3)
      Tests  39 passed (39)

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(no output — clean)

$ npm run build
> vite build
✓ 16 modules transformed.
dist/index.html                   0.81 kB │ gzip:  0.44 kB
dist/assets/index-CW14qFdo.css   18.23 kB │ gzip:  4.72 kB
dist/assets/index-DrevRjwI.js   219.66 kB │ gzip: 68.61 kB
✓ built in 194ms
```

`git status` is clean after the commit. `src/test/setup.ts` was not touched.

## Files changed (fix round 2)

`src/components/LineChart.tsx`, `src/components/ui/ui.test.tsx` — 2 files, 61 insertions / 6 deletions. Commit `8e8b7c4 fix(ui): attach LineChart ResizeObserver on late container mount`.

## Self-review / remaining notes

- Checked for any other `containerRef` reference left over from the old plain-`useRef` approach (`grep containerRef src/components/LineChart.tsx`) — none; the callback-ref swap is complete and the only ref left in the file is the unrelated `svgRef`.
- Considered whether the callback ref's extra render (mount → `setContainer` → re-render → effect attaches) could cause a visible flash at the fallback width before snapping to the measured one — this was already true before this fix (the old `useRef` version also rendered once at the fallback before the `ResizeObserver` effect's *own* async callback reported a size) and is unchanged by this round; not in scope for the reported regression.
- Did not add a fresh RED/GREEN git-stash cycle for the whole file this round (as fix round 1 did across three files) since this round touches one function in one file — instead verified RED by writing the test against the actual pre-fix source (no stash needed) and GREEN immediately after the fix, shown above.
