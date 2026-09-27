# Final review — area C (organizer/public UI, UI kit, app shell, build/deploy, E2E)

Range e98799a..9cf9614. The checkout HEAD b8debec differs from 9cf9614 only in two ledger files. Reviewer: final whole-branch pass, area C. I read every area-C source file in the checkout (all of them are new in the range), plus the interfaces they consume: useEventData, session, api error mapping, ClassificationTable linking, and the 0003 SQL for save_race/delete paths. I also reviewed the E2E scripts and screenshots from the last green run (01-entries, 01-entry-form, 01-general, 02-tk-assign-toast, 03-athlete-ana, 03-mobile-events/-cronometragem-1/-resultados-1, 04-public-results-mobile-1), plus vite-plugin-pwa 1.3.0 and workbox-window 7.4 in node_modules.

Beyond reading, I ran one extra verification: a scratch Vitest probe (in my scratchpad, against the real `src/components/ui/Modal.tsx`, jsdom) for Important 2.

## Strengths

- **Route-level code splitting (Ruling 30).** Every page is `React.lazy`, and each route element has its own Suspense with the kit Spinner. The entry chunk holds only the shell (Layout, RequireOrganizer, session, kit, api), and the route table stayed stable.
- **PWA foundation.** It uses `registerType: 'prompt'`, with no skipWaiting/clientsClaim and `injectRegister: null`. The `#/c/` no-prompt guard is a pure, tested predicate (`shouldPromptForUpdate`). `/sw.js`, `/manifest.webmanifest` and `/index.html` are served no-cache, and precache plus `navigateFallback` lets the timekeeper link open offline (proven by E2E 04).
- **Theme bootstrap in `index.html`.** It sets the theme before paint (no flash), follows Ruling 21 (`#/c/` opens light), and survives blocked storage.
- **Ruling 40 is honoured on every agg-bound form in area C.**
  - EventGeneralTab has a dirty guard, a "mudaram em outro lugar… Recarregar" banner, and does not warn when its own save lands (tested).
  - RaceEditor, EntryForm and EntryStatusModal are seeded once and never re-read `agg`, so a refetch can never overwrite typing.
- **Destructive actions go through `useConfirm` with the danger styling:** events (list and Geral), races, entries, athletes (list and profile), organizers. Removing yourself as an organizer is prevented.
- **Errors and states.** ApiError's pt-BR messages reach toasts or banners on every mutation. EventLayout has a LoadError with "Tentar novamente". Pages have loading and empty states.
- **Consistent UI kit.**
  - Touch targets are ≥ 44 px (`min-h-11`) with focus-visible outlines.
  - Every field is labelled, and error or hint text is linked through `aria-describedby`/`aria-invalid`.
  - Modals have `aria-modal`/`aria-labelledby`, and focus is restored on close.
  - Toast tones are now opaque, which closes the T22 concern.
  - Numbers use tabular figures.
  - The MemberPicker combobox follows ARIA practice.
- **Public pages** consume only the public payload.
  - Athlete links are gated on `public_profile`.
  - Finalized races render from the frozen snapshots, with the §9 podium order.
  - Live data polls every 10 s with a visibility pause.
  - PublicAthletePage never reads `birth_date`/`public_profile` (the T7 note).
- **Build hygiene.**
  - package.json pins exact versions, and the deps vs devDeps split is correct: vite-plugin-pwa, vitest and pg are dev-only, and workbox-window is bundled.
  - `.env.production` carries only public values.
  - HashRouter needs no Vercel rewrites, and no base path is needed.
- **The E2E suite plays a real event day.**
  - Forced password change and presets.
  - A relay handoff, marks taken offline, an arrival tap, and a divergence resolved with a chosen mark.
  - openpyxl number formats (Ruling 24).
  - Checks that the page never scrolls sideways at 390 px, and that the bib field keeps focus after MARCAR and after an "Em prova" tap.
  - The Web Lock second-tab message, and an offline reload served by the service worker.

## Issues

### Critical

None.

### Important

**1. The timekeeper tab still reloads when another tab of the same device accepts the update (Ruling 26 is defeated) — `src/main.tsx:17-25`**

