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
