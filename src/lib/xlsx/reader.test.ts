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
