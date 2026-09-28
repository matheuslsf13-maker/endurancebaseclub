# Final fix 3 report — organizer/public UI, kit, shell, delivery

Worktree `C:\ENDURANCE\ebc-wt\ff3`, branch `fix/final-3`, base `6244b7e`. All commands run in WSL
(`wsl.exe -d Ubuntu-24.04 -u root -e bash -lc 'cd /mnt/c/ENDURANCE/ebc-wt/ff3 && ...'`) per Ruling 56;
git commands from Windows Git Bash. Commit range: `3911614..7642e31` (12 commits, listed at the end).

No dependency was added or upgraded (item 16 required this); `npm ci --dry-run` was checked clean
against the existing `package-lock.json` before switching `vercel.json`'s `installCommand` to it.

Two interface notes from Fixer 1 (received mid-wave, both addressed):
1. Workbook classification sheets renamed `"Class. – <prova>"` (was `"Classificação – …"`) →
   `tests/e2e/03_review_results.sh`'s openpyxl check updated to match the new prefix and assert at
   least one such sheet exists (never passes vacuously).
2. `admin_save_race`'s new pt-BR P0001 messages (team size / leg count with entries, wave deletion)
   → RaceEditor's pre-save confirmations (items 3 and 5 below) reworded to mirror them; RaceEditor
   already surfaced server messages verbatim (item 4) before this note arrived.

---

## Items

### 1. C-I1 — PWA update never reloads the timekeeper tab (Ruling 26)

