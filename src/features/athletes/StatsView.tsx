import { useMemo } from 'react';
import { Link } from 'react-router';
import { computeAthleteStats } from '../../domain/stats';
import { MODALITY_LABEL } from '../../domain/presets';
import { formatDateBR, formatDuration } from '../../lib/format';
import { LineChart } from '../../components/LineChart';
import { Badge, Card, EmptyState, Table } from '../../components/ui';
import type { AthleteRow, Modality, ResultRow, SnapshotStatus } from '../../lib/types';

export interface StatsViewProps {
  athlete: AthleteRow;
  results: ResultRow[];
  /** Reused as-is by the public athlete page (Task 26): hides nothing (stats only ever use
   * public data) but routes team-partner links to the public profile instead of the organizer one. */
  publicMode?: boolean;
}

const STATUS_LABEL: Record<SnapshotStatus, string> = {
  finished: 'Concluído', on_course: 'Em prova', not_started: 'Não iniciado', dnf: 'DNF', dns: 'DNS', dsq: 'DSQ',
};
const STATUS_TONE: Record<SnapshotStatus, 'success' | 'danger' | 'neutral'> = {
  finished: 'success', dnf: 'danger', dsq: 'danger', on_course: 'neutral', not_started: 'neutral', dns: 'neutral',
};
/** Ruling 20: pace_by_modality never carries 'other'; this fixes the display order for the ones it does. */
const PACE_MODALITY_ORDER: Modality[] = ['run', 'swim', 'bike'];

function ordinal(pos: number | null): string {
  return pos === null ? '—' : `${pos}º`;
}

