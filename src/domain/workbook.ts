import type { AthleteRow, EntryRow, EventAggregate, EventRow, MarkRow, RaceRow } from '../lib/types';
import type { EventTiming, Issue } from './consolidation';
import type { RaceClassification } from './ranking';
import { entryCategory, sexLabel } from './categories';
import { entryDisplayName, entryWave, indexEvent, type EventIndex } from './eventModel';
import { excelDuration, excelSerialBrasilia, formatClock, formatDateBR, formatDateTimeBR } from '../lib/format';
import { colLetter, type Cell, type ColumnDef, type SheetModel, type WorkbookModel } from '../lib/xlsx/writer';
import { crossingSourceLabel, ENTRY_STATUS_LABEL, ISSUE_LABEL, SEVERITY_LABEL, STATUS_LABEL } from './labels';

const bibCollator = new Intl.Collator('pt-BR', { numeric: true });

/** Entries of `race` in bib order (numeric-aware) — the row order within one race's block in the
 * Inscritos and Súmula manual sheets. */
function entriesOfRace(idx: EventIndex, race: RaceRow): EntryRow[] {
  return (idx.entriesByRace.get(race.id) ?? []).slice().sort((a, b) => bibCollator.compare(a.bib, b.bib));
}

/**
 * The Inscritos "Atleta(s)" cell (spec §11): a team entry lists every member's name with the
 * leg(s) they cover — `Nome (Natação), Nome (Corrida)`; an individual entry is just the name (one
 * athlete does every leg, so there is nothing to disambiguate).
 */
function athletesCell(entry: EntryRow, race: RaceRow, athletesById: Map<string, AthleteRow>): string {
  const members = entry.members.slice().sort((a, b) => a.position - b.position);
  if (race.team_size <= 1) {
    return members.map(m => athletesById.get(m.athlete_id)?.name ?? '?').join(' / ');
  }
  return members
    .map(m => {
      const name = athletesById.get(m.athlete_id)?.name ?? '?';
      const legLabels = m.legs.map(k => race.legs[k]?.label).filter((l): l is string => !!l).join('/');
      return legLabels ? `${name} (${legLabels})` : name;
    })
    .join(', ');
}

/** Lowercases, strips accents (NFD + drop combining marks, same idiom as `importMapping.ts`'s
 * `normalizeText`) and collapses every run of non-alphanumerics into a single trimmed hyphen —
 * the `workbookFileName` fallback for an event with no `public_slug`. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function workbookFileName(event: EventRow): string {
  const slug = event.public_slug ?? slugify(event.name);
  return `EBC_${slug}_${event.date}.xlsx`;
}

/**
 * Builds the in-memory "planilha de conferência" (spec §11): a fixed sequence of sheets — Resumo,
 * Inscritos, every race's Tempos sheet, every race's Classificação sheet (races in position
 * order; Task 25's `verify-xlsx.py`-checked round trip and the sheet-name test pin this grouped
 * order), Pódios, Marcações, Pendências, Súmula manual — from the event aggregate plus the
 * already-computed timing and per-race classifications. `writeXlsx` (Task 14) turns the result
 * into actual XLSX bytes.
 */
export function buildEventWorkbook(
  agg: EventAggregate,
  timing: EventTiming,
  classifications: RaceClassification[],
  generatedAtMs: number,
): WorkbookModel {
  const idx = indexEvent(agg);
  const races = agg.races.slice().sort((a, b) => a.position - b.position);
  const clsByRaceId = new Map(classifications.map(c => [c.race.id, c] as const));

  const sheets: SheetModel[] = [
    buildResumoSheet(agg.event, races, agg.entries, timing, generatedAtMs),
    buildInscritosSheet(races, idx, agg.event),
  ];
  for (const race of races) {
    const cls = clsByRaceId.get(race.id);
    if (cls) sheets.push(buildTemposSheet(race, cls, idx, agg.marks));
  }
  for (const race of races) {
    const cls = clsByRaceId.get(race.id);
    if (cls) sheets.push(buildClassificacaoSheet(race, cls, idx));
  }
  sheets.push(
    buildPodiumsSheet(races, clsByRaceId, idx),
    buildMarcacoesSheet(agg.marks, idx, timing),
    buildPendenciasSheet(timing.issues),
    buildSumulaManualSheet(races, idx),
  );
  return { sheets };
}

/** Resumo (spec §11): headerless — title, Evento/Data/Local/Gerada em, a blank row, then a bold
 * header and one row per race with entry/status counts, open pendências and finalized state. */
