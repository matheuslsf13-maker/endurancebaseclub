// The timekeeper app (`#/c/:token`, spec §7.3): mobile-first, no admin layout. One big MARCAR
// button stamps the synced instant; marks are identified by bib or by tapping the entry in
// "Em prova". Everything a timekeeper does is kept on the device first (useTimekeeper).

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { useParams } from 'react-router';
import { Button, Input, Modal, Spinner, useToast } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import type { ClockSync } from '../../lib/clock';
import { formatClock, formatDateBR, formatDuration } from '../../lib/format';
import { safeLocalStorage } from '../../lib/storage';
import type { MarkRow } from '../../lib/types';
import { legAthleteId } from '../../domain/eventModel';
import { legText, memberName } from './tkStore';
import type { OnCourseItem } from './tkStore';
import { useTimekeeper } from './useTimekeeper';
import type { AssignResult, MyMark, Timekeeper } from './useTimekeeper';

export default function TimekeeperPage() {
  const { token = '' } = useParams();
  // A different link is a different app state (session, registration, outbox).
  return <TimekeeperApp key={token} token={token} />;
}

/**
 * Ruling 21: on the timekeeper link the light theme is the default — a dark screen in the sun
 * turns into a mirror. A theme chosen on this device (`ebc.theme`) always wins; index.html applies
 * the same rule on load, this covers arriving here from another screen of the app.
 */
function useLightThemeByDefault() {
  useLayoutEffect(() => {
    const saved = () => {
      const t = safeLocalStorage().getItem('ebc.theme');
      return t === 'light' || t === 'dark';
    };
    if (!saved()) document.documentElement.dataset.theme = 'light';
    return () => {
      if (!saved()) document.documentElement.dataset.theme = 'dark';
    };
  }, []);
}

/** Keeps the screen on while timing; re-acquired when the page becomes visible again. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!active || !wakeLock) return;
    let cancelled = false;
    let held: WakeLockSentinel | null = null;
    const release = (s: WakeLockSentinel | null) => {
      if (s) s.release().catch(() => {});
    };
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      wakeLock.request('screen').then(
        s => {
          if (cancelled) return release(s);
          release(held);
          held = s;
        },
        () => {
          // Not allowed (battery saver, no user gesture yet…): the app works without it.
        },
      );
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', request);
      release(held);
    };
  }, [active]);
}

function vibrate() {
  try {
    navigator.vibrate?.(50);
  } catch {
    // Unsupported: the row appearing in "Sem atleta" is the feedback.
  }
}

const clockText = (ms: number) => formatClock(ms, { tenths: true });
const markTime = (m: MarkRow) => clockText(Date.parse(m.ts));
const qualityFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function TimekeeperApp({ token }: { token: string }) {
  useLightThemeByDefault();
  const tk = useTimekeeper(token);
  useWakeLock(tk.phase === 'main');

  switch (tk.phase) {
    case 'loading':
      return (
        <Centered>
          <Spinner size={32} />
          <p className="text-muted">Carregando a cronometragem…</p>
          {tk.loadError && (
            <>
              <p role="alert" className="text-sm text-danger">{tk.loadError} — tentando de novo…</p>
              <Button variant="secondary" onClick={tk.retry}>Tentar agora</Button>
            </>
          )}
        </Centered>
      );
    case 'invalid':
      return (
        <Centered>
          <Logo size={64} />
          <h1 className="brand-title text-lg font-semibold">Link inválido</h1>
          <p>Link de cronometragem inválido ou desativado. Peça um novo link à organização.</p>
        </Centered>
      );
    case 'disabled':
      return (
        <Centered>
          <Logo size={64} />
          <h1 className="brand-title text-lg font-semibold">Acesso desativado</h1>
          <p>Seu acesso foi desativado pela organização.</p>
          <p className="text-sm text-muted">Suas marcações continuam guardadas neste aparelho.</p>
          <Button variant="secondary" onClick={tk.retry}>Tentar novamente</Button>
        </Centered>
      );
    case 'register':
      return <RegisterScreen tk={tk} />;
    case 'main':
      return <MainScreen tk={tk} />;
  }
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 bg-bg p-6 text-center text-fg">
      {children}
    </main>
  );
}

function RegisterScreen({ tk }: { tk: Timekeeper }) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const event = tk.session?.event;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setNameError('Informe seu nome');
      return;
    }
    setNameError(undefined);
    setBusy(true);
    try {
      await tk.register(name);
    } catch (err) {
      setFormError(err instanceof Error && err.message ? err.message : 'Não foi possível entrar');
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Logo size={72} />
      <div>
        <p className="brand-title text-xs text-muted">Cronometragem</p>
        <h1 className="text-2xl font-bold">{event?.name}</h1>
        {event && (
          <p className="text-sm text-muted">
            {formatDateBR(event.date)}{event.location ? ` · ${event.location}` : ''}
          </p>
        )}
      </div>
      <form onSubmit={submit} noValidate className="flex w-full flex-col gap-3 text-left">
        <Input
          label="Seu nome"
          data-testid="tk-name"
          autoComplete="name"
          maxLength={60}
          value={name}
          error={nameError}
          onChange={e => setName(e.target.value)}
        />
        <Button type="submit" size="xl" data-testid="tk-register" loading={busy}>Começar a cronometrar</Button>
        {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
      </form>
      <p className="text-xs text-muted">Seu nome aparece para a organização junto com as suas marcações.</p>
    </Centered>
  );
}

/** Which "Sem atleta" mark a bib or an "Em prova" tap goes to. `auto` = the oldest one, so marks
 * taken in a burst are identified in arrival order; `none` = the user deselected (taps on
 * "Em prova" then mark new arrivals). */
