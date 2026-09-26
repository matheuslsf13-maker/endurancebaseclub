import { describe, expect, it } from 'vitest';
import { makeEntry, makeRace } from '../../domain/testing/fixtures';
import { formatDuration } from '../../lib/format';
import {
  emptyEntryForm,
  entryToForm,
  foldAccents,
  parsePenaltyMs,
  setLegOwner,
  setMember,
  setRace,
  toSavePayload,
  validateEntryForm,
} from './entryFormState';

const teamRace2legs = makeRace({ id: 'r1', team_size: 2, legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }] });
const soloRace = makeRace({ id: 'r2', team_size: 1, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });

describe('emptyEntryForm', () => {
  it('starts with empty member slots and the round-robin leg default', () => {
    const state = emptyEntryForm(teamRace2legs);
    expect(state.members).toEqual([null, null]);
    expect(state.legOwner).toEqual([0, 1]);
    expect(state.race_id).toBe('r1');
    expect(state.wave_id).toBeNull();
    expect(state.bib).toBe('');
    expect(state.team_name).toBe('');
  });

  it('an individual race always assigns every leg to member 0', () => {
    const raceWith3Legs = makeRace({ id: 'r3', team_size: 1, legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'bike', label: 'Ciclismo', distance_m: 20000 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    const state = emptyEntryForm(raceWith3Legs);
    expect(state.members).toEqual([null]);
    expect(state.legOwner).toEqual([0, 0, 0]);
  });
});

describe('setMember / setLegOwner', () => {
  it('update immutably, one slot at a time', () => {
    const s0 = emptyEntryForm(teamRace2legs);
    const s1 = setMember(s0, 0, 'a1');
    const s2 = setMember(s1, 1, 'a2');
    expect(s2.members).toEqual(['a1', 'a2']);
    expect(s0.members).toEqual([null, null]); // original untouched

    const s3 = setLegOwner(s2, 0, 1);
    expect(s3.legOwner).toEqual([1, 1]);
    expect(s2.legOwner).toEqual([0, 1]); // original untouched
  });
});

describe('setRace', () => {
  it('resets members/legOwner/wave_id to the new race shape but keeps bib/team_name/notes/id', () => {
    let state = emptyEntryForm(teamRace2legs);
    state = setMember(state, 0, 'a1');
    state = setMember(state, 1, 'a2');
    state = { ...state, id: 'en1', bib: '101', team_name: 'Dupla A', notes: 'Chegou atrasada', wave_id: 'w1' };

    const next = setRace(state, soloRace);
    expect(next.race_id).toBe('r2');
    expect(next.members).toEqual([null]);
    expect(next.legOwner).toEqual([0]);
    expect(next.wave_id).toBeNull();
    expect(next.id).toBe('en1');
    expect(next.bib).toBe('101');
    expect(next.team_name).toBe('Dupla A');
    expect(next.notes).toBe('Chegou atrasada');
  });
});

describe('entryToForm', () => {
  it('rebuilds members in position order and legOwner from members[].legs', () => {
    const entry = makeEntry({
      id: 'en1', race_id: 'r1', wave_id: 'w1', bib: '7', team_name: 'Dupla A', level: null, notes: 'obs',
      members: [
        { athlete_id: 'a2', position: 1, legs: [1] },
        { athlete_id: 'a1', position: 0, legs: [0] },
      ],
    });
    const state = entryToForm(entry, teamRace2legs);
    expect(state.id).toBe('en1');
    expect(state.members).toEqual(['a1', 'a2']);
    expect(state.legOwner).toEqual([0, 1]);
    expect(state.bib).toBe('7');
    expect(state.team_name).toBe('Dupla A');
    expect(state.notes).toBe('obs');
  });
});

describe('validateEntryForm', () => {
  it('requires a team name for team races', () => {
    let state = emptyEntryForm(teamRace2legs);
    state = setMember(state, 0, 'a1');
    state = setMember(state, 1, 'a2');
    expect(validateEntryForm(state, teamRace2legs)).toContain('Informe o nome da equipe');
  });

  it('reports which member slot is still empty (1-based)', () => {
    let state = emptyEntryForm(teamRace2legs);
    state = { ...state, team_name: 'Dupla A' };
    state = setMember(state, 0, 'a1');
    // member 2 (index 1) left unset
    expect(validateEntryForm(state, teamRace2legs)).toContain('Escolha o atleta 2');
  });

  it('rejects the same athlete chosen for two members', () => {
    let state = emptyEntryForm(teamRace2legs);
    state = { ...state, team_name: 'Dupla A' };
    state = setMember(state, 0, 'a1');
    state = setMember(state, 1, 'a1');
    expect(validateEntryForm(state, teamRace2legs)).toContain('O mesmo atleta foi escolhido duas vezes');
  });

  it('requires every member to run at least one leg', () => {
    let state = emptyEntryForm(teamRace2legs);
    state = { ...state, team_name: 'Dupla A' };
    state = setMember(state, 0, 'a1');
    state = setMember(state, 1, 'a2');
    state = setLegOwner(state, 0, 0);
    state = setLegOwner(state, 1, 0); // both legs on member 0 — member 1 (Beto) runs nothing
    expect(validateEntryForm(state, teamRace2legs)).toContain('Cada integrante precisa fazer pelo menos uma perna');
  });

  it('an individual race only needs one athlete, no team name, and is unaffected by the leg-coverage rule', () => {
    let state = emptyEntryForm(soloRace);
    state = setMember(state, 0, 'a1');
    expect(validateEntryForm(state, soloRace)).toEqual([]);
  });

  it('a complete team form validates clean', () => {
    let state = emptyEntryForm(teamRace2legs);
    state = { ...state, team_name: 'Dupla A' };
    state = setMember(state, 0, 'a1');
    state = setMember(state, 1, 'a2');
    expect(validateEntryForm(state, teamRace2legs)).toEqual([]);
  });
});

describe('toSavePayload', () => {
  it('builds members[].legs from legOwner and turns a blank bib into null', () => {
    let state = emptyEntryForm(teamRace2legs);
    state = { ...state, team_name: 'Dupla A' };
    state = setMember(state, 0, 'a1');
    state = setMember(state, 1, 'a2');

    const payload = toSavePayload(state);
    expect(payload.members).toEqual([
      { athlete_id: 'a1', legs: [0] },
      { athlete_id: 'a2', legs: [1] },
    ]);
    expect(payload.bib).toBeNull();
    expect(payload.team_name).toBe('Dupla A');
    expect(payload.race_id).toBe('r1');
    expect(payload.id).toBeUndefined();
  });

  it('keeps a typed bib trimmed and includes the id when editing', () => {
    let state = emptyEntryForm(soloRace);
    state = { ...state, id: 'en9', bib: ' 042 ' };
    state = setMember(state, 0, 'a1');

    const payload = toSavePayload(state);
    expect(payload.id).toBe('en9');
    expect(payload.bib).toBe('042');
    expect(payload.team_name).toBeNull();
  });

  it('groups multiple legs onto the same member in ascending order', () => {
    const threeLegRace = makeRace({ id: 'r4', team_size: 2, legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'bike', label: 'Ciclismo', distance_m: 20000 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    let state = emptyEntryForm(threeLegRace); // legOwner defaults to [0,1,0]
    state = { ...state, team_name: 'Dupla A' };
    state = setMember(state, 0, 'a1');
    state = setMember(state, 1, 'a2');

    const payload = toSavePayload(state);
    expect(payload.members).toEqual([
      { athlete_id: 'a1', legs: [0, 2] },
      { athlete_id: 'a2', legs: [1] },
    ]);
  });
});

describe('penalty m:ss parsing', () => {
  it('parses minutes:seconds into milliseconds', () => {
    expect(parsePenaltyMs('1:30')).toBe(90_000);
    expect(parsePenaltyMs('0:05')).toBe(5_000);
    expect(parsePenaltyMs('10:00')).toBe(600_000);
  });

  it('blank means no penalty', () => {
    expect(parsePenaltyMs('')).toBe(0);
    expect(parsePenaltyMs('   ')).toBe(0);
  });

  it('rejects anything that is not m:ss', () => {
    expect(parsePenaltyMs('abc')).toBeNull();
    expect(parsePenaltyMs('1:99')).toBeNull();
    expect(parsePenaltyMs('1:30:00')).toBeNull();
  });

  it('the display value comes from the shared formatDuration, e.g. 90000 -> "1:30"', () => {
    expect(formatDuration(90_000)).toBe('1:30');
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('foldAccents', () => {
  it('strips accents and case for search matching', () => {
    expect(foldAccents('João Núñez')).toBe('joao nunez');
    expect(foldAccents('ANA')).toBe('ana');
  });
});
