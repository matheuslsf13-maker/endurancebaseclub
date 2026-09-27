import { parseDateInput } from './format';
import type { ImportRowInput, Sex } from './types';

export interface MappedImport { rows: ImportRowInput[]; errors: { row: number; message: string }[]; columns: Record<string, number> }

type Field = keyof ImportRowInput;

const SYNONYM_GROUPS: [Field, string[]][] = [
  ['name', ['nome', 'nome completo', 'atleta', 'name']],
  ['sex', ['sexo', 'genero', 'sex']],
  ['birth_date', ['nascimento', 'data de nascimento', 'data nascimento', 'dt nascimento', 'data de nasc', 'birth_date']],
  ['email', ['email', 'e-mail', 'e mail']],
  ['phone', ['telefone', 'celular', 'whatsapp', 'fone', 'phone']],
  ['city', ['cidade', 'city']],
  ['team_club', ['equipe', 'assessoria', 'clube', 'time', 'team']],
  ['race_name', ['prova', 'race']],
];
const SEX_M = new Set(['m', 'masc', 'masculino', 'homem', 'male']);
const SEX_F = new Set(['f', 'fem', 'feminino', 'mulher', 'female']);
const REQUIRED: { field: Field; label: string }[] = [{ field: 'name', label: 'Nome' }, { field: 'sex', label: 'Sexo' }];

/** lowercase, strip accents, trim, collapse internal whitespace. Used for both header and value matching. */
function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().replace(/\s+/g, ' ');
}

const SYNONYMS: Record<string, Field> = {};
for (const [field, synonyms] of SYNONYM_GROUPS) {
  for (const s of synonyms) SYNONYMS[normalizeText(s)] = field;
}

function isRowEmpty(row: string[]): boolean {
  return row.every((c) => (c ?? '').trim() === '');
}

function normalizeSex(raw: string): Sex | null {
  const norm = normalizeText(raw);
  if (SEX_M.has(norm)) return 'M';
  if (SEX_F.has(norm)) return 'F';
  return null;
}

/** Converts an Excel date serial (days after 1899-12-30) to an ISO 'YYYY-MM-DD' date. */
function excelSerialToIso(serial: number): string {
  const d = new Date((serial - 25569) * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** parseDateInput first; else an integer 1..60000 read as an Excel serial; '' → null; anything else → null (invalid). */
function parseBirthDate(raw: string): string | null {
  if (raw === '') return null;
  const viaFormat = parseDateInput(raw);
  if (viaFormat !== null) return viaFormat;
  if (/^\d+$/.test(raw)) {
    const serial = parseInt(raw, 10);
    if (serial >= 1 && serial <= 60_000) return excelSerialToIso(serial);
  }
  return null;
}

function orNull(s: string): string | null {
  return s === '' ? null : s;
}

/** Maps a raw spreadsheet table (header row + data rows) into ImportRowInput rows, per the Brazilian-header
 *  synonym list and value rules described in the task brief. Row numbers in errors are 1-based table positions. */
export function mapImportRows(table: string[][]): MappedImport {
  const errors: { row: number; message: string }[] = [];
  const headerRowIndex = table.findIndex((r) => !isRowEmpty(r));
  const headerRow = headerRowIndex >= 0 ? table[headerRowIndex] : [];
  const headerRowNum = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;

  const columns: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const field = SYNONYMS[normalizeText(h ?? '')];
    if (field && !(field in columns)) columns[field] = i;
  });

  for (const { field, label } of REQUIRED) {
    if (!(field in columns)) errors.push({ row: headerRowNum, message: `Coluna obrigatória não encontrada: ${label}` });
  }
  if (!('name' in columns) || !('sex' in columns)) {
    return { rows: [], errors, columns };
  }

  const get = (raw: string[], field: Field): string => {
    const idx = columns[field];
    return idx === undefined ? '' : (raw[idx] ?? '');
  };

  const rows: ImportRowInput[] = [];
  for (let idx = headerRowIndex + 1; idx < table.length; idx++) {
    const raw = table[idx];
    const rowNum = idx + 1;
    if (isRowEmpty(raw)) continue;

    const name = get(raw, 'name').trim().replace(/\s+/g, ' ');
    if (name === '') { errors.push({ row: rowNum, message: 'Nome vazio' }); continue; }

    const rawSex = get(raw, 'sex').trim();
    const sex = normalizeSex(rawSex);
    if (sex === null) { errors.push({ row: rowNum, message: `Sexo inválido: "${rawSex}"` }); continue; }

    const rawBirth = get(raw, 'birth_date').trim();
    const birth_date = parseBirthDate(rawBirth);
    if (birth_date === null && rawBirth !== '') {
      errors.push({ row: rowNum, message: `Data de nascimento inválida: "${rawBirth}"` });
      continue;
    }

    rows.push({
      name,
      sex,
      birth_date,
      email: orNull(get(raw, 'email').trim().toLowerCase()),
      phone: orNull(get(raw, 'phone').trim()),
      city: orNull(get(raw, 'city').trim()),
      team_club: orNull(get(raw, 'team_club').trim()),
      race_name: orNull(get(raw, 'race_name').trim()),
    });
  }

  return { rows, errors, columns };
}
