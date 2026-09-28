import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Card, Table } from '../../components/ui';
import { YearSelect } from '../../components/YearSelect';
import { MODALITY_ORDER } from '../../domain/clubStats';
import { computeHeadToHead, computeTogether } from '../../domain/pairStats';
import type { HeadToHead, HeadToHeadSide, TogetherStats } from '../../domain/pairStats';
import { MODALITY_LABEL } from '../../domain/presets';
import { computeAthleteStats, filterResultsByYear, resultYears } from '../../domain/stats';
import type { AthleteStats } from '../../domain/stats';
import { formatDateBR, formatDistance, formatDuration } from '../../lib/format';
import type { Modality, PublicAthleteRow } from '../../lib/types';
import { useYearParam } from '../../lib/useYearParam';
import { STATUS_LABEL, STATUS_TONE, ordinal, percent } from '../athletes/statsFormat';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { usePublicStats } from './usePublicStats';

const PACE_ORDER: Modality[] = ['run', 'swim', 'bike']; // Ruling 20: no pace for 'other'

/** Side-by-side rows (spec 2026-09-28 §3.4): the profile tiles, then pace per modality and personal
 * records per (modality, distance) that at least one of the two has ("—" on the other side). */
function sideBySideRows(sa: AthleteStats, sb: AthleteStats): { label: string; a: string; b: string }[] {
  const rows = [
    { label: 'Participações', a: String(sa.participations), b: String(sb.participations) },
    { label: 'Conclusões', a: String(sa.finishes), b: String(sb.finishes) },
    { label: 'Vitórias gerais', a: String(sa.wins_overall), b: String(sb.wins_overall) },
    { label: 'Vitórias na categoria', a: String(sa.wins_category), b: String(sb.wins_category) },
    { label: 'Pódios', a: String(sa.podiums), b: String(sb.podiums) },
    { label: 'Melhor colocação', a: ordinal(sa.best_overall_pos), b: ordinal(sb.best_overall_pos) },
    { label: 'Top X% médio', a: percent(sa.avg_percentile), b: percent(sb.avg_percentile) },
  ];
  for (const m of PACE_ORDER) {
    const pa = sa.pace_by_modality.find((p) => p.modality === m);
    const pb = sb.pace_by_modality.find((p) => p.modality === m);
    if (pa || pb) rows.push({ label: `Ritmo · ${MODALITY_LABEL[m]}`, a: pa?.pace || '—', b: pb?.pace || '—' });
  }
  const keys = new Map<string, { modality: Modality; distance_m: number }>();
  for (const r of [...sa.records, ...sb.records]) keys.set(`${r.modality}|${r.distance_m}`, { modality: r.modality, distance_m: r.distance_m });
  const sorted = [...keys.values()].sort((x, y) => MODALITY_ORDER.indexOf(x.modality) - MODALITY_ORDER.indexOf(y.modality) || x.distance_m - y.distance_m);
  for (const k of sorted) {
    const ra = sa.records.find((r) => r.modality === k.modality && r.distance_m === k.distance_m);
    const rb = sb.records.find((r) => r.modality === k.modality && r.distance_m === k.distance_m);
    rows.push({
      label: `Recorde · ${MODALITY_LABEL[k.modality]} ${formatDistance(k.distance_m)}`,
      a: ra ? formatDuration(ra.time_ms) : '—',
      b: rb ? formatDuration(rb.time_ms) : '—',
    });
  }
  return rows;
}

function sideText(s: HeadToHeadSide): string {
  return s.overall_pos !== null ? `${formatDuration(s.final_ms)} · ${s.overall_pos}º` : STATUS_LABEL[s.status];
}

function diffText(diff: number | null, a: string, b: string): string {
  if (diff === null) return '—';
  if (diff === 0) return 'mesmo tempo';
  return `${diff > 0 ? a : b} por ${formatDuration(Math.abs(diff))}`;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <PublicShell>
      <div data-testid="public-compare" className="mx-auto w-full max-w-md px-4 py-12">
        <Card className="flex flex-col gap-4">{children}</Card>
      </div>
    </PublicShell>
  );
}

