## Task 16: UI kit, layout, theme and test utilities

**Files:**
- Create: `src/components/ui/Button.tsx`, `Field.tsx` (Input, Select, Textarea, Checkbox wrappers with label/hint/error), `Modal.tsx`, `Confirm.tsx` (`ConfirmProvider`, `useConfirm`), `Tabs.tsx`, `Badge.tsx`, `Card.tsx`, `Table.tsx`, `Toast.tsx` (`ToastProvider`, `useToast`), `Spinner.tsx`, `EmptyState.tsx`, `src/components/ui/index.ts`, `src/components/Layout.tsx`, `src/components/Logo.tsx`, `src/components/ThemeToggle.tsx`, `src/components/QrCode.tsx`, `src/components/LineChart.tsx`, `src/hooks/useNow.ts`, `src/test/renderWithProviders.tsx`, `src/components/ui/ui.test.tsx`

**Interfaces:**
- Produces:
  - `Button` props: `variant?: 'primary'|'secondary'|'ghost'|'danger'`, `size?: 'sm'|'md'|'lg'|'xl'`, `loading?: boolean`, plus all `button` props (incl. `data-testid`).
  - `Input`, `Select`, `Textarea`, `Checkbox`: `label`, `hint?`, `error?` + native props; `Select` takes `options: {value: string; label: string}[]`.
  - `Modal({ open, onClose, title, children, footer?, size?: 'md'|'lg'|'xl' })` — `role="dialog"`, `aria-modal`, Esc closes, click on backdrop closes.
  - `useConfirm(): (opts: { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>` — buttons `data-testid="confirm-ok"` / `"confirm-cancel"`.
  - `Tabs({ items: {id: string; label: string; to: string; badge?: ReactNode}[] })` rendering `NavLink`s with `data-testid="tab-<id>"`.
  - `Badge({ tone?: 'neutral'|'success'|'warning'|'danger'|'info', children })`, `Card`, `Table` (wrapper with horizontal scroll, sticky header), `Spinner`, `EmptyState({ title, children? })`.
  - `useToast(): { show(t: { message: ReactNode; tone?: 'neutral'|'success'|'warning'|'danger'; actions?: {label: string; onClick(): void; testid?: string}[]; testid?: string; durationMs?: number }): string; dismiss(id: string): void }` — default 5 s.
  - `Layout` (header: `Logo` + `ENDURANCE BASE CLUB` in `brand-title`, nav links Eventos `/eventos`, Atletas `/atletas`, Ajuda `/ajuda`, Configurações `/config`, `ThemeToggle`, logout button `data-testid="logout"` calling an `onLogout` prop; renders `<Outlet/>`; nav collapses into a horizontally scrollable row on mobile).
  - `ThemeToggle` toggles `document.documentElement.dataset.theme` between `dark`/`light` and stores `ebc.theme` via `safeLocalStorage`.
  - `QrCode({ value, size?, testid? })` → `<img>` from `QRCode.toDataURL(value, { margin: 1, width: size })`.
  - `LineChart({ points: {label: string; value: number; tooltip?: string}[]; formatValue(v: number): string; title: string; height?: number })` — accessible SVG line chart (**before writing it, load the `dataviz` skill and follow it**; use `--fg`/`--muted` tokens so it works in both themes; lower values are better for times, so annotate "menor é melhor").
  - `useNow(intervalMs = 1000): number`.
  - `renderWithProviders(ui, { route = '/', path = '*' } = {})` → wraps `QueryClientProvider` (retry false), `ToastProvider`, `ConfirmProvider`, and a `createMemoryRouter` with the given path/route; returns Testing Library's result plus `router`.
- Visual rules: use tokens (`bg-bg`, `text-fg`, `bg-surface`, `border-border`, `text-muted`, `bg-accent text-accent-fg`), rounded-xl, generous padding, min touch target 44 px, focus rings visible, `tabular` class on numbers.

- [ ] **Step 1: Write failing `src/components/ui/ui.test.tsx`**: Button renders children and calls `onClick`, shows a spinner and is disabled when `loading`; `useConfirm` resolves `true` on `confirm-ok` and `false` on `confirm-cancel`; `Modal` calls `onClose` on Escape; `ThemeToggle` flips `data-theme` and writes `ebc.theme`; `useToast().show` renders the message and an action button that fires its handler.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; `npm run typecheck` clean. **Step 5: Commit** (`feat(ui): design system components, layout and test utilities`).

---

