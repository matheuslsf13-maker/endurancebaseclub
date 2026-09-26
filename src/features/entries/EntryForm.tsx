import { useId, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import type { AthleteRow, EntryRow, RaceRow } from '../../lib/types';
import { useEventContext } from '../events/EventContext';
import { AthleteForm } from '../athletes/AthleteForm';
import { emptyEntryForm, entryToForm, foldAccents, setLegOwner, setMember, setRace, toSavePayload, validateEntryForm } from './entryFormState';
import type { EntryFormState } from './entryFormState';

export interface EntryFormProps {
  /** Present when editing an existing entry. */
  initial?: EntryRow;
  /** Race preselected when creating (e.g. the tab's current race filter); ignored when `initial` is set. */
  defaultRaceId?: string;
  onSaved(e: EntryRow): void;
  onCancel(): void;
}

const MAX_SUGGESTIONS = 8;

interface MemberPickerProps {
  index: number;
  label: string;
  athletes: AthleteRow[];
  value: string | null;
  onChange(id: string | null): void;
  onCreateNew(): void;
}

/** A searchable athlete combobox following the WAI-ARIA "combobox with listbox popup" pattern: a
 * text field that filters `athletes` (diacritic-insensitive) as the organizer types, plus a
 * "+ Novo atleta" row to create one on the fly. Kept local to this form — no other screen needs
 * an athlete-picking combobox.
 *
 * The field shows the *resolved* selected name (looked up from `athletes` + `value`) whenever the
 * dropdown is closed, and free-typed search text while it's open — never a copy of the name held
 * in its own state. That avoids a real bug an earlier version had: seeding `query` from `value` at
 * mount, then only re-seeding when `value` itself changed, left an editor's picker blank forever
 * whenever the athlete list was still loading at mount (the common case — `value` never changes
 * again once an existing entry is being edited, so the name was never picked up once the list
 * arrived).
 *
 * Keyboard: ArrowDown/ArrowUp move a highlighted item (visually and via `aria-activedescendant`;
 * the "+ Novo atleta" row is the last item, so it is always reachable), Enter activates whatever
 * is highlighted (an athlete or "+ Novo atleta"), Escape closes the popup. Mouse selection
 * (onMouseDown-guarded so it survives the input's blur) keeps working exactly as before. */
function MemberPicker({ index, label, athletes, value, onChange, onCreateNew }: MemberPickerProps) {
  const fieldId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [highlighted, setHighlighted] = useState(-1);

  const selectedName = athletes.find((a) => a.id === value)?.name ?? '';
  const displayValue = open ? searchText : selectedName;

  const term = foldAccents(searchText.trim());
  const matches = (term ? athletes.filter((a) => foldAccents(a.name).includes(term)) : athletes).slice(0, MAX_SUGGESTIONS);
  // "+ Novo atleta" is always the last item in the list, so keyboard nav can always reach it.
  const createIndex = matches.length;
  const itemCount = matches.length + 1;

  function optionId(i: number) {
    return `${listboxId}-option-${i}`;
  }

  function openList() {
    setSearchText('');
    setOpen(true);
    setHighlighted(-1);
  }

  function closeList() {
    setOpen(false);
    setHighlighted(-1);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setSearchText(e.target.value);
    setHighlighted(-1);
  }

  function pick(a: AthleteRow) {
    onChange(a.id);
    closeList();
  }

  function activateCreate() {
    closeList();
    onCreateNew();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlighted(0);
        } else {
          setHighlighted((h) => (h + 1) % itemCount);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlighted(itemCount - 1);
        } else {
          setHighlighted((h) => (h <= 0 ? itemCount - 1 : h - 1));
        }
        break;
      case 'Enter':
        if (!open || highlighted < 0) return;
        e.preventDefault();
        if (highlighted === createIndex) activateCreate();
        else pick(matches[highlighted]);
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          // Also stops the kit Modal's own document-level Escape listener (Modal.tsx) from
          // seeing this key: without it, Escape would close the popup *and* the whole dialog
          // in the same keystroke, since that listener sits on `document` too and
          // `stopPropagation` alone does not block another listener on the same node.
          e.nativeEvent.stopImmediatePropagation();
          closeList();
        }
        break;
      default:
        break;
    }
  }

  const activeDescendant = open && highlighted >= 0 ? optionId(highlighted) : undefined;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={fieldId}
        data-testid={`entry-member-${index}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        className="w-full min-h-11 rounded-xl border border-border bg-surface px-3 py-2 text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        placeholder="Buscar atleta"
        autoComplete="off"
        value={displayValue}
        onChange={handleChange}
        onFocus={openList}
        onBlur={closeList}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-lg"
        >
          {matches.map((a, i) => (
            <button
              key={a.id}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={highlighted === i}
              data-testid={`entry-member-${index}-option-${a.id}`}
              className={`block w-full px-3 py-2 text-left text-sm ${highlighted === i ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(a)}
            >
              {a.name}
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-sm text-muted">Nenhum atleta encontrado</p>}
          <button
            id={optionId(createIndex)}
            type="button"
            role="option"
            aria-selected={highlighted === createIndex}
            className={`block w-full border-t border-border px-3 py-2 text-left text-sm font-semibold text-fg ${highlighted === createIndex ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={activateCreate}
          >
            + Novo atleta
          </button>
        </div>
      )}
    </div>
  );
}

function memberLabel(race: RaceRow, i: number): string {
  return race.team_size > 1 ? `Integrante ${i + 1}` : 'Atleta';
}

function legOwnerLabel(state: EntryFormState, athletesById: Map<string, AthleteRow>, i: number): string {
  const athleteId = state.members[i];
  return (athleteId && athletesById.get(athleteId)?.name) || `Integrante ${i + 1}`;
}

/** "Nova inscrição"/"Editar inscrição" form: race, team name (teams only), one athlete combobox
 * per member, one leg→member select per leg (teams only), bib, level and wave. Owns its own save
 * (`api.admin.saveEntry`) and reports the saved row back via `onSaved`, mirroring `AthleteForm`. */
export function EntryForm({ initial, defaultRaceId, onSaved, onCancel }: EntryFormProps) {
  const { agg, refresh } = useEventContext();
  const queryClient = useQueryClient();
  const races = agg.races.slice().sort((a, b) => a.position - b.position);
  const initialRace = initial ? (races.find((r) => r.id === initial.race_id) ?? races[0]) : (races.find((r) => r.id === defaultRaceId) ?? races[0]);

  // Seeded once, on mount, from `initial`/`defaultRaceId` — a background refresh of `agg` while
  // this form is open must never silently overwrite what the organizer is typing (Ruling 40); a
  // stale race/entry reference is never re-read after this initializer runs.
  const [state, setState] = useState<EntryFormState>(() => {
    if (!initialRace) return { race_id: '', wave_id: null, bib: '', team_name: '', level: null, notes: '', members: [], legOwner: [] };
    return initial ? entryToForm(initial, initialRace) : emptyEntryForm(initialRace);
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [creatingMember, setCreatingMember] = useState<number | null>(null);

  const athletesQuery = useQuery({ queryKey: ['athletes'], queryFn: () => api.admin.listAthletes() });
  const athletes = athletesQuery.data ?? [];
  const athletesById = new Map(athletes.map((a): [string, AthleteRow] => [a.id, a]));

  const race = races.find((r) => r.id === state.race_id);
  const hasLevels = agg.event.levels.length > 0;
  const raceWaves = agg.waves.filter((w) => w.race_id === state.race_id).slice().sort((a, b) => a.position - b.position);

  if (!race) {
    return <p className="text-sm text-muted">Cadastre uma prova antes de inscrever atletas.</p>;
  }
  const isTeam = race.team_size > 1;

  // Arrow expressions (not hoisted `function` declarations) so TypeScript's narrowing of `race`
  // above carries into their bodies.
  const handleRaceChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = races.find((r) => r.id === e.target.value);
    if (!next) return;
    setState((s) => setRace(s, next));
  };

  const handleAthleteCreated = (index: number, athlete: AthleteRow) => {
    // Puts the new athlete in the cache immediately (so the picker shows its name right away,
    // without waiting on a round trip) and still invalidates so the list eventually matches the
    // server exactly (ordering, any server-side normalization).
    queryClient.setQueryData<AthleteRow[]>(['athletes'], (old) => {
      const list = old ?? [];
      return list.some((a) => a.id === athlete.id) ? list.map((a) => (a.id === athlete.id ? athlete : a)) : [...list, athlete];
    });
    setState((s) => setMember(s, index, athlete.id));
    setCreatingMember(null);
    void queryClient.invalidateQueries({ queryKey: ['athletes'] });
  };

  const handleSave = async () => {
    const validation = validateEntryForm(state, race);
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const saved = await api.admin.saveEntry(toSavePayload(state));
      await refresh();
      onSaved(saved);
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : 'Erro inesperado']);
    } finally {
      setSaving(false);
    }
  };

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

      <Select
        label="Prova"
        data-testid="entry-race"
        options={races.map((r) => ({ value: r.id, label: r.name }))}
        value={state.race_id}
        onChange={handleRaceChange}
      />

      {isTeam && (
        <Input
          label="Nome da equipe"
          data-testid="entry-team-name"
          value={state.team_name}
          onChange={(e) => setState((s) => ({ ...s, team_name: e.target.value }))}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {state.members.map((athleteId, i) => (
          <MemberPicker
            key={i}
            index={i}
            label={memberLabel(race, i)}
            athletes={athletes}
            value={athleteId}
            onChange={(id) => setState((s) => setMember(s, i, id))}
            onCreateNew={() => setCreatingMember(i)}
          />
        ))}
      </div>

      {isTeam && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-fg">Quem corre cada perna</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {race.legs.map((leg, k) => (
              <Select
                key={k}
                label={`Perna ${k + 1} (${leg.label})`}
                data-testid={`entry-leg-${k}`}
                options={state.members.map((_, i) => ({ value: String(i), label: legOwnerLabel(state, athletesById, i) }))}
                value={String(state.legOwner[k])}
                onChange={(e) => setState((s) => setLegOwner(s, k, Number(e.target.value)))}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Número (opcional)"
          placeholder="automático"
          data-testid="entry-bib"
          value={state.bib}
          onChange={(e) => setState((s) => ({ ...s, bib: e.target.value }))}
        />
        {hasLevels && (
          <Select
            label="Nível"
            data-testid="entry-level"
            options={[{ value: '', label: 'Sem nível' }, ...agg.event.levels.map((l) => ({ value: l, label: l }))]}
            value={state.level ?? ''}
            onChange={(e) => setState((s) => ({ ...s, level: e.target.value || null }))}
          />
        )}
      </div>

      {raceWaves.length > 1 && (
        <Select
          label="Onda"
          data-testid="entry-wave"
          options={raceWaves.map((w) => ({ value: w.id, label: w.name }))}
          value={state.wave_id ?? raceWaves[0].id}
          onChange={(e) => setState((s) => ({ ...s, wave_id: e.target.value }))}
        />
      )}

      <Textarea
        label="Observações"
        data-testid="entry-notes"
        value={state.notes}
        onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="entry-save" loading={saving} onClick={() => void handleSave()}>
          Salvar inscrição
        </Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
      </div>

      <Modal open={creatingMember !== null} onClose={() => setCreatingMember(null)} title="Novo atleta" size="lg">
        {creatingMember !== null && (
          <AthleteForm onSaved={(a) => handleAthleteCreated(creatingMember, a)} onCancel={() => setCreatingMember(null)} />
        )}
      </Modal>
    </div>
  );
}