function TogetherSection({ together }: { together: TogetherStats }) {
  const s = together.summary;
  const tiles = [
    { label: 'Provas juntos', value: String(s.participations) },
    { label: 'Conclusões', value: String(s.finishes) },
    { label: 'Vitórias gerais', value: String(s.wins_overall) },
    { label: 'Vitórias na categoria', value: String(s.wins_category) },
    { label: 'Pódios', value: String(s.podiums) },
    { label: 'Melhor colocação', value: ordinal(s.best_overall_pos) },
    { label: 'Top X% médio', value: percent(s.avg_percentile) },
  ];
  return (
    <section data-testid="compare-together" className="flex flex-col gap-3">
      <h2 className="brand-title text-sm font-semibold">Juntos</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t.label}</span>
            <span className="text-2xl font-semibold text-fg">{t.value}</span>
          </Card>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {together.races.map((r) => (
          <li key={r.entry_id} className="rounded-xl border border-border p-3">
            <p className="font-medium">
              {r.event_name} · {formatDateBR(r.event_date)} · {r.race_name}
              {r.team_name ? ` · ${r.team_name}` : ''}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              <span className="tabular">{formatDuration(r.final_ms)}</span>
              {r.overall_pos !== null && <span className="text-muted tabular">{r.overall_pos}º de {r.finishers}</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              {r.members.map((m) => `${m.name}: ${m.legs.map((l) => `${l.label} ${formatDuration(l.time_ms)}`).join(', ')}`).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HeadToHeadSection({ h2h, a, b }: { h2h: HeadToHead; a: PublicAthleteRow; b: PublicAthleteRow }) {
  return (
    <section data-testid="compare-head-to-head" className="flex flex-col gap-3">
      <h2 className="brand-title text-sm font-semibold">Confronto direto</h2>
      <p className="text-2xl font-semibold tabular">
        {a.name} {h2h.a_wins} × {h2h.b_wins} {b.name}
      </p>
      {h2h.no_decision > 0 && (
        <p className="text-sm text-muted">{h2h.no_decision} sem decisão (nenhum dos dois terminou com colocação, ou empataram)</p>
      )}
      <Table>
        <thead>
          <tr>
            <th className="px-3 py-2" scope="col">Prova</th>
            <th className="px-3 py-2" scope="col">{a.name}</th>
            <th className="px-3 py-2" scope="col">{b.name}</th>
            <th className="px-3 py-2" scope="col">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {h2h.races.map((r) => (
            <tr key={r.race_id} className="border-t border-border">
              <td className="px-3 py-2">{r.event_name} · {formatDateBR(r.event_date)} · {r.race_name}</td>
              <td className={`px-3 py-2 tabular ${r.winner === 'a' ? 'font-semibold' : ''}`}>{sideText(r.a)}</td>
              <td className={`px-3 py-2 tabular ${r.winner === 'b' ? 'font-semibold' : ''}`}>{sideText(r.b)}</td>
              <td className="px-3 py-2 tabular">{diffText(r.diff_ms, a.name, b.name)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

/** #/comparar/:a/:b — "Nós dois" (spec 2026-09-28 §3.4): side by side, together, head-to-head. */
export default function PublicComparePage() {
  const { a: aId, b: bId } = useParams<{ a: string; b: string }>();
  const query = usePublicStats();
  const data = query.data;
  const a = data?.athletes.find((x) => x.id === aId);
  const b = data?.athletes.find((x) => x.id === bId);
  const results = useMemo(() => data?.results ?? [], [data]);
  const years = useMemo(
    () => resultYears(results.filter((r) => (a !== undefined && r.athlete_ids.includes(a.id)) || (b !== undefined && r.athlete_ids.includes(b.id)))),
    [results, a, b],
  );
  const [year, setYear] = useYearParam(years);
  const view = useMemo(() => {
    if (!a || !b || a.id === b.id) return null;
    const inYear = filterResultsByYear(results, year);
    const of = (id: string) => inYear.filter((r) => r.athlete_ids.includes(id));
    return {
      sa: computeAthleteStats(a.id, of(a.id)),
      sb: computeAthleteStats(b.id, of(b.id)),
      together: computeTogether(a.id, b.id, inYear),
      h2h: computeHeadToHead(a.id, b.id, inYear),
    };
  }, [a, b, results, year]);

  useEffect(() => {
    if (a && b) document.title = `${a.name} × ${b.name} – EnduranceBaseClub`;
  }, [a, b]);
  useEffect(() => () => { document.title = 'EnduranceBaseClub'; }, []);

  if (!data) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-compare" />
      </PublicShell>
    );
  }
  if (aId === bId) {
    return (
      <Notice>
        <p role="alert" className="text-sm text-fg">Escolha dois atletas diferentes</p>
        <Link to={`/atleta/${aId}`} className="text-sm text-muted underline underline-offset-2 hover:text-fg">Ver o perfil</Link>
      </Notice>
    );
  }
  if (!a || !b || !view) {
    return (
      <Notice>
        <p role="alert" className="text-sm text-danger-text">Atleta não encontrado ou perfil privado</p>
        <Link to="/perfis" className="text-sm text-muted underline underline-offset-2 hover:text-fg">Ver todos os atletas</Link>
      </Notice>
    );
  }

  const search = year ? `?ano=${year}` : '';
  return (
    <PublicShell>
      <div data-testid="public-compare" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="brand-title text-xl font-semibold">
            <Link to={`/atleta/${a.id}${search}`} className="hover:underline">{a.name}</Link>
            {' × '}
            <Link to={`/atleta/${b.id}${search}`} className="hover:underline">{b.name}</Link>
          </h1>
          <YearSelect years={years} value={year} onChange={setYear} />
        </div>

        <section data-testid="compare-side-by-side" className="flex flex-col gap-2">
          <h2 className="brand-title text-sm font-semibold">Lado a lado</h2>
          {/* min-w-0!: the kit's tables keep max-content width and scroll inside their box; here
              both athletes' columns must stay on a 390 px screen, so the labels wrap instead. */}
          <Table className="min-w-0!">
            <thead>
              <tr>
                <th className="px-3 py-2" scope="col"><span className="sr-only">Estatística</span></th>
                <th className="px-3 py-2" scope="col">{a.name}</th>
                <th className="px-3 py-2" scope="col">{b.name}</th>
              </tr>
            </thead>
            <tbody>
              {sideBySideRows(view.sa, view.sb).map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted">{r.label}</th>
                  <td className="px-3 py-2 tabular">{r.a}</td>
                  <td className="px-3 py-2 tabular">{r.b}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>

        {view.together && <TogetherSection together={view.together} />}
        {view.h2h && <HeadToHeadSection h2h={view.h2h} a={a} b={b} />}
        {!view.together && !view.h2h && (
          <p className="text-sm text-muted">Vocês ainda não correram juntos nem na mesma prova.</p>
        )}
      </div>
    </PublicShell>
  );
}