function percent(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function formatDistance(m: number): string {
  if (m >= 1000) {
    const km = m / 1000;
    const value = Number.isInteger(km) ? String(km) : km.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    return `${value} km`;
  }
  return `${m} m`;
}

function formatKm(km: number): string {
  return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`;
}

export function StatsView({ athlete, results, publicMode = false }: StatsViewProps) {
  const stats = useMemo(() => computeAthleteStats(athlete.id, results), [athlete.id, results]);

  if (results.length === 0) {
    return (
      <EmptyState title="Sem resultados oficiais ainda">
        As estatísticas aparecem quando a organização finaliza as provas.
      </EmptyState>
    );
  }

  const tiles: { label: string; value: string }[] = [
    { label: 'Participações', value: String(stats.participations) },
    { label: 'Conclusões', value: String(stats.finishes) },
    { label: 'Vitórias gerais', value: String(stats.wins_overall) },
    { label: 'Vitórias na categoria', value: String(stats.wins_category) },
    { label: 'Pódios', value: String(stats.podiums) },
    { label: 'Melhor colocação', value: ordinal(stats.best_overall_pos) },
    { label: 'Top X% médio', value: percent(stats.avg_percentile) },
  ];

  const paceRows = PACE_MODALITY_ORDER
    .map((m) => stats.pace_by_modality.find((p) => p.modality === m))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  const kmRows = (Object.keys(stats.km_by_modality) as Modality[])
    .filter((m) => stats.km_by_modality[m])
    .map((m) => ({ modality: m, km: stats.km_by_modality[m]! }));

  const evolution = stats.evolution;
  const evolutionPoints = evolution
    ? evolution.points.map((p) => ({ label: formatDateBR(p.date), value: p.time_ms, tooltip: p.event_name }))
    : [];
  const evolutionTitle = evolution
    ? `Evolução — ${MODALITY_LABEL[evolution.modality]} ${formatDistance(evolution.distance_m)}`
    : 'Evolução';

  const partnerHref = (id: string) => (publicMode ? `/atleta/${id}` : `/atletas/${id}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t.label}</span>
            <span className="text-2xl font-semibold text-fg">{t.value}</span>
          </Card>
        ))}
      </div>

      <section>
        <h3 className="brand-title mb-2 text-sm font-semibold text-fg">Recordes pessoais</h3>
        {stats.records.length === 0 ? (
          <EmptyState title="Sem recordes ainda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="px-3 py-2" scope="col">Modalidade</th>
                <th className="px-3 py-2" scope="col">Distância</th>
                <th className="px-3 py-2" scope="col">Tempo</th>
                <th className="px-3 py-2" scope="col">Ritmo</th>
                <th className="px-3 py-2" scope="col">Evento</th>
              </tr>
            </thead>
            <tbody>
              {stats.records.map((r) => (
                <tr key={`${r.modality}-${r.distance_m}`} className="border-t border-border">
                  <td className="px-3 py-2">{MODALITY_LABEL[r.modality]}</td>
                  <td className="px-3 py-2 tabular">{formatDistance(r.distance_m)}</td>
                  <td className="px-3 py-2 tabular">{formatDuration(r.time_ms)}</td>
                  <td className="px-3 py-2 tabular">{r.pace}</td>
                  <td className="px-3 py-2">
                    {r.event_name} · {formatDateBR(r.event_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <h3 className="brand-title mb-2 text-sm font-semibold text-fg">Ritmo por modalidade</h3>
        {paceRows.length === 0 ? (
          <EmptyState title="Sem dados de ritmo ainda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="px-3 py-2" scope="col">Modalidade</th>
                <th className="px-3 py-2" scope="col">Ritmo</th>
              </tr>
            </thead>
            <tbody>
              {paceRows.map((p) => (
                <tr key={p.modality} className="border-t border-border">
                  <td className="px-3 py-2">{MODALITY_LABEL[p.modality]}</td>
                  <td className="px-3 py-2 tabular">{p.pace}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <h3 className="brand-title mb-2 text-sm font-semibold text-fg">Km em prova</h3>
        {kmRows.length === 0 ? (
          <EmptyState title="Sem quilometragem ainda" />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {kmRows.map((k) => (
              <li key={k.modality}>
                <Badge tone="neutral">
                  {MODALITY_LABEL[k.modality]}: {formatKm(k.km)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <LineChart points={evolutionPoints} formatValue={(v) => formatDuration(v)} title={evolutionTitle} />
      </section>

      <section>
        <h3 className="brand-title mb-2 text-sm font-semibold text-fg">Histórico</h3>
        <Table>
          <thead>
            <tr>
              <th className="px-3 py-2" scope="col">Evento</th>
              <th className="px-3 py-2" scope="col">Prova</th>
              <th className="px-3 py-2" scope="col">Categoria</th>
              <th className="px-3 py-2" scope="col">Status</th>
              <th className="px-3 py-2" scope="col">Posição</th>
              <th className="px-3 py-2" scope="col">Tempo final</th>
              <th className="px-3 py-2" scope="col">Pódios</th>
            </tr>
          </thead>
          <tbody>
            {stats.history.map((h, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">
                  {h.event_name} · {formatDateBR(h.event_date)}
                </td>
                <td className="px-3 py-2">{h.race_name}</td>
                <td className="px-3 py-2">{h.category}</td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[h.status]}>{STATUS_LABEL[h.status]}</Badge>
                </td>
                <td className="px-3 py-2 tabular">
                  {ordinal(h.overall_pos)} / {h.finishers}
                </td>
                <td className="px-3 py-2 tabular">{formatDuration(h.final_ms)}</td>
                <td className="px-3 py-2">{h.podiums.join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {stats.partners.length > 0 && (
        <section>
          <h3 className="brand-title mb-2 text-sm font-semibold text-fg">Parceiros de equipe</h3>
          <ul className="flex flex-col gap-1">
            {stats.partners.map((p) => (
              <li key={p.athlete_id}>
                <Link
                  to={partnerHref(p.athlete_id)}
                  className="text-sm text-fg underline underline-offset-2 hover:text-muted"
                >
                  {p.name}
                </Link>
                <span className="ml-2 text-sm text-muted tabular">×{p.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
