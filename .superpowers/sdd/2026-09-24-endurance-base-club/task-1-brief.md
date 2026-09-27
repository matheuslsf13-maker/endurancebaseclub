## Task 1: Project scaffold, shared contracts, time formatting, storage

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.env.production`, `.env.development`, `.env.e2e`, `vercel.json`, `public/logo.png`, `public/favicon.png`, `public/icon-192.png`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `src/lib/types.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/lib/storage.ts`, `src/lib/storage.test.ts`, `src/test/setup.ts`

**Interfaces:**
- Produces: `src/lib/types.ts` (verbatim from "Shared Contracts"), `src/lib/format.ts`, `src/lib/storage.ts` (signatures in "Libs signatures"), npm scripts, installed dependencies, CSS tokens, brand assets.

- [ ] **Step 1: Create the Vite project files and install dependencies**

```bash
cd /home/claude/endurance-base-club
npm init -y >/dev/null
npm install --save-exact react react-dom react-router @tanstack/react-query @supabase/supabase-js fflate qrcode
npm install --save-exact -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/qrcode tailwindcss @tailwindcss/vite vite-plugin-pwa vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom pg @types/pg @types/node
```

Edit `package.json`: set `"name": "endurance-base-club"`, `"private": true`, `"type": "module"`, remove `main`, and set scripts:

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview --port 4173 --strictPort",
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "vitest run -c vitest.integration.config.ts",
  "test:sql": "bash scripts/test-sql.sh",
  "db": "bash scripts/db-local.sh",
  "shim": "node dev/shim/server.mjs",
  "dev:stack": "bash scripts/dev-stack.sh",
  "e2e": "bash tests/e2e/run.sh"
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext",
    "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "noEmit": true,
    "skipLibCheck": true, "resolveJsonModule": true, "isolatedModules": true,
    "types": ["vite/client", "node"], "allowImportingTsExtensions": false
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.integration.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`src/test/setup.ts`: `import '@testing-library/jest-dom/vitest';`

`.env.production`:
```
VITE_SUPABASE_URL=https://wlishmznbhhcqzncdxnq.supabase.co
VITE_SUPABASE_KEY=sb_publishable_Py0jUHGMNAjCM8C488RvZg_qviJupEk
```
`.env.development` and `.env.e2e` (identical):
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_KEY=sb_publishable_local_dev
```
`.gitignore`: `node_modules`, `dist`, `.env.local`, `tests/e2e/artifacts/*` (keep `.gitkeep`), `*.log`, `.vercel`.

`vercel.json`:
```json
{
  "framework": "vite",
  "installCommand": "npm install --no-audit --no-fund",
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
```

`index.html` (`lang="pt-BR"`, `<meta charset="utf-8">`, viewport `width=device-width, initial-scale=1, viewport-fit=cover`, `theme-color` `#191513`, title `EnduranceBaseClub`, `<link rel="icon" href="/favicon.png">`, `<link rel="apple-touch-icon" href="/icon-192.png">`, `<div id="root">`, `<script type="module" src="/src/main.tsx">`) plus this inline script in `<head>` so the theme applies before paint:

```html
<script>
  try { var t = localStorage.getItem('ebc.theme'); document.documentElement.dataset.theme = (t === 'light' || t === 'dark') ? t : 'dark'; }
  catch (e) { document.documentElement.dataset.theme = 'dark'; }
</script>
```

`src/index.css`:

```css
@import "tailwindcss";

:root, [data-theme="dark"] {
  --bg: #191513; --fg: #F4F1EC; --surface: #241F1C; --surface-2: #2E2825;
  --border: #3A332F; --muted: #A39D93; --accent: #F4F1EC; --accent-fg: #191513;
}
[data-theme="light"] {
  --bg: #F4F1EC; --fg: #191513; --surface: #FFFFFF; --surface-2: #ECE7DF;
  --border: #D9D3C9; --muted: #6F665E; --accent: #191513; --accent-fg: #F4F1EC;
}
@theme inline {
  --color-bg: var(--bg); --color-fg: var(--fg); --color-surface: var(--surface); --color-surface-2: var(--surface-2);
  --color-border: var(--border); --color-muted: var(--muted); --color-accent: var(--accent); --color-accent-fg: var(--accent-fg);
  --color-ink: #191513; --color-paper: #F4F1EC;
  --color-success: #3F8F5B; --color-warning: #C8922E; --color-danger: #C2413B; --color-info: #5B7C99;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
html, body, #root { height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: var(--font-sans); -webkit-tap-highlight-color: transparent; }
.tabular { font-variant-numeric: tabular-nums; }
.brand-title { text-transform: uppercase; letter-spacing: 0.18em; }
@media print { .no-print { display: none !important; } body { background: #fff; color: #000; } }
```

