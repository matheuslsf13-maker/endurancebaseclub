const DELIMITERS = [';', ',', '\t'] as const;

/** Most frequent of `;`, `,`, `\t` in the first line, counted outside quoted spans; default ','. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/)[0] ?? '';
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best: string = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    if (counts[d] > bestCount) { best = d; bestCount = counts[d]; }
  }
  return best;
}

/** RFC4180-ish parser: auto-detects the delimiter, strips a UTF-8 BOM, honors quoted fields (with "" escaping,
 *  embedded delimiters/newlines) and CRLF/LF/CR line endings. A trailing newline never yields a spurious blank row. */
export function parseCsv(text: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = detectDelimiter(t);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delim) { pushField(); i++; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      i++;
      pushRow();
      continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length > 0) pushRow();

  return rows;
}
