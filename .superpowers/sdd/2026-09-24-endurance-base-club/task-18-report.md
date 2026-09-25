# Task 18 report: Events dashboard, event general tab, settings, help

**Status: DONE**

Branch `task/18` in worktree `/home/user/ebc-wt/t18`, base `bae2379`.

## What was implemented, by file

- **`src/features/events/EventsPage.tsx`** (replaced stub)
  - Fetches `api.admin.listEvents()` via `useQuery(['events'], ...)`, sorts client-side by `date` descending, and renders one `Card` per event: name as a link to `/eventos/:id`, a status `Badge` (Planejado/neutral, Ao vivo/success, Encerrado/info), `formatDateBR(date)` + location, and a `"N provas · M inscrições"` line (singular/plural).
  - `new-event` button opens a `Modal` with `event-name`, `event-date` (`type="date"`), `event-location`, `event-levels` (hint "Ex.: Elite, Base"). Submitting calls `api.admin.saveEvent({ name, date, location, levels })` — exactly those four keys, nothing else — then navigates to `/eventos/:id/provas`.
  - `parseLevels(text)` (exported, also duplicated in `EventGeneralTab.tsx`): splits on `,`, trims, drops empties, dedupes while preserving order (`"Elite, Base, Elite"` → `['Elite', 'Base']`).
  - Each card has "Duplicar" (opens a small modal prefilled with `"<name> (cópia)"` and the same date; calls `api.admin.duplicateEvent(id, name, date)`, then navigates to `/eventos/:newId`) and "Excluir" (danger `useConfirm()`, then `api.admin.deleteEvent(id)`, toast, refetch).
  - All mutation errors surface via `ApiError.message` in either the modal's inline `role="alert"` line (create/duplicate) or a toast (delete), never swallowed.
- **`src/features/events/EventGeneralTab.tsx`** (replaced stub)
  - Reads `agg.event` and `refresh` from `useEventContext()`. Local form state seeded from `event.*` and reset via a `useEffect` keyed on `event` (so a save or a live poll bringing a fresher version updates the form).
  - "Dados do evento" card: `event-name`, `event-date`, `event-location`, a `Textarea` for description, `event-levels`, and a `Select` for status (Planejado/Ao vivo/Encerrado, values `planejado`/`ao_vivo`/`encerrado`).
  - "Público" card: `event-public` checkbox ("Resultados públicos"); when checked, an editable slug `Input` plus a `…/#/p/<slug>` preview and a "Copiar link" button (copies `${location.origin}/#/p/<slug>` via the Clipboard API, guarded and reported through a toast either way).
  - `event-save` submits the whole form: `api.admin.saveEvent({ id, name, date, location, description, levels, status, is_public, public_slug })`, then `refresh()` and a success toast; errors go to a toast (never swallowed).
  - Danger zone: "Excluir evento" → `useConfirm()` (danger) → `api.admin.deleteEvent(event.id)` → toast → `navigate('/eventos')`.
