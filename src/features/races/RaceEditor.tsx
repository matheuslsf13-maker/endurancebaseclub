import { useId, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Button, Card, Input, Select, useConfirm, useToast } from '../../components/ui';
import { defaultRaceConfig } from '../../domain/presets';
import { formatClock } from '../../lib/format';
import { api, ApiError } from '../../lib/api';
import type { AgeRule, TeamAgeRule, TimeSource } from '../../lib/types';
import { useEventContext } from '../events/EventContext';
import { AgeGroupsEditor } from './AgeGroupsEditor';
import { LegsEditor } from './LegsEditor';
import { RankingsEditor } from './RankingsEditor';
import { formToPayload, teamSizeLabel, validateRaceForm } from './raceForm';
import type { RaceForm } from './raceForm';

const TEAM_SIZE_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: teamSizeLabel(n) }));
const isTeam = (n: number) => n > 1;

interface RadioOptionProps {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange(): void;
  testId?: string;
}

function RadioOption({ name, value, label, checked, onChange, testId }: RadioOptionProps) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2">
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        data-testid={testId}
        style={{ accentColor: 'var(--accent)' }}
        className="h-5 w-5 border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="brand-title text-base font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

function waveStartLabel(startAt: string | null): string {
  return startAt ? `Largou às ${formatClock(Date.parse(startAt), { tenths: true })}` : 'Sem largada';
}

export interface RaceEditorProps {
  initial: RaceForm;
  onDone(): void;
}

/** The full race editor (brief §Task 19): Dados, Pernas, Largadas, Categorias, Pódio,
 * Cronometragem. Owns its own copy of the `RaceForm` (seeded from `initial`) and saves through
 * `formToPayload` + `api.admin.saveRace`, refreshing the event and reporting back via `onDone`. */