type Selection = { mode: 'auto' } | { mode: 'none' } | { mode: 'id'; id: string };

function selectedMarkId(sel: Selection, unassigned: MarkRow[]): string | null {
  if (sel.mode === 'none') return null;
  if (sel.mode === 'id' && unassigned.some(m => m.id === sel.id)) return sel.id;
  return unassigned[0]?.id ?? null;
}

function MainScreen({ tk }: { tk: Timekeeper }) {
  const toast = useToast();
  const [bib, setBib] = useState('');
  const [sel, setSel] = useState<Selection>({ mode: 'auto' });
  const [legSheet, setLegSheet] = useState<string | null>(null);
  const assignToastId = useRef<string | null>(null);
  const pointerMarked = useRef(false);
  const bibId = useId();
  const selectedId = selectedMarkId(sel, tk.unassigned);
  const selectedMark = selectedId ? tk.unassigned.find(m => m.id === selectedId) ?? null : null;

  function showAssigned(r: Extract<AssignResult, { ok: true }>) {
    if (assignToastId.current) toast.dismiss(assignToastId.current);
    const markId = r.markId;
    assignToastId.current = toast.show({
      testid: 'assign-toast',
      tone: r.warning || r.suggestion.warning ? 'warning' : 'success',
      durationMs: 8_000,
      message: (
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">{r.message}</p>
          {r.warning && r.warning !== r.message && <p>{r.warning}</p>}
          <p className="tabular text-xs text-muted">Marcação das {clockText(Date.parse(r.ts))}</p>
        </div>
      ),
      actions: [
        {
          label: 'Desfazer', testid: 'toast-undo',
          onClick: () => {
            tk.unassign(markId);
            setSel({ mode: 'id', id: markId });
          },
        },
        ...(r.race.legs.length > 1
          ? [{ label: 'Trocar perna', testid: 'toast-change-leg', onClick: () => setLegSheet(markId) }]
          : []),
      ],
    });
  }

  function report(r: AssignResult) {
    if (r.ok) showAssigned(r);
    else toast.show({ message: r.error, tone: 'danger' });
  }

  function doMark() {
    // useTimekeeper reads the synced clock first thing in mark(): nothing here may run before it.
    const { markId, assignment } = tk.mark(bib);
    vibrate();
    if (assignment?.ok) {
      setBib('');
      showAssigned(assignment);
      return;
    }
    if (assignment) {
      // The bib typed belongs to this mark: select it so the corrected bib goes to it, not to an
      // older mark still waiting.
      toast.show({ message: assignment.error, tone: 'danger' });
      setSel({ mode: 'id', id: markId });
      return;
    }
    // A burst of taps keeps the oldest selected, so bibs are then typed in arrival order.
    if (selectedId === null) setSel({ mode: 'id', id: markId });
  }

  // Marks on pointerdown — the instant the finger lands, and a tap that turns into a slight drag
  // still counts. The click that follows the same press is ignored; keyboard presses (detail 0)
  // and clicks without a pointerdown still mark.
  function onMarkPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerMarked.current = true;
    doMark();
  }
  function onMarkClick(e: MouseEvent<HTMLButtonElement>) {
    const fromPointer = pointerMarked.current && e.detail > 0;
    pointerMarked.current = false;
    if (!fromPointer) doMark();
  }

  function onBibSubmit(e: FormEvent) {
    e.preventDefault();
    const text = bib.trim();
    if (!text) {
      toast.show({ message: 'Digite o nº de peito', tone: 'warning' });
      return;
    }
    const target = selectedId ?? tk.unassigned[0]?.id ?? null;
    if (!target) {
      toast.show({ message: 'Toque em MARCAR primeiro', tone: 'warning' });
      return;
    }
    const r = tk.assignBib(target, text);
    if (r.ok) setBib('');
    report(r);
  }

  function onRowTap(item: OnCourseItem) {
    // Ruling 10: never pass the row's current athlete — confirming a relay handoff shows the
    // next athlete as current, and the leg must come from the crossing times.
    if (selectedId) {
      report(tk.assign(selectedId, item.entry.id));
      return;
    }
    const { markId } = tk.mark(); // arrival tap: marks now, then identifies
    vibrate();
    const r = tk.assign(markId, item.entry.id);
    if (!r.ok) setSel({ mode: 'id', id: markId });
    report(r);
  }

  function toggleSelect(id: string) {
    setSel(id === selectedId ? { mode: 'none' } : { mode: 'id', id });
  }

  function onDiscard(m: MarkRow) {
    tk.discard(m.id);
    toast.show({
      testid: 'discard-toast',
      message: `Marcação das ${markTime(m)} descartada`,
      actions: [{ label: 'Desfazer', testid: 'discard-undo', onClick: () => tk.restore(m.id) }],
    });
  }

  function onReassign(m: MarkRow) {
    tk.unassign(m.id);
    setSel({ mode: 'id', id: m.id });
  }

  function onChangeLeg(markId: string, legIndex: number) {
    setLegSheet(null);
    report(tk.changeLeg(markId, legIndex));
  }

  return (
    <div className="min-h-full bg-bg text-fg">
      <Header tk={tk} />
      <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-3 pb-28">
        <ClockPanel clock={tk.clock} quality={tk.clockQuality} />

        <form onSubmit={onBibSubmit} className="flex flex-col gap-1.5">
          <label htmlFor={bibId} className="text-sm font-medium">Nº de peito</label>
          <div className="flex gap-2">
            <input
              id={bibId}
              data-testid="bib-input"
              inputMode="numeric"
              enterKeyHint="done"
              autoComplete="off"
              value={bib}
              onChange={e => setBib(e.target.value)}
              placeholder="—"
              className="tabular min-h-14 w-full min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-center text-3xl font-bold text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <Button type="submit" size="xl" variant="secondary" data-testid="bib-submit">Atribuir</Button>
          </div>
          <p className="text-xs text-muted">Com o nº digitado, MARCAR já atribui. Sem nº, marque e identifique depois.</p>
        </form>

        <button
          type="button"
          data-testid="mark-button"
          onPointerDown={onMarkPointerDown}
          onClick={onMarkClick}
          onContextMenu={e => e.preventDefault()}
          className="brand-title min-h-[35vh] w-full touch-none select-none rounded-2xl bg-accent text-5xl font-bold text-accent-fg shadow-lg transition-transform active:scale-[0.98] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Marcar
        </button>

        <UnassignedList marks={tk.unassigned} selectedId={selectedId} onSelect={toggleSelect} onDiscard={onDiscard} />

        <OnCourseList tk={tk} selectedMark={selectedMark} onTap={onRowTap} />

        <MyMarksList tk={tk} onDiscard={onDiscard} onRestore={id => tk.restore(id)} onReassign={onReassign} onChangeLeg={setLegSheet} />
      </main>

      <LegSheet tk={tk} markId={legSheet} onClose={() => setLegSheet(null)} onPick={onChangeLeg} />
    </div>
  );
}