- **Where:** `src/main.tsx:12-20`, `src/components/UpdatePrompt.tsx:16-50`.
- **Why:** vite-plugin-pwa's default `onNeedReload` is `window.location.reload()` in every
  controlled tab once another tab of the device applies an update — including an open `#/c/`
  timekeeper tab, losing an in-flight MARCAR tap or a half-typed bib. `onNeedRefresh` also fired
  twice (from the plugin's `'installed'`/`'waiting'` listeners) for a tab open more than ~60 s.
- **Fix:** extracted `buildRegisterSWCallbacks(getUpdate)` (`UpdatePrompt.tsx`) returning both
  `onNeedRefresh` (de-duplicated via a closure flag, still gated by `shouldPromptForUpdate`) and
  `onNeedReload` (only reloads when `shouldPromptForUpdate(location.hash)` is true). `main.tsx`
  passes both to `registerSW`.
- **Tests:** `src/components/UpdatePrompt.test.tsx:64-125` — 4 new cases: no reload on `#/c/`,
  reload elsewhere, `onNeedRefresh` dispatches once for two calls, never dispatches on `#/c/`.
  jsdom has no configurable `window.location.reload`, so the tests swap the whole `location`
  object (documented in the test).
- **RED/GREEN:** first run failed with `TypeError: Cannot redefine property: reload` (spying
  directly on `window.location.reload`); fixed by swapping the `location` object instead. GREEN:
  `UpdatePrompt.test.tsx` 9/9 passed.

### 2. C-I2 — Nested dialogs: Escape/Tab acted on both

- **Where:** `src/components/ui/Modal.tsx:32-90`, `src/features/entries/EntryForm.tsx:121-126`
  (coupling removed).
- **Why:** every open `Modal` added its own `document` keydown listener with no notion of which
  dialog is "on top", so with two open (EntryForm's "+ Novo atleta" inside EntriesTab's "Nova/Editar
  inscrição") Escape closed both and the two focus traps fought over Tab.
- **Fix:** a module-level `openStack` of open dialogs (push on open, splice on close); the keydown
  handler only acts when its own `dialogRef.current` is the top of the stack. Also added
  `if (e.defaultPrevented) return` before the Escape branch, so EntryForm's combobox no longer
  needs `stopImmediatePropagation` — it just calls `preventDefault()` on its own Escape handling
  (already did, for the popup-close), which now suffices to stop the dialog from closing too.
- **Tests:** `src/components/ui/ui.test.tsx:144-198` (`Modal stacking (nested dialogs)`): Escape
  closes only the inner dialog, keeping the outer's typed input; Tab stays inside the inner dialog
  (wraps `Fechar → Nome → Salvar atleta → Fechar`, never reaching the outer dialog's controls).
  Existing `src/features/entries/entries.test.tsx:199` ("closes the suggestion list on Escape
  without picking anything") still passes, confirming the `defaultPrevented` guard subsumes the
  old coupling.
- **Bonus:** `Modal` gained `closeOnBackdrop` (default `true`); every data-entry form modal sets it
  `false` (see item 10).

### 3. C-I3 (UI part) — Removing a wave that has started or has entries

- **Where:** `src/features/races/RaceEditor.tsx:178-196` (`removeWave`).
- **Why:** "Remover" had no confirmation; the server (Fixer 1) now refuses the delete with a
  named pt-BR message, but the UI gave no warning before Salvar.
- **Fix:** `removeWave` is now async; if the wave has `start_at` or entries it opens a danger
  confirm naming the wave and the consequence ("já largou" / "tem N inscrição(ões)"), mirroring
  Fixer 1's exact wording, before removing it from the local form (the server is still the source
  of truth on Salvar — the confirm's copy explicitly says the removal will be refused).
- **Tests:** `src/features/races/races.test.tsx:186-241` (`C-I3` describe): warns naming a
  recorded start ("já largou"), warns with the entry count and removes once confirmed, and skips
  the confirm entirely for a wave with neither.

### 4. C-I4 — Save errors rendered off-screen

- **Where:** `RaceEditor.tsx:82,111-117,224-234`; `EntryForm.tsx:236-241,290-300`.
- **Why:** validation/server errors appeared in a banner at the top of long forms with the
  "Salvar" button at the bottom — no scroll, no focus, no toast.
- **Fix:** an `errorRef` on the banner `div` (`tabIndex={-1}`), and a `useEffect` keyed on
  `errors` calling `errorRef.current?.scrollIntoView?.({behavior:'smooth', block:'center'})` then
  `.focus()`. The optional-call on `scrollIntoView` is intentional — jsdom has no layout engine
  and doesn't implement it at all.
- **Tests:** `races.test.tsx:172-184`, `entries.test.tsx:188-203` — after a rejected save, assert
  `alert.parentElement?.parentElement` (the banner div) `toHaveFocus()`.
- **RED:** first run threw `errorRef.current?.scrollIntoView is not a function` in jsdom (the
  optional *call* `?.()` was missing, only optional *access* `?.` was present) — fixed to
  `scrollIntoView?.(...)`. GREEN after the fix.

### 5. B1-I2 / C-Minor-5 (UI part) — Warn before changing legs/team size with entries

- **Where:** `RaceEditor.tsx:130-172` (`onTeamSizeChange`, `onLegsChange`).
- **Why:** the server (Fixer 1) now rejects a team-size change outright once entries exist, and
  either rejects (team races) or auto-rewrites members' legs (individual races) on a leg-count
  change — with no forewarning in the UI.
- **Fix:** both handlers compute `entryCount` (entries for this race) and prepend a confirm
  message naming it, phrased to match the actual behaviour: team-size change says the server
  won't allow it; leg-count change says the server rejects it for a team race, or that members
  will be reassigned automatically for an individual one. The pre-existing individual↔team
  boundary confirm (podium/age-group reset) is preserved and combined with the entry-count
  warning when both apply.
- **Tests:** `races.test.tsx:243-297` (`B1-I2 / C-Minor-5`): warns with the count before a
  team-size change (and still allows it once confirmed), no warning with zero entries, warns
  before adding a leg (individual race, entries present), cancelling leaves the leg list
  untouched.

### 6. C-Minor-1 — Athlete pickers show "no athletes" while loading/failed

- **Where:** `EntryForm.tsx:23-34,55,180-192,331-334` (`MemberPicker`);
  `BulkEntryDialog.tsx:119-129`.
- **Why:** a slow or failed `listAthletes()` showed "Nenhum atleta encontrado/disponível" with no
  loading/error state, inviting a duplicate athlete via "+ Novo atleta" on race-morning 4G.
- **Fix:** `MemberPicker` takes `loading`/`loadError` props (from `athletesQuery.isLoading` /
  `.isError`); shows "Carregando atletas…" or a `role="alert"` error instead of the empty state.
  `BulkEntryDialog`'s candidate list does the same.
- **Tests:** `entries.test.tsx:205-224` (EntryForm), `entries.test.tsx:394-437` (BulkEntryDialog,
  loading via an unresolved promise + error via a rejected one).

### 7. C-Minor-2 (UI part) — Client check "Informe a data do evento"

- **Where:** `EventGeneralTab.tsx:26,107-114,193-201`; `EventsPage.tsx:184-190,278-284`.
- **Why:** `noValidate` drops the native `required` check; an empty date reached the server as a
  raw English cast error.
- **Fix:** each of the three date forms (Geral tab, create-event modal, duplicate-event modal)
  checks `!date.trim()` before calling the API and shows "Informe a data do evento" (a new
  `dateError` state wired into `EventGeneralTab`'s `Input`, the existing `error` state in the
  other two modals).
- **Tests:** `events.test.tsx:203-229,361-370`.

### 8. C-Minor-3 — Import shortcut preselects the event

- **Where:** `EntriesTab.tsx:217` (`navigate` target); `AthletesPage.tsx:32-47,176-181`;
  `ImportDialog.tsx:14-20,37,50-58`.
- **Why:** the shortcut linked to `/atletas?import=1`, landing on "Nenhum — só cadastrar atletas",
  silently ignoring the Prova column.
- **Fix:** the link now carries `?import=1&evento=<id>`; `AthletesPage` reads `evento` (once,
  lazily) and passes it as `ImportDialog`'s new `initialEventId` prop, which seeds the "Inscrever
  na prova…" select on open. Both `import` and `evento` are stripped from the URL right after
  consuming (no back-button re-trigger).
- **Tests:** `entries.test.tsx:447-459` (link carries `?import=1&evento=ev1`);
  `athletes.test.tsx:399-410` (dialog preselects `ev1`).

### 9. C-Minor-4 — Deletion confirm copy

- **Where:** `RacesTab.tsx:35-39`; `EntriesTab.tsx:161-165`; `EventGeneralTab.tsx:141-149`;
  `EventsPage.tsx:41-45`.
- **Why:** race/event deletion implied marks are deleted (they are kept, unassigned, resurfacing
  as "sem atleta" pendências) and didn't mention finalized results/athlete stats being erased.
- **Fix:** reworded all four confirms to state the actual consequence.
- **Tests:** `events.test.tsx:190-201` (event deletion mentions "resultados finalizados" /
  "estatísticas dos atletas`).

### 10. C-Minor-6 — Unsaved edits: navigation block + no backdrop-close on forms

- **Where:** `RaceEditor.tsx:89-121,393-402` (`isDirty`/`useBlocker`/`handleCancel`);
  `EventGeneralTab.tsx:87-103` (same pattern); `Modal.tsx` `closeOnBackdrop` prop (item 2) wired
  to `false` on every data-entry modal: `EntriesTab.tsx:90,279`, `EntryForm.tsx:409`,
  `BulkEntryDialog.tsx:80`, `ImportDialog.tsx:109`, `AthletesPage.tsx:176`,
  `AthleteProfilePage.tsx:120`, `EventsPage.tsx:219,306`.
- **Why:** leaving RaceEditor/EventGeneralTab by tab or browser-back silently discarded edits; a
  stray backdrop tap closed a form modal (easy on a phone) and discarded it too.
- **Fix:** `react-router`'s `useBlocker(isDirty)` (`isDirty` = the form serialized differs from
  its seed) shows a danger confirm before an in-app navigation away; RaceEditor's explicit
  "Cancelar" button also confirms when dirty. `Modal`'s backdrop `onClick` is now conditional on
  `closeOnBackdrop`.
- **Scope decision:** `useBlocker` requires a *data* router. `RacesTab`'s and `EventGeneralTab`'s
  test harnesses (`races.test.tsx`, `events.test.tsx`) were updated to render through
  `createMemoryRouter`/`RouterProvider` instead of a bare `render`/plain `<MemoryRouter>`; this is
  also exactly how the real app renders (`createHashRouter` in `App.tsx`), so no behavioural gap
  in production — only the test scaffolding needed the same router class. `EventGeneralTab`'s
  Ruling-40 "rerender the same instance with a new context" test helper (`renderTabDirect`) now
  carries the context in an internal `Harness` component's state (set via a captured `setState`)
  instead of RTL's `rerender`, so it still updates the same mounted component without recreating
  the router.
- **Tests:** `races.test.tsx:299-347` (`C-Minor-6`): Cancelar confirms when dirty (cancel keeps
  the form, confirm discards); an in-app `router.navigate` while dirty is blocked until confirmed.
  `events.test.tsx:373-390`: same pattern for EventGeneralTab. `ui.test.tsx:126-141`:
  `closeOnBackdrop={false}` keeps the dialog open on a backdrop click, Escape still works.
- **RED:** wiring `useBlocker` first broke `races.test.tsx` (11/11 fail — no router at all) and
  `events.test.tsx`'s three Ruling-40 tests (`useBlocker must be used within a data router`).
  Fixed both harnesses as above; GREEN afterwards (21/21 and 24/24 respectively).

### 11. C-Minor-7 — "#/" offers "Voltar à cronometragem"

- **Where:** `src/App.tsx:11,60-68,246-253` (`LAST_TIMEKEEPER_TOKEN_KEY`, `TimekeeperRoute`);
  `src/features/public/PublicHome.tsx:14-18,55-62,68-77`.
- **Why:** a volunteer's home-screen icon (`start_url: '/'`) or a reopened browser lands on the
  plain public home with no way back to their timing screen.
- **Fix:** `/c/:token` is now wrapped by a small `TimekeeperRoute` (in `App.tsx` only —
  `TimekeeperPage` itself, owned by Fixer 2, is untouched) that persists the token to
  `localStorage`. `PublicHome` reads it once and, if present, shows a card with a
  "Voltar à cronometragem" link to `/c/<token>`. The key is duplicated as a literal in
  `PublicHome.tsx` (commented as such) rather than imported from `App.tsx`, to avoid a static
  import that would pull the app shell into this route's chunk (Ruling 30).
- **Tests:** `public.test.tsx:394-415` (`C-Minor-7`): shows the link when a token is stored, shows
  nothing otherwise.

### 12. C-Minor-8 — Tab strips unusable at 390 px

- **Where:** `src/components/ui/Tabs.tsx` (full rewrite of the render, same public API);
  `src/features/public/PublicEventPage.tsx:252-256,337-361` (race tablist, hand-rolled — doesn't
  use the shared `Tabs` component since it's click-driven over in-memory state, not `NavLink`).
- **Why:** at 390 px a tab strip with more items than fit is scrollable but a phone's scrollbar is
  hidden at rest, and the active tab (landed on directly, or pushed off-screen by a new badge) was
  never scrolled into view.
- **Fix:** both places now scroll the active tab into view (`scrollIntoView({block:'nearest',
  inline:'nearest'})`, effect keyed on the active id / route) and add a `pointer-events-none`
  gradient fade on both edges as a visual affordance.
- **Tests:** `ui.test.tsx:296-317` (Tabs: scrolls the active tab, asserted via
  `Element.prototype.scrollIntoView` spy + `mock.instances[0]`); `public.test.tsx:333-352`
  (PublicEventPage: same pattern, switching races).

### 13. C-Minor-9 — pt-BR router error screen

- **Where:** `src/App.tsx:53-76` (`RouteErrorBoundary`, exported), wired as `errorElement` on
  every top-level route and the organizer-area route (`App.tsx:118,126-134,137,251,258,265`).
- **Why:** a render error or a failed lazy chunk (offline before the service worker installs)
  showed react-router's default English "Unexpected Application Error!" with a raw stack trace.
- **Fix:** `RouteErrorBoundary` — deliberately **not** lazy-loaded (must be in the entry bundle to
  render at all if the failure is itself a chunk load) — shows "Algo deu errado" plus a
  differentiated message (404 vs. a chunk-load-shaped error vs. generic) and a "Recarregar" button
  (`window.location.reload()`).
- **Tests:** `eventShell.test.tsx:184-187` (every top-level route/organizer-area route declares an
  `errorElement`); `eventShell.test.tsx:190-231` (a throwing page renders "Algo deu errado" +
  "Recarregar", not the router default; clicking Recarregar calls `location.reload()`) — wrapped
  with a `console.error` spy since React logs the caught render error regardless of the boundary.

### 14. C-Minor-10 — "Categoria" shows only applicable dimensions

- **Where:** `EntriesTab.tsx:11,26-43,244`.
- **Why:** always rendered sex+age+level, so a team race with no age groups and no event levels
  read "Misto · Sem faixa · Sem nível".
- **Fix:** `applicableDims(race, hasLevels)` includes `'age'` only when
  `race.config.age_groups.length > 0` and `'level'` only when the event has levels; `'sex'` always
  applies.
- **Tests:** `entries.test.tsx:87-99`.

### 15. C-Minor-11 — WCAG AA contrast for status text

- **Where:** `src/index.css:16-25` (three new derived tokens); `Badge.tsx:10-17`; `Field.tsx:16`;
  every plain `role="alert" text-danger` in owned files swept to `text-danger-text`
  (`AthleteForm.tsx`, `AthleteProfilePage.tsx`, `AthletesPage.tsx`, `ImportDialog.tsx` ×4,
  `BulkEntryDialog.tsx`, `EntriesTab.tsx`, `EntryForm.tsx`, `EventLayout.tsx`, `EventsPage.tsx`
  ×3, `PublicAthletePage.tsx`, `PublicEventPage.tsx`, `PublicHome.tsx`, `AgeGroupsEditor.tsx`,
  `RaceEditor.tsx`, `SettingsPage.tsx` ×3); `EventGeneralTab.tsx:151` (`text-warning` →
  `text-warning-text`).
- **Why:** `--color-danger`/`warning`/`info` (fixed brand hex, same in both themes) fail 4.5:1 as
  plain text in at least one theme (e.g. light-theme warning on paper ≈2.4:1).
- **Fix:** `--color-{danger,warning,info}-text: color-mix(in srgb, var(--color-X) N%, var(--fg)
  100-N%)` — mixing toward `--fg` (already the max-contrast foreground per theme) pushes each
  colour lighter in dark mode and darker in light mode automatically, with **no new brand colour**
  (mechanically derived from the two existing ones). Verified by hand (sRGB relative-luminance
  arithmetic) for both themes against both `--bg` and `--surface`: danger ≥5.6:1, warning ≥5.1:1,
  info ≥6.1:1 in every case checked. `--color-danger`/`warning`/`info` themselves are untouched, so
  `Button`'s solid danger background (white text) keeps its existing ≈4.5:1 contrast.
- **Scope decision:** `Badge`/`Field` are shared kit components (unambiguously ours) so the fix
  reaches every consumer, including Fixer 1/2 screens, without editing their files. Plain
  `role="alert"` text was only swept inside files this wave owns; Fixer 2's timing/review/results
  screens (also using `text-danger` directly) are untouched — flagged under Concerns.
- **Tests:** existing `eventShell.test.tsx:209,219` updated (`toHaveClass('text-warning-text'
  /'text-danger-text')` — Badge's class name, not a new behavioural test) since Badge itself now
  emits the new class names; no dedicated new contrast test (this is a static CSS/class mapping,
  verified by reading, not something jsdom can measure).

### 16. C-Minor-12 — Deploy config

- **Where:** `vercel.json` (full rewrite); `package.json:6-8` (`engines`).
- **Fix:** `installCommand: "npm ci"` (the tracked `package-lock.json` is uploaded with the repo);
  `/assets/(.*)` gets `Cache-Control: public, max-age=31536000, immutable`; every response gets
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  strict-origin-when-cross-origin`; `package.json` adds `"engines": {"node": "22.x"}`.
- **Verification:** `npm ci --dry-run` against the existing lockfile succeeds (only reports
  optional platform-specific binaries it would add, no lockfile-drift error) — confirms no
  dependency change was introduced and `npm ci` is usable as the install command.

### 17. C-Minor-13 — Deleting an event invalidates the cache

- **Where:** `EventGeneralTab.tsx:5,86,154-158` (`useQueryClient`, `invalidateQueries(['events'])`,
  `removeQueries(['event', id])`).
- **Why:** the deleted event could flash back into the `/eventos` list (stale `['events']` cache)
  and be reopened, failing to load.
- **Tests:** `events.test.tsx:343-359` — spies on `QueryClient.prototype.{invalidateQueries,
  removeQueries}` and asserts both are called with the right keys.

### 18. C-Minor-14 — Public pages: retry, refetchOnWindowFocus, pub_live surfaced

- **Where:** `PublicEventPage.tsx:12,151-217,229,290-306,374-380`.
- **Fix:** load-error state gets a "Tentar novamente" button (`query.refetch()`); the full-payload
  `useQuery` sets `refetchOnWindowFocus: false` (the 10 s delta poll already resumes on
  visibility); `usePublicLivePoll` now returns `{lastPollFailed}` (set/cleared per poll attempt),
  surfaced as a small `role="status"` hint next to the "Parcial – ao vivo" badge.
- **Tests:** `public.test.tsx:291-330` — retry re-fetches and shows the table; no `mocks.event`
  call on a `focus`/`visibilitychange` event pair; a failing `mocks.live` (fake timers, advanced
  10 s) shows the "Não foi possível atualizar" hint.

### 19. C-Minor-15 — document.title reset outside public pages

- **Where:** `PublicEventPage.tsx:242-245`; `PublicAthletePage.tsx:28-30`.
- **Fix:** a dedicated `useEffect(() => () => { document.title = 'EnduranceBaseClub'; }, [])`
  (unmount-only, separate from the effect that sets the live title, so it doesn't flash on every
  payload update while the page stays open).
- **Tests:** `public.test.tsx:354-364` (PublicEventPage), `public.test.tsx:478-489`
  (PublicAthletePage) — title is the page's own value while mounted, resets on `unmount()`.

### 20. C-Minor-16 — Chart tooltip overflow + partner links

- **Where:** `LineChart.tsx:281-289` (tooltip `left` clamp); `StatsView.tsx:211-229` (partner
  links).
- **Fix:** the tooltip's `left` percentage is clamped to `[8, 92]` (was unclamped, so the last
  point on a 390 px chart could overflow past 97%); the dashed guideline (drawn at the unclamped
  `active.x`) still marks the exact point. `StatsView` shows a public-mode partner's name as plain
  text instead of a link — a finalized snapshot's `members` never carries `public_profile`, so the
  page cannot know which teammates it would be safe to link to; linking unconditionally could
  dead-end on "Atleta não encontrado ou perfil privado" for a private one. This is a scope decision
  (see Concerns) rather than the report's literal "link only to public profiles", since that data
  isn't available to this layer.
- **Tests:** `ui.test.tsx:590-608` (tooltip clamp, via keyboard focus landing on the last point —
  jsdom's zero-size `getBoundingClientRect` makes pointer-based hovering always resolve to index 0,
  so focus is the only way to reach the last point deterministically here);
  `athletes.test.tsx:305-313` (existing test **updated**: it previously asserted a public-mode
  link to `/atleta/a2`, encoding the exact bug being fixed — now asserts plain text, no link).

### 21. C-Minor-17 — pt-BR copy consistency

- **Where:** `BulkEntryDialog.tsx:64` (toast plural); `ImportDialog.tsx:184-186` (preview-line
  plural); `AthleteProfilePage.tsx:38`, `AthletesPage.tsx:84`, `EntriesTab.tsx:174` (toast
  punctuation, drop trailing period); `EntryForm.tsx:347` ("Quem corre" → "Quem faz"); `HelpPage.tsx
  :18-19` ("níveis" moved to the event-creation step); `SettingsPage.tsx:86,148` ("Dono" →
  "Organizadora master"); `ThemeToggle.tsx:16-40` (label as action, drop ambiguous
  `aria-pressed`); `EventGeneralTab.tsx:239-244` ("Endereço público (slug)" → "Endereço público"
  + plain-language hint).
- **Tests:** `entries.test.tsx:394-406` (plural toast); `ui.test.tsx:531-535` (ThemeToggle label);
  no dedicated tests for the other pure-copy edits (verified by reading; none had a test asserting
  the old text, confirmed by grep before each edit).

### 22. C-Minor-18 — E2E: classification order + no PII on public pages

- **Where:** `tests/e2e/03_review_results.sh:48-59` (order), `tests/e2e/04_public_offline.sh:15-38`
  (PII).
- **Fix:** the classification check now asserts Caio ranks *1º* and Duda *2º* specifically (Caio's
  finish mark in `02_timing.sh` is chronologically before Duda's, plus a 4.5 s+ divergence on top —
  so an inverted table is now caught, where before it only checked the pair occupied `{1,2}` in
  some order). The public-athlete and public-results pages now assert their rendered text never
  contains an `@` (e-mail) or Ana's birth year/date ("1990"/"15/06", set in `01_master_setup.sh`).
- **Verification:** syntax-checked with `bash -n` on both files; the Python assertion logic
  (order-check) independently verified against both a correctly- and an incorrectly-ordered input
  list (correct passes, inverted raises `AssertionError`). Confirmed live in the E2E gate: the
  scenario's actual classification row is
  `["1 1 2 Caio Masculino · 30-39 0:38 0:38 Concluiu","2 2 3 Duda Feminino · 20-29 0:40 0:40 +0:02 Concluiu"]`
  — Caio 1º, Duda 2º, exactly as asserted — and the Ruling-24 number-format check (now scoped to
  `Class*` sheets per Fixer 1's rename) printed `number formats OK {'hh:mm:ss.0': 7,
  '[h]:mm:ss.0': 19}`.
- **RED/GREEN on the PII check:** the first E2E run caught a real bug in the new check itself —
  the public-results assertion was placed *after* the SPA had already navigated to the athlete
  page, so `[data-testid=public-results]` no longer existed
  (`TypeError: Cannot read properties of null (reading 'innerText')`, surfaced as a
  `JSONDecodeError` through `js_str`'s own parsing of the eval tool's error text). Fixed by moving
  the public-results check to right after its own `snap` (before navigating away) and wrapping
  both DOM reads in a defensive IIFE (`el ? el.innerText : ''`, plus a `assert text` non-empty
  guard) matching the rest of the suite's defensive JS style. See the E2E gate below for the
  passing re-run.
- **Deferred (explicitly out of this wave, per final-fix-wave.md):** a 390 px pass over
  RaceEditor/EntryForm/Atletas.

### 23. C-Minor-19 — theme-color follows the active theme

- **Where:** `index.html:11-19` (bootstrap script sets it before first paint, matching the
  `#/c/` = light-by-default rule); `ThemeToggle.tsx:8-9,16-19,29-32` (kept in sync on toggle).
- **Fix:** both places map `theme → '#F4F1EC' (light) / '#191513' (dark)` and
  `setAttribute('content', ...)` on `meta[name="theme-color"]`.
- **Guard added mid-wave:** the inline bootstrap script's line was made defensive
  (`var el = document.querySelector(...); if (el) el.setAttribute(...)`) after the full suite
  showed Fixer 2's `timekeeper.test.tsx` (`index.html theme bootstrap (Ruling 21)`) evaluates the
  script against a minimal document with no `<head>` meta tags — the unguarded `.setAttribute`
  call on `null` broke two of its tests. This is a one-line, purely-defensive change to a file
  Fixer 3 owns (`index.html`); no test file outside this wave's ownership was touched.
- **Tests:** `ui.test.tsx:514-529` (ThemeToggle keeps the meta tag in sync on two toggles).
- **Deferred (per final-fix-wave.md):** 512 px/maskable icons.

### 24. C-Minor-20 — package.json hygiene

- **Where:** `package.json`.
- **Fix:** dropped `description`, `directories`, `keywords`, `author` (npm-init boilerplate);
  `license` → `"UNLICENSED"` (`private: true` already blocks publishing).

---

## Gates (WSL, ff3)

Ambient note: another fixer's session was running heavy parallel `vitest`/`build` work on the same
WSL VM for part of this session, causing intermittent `[vitest-pool]: Failed to start forks
worker … Timeout waiting for worker to respond` infrastructure errors (not real test failures) on
the first attempt of a couple of full runs; re-running immediately resolved them, and no such
error ever pointed at a file this wave touched.

### `npm run typecheck`
Clean (no output) on every run throughout the wave, including the final one.

### `npx vitest run` (full suite)
First full run after item 23's guard fix: **1 file / 2 tests failed** —
`src/features/timekeeper/timekeeper.test.tsx` › `index.html theme bootstrap (Ruling 21)` › both
cases, `TypeError: Cannot read properties of null (reading 'setAttribute')` — a real regression
from the C-Minor-19 change (see item 23), fixed with the defensive null-check (commit `cab3788`).

After the guard fix (commit `cab3788`), a clean full run: **Test Files 40 passed (40) · Tests 664
passed (664)**, duration 213.78s. (Two earlier full-run attempts in this session hit
`[vitest-pool]: Failed to start forks worker … Timeout waiting for worker to respond` for 5-7
files — confirmed to be WSL resource contention from a concurrent fixer session running its own
parallel `vitest`/`build`, not real failures: every one of those files passed cleanly when re-run
individually, and the file list of "missing" files changed between attempts with no relation to
this wave's changes.) The pre-existing "not configured to support act(...)" stderr lines in
`ui.test.tsx` (4 tests: `useToast`, `LineChart responsive geometry` ×2, `useNow`) are unrelated to
this wave — present before any of this wave's edits — and every test still passes.

### `npm run build`
Succeeds: `vite build` — 298 modules transformed, all chunks built (largest entry chunk
`index-o3JB16vQ.js` 483 kB / 137.8 kB gzip), `vite-plugin-pwa` (generateSW) precaches 48 entries
(893.6 KiB), `dist/sw.js` and the workbox runtime generated. No errors or warnings besides the
plugin's own build-timing notice.

### `bash tests/e2e/run.sh`
**First attempt: FAIL in `04_public_offline`** — the newly-added PII check itself had a bug (see
item 22's RED/GREEN note): the public-results assertion ran after the SPA had navigated to the
athlete page, so its target element was gone (`TypeError: Cannot read properties of null`).
Fixed by reordering the check to run before navigating away, and making both DOM reads defensive
(IIFE + null fallback). Every other scenario step in that first run passed, including the
classification-order and Ruling-24 checks.

**Re-run: `E2E PASS`.** Full transcript of the passing run (`tests/e2e/artifacts/`):
```
--- database ebc_e2e
--- shim :54321
--- build (mode e2e) + preview :4173
=== 01_master_setup  (login/forced password change, event, provas, atletas, inscrições)
=== 02_timing        (waves, relay handoff, offline sync, arrival tap, divergence, themes)
=== 03_review_results
classification: ["1 1 2 Caio Masculino · 30-39 0:38 0:38 Concluiu","2 2 3 Duda Feminino · 20-29 0:40 0:40 +0:02 Concluiu"]
number formats OK {'hh:mm:ss.0': 7, '[h]:mm:ss.0': 19}
=== 04_public_offline
--- public results
--- public results page never leaks e-mail, phone or birth date (C-Minor-18)
--- public athlete page
--- public athlete page never leaks e-mail, phone or birth date (C-Minor-18)
--- public pages at 390×844
--- timekeeper reloads the link offline (service worker)
E2E PASS
```
Screenshots for the layout items (390×844 and 1280×800) reviewed in `tests/e2e/artifacts/`:
`01-*.png` (desktop admin flows), `02-tk-*.png` (390×844 timekeeper, light/dark), `03-mobile-
*.png` (390×844 cronometragem/revisão/resultados/events), `03-results-5k.png`/`03-results-
official.png` (1280×800), `04-public-results-mobile-*.png`, `04-public-home-mobile.png`. All show
the expected content with no visual regressions from this wave's changes (tab-strip fade/scroll,
WCAG-tinted status text, error banners) — nothing in the diff changes layout structure enough to
require new baseline shots beyond what the suite already captures.

---

## Commits (fix/final-3, `3911614..7642e31`)

1. `3911614` fix: PWA update never reloads timekeeper tab; modal stack for nested dialogs (items 1, 2)
2. `3ed537d` fix: RaceEditor guards, athlete-picker loading states, WCAG-AA status text (items 3, 4, 5, 6, 15)
3. `cef430b` fix: event date validation, delete cache invalidation, unsaved-edit guard (items 7, 10 (EventGeneralTab part), 17, 21)
4. `eac7b55` fix: import shortcut preselects event, honest deletion copy, Categoria dims (items 8, 9, 14, plus RaceEditor/server-message consistency)
5. `baf2310` fix: pt-BR router error screen; remember timekeeper link for "#/" (items 11, 13)
6. `d29fba3` fix: tab-strip affordance at 390px, public page recovery and freshness (items 12, 18-part(retry/refetch), 19-numbering-note)
7. `d7e7b83` fix: chart tooltip stays inside 390px, no dead-end partner links, title reset (items 19(title), 20)
8. `2b65488` fix: deploy hygiene (npm ci, immutable assets, security headers), theme-color (items 16, 23-part, 21-part(ThemeToggle))
9. `1f2f38f` fix: pt-BR copy consistency (C-Minor-17 remainder) (item 21 remainder)
10. `14b6423` fix: E2E asserts classification order and public PII absence; missed modal (item 22, plus a missed `closeOnBackdrop` wiring for item 10)
11. `cab3788` fix: guard theme-color bootstrap against a missing meta tag (item 23 follow-up, fixes a cross-fixer test regression)
12. `7642e31` fix: E2E PII check ran against the wrong (already-navigated-away) page (item 22 follow-up, found by the first E2E gate run)

(Numbering above is approximate per-commit grouping; several items' work landed together where the
same files were touched — see each item's own "Where"/"Fix" for the authoritative file:line list.)

---

## Concerns

1. **C-Minor-11 (WCAG contrast) is only fully swept in files this wave owns.** Fixer 2's
   timing/review/results screens also use `text-danger`/`text-warning` directly on plain
   backgrounds (e.g. `LiveBoard.tsx`, `WavesPanel.tsx`, `CrossingEditor.tsx`, `ResultsTab.tsx`,
   `ReviewTab.tsx`) and were not touched (out of ownership). The new `-text` tokens
   (`text-danger-text`/`text-warning-text`/`text-info-text` in `src/index.css`) are available for
   Fixer 2 to adopt in the same way if wanted; `Badge`/`Field` (shared kit) already benefit
   everywhere without any change needed on their side.
2. **C-Minor-16 partner links:** implemented as "no link in public mode" rather than the report's
   literal "link only to public profiles", because a finalized snapshot's `members` never carries
   `public_profile` (owned by domain/B1) — this layer has no way to know which partners are safe to
   link. If a future pass adds that field to the snapshot, `StatsView.tsx:211-229` is the one spot
   to change back to a conditional link.
3. ~~C-Minor-18 E2E changes are unexecuted pending the E2E gate~~ — resolved: the E2E gate below
   caught a real ordering bug in the new PII check on its first run (fixed in commit `7642e31`),
   and the re-run ends `E2E PASS` with the classification-order and PII assertions all green.
4. `EventGeneralTab.tsx`/`RaceEditor.tsx`'s `useBlocker`-based navigation guard only intercepts
   actual React Router navigations (tab clicks, browser back) and the explicit "Cancelar" button —
   it does not intercept a hard reload/tab-close. That's a `beforeunload` concern the report didn't
   ask for and was left out to keep the change scoped; browsers' own "leave site?" prompt would
   need a separate `window.onbeforeunload` listener if wanted later.

## Fix round 2

Ruling 61: the scoped re-review of `6244b7e..7642e31` verdicted 18 items ADDRESSED, no
Critical/Important, but flagged items 9, 12, 18, 20, 22, 1 (test title) as NOT ADDRESSED, plus four
new Minors (N1-N4) and a Badge success-tone contrast gap. First step: merged `feat/ebc-app`
(Fixers 1 and 2, now on that branch) into `fix/final-3` so this round's E2E and test-sql run
against the combined code.

### Merge

`git merge feat/ebc-app --no-edit` — clean, no conflicts requiring manual resolution beyond what
git's `ort` strategy auto-merged (`EventLayout.tsx`, `PublicEventPage.tsx`, as the controller's
dry-run had predicted). `package-lock.json`/`package.json` unchanged by the merge, so `npm ci` was
not re-run (per the instructions, only needed if the lockfile changed). Merge commit: `1c0edd5`.

### Items

**1 — UpdatePrompt.test.tsx:41, contradictory test title**
- Where: `src/components/UpdatePrompt.test.tsx:41-47`.
- The test asserted the component **throws** when rendered outside a `ToastProvider`, but was
  titled "ignores the event ... (nothing to crash)" — the opposite of what it checks.
- Fix: retitled to `'throws immediately when rendered without a ToastProvider, instead of
  silently doing nothing'`; behaviour/assertions unchanged.
- Test: the same test, now correctly named.

**9 — RacesTab.tsx:39, race-deletion confirm omits finalized results**
- Where: `src/features/races/RacesTab.tsx:37-40`.
- Fix: confirm message now also says "se a prova estiver finalizada, os resultados são apagados e
  somem do histórico e das estatísticas dos atletas."
- Test: `src/features/races/races.test.tsx` (new, after "does nothing when cancelled") — asserts
  the dialog contains "resultados são apagados" and "histórico e das estatísticas dos atletas".
  GREEN on first run (pure copy addition).

**12 — PublicEventPage.tsx:343, public race tabs off-screen at 390 px**
- Where: `src/features/public/PublicEventPage.tsx:8-17` (import), `213-247` (render).
- Round 1's scroll-into-view + fade cue still left a second (inactive) race entirely off-screen on
  load, per the reviewer's screenshot. Fix: below `sm`, the tablist is replaced outright by a kit
  `<Select data-testid="public-race-select">` listing every race as a plain `<option>` — a
  `<select>` cannot overflow regardless of race count. `sm:` and up keep the tablist (room to see
  every tab there).
- Test: `src/features/public/public.test.tsx` (new, after the C-Minor-8 scroll test) — asserts the
  select lists both race names in order, starts on the active race, and switching it via
  `selectOptions` renders the other race's heading.
- Confirmed visually in the E2E gate: `tests/e2e/artifacts/04-public-results-mobile-1.png` shows
  the "Prova" select (not a cut-off tab) at 390×844.

**18 — PublicHome.tsx:99-103, load error has no retry**
- Where: `src/features/public/PublicHome.tsx:10,68,99-108`.
- Fix: destructured `refetch`/`isFetching` from the `useQuery`; added a "Tentar novamente" button
  next to the error message.
- Test: `src/features/public/public.test.tsx` (new, after the empty-state test) — RED first run
  expected the `ApiError`-branch text ("Falha de rede") but the mocked rejection was a plain
  `Error`, which the component correctly renders as the generic fallback — adjusted the test's
  expectation to match the component's actual (correct) behaviour; GREEN after.

**20 — LineChart.tsx:289, centred tooltip still overflows at 390 px**
- Where: `src/components/LineChart.tsx:1,29,58-70` (measurement), `182-192` (clamp), `280-291`
  (render, ref, style, dropped `-translate-x-1/2`).
- Round 1's percentage clamp (`8%-92%`) didn't know the tooltip's actual rendered width — a
  ~140-200 px label centred near an edge still overflowed. Fix: the tooltip's own `offsetWidth` is
  measured via a ref + `useLayoutEffect` (keyed on `activeIndex`, so it re-measures per point,
  before paint — no visible jump), and `left` is now computed in **pixels** as
  `clamp(active.x - width/2, TOOLTIP_EDGE_PAD, measuredWidth - width - TOOLTIP_EDGE_PAD)`, replacing
  the percentage-based centring entirely (the `-translate-x-1/2` transform is removed since `left`
  is now already the clamped left edge).
- Test: `src/components/ui/ui.test.tsx` (replaces the old C-Minor-16 test) — mocks
  `HTMLElement.prototype.offsetWidth` to a realistic 180 px (jsdom never lays out real geometry),
  then asserts `0 <= left` and `left + 180 <= 640` (the jsdom fallback chart width) at both the
  first point (left edge, reached via two `ArrowLeft`s) and the last point (right edge, the
  keyboard-focus default). Passed on first run with the new implementation.

**22 — E2E PII check can never fail**
- Where: `tests/e2e/01_master_setup.sh:74-91` (Ana gets a real e-mail/phone, `data-testid`
  parameters added to `new_athlete`, `save_state`); `tests/e2e/04_public_offline.sh:15-72`
  (rewritten PII section); `src/features/athletes/AthleteForm.tsx:114-115` (`data-testid`
  `athlete-email`/`athlete-phone`, no behaviour change).
- Round 1's checks only asserted "no `@` visible" / "no birth year visible" — passable even if the
  server never omitted anything at all, since no athlete had an e-mail to begin with. Fix: Ana now
  gets `ana.e2e@example.test` / `27999990000` at creation; both the rendered-page checks (results
  and athlete page `innerText`) and two **new** raw-payload checks assert the exact strings are
  absent. The payload checks `curl` the shim's `pub_event`/`pub_athlete` RPC endpoints directly
  (`http://127.0.0.1:$SHIM_PORT/rest/v1/rpc/<fn>`, no `Authorization` header — the shim resolves
  that to the `anon` role, the same one the page itself uses) and assert on the raw JSON text, plus
  that no `birth_date` key is present at all. `pub_event`'s response is also parsed to find Ana's
  id (matched by name) for the follow-up `pub_athlete` call, replacing the need for a
  browser-derived id.
- Verification: `bash -n` on both shell scripts; confirmed live end-to-end in the E2E gate —
  `04_public_offline` now logs both new PII steps and the run ends `E2E PASS`.

**N1 — EventGeneralTab.tsx, delete-while-dirty pops a spurious "unsaved changes" prompt**
- Where: `src/features/events/EventGeneralTab.tsx:3` (import `flushSync`), `159-165`.
- A dirty form's successful delete called `navigate('/eventos')` while `dirty` was still `true`,
  so `useBlocker(dirty)` intercepted that very navigation.
- Fix attempt 1 (plain `setDirty(false)` before `navigate()`): **RED** — the new test still hung on
  the form instead of reaching "Lista de eventos", because react-router's blocker reads `dirty`
  synchronously at the moment `navigate()` runs, before React's async state update would have
  re-rendered it. Fix attempt 2: `flushSync(() => setDirty(false))` before `navigate()`, forcing
  the state update (and the blocker's re-registration) to commit first. **GREEN**.
- Test: `src/features/events/events.test.tsx` (new, before the C-Minor-13 test) — types into
  `event-name` (making the form dirty) before deleting; asserts the router ends on `/eventos` and
  no dialog (besides the delete confirm itself, already closed) is left open.

**N2 — RaceEditor.tsx:181-199, a locked wave should not be removable at all**
- Where: `src/features/races/RaceEditor.tsx:14` (import `RaceFormWave`), `181-187`
  (`waveEntryCount` helper, simplified `removeWave`), `253-284` (render: `locked`/`onlyWave`,
  `disabled`, reason text).
- Round 1 let the organizer confirm-and-remove a wave with a start/entries, deferring the
  inevitable server refusal to Salvar. Fix: "Remover" is now `disabled` outright for such a wave
  (`disabled={onlyWave || locked}`), with a small reason line underneath
  (`data-testid="wave-remove-reason-{i}"`: "Já largou", "Tem N inscrições", or both). `removeWave`
  itself is back to a plain synchronous filter — the confirm dialog is gone, since removal is
  prevented at the source instead of asked-and-undone.
- Test: `src/features/races/races.test.tsx` — the old "C-I3" describe block (three tests keyed to
  the round-1 confirm flow) rewritten to assert `toBeDisabled()` + the reason text for a
  started/entries-having wave, and that a plain wave still removes immediately with no dialog.

**N3 — UpdatePrompt: toast should not follow the volunteer into `#/c/`**
- Where: `src/components/UpdatePrompt.tsx:1,64-92`.
- The toast is mounted once at the app root (outside the router), so it survives an in-app
  navigation on its own — including "Voltar à cronometragem" (C-Minor-7) carrying it from `#/`
  into the timekeeper route, where Ruling 26 says it must never appear (it can sit over the "Em
  prova" rows and swallow a tap).
- Fix: captures the toast's id from `toast.show(...)`; a new `hashchange` listener dismisses it via
  `toast.dismiss(id)` the moment `!shouldPromptForUpdate(location.hash)`.
- Test: `src/components/UpdatePrompt.test.tsx` (two new cases) — a toast shown, then a
  `hashchange` to `#/c/abc123`, dismisses it; a `hashchange` to `#/eventos` leaves it alone. Both
  GREEN on first run.

**N4 — TimekeeperPage.tsx runtime theme switch doesn't sync theme-color (grant)**
- Where: `src/features/timekeeper/TimekeeperPage.tsx:33-52` (`useLightThemeByDefault`).
- index.html's bootstrap script only runs on a full page load, so an in-app navigation into
  `#/c/:token` left the `theme-color` meta on whatever colour the previous screen had, even though
  `data-theme` itself switched to light.
- Fix: the same effect that flips `data-theme` now also calls
  `document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ...)` with the
  matching colour (`#F4F1EC` light / `#191513` dark, same values as index.html/ThemeToggle).
- Per the grant's scope ("one small hunk" in this Fixer-2-owned file), no test was added to the
  Fixer-2-owned `timekeeper.test.tsx`; ran its existing 87 tests as a regression check (all still
  pass) and rely on the E2E's "themes: light (default) and dark" step (`02_timing.sh`) for
  end-to-end coverage of this screen's theme behaviour.

**Badge success-tone AA contrast**
- Where: `src/index.css:29-31` (new `--color-success-text`), `src/components/ui/Badge.tsx:13-19`.
- The plain `--color-success` swatch is ≈4.6:1 on dark theme's `--bg` (passes) but only ≈3.5:1 on
  light theme's brighter paper (fails). Fix: same `color-mix(... 70%, var(--fg) 30%)` derivation as
  C-Minor-11's danger/warning/info, computed by hand to confirm ≈5.6:1 (light) / ≈6.9:1 (dark)
  before implementing.
- No dedicated new test (a static CSS/class-mapping change, like the rest of C-Minor-11); confirmed
  no existing test asserts the old `text-success` class name (grepped first), and the full suite
  still passes.

### Gates (WSL, ff3, after the merge)

- `npm run typecheck` — clean.
- `npx vitest run` — **758/758 tests, 41/41 files** (up from 664/40 pre-merge: Fixers 1/2 brought
  their own suites in). No failures at any point in round 2's development.
- `npm run build` — succeeds: 301 modules transformed, `vite-plugin-pwa` precaches 50 entries
  (911.1 KiB), `dist/sw.js`/workbox runtime generated.
- `bash tests/e2e/run.sh` — **E2E PASS**, all four scenarios, including both new item-22 PII
  payload checks and the round-1 classification-order/PII checks. Screenshots reviewed:
  `04-public-results-mobile-1.png` shows the new "Prova" select instead of a cut-off tab (item 12).
- `EBC_DB=ebc_ff3 bash scripts/test-sql.sh` — all 7 files PASS
  (`00_helpers`, `10_schema`, `20_admin_events`, `30_admin_athletes_entries`, `40_timing`,
  `50_public`, `60_security`) — run against the merged `feat/ebc-app` SQL (Fixer 1's migrations),
  confirming this branch's combined server-side state is sound.

### Round 2 commits

- `1c0edd5` — merge: `feat/ebc-app` into `fix/final-3` (Fixers 1 and 2).
- `5b99ea7` — fix: round 2 items 1, 9, 12, 18, 20, 22, N1, N2.
- `0d8969f` — fix: round 2 items N3, N4, Badge success-tone AA contrast.

### Round 2 concerns

None new. The round-1 concerns above still stand as written (WCAG sweep scope, StatsView partner
links, no `beforeunload`); N1's `flushSync` fix is a small, localized use of an escape hatch React
generally discourages, justified here because `useBlocker`'s check genuinely happens synchronously
outside React's own render cycle — noting it in case a future refactor of the delete flow forgets
why it's there.
