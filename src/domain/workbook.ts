import type { AthleteRow, EntryRow, EventAggregate, EventRow, MarkRow, RaceRow } from '../lib/types';
import type { Crossing, EventTiming, Issue } from './consolidation';
import type { RaceClassification } from './ranking';
import { entryCategory, sexLabel } from './categories';
import { entryDisplayName, entryWave, indexEvent, type EventIndex } from './eventModel';
import { classificationFromResults, snapshotDrift } from './snapshot';
import { excelDuration, excelSerialBrasilia, formatClock, formatDateBR, formatDateTimeBR } from '../lib/format';
import { colLetter, type Cell, type ColumnDef, type SheetModel, type WorkbookModel } from '../lib/xlsx/writer';
import { crossingSourceLabel, ENTRY_STATUS_LABEL, ISSUE_LABEL, SEVERITY_LABEL, STATUS_LABEL } from './labels';

const bibCollator = new Intl.Collator('pt-BR', { numeric: true });

/**
 * B1-M10: every time on screen is truncated to tenths (format.ts), while Excel's `.0` formats
 * round — 10:00:05.960 would read 10:00:05.9 on screen and 10:00:06.0 in the sheet. Clock and
 * duration cells therefore carry milliseconds floored to tenths; formula cells cache what the
 * formula computes from those floored passages, so the sheet stays consistent with itself.
 */
const floorTenths = (ms: number): number => Math.floor(ms / 100) * 100;
const clockCell = (ms: number): number => excelSerialBrasilia(floorTenths(ms));
const durationCell = (ms: number): number => excelDuration(floorTenths(ms));
/** `end - start` as the sheet's formula computes it: from the floored cells. */
const spanCell = (endMs: number, startMs: number): number => excelDuration(floorTenths(endMs) - floorTenths(startMs));

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

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
 * already-computed timing and per-race (live) classifications. `writeXlsx` (Task 14) turns the
 * result into actual XLSX bytes.
 *
 * B1-I1/B2-I2: for a FINALIZED race, Classificação, Pódios and the Resumo counts come from the
 * stored snapshot (`agg.results`) — the official result the public page and the athletes' stats
 * show — and the Resumo says when the live data now differs ("Sim — difere do ao vivo"). Tempos
 * and Marcações stay live: they are the raw conference data.
 */
export function buildEventWorkbook(
  agg: EventAggregate,
  timing: EventTiming,
  classifications: RaceClassification[],
  generatedAtMs: number,
): WorkbookModel {
  const idx = indexEvent(agg);
  const races = agg.races.slice().sort((a, b) => a.position - b.position);
  const liveByRaceId = new Map(classifications.map(c => [c.race.id, c] as const));
  const officialByRaceId = new Map<string, RaceClassification>();
  const driftByRaceId = new Map<string, number>();
  for (const race of races) {
    const live = liveByRaceId.get(race.id);
    if (race.finalized_at) {
      officialByRaceId.set(race.id, classificationFromResults(race, agg.results, agg.event.levels));
      if (live) driftByRaceId.set(race.id, snapshotDrift(live, agg.results).length);
    } else if (live) {
      officialByRaceId.set(race.id, live);
    }
  }

  const sheets: SheetModel[] = [
    buildResumoSheet(agg.event, races, agg.entries, officialByRaceId, driftByRaceId, timing, generatedAtMs),
    buildInscritosSheet(races, idx, agg.event),
  ];
  for (const race of races) {
    const cls = liveByRaceId.get(race.id);
    if (cls) sheets.push(buildTemposSheet(race, cls, idx, agg.marks));
  }
  for (const race of races) {
    const cls = officialByRaceId.get(race.id);
    if (cls) sheets.push(buildClassificacaoSheet(race, cls, idx));
  }
  sheets.push(
    buildPodiumsSheet(races, officialByRaceId, idx),
    buildMarcacoesSheet(agg.marks, idx, timing),
    buildPendenciasSheet(timing.issues),
    buildSumulaManualSheet(races, idx),
  );
  return { sheets };
}

