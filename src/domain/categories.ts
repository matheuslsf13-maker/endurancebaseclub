import type { AgeGroup, AgeRule, AthleteRow, EntryRow, EntrySex, RaceRow, RankingDim } from '../lib/types';

export interface EntryCategory { sex: EntrySex; age: number | null; age_group: string | null; level: string | null }

/**
 * Full years between `birthDate` and `eventDate` (both `YYYY-MM-DD`), computed by plain integer
 * arithmetic on the date parts so it is immune to time-zone/DST pitfalls from `Date` math.
 * `year_end` counts the age the athlete turns during the event's calendar year (event year minus
 * birth year); `event_date` counts completed years as of the event date.
 */
export function ageOn(birthDate: string, eventDate: string, rule: AgeRule): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
  const [ey, em, ed] = eventDate.slice(0, 10).split('-').map(Number);
  if (rule === 'year_end') return ey - by;
  const hadBirthdayYet = em > bm || (em === bm && ed >= bd);
  return ey - by - (hadBirthdayYet ? 0 : 1);
}

/**
 * `birth_date` is authoritative when present. Otherwise falls back to the precomputed
 * `age_year_end`/`age_event` fields that public payloads carry in place of the real birth date.
 */
export function athleteAge(a: AthleteRow, eventDate: string, rule: AgeRule): number | null {
  if (a.birth_date) return ageOn(a.birth_date, eventDate, rule);
  return (rule === 'year_end' ? a.age_year_end : a.age_event) ?? null;
}

export function entryCategory(entry: EntryRow, athletesById: Map<string, AthleteRow>, race: RaceRow, event: { date: string; levels: string[] }): EntryCategory {
  const rule = race.config.age_rule;
  const members = entry.members
    .map(m => athletesById.get(m.athlete_id))
    .filter((a): a is AthleteRow => a != null);

  // Sex: individual = the athlete's own sex; team = M if every member is M, F if every member is
  // F, MISTO otherwise (this also covers the individual case, since a single-member "every" is
  // just that member's sex).
  const allMale = members.length > 0 && members.every(a => a.sex === 'M');
  const allFemale = members.length > 0 && members.every(a => a.sex === 'F');
  const sex: EntrySex = allMale ? 'M' : allFemale ? 'F' : 'MISTO';

  // Age: null if any member lacks a resolvable age; otherwise combined per team_age_rule (which,
  // for a single-member entry, reduces to that member's own age under sum/oldest/youngest alike).
  const ages = members.map(a => athleteAge(a, event.date, rule));
  const everyAgeKnown = members.length > 0 && ages.every(v => v !== null);
  let age: number | null = null;
  if (everyAgeKnown) {
    const known = ages as number[];
    switch (race.config.team_age_rule) {
      case 'sum': age = known.reduce((sum, v) => sum + v, 0); break;
      case 'oldest': age = Math.max(...known); break;
      case 'youngest': age = Math.min(...known); break;
    }
  }

  const age_group = age === null ? null : findAgeGroup(race.config.age_groups, age)?.label ?? null;
  const level = entry.level && event.levels.includes(entry.level) ? entry.level : null;

  return { sex, age, age_group, level };
}

function findAgeGroup(groups: AgeGroup[], age: number): AgeGroup | undefined {
  return groups.find(g => g.min <= age && (g.max === null || age <= g.max));
}

export function sexLabel(s: EntrySex): string {
  return s === 'M' ? 'Masculino' : s === 'F' ? 'Feminino' : 'Misto';
}

export function groupKey(dims: RankingDim[], cat: EntryCategory): string {
  if (dims.length === 0) return 'all';
  return dims.map(d => dimKeyPart(d, cat)).join('|');
}

export function groupLabel(dims: RankingDim[], cat: EntryCategory): string {
  if (dims.length === 0) return 'Geral';
  return dims.map(d => dimLabelPart(d, cat)).join(' · ');
}

function dimKeyPart(d: RankingDim, cat: EntryCategory): string {
  if (d === 'sex') return cat.sex;
  if (d === 'age') return cat.age_group ?? '∅';
  return cat.level ?? '∅';
}

function dimLabelPart(d: RankingDim, cat: EntryCategory): string {
  if (d === 'sex') return sexLabel(cat.sex);
  if (d === 'age') return cat.age_group ?? 'Sem faixa';
  return cat.level ?? 'Sem nível';
}

/** Returns pt-BR validation messages for a set of age groups (empty when the set is valid). */
export function validateAgeGroups(groups: AgeGroup[]): string[] {
  const errors: string[] = [];
  for (const g of groups) {
    if (g.max !== null && g.max < g.min) {
      errors.push(`Faixa "${g.label}": idade final menor que a inicial`);
    }
  }
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      const aMax = a.max ?? Infinity;
      const bMax = b.max ?? Infinity;
      if (a.min <= bMax && b.min <= aMax) {
        errors.push(`Faixas "${a.label}" e "${b.label}" se sobrepõem`);
      }
    }
  }
  return errors;
}