- **What happens.** In prompt mode, vite-plugin-pwa 1.3.0 calls `showSkipWaitingPrompt()` in every tab once a new service worker is waiting. That includes `#/c/` tabs: `register.js` fires it on both 'installed'(isExternal) and 'waiting'.
- **Why.** Before calling `onNeedRefresh`, the plugin registers `wb.addEventListener('controlling', e => { if (e.isUpdate) onNeedReload ? onNeedReload() : window.location.reload() })`. main.tsx's early return only suppresses the toast. It passes no `onNeedReload`, so the reload listener is live in the timekeeper tab.
- **Trigger.** Any other tab of the same origin on that device taps "Atualizar" (`updateSW(true)` → SKIP_WAITING). The new worker activates, and every controlled client receives `controllerchange`. workbox-window then dispatches 'controlling' with `isUpdate: true` (the page was controlled at registration), and the timekeeper page reloads.
- **Scenarios.**
  - A volunteer following `#/p/<slug>` in a second tab on the timing phone. The public page does prompt.
  - The organizer timing on their own phone while the admin panel is open in another tab.
- **Cost.** A MARCAR tap or a half-typed bib during the reload is lost. This is the exact hazard Ruling 26 exists for. No test covers this path.
- **Fix.**
  - Pass `onNeedReload() { if (shouldPromptForUpdate(location.hash)) location.reload(); }` to `registerSW`.
  - Extract the `registerSW` options into a small tested builder, with a unit test asserting no reload on `#/c/`.
  - Fold in the deferred T27 de-dup: onNeedRefresh fires twice for a tab open more than 60 s, so the organizer sees two identical toasts. Also fold in the contradictory test title.

**2. Nested dialogs: Escape closes both, and Tab escapes the top dialog — `src/components/ui/Modal.tsx:37-68` (the nesting is at `src/features/entries/EntryForm.tsx:391-395` inside `EntriesTab.tsx:266`)**

- **Cause.** Every open Modal adds its own `document` keydown listener. The only nested dialog in the app is "+ Novo atleta" (spec §12, "criar atleta na hora") inside "Nova/Editar inscrição".
- **Escape.** Both listeners run. The outer `onClose` unmounts EntryForm, so the team name, members and leg assignments typed so far are lost, together with the new athlete's fields.
- **Tab.** The two focus traps fight each other, and focus ends up on the first or last control of whichever dialog registered last. Which dialog wins flips whenever EntriesTab re-renders, including the 10 s `nowMs` tick, which re-subscribes the outer listener. Either way, Tab never moves between the nested form's fields.
- **Probe result** (outer and inner Modal, focus in "Nome" of the inner dialog):
  - after Escape: 0 dialogs open, outer form gone;
  - Tab: `BUTTON[Fechar] in outer`, and again `Fechar in outer`, i.e. behind the visible dialog;
  - Shift+Tab: `+ Novo atleta in outer`.
- **Fix.** Keep a module-level stack of open modals and have the keydown handler act only when its modal is on top. This also removes the `stopImmediatePropagation` coupling in EntryForm's combobox (the deferred T21 minor). Add a nested-modal test for Escape and Tab.

**3. Removing a wave in the race editor silently deletes its recorded start and re-times its entries — `src/features/races/RaceEditor.tsx:156-176`, `raceForm.ts:157-161`, and server `0003_admin_events.sql:597`**

- **What happens.** "Remover" is enabled for any wave but the last, with no confirmation. That includes a wave the row itself shows as "Largou às 08:05:00.0", and a wave that has entries.
- **On save.** The payload omits the wave, and `admin_save_race` deletes waves missing from the list. The recorded `start_at` is gone; it can only be re-typed if someone remembers it. The wave's entries get `wave_id` set to null, and `entryWave` moves them to the race's first wave. Every leg-1 time, total and position for those entries changes without any message.
- **Staleness makes it worse.** The editor's waves are a snapshot from when "Editar" was clicked, so a wave started meanwhile still reads "Sem largada".
- **Rulings.** This is the destructive-action class Rulings 12 and 16 closed for `start_at` updates; the delete path was left open.
- **Fix.**
  - UI: confirm, or refuse, removing a wave that has `start_at` or entries, naming the consequence and the entry count.
  - Better, server side (area A): `admin_save_race` should refuse deleting such a wave with a P0001 message.

