import { useMemo } from 'react';
import { Link } from 'react-router';
import { computeAthleteStats } from '../../domain/stats';
import { MODALITY_LABEL } from '../../domain/presets';
import { formatDateBR, formatDistance, formatDuration, formatKm } from '../../lib/format';
import { LineChart } from '../../components/LineChart';
import { Badge, Card, EmptyState, Table } from '../../components/ui';
import type { AthleteRow, Modality, ResultRow } from '../../lib/types';
import { STATUS_LABEL, STATUS_TONE, ordinal, percent } from './statsFormat';

export interface StatsViewProps {
  athlete: Pick<AthleteRow, 'id'>;
  results: ResultRow[];
  /** Reused as-is by the public athlete page (Task 26): hides nothing (stats only ever use
   * public data) but routes team-partner links to the public profile instead of the organizer one. */
  publicMode?: boolean;
  /** Where a team partner's name links to; null = plain text. Without it: the organizer profile
   * (`/atletas/:id`) outside public mode, plain text in public mode (C-Minor-16). The public
   * profile passes one that links public partners to "Nós dois" (2026-09-28 §3.3). */
  partnerLink?: (athleteId: string) => string | null;
}

/** Ruling 20: pace_by_modality never carries 'other'; this fixes the display order for the ones it does. */
const PACE_MODALITY_ORDER: Modality[] = ['run', 'swim', 'bike'];

export function StatsView({ athlete, results, publicMode = false, partnerLink }: StatsViewProps) {
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
                {(() => {
                  const href = partnerLink ? partnerLink(p.athlete_id) : publicMode ? null : `/atletas/${p.athlete_id}`;
                  return href ? (
                    <Link to={href} className="text-sm text-fg underline underline-offset-2 hover:text-muted">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="text-sm text-fg">{p.name}</span>
                  );
                })()}
                <span className="ml-2 text-sm text-muted tabular">×{p.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