- **`src/features/settings/SettingsPage.tsx`** (replaced stub)
  - "Minha conta" card: name/e-mail/role (read-only `<dl>`) plus an inline password-change form reusing `useSession().changePassword`, with the same test ids as `ChangePasswordPage` (`newpass-1`, `newpass-2`, `newpass-submit`) and the same two validation messages ("pelo menos 8 caracteres", "não conferem"), since the two screens never render at once.
  - "Organizadores" card: lists every `OrganizerRow` (name, e-mail, a Dono/Organizador `Badge`); the owner also gets a "Remover" button per other organizer (`data-testid="organizer-remove-<user_id>"`, danger confirm, `api.admin.deleteOrganizer`, toast).
  - `add-organizer` button (owner only, gated on `me.role === 'owner'`) opens a form: `organizer-name`, `organizer-email`, a read-only `organizer-password` field, and `organizer-generate-password`, which calls `generateTempPassword()` — `crypto.getRandomValues(new Uint32Array(12))` indexed (mod) into a 57-character unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ` + `abcdefghijkmnopqrstuvwxyz` + `23456789`; no `0/O`, `1/l/I`). `organizer-save` calls `api.admin.createOrganizer(email, password, name)`; on success the form is replaced by a one-time credentials panel (`data-testid="organizer-credentials"`) with an `organizer-copy-credentials` button. A server rejection (including `42501`, "only the owner creates organizers") is shown as a **toast** with `ApiError.message`, per the controller's note, rather than swallowed or silently retried.
- **`src/features/help/HelpPage.tsx`** (replaced stub)
  - Static pt-BR field manual, one `Card` per section, headings + short lists: **Antes do evento** (criar evento → provas/pernas/ondas → atletas/importação → inscrições → testar o link do cronometrista no local; reativar o Supabase se pausado), **Durante** (Largar agora; MARCAR + número; revezamento automático; acompanhar Revisão), **Depois** (resolver pendências, finalizar, exportar XLSX, desativar link), **Como o tempo oficial é escolhido** (mediana vs. média, com o exemplo pedido: 10:00:05/10:00:06/10:00:19 → mediana 10:00:06, média 10:00:10), and a closing **Checklist do dia do evento** with exactly the four items from the controller's note (Supabase pausado após ~7 dias, testar o link no local com os celulares reais, largadas sem horário, exportar e desativar o link ao final).

## Decisions the brief didn't spell out

1. **Where "Duplicar" navigates.** The brief says "asks new name/date → `duplicateEvent` → navigate" without naming the destination (unlike "Novo evento", which explicitly goes to `/provas`). Since a duplicated event already carries over its races/config, I send it to `/eventos/:id` (its `geral` tab, via the existing index redirect) rather than straight to `provas`, so the organizer reviews/renames it first.
2. **Card actions as plain buttons, not a menu.** The brief says "card menu"; the kit has no dropdown/menu component. I used two visible `Button size="sm"` actions ("Duplicar"/"Excluir") instead of building a bespoke menu — simpler, fully keyboard/touch accessible, and avoids inventing new interaction chrome outside the kit.
3. **Reused `newpass-*` test ids on `SettingsPage`.** The contract's Auth section lists these ids generically (not "only on `ChangePasswordPage`"), and the brief explicitly says the settings form should reuse `useSession().changePassword` "the same" way; since the two screens are never mounted together, reusing the ids is safe and keeps one canonical set of password-change controls.
4. **`parseLevels` duplicated, not shared.** `EventsPage.tsx` and `EventGeneralTab.tsx` each own a private copy of the ~6-line comma-list parser. Both files are in my Files block, but there's no shared util file to put it in without touching an out-of-scope shared file, and importing one page's internals into another felt like the wrong coupling for a trivial helper.
5. **Password-generator alphabet.** 57 chars (`A-Z` minus `I,O`; `a-z` minus `l`; `2-9`) — a common, pragmatic "unambiguous" set. `crypto.getRandomValues` indexes it by `% length`; not perfectly bias-free (57 doesn't divide 2³²) but the bias is negligible for a 12-character temporary password a human retypes once.
6. **Public-link preview format.** Rendered literally as `…/#/p/<slug>` per the brief's own wording; the actual copied string is the resolvable `${location.origin}/#/p/<slug>`.

## TDD evidence

Wrote the implementation and the test file together, then produced a genuine RED/GREEN cycle by stashing just the four implementation files (keeping the new test file in place) and restoring them after:

```
$ git stash push -- src/features/events/EventGeneralTab.tsx src/features/events/EventsPage.tsx \
    src/features/help/HelpPage.tsx src/features/settings/SettingsPage.tsx
$ npx vitest run src/features/events/events.test.tsx
...
 Test Files  1 failed (1)
      Tests  16 failed (16)
```
Every one of the 16 tests failed against the stubs (missing test ids / stub placeholder text), for the expected reasons.

