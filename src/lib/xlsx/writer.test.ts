import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx, sanitizeSheetName, colLetter } from './writer';
import { sampleModel } from './testModel';

describe('writeXlsx', () => {
  const files = unzipSync(writeXlsx(sampleModel));
  it('contains the package parts', () => {
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
  });
  it('names sheets uniquely and recalculates on load', () => {
    const wb = strFromU8(files['xl/workbook.xml']);
    expect(wb).toContain('name="Tempos – Corrida 5K"');
    expect(wb).toContain('name="Tempos – Corrida 5K (2)"');
    expect(wb).toContain('fullCalcOnLoad="1"');
  });
  it('writes escaped strings, numbers, booleans, formulas; omits nulls; freezes header', () => {
    const s = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(s).toContain('<t xml:space="preserve">Ana &amp; Bia &lt;3&gt;</t>');
    expect(s).toMatch(/<c r="C2" s="\d+"><v>46306.4583<\/v><\/c>/);
    expect(s).toContain('<f>D2-C2</f><v>0.0139</v>');
    expect(s).toMatch(/<c r="B3"[^>]*t="b"[^>]*><v>1<\/v><\/c>/);
    expect(s).toContain('state="frozen"');
    expect(s).not.toContain('r="A3"');
  });
  it('produces a workbook openpyxl can read', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ebc-xlsx-'));
    const file = path.join(dir, 'sample.xlsx');
    writeFileSync(file, writeXlsx(sampleModel));
    const out = execSync(`python3 "${path.join(process.cwd(), 'scripts/verify-xlsx.py')}" "${file}"`, { encoding: 'utf-8' });
    expect(out).toContain('OK 2 sheets');
  });
});
describe('helpers', () => {
  it('sanitizes sheet names', () => {
    const used = new Set<string>();
    expect(sanitizeSheetName('Tempos: A/B [x]', used)).toBe('Tempos A B x');
    expect(sanitizeSheetName('', used)).toBe('Planilha');
    const long = sanitizeSheetName('Classificação – Triathlon Olímpico Revezamento', used);
    expect(long.length).toBeLessThanOrEqual(31);
    expect(sanitizeSheetName('Classificação – Triathlon Olímpico Revezamento', used).endsWith(' (2)')).toBe(true);
  });
  it('column letters', () => {
    expect([0, 25, 26, 701, 702].map(colLetter)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
  });
});