function buildResumoSheet(event: EventRow, races: RaceRow[], entries: EntryRow[], timing: EventTiming, generatedAtMs: number): SheetModel {
  const columns: ColumnDef[] = [
    { header: '', width: 16 }, { header: '', width: 36 },
    ...Array.from({ length: 7 }, (): ColumnDef => ({ header: '' })),
  ];
  const rows: Cell[][] = [];

  rows.push([{ v: 'EnduranceBaseClub — Planilha de conferência', s: 'title' }]);
  rows.push(['Evento', event.name]);
  rows.push(['Data', formatDateBR(event.date)]);
  rows.push(['Local', event.location]);
  rows.push(['Gerada em', `${formatDateTimeBR(generatedAtMs)} (Brasília)`]);
  rows.push([]);
  rows.push(
    ['Prova', 'Inscritos', 'Concluintes', 'Em prova', 'DNF', 'DNS', 'DSQ', 'Pendências', 'Finalizada']
      .map((v): Cell => ({ v, s: 'bold' })),
  );

  for (const race of races) {
    const raceEntries = entries.filter(e => e.race_id === race.id);
    let concluintes = 0, emProva = 0, dnf = 0, dns = 0, dsq = 0;
    for (const entry of raceEntries) {
      switch (timing.byEntry.get(entry.id)?.status) {
        case 'finished': concluintes++; break;
        case 'on_course': emProva++; break;
        case 'dnf': dnf++; break;
        case 'dns': dns++; break;
        case 'dsq': dsq++; break;
      }
    }
    const pendencias = timing.issues.filter(i => i.race_id === race.id).length;
    const finalizada = race.finalized_at ? `Sim (${formatDateTimeBR(Date.parse(race.finalized_at))})` : 'Não';
    rows.push([race.name, raceEntries.length, concluintes, emProva, dnf, dns, dsq, pendencias, finalizada]);
  }

  return { name: 'Resumo', columns, rows, headerless: true };
}

/** Inscritos (spec §11): one row per entry across every race, ordered by race position then bib. */
function buildInscritosSheet(races: RaceRow[], idx: EventIndex, event: { date: string; levels: string[] }): SheetModel {
  const columns: ColumnDef[] = [
    { header: 'Nº' }, { header: 'Prova' }, { header: 'Onda' }, { header: 'Equipe' },
    { header: 'Atleta(s)', width: 32 }, { header: 'Sexo' }, { header: 'Idade' },
    { header: 'Faixa' }, { header: 'Nível' }, { header: 'Status' }, { header: 'Penalidade (s)' },
  ];
  const rows: Cell[][] = [];
  for (const race of races) {
    for (const entry of entriesOfRace(idx, race)) {
      const category = entryCategory(entry, idx.athletesById, race, event);
      const wave = entryWave(entry, idx);
      rows.push([
        entry.bib, race.name, wave?.name ?? '', entry.team_name,
        athletesCell(entry, race, idx.athletesById),
        sexLabel(category.sex), category.age, category.age_group, category.level,
        ENTRY_STATUS_LABEL[entry.status], entry.penalty_ms / 1000,
      ]);
    }
  }
  return { name: 'Inscritos', columns, rows };
}

// Tempos column layout: Nº, Atleta/Equipe, Largada, then 3 columns per leg (Passagem/Tempo/Fonte).
const LARGADA_COL = 2;
const passagemCol = (k: number): number => 3 + 3 * k;
const tempoCol = (k: number): number => passagemCol(k) + 1;
const fonteCol = (k: number): number => passagemCol(k) + 2;

/**
 * Tempos – <prova> (spec §11), one per race: per-leg passages and split times (formulas with a
 * cached value, only when both endpoints are known — mirrors `LegTiming.leg_ms`), Total/Final
 * (same formula treatment, mirrors `EntryTiming.total_ms`/`final_ms`), penalty, the max
 * divergence across legs and the timing status. Row order = classification order (`cls.rows`), so
 * it reads top-to-bottom exactly like the Classificação sheet.
 */