`src/main.tsx` renders `<App />` inside `<StrictMode>` and imports `./index.css`. Temporary `src/App.tsx`: `export default function App() { return <main className="p-6 brand-title">EnduranceBaseClub</main>; }` (Task 17 replaces it).

- [ ] **Step 2: Create brand assets from the user's logo**

```bash
python3 - <<'EOF'
from PIL import Image, ImageDraw
src = Image.open('/root/.claude/uploads/1de2ea02-75bd-5c83-8fd8-9d71141a0d63/45b4c3fa-image.jpg').convert('RGBA')
w, h = src.size
mask = Image.new('L', (w * 4, h * 4), 0)
ImageDraw.Draw(mask).ellipse((2, 2, w * 4 - 3, h * 4 - 3), fill=255)
mask = mask.resize((w, h), Image.LANCZOS)
src.putalpha(mask)
def save(img, path, size):
    img.resize((size, size), Image.LANCZOS).quantize(colors=32, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)
save(src, 'public/logo.png', 150)
save(src, 'public/favicon.png', 48)
save(src, 'public/icon-192.png', 192)
EOF
ls -la public
```
Expected: three PNGs, each < 25 KB, transparent corners.

- [ ] **Step 3: Write `src/lib/types.ts`** — copy the block from "Shared Contracts → `src/lib/types.ts`" verbatim.

- [ ] **Step 4: Write the failing tests `src/lib/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  formatClock, formatDuration, formatGap, formatDateBR, formatDateTimeBR, parseClockInput,
  brasiliaOffsetMinutes, excelSerialBrasilia, excelDuration, formatPace, parseDateInput,
} from './format';

const T = Date.parse('2026-10-11T11:00:05.345Z'); // 08:00:05.345 in Brasília (UTC-3)

describe('format (independent of device time zone)', () => {
  it('formats the clock in Brasília', () => {
    expect(formatClock(T)).toBe('08:00:05');
    expect(formatClock(T, { tenths: true })).toBe('08:00:05.3');
    expect(formatClock(T, { millis: true })).toBe('08:00:05.345');
  });
  it('Brasília offset is -180 minutes in 2026', () => {
    expect(brasiliaOffsetMinutes(T)).toBe(-180);
  });
  it('formats durations (truncating)', () => {
    expect(formatDuration(3_723_456)).toBe('1:02:03');
    expect(formatDuration(3_723_456, { tenths: true })).toBe('1:02:03.4');
    expect(formatDuration(2_527_000)).toBe('42:07');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-65_000)).toBe('-1:05');
  });
  it('formats gaps', () => {
    expect(formatGap(0)).toBe('');
    expect(formatGap(null)).toBe('');
    expect(formatGap(65_000)).toBe('+1:05');
  });
  it('formats dates', () => {
    expect(formatDateBR('2026-10-11')).toBe('11/10/2026');
    expect(formatDateTimeBR(T)).toBe('11/10/2026 08:00:05');
  });
  it('parses clock input as Brasília wall time on the event date', () => {
    expect(parseClockInput('08:00:05.3', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:05.300Z'));
    expect(parseClockInput('8:00', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:00.000Z'));
    expect(parseClockInput('08:00:05,25', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:05.250Z'));
    expect(parseClockInput('25:00', '2026-10-11')).toBeNull();
    expect(parseClockInput('08:61', '2026-10-11')).toBeNull();
    expect(parseClockInput('abc', '2026-10-11')).toBeNull();
  });
  it('produces Excel serials in Brasília local time', () => {
    const expected = Date.UTC(2026, 9, 11, 8, 0, 5, 345) / 86_400_000 + 25569;
    expect(excelSerialBrasilia(T)).toBeCloseTo(expected, 9);
    expect(excelDuration(86_400_000)).toBe(1);
  });
  it('formats pace per modality', () => {
    expect(formatPace(22 * 60_000 + 30_000, 5000, 'run')).toBe('4:30 /km');
    expect(formatPace(12 * 60_000 + 30_000, 750, 'swim')).toBe('1:40 /100m');
    expect(formatPace(37 * 60_000, 20_000, 'bike')).toBe('32,4 km/h');
    expect(formatPace(60_000, 0, 'run')).toBe('');
    expect(formatPace(60_000, 100, 'other')).toBe('');
  });
  it('parses dates typed in Brazilian or ISO format', () => {
    expect(parseDateInput('15/06/1990')).toBe('1990-06-15');
    expect(parseDateInput('5/6/1990')).toBe('1990-06-05');
    expect(parseDateInput('1990-06-15')).toBe('1990-06-15');
    expect(parseDateInput('31/02/1990')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify failure** — `npx vitest run src/lib/format.test.ts` → FAIL (module not found).

- [ ] **Step 6: Implement `src/lib/format.ts`**

```ts
import type { Modality } from './types';

