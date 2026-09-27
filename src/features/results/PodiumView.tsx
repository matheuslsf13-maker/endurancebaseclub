import { Card, EmptyState } from '../../components/ui';
import { entryLabel } from './ClassificationTable';
import type { PodiumGroup, RaceClassification } from '../../domain/ranking';
import { formatDuration } from '../../lib/format';
import type { AthleteRow, RankingDef } from '../../lib/types';

export interface PodiumViewProps {
  cls: RaceClassification;
  /** Same requirement as `ClassificationTable`'s: entries only carry `athlete_id`, so a name
   * needs a lookup map. See that component's doc comment. */
  athletesById: Map<string, AthleteRow>;
}

const PLACE_LABEL = ['1º', '2º', '3º'];

interface RankingBlock { ranking: RankingDef; groups: PodiumGroup[] }

/** `cls.podiums` is already ranking-then-group ordered (spec §9, `classifyRace`); this just folds
 * the flat list back into one block per ranking so each renders under a single heading. */
function byRanking(podiums: PodiumGroup[]): RankingBlock[] {
  const blocks: RankingBlock[] = [];
  for (const group of podiums) {
    const last = blocks[blocks.length - 1];
    if (last && last.ranking.id === group.ranking.id) last.groups.push(group);
    else blocks.push({ ranking: group.ranking, groups: [group] });
  }
  return blocks;
}

export function PodiumView({ cls, athletesById }: PodiumViewProps) {
  const blocks = byRanking(cls.podiums);

  return (
    <div data-testid="podiums" className="flex flex-col gap-6">
      {blocks.length === 0 && <EmptyState title="Ainda sem pódio">Nenhum atleta concluiu esta prova até o momento.</EmptyState>}
      {blocks.map(({ ranking, groups }) => (
        <section key={ranking.id} className="flex flex-col gap-3">
          <h3 className="brand-title text-sm font-semibold uppercase tracking-wide text-muted">{ranking.name}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(group => (
              <Card key={group.group_key}>
                <p className="mb-2 text-sm font-semibold">{group.group_label}</p>
                <ol className="flex flex-col gap-1.5">
                  {group.places.map(place => (
                    <li key={place.ranked.entry.id} className="flex items-center gap-2 text-sm tabular">
                      <span className="w-7 shrink-0 font-semibold">{PLACE_LABEL[place.podium_pos - 1] ?? `${place.podium_pos}º`}</span>
                      <span className="min-w-0 flex-1 truncate">{entryLabel(place.ranked.entry, cls.race, athletesById)}</span>
                      <span className="shrink-0 text-muted">Nº {place.ranked.entry.bib}</span>
                      <span className="shrink-0 font-medium">{formatDuration(place.ranked.timing.final_ms)}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