function buildTemposSheet(race: RaceRow, cls: RaceClassification, idx: EventIndex, marks: MarkRow[]): SheetModel {
  const legsCount = race.legs.length;
  const columns: ColumnDef[] = [{ header: 'Nº' }, { header: 'Atleta/Equipe', width: 28 }, { header: 'Largada', style: 'time' }];
  for (let k = 0; k < legsCount; k++) {
    const label = race.legs[k].label;
    columns.push({ header: `Passagem ${k + 1} (${label})`, style: 'time' });
    columns.push({ header: `Tempo ${k + 1} (${label})`, style: 'duration' });
    columns.push({ header: `Fonte ${k + 1}`, width: 22 });
  }
  const totalCol = passagemCol(legsCount);
  const penaltyCol = totalCol + 1;
  const finalCol = totalCol + 2;
  const divergCol = totalCol + 3;
  const statusCol = totalCol + 4;
  columns.push(
    { header: 'Total', style: 'duration' },
    { header: 'Penalidade', style: 'duration' },
    { header: 'Final', style: 'duration' },
    { header: 'Divergência máx. (s)', style: 'decimal1' },
    { header: 'Status' },
  );

  const rows: Cell[][] = cls.rows.map((r, i) => {
    const excelRow = i + 2; // row 1 is the header
    const row: Cell[] = new Array(columns.length).fill(null);
    row[0] = r.entry.bib;
    row[1] = entryDisplayName(r.entry, idx);
    row[LARGADA_COL] = r.timing.start_ms !== null ? excelSerialBrasilia(r.timing.start_ms) : null;

    let maxSpreadS: number | null = null;
    for (let k = 0; k < legsCount; k++) {
      const leg = r.timing.legs[k];
      const officialMs = leg?.crossing.official_ms ?? null;
      row[passagemCol(k)] = officialMs !== null ? excelSerialBrasilia(officialMs) : null;
      row[tempoCol(k)] = leg && leg.leg_ms !== null
        ? {
            formula: `${colLetter(passagemCol(k))}${excelRow}-${colLetter(k === 0 ? LARGADA_COL : passagemCol(k - 1))}${excelRow}`,
            result: excelDuration(leg.leg_ms),
          }
        : null;
      row[fonteCol(k)] = leg ? crossingSourceLabel(leg.crossing, idx.timekeepersById, marks) : '';
      if (leg?.crossing.spread_ms != null) {
        const spreadS = leg.crossing.spread_ms / 1000;
        maxSpreadS = maxSpreadS === null ? spreadS : Math.max(maxSpreadS, spreadS);
      }
    }

    row[totalCol] = r.timing.total_ms !== null
      ? {
          formula: `${colLetter(passagemCol(legsCount - 1))}${excelRow}-${colLetter(LARGADA_COL)}${excelRow}`,
          result: excelDuration(r.timing.total_ms),
        }
      : null;
    row[penaltyCol] = excelDuration(r.entry.penalty_ms);
    row[finalCol] = r.timing.total_ms !== null
      ? { formula: `${colLetter(totalCol)}${excelRow}+${colLetter(penaltyCol)}${excelRow}`, result: excelDuration(r.timing.final_ms as number) }
      : null;
    row[divergCol] = maxSpreadS;
    row[statusCol] = STATUS_LABEL[r.timing.status];
    return row;
  });

  return { name: `Tempos – ${race.name}`, columns, rows, freezeHeader: true };
}

/** Classificação – <prova> (spec §11), one per race: the already-computed classification, in
 * order, as plain values (no formulas — everything here is already final). */
function buildClassificacaoSheet(race: RaceRow, cls: RaceClassification, idx: EventIndex): SheetModel {
  const columns: ColumnDef[] = [
    { header: 'Pos' }, { header: 'Nº' }, { header: 'Atleta/Equipe', width: 28 }, { header: 'Sexo' },
    { header: 'Faixa' }, { header: 'Nível' }, { header: 'Pos. sexo' },
    { header: 'Tempo final', style: 'duration' }, { header: 'Dif. p/ 1º', style: 'duration' }, { header: 'Status' },
  ];
  const rows: Cell[][] = cls.rows.map((r): Cell[] => [
    r.overall_pos, r.entry.bib, entryDisplayName(r.entry, idx), sexLabel(r.category.sex),
    r.category.age_group, r.category.level, r.sex_pos,
    r.timing.final_ms !== null ? excelDuration(r.timing.final_ms) : null,
    r.gap_ms !== null ? excelDuration(r.gap_ms) : null,
    STATUS_LABEL[r.timing.status],
  ]);
  return { name: `Classificação – ${race.name}`, columns, rows };
}

/** Pódios (spec §11): headerless — per race a title row, per ranking a bold row, per group a bold
 * label row followed by its places, and a blank row between races. */