function Header({ tk }: { tk: Timekeeper }) {
  const n = tk.pendingCount;
  let text: string;
  let dot: string;
  if (!tk.online) {
    text = `Sem internet · ${n} ${n === 1 ? 'marcação guardada' : 'marcações guardadas'} no aparelho`;
    dot = 'bg-danger';
  } else if (n > 0) {
    text = `Sincronizando ${n}…`;
    dot = 'bg-warning';
  } else if (tk.synced) {
    text = 'Online · tudo sincronizado';
    dot = 'bg-success';
  } else {
    text = 'Conectando…';
    dot = 'bg-warning';
  }
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg">
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2">
        <Logo size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tk.session?.event.name}</p>
          <p data-testid="tk-sync-status" role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="truncate">{text}</span>
          </p>
        </div>
        <ThemeToggle />
      </div>
      {tk.rejectedCount > 0 && (
        <p className="mx-auto max-w-xl px-4 pb-2 text-xs font-medium text-warning">
          ⚠ {tk.rejectedCount === 1 ? '1 marcação recusada' : `${tk.rejectedCount} marcações recusadas`} — veja “Minhas marcações”
        </p>
      )}
      {tk.syncError && (
        <p className="mx-auto max-w-xl px-4 pb-2 text-xs font-medium text-danger">
          Erro ao sincronizar: {tk.syncError} — tentando de novo
        </p>
      )}
    </header>
  );
}