**4. Save errors render off-screen above long forms — `RaceEditor.tsx:127-137`, `EntryForm.tsx:285-295`**

- **What happens.** Validation and server errors appear in a banner at the top of the form, but "Salvar" sits at the bottom.
  - RaceEditor is a long page with six sections.
  - EntryForm for a team race scrolls inside the `max-h-[85vh]` modal body, as in the E2E screenshot.
- **Result.** After a failed save nothing changes near the button: no toast, no scroll, no focus. Examples:
  - "Não é possível alterar pernas ou tamanho da equipe depois que há marcações";
  - "A janela de mesma passagem deve ser entre 1 e 600 segundos";
  - "Distância inválida na perna 2".
  The organizer sees an apparent no-op. The tests only assert that the banner exists.
- **Fix.** On failure, `scrollIntoView` the banner and move focus to it (with `tabIndex=-1`), or also raise a danger toast. Apply the same pattern in both forms.

### Minor

1. **Athlete lists show "no athletes" while loading or after a failure.** `EntryForm.tsx:230-231,183`; `BulkEntryDialog.tsx:29-30,119-120`. A slow (up to 15 s) or failed `listAthletes()` shows "Nenhum atleta encontrado/disponível", and the error is never shown. On a race-morning 4G connection this invites duplicate athletes via "+ Novo atleta", which splits their stats. Show a spinner or error. This is the deferred T21 minor, promoted.
2. **Empty event date gives a raw English error.**
   - Where: `EventsPage.tsx:184-200,277-288`; `EventGeneralTab.tsx:84-98`.
   - `noValidate` removes the native `required` check, and nothing checks the date on the client. An empty date reaches `(p_event->>'date')::date` (0003:277) or PostgREST's `p_date` cast.
   - The organizer sees raw English "invalid input syntax for type date".
   - Fix: add a client check ("Informe a data do evento"); area A could also use `nullif` before the cast.
3. **Import from Inscrições doesn't enrol anyone by default.**
   - Where: `EntriesTab.tsx:204` → `ImportDialog.tsx:55`.
   - The Ruling 51 shortcut arrives with the event select on "Nenhum — só cadastrar atletas". The Prova column is then ignored ("0 inscrições"), contrary to the hint next to the shortcut.
   - Fix: pass `?import=1&evento=<id>` and preselect the event. Also reword the select label "Inscrever na prova da coluna Prova do evento".
4. **Deletion copy is inaccurate or incomplete.**
   - `RacesTab.tsx:37` says the race's marks are removed. They are kept, unassigned (FK set null), and resurface as "sem atleta" issues.
   - Event/race deletion (`EventGeneralTab.tsx:115`, `EventsPage.tsx:43`) also erases finalized results, i.e. athlete histories and stats, without saying so.
   - Entry deletion (`EntriesTab.tsx:153`) doesn't say its marks become "sem atleta".
5. **Changing legs or team size after inscriptions leaves entries inconsistent.**
   - Where: `RaceEditor.tsx:77-93`, `LegsEditor.tsx:42-45,125`.
   - This applies when entries exist but no marks (the server only locks once marks exist):
     - individual entries keep their old `legs` array, so an added leg has no athlete (`legAthleteId` → null, per-leg stats lost);
     - team entries end up short of members.
   - The only warning covers the podium/age-group reset.
   - Fix: warn with the entry count; area A could re-sync individual members' legs.
6. **Unsaved work is silently lost.**
   - Leaving RaceEditor or EventGeneralTab by tab or nav discards the edits.
   - A stray backdrop click closes the xl EntryForm modal (`Modal.tsx:96`) and discards it too.
   - Fix: use react-router `useBlocker` or a confirm when dirty, and don't close form modals on backdrop click.
