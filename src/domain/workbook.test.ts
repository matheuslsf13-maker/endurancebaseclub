import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeEventTiming } from './consolidation';
import { classifyRace } from './ranking';
import { buildEventWorkbook, workbookFileName } from './workbook';
import { ISSUE_LABEL } from './labels';
import { colLetter, writeXlsx } from '../lib/xlsx/writer';
import { makeEvent, makeRace, makeWave, makeAthlete, makeEntry, makeMark, makeResolution, makeTimekeeper, T0, SEC, MIN, iso } from './testing/fixtures';
import type { EventAggregate } from '../lib/types';

// Individual run race (1 leg, position 0) with two individual entries.
const raceRun = makeRace({ id: 'r1', name: 'Corrida 5K', position: 0, team_size: 1, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
// Relay race (team 2, swim/run, position 1) with one team entry.
const raceRelay = makeRace({
  id: 'r2', name: 'Revezamento', position: 1, team_size: 2,
  legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
});

const waveRun = makeWave({ id: 'w1', race_id: 'r1', start_at: iso(T0) });
const waveRelay = makeWave({ id: 'w2', race_id: 'r2', start_at: iso(T0) });

const a1 = makeAthlete({ id: 'a1', name: 'Duda Ramos', sex: 'F', birth_date: '1990-01-01' });
const a2 = makeAthlete({ id: 'a2', name: 'Caio Nunes', sex: 'M', birth_date: '1985-01-01' });
const a3 = makeAthlete({ id: 'a3', name: 'Elis Farias', sex: 'F', birth_date: '1992-01-01' });
const a4 = makeAthlete({ id: 'a4', name: 'Fábio Costa', sex: 'M', birth_date: '1995-01-01' });

const en1 = makeEntry({ id: 'en1', race_id: 'r1', wave_id: 'w1', bib: '101', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] });
const en2 = makeEntry({ id: 'en2', race_id: 'r1', wave_id: 'w1', bib: '102', members: [{ athlete_id: 'a2', position: 0, legs: [0] }] });
const en3 = makeEntry({
  id: 'en3', race_id: 'r2', wave_id: 'w2', bib: '201', team_name: 'Tubarões',
  members: [{ athlete_id: 'a3', position: 0, legs: [0] }, { athlete_id: 'a4', position: 1, legs: [1] }],
});

const tk1 = makeTimekeeper({ id: 'tk1', name: 'Ana' });
const tk2 = makeTimekeeper({ id: 'tk2', name: 'Bia' });

// Both individual finishes.
const finRun1 = makeMark({ at: T0 + 25 * MIN, entry_id: 'en1', leg_index: 0, timekeeper_id: 'tk1' });
const finRun2 = makeMark({ at: T0 + 27 * MIN, entry_id: 'en2', leg_index: 0, timekeeper_id: 'tk1' });
// Relay leg 0 by both timekeepers, 4 s apart (> the 3 s divergence threshold).
const mR0Tk1 = makeMark({ at: T0 + 10 * MIN, entry_id: 'en3', leg_index: 0, timekeeper_id: 'tk1' });
const mR0Tk2 = makeMark({ at: T0 + 10 * MIN + 4 * SEC, entry_id: 'en3', leg_index: 0, timekeeper_id: 'tk2' });
// Relay leg 1 by tk1 only.
const mR1Tk1 = makeMark({ at: T0 + 40 * MIN, entry_id: 'en3', leg_index: 1, timekeeper_id: 'tk1' });
// One discarded mark.
const mDiscarded = makeMark({ at: T0 + 41 * MIN, entry_id: 'en3', leg_index: 1, timekeeper_id: 'tk2', discarded: true, discarded_by: 'organizer' });
// One unassigned mark, older than 60 s as of `nowMs` below.
const mUnassigned = makeMark({ at: T0 - 1 * MIN, entry_id: null, leg_index: null, timekeeper_id: 'tk2' });

// Resolution for relay leg 0 pointing to tk2's ("Bia") mark instead of the system median.
const resolutionR0 = makeResolution({ entry_id: 'en3', leg_index: 0, mode: 'mark', mark_id: mR0Tk2.id });

const nowMs = T0 + 50 * MIN;
const event = makeEvent({ name: 'Desafio EBC', public_slug: 'desafio-ebc' });

const agg: EventAggregate = {
  event, races: [raceRun, raceRelay], waves: [waveRun, waveRelay],
  entries: [en1, en2, en3], athletes: [a1, a2, a3, a4], timekeepers: [tk1, tk2],
  marks: [finRun1, finRun2, mR0Tk1, mR0Tk2, mR1Tk1, mDiscarded, mUnassigned],
  resolutions: [resolutionR0], results: [], version: 1, server_now: iso(nowMs),
};

const timing = computeEventTiming(agg, nowMs);
const athletesById = new Map(agg.athletes.map(a => [a.id, a] as const));
const clsRun = classifyRace(raceRun, [en1, en2], timing.byEntry, athletesById, event);
const clsRelay = classifyRace(raceRelay, [en3], timing.byEntry, athletesById, event);

const generatedAtMs = nowMs;
const model = buildEventWorkbook(agg, timing, [clsRun, clsRelay], generatedAtMs);

describe('buildEventWorkbook', () => {
  it('orders sheets: Resumo, Inscritos, Tempos per race, Classificação per race, Pódios, Marcações, Pendências, Súmula manual', () => {
    expect(model.sheets.map(s => s.name)).toEqual([
      'Resumo', 'Inscritos', 'Tempos – Corrida 5K', 'Tempos – Revezamento',
      'Classificação – Corrida 5K', 'Classificação – Revezamento',
      'Pódios', 'Marcações', 'Pendências', 'Súmula manual',
    ]);
  });

  it('Resumo: identification rows and one summary row per race', () => {
    const resumo = model.sheets.find(s => s.name === 'Resumo')!;
    expect(resumo.headerless).toBe(true);
    expect(resumo.rows[0]).toEqual([{ v: 'EnduranceBaseClub — Planilha de conferência', s: 'title' }]);
    expect(resumo.rows[1]).toEqual(['Evento', 'Desafio EBC']);
    expect(resumo.rows[2]).toEqual(['Data', '11/10/2026']);
    expect(resumo.rows[3]).toEqual(['Local', event.location]);
    expect(resumo.rows[4]).toEqual(['Gerada em', '11/10/2026 08:50:00 (Brasília)']);
    expect(resumo.rows[5]).toEqual([]);
    expect(resumo.rows[6]).toEqual(
      ['Prova', 'Inscritos', 'Concluintes', 'Em prova', 'DNF', 'DNS', 'DSQ', 'Pendências', 'Finalizada'].map(v => ({ v, s: 'bold' })),
    );
    // Both races: everyone finished, nobody DNF/DNS/DSQ, no race-scoped pendência, not finalized.
    expect(resumo.rows[7]).toEqual(['Corrida 5K', 2, 2, 0, 0, 0, 0, 0, 'Não']);
    expect(resumo.rows[8]).toEqual(['Revezamento', 1, 1, 0, 0, 0, 0, 0, 'Não']);
  });

  it('Inscritos: one row per entry; team members show name + leg label, individuals show just the name', () => {
    const inscritos = model.sheets.find(s => s.name === 'Inscritos')!;
    expect(inscritos.rows.length).toBe(3);
    const [row1, row2, row3] = inscritos.rows;
    expect(row1[4]).toBe('Duda Ramos');
    expect(row2[4]).toBe('Caio Nunes');
    expect(row3[3]).toBe('Tubarões');
    expect(row3[4]).toBe('Elis Farias (Natação), Fábio Costa (Corrida)');
  });

  it('Tempos – Revezamento: leg-1 split is a formula with a cached value; Fonte names the chosen timekeeper', () => {
    const sheet = model.sheets.find(s => s.name === 'Tempos – Revezamento')!;
    // A Nº, B Atleta/Equipe, C Largada, D Passagem 1, E Tempo 1, F Fonte 1 — one data row (en3).
    const row = sheet.rows[0];
    expect(row[4]).toEqual({ formula: `${colLetter(3)}2-${colLetter(2)}2`, result: expect.any(Number) });
    expect(row[5]).toBe('Marcação de Bia');
  });

  it('Classificação – Corrida 5K: ordered by final time', () => {
    const sheet = model.sheets.find(s => s.name === 'Classificação – Corrida 5K')!;
    expect(sheet.rows.map(r => [r[0], r[1]])).toEqual([[1, '101'], [2, '102']]);
  });

  it('Pódios: the relay team takes 1st in its group', () => {
    const sheet = model.sheets.find(s => s.name === 'Pódios')!;
    const place = sheet.rows.find(r => r[1] === '201');
    expect(place?.[0]).toBe('1º');
  });

  it('Marcações: one row per mark; contains descartada and sem atleta', () => {
    const sheet = model.sheets.find(s => s.name === 'Marcações')!;
    expect(sheet.rows.length).toBe(7);
    const situacoes = sheet.rows.map(r => r[6]);
    expect(situacoes).toContain('descartada');
    expect(situacoes).toContain('sem atleta');
  });

  it('Pendências: includes the unassigned mark issue', () => {
    const sheet = model.sheets.find(s => s.name === 'Pendências')!;
    expect(sheet.rows.some(r => r[0] === ISSUE_LABEL.unassigned)).toBe(true);
  });

  it('Súmula manual: Nº/Atleta/Equipe/Prova plus one Perna column per leg of the biggest race, blank leg cells', () => {
    const sheet = model.sheets.find(s => s.name === 'Súmula manual')!;
    expect(sheet.columns.map(c => c.header)).toEqual(['Nº', 'Atleta/Equipe', 'Prova', 'Perna 1', 'Perna 2']);
    expect(sheet.rows.length).toBe(3);
    expect(sheet.rows[0][3]).toBeUndefined();
  });

  it('workbookFileName uses the public slug', () => {
    expect(workbookFileName(event)).toBe('EBC_desafio-ebc_2026-10-11.xlsx');
  });

  it('writeXlsx produces bytes openpyxl can read', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ebc-workbook-'));
    try {
      const file = path.join(dir, 'planilha.xlsx');
      writeFileSync(file, writeXlsx(model));
      const out = execSync(`python3 "${path.join(process.cwd(), 'scripts/verify-xlsx.py')}" "${file}"`, { encoding: 'utf-8' });
      expect(out).toContain('OK 10 sheets');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildEventWorkbook edge cases', () => {
  it('handles an event with no races without crashing', () => {
    const empty: EventAggregate = {
      event, races: [], waves: [], entries: [], athletes: [], timekeepers: [],
      marks: [], resolutions: [], results: [], version: 1, server_now: iso(T0),
    };
    const emptyTiming = computeEventTiming(empty, T0);
    const emptyModel = buildEventWorkbook(empty, emptyTiming, [], T0);
    expect(emptyModel.sheets.map(s => s.name)).toEqual(['Resumo', 'Inscritos', 'Pódios', 'Marcações', 'Pendências', 'Súmula manual']);
  });
});

describe('workbookFileName', () => {
  it('slugifies the event name when there is no public slug', () => {
    const noSlug = makeEvent({ name: 'Corrida & Cia — Edição 2027!', public_slug: null, date: '2027-05-01' });
    expect(workbookFileName(noSlug)).toBe('EBC_corrida-cia-edicao-2027_2027-05-01.xlsx');
  });
});
