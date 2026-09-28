import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useBlocker } from 'react-router';
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
import type { RaceForm, RaceFormLeg, RaceFormWave } from './raceForm';

/** pt-BR count phrase without an awkward "(ões)"/"(s)" suffix (C-Minor-17). */
function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

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
  const errorRef = useRef<HTMLDivElement>(null);

  // How many entries already exist for this race (0 for one not yet saved) — used to warn before
  // a team-size or leg-count change the server now rejects or rewrites once entries exist (B1-I2 /
  // C-Minor-5), and before a wave removal that would silently re-time or orphan them (C-I3).
  const entryCount = form.id ? agg.entries.filter((e) => e.race_id === form.id).length : 0;

  // C-Minor-6: leaving this page mid-edit (another tab, browser back) with unsaved changes is
  // silent today. `initial` is only ever the value this editor was seeded with (never re-read
  // afterwards, per Ruling 40), so comparing against it detects any edit, including one already
  // undone back to the original values (harmless false positive, not a false negative).
  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);
  const blocker = useBlocker(isDirty);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void (async () => {
      const ok = await confirm({
        title: 'Sair sem salvar?',
        message: 'Esta prova tem alterações não salvas. Elas serão perdidas se você sair agora.',
        confirmLabel: 'Sair sem salvar',
        danger: true,
      });
      if (ok) blocker.proceed?.();
      else blocker.reset?.();
    })();
    // `confirm` is stable (useCallback in ConfirmProvider); only react to the blocker itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  useEffect(() => {
    if (errors.length > 0) {
      // Optional call: jsdom (unit tests) has no layout engine and doesn't implement
      // `scrollIntoView` at all — this is a no-op there, and the real behaviour in a browser.
      errorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      errorRef.current?.focus();
    }
  }, [errors]);

  async function handleCancel() {
    if (isDirty) {
      const ok = await confirm({
        title: 'Sair sem salvar?',
        message: 'Esta prova tem alterações não salvas. Elas serão perdidas se você sair agora.',
        confirmLabel: 'Sair sem salvar',
        danger: true,
      });
      if (!ok) return;
    }
    onDone();
  }

  async function onTeamSizeChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = Number(e.target.value);
    if (next === form.team_size) return;
    const wasTeam = isTeam(form.team_size);
    const nowTeam = isTeam(next);

    const parts: string[] = [];
    if (wasTeam !== nowTeam) {
      parts.push(
        `A prova vai virar ${nowTeam ? 'uma prova em equipe' : 'individual'}, o que redefine o pódio e as faixas etárias para os padrões de ${nowTeam ? 'equipe' : 'individual'}.`,
      );
    }
    if (entryCount > 0) {
      parts.push(
        `Esta prova já tem ${countLabel(entryCount, 'inscrição', 'inscrições')} — o servidor não permite mudar o tamanho da equipe enquanto houver inscrições.`,
      );
    }
    if (parts.length > 0) {
      const ok = await confirm({ title: 'Mudar tamanho da equipe', message: `${parts.join(' ')} Continuar?`, confirmLabel: 'Continuar' });
      if (!ok) return;
    }

    if (wasTeam === nowTeam) {
      setForm((f) => ({ ...f, team_size: next }));
      return;
    }
    const def = defaultRaceConfig(next);
    setForm((f) => ({ ...f, team_size: next, config: { ...f.config, rankings: def.rankings, age_groups: def.age_groups } }));
  }

  async function onLegsChange(legs: RaceFormLeg[]) {
    if (entryCount > 0 && legs.length !== form.legs.length) {
      // Consistent with area A's admin_save_race (final-fix-1-report.md): a team race rejects the
      // change outright with "Não é possível alterar o número de pernas de uma prova por equipes
      // com inscrições"; an individual race instead rewrites each entry's single member to
      // 0..N-1, so there is no data-loss risk there — only a heads-up that it will happen.
      const message = isTeam(form.team_size)
        ? `Esta prova já tem ${countLabel(entryCount, 'inscrição', 'inscrições')} — o servidor não permite mudar o número de pernas de uma prova por equipes enquanto houver inscrições.`
        : `Esta prova já tem ${countLabel(entryCount, 'inscrição', 'inscrições')}. As pernas de cada uma serão reatribuídas automaticamente ao salvar. Continuar?`;
      const ok = await confirm({ title: 'Mudar pernas', message, confirmLabel: 'Continuar' });
      if (!ok) return;
    }
    setForm((f) => ({ ...f, legs }));
  }

  function addWave() {
    setForm((f) => ({ ...f, waves: [...f.waves, { name: `Onda ${f.waves.length + 1}`, position: f.waves.length, start_at: null }] }));
  }
  /** How many of this race's entries sit in a given (already-saved) wave — 0 for a wave not yet
   * saved (`wave.id` undefined), since nothing could reference it yet. */
  function waveEntryCount(wave: RaceFormWave): number {
    return wave.id ? agg.entries.filter((e) => e.wave_id === wave.id).length : 0;
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
        <div ref={errorRef} tabIndex={-1} className="rounded-xl border border-danger/30 bg-danger/10 p-3 outline-none">
          <ul className="flex flex-col gap-1">
            {errors.map((e, i) => (
              <li key={i} role="alert" className="text-sm text-danger-text">
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
        <LegsEditor legs={form.legs} onChange={(legs) => void onLegsChange(legs)} />
      </Section>

      <Section title="Largadas">
        <div className="flex flex-col gap-3">
          {form.waves.map((w, i) => {
            // Round 2 item N2: the server refuses to delete a wave with a recorded start or
            // entries on every save attempt (final-fix-1-report.md) — round 1's "confirm, then
            // remove anyway" just deferred that failure to Salvar. "Remover" is disabled outright
            // for such a wave, with the reason shown next to it, so it can never be removed from
            // the form in the first place.
            const entryCountForWave = waveEntryCount(w);
            const locked = Boolean(w.start_at) || entryCountForWave > 0;
            const onlyWave = form.waves.length <= 1;
            return (
              <div key={w.id ?? `new-${i}`} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-end sm:gap-3">
                <div className="flex-1">
                  <Input label="Nome da largada" data-testid={`wave-name-${i}`} value={w.name} onChange={(e) => updateWaveName(i, e.target.value)} />
                </div>
                <p className="text-sm text-muted tabular sm:pb-2.5">{waveStartLabel(w.start_at)}</p>
                <div className="flex flex-col items-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remover largada ${w.name}`}
                    data-testid={`wave-remove-${i}`}
                    disabled={onlyWave || locked}
                    onClick={() => removeWave(i)}
                  >
                    Remover
                  </Button>
                  {!onlyWave && locked && (
                    <p className="text-xs text-muted" data-testid={`wave-remove-reason-${i}`}>
                      {w.start_at && entryCountForWave > 0
                        ? `Já largou e tem ${countLabel(entryCountForWave, 'inscrição', 'inscrições')}`
                        : w.start_at
                          ? 'Já largou'
                          : `Tem ${countLabel(entryCountForWave, 'inscrição', 'inscrições')}`}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
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
        <Button variant="secondary" data-testid="race-cancel" disabled={saving} onClick={() => void handleCancel()}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