7. **Home-screen icon loses the timekeeper link.** `vite.config.ts:24` has `start_url: '/'`. A volunteer who adds `#/c/<token>` to the home screen gets an icon that opens the public home, and offline that is an error, not the timing screen. Fix: remember the last timekeeper link and offer "Voltar à cronometragem" on `#/` (at least in standalone display-mode).
8. **Tab strips hide tabs at 390 px.**
   - Where: `PublicEventPage.tsx:307-322`, `Tabs.tsx:17`.
   - Public page: in the E2E screenshot the second race tab is completely off-screen, with no affordance (mobile scrollbars are hidden at rest).
   - Admin event tabs: "Revisão" (with its pending badge) and "Resultados" are hidden, and the active tab is never scrolled into view.
   - Fix: wrap or use a select on phones, and scroll the active tab into view.
9. **No pt-BR error screen.**
   - Where: `App.tsx:74` — no `errorElement` anywhere.
   - A render error, or a lazy chunk failing to load (first visit before the service worker installed, then offline), shows React Router's default English "Unexpected Application Error!".
   - Fix: add a pt-BR error element with "Recarregar".
10. **"Categoria" column shows dimensions that don't apply.**
    - Where: `EntriesTab.tsx:238`.
    - It always renders sex, age and level. The result is "Misto · Sem faixa · Sem nível" on team races (no age groups by default) and "Sem nível" in events without levels.
    - Fix: show only the applicable dimensions.
11. **Status text colours fail WCAG AA contrast.**
    - Dark theme: `text-danger` #C2413B on ink is about 3.5:1 (about 3.2:1 on surface); `text-info` #5B7C99 is about 4.1:1.
    - Light theme: `text-warning` #C8922E on paper is about 2.4:1, which affects the Ruling 40 banner at `EventGeneralTab.tsx:141`.
    - All are below 4.5:1 for the 14 px `role=alert` errors.
    - Fix: use a brand-derived text tint (color-mix with paper or ink).
12. **Deploy config.**
    - `vercel.json:3`, together with the T29 file list: `npm install` without uploading `package-lock.json` lets transitive dependencies float at deploy time. Upload the lockfile and use `npm ci`.
    - Add `"engines": {"node": "22.x"}`.
    - Add `Cache-Control: public, max-age=31536000, immutable` for `/assets/(.*)`.
    - Add basic security headers: nosniff, `frame-ancestors`/X-Frame-Options, Referrer-Policy.
13. **A deleted event can reappear briefly.** `EventGeneralTab.tsx:122-124` navigates to `/eventos` without invalidating `['events']` or removing `['event', id]`. The deleted event can flash in the list and be opened, giving "Não foi possível carregar o evento".
14. **Public pages don't recover or save bandwidth well.**
    - Load errors have no retry button (`PublicEventPage.tsx:262-276`, `PublicHome.tsx:74-78`).
    - `refetchOnWindowFocus` re-downloads the full `pub_event` payload every time a spectator returns to the tab, although the delta poll already resumes on visibility.
    - `pub_live` failures (for example, an event made private) are silent.
15. **Page title is never reset.** `document.title` set by the public pages (`PublicHome.tsx:52`, `PublicEventPage.tsx:224`, `PublicAthletePage.tsx:24`) persists, so an admin tab reached from a public page keeps "… – Resultados".
16. **Chart tooltip and partner links.**
    - `LineChart.tsx:281-286`: the tooltip centred on the last point overflows the right edge at 390 px.
    - `StatsView.tsx:85`: in public mode, partner links point to profiles that may be private, so they dead-end.
17. **pt-BR copy consistency.**
    - Awkward "(s)" plurals: "inscrição(ões) criada(s)" (`BulkEntryDialog.tsx:64`) and "atleta(s) válido(s)…" (`ImportDialog.tsx:184`).
    - Toast punctuation is mixed ("Evento salvo" vs "Inscrição excluída.").
    - "Dono" (`SettingsPage.tsx:86,148`) vs "organizadora master" (RequireOrganizer, Help).
    - "Quem corre cada perna" is used even for swim and bike legs (`EntryForm.tsx:330`).
    - `HelpPage.tsx:19` places "níveis" under provas; they live on Geral.
    - ThemeToggle's label names the current mode ("Modo noite" while dark) and also sets `aria-pressed`, which reads ambiguously as an action (`ThemeToggle.tsx:31-35`).
    - "Endereço público (slug)" uses jargon.