```
$ git stash pop
$ npx vitest run src/features/events/events.test.tsx

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Duration  4.20s
```
All 16 pass with the real implementation. Repeated 3× with no flakiness (~4s each run, 16/16 every time).

## Tests (`src/features/events/events.test.tsx`, new — 16 tests)

Mocks `../../lib/supabase` (bare stub) and `../../lib/api` (`admin.listEvents/saveEvent/deleteEvent/duplicateEvent/listOrganizers/createOrganizer/deleteOrganizer`), per the controller's note — nothing in this file imports the real Supabase client.

- **EventsPage** (4): cards sorted by date desc with name/date/location/status/counts; "Novo evento" calls `saveEvent` with the exact `{name, date, location, levels}` object (from `"Elite, Base, Elite"` → `['Elite','Base']`) and navigates to `/eventos/:id/provas`; "Duplicar" calls `duplicateEvent(id, name, date)` and navigates to `/eventos/:id`; "Excluir" confirms (danger) then calls `deleteEvent`.
- **EventGeneralTab** (4): renders the event's current fields, including the public link preview; saving calls `saveEvent` with the edited fields and calls `refresh()`; toggling public reveals the slug preview and copies the link via `navigator.clipboard.writeText`; delete confirms then calls `deleteEvent` and navigates to `/eventos`.
- **SettingsPage** (7): `add-organizer` shown for `role: 'owner'`, hidden for `role: 'admin'`; the generator produces exactly 12 chars matching the alphabet's regex and calls `crypto.getRandomValues` (spied), then `createOrganizer` is called with that exact password and the credentials panel + copy button appear; removing an organizer confirms then calls `deleteOrganizer`; a `42501` rejection from `createOrganizer` surfaces its pt-BR message in a toast (and the credentials panel never appears); the account form calls `useSession().changePassword` with the typed password.
- **HelpPage** (2): all five section headings render, plus the exact checklist phrases (Supabase pausado, testar no local, largadas sem horário, exportar/desativar); the worked median example (`10:00:05`, `10:00:06`, `10:00:19`, and the average `10:00:10` for contrast) is present.

No `act()` warnings, no unhandled rejections, no console noise in this file's output.

## Gate outputs

```
$ npx vitest run src/features/events/events.test.tsx
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

```
$ npx vitest run          # full repo
 Test Files  1 failed | 25 passed (26)
      Tests  9 failed | 295 passed (304)
```
The 9 failures are all in `src/features/events/eventShell.test.tsx` (Task 17's file, outside my Files block) — see **Concerns** below; every other file, including my own 16, passes.

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(exit 0, no diagnostics)
```