export const TZ = 'America/Sao_Paulo';
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const msPart = (ms: number) => ((ms % 1000) + 1000) % 1000;

function brParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

export function brasiliaOffsetMinutes(ms: number): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = brParts(whole);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - whole) / 60_000);
}

export function formatClock(ms: number, opts: { tenths?: boolean; millis?: boolean } = {}): string {
  const p = brParts(ms);
  const base = `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
  if (opts.millis) return `${base}.${pad(msPart(ms), 3)}`;
  if (opts.tenths) return `${base}.${Math.floor(msPart(ms) / 100)}`;
  return base;
}

export function formatDuration(ms: number | null, opts: { tenths?: boolean } = {}): string {
  if (ms === null || Number.isNaN(ms)) return '—';
  if (ms < 0) return `-${formatDuration(-ms, opts)}`;
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600), m = Math.floor((totalS % 3600) / 60), s = totalS % 60;
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return opts.tenths ? `${base}.${Math.floor((ms % 1000) / 100)}` : base;
}

export function formatGap(ms: number | null): string {
  return !ms ? '' : `+${formatDuration(ms)}`;
}

export function formatDateBR(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(ms: number): string {
  const p = brParts(ms);
  return `${pad(p.d)}/${pad(p.mo)}/${p.y} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

export function parseClockInput(text: string, eventDate: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*$/.exec(text);
  if (!m) return null;
  const h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0, frac = m[4] ? +m[4].padEnd(3, '0') : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  const [y, mo, d] = eventDate.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s, frac);
  let t = wall - brasiliaOffsetMinutes(wall) * 60_000;
  const off2 = brasiliaOffsetMinutes(t);
  t = wall - off2 * 60_000;
  return t;
}

export function excelSerialBrasilia(ms: number): number {
  return (ms + brasiliaOffsetMinutes(ms) * 60_000) / 86_400_000 + 25569;
}
export function excelDuration(ms: number): number { return ms / 86_400_000; }

const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function formatPace(timeMs: number, distanceM: number, modality: Modality): string {
  if (!distanceM || distanceM <= 0 || !timeMs || timeMs <= 0) return '';
  const minSec = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.round(sec % 60) === 60 ? 59 : Math.round(sec % 60))}`;
  if (modality === 'run') return `${minSec(timeMs / 1000 / (distanceM / 1000))} /km`;
  if (modality === 'swim') return `${minSec(timeMs / 1000 / (distanceM / 100))} /100m`;
  if (modality === 'bike') return `${nf1.format(distanceM / 1000 / (timeMs / 3_600_000))} km/h`;
  return '';
}

export function parseDateInput(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (r) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
```

- [ ] **Step 7: Run** `npx vitest run src/lib/format.test.ts` → PASS. Also run `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts` → PASS (proves device time zone is irrelevant).

- [ ] **Step 8: Storage — write failing test `src/lib/storage.test.ts`, then implement `src/lib/storage.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { memoryStorage, readJSON, writeJSON, safeLocalStorage } from './storage';

describe('storage', () => {
  it('memory roundtrip and JSON helpers', () => {
    const s = memoryStorage();
    writeJSON(s, 'k', { a: 1 });
    expect(readJSON(s, 'k', null)).toEqual({ a: 1 });
    s.setItem('bad', '{not json');
    expect(readJSON(s, 'bad', 'fallback')).toBe('fallback');
    expect(readJSON(s, 'missing', 7)).toBe(7);
  });
  it('safeLocalStorage works and survives a throwing localStorage', () => {
    const s = safeLocalStorage();
    s.setItem('x', '1');
    expect(s.getItem('x')).toBe('1');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const s2 = safeLocalStorage();
    expect(() => s2.setItem('y', '2')).not.toThrow();
    expect(s2.getItem('y')).toBe('2'); // served from the in-memory fallback
    spy.mockRestore();
  });
});
```

Implementation: `memoryStorage()` wraps a `Map`. `safeLocalStorage()` returns an object that tries `window.localStorage` for each call and, on any exception, uses (and keeps using for that key) a module-level memory fallback; `getItem` checks the memory fallback first when the key was written there. `readJSON` parses with try/catch; `writeJSON` stringifies and calls `setItem` inside try/catch.

- [ ] **Step 9: Verify** — `npx vitest run` (all pass), `npm run typecheck` (no errors), `npm run build` (dist created).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React app, shared types, time formatting and storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRbqvfPgjYxeUrwitUvfv4"
```

---