/** Resumo (spec §11): headerless — title, Evento/Data/Local/Gerada em, a blank row, then a bold
 * header and one row per race with entry/status counts, open pendências (warnings and errors) and finalized state. The
 * counts come from the same classification the Classificação sheet shows (T15): "Concluintes" are
 * its ranked finishers, and a finish without a usable time (no start, or not after the start —
 * Ruling 9) is counted apart in "Chegada sem tempo". */
function buildResumoSheet(
  event: EventRow, races: RaceRow[], entries: EntryRow[], clsByRaceId: Map<string, RaceClassification>,
  driftByRaceId: Map<string, number>, timing: EventTiming, generatedAtMs: number,
): SheetModel {
  const columns: ColumnDef[] = [
    { header: '', width: 16 }, { header: '', width: 36 },
    ...Array.from({ length: 8 }, (): ColumnDef => ({ header: '' })),
  ];
  const rows: Cell[][] = [];

  rows.push([{ v: 'EnduranceBaseClub — Planilha de conferência', s: 'title' }]);
  rows.push(['Evento', event.name]);
  rows.push(['Data', formatDateBR(event.date)]);
  rows.push(['Local', event.location]);
  rows.push(['Gerada em', `${formatDateTimeBR(generatedAtMs)} (Brasília)`]);
  rows.push([]);
  rows.push(
    ['Prova', 'Inscritos', 'Concluintes', 'Chegada sem tempo', 'Em prova', 'DNF', 'DNS', 'DSQ', 'Pendências', 'Finalizada']
      .map((v): Cell => ({ v, s: 'bold' })),
  );

  for (const race of races) {
    const cls = clsByRaceId.get(race.id);
    const classified = cls?.rows ?? [];
    let semTempo = 0, emProva = 0, dnf = 0, dns = 0, dsq = 0;
    for (const r of classified) {
      switch (r.timing.status) {
        case 'finished': if (r.overall_pos === null) semTempo++; break;
        case 'on_course': emProva++; break;
        case 'dnf': dnf++; break;
        case 'dns': dns++; break;
        case 'dsq': dsq++; break;
      }
    }
    const inscritos = cls ? classified.length : entries.filter(e => e.race_id === race.id).length;
    // Pending = warnings and errors, like every counter in the app; info issues are not pending.
    const pendencias = timing.issues.filter(i => i.race_id === race.id && i.severity !== 'info').length;
    const drift = driftByRaceId.get(race.id) ?? 0;
    const finalizada = race.finalized_at
      ? `Sim (${formatDateTimeBR(Date.parse(race.finalized_at))})${drift > 0 ? ` — difere do ao vivo (${plural(drift, 'inscrição', 'inscrições')})` : ''}`
      : 'Não';
    rows.push([race.name, inscritos, cls?.finishers ?? 0, semTempo, emProva, dnf, dns, dsq, pendencias, finalizada]);
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
    const startMs = r.timing.start_ms;
    row[LARGADA_COL] = startMs !== null ? clockCell(startMs) : null;

    let maxSpreadS: number | null = null;
    for (let k = 0; k < legsCount; k++) {
      const leg = r.timing.legs[k];
      const officialMs = leg?.crossing.official_ms ?? null;
      row[passagemCol(k)] = officialMs !== null ? clockCell(officialMs) : null;
      row[tempoCol(k)] = leg && leg.leg_ms !== null && officialMs !== null && leg.start_ms !== null
        ? {
            formula: `${colLetter(passagemCol(k))}${excelRow}-${colLetter(k === 0 ? LARGADA_COL : passagemCol(k - 1))}${excelRow}`,
            result: spanCell(officialMs, leg.start_ms),
          }
        : null;
      row[fonteCol(k)] = leg ? crossingSourceLabel(leg.crossing, idx.timekeepersById, marks, race.config) : '';
      if (leg?.crossing.spread_ms != null) {
        const spreadS = leg.crossing.spread_ms / 1000;
        maxSpreadS = maxSpreadS === null ? spreadS : Math.max(maxSpreadS, spreadS);
      }
    }

    const finishMs = legsCount > 0 ? r.timing.legs[legsCount - 1]?.crossing.official_ms ?? null : null;
    // Total/Final cache what their formulas compute from the floored cells (B1-M10).
    const totalSpanMs = r.timing.total_ms !== null && finishMs !== null && startMs !== null
      ? floorTenths(finishMs) - floorTenths(startMs)
      : null;
    row[totalCol] = totalSpanMs !== null
      ? {
          formula: `${colLetter(passagemCol(legsCount - 1))}${excelRow}-${colLetter(LARGADA_COL)}${excelRow}`,
          result: excelDuration(totalSpanMs),
        }
      : null;
    row[penaltyCol] = durationCell(r.entry.penalty_ms);
    row[finalCol] = totalSpanMs !== null
      ? {
          formula: `${colLetter(totalCol)}${excelRow}+${colLetter(penaltyCol)}${excelRow}`,
          result: excelDuration(totalSpanMs + floorTenths(r.entry.penalty_ms)),
        }
      : null;
    row[divergCol] = maxSpreadS;
    row[statusCol] = STATUS_LABEL[r.timing.status];
    return row;
  });

  return { name: `Tempos – ${race.name}`, columns, rows, freezeHeader: true };
}