```
$ npm run build
> vite build
✓ 229 modules transformed.
dist/index.html                   0.81 kB │ gzip:  0.45 kB
dist/assets/index-*.css          22.06 kB │ gzip:  5.35 kB
dist/assets/index-*.js          628.39 kB │ gzip: 182.07 kB
✓ built in ~1.1s
```
(The >500 kB chunk warning pre-dates this task — same libraries flagged in Task 17's own report.)

## Files changed

- Modified: `src/features/events/EventsPage.tsx`, `src/features/events/EventGeneralTab.tsx`, `src/features/settings/SettingsPage.tsx`, `src/features/help/HelpPage.tsx`
- New: `src/features/events/events.test.tsx`

Nothing else touched (`git diff --stat` against `bae2379` shows exactly these 4 modified + 1 new file). No shared file (`App.tsx`, `types.ts`, `api.ts`, etc.) was edited.

## Self-review findings

- Test ids checked one by one against the brief and contracts.md: `new-event`, `event-name`, `event-date`, `event-location`, `event-levels`, `event-public`, `event-save` — all present, on the exact controls described.
- `parseLevels` behavior double-checked against the brief's literal example (`"Elite, Base, Elite"` → `['Elite','Base']`) and unit-tested through the create-event flow.
- Every mutation error path (create, duplicate, delete, save, add/remove organizer, change password) shows `ApiError.message` — never swallowed — either inline (`role="alert"`, for create/duplicate's own validation-shaped errors) or as a toast (delete/remove/save/add-organizer), per the shared rule "Server errors: show `ApiError.message` in a toast or banner — never swallow them."
- Fixed a UX inconsistency during self-review: `EventsPage`'s "Novo evento" modal originally reset its fields only on Escape/backdrop-close (via `Modal`'s `onClose`), not on the footer's "Cancelar" button, since the modal stays mounted (visibility toggled by the `open` prop) rather than unmounting. Unified both paths through one `handleClose()` so Cancelar also clears the form; re-verified via the full test file and typecheck.
- No `Date.now()` used for anything time-related in these screens (only display of `event.date`, a plain calendar date with no clock component, and `formatDateBR` for all rendered dates) — consistent with `DECISOES.md`'s rule that all timing goes through the synced clock; these screens don't stamp any marks or times themselves.
- Accessibility: every control comes from the kit (`Input`/`Select`/`Textarea`/`Checkbox`/`Button`/`Modal`/`Confirm`), so labels, `aria-invalid`/`aria-describedby`, focus trapping and 44px touch targets are inherited; added `role="alert"` on every inline error line I wrote by hand.
- No new colors/web fonts; only brand token classes (`text-danger`, `border-danger/40`, `bg-success/15` via `Badge`, etc.) and the kit's own components.

## Concerns

1. **9 pre-existing failures in `src/features/events/eventShell.test.tsx` after this change — expected, out of my scope.** That file (Task 17's, not in my Files block) asserts on the *stub* placeholder text (`"EventsPage"`, `"HelpPage"`, `"SettingsPage"`, `"EventGeneralTab"`) as a routing smoke check. Replacing those four stubs with real components — exactly what this brief and `App.tsx`'s comment ("your page is currently a stub there — replace the stub file") ask for — necessarily removes that placeholder text, so those 9 assertions now fail. I verified none of them are testing functional regressions in `EventLayout`/routing/polling itself: each failure is the test's own literal-text checkpoint (e.g. `expect(await screen.findByText('EventGeneralTab'))`) failing before it can reach its real assertions. Per the wave-2 shared context ("small fixes to the shell may arrive later — build against the contracts, not against incidental details"), I did not touch that file; the same collision will recur for every other wave-2a task as it replaces its own stub, so `eventShell.test.tsx` will need updating once during integration (dropping the stub-text checks in favor of routing/structure assertions, e.g. by test id or heading role) — flagging for the controller rather than guessing at the fix myself.
2. **`Duplicar` destination is an assumption** (see Decision 1) — the brief doesn't name it. If the controller intends `/eventos/:id/provas` instead (matching "Novo evento"), it's a one-line change in `EventsPage.tsx`'s `onDuplicated` callback.
3. **Password-generator modulo bias.** `57` doesn't evenly divide `2^32`, so the very last alphabet character is drawn with a ~1.16×10⁻⁸ relatively lower probability than the others — cryptographically irrelevant for a 12-char temporary password, but noting it since a security-focused reviewer might ask.

## Fix round 1

Addresses the review's one Important finding and the controller's promoted Minor (Ruling 40). Both fixed on the same `task/18` branch, same worktree.

### 1. (Important) De-duplicated `parseLevels`, `errorMessage`, `copyToClipboard`

- **New file `src/features/events/eventHelpers.ts`** — one exported implementation of each:
  - `parseLevels(text): string[]` (moved from `EventsPage.tsx`, unchanged).
  - `errorMessage(err, fallback): string` (moved, unchanged; was duplicated verbatim in `EventsPage.tsx`, `EventGeneralTab.tsx` and `SettingsPage.tsx`).
  - `copyToClipboard(text): Promise<boolean>` (moved, unchanged; was duplicated verbatim in `EventGeneralTab.tsx` and `SettingsPage.tsx`).
- **`EventsPage.tsx`**: now `import { errorMessage, parseLevels } from './eventHelpers'`; its own copies deleted.
- **`EventGeneralTab.tsx`**: now `import { copyToClipboard, errorMessage, parseLevels } from './eventHelpers'`; its own copies deleted.
- **`SettingsPage.tsx`**: now `import { copyToClipboard, errorMessage } from '../events/eventHelpers'` (cross-folder import, as the controller's note explicitly sanctioned: "keep ONE exported implementation... and import it elsewhere"); its own copies deleted.
- **New file `src/features/events/eventHelpers.test.ts`** (6 tests): `parseLevels` — the brief's own example (`"Elite, Base, Elite"` → `['Elite','Base']`), extra whitespace/empty segments, case sensitivity, a single value, and empty/blank input; `errorMessage` — a plain `Error`'s message, falling back when the message is empty, and falling back for a string/plain object/`null`/`undefined` (none of which are an `Error`). Kept deliberately independent of `lib/api`'s `ApiError` class (a comment explains why: importing `lib/api` pulls in `lib/supabase`, which throws without `VITE_SUPABASE_URL` outside a real build — the same hazard the controller flagged for `events.test.tsx`); a plain `Error` covers the same code path since `ApiError extends Error`.

### 2. (Ruling 40) `EventGeneralTab` no longer discards unsaved edits on a background refetch

Rewrote the reseed effect in `EventGeneralTab.tsx`:

- Added `dirty` (has the organizer touched any field since the form was last seeded?) and `serverChanged` (the server's `event` changed while the form was dirty) state, plus an `eventIdRef` to detect a genuine navigation to a *different* event.
- The `useEffect` keyed on `event` now only re-seeds the form (via a new `seedFromEvent(ev)` helper) when `event.id` changed (a different event — always safe to reseed) **or** the form isn't dirty. When the form is dirty on the *same* event and `event` still changed identity — i.e., something else (another tab, another organizer, a live poll) saved over it — it sets `serverChanged` and leaves the organizer's typed values alone. `dirty` is read in the effect without being a dependency (commented why): the effect must fire only on an `event` change, never merely because the organizer started typing.
- Every field's `onChange` now goes through a small `edited(setter, value)` wrapper that also calls `setDirty(true)`.
- `onSubmit` clears `dirty`/`serverChanged` **before** `await refresh()`, so the aggregate update that follows a successful save is never mistaken for someone else's concurrent change.
- New UI: when `serverChanged`, a warning-toned banner at the top of the form — "Os dados do evento mudaram em outro lugar — salve para sobrescrever ou recarregue." — with a "Recarregar" button that reseeds from the current `event` and clears both flags (`reloadFromServer`).

### Tests (added to `src/features/events/events.test.tsx`, in the `EventGeneralTab` describe block)

- A new `renderTabDirect(ctx)` helper wraps the tree in a single, stable `<MemoryRouter>` (unlike the existing routes-table-based `renderTab`, whose `createMemoryRouter` instance would need to change to swap the context value, which risks a full remount and defeats the point of the test). It returns `rerenderWithContext(next)`, which calls RTL's `rerender` with the same tree shape but a new `EventContext.Provider value`, mirroring exactly how the real `EventProvider` re-renders `EventGeneralTab` with a fresh `agg`/`event` on a poll or refetch — no component type changes, so `EventGeneralTab`'s own `useState` genuinely survives across the rerender, the same way it would in the app.
- **"keeps unsaved edits when the event changes elsewhere, and offers to reload (Ruling 40)"**: types a new name, then `rerenderWithContext` with a *second*, same-id event carrying a different name (simulating a concurrent save elsewhere) → the typed value survives and the warning banner appears; clicking "Recarregar" then adopts the new server value and the banner disappears.
- **"re-seeds freely from a fresh event while the form is untouched"**: no edits made before the `rerender` → the form silently picks up the new value, no banner (guards against the fix being overly conservative).
- **"does not warn about its own save landing"**: edits the name, saves (mocked `saveEvent`), then `rerenderWithContext`s with the aggregate a real `refresh()` would have produced (same edited name) → no banner, confirming the save-then-refetch path isn't mistaken for an external change.

### TDD evidence

Stashed only `EventGeneralTab.tsx` (leaving the new tests in place) to reproduce Ruling 40 against the previously-committed unconditional-reseed version:

```
$ git stash push -- src/features/events/EventGeneralTab.tsx
$ npx vitest run src/features/events/events.test.tsx
 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)

 FAIL  … > EventGeneralTab > keeps unsaved edits when the event changes elsewhere, and offers to reload (Ruling 40)
Error: expect(element).toHaveValue(Nome em edição)
Expected the element to have value:
  Nome em edição
Received:
  Copa EBC (renomeada em outro lugar)
```
Exactly the reported bug, and only that one test fails (the other two new tests and everything else stay green, confirming they don't accidentally depend on the fix).

```
$ git stash pop
$ npx vitest run src/features/events/events.test.tsx src/features/events/eventHelpers.test.ts
 Test Files  2 passed (2)
      Tests  25 passed (25)
```
Repeated 3× with no flakiness.

### Gate outputs

```
$ npx vitest run src/features/events
 Test Files  1 failed | 2 passed (3)
      Tests  9 failed | 45 passed (54)
```
The 9 failures are the same pre-existing `eventShell.test.tsx` stub-text assertions noted in the original report (Task 17's file, fixed on its side per the coordinator's note) — nothing here regressed; my own two files (`events.test.tsx`, `eventHelpers.test.ts`) are 45/45.

```
$ npx vitest run          # full repo
 Test Files  1 failed | 26 passed (27)
      Tests  9 failed | 304 passed (313)
```
304 passing (was 295; +9 from this round: 3 new `EventGeneralTab` tests + 6 new `eventHelpers` unit tests), same 9 pre-existing `eventShell.test.tsx` failures, ignored per the coordinator's note.

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(exit 0, no diagnostics)
```

```
$ npm run build
> vite build
✓ 230 modules transformed.
dist/index.html                   0.81 kB │ gzip:  0.44 kB
dist/assets/index-*.css          22.13 kB │ gzip:  5.36 kB
dist/assets/index-*.js          628.68 kB │ gzip: 182.21 kB
✓ built in ~0.9s
```

### Files changed (this round)

- Modified: `src/features/events/EventsPage.tsx`, `src/features/events/EventGeneralTab.tsx`, `src/features/settings/SettingsPage.tsx`, `src/features/events/events.test.tsx`
- New: `src/features/events/eventHelpers.ts`, `src/features/events/eventHelpers.test.ts`

### Self-review findings

- Re-checked every caller of the three moved helpers by name (`grep -n "function parseLevels\|function errorMessage\|function copyToClipboard"` across the four screen files and `eventHelpers.ts`) — exactly one implementation of each, in `eventHelpers.ts`; nothing left behind.
- Double-checked the save-success ordering claim (`setDirty(false)` before `await refresh()`) actually prevents the false-positive banner with a dedicated test ("does not warn about its own save landing") rather than just reasoning about it.
- Confirmed the "untouched form" path still re-seeds freely (its own test), so the fix doesn't overshoot into never updating the form from live data.
- No new test ids, no UI copy in English, no new colors (the banner uses the existing `warning` token via `border-warning/40 bg-warning/10 text-warning`, consistent with `Badge`'s own warning tone classes elsewhere in this codebase).

### Concerns

- None new. The pre-existing `eventShell.test.tsx` stub-text collision (see the original report's Concern 1) is explicitly deferred to Task 17's side per this round's instructions.
