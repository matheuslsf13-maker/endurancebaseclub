// The timekeeper app (`#/c/:token`, spec §7.3): mobile-first, no admin layout. One big MARCAR
// button stamps the synced instant; marks are identified by bib or by tapping the entry in
// "Em prova". Everything a timekeeper does is kept on the device first (useTimekeeper).

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { useParams } from 'react-router';
import { Button, Input, Modal, Spinner, useToast } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import type { ClockSync } from '../../lib/clock';
import { formatClock, formatDateBR, formatDuration } from '../../lib/format';
import { safeLocalStorage } from '../../lib/storage';
import type { MarkRow } from '../../lib/types';
import { legAthleteId } from '../../domain/eventModel';
import { burstHead, currentBurst, legText, memberName, selectedMarkId, selectionAfterMark, tapTargetId } from './tkStore';
import type { OnCourseItem, Selection } from './tkStore';
import { useTimekeeper } from './useTimekeeper';
import type { AssignResult, MyMark, TapStamp, Timekeeper } from './useTimekeeper';

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

/** A click this soon after a pointer press on the same control is that press's own click. */
const CLICK_AFTER_POINTER_MS = 1_000;
/** A press whose finger moved farther than this is a scroll or a drag, not a tap. */
const TAP_SLOP_PX = 16;

/** The click a pointer press produces itself (handled on the press): it counts clicks (detail ≥ 1)
 * and follows the press within a second. Keyboard clicks (detail 0) are never one. */
