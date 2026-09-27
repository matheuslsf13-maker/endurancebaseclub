## Task 14: XLSX writer/reader, CSV parser, import mapping

**Files:**
- Create: `src/lib/xlsx/writer.ts`, `src/lib/xlsx/writer.test.ts`, `src/lib/xlsx/reader.ts`, `src/lib/xlsx/reader.test.ts`, `src/lib/csv.ts`, `src/lib/csv.test.ts`, `src/lib/importMapping.ts`, `src/lib/importMapping.test.ts`, `scripts/verify-xlsx.py`

**Interfaces:**
- Consumes: `fflate` (`zipSync`, `unzipSync`, `strToU8`, `strFromU8`), `parseDateInput` (Task 1), `ImportRowInput`.
- Produces: `writeXlsx`, `sanitizeSheetName`, `colLetter`, `WorkbookModel`/`SheetModel`/`Cell`/`StyleName` types, `readXlsxFirstSheet`, `parseCsv`, `mapImportRows`.

XLSX writer requirements (SpreadsheetML, no dependencies besides fflate):
- Parts: `[Content_Types].xml` (Defaults for `rels`/`xml`, Overrides for workbook, styles and each `xl/worksheets/sheetN.xml`), `_rels/.rels` (officeDocument → `xl/workbook.xml`), `xl/workbook.xml` (`<sheets>` with `name`, `sheetId`, `r:id`; `<calcPr calcId="191029" fullCalcOnLoad="1"/>`), `xl/_rels/workbook.xml.rels` (sheets `rId1..n`, styles `rId{n+1}`), `xl/styles.xml`, one worksheet per sheet.
- Styles (`cellXfs` index → StyleName): 0 `default`; 1 `header` (bold font, solid fill `FFD9D3C9`, thin bottom border); 2 `title` (bold, size 13); 3 `bold`; 4 `time` (numFmt 164 `hh:mm:ss.0`); 5 `duration` (numFmt 165 `[h]:mm:ss.0`); 6 `int` (numFmtId 1); 7 `decimal1` (numFmt 166 `0.0`). Fonts: Calibri 11. Include the mandatory `gray125` fill at index 1.
- Worksheet: optional frozen header (`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`), `<cols>` with widths (default 14), `<sheetData>`; header row 1 (unless `headerless`) with style `header`; data rows follow. Cell style = explicit `{v, s}` style, else the column's `style`, else `default`. Strings → `t="inlineStr"` + `<is><t xml:space="preserve">…</t></is>` (XML-escaped, invalid XML control chars removed); numbers → `<v>`; booleans → `t="b"` with `1/0`; `null`/`''`-less `null` → cell omitted; formulas → `<f>` (no leading `=`) plus `<v>` cached result (`t="str"` when the result is a string). Cell refs via `colLetter`.
- `sanitizeSheetName`: replace each of `[]:*?/\` with a space, collapse whitespace, trim, cut to 31 chars, empty → `Planilha`; if already used, append ` (2)`, ` (3)`… (cutting the base so the total stays ≤ 31); adds the result to `used`.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/xlsx/writer.test.ts
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx, sanitizeSheetName, colLetter, type WorkbookModel } from './writer';

export const sampleModel: WorkbookModel = { sheets: [
  { name: 'Tempos – Corrida 5K', freezeHeader: true,
    columns: [{ header: 'Nº' }, { header: 'Atleta', width: 30 }, { header: 'Largada', style: 'time' }, { header: 'Chegada', style: 'time' }, { header: 'Tempo', style: 'duration' }],
    rows: [['101', 'Ana & Bia <3>', 46306.4583, 46306.4722, { formula: 'D2-C2', result: 0.0139 }], [null, true, 1, 2, { v: 'Total', s: 'bold' }]] },
  { name: 'Tempos – Corrida 5K', columns: [{ header: 'x' }], rows: [] },
] };

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
```

(Ruling 3: put `sampleModel` in a non-test module `src/lib/xlsx/testModel.ts` — `export const sampleModel: WorkbookModel = …` — and import it in both tests; do not export it from `writer.test.ts`.)

