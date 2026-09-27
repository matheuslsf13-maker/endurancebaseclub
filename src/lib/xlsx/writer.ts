import { zipSync, strToU8 } from 'fflate';

export type StyleName = 'default' | 'header' | 'title' | 'bold' | 'time' | 'duration' | 'int' | 'decimal1';
export type CellValue = string | number | boolean | null | { formula: string; result?: number | string | null };
export type Cell = CellValue | { v: CellValue; s: StyleName };
export interface ColumnDef { header: string; width?: number; style?: StyleName }
export interface SheetModel { name: string; columns: ColumnDef[]; rows: Cell[][]; freezeHeader?: boolean; headerless?: boolean }
export interface WorkbookModel { sheets: SheetModel[] }

const SSML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// cellXfs index → StyleName, in the order declared in the task brief.
const STYLE_ORDER: StyleName[] = ['default', 'header', 'title', 'bold', 'time', 'duration', 'int', 'decimal1'];
const STYLE_INDEX = Object.fromEntries(STYLE_ORDER.map((name, i) => [name, i])) as Record<StyleName, number>;

/** Column letters for a 0-based column index: 0 → 'A', 25 → 'Z', 26 → 'AA'. */
export function colLetter(index0: number): string {
  let n = index0 + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Sanitizes a name for use as an Excel sheet name, de-duplicating against `used` (which is mutated). */
export function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (base === '') base = 'Planilha';
  base = base.slice(0, 31);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, Math.max(0, 31 - suffix.length)) + suffix;
    n++;
  }
  used.add(candidate);
  return candidate;
}

function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
function escapeXmlText(s: string): string {
  return stripControlChars(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}

function isWrapper(cell: Cell): cell is { v: CellValue; s: StyleName } {
  return typeof cell === 'object' && cell !== null && !('formula' in cell) && 'v' in cell && 's' in cell;
}

/** Renders one `<c>` element, or '' when the cell should be omitted entirely. */
function cellXml(ref: string, styleIdx: number, value: CellValue | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const s = `s="${styleIdx}"`;
  if (typeof value === 'string') {
    return `<c r="${ref}" ${s} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" ${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  if (typeof value === 'number') {
    return `<c r="${ref}" ${s}><v>${value}</v></c>`;
  }
  const formula = escapeXmlText(value.formula.replace(/^=/, ''));
  const result = value.result;
  const resultIsString = typeof result === 'string';
  const t = resultIsString ? ' t="str"' : '';
  const v = result === undefined || result === null ? '' : `<v>${resultIsString ? escapeXmlText(result) : result}</v>`;
  return `<c r="${ref}" ${s}${t}><f>${formula}</f>${v}</c>`;
}

function resolveCell(cell: Cell | undefined, columnStyle: StyleName | undefined): { value: CellValue | undefined; styleName: StyleName } {
  if (cell !== undefined && isWrapper(cell)) return { value: cell.v, styleName: cell.s };
  return { value: cell as CellValue | undefined, styleName: columnStyle ?? 'default' };
}

function colsXml(columns: ColumnDef[]): string {
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`).join('');
  return `<cols>${cols}</cols>`;
}

function worksheetXml(sheet: SheetModel): string {
  const rows: string[] = [];
  let r = 1;
  if (!sheet.headerless) {
    const cells = sheet.columns.map((col, i) => cellXml(`${colLetter(i)}${r}`, STYLE_INDEX.header, col.header)).filter(Boolean).join('');
    rows.push(`<row r="${r}">${cells}</row>`);
    r++;
  }
  for (const row of sheet.rows) {
    const cells = sheet.columns.map((col, i) => {
      const { value, styleName } = resolveCell(row[i], col.style);
      return cellXml(`${colLetter(i)}${r}`, STYLE_INDEX[styleName], value);
    }).filter(Boolean).join('');
    rows.push(`<row r="${r}">${cells}</row>`);
    r++;
  }
  const sheetViews = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';
  return `${XML_HEADER}<worksheet xmlns="${SSML_NS}">${sheetViews}${colsXml(sheet.columns)}<sheetData>${rows.join('')}</sheetData></worksheet>`;
}

function contentTypesXml(n: number): string {
  const overrides = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + overrides + '</Types>';
}

const RELS_XML = `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}">`
  + `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function workbookXml(names: string[]): string {
  const sheets = names.map((name, i) => `<sheet name="${escapeXmlAttr(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `${XML_HEADER}<workbook xmlns="${SSML_NS}" xmlns:r="${REL_NS}"><sheets>${sheets}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
}

function workbookRelsXml(n: number): string {
  const sheetRels = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  return `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}">${sheetRels}`
    + `<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
}

// Fonts: [0] Calibri 11 regular, [1] Calibri 11 bold, [2] Calibri 11 bold size 13.
// Fills: [0] none, [1] gray125 (mandatory), [2] solid FFD9D3C9 (header).
// Borders: [0] none, [1] thin bottom (header).
const STYLES_XML = `${XML_HEADER}<styleSheet xmlns="${SSML_NS}">`
  + '<numFmts count="3">'
  + '<numFmt numFmtId="164" formatCode="hh:mm:ss.0"/>'
  + '<numFmt numFmtId="165" formatCode="[h]:mm:ss.0"/>'
  + '<numFmt numFmtId="166" formatCode="0.0"/>'
  + '</numFmts>'
  + '<fonts count="3">'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="13"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="3">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D3C9"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="2">'
  + '<border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left/><right/><top/><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>'
  + '</borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="8">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' // 0 default
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' // 1 header
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // 2 title
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // 3 bold
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // 4 time
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // 5 duration
  + '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // 6 int
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // 7 decimal1
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

export function writeXlsx(model: WorkbookModel): Uint8Array {
  const used = new Set<string>();
  const names = model.sheets.map((sheet) => sanitizeSheetName(sheet.name, used));
  const n = model.sheets.length;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypesXml(n)),
    '_rels/.rels': strToU8(RELS_XML),
    'xl/workbook.xml': strToU8(workbookXml(names)),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml(n)),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  model.sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(worksheetXml(sheet));
  });

  return zipSync(files);
}