/** The big synced clock; re-renders on its own every 100 ms so the rest of the page does not. */
function ClockPanel({ clock, quality }: { clock: ClockSync; quality: number | null }) {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(clock.now()), 100);
    return () => clearInterval(id);
  }, [clock]);
  return (
    <section aria-label="Relógio" className="flex flex-col items-center gap-0.5">
      <p data-testid="tk-clock" className="tabular text-5xl font-bold tracking-tight sm:text-6xl">{clockText(now)}</p>
      {quality !== null ? (
        <p className="tabular text-xs text-muted">Horário de Brasília · ±{qualityFmt.format(quality / 1000)} s</p>
      ) : (
        <p className="text-sm font-semibold text-warning">Relógio não sincronizado</p>
      )}
    </section>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="brand-title text-xs font-semibold text-muted">{children}</h2>;
}

function UnassignedList({ marks, selectedId, onSelect, onDiscard }: {
  marks: MarkRow[]; selectedId: string | null; onSelect: (id: string) => void; onDiscard: (m: MarkRow) => void;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <SectionTitle id={titleId}>Sem atleta ({marks.length})</SectionTitle>
      <ul data-testid="unassigned-list" className="flex flex-col gap-2">
        {marks.map(m => {
          const selected = m.id === selectedId;
          return (
            <li key={m.id} className="flex items-stretch gap-2">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(m.id)}
                className={`flex min-h-12 flex-1 items-center justify-between gap-2 rounded-xl border px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selected ? 'border-accent bg-surface-2 ring-2 ring-accent' : 'border-border bg-surface'
                }`}
              >
                <span className="tabular text-lg font-semibold">{markTime(m)}</span>
                <span className="text-xs text-muted">{selected ? 'Selecionada' : 'Tocar para selecionar'}</span>
              </button>
              <button
                type="button"
                aria-label={`Descartar marcação das ${markTime(m)}`}
                onClick={() => onDiscard(m)}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-border bg-surface text-xl text-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>
      {marks.length === 0 && <p className="text-sm text-muted">Nenhuma marcação sem atleta.</p>}
    </section>
  );
}

function OnCourseList({ tk, selectedMark, onTap }: {
  tk: Timekeeper; selectedMark: MarkRow | null; onTap: (item: OnCourseItem) => void;
}) {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [raceId, setRaceId] = useState<string | null>(null);
  const races = tk.session?.races ?? [];
  const multiRace = races.length > 1;
  const chips: { id: string | null; name: string }[] = [{ id: null, name: 'Todas' }, ...races.map(r => ({ id: r.id, name: r.name }))];

  const items = useMemo(() => {
    const q = fold(query.trim());
    return tk.onCourse.filter(item => {
      if (raceId !== null && item.race.id !== raceId) return false;
      if (!q) return true;
      const names = [item.displayName, ...item.entry.members.map(m => m.name ?? '')];
      return fold(item.entry.bib).includes(q) || names.some(n => fold(n).includes(q));
    });
  }, [tk.onCourse, query, raceId]);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <SectionTitle id={titleId}>Em prova ({tk.onCourse.length})</SectionTitle>
      <p className="text-xs text-muted">
        {selectedMark
          ? `Toque na inscrição para atribuir a marcação das ${markTime(selectedMark)}.`
          : 'Toque na inscrição na hora da passagem: marca e atribui de uma vez.'}
      </p>
      <input
        type="search"
        aria-label="Buscar nº ou nome"
        placeholder="Buscar nº ou nome"
        value={query}
        onChange={e => setQuery(e.target.value)}
        className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      {multiRace && (
        <div role="group" aria-label="Filtrar por prova" className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {chips.map(r => (
            <button
              key={r.id ?? 'all'}
              type="button"
              aria-pressed={raceId === r.id}
              onClick={() => setRaceId(r.id)}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                raceId === r.id ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface text-fg'
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      <ul data-testid="oncourse-list" className="flex flex-col gap-2">
        {items.map(item => (
          <li key={item.entry.id}>
            <OnCourseRow item={item} showRace={multiRace} onTap={() => onTap(item)} />
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <p className="text-sm text-muted">
          {tk.onCourse.length === 0
            ? 'Ninguém em prova ainda — a lista aparece quando a largada é dada.'
            : 'Nenhuma inscrição encontrada.'}
        </p>
      )}
    </section>
  );
}

function OnCourseRow({ item, showRace, onTap }: { item: OnCourseItem; showRace: boolean; onTap: () => void }) {
  const { entry, race, confirm } = item;
  const confirmText = confirm
    ? `✓ ${confirm.leg_label}${confirm.leg_ms !== null ? ` ${formatDuration(confirm.leg_ms)}` : ''} — toque para confirmar (${confirm.remaining_s}s)`
    : null;
  return (
    <button
      type="button"
      onClick={onTap}
      className={`flex min-h-16 w-full flex-col gap-0.5 rounded-xl border px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        confirm ? 'border-success bg-success/10' : 'border-border bg-surface'
      }`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="tabular text-2xl font-bold">Nº {entry.bib}</span>
        {item.legIndex !== null && <span className="tabular text-lg font-semibold">{formatDuration(item.legElapsedMs)}</span>}
      </span>
      <span className="truncate text-sm font-medium">
        {item.displayName}{showRace ? ` · ${race.name}` : ''}
      </span>
      {confirmText && <span className="tabular text-sm font-semibold text-success">{confirmText}</span>}
      <span className="text-sm text-muted">
        {item.legIndex !== null
          ? `${item.athleteName} · Perna ${item.legIndex + 1}/${race.legs.length} · ${item.legLabel}`
          : 'Concluiu'}
      </span>
    </button>
  );
}

const STATE_LABEL: Record<MyMark['state'], string> = { pending: '⏳ pendente', synced: '✓ sincronizada', rejected: '⚠ rejeitada' };

function MyMarksList({ tk, onDiscard, onRestore, onReassign, onChangeLeg }: {
  tk: Timekeeper; onDiscard: (m: MarkRow) => void; onRestore: (id: string) => void;
  onReassign: (m: MarkRow) => void; onChangeLeg: (id: string) => void;
}) {
  const index = tk.index;
  return (
    <details data-testid="my-marks" className="rounded-xl border border-border bg-surface">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">
        Minhas marcações ({tk.myMarks.length}){tk.rejectedCount > 0 ? ` · ⚠ ${tk.rejectedCount}` : ''}
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {tk.myMarks.map(({ mark, state, reason }) => {
          const entry = mark.entry_id ? index?.entriesById.get(mark.entry_id) : undefined;
          const race = entry ? index?.racesById.get(entry.race_id) : undefined;
          const time = markTime(mark);
          const what = mark.discarded
            ? `Descartada${mark.discarded_by === 'organizer' ? ' pela organização' : ''}`
            : entry && race && mark.leg_index !== null
              ? `Nº ${entry.bib} · ${legText(race, mark.leg_index)}`
              : 'Sem atleta';
          return (
            <li key={mark.id} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tabular font-semibold">{time}</span>
                <span className="text-sm">{what}</span>
                <span className={`ml-auto text-xs ${state === 'rejected' ? 'text-danger' : 'text-muted'}`}>{STATE_LABEL[state]}</span>
              </div>
              {state === 'rejected' && reason && <p className="text-sm text-danger">⚠ {reason}</p>}
              <div className="flex flex-wrap gap-2">
                {!mark.discarded && entry && race && race.legs.length > 1 && (
                  <Button size="sm" variant="secondary" aria-label={`Trocar perna da marcação das ${time}`} onClick={() => onChangeLeg(mark.id)}>
                    Perna
                  </Button>
                )}
                {!mark.discarded && entry && (
                  <Button size="sm" variant="secondary" aria-label={`Reatribuir a marcação das ${time}`} onClick={() => onReassign(mark)}>
                    Reatribuir
                  </Button>
                )}
                {!mark.discarded && (
                  <Button size="sm" variant="ghost" aria-label={`Descartar marcação das ${time}`} onClick={() => onDiscard(mark)}>
                    Descartar
                  </Button>
                )}
                {mark.discarded && mark.discarded_by !== 'organizer' && (
                  <Button size="sm" variant="secondary" aria-label={`Restaurar a marcação das ${time}`} onClick={() => onRestore(mark.id)}>
                    Restaurar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {tk.myMarks.length === 0 && <p className="px-4 pb-3 text-sm text-muted">Nenhuma marcação ainda.</p>}
    </details>
  );
}

function LegSheet({ tk, markId, onClose, onPick }: {
  tk: Timekeeper; markId: string | null; onClose: () => void; onPick: (markId: string, legIndex: number) => void;
}) {
  const mark = markId ? tk.marks.find(m => m.id === markId) : undefined;
  const entry = mark?.entry_id ? tk.index?.entriesById.get(mark.entry_id) : undefined;
  const race = entry ? tk.index?.racesById.get(entry.race_id) : undefined;
  return (
    <Modal open={markId !== null && !!entry && !!race} onClose={onClose} title="Trocar perna">
      {mark && entry && race && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Nº {entry.bib} · marcação das <span className="tabular">{markTime(mark)}</span>
          </p>
          <ul className="flex flex-col gap-2">
            {race.legs.map((leg, k) => {
              const athlete = memberName(entry, legAthleteId(entry, k));
              return (
                <li key={k}>
                  <Button
                    variant={mark.leg_index === k ? 'primary' : 'secondary'}
                    size="lg"
                    className="w-full justify-start"
                    aria-current={mark.leg_index === k ? 'true' : undefined}
                    onClick={() => onPick(mark.id, k)}
                  >
                    Perna {k + 1}/{race.legs.length} · {leg.label}{athlete ? ` — ${athlete}` : ''}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
