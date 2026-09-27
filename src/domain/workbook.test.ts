import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeEventTiming } from './consolidation';
import { classifyRace } from './ranking';
import { buildFinalizeRows } from './snapshot';
import { buildEventWorkbook, workbookFileName } from './workbook';
import { ISSUE_LABEL } from './labels';
import { colLetter, sanitizeSheetName, writeXlsx } from '../lib/xlsx/writer';
import type { Cell, SheetModel, WorkbookModel } from '../lib/xlsx/writer';
import { excelDuration, excelSerialBrasilia } from '../lib/format';
import { makeEvent, makeRace, makeWave, makeAthlete, makeEntry, makeMark, makeResolution, makeTimekeeper, T0, SEC, MIN, iso } from './testing/fixtures';
import type { EventAggregate, RaceRow, ResultRow } from '../lib/types';

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
      'Class. – Corrida 5K', 'Class. – Revezamento',
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
      ['Prova', 'Inscritos', 'Concluintes', 'Chegada sem tempo', 'Em prova', 'DNF', 'DNS', 'DSQ', 'Pendências', 'Finalizada']
        .map(v => ({ v, s: 'bold' })),
    );
    // Both races: everyone finished, nobody DNF/DNS/DSQ, no race-scoped pendência, not finalized.
    expect(resumo.rows[7]).toEqual(['Corrida 5K', 2, 2, 0, 0, 0, 0, 0, 0, 'Não']);
    expect(resumo.rows[8]).toEqual(['Revezamento', 1, 1, 0, 0, 0, 0, 0, 0, 'Não']);
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

  it('Class. – Corrida 5K: ordered by final time', () => {
    const sheet = model.sheets.find(s => s.name === 'Class. – Corrida 5K')!;
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

  it('Marcações: "usada" only for a mark that feeds the official time; the others lost to a decision (B1-M8)', () => {
    const sheet = model.sheets.find(s => s.name === 'Marcações')!;
    const situacao = (id: string) => sheet.rows.find(r => r[8] === id)?.[6];
    // Relay leg 1 was decided by Bia's mark (resolution), so Ana's candidate is not used.
    expect(situacao(mR0Tk2.id)).toBe('usada');
    expect(situacao(mR0Tk1.id)).toBe('não usada (decisão)');
    // Plain medians use every candidate.
    expect(situacao(finRun1.id)).toBe('usada');
    expect(situacao(mR1Tk1.id)).toBe('usada');
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

// ---------------------------------------------------------------------------------------------
// B1-I1/B2-I2, B1-M2, B1-M8, B1-M10, T15: finalized races come from the snapshot; the conferência
// sheets agree with themselves and with the screen.
// ---------------------------------------------------------------------------------------------
describe('buildEventWorkbook: finalized races and conferência consistency', () => {
  const ev2 = makeEvent({ name: 'Copa Final', public_slug: 'copa-final' });
  const now2 = T0 + 90 * MIN;
  const tkA = makeTimekeeper({ id: 'tkA', name: 'Ana' });
  const tkB = makeTimekeeper({ id: 'tkB', name: 'Bia' });
  const run = (id: string, name: string, extra: Partial<RaceRow> & { configPatch?: Partial<RaceRow['config']> }) =>
    makeRace({ id, name, legs: [{ modality: 'run', label: 'Corrida', distance_m: 10_000 }], ...extra });
  const rf = run('rf', 'Corrida 10K', { position: 0 });
  const rn = run('rn', 'Sem largada', { position: 1 });
  const rr = run('rr', 'Referência', { position: 2, configPatch: { time_source: 'reference', reference_timekeeper_id: 'tkB' } });
  const rt = run('rt', 'Décimos', { position: 3 });
  const waves = [
    makeWave({ id: 'wf', race_id: 'rf', start_at: iso(T0) }),
    makeWave({ id: 'wn', race_id: 'rn', start_at: null }),
    makeWave({ id: 'wr', race_id: 'rr', start_at: iso(T0) }),
    makeWave({ id: 'wt', race_id: 'rt', start_at: iso(T0 + 150) }),
  ];
  const athletes = [
    makeAthlete({ id: 'p1', name: 'Paula Lima', sex: 'F', birth_date: '1990-01-01' }),
    makeAthlete({ id: 'p2', name: 'Rita Alves', sex: 'F', birth_date: '1991-01-01' }),
    makeAthlete({ id: 'p3', name: 'Otto Reis', sex: 'M', birth_date: '1980-01-01' }),
    makeAthlete({ id: 'p4', name: 'Ivo Melo', sex: 'M', birth_date: '1985-01-01' }),
    makeAthlete({ id: 'p5', name: 'Davi Luz', sex: 'M', birth_date: '1992-01-01' }),
    makeAthlete({ id: 'p6', name: 'Enzo Paz', sex: 'M', birth_date: '1993-01-01' }),
  ];
  const solo = (id: string, raceId: string, waveId: string, bib: string, athleteId: string) =>
    makeEntry({ id, race_id: raceId, wave_id: waveId, bib, members: [{ athlete_id: athleteId, position: 0, legs: [0] }] });
  const entries = [
    solo('ef1', 'rf', 'wf', '11', 'p1'), solo('ef2', 'rf', 'wf', '12', 'p2'), solo('en', 'rn', 'wn', '21', 'p3'),
    solo('er', 'rr', 'wr', '31', 'p4'), solo('et1', 'rt', 'wt', '41', 'p5'), solo('et2', 'rt', 'wt', '42', 'p6'),
  ];
  const f2 = makeMark({ at: T0 + 42 * MIN, entry_id: 'ef2', leg_index: 0, timekeeper_id: 'tkA' });
  const marks = [
    makeMark({ at: T0 + 40 * MIN, entry_id: 'ef1', leg_index: 0, timekeeper_id: 'tkA' }), f2,
    makeMark({ at: T0 + 30 * MIN, entry_id: 'en', leg_index: 0, timekeeper_id: 'tkA' }),
    // Reference race: both timekeepers at the very same instant; the reference is Bia.
    makeMark({ at: T0 + 35 * MIN, entry_id: 'er', leg_index: 0, timekeeper_id: 'tkA' }),
    makeMark({ at: T0 + 35 * MIN, entry_id: 'er', leg_index: 0, timekeeper_id: 'tkB' }),
    // Tenths race (start at .150): finishes at 30:00.100 and 31:01.960 after T0.
    makeMark({ at: T0 + 30 * MIN + 100, entry_id: 'et1', leg_index: 0, timekeeper_id: 'tkA' }),
    makeMark({ at: T0 + 31 * MIN + 1_960, entry_id: 'et2', leg_index: 0, timekeeper_id: 'tkA' }),
  ];
  const athletesById = new Map(athletes.map(a => [a.id, a] as const));
  const base: EventAggregate = {
    event: ev2, races: [rf, rn, rr, rt], waves, entries, athletes, timekeepers: [tkA, tkB], marks,
    resolutions: [], results: [], version: 1, server_now: iso(now2),
  };

  // Corrida 10K is finalized with Paula (40 min) ahead of Rita (42 min)...
  const finalizedAt = iso(T0 + 60 * MIN);
  const atFinalize = computeEventTiming(base, now2);
  const results: ResultRow[] = buildFinalizeRows(ev2, classifyRace(rf, entries.slice(0, 2), atFinalize.byEntry, athletesById, ev2), athletesById)
    .map(r => ({ ...r, race_id: 'rf', event_id: ev2.id, finalized_at: finalizedAt }));
  const finalized: EventAggregate = { ...base, races: [{ ...rf, finalized_at: finalizedAt }, rn, rr, rt], results };
  // ...and afterwards a manual time (38 min) makes Rita the live winner.
  const drifted: EventAggregate = {
    ...finalized, resolutions: [makeResolution({ entry_id: 'ef2', leg_index: 0, mode: 'manual', manual_ts: iso(T0 + 38 * MIN) })],
  };
  const build = (agg: EventAggregate) => {
    const timing = computeEventTiming(agg, now2);
    const cls = agg.races.map(r => classifyRace(r, agg.entries.filter(e => e.race_id === r.id), timing.byEntry, athletesById, agg.event));
    return buildEventWorkbook(agg, timing, cls, now2);
  };
  const sheet = (m: WorkbookModel, name: string): SheetModel => {
    const found = m.sheets.find(s => s.name === name);
    if (!found) throw new Error(`no sheet ${name}: ${m.sheets.map(s => s.name).join(', ')}`);
    return found;
  };
  const resumoRow = (m: WorkbookModel, race: string): Cell[] => sheet(m, 'Resumo').rows.find(r => r[0] === race)!;
  const model = build(drifted);

  it('Classificação and Pódios of a finalized race come from the snapshot, not from the live data', () => {
    const cls = sheet(model, 'Class. – Corrida 10K');
    expect(cls.rows.map(r => [r[0], r[1], r[2]])).toEqual([[1, '11', 'Paula Lima'], [2, '12', 'Rita Alves']]);
    expect(cls.rows[0][7]).toBe(excelDuration(40 * MIN));
    const podios = sheet(model, 'Pódios').rows;
    const start = podios.findIndex(r => (r[0] as { v?: unknown } | null)?.v === 'Corrida 10K');
    const firstPlace = podios.slice(start).find(r => r[0] === '1º')!;
    expect(firstPlace[1]).toBe('11');
  });

  it('Tempos (raw conference data) stays live', () => {
    const tempos = sheet(model, 'Tempos – Corrida 10K');
    expect(tempos.rows[0][0]).toBe('12');
    expect(tempos.rows[0][3]).toBe(excelSerialBrasilia(T0 + 38 * MIN));
  });

  it('Resumo says when a finalized race differs from the live data', () => {
    expect(resumoRow(model, 'Corrida 10K')[9]).toMatch(/^Sim \(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\) — difere do ao vivo \(2 inscrições\)$/);
    expect(resumoRow(build(finalized), 'Corrida 10K')[9]).toMatch(/^Sim \(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\)$/);
    expect(resumoRow(model, 'Décimos')[9]).toBe('Não');
  });

  it('Resumo "Concluintes" equals the classification finishers; a finish without a usable time is counted apart (T15)', () => {
    expect(resumoRow(model, 'Sem largada').slice(0, 8)).toEqual(['Sem largada', 1, 0, 1, 0, 0, 0, 0]);
    expect(resumoRow(model, 'Corrida 10K').slice(1, 3)).toEqual([2, 2]);
  });

  it('the reference timekeeper label names the configured reference, even when another mark has the same time (T15)', () => {
    expect(sheet(model, 'Tempos – Referência').rows[0][5]).toBe('Cronometrista de referência (Bia)');
  });

  it('Marcações: a mark overruled by a manual time is "não usada (decisão)"', () => {
    expect(sheet(model, 'Marcações').rows.find(r => r[8] === f2.id)?.[6]).toBe('não usada (decisão)');
  });

  it('clock and duration cells are floored to tenths like the screen (B1-M10)', () => {
    const tempos = sheet(model, 'Tempos – Décimos');
    const [r41, r42] = tempos.rows;
    expect(r41[0]).toBe('41');
    expect(r41[2]).toBe(excelSerialBrasilia(T0 + 100)); // Largada 08:00:00.150 -> .1
    expect(r41[3]).toBe(excelSerialBrasilia(T0 + 30 * MIN + 100)); // Passagem
    expect(r42[3]).toBe(excelSerialBrasilia(T0 + 31 * MIN + 1_900)); // 08:31:01.960 -> .9, never rounded up to 02.0
    // Formula cells cache what the formula computes from the floored passages.
    expect(r41[4]).toEqual({ formula: 'D2-C2', result: excelDuration(30 * MIN) });
    expect((r41[6] as { result: number }).result).toBe(excelDuration(30 * MIN));
    expect((r41[8] as { result: number }).result).toBe(excelDuration(30 * MIN));
    // Plain values: the floored time the screen shows (29:59.950 -> 29:59.9; gap 1:01.860 -> 1:01.8).
    const cls = sheet(model, 'Class. – Décimos');
    expect(cls.rows[0][7]).toBe(excelDuration(30 * MIN - 100));
    expect(cls.rows[1][8]).toBe(excelDuration(61_800));
  });

  it('sheet names of similar long race names stay distinguishable after the 31-character cut (B1-M2)', () => {
    const used = new Set<string>();
    const names = ['Class. – Triathlon Sprint Masculino', 'Class. – Triathlon Sprint Feminino'].map(n => sanitizeSheetName(n, used));
    expect(names).toEqual(['Class. – Triathlon Sprint Mascu', 'Class. – Triathlon Sprint Femin']);
  });

  it('still writes a workbook openpyxl can read', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ebc-workbook-'));
    try {
      const file = path.join(dir, 'planilha.xlsx');
      writeFileSync(file, writeXlsx(model));
      const out = execSync(`python3 "${path.join(process.cwd(), 'scripts/verify-xlsx.py')}" "${file}"`, { encoding: 'utf-8' });
      expect(out).toContain(`OK ${model.sheets.length} sheets`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