function buildPodiumsSheet(races: RaceRow[], clsByRaceId: Map<string, RaceClassification>, idx: EventIndex): SheetModel {
  const columns: ColumnDef[] = [{ header: '' }, { header: '' }, { header: '', width: 28 }, { header: '', style: 'duration' }];
  const rows: Cell[][] = [];

  races.forEach((race, i) => {
    if (i > 0) rows.push([]);
    rows.push([{ v: race.name, s: 'title' }]);

    let currentRankingId: string | null = null;
    for (const group of clsByRaceId.get(race.id)?.podiums ?? []) {
      if (group.ranking.id !== currentRankingId) {
        rows.push([{ v: group.ranking.name, s: 'bold' }]);
        currentRankingId = group.ranking.id;
      }
      rows.push([{ v: group.group_label, s: 'bold' }]);
      for (const place of group.places) {
        rows.push([
          `${place.podium_pos}º`, place.ranked.entry.bib, entryDisplayName(place.ranked.entry, idx),
          excelDuration(place.ranked.timing.final_ms as number),
        ]);
      }
    }
  });

  return { name: 'Pódios', columns, rows, headerless: true };
}

/** Marcações (spec §11): one row per mark ever recorded (sorted by time), with the organizer's
 * disposition of it (usada/descartada/duplicada/sem atleta) and its gap to the accepted time. */
function buildMarcacoesSheet(marks: MarkRow[], idx: EventIndex, timing: EventTiming): SheetModel {
  const columns: ColumnDef[] = [
    { header: 'Hora (Brasília)' }, { header: 'Cronometrista' }, { header: 'Nº' },
    { header: 'Atleta/Equipe', width: 28 }, { header: 'Prova' }, { header: 'Perna' },
    { header: 'Situação' }, { header: 'Δ oficial (s)', style: 'decimal1' }, { header: 'ID' },
  ];
  const timekeeperLabel = (id: string | null): string =>
    id === null ? 'Organização' : idx.timekeepersById.get(id)?.name ?? 'Cronometrista';

  const rows: Cell[][] = marks
    .slice()
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .map((m): Cell[] => {
      const entry = m.entry_id ? idx.entriesById.get(m.entry_id) : undefined;
      const race = entry ? idx.racesById.get(entry.race_id) : undefined;
      const crossing = entry && m.leg_index !== null ? timing.byEntry.get(entry.id)?.legs[m.leg_index]?.crossing : undefined;
      const situacao = m.discarded ? 'descartada' : !entry ? 'sem atleta' : crossing?.duplicates.includes(m.id) ? 'duplicada' : 'usada';
      const tsMs = Date.parse(m.ts);
      const delta = crossing?.official_ms != null ? (tsMs - crossing.official_ms) / 1000 : null;
      return [
        formatClock(tsMs, { millis: true }), timekeeperLabel(m.timekeeper_id), entry?.bib ?? '',
        entry ? entryDisplayName(entry, idx) : '', race?.name ?? '',
        m.leg_index !== null ? m.leg_index + 1 : null, situacao, delta, m.id,
      ];
    });

  return { name: 'Marcações', columns, rows };
}

/** Pendências (spec §11): `timing.issues` verbatim (already severity-ordered by `computeEventTiming`). */
function buildPendenciasSheet(issues: Issue[]): SheetModel {
  const columns: ColumnDef[] = [{ header: 'Tipo' }, { header: 'Severidade' }, { header: 'Descrição', width: 60 }];
  const rows: Cell[][] = issues.map((i): Cell[] => [ISSUE_LABEL[i.type], SEVERITY_LABEL[i.severity], i.message]);
  return { name: 'Pendências', columns, rows };
}

/** Súmula manual (spec §11): paper backup start list — every entry with blank leg-time columns
 * for M = the most legs any race has, ordered by race position then bib. */
function buildSumulaManualSheet(races: RaceRow[], idx: EventIndex): SheetModel {
  const maxLegs = races.reduce((max, r) => Math.max(max, r.legs.length), 0);
  const columns: ColumnDef[] = [
    { header: 'Nº' }, { header: 'Atleta/Equipe', width: 28 }, { header: 'Prova' },
    ...Array.from({ length: maxLegs }, (_, i): ColumnDef => ({ header: `Perna ${i + 1}` })),
  ];
  const rows: Cell[][] = [];
  for (const race of races) {
    for (const entry of entriesOfRace(idx, race)) {
      rows.push([entry.bib, entryDisplayName(entry, idx), race.name]);
    }
  }
  return { name: 'Súmula manual', columns, rows };
}
