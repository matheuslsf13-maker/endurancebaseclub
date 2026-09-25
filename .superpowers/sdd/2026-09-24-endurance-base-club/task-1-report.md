# Task 1 report: Project scaffold, shared contracts, time formatting, storage

## What I implemented

Followed the brief step by step (Steps 1–10), all in the main checkout at `/home/claude/endurance-base-club` on branch `feat/ebc-app`.

1. **Vite project scaffold**: `npm init -y`, then installed the exact dependency sets from the brief with `--save-exact` (7 runtime deps, 17 dev deps — npm resolved current versions, e.g. React 19.3.0, Vite 8.3.1, TypeScript 7.0.2, Vitest 5.0.1; all pinned exactly, zero vulnerabilities). Edited `package.json`: `name: "endurance-base-club"`, `private: true`, `type: "module"`, removed `main`, set all 12 scripts verbatim.
2. Created `tsconfig.json`, `vite.config.ts` (jsdom env, `src/test/setup.ts`, test include glob), `src/test/setup.ts`, `.env.production` / `.env.development` / `.env.e2e`, `.gitignore` (with the `tests/e2e/artifacts/*` + `!.../.gitkeep` pattern for a directory that doesn't exist yet — Task 28 will populate it), `vercel.json`, `index.html` (pt-BR, viewport, theme-color, icons, inline pre-paint theme script, root div, module script), `src/index.css` (brand tokens, Tailwind v4 `@theme inline`, `.tabular`/`.brand-title`/print rules), `src/main.tsx` (StrictMode + `./index.css`), temporary `src/App.tsx`, `src/vite-env.d.ts`.
3. **Brand assets**: ran the given Pillow script against the user's logo (`/root/.claude/uploads/.../45b4c3fa-image.jpg`) to produce circular-masked, palette-quantized `public/logo.png` (150×150, 5062 B), `public/favicon.png` (48×48, 1003 B), `public/icon-192.png` (192×192, 3591 B). Verified all three are well under 25 KB and have fully transparent corners (alpha=0) with an opaque center.
4. **`src/lib/types.ts`**: copied verbatim from contracts.md "Shared Contracts" block — verified with a scripted line-for-line diff, exact match.
5. **`src/lib/format.ts`** and **`src/lib/storage.ts`**: TDD per the brief (see Evidence below). `format.ts` and its test are copied verbatim from the brief. `storage.ts`'s test is verbatim from the brief; its implementation follows the brief's prose spec (`memoryStorage()` wraps a `Map`; `safeLocalStorage()` tries `window.localStorage` per call, and on any exception for a key, switches that key permanently to a module-level in-memory fallback — checked first on every subsequent call for that key so a key never straddles both stores after a flaky write).

## Tested and results

- `npx vitest run` → 2 test files, 11 tests, all pass.
- `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts` → 9/9 pass (proves formatting is device-timezone-independent, per Review Focus item 4).
- `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) → no errors.
- `npm run build` (`vite build`) → succeeds; `dist/` contains `index.html`, hashed JS/CSS bundles, and the three copied PNGs.

## TDD Evidence

### RED — `src/lib/format.test.ts`

Command: `npx vitest run src/lib/format.test.ts` (before `src/lib/format.ts` existed)

```
FAIL  src/lib/format.test.ts [ src/lib/format.test.ts ]
Error: Failed to resolve import "./format" from "src/lib/format.test.ts". Does the file exist?
...
 Test Files  1 failed (1)
      Tests  no tests
```

Expected because `src/lib/format.ts` did not exist yet — the test module can't even be resolved, exactly the "module not found" failure the brief calls for.

### GREEN — `src/lib/format.ts`

Command: `npx vitest run src/lib/format.test.ts`

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

Command: `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts`

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### RED — `src/lib/storage.test.ts`

Command: `npx vitest run src/lib/storage.test.ts` (before `src/lib/storage.ts` existed)

```
FAIL  src/lib/storage.test.ts [ src/lib/storage.test.ts ]
Error: Failed to resolve import "./storage" from "src/lib/storage.test.ts". Does the file exist?
...
 Test Files  1 failed (1)
      Tests  no tests
```

### GREEN — `src/lib/storage.ts`

Command: `npx vitest run src/lib/storage.test.ts`

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### Full suite GREEN (post-implementation)

Command: `npx vitest run`

```
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

## Files changed

All new files (first commit on this repo besides docs), one commit `495ab7b`:

- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `vercel.json`
- `.env.production`, `.env.development`, `.env.e2e`
- `public/logo.png`, `public/favicon.png`, `public/icon-192.png`
- `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`
- `src/lib/types.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/lib/storage.ts`, `src/lib/storage.test.ts`
- `src/test/setup.ts`

## Self-review findings

- **Completeness**: all 22 files listed in the brief's `Files: Create` block are present; `package-lock.json` was additionally committed (standard practice for a lockfile-reproducible install, not excluded by `.gitignore`, and the brief's own `Step 10` does `git add -A`).
- **Verbatim accuracy**: scripted a diff of every fenced code block in the brief (and the "Shared Contracts" block in contracts.md) against the file written to disk. `tsconfig.json`, `vite.config.ts`, `.env.production`, `.env.development`/`.env.e2e`, `vercel.json`, `src/index.css`, `src/test/setup.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/lib/storage.test.ts`, and `src/lib/types.ts` all diffed byte-for-byte identical to the brief/contracts. `package.json` scripts and top-level fields (`name`/`private`/`type`/no `main`) checked individually and match. `index.html`'s inline theme script matched the brief's two key lines verbatim; the rest of the document satisfies each individually-specified attribute (lang, charset, viewport, theme-color, title, icon links, root div, module script).
- **Quality/YAGNI**: `storage.ts` (the one file without verbatim source, only a prose spec) sticks exactly to the five exported signatures in the Shared Contracts — no speculative extras. A key that hits an exception on `safeLocalStorage` is pinned to the in-memory fallback for all three methods (`getItem`/`setItem`/`removeItem`), which is a slightly stronger reading of "keeps using... for that key" than the minimum needed to pass the given test, but it's the natural, low-risk interpretation of the documented behavior and avoids a key silently splitting across two backing stores if `window.localStorage` becomes flaky rather than fully broken.
- **Test hygiene**: both test files are exactly what the brief specifies — deterministic, no time/network dependence beyond the fixed `T` constant and explicit TZ env var override, one assertion group per behavior.
- **Global Constraints spot-check**: `format.ts` never calls `toLocaleTimeString()` without a timezone (uses `Intl.DateTimeFormat` with explicit `timeZone: TZ`); `types.ts` field names are snake_case as given; `index.css` brand tokens match the plan's hex values (ink `#191513`, paper `#F4F1EC`, the six neutrals, success/warning/danger/info) exactly; system font stack only, no web fonts.
- **No open concerns.** Nothing in this task required restructuring beyond the plan's file list, and no scope crept beyond Task 1's boundaries (temporary `App.tsx` intentionally left as the one-line placeholder Task 17 will replace).

## Commit

`495ab7b chore: scaffold Vite React app, shared types, time formatting and storage`

Note on trailers: the live system-reminder governing this session ("Attribution for git commits and pull requests you create from here on... this replaces Claude Code's own earlier attribution guidance, such as a previous copy of this reminder") explicitly supersedes the literal `Co-Authored-By: Claude Opus 5.5` line embedded in the brief/contracts template. I used the reminder's current trailers instead (same `Claude-Session` URL, `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`), since the brief's trailer is exactly the kind of stale, earlier-baked attribution text the reminder says to override.
