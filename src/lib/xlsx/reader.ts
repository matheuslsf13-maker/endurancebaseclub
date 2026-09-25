import { unzipSync, strFromU8 } from 'fflate';

/** All descendant elements (at any depth) whose localName matches, ignoring namespace prefixes. */
function byLocalName(root: Document | Element, name: string): Element[] {
  const all = root.getElementsByTagName('*');
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) out.push(all[i]);
  }
  return out;
}

function colIndexFromLetters(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function resolveTarget(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function parseSharedStrings(parser: DOMParser, xml: string): string[] {
  const doc = parser.parseFromString(xml, 'application/xml');
  return byLocalName(doc, 'si').map((si) => byLocalName(si, 't').map((t) => t.textContent ?? '').join(''));
}

function cellText(c: Element, sharedStrings: string[]): string {
  const t = c.getAttribute('t');
  if (t === 's') {
    const raw = byLocalName(c, 'v')[0]?.textContent ?? '';
    return sharedStrings[parseInt(raw, 10)] ?? '';
  }
  if (t === 'inlineStr') {
    const is = byLocalName(c, 'is')[0];
    return is ? byLocalName(is, 't').map((el) => el.textContent ?? '').join('') : '';
  }
  // 'str' (formula string result), 'b' (boolean, '1'/'0') and untyped numeric cells all carry their text in <v>.
  return byLocalName(c, 'v')[0]?.textContent ?? '';
}

/** Reads the first sheet of an XLSX package into a rectangular string[][] (sized by the max row/column seen). */
export function readXlsxFirstSheet(data: Uint8Array): string[][] {
  const files = unzipSync(data);
  const parser = new DOMParser();

  const workbookDoc = parser.parseFromString(strFromU8(files['xl/workbook.xml']), 'application/xml');
  const firstSheet = byLocalName(workbookDoc, 'sheet')[0];
  if (!firstSheet) return [];
  const rId = firstSheet.getAttribute('r:id');

  const relsDoc = parser.parseFromString(strFromU8(files['xl/_rels/workbook.xml.rels']), 'application/xml');
  const rel = byLocalName(relsDoc, 'Relationship').find((r) => r.getAttribute('Id') === rId);
  const target = rel?.getAttribute('Target');
  if (!target) return [];
  const sheetFile = files[resolveTarget(target)];
  if (!sheetFile) return [];

  const sharedStringsFile = files['xl/sharedStrings.xml'];
  const sharedStrings = sharedStringsFile ? parseSharedStrings(parser, strFromU8(sharedStringsFile)) : [];

  const sheetDoc = parser.parseFromString(strFromU8(sheetFile), 'application/xml');
  const cells: { row: number; col: number; value: string }[] = [];
  let maxRow = 0;
  let maxCol = 0;
  for (const rowEl of byLocalName(sheetDoc, 'row')) {
    for (const c of byLocalName(rowEl, 'c')) {
      const ref = c.getAttribute('r');
      const m = ref && /^([A-Za-z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const col = colIndexFromLetters(m[1].toUpperCase());
      const row = parseInt(m[2], 10);
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col + 1);
      cells.push({ row, col, value: cellText(c, sharedStrings) });
    }
  }

  const grid: string[][] = Array.from({ length: maxRow }, () => new Array<string>(maxCol).fill(''));
  for (const cell of cells) grid[cell.row - 1][cell.col] = cell.value;
  return grid;
}