18. **E2E gaps against its claims.**
    - Classification order is not asserted: `03_review_results.sh:50-55` only checks that the positions are {1, 2}, so an inverted order passes.
    - Athlete stats are checked by tile labels only (03:121-122, 04:18).
    - No check that public pages omit e-mail, phone or birth date.
    - No 390 px pass over RaceEditor, EntryForm or Atletas.
    - Nothing exercises the update prompt or Ruling 26.
19. **Icon and status-bar polish.** `index.html:6` fixes theme-color to ink although the timekeeper opens light. The manifest has no 512 px or maskable icon (`vite.config.ts:25-28`), which affects Android splash and adaptive-icon quality.
20. **Hygiene.** package.json keeps npm-init boilerplate (license "ISC", empty description, directories/keywords/author). There are four `eslint-disable` comments, but ESLint isn't installed or configured.

## Minors triage (entries of final-review-minors.md in area C)

- **L3 Task 1 — package.json boilerplate:** defer. It is cosmetic and `private: true` blocks publishing. Fold it into the README/DEPLOY task (license "UNLICENSED", drop directories/keywords/author). The storage.ts part belongs to B1.
- **L9 Task 16 — QrCode has no placeholder:** defer. Generation takes milliseconds and TimingTab shows the link text.
- **L9 Task 16 — LineChart `role=img` + `tabIndex`:** defer. The sr-only table carries the data.
- **L9 Task 16 — Field shows error OR hint:** defer. The hint returns once the error clears.
- **L9 Task 16 — Button sm is as tall as md:** defer. It is the intentional ≥ 44 px target (spec §13).
- **L9 Task 16 — Logo alt text:** defer. Trivially fixable: use `alt=""` next to the visible brand text.
- **L12 Task 16 — LineChart first paint at 640:** defer. It is a one-frame layout snap.
- **L21 Task 17 — EventLayout ignores errors after the first load:** defer. There is no data loss (timekeepers keep their marks and the board catches up), but I recommend a "sem conexão · atualizado às …" hint in EventHeader.
- **L21 Task 17 — `refetchOnWindowFocus` refetches the aggregate:** defer. It costs bandwidth only; set it to false on `['event']`/`['pub-event']` when convenient (see Minor 14).
- **L21 Task 17 — "Revisão2" accessible name:** defer (add a space or sr-only text). The auth and test-gap parts belong to other areas.
- **L23 Task 19 — blank label, generator no-op, per-row names, missing editor tests, no h1 while editing:** defer; each is cosmetic, a test gap, or has a sane default.
- **L23 Task 19 — no client range check for window/threshold:** defer. The server rejects with a pt-BR message, but see Important 4: today that message lands off-screen.
- **L24 Task 18 — per-card/per-row action names:** defer. Do it in one aria-label sweep together with T21's.
- **L26 Task 7 (consumer side):** verified; nothing to do in area C. PublicAthletePage and StatsView read only id/name/sex/city/team_club.
- **L29 Task 20 — ageToday duplicate, raw M/F in the table, no .xlsx import test:** defer; cosmetic, and the xlsx reader is unit-tested in B1.
- **L32 Task 22 (kit part) — see-through toasts:** already fixed. `Toast.tsx:47-52` mixes tones into `--color-surface`.
- **L32 Task 22 (kit part) — squeezed message with actions on phones:** defer. Only the timekeeper page uses two actions, and it lays out its own toast.
- **L34 Task 21 — no loading/error state in the member pickers and bulk list:** fix before production (Minor 1). A slow or failed athletes fetch reads as "no athletes" and invites duplicate athletes.
- **L34 Task 21 — per-row names, `ENTRY_STATUS_OPTIONS` mirror, stale AthleteForm comment:** defer.
- **L35 Task 27 — UpdatePrompt test title contradicts its assertion:** fix together with Important 1, since the same files are touched.
- **L35 Task 27 — no de-dup of onNeedRefresh:** fix together with Important 1. For a tab open more than 60 s, the plugin calls onNeedRefresh from both 'installed'(isExternal) and 'waiting', so two identical toasts is the normal case.
- **L36 Task 26 — `instanceof ApiError`, missing `refetched` guard, copied status order/collator:** defer. They are harmless, self-heal within 10 s, or are consistent today.
- **L37 Task 21 — EntryForm's Escape coupling to Modal:** fix together with Important 2; the modal stack replaces the `stopImmediatePropagation` hack.
- **L37 Task 21 — awkward import-hint sentence:** defer. It is copy; reword it with Minor 3.
- **L40 Task 28 — "2 inscrição(ões) criada(s).":** fix before production. It is a one-line pt-BR plural on the main entries flow; do the same for ImportDialog's "atleta(s)".
- **L40 Task 28 — agent-browser workarounds in lib.sh:** defer; test-only and documented. The CrossingEditor and bib-caret items belong to B2.