export function RaceEditor({ initial, onDone }: RaceEditorProps) {
  const { agg, refresh } = useEventContext();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<RaceForm>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const hasLevels = agg.event.levels.length > 0;

  async function onTeamSizeChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = Number(e.target.value);
    const wasTeam = isTeam(form.team_size);
    const nowTeam = isTeam(next);
    if (wasTeam === nowTeam) {
      setForm((f) => ({ ...f, team_size: next }));
      return;
    }
    const ok = await confirm({
      title: 'Mudar tamanho da equipe',
      message: `A prova vai virar ${nowTeam ? 'uma prova em equipe' : 'individual'}. Isso redefine o pódio e as faixas etárias para os padrões de ${nowTeam ? 'equipe' : 'individual'}. Continuar?`,
      confirmLabel: 'Continuar',
    });
    if (!ok) return;
    const def = defaultRaceConfig(next);
    setForm((f) => ({ ...f, team_size: next, config: { ...f.config, rankings: def.rankings, age_groups: def.age_groups } }));
  }

  function addWave() {
    setForm((f) => ({ ...f, waves: [...f.waves, { name: `Onda ${f.waves.length + 1}`, position: f.waves.length, start_at: null }] }));
  }
  function removeWave(i: number) {
    setForm((f) => ({ ...f, waves: f.waves.filter((_, idx) => idx !== i) }));
  }
  function updateWaveName(i: number, name: string) {
    setForm((f) => ({ ...f, waves: f.waves.map((w, idx) => (idx === i ? { ...w, name } : w)) }));
  }

  async function handleSave() {
    const validation = validateRaceForm(form);
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      await api.admin.saveRace(formToPayload(form));
      await refresh();
      toast.show({ message: 'Prova salva', tone: 'success' });
      onDone();
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : 'Não foi possível salvar a prova']);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {errors.length > 0 && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3">
          <ul className="flex flex-col gap-1">
            {errors.map((e, i) => (
              <li key={i} role="alert" className="text-sm text-danger">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Dados">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Input label="Nome da prova" data-testid="race-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="sm:w-48">
            <Select label="Tamanho da equipe" data-testid="race-team-size" options={TEAM_SIZE_OPTIONS} value={String(form.team_size)} onChange={(e) => void onTeamSizeChange(e)} />
          </div>
        </div>
      </Section>

      <Section title="Pernas">
        <LegsEditor legs={form.legs} onChange={(legs) => setForm((f) => ({ ...f, legs }))} />
      </Section>

      <Section title="Largadas">
        <div className="flex flex-col gap-3">
          {form.waves.map((w, i) => (
            <div key={w.id ?? `new-${i}`} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-end sm:gap-3">
              <div className="flex-1">
                <Input label="Nome da largada" data-testid={`wave-name-${i}`} value={w.name} onChange={(e) => updateWaveName(i, e.target.value)} />
              </div>
              <p className="text-sm text-muted tabular sm:pb-2.5">{waveStartLabel(w.start_at)}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remover largada ${w.name}`}
                data-testid={`wave-remove-${i}`}
                disabled={form.waves.length <= 1}
                onClick={() => removeWave(i)}
              >
                Remover
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" data-testid="wave-add" onClick={addWave}>
            Adicionar largada
          </Button>
          <p className="text-sm text-muted">O horário de largada é definido na aba Cronometragem.</p>
        </div>
      </Section>

      <Section title="Categorias">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-fg">Idade considerada</p>
            <div className="flex flex-wrap gap-4">
              <RadioOption
                name="age_rule"
                value="year_end"
                label="Idade em 31/12 do ano da prova"
                checked={form.config.age_rule === 'year_end'}
                onChange={() => setForm((f) => ({ ...f, config: { ...f.config, age_rule: 'year_end' as AgeRule } }))}
              />
              <RadioOption
                name="age_rule"
                value="event_date"
                label="Idade na data da prova"
                checked={form.config.age_rule === 'event_date'}
                onChange={() => setForm((f) => ({ ...f, config: { ...f.config, age_rule: 'event_date' as AgeRule } }))}
              />
            </div>
          </div>

          {isTeam(form.team_size) && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-fg">Idade da equipe</p>
              <div className="flex flex-wrap gap-4">
                {(['sum', 'oldest', 'youngest'] as TeamAgeRule[]).map((rule) => (
                  <RadioOption
                    key={rule}
                    name="team_age_rule"
                    value={rule}
                    label={rule === 'sum' ? 'Soma' : rule === 'oldest' ? 'Mais velho' : 'Mais novo'}
                    checked={form.config.team_age_rule === rule}
                    onChange={() => setForm((f) => ({ ...f, config: { ...f.config, team_age_rule: rule } }))}
                  />
                ))}
              </div>
            </div>
          )}

          <AgeGroupsEditor groups={form.config.age_groups} onChange={(age_groups) => setForm((f) => ({ ...f, config: { ...f.config, age_groups } }))} />
        </div>
      </Section>

      <Section title="Pódio">
        <RankingsEditor
          rankings={form.config.rankings}
          cumulative={form.config.cumulative}
          hasLevels={hasLevels}
          onChange={(rankings) => setForm((f) => ({ ...f, config: { ...f.config, rankings } }))}
          onCumulativeChange={(cumulative) => setForm((f) => ({ ...f, config: { ...f.config, cumulative } }))}
        />
      </Section>

      <Section title="Cronometragem">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="sm:w-56">
              <Input
                label="Janela de mesma passagem (s)"
                type="number"
                min={1}
                data-testid="race-window"
                value={form.config.same_crossing_window_s}
                onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, same_crossing_window_s: Number(e.target.value) } }))}
              />
            </div>
            <div className="sm:w-56">
              <Input
                label="Limite de divergência (s)"
                type="number"
                min={1}
                data-testid="race-divergence"
                value={form.config.divergence_threshold_s}
                onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, divergence_threshold_s: Number(e.target.value) } }))}
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-fg">Fonte do tempo</p>
            <div className="flex flex-wrap gap-4">
              <RadioOption
                name="time_source"
                value="median"
                label="Mediana (recomendado)"
                testId="race-time-source-median"
                checked={form.config.time_source === 'median'}
                onChange={() => setForm((f) => ({ ...f, config: { ...f.config, time_source: 'median' as TimeSource } }))}
              />
              <RadioOption
                name="time_source"
                value="reference"
                label="Cronometrista de referência"
                testId="race-time-source-reference"
                checked={form.config.time_source === 'reference'}
                onChange={() => setForm((f) => ({ ...f, config: { ...f.config, time_source: 'reference' as TimeSource } }))}
              />
            </div>
          </div>

          <div className="sm:w-64">
            <Select
              label="Cronometrista de referência"
              data-testid="race-reference-timekeeper"
              disabled={form.config.time_source !== 'reference'}
              options={[{ value: '', label: 'Selecione' }, ...agg.timekeepers.map((t) => ({ value: t.id, label: t.name }))]}
              value={form.config.reference_timekeeper_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, reference_timekeeper_id: e.target.value || null } }))}
            />
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="race-save" loading={saving} onClick={() => void handleSave()}>
          Salvar prova
        </Button>
        <Button variant="secondary" data-testid="race-cancel" disabled={saving} onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
