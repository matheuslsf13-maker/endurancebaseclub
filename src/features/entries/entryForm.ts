import type { EntryRow, EntryStatus, RaceRow } from '../../lib/types';

/** The editable state of the "Nova inscrição"/"Editar inscrição" form. `members[i]` is the
 * athlete id chosen for member position `i` (or `null` while unfilled); `legOwner[k]` is the
 * member *index* (into `members`) who runs leg `k` — for an individual entry (`team_size` 1) it
 * is always `[0, 0, …]` since the one member does every leg. */
export interface EntryFormState {
  id?: string;
  race_id: string;
  wave_id: string | null;
  bib: string;
  team_name: string;
  level: string | null;
  notes: string;
  members: (string | null)[];
  legOwner: number[];
}

/** What `api.admin.saveEntry` expects (mirrors its parameter type in `src/lib/api.ts`). */
export interface EntrySavePayload {
  id?: string;
  race_id: string;
  wave_id: string | null;
  bib: string | null;
  team_name: string | null;
  level: string | null;
  notes: string;
  members: { athlete_id: string; legs: number[] }[];
}

/** The default leg→member mapping: member `k mod team_size` runs leg `k`. For an individual race
 * (`team_size` 1) this reduces to every leg owned by member 0. */
function defaultLegOwner(legCount: number, teamSize: number): number[] {
  return Array.from({ length: legCount }, (_, k) => k % teamSize);
}

/** A fresh form for a new entry in `race`: no athletes chosen yet, `wave_id` left `null` (the
 * server — and `entryWave` on read — default that to the race's first wave), legs distributed
 * round-robin across the (still empty) member slots. */
export function emptyEntryForm(race: RaceRow): EntryFormState {
  return {
    race_id: race.id,
    wave_id: null,
    bib: '',
    team_name: '',
    level: null,
    notes: '',
    members: Array.from({ length: race.team_size }, () => null),
    legOwner: defaultLegOwner(race.legs.length, race.team_size),
  };
}

/** Builds the editable form from a saved entry + the race it belongs to (member order follows
 * `position`; a leg with no member covering it — should not happen for a saved entry, but a stale
 * race edit could leave one — falls back to the round-robin default for that leg alone). */
export function entryToForm(entry: EntryRow, race: RaceRow): EntryFormState {
  const sortedMembers = entry.members.slice().sort((a, b) => a.position - b.position);
  const members = Array.from({ length: race.team_size }, (_, i) => sortedMembers[i]?.athlete_id ?? null);
  const legOwner = race.legs.map((_, k) => {
    const owner = sortedMembers.findIndex((m) => m.legs.includes(k));
    return owner >= 0 ? owner : k % race.team_size;
  });
  return {
    id: entry.id,
    race_id: entry.race_id,
    wave_id: entry.wave_id,
    bib: entry.bib ?? '',
    team_name: entry.team_name ?? '',
    level: entry.level,
    notes: entry.notes ?? '',
    members,
    legOwner,
  };
}

/** Switches the form to a different race: resets `members`/`legOwner`/`wave_id` to that race's
 * shape (an old wave id would no longer belong to the new race) but keeps everything the
 * organizer already typed (bib, team name, level, notes) and the entry `id` when editing. */
export function setRace(state: EntryFormState, race: RaceRow): EntryFormState {
  const fresh = emptyEntryForm(race);
  return { ...state, race_id: race.id, wave_id: fresh.wave_id, members: fresh.members, legOwner: fresh.legOwner };
}

export function setMember(state: EntryFormState, i: number, athleteId: string | null): EntryFormState {
  const members = state.members.slice();
  members[i] = athleteId;
  return { ...state, members };
}

export function setLegOwner(state: EntryFormState, legIndex: number, memberIndex: number): EntryFormState {
  const legOwner = state.legOwner.slice();
  legOwner[legIndex] = memberIndex;
  return { ...state, legOwner };
}

/** pt-BR validation messages for the whole form (empty when it is ready to save). Mirrors the
 * server rules enforced by `admin_save_entry` (exactly `team_size` distinct athletes, every leg
 * assigned) plus one client-only rule: every member must run at least one leg — a team member
 * assigned to none would time the entry with a "ghost" runner the timekeeper app never expects a
 * mark for. */
export function validateEntryForm(state: EntryFormState, race: RaceRow): string[] {
  const errors: string[] = [];
  const isTeam = race.team_size > 1;

  if (isTeam && state.team_name.trim() === '') {
    errors.push('Informe o nome da equipe');
  }

  state.members.forEach((athleteId, i) => {
    if (!athleteId) errors.push(isTeam ? `Escolha o atleta ${i + 1}` : 'Escolha o atleta');
  });

  const chosen = state.members.filter((m): m is string => m != null);
  if (new Set(chosen).size !== chosen.length) {
    errors.push('O mesmo atleta foi escolhido duas vezes');
  }

  if (isTeam) {
    const covered = new Set(state.legOwner);
    const everyoneRuns = state.members.every((_, i) => covered.has(i));
    if (!everyoneRuns) errors.push('Cada integrante precisa fazer pelo menos uma perna');
  }

  return errors;
}

/** Converts the form to the payload `api.admin.saveEntry` expects: `legOwner` (member-index per
 * leg) becomes `members[].legs` (leg indices per member, in ascending order); a blank bib becomes
 * `null` (the server assigns the next free number). Assumes `validateEntryForm` already passed
 * (every `members[i]` is non-null). */
export function toSavePayload(state: EntryFormState): EntrySavePayload {
  const members = state.members.map((athleteId, i) => ({
    athlete_id: athleteId as string,
    legs: state.legOwner.reduce<number[]>((legs, ownerIndex, legIndex) => {
      if (ownerIndex === i) legs.push(legIndex);
      return legs;
    }, []),
  }));
  const bib = state.bib.trim();
  const teamName = state.team_name.trim();
  return {
    ...(state.id ? { id: state.id } : {}),
    race_id: state.race_id,
    wave_id: state.wave_id,
    bib: bib === '' ? null : bib,
    team_name: teamName === '' ? null : teamName,
    level: state.level,
    notes: state.notes.trim(),
    members,
  };
}

/** Diacritic-insensitive, case-insensitive fold — used by every athlete search/picker in this
 * feature ("joao" must still find "João"). */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const PENALTY_RE = /^(\d+):([0-5]?\d)$/;

/** Parses a `m:ss` penalty field to milliseconds; blank means "no penalty" (`0`); anything else
 * that doesn't match `m:ss` (minutes any number of digits, seconds `0`-`59`) is `null` so the
 * caller can show a pt-BR validation message instead of silently saving garbage. */
export function parsePenaltyMs(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  const m = PENALTY_RE.exec(t);
  if (!m) return null;
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  return (minutes * 60 + seconds) * 1000;
}

/** The inverse of `parsePenaltyMs`, e.g. `90000` → `'1:30'` — used to prefill the status modal
 * with whatever penalty is already on the entry. */
export function formatPenaltyMs(ms: number): string {
  const totalSeconds = Math.round(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const ENTRY_STATUS_OPTIONS: EntryStatus[] = ['ok', 'dns', 'dnf', 'dsq'];