## Declined to judge

- **Light-theme surfaces `#FFFFFF`/`#ECE7DF` are not brand tokens.** The plan (line 561) mandates them.
- **Devices keep the old build until every tab closes (waiting service worker).** This is Ruling 26's accepted cost.
- **The service worker precaches every chunk (~814 KiB) on the timekeeper's first visit.** Offline use requires it; Ruling 30 targets the route's initial load.
- **Last write wins, with no conflict banner, in RaceEditor/EntryForm/EntryStatusModal.** This is a single-organizer app, and seeding once meets Ruling 40's requirement that a refetch never overwrites typing.
- **Event status is a manual organizer field** (the E2E event still shows "Planejado" publicly after finalizing). The spec defines it that way.
- **Wide tables scroll sideways at 390 px.** This is the accepted Table pattern, and the E2E proves the page itself never scrolls sideways.
- **Leg reorder keeps team members' leg indices by position.** This is plausible intended semantics, and the server locks it once marks exist.
- **Timed-out writes that actually committed (retry → duplicate race).** This is T17's deferred api.ts minor (owned elsewhere). Note that `refresh()` never rejects (TanStack `refetchQueries` swallows errors), so a failed refresh never masks a successful save.
- **Raw non-P0001 database messages in general, and timekeeper names in `pub_event`.** These belong to area A/B1 and are spec §6 ("como tk_open").
- **Timekeeper page layout/toasts, ClassificationTable, PodiumView, ResultsTab, TimingTab, ReviewTab, and auth pages/session.tsx.** These are areas B2 and others.
- **EventProvider recomputing timing every 10 s.** The domain functions are cheap at spec scale (§16); performance belongs to B1.
- **No CSP.** It is not required; the inline theme script would need a hash if one is added later.
- **Old hashed chunks returning 404 after a deploy.** In prompt mode, the old service worker's precache keeps serving them until the update is applied.
- **Modal's initial focus goes to "×" rather than the first field.** This is accessibility-safe.
- **E2E runs only in WSL, with no CI.** This is an environment decision (Rulings 47/56).
- **README/DEPLOY.md are missing.** They are planned in T29 and were not penalized.

## Recommendations

1. Fix Important 1–4. All four are small and local:
   - one `registerSW` option plus a test;
   - a modal stack in Modal.tsx plus a nested test;
   - a confirm or block on removing a wave that has started or has entries, preferably with a server guard;
   - scroll or focus the error banner.
2. Promote the cheap Minors that affect race day: 1 (athlete list loading/error), 2 (empty date), 3 (import preselect), 7 (last timekeeper link), 8 (tab strips at 390 px).
3. For T29, upload `package-lock.json` and install with `npm ci`; add `engines.node`, immutable `/assets` caching and basic security headers in vercel.json.
4. Tighten E2E 03 to assert who is 1st, and add a public "no e-mail/phone" assertion.
5. Consider ESLint with `react-hooks` so the existing `eslint-disable` comments mean something.

## Assessment

**Ready for production: With fixes.**

Area C is in good shape. The shell's lazy chunking, prompt-mode PWA, theme bootstrap, Ruling 40 guards, confirmations and pt-BR error surfacing are solid, and the E2E suite genuinely plays an event day. No Critical issues.

Four Important issues should land before the first real event:
- Ruling 26's guarantee still has a same-device reload path.
- The only nested dialog loses the in-progress entry on Escape and cannot be used from the keyboard.
- Removing a wave can silently erase a recorded start and re-time its entries.
- Save errors on the two main configuration forms are rendered out of sight.

Each fix is localized (a few lines to one small module) and testable, so one combined fix round plus a scoped re-review should be enough.