function isClickOfPress(e: MouseEvent<HTMLButtonElement>, lastPointerAt: number): boolean {
  return e.detail > 0 && e.timeStamp - lastPointerAt < CLICK_AFTER_POINTER_MS;
}

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
          {tk.pendingCount > 0 ? (
            <p className="text-sm text-muted">
              Suas marcações continuam guardadas neste aparelho ({tk.pendingCount} ainda não {tk.pendingCount === 1 ? 'enviada' : 'enviadas'}).
              Abra o novo link neste mesmo aparelho para enviá-las.
            </p>
          ) : tk.myMarks.length > 0 && (
            <p className="text-sm text-muted">Suas marcações continuam guardadas neste aparelho.</p>
          )}
        </Centered>
      );
    case 'other_tab':
      return (
        <Centered>
          <Logo size={64} />
          <h1 className="brand-title text-lg font-semibold">Link já aberto</h1>
          <p>Este link já está aberto em outra aba deste aparelho — use aquela aba</p>
          <p className="text-sm text-muted">Se você fechar a outra aba, esta assume a cronometragem.</p>
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

/** An "Em prova" tap, fixed when the finger lands: the list may move under it before it lifts. */
interface RowTap { item: OnCourseItem; stamp: TapStamp; markId: string | null }
interface RowPress extends RowTap { pointerId: number; x: number; y: number }

function MainScreen({ tk }: { tk: Timekeeper }) {
  const toast = useToast();
  const [bib, setBib] = useState('');
  // Which "Sem atleta" mark a bib or an "Em prova" tap goes to (tkStore `Selection`, Rulings 53
  // and 54): the oldest of the current burst unless one was picked; `none` = deselected, so
  // "Em prova" taps mark new arrivals.
  const [sel, setSel] = useState<Selection>({ mode: 'auto' });
  const [legSheet, setLegSheet] = useState<string | null>(null);
  const assignToastId = useRef<string | null>(null);
  const lastMarkPointer = useRef(Number.NEGATIVE_INFINITY);
  const rowPress = useRef<RowPress | null>(null);
  const lastRowPointer = useRef(Number.NEGATIVE_INFINITY);
  const bibId = useId();
  const selectedId = selectedMarkId(sel, tk.unassigned, tk.nowMs); // where a typed bib goes
  const rowTargetId = tapTargetId(sel, tk.unassigned, tk.nowMs); // what an "Em prova" tap identifies
  const burstIds = new Set(currentBurst(tk.unassigned, tk.nowMs).map(m => m.id));
  const rowTargetMark = rowTargetId ? tk.unassigned.find(m => m.id === rowTargetId) ?? null : null;

  function showAssigned(r: Extract<AssignResult, { ok: true }>) {
    if (assignToastId.current) toast.dismiss(assignToastId.current);
    const markId = r.markId;
    const warned = r.warning !== null || r.suggestion.warning !== null;
    let id = '';
    const act = (fn: () => void) => () => {
      toast.dismiss(id);
      fn();
    };
    // Neutral tone (opaque) and the actions under the text: the kit's tinted tones are see-through
    // and its action row leaves the message a narrow column on a phone.
    id = toast.show({
      testid: 'assign-toast',
      durationMs: 8_000,
      message: (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">
            {warned && <span aria-hidden="true" className="text-warning">⚠ </span>}
            {r.message}
          </p>
          {r.warning && r.warning !== r.message && <p className="text-warning">{r.warning}</p>}
          <p className="tabular text-xs text-muted">Marcação das {clockText(Date.parse(r.ts))}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button
              size="sm" variant="secondary" data-testid="toast-undo"
              onClick={act(() => {
                tk.unassign(markId);
                setSel({ mode: 'id', id: markId, origin: 'user' });
              })}
            >
              Desfazer
            </Button>
            {r.race.legs.length > 1 && (
              <Button size="sm" variant="secondary" data-testid="toast-change-leg" onClick={act(() => setLegSheet(markId))}>
                Trocar perna
              </Button>
            )}
          </div>
        </div>
      ),
    });
    assignToastId.current = id;
  }

  /** Error toast: opaque neutral tone (see showAssigned) announced as an alert by its content. */
  function showError(message: string) {
    toast.show({
      message: (
        <p role="alert" className="font-semibold">
          <span aria-hidden="true" className="text-danger">⚠ </span>
          {message}
        </p>
      ),
    });
  }

  function report(r: AssignResult) {
    if (r.ok) showAssigned(r);
    else showError(r.error);
  }

  function doMark() {
    // useTimekeeper reads the synced clock first thing in mark(): nothing here may run before it.
    const { markId, ts, assignment } = tk.mark(bib);
    vibrate();
    if (assignment?.ok) {
      setBib('');
      showAssigned(assignment);
      return;
    }
    if (assignment) {
      // The bib typed belongs to this mark: select it explicitly, so the corrected bib goes to it
      // — not to an older mark still waiting — however long the correction takes.
      showError(assignment.error);
      setSel({ mode: 'id', id: markId, origin: 'app' });
      return;
    }
    // Spec §7.3.2 with Rulings 53 and 54: after a deselection the new mark is selected; otherwise
    // the automatic pick follows the burst the new mark belongs to — its oldest mark, so bibs typed
    // in arrival order land on marks 1, 2, 3… A selection tapped before that burst never outlives
    // a new tap: it would take this arrival's bib.
    setSel(current => selectionAfterMark(current, tk.unassigned, { id: markId, ts }));
  }

  // Marks on pointerdown — the instant the finger lands, and a tap that turns into a slight drag
  // still counts. The click of the same press is ignored by its time (a press that slid off the
  // button has no click, and must not swallow a later one); keyboard presses and screen-reader
  // activations come without a pointer press and mark on click.
  function onMarkPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    doMark();
    lastMarkPointer.current = e.timeStamp;
    // Keeps the focus — and the phone keyboard — in the bib field; the click still fires.
    e.preventDefault();
  }
  function onMarkPointerUp(e: PointerEvent<HTMLButtonElement>) {
    lastMarkPointer.current = e.timeStamp; // a long press: its click comes when the finger lifts
  }
  function onMarkClick(e: MouseEvent<HTMLButtonElement>) {
    if (isClickOfPress(e, lastMarkPointer.current)) return;
    doMark();
  }
  function onMarkKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // A held Enter repeats its click: one press, one mark.
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
  }

  function onBibSubmit(e: FormEvent) {
    e.preventDefault();
    const text = bib.trim();
    if (!text) {
      toast.show({ message: 'Digite o nº de peito' });
      return;
    }
    // The selected mark, else the oldest of the current burst (Ruling 53) — none once it went
    // stale: then a mark must be picked.
    const target = selectedId ?? burstHead(tk.unassigned, tk.nowMs)?.id ?? null;
    if (!target) {
      toast.show({
        message: tk.unassigned.length > 0
          ? 'Toque em MARCAR primeiro, ou selecione a marcação em "Sem atleta"'
          : 'Toque em MARCAR primeiro',
      });
      return;
    }
    const r = tk.assignBib(target, text);
    if (r.ok) setBib('');
    report(r);
  }

  function commitRowTap({ item, stamp, markId }: RowTap) {
    // Ruling 10: never pass the row's current athlete — confirming a relay handoff shows the
    // next athlete as current, and the leg must come from the crossing times.
    if (markId && tk.unassigned.some(m => m.id === markId)) {
      report(tk.assign(markId, item.entry.id));
      return;
    }
    const { markId: newId } = tk.mark(undefined, stamp); // arrival tap: the instant of the press
    vibrate();
    const r = tk.assign(newId, item.entry.id);
    if (!r.ok) setSel({ mode: 'id', id: newId, origin: 'app' });
    report(r);
  }

  // "Em prova" rows move (pinned crossings arrive with every sync, windows close): what a press
  // does — the entry, the mark it identifies, the instant — is fixed on pointerdown and committed
  // on pointerup, wherever the finger is then, if it barely moved (a scroll cancels it).
  const commitLatest = useRef(commitRowTap);
  useLayoutEffect(() => {
    commitLatest.current = commitRowTap;
  });
  useEffect(() => {
    const up = (e: globalThis.PointerEvent) => {
      const press = rowPress.current;
      if (!press || e.pointerId !== press.pointerId) return;
      rowPress.current = null;
      lastRowPointer.current = e.timeStamp;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) return;
      commitLatest.current(press);
    };
    const cancel = (e: globalThis.PointerEvent) => {
      if (rowPress.current?.pointerId === e.pointerId) rowPress.current = null;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  function onRowPointerDown(item: OnCourseItem, e: PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const stamp = tk.stamp(); // the instant the finger landed
    lastRowPointer.current = e.timeStamp;
    rowPress.current = { item, stamp, markId: rowTargetId, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    // Keeps the focus — and the phone keyboard — in the bib field; the click still fires, and a
    // scroll still starts (it is not a default action of pointerdown).
    e.preventDefault();
  }
  function onRowClick(item: OnCourseItem, e: MouseEvent<HTMLButtonElement>) {
    // The click of a press already handled when the finger lifted (it may land on another row, or
    // on none, when the list moved). Keyboard and screen-reader activations tap here.
    if (isClickOfPress(e, lastRowPointer.current)) return;
    commitRowTap({ item, stamp: tk.stamp(), markId: rowTargetId });
  }

  function toggleSelect(id: string) {
    setSel(id === selectedId ? { mode: 'none' } : { mode: 'id', id, origin: 'user' });
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
    if (m.discarded) tk.restore(m.id); // a rejected mark discarded here goes back to "Sem atleta"
    setSel({ mode: 'id', id: m.id, origin: 'user' });
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
          onPointerUp={onMarkPointerUp}
          onMouseDown={e => e.preventDefault()}
          onClick={onMarkClick}
          onKeyDown={onMarkKeyDown}
          onContextMenu={e => e.preventDefault()}
          className="brand-title min-h-[35vh] w-full touch-none select-none rounded-2xl bg-accent text-5xl font-bold text-accent-fg shadow-lg transition-transform active:scale-[0.98] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Marcar
        </button>

        <UnassignedList marks={tk.unassigned} burstIds={burstIds} selectedId={selectedId} onSelect={toggleSelect} onDiscard={onDiscard} />

        <OnCourseList tk={tk} targetMark={rowTargetMark} onRowPointerDown={onRowPointerDown} onRowClick={onRowClick} />

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
          <p data-testid="tk-sync-status" role="status" aria-live="polite" className="flex items-start gap-1.5 text-xs leading-tight text-muted">
            <span aria-hidden="true" className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
            {/* Wraps instead of truncating: the offline count is what the timekeeper must see. */}
            <span>{text}</span>
          </p>
        </div>
        <ThemeToggle />
      </div>
      {tk.rejectedCount > 0 && (
        <p className="mx-auto max-w-xl px-4 pb-2 text-xs font-medium text-warning">
          ⚠ {tk.rejectedCount === 1 ? '1 marcação recusada' : `${tk.rejectedCount} marcações recusadas`} — veja “Minhas marcações”
        </p>
      )}
      {tk.storageFailed && (
        <p role="alert" className="mx-auto max-w-xl px-4 pb-2 text-xs font-semibold text-danger">
          ⚠ Não foi possível guardar as marcações neste aparelho (memória cheia ou bloqueada) — não feche nem
          recarregue esta página até tudo sincronizar.
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

function UnassignedList({ marks, burstIds, selectedId, onSelect, onDiscard }: {
  marks: MarkRow[]; burstIds: Set<string>; selectedId: string | null; onSelect: (id: string) => void; onDiscard: (m: MarkRow) => void;
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
                <span className="text-xs text-muted">
                  {selected ? 'Selecionada' : burstIds.has(m.id) ? 'Tocar para selecionar' : 'Mais de 1 min · tocar para selecionar'}
                </span>
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

function OnCourseList({ tk, targetMark, onRowPointerDown, onRowClick }: {
  tk: Timekeeper; targetMark: MarkRow | null;
  onRowPointerDown: (item: OnCourseItem, e: PointerEvent<HTMLButtonElement>) => void;
  onRowClick: (item: OnCourseItem, e: MouseEvent<HTMLButtonElement>) => void;
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
        {targetMark
          ? `Toque na inscrição para atribuir a marcação das ${markTime(targetMark)}.`
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
            <OnCourseRow
              item={item} showRace={multiRace}
              onPointerDown={e => onRowPointerDown(item, e)} onClick={e => onRowClick(item, e)}
            />
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

function OnCourseRow({ item, showRace, onPointerDown, onClick }: {
  item: OnCourseItem; showRace: boolean;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void; onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { entry, race, confirm } = item;
  const legTime = confirm && confirm.leg_ms !== null ? ` ${formatDuration(confirm.leg_ms)}` : '';
  // A crossing this device already counts is not offered again: a second tap would only be a
  // duplicate of its own mark (Ruling 44 M8).
  const confirmText = confirm
    ? confirm.mine
      ? `✓ marcada por você · ${confirm.leg_label}${legTime}`
      : `✓ ${confirm.leg_label}${legTime} — toque para confirmar (${confirm.remaining_s}s)`
    : null;
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
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
          // Any rejected mark can be identified again — even one whose entry no longer exists —
          // except a discard by the organization, which the timekeeper cannot undo.
          const canReassign = state === 'rejected' ? mark.discarded_by !== 'organizer' : !mark.discarded && !!entry;
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
                {canReassign && (
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