/** "Class. – <prova>" (spec §11 Classificação), one per race: the classification (the snapshot
 * for a finalized race), in order, as plain values (no formulas — everything here is final). The
 * short prefix keeps similar long race names distinguishable after Excel's 31-character cut
 * (B1-M2). */
function buildClassificacaoSheet(race: RaceRow, cls: RaceClassification, idx: EventIndex): SheetModel {
  const columns: ColumnDef[] = [
    { header: 'Pos' }, { header: 'Nº' }, { header: 'Atleta/Equipe', width: 28 }, { header: 'Sexo' },
    { header: 'Faixa' }, { header: 'Nível' }, { header: 'Pos. sexo' },
    { header: 'Tempo final', style: 'duration' }, { header: 'Dif. p/ 1º', style: 'duration' }, { header: 'Status' },
  ];
  const rows: Cell[][] = cls.rows.map((r): Cell[] => [
    r.overall_pos, r.entry.bib, entryDisplayName(r.entry, idx), sexLabel(r.category.sex),
    r.category.age_group, r.category.level, r.sex_pos,
    r.timing.final_ms !== null ? durationCell(r.timing.final_ms) : null,
    r.gap_ms !== null ? durationCell(r.gap_ms) : null,
    STATUS_LABEL[r.timing.status],
  ]);
  return { name: `Class. – ${race.name}`, columns, rows };
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
          durationCell(place.ranked.timing.final_ms as number),
        ]);
      }
    }
  });

  return { name: 'Pódios', columns, rows, headerless: true };
}

/** Whether mark `markId` is what the official time of `crossing` comes from (B1-M8): every
 * candidate of a median or mean, the priority timekeeper's candidate, the chosen mark — never a mark
 * overruled by another decision or by a manual time. */
function feedsOfficial(markId: string, crossing: Crossing, race: RaceRow | undefined): boolean {
  switch (crossing.official_source) {
    case 'median':
    case 'mean': return crossing.candidates.some(c => c.mark_id === markId);
    case 'reference': return crossing.candidates.some(c => c.mark_id === markId && c.timekeeper_id === race?.config.reference_timekeeper_id);
    case 'mark': return crossing.resolution?.mark_id === markId;
    default: return false;
  }
}

/** Marcações (spec §11): one row per mark ever recorded (sorted by time), with the organizer's
 * disposition of it (usada/não usada (decisão)/descartada/duplicada/sem atleta) and its gap to the
 * accepted time. */
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
      const situacao = m.discarded ? 'descartada'
        : !entry ? 'sem atleta'
        : crossing?.duplicates.includes(m.id) ? 'duplicada'
        : crossing && feedsOfficial(m.id, crossing, race) ? 'usada'
        : 'não usada (decisão)';
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