```ts
// src/lib/xlsx/reader.test.ts
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readXlsxFirstSheet } from './reader';
import { writeXlsx } from './writer';
import { sampleModel } from './testModel';

describe('readXlsxFirstSheet', () => {
  it('roundtrips our own files', () => {
    const rows = readXlsxFirstSheet(writeXlsx(sampleModel));
    expect(rows[0]).toEqual(['Nº', 'Atleta', 'Largada', 'Chegada', 'Tempo']);
    expect(rows[1].slice(0, 3)).toEqual(['101', 'Ana & Bia <3>', '46306.4583']);
    expect(rows[2][0]).toBe('');
  });
  it('reads Excel files with shared strings and gaps', () => {
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const zip = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${ns}><sheets><sheet name="Inscritos" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8(`<sst ${ns}><si><t>Nome</t></si><si><r><t>Ana </t></r><r><t>Souza</t></r></si><si><t>Sexo</t></si></sst>`),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2" t="inlineStr"><is><t>F</t></is></c></row></sheetData></worksheet>`),
    });
    expect(readXlsxFirstSheet(zip)).toEqual([['Nome', '', 'Sexo'], ['Ana Souza', '', 'F']]);
  });
});
```

```ts
// src/lib/csv.test.ts
import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';
describe('parseCsv', () => {
  it('handles BOM, semicolons, escaped quotes and CRLF', () => {
    const text = '﻿Nome;Sexo;Nascimento\r\n"Souza; Ana";F;15/06/1990\r\n"Beto ""Rápido""";M;\r\n';
    expect(parseCsv(text)).toEqual([['Nome', 'Sexo', 'Nascimento'], ['Souza; Ana', 'F', '15/06/1990'], ['Beto "Rápido"', 'M', '']]);
  });
  it('handles commas, tabs and newlines inside quotes', () => {
    expect(parseCsv('a,b\n"x\ny",2\n')).toEqual([['a', 'b'], ['x\ny', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
```

```ts
// src/lib/importMapping.test.ts  (Review Focus 3)
import { describe, it, expect } from 'vitest';
import { mapImportRows } from './importMapping';
describe('mapImportRows', () => {
  it('maps Brazilian headers and values, reporting bad rows by spreadsheet row number', () => {
    const table = [
      ['Nome Completo', 'Gênero', 'Data de Nascimento', 'E-mail', 'Celular', 'Cidade', 'Assessoria', 'Prova'],
      ['  Ana   Souza ', 'Feminino', '15/06/1990', 'ANA@X.COM', '27 99999-0000', 'Vitória', 'EBC Team', 'Corrida 5K'],
      ['Beto', 'masc', '33039', '', '', '', '', ''],
      ['', 'F', '', '', '', '', '', ''],
      ['Caio', 'X', '', '', '', '', '', ''],
      ['Dani', 'fem', '31/02/1990', '', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
    ];
    const r = mapImportRows(table);
    expect(r.rows).toEqual([
      { name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', email: 'ana@x.com', phone: '27 99999-0000', city: 'Vitória', team_club: 'EBC Team', race_name: 'Corrida 5K' },
      { name: 'Beto', sex: 'M', birth_date: '1990-06-15', email: null, phone: null, city: null, team_club: null, race_name: null },
    ]);
    expect(r.errors).toEqual([
      { row: 4, message: 'Nome vazio' },
      { row: 5, message: 'Sexo inválido: "X"' },
      { row: 6, message: 'Data de nascimento inválida: "31/02/1990"' },
    ]);
  });
  it('requires name and sex columns', () => {
    expect(mapImportRows([['Atleta', 'Cidade'], ['Ana', 'X']]).errors).toEqual([{ row: 1, message: 'Coluna obrigatória não encontrada: Sexo' }]);
  });
});
```

Import mapping rules: header row = first row with any non-empty cell; header normalization = lowercase, strip accents (`normalize('NFD').replace(/\p{Diacritic}/gu, '')`), trim, collapse spaces. Synonyms — name: `nome, nome completo, atleta, name`; sex: `sexo, genero, sex`; birth_date: `nascimento, data de nascimento, data nascimento, dt nascimento, data de nasc, birth_date`; email: `email, e-mail, e mail`; phone: `telefone, celular, whatsapp, fone, phone`; city: `cidade, city`; team_club: `equipe, assessoria, clube, time, team`; race_name: `prova, race`. Sex values (normalized): `m, masc, masculino, homem, male` → M; `f, fem, feminino, mulher, female` → F. Birth date: `parseDateInput`, or an integer 1..60000 as an Excel serial (days after 1899-12-30); empty → null. Skip rows whose cells are all empty. Row numbers are 1-based positions in the table.

- [ ] **Step 2:** run → FAIL. **Step 3:** implement `writer.ts`, `reader.ts` (DOMParser; match elements by `localName` so namespaces don't matter; resolve the first `<sheet>` through the workbook rels; read `sharedStrings.xml` when present, joining every `<t>` inside each `<si>`; types `s`, `inlineStr`, `str`, `b`, default numeric raw text; return a rectangular `string[][]` sized by the max row/column), `csv.ts` (delimiter = the most frequent of `;`, `,`, `\t` in the first line outside quotes; default `,`), `importMapping.ts`. **Step 4:** run → PASS.

- [ ] **Step 5: `scripts/verify-xlsx.py`** (used by Tasks 15 and 28):

```python
#!/usr/bin/env python3
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
for ws in wb.worksheets:
    print(f"== {ws.title} ({ws.max_row}x{ws.max_column})")
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 3), values_only=True):
        print("   ", row)
print("OK", len(wb.worksheets), "sheets")
```

Add to `writer.test.ts` a test that writes `sampleModel` to a temp file with `node:fs` and runs `python3 scripts/verify-xlsx.py <file>` via `execSync`, asserting the output contains `OK 2 sheets`.

- [ ] **Step 6: Commit** (`feat(lib): XLSX writer/reader, CSV parser and import mapping`).

---

