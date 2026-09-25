import { Button, Checkbox, Input } from '../../components/ui';
import type { RankingDef, RankingDim } from '../../lib/types';

const DIM_ORDER: RankingDim[] = ['sex', 'age', 'level'];
const DIM_LABEL: Record<RankingDim, string> = { sex: 'Sexo', age: 'Faixa etária', level: 'Nível' };

let rankingSeq = 0;
function newRanking(): RankingDef {
  rankingSeq += 1;
  return { id: `ranking-${Date.now()}-${rankingSeq}`, name: 'Novo pódio', dims: ['sex'], size: 3 };
}

export interface RankingsEditorProps {
  rankings: RankingDef[];
  cumulative: boolean;
  hasLevels: boolean;
  onChange(rankings: RankingDef[]): void;
  onCumulativeChange(cumulative: boolean): void;
}

/** "Pódio" section: one or more `RankingDef`s (name, dimensions grouped, size 1..10), reorderable
 * (order decides who is already awarded when `cumulative` is off) plus the cumulative toggle. */
export function RankingsEditor({ rankings, cumulative, hasLevels, onChange, onCumulativeChange }: RankingsEditorProps) {
  function update(i: number, patch: Partial<RankingDef>) {
    onChange(rankings.map((rd, idx) => (idx === i ? { ...rd, ...patch } : rd)));
  }

  function toggleDim(i: number, dim: RankingDim, checked: boolean) {
    const rd = rankings[i];
    const set = new Set(rd.dims);
    if (checked) set.add(dim);
    else set.delete(dim);
    update(i, { dims: DIM_ORDER.filter((d) => set.has(d)) });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rankings.length) return;
    const next = rankings.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  function remove(i: number) {
    onChange(rankings.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-3">
      {rankings.map((rd, i) => (
        <div key={rd.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
            <div className="flex-1">
              <Input label="Nome" data-testid={`ranking-name-${i}`} value={rd.name} onChange={(e) => update(i, { name: e.target.value })} />
            </div>
            <div className="sm:w-24">
              <Input
                label="Lugares"
                type="number"
                min={1}
                max={10}
                data-testid={`ranking-size-${i}`}
                value={rd.size}
                onChange={(e) => update(i, { size: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="secondary" size="sm" aria-label={`Mover pódio ${rd.name} para cima`} data-testid={`ranking-move-up-${i}`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </Button>
              <Button type="button" variant="secondary" size="sm" aria-label={`Mover pódio ${rd.name} para baixo`} data-testid={`ranking-move-down-${i}`} disabled={i === rankings.length - 1} onClick={() => move(i, 1)}>
                ↓
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remover pódio ${rd.name}`} data-testid={`ranking-remove-${i}`} onClick={() => remove(i)}>
                Remover
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {DIM_ORDER.map((dim) => (
              <Checkbox
                key={dim}
                label={DIM_LABEL[dim]}
                data-testid={`ranking-dim-${dim}-${i}`}
                checked={rd.dims.includes(dim)}
                disabled={dim === 'level' && !hasLevels}
                onChange={(e) => toggleDim(i, dim, e.target.checked)}
              />
            ))}
          </div>
        </div>
      ))}

      <Button type="button" variant="secondary" size="sm" data-testid="ranking-add" onClick={() => onChange([...rankings, newRanking()])}>
        Adicionar pódio
      </Button>

      <Checkbox
        label="Premiação cumulativa"
        data-testid="ranking-cumulative"
        hint='Desligada (padrão): quem já subiu ao pódio de um ranking anterior não concorre nos seguintes — o próximo da fila sobe no lugar. Ligada: o mesmo atleta pode ser premiado em vários rankings.'
        checked={cumulative}
        onChange={(e) => onCumulativeChange(e.target.checked)}
      />
    </div>
  );
}
