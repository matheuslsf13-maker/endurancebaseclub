import { useState } from 'react';
import { Badge, Card, Checkbox, EmptyState, Table } from '../../components/ui';
import { useToast } from '../../components/ui/Toast';
import { api, ApiError } from '../../lib/api';
import { useEventContext } from '../events/EventContext';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Erro inesperado';
}

/** "há 12 s" / "há 3 min" / "há 2 h" / "há 5 d"; "nunca" when the timekeeper never synced. */
function relativeAgo(atIso: string | null | undefined, nowMs: number): string {
  if (!atIso) return 'nunca';
  const diffMs = Math.max(0, nowMs - Date.parse(atIso));
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/**
 * Cronometristas cadastrados pelo link (spec §7.1). The mark count is computed from `agg.marks`
 * rather than `timekeeper.marks_count`: `admin_live` deltas merge marks but not timekeepers, so
 * that stored count only refreshes on a full aggregate reload (Ruling 33) and can lag behind.
 */
export function TimekeepersPanel() {
  const { agg, nowMs, patchAgg, refresh } = useEventContext();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const marksCount = new Map<string, number>();
  for (const m of agg.marks) {
    if (m.discarded || m.timekeeper_id === null) continue;
    marksCount.set(m.timekeeper_id, (marksCount.get(m.timekeeper_id) ?? 0) + 1);
  }

  const referenceOf = new Map<string, string[]>();
  for (const race of agg.races) {
    if (race.config.time_source !== 'reference' || !race.config.reference_timekeeper_id) continue;
    const list = referenceOf.get(race.config.reference_timekeeper_id) ?? [];
    list.push(race.name);
    referenceOf.set(race.config.reference_timekeeper_id, list);
  }

  async function toggleActive(id: string, next: boolean) {
    setBusyId(id);
    try {
      const updated = await api.admin.updateTimekeeper(id, { active: next });
      patchAgg((a) => ({ ...a, timekeepers: a.timekeepers.map((t) => (t.id === updated.id ? updated : t)) }));
      await refresh();
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <h2 className="brand-title mb-4 text-lg font-semibold">Cronometristas</h2>
      {agg.timekeepers.length === 0 ? (
        <EmptyState title="Nenhum cronometrista cadastrado ainda">
          Compartilhe o link acima para que os ajudantes se cadastrem.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Última atividade</th>
              <th className="px-3 py-2">Marcações</th>
              <th className="px-3 py-2">Ativo</th>
            </tr>
          </thead>
          <tbody>
            {agg.timekeepers.map((tk) => (
              <tr key={tk.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{tk.name}</span>
                    {referenceOf.get(tk.id)?.map((raceName) => (
                      <Badge key={raceName} tone="info">
                        Referência · {raceName}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="tabular px-3 py-2">{relativeAgo(tk.last_seen_at, nowMs)}</td>
                <td className="tabular px-3 py-2">{marksCount.get(tk.id) ?? 0}</td>
                <td className="px-3 py-2">
                  <Checkbox
                    label="Ativo"
                    checked={tk.active ?? true}
                    disabled={busyId === tk.id}
                    onChange={(e) => void toggleActive(tk.id, e.currentTarget.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
