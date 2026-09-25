# Task 14 report — XLSX writer/reader, CSV parser, import mapping

Branch: `task/14` in worktree `/home/claude/ebc-wt/t14`. Commit: `63cce2a` — `feat(lib): XLSX writer/reader, CSV parser and import mapping`.

## What was implemented

- `src/lib/xlsx/writer.ts` (195 lines) — minimal SpreadsheetML writer on `fflate` (`zipSync`/`strToU8`). Exports `StyleName`, `CellValue`, `Cell`, `ColumnDef`, `SheetModel`, `WorkbookModel`, `sanitizeSheetName`, `colLetter`, `writeXlsx`.
  - Package parts: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml` (`<calcPr calcId="191029" fullCalcOnLoad="1"/>`), `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, one `xl/worksheets/sheetN.xml` per sheet.
  - Styles: `cellXfs` 0..7 = `default, header, title, bold, time, duration, int, decimal1` exactly as specified (fonts Calibri 11 / bold / bold-13; header fill solid `FFD9D3C9` + thin bottom border; mandatory `gray125` fill at index 1; numFmts 164/165/166 for time/duration/decimal1, built-in `numFmtId=1` for int). Added a `<cellStyles>`/"Normal" entry (not explicitly required by the brief) after noticing openpyxl warned "Workbook contains no default style" without it — silent now.
  - Cell writing: explicit `{v,s}` style wins, else column style, else `default`; header row always styled `header` unless `headerless`; strings → `t="inlineStr"` with XML-escaping + control-char stripping; numbers → bare `<v>`; booleans → `t="b"`, `1`/`0`; `null`/`''` → cell omitted entirely (no `<c>` at all); formulas → `<f>` (leading `=` stripped defensively) + cached `<v>` (`t="str"` only when the cached result is a string).
  - `sanitizeSheetName`: strips `[]:*?/\`, collapses/trims whitespace, empty → `Planilha`, cuts to 31 chars, de-dupes via ` (2)`, ` (3)`… against a caller-owned `Set`.
- `src/lib/xlsx/reader.ts` (82 lines) — `readXlsxFirstSheet(data): string[][]`. Uses `DOMParser` (`application/xml`) and matches elements by `localName` so namespace prefixes don't matter. Resolves the first `<sheet>` via `xl/workbook.xml` → `xl/_rels/workbook.xml.rels` → target path (relative targets resolved against `xl/`). Reads `xl/sharedStrings.xml` when present, joining every `<t>` inside each `<si>` (handles both `<si><t>` and rich-text `<si><r><t>` runs). Cell types `s`/`inlineStr`/`str`/`b`/untyped-numeric all resolved to a string; output is rectangular, sized by the max row/column actually referenced, gaps filled with `''`.
- `src/lib/csv.ts` (57 lines) — `parseCsv(text): string[][]`. Strips a leading U+FEFF BOM; delimiter auto-detected as the most frequent of `;`, `,`, `\t` outside quotes in the first line (default `,`); hand-written RFC4180 state machine (quoted fields, `""` escaping, delimiters/newlines inside quotes, CRLF/LF/CR line endings, no spurious empty row from a trailing newline).
- `src/lib/importMapping.ts` (125 lines) — `mapImportRows(table): MappedImport`. Header row = first row with any non-empty cell; header/value normalization = lowercase → NFD → strip `\p{Diacritic}` → trim → collapse spaces. Full pt-BR synonym tables for all 8 `ImportRowInput` fields; sex synonyms → `M`/`F`; birth date via `parseDateInput` (reused from Task 1, unmodified) or an Excel serial integer 1..60000 (`days - 25569` → UTC date, verified `33039 → 1990-06-15`); empty optional fields → `null`; all-empty rows skipped; missing required `name`/`sex` columns short-circuit with `Coluna obrigatória não encontrada: <Nome|Sexo>` and no row output. Bad rows report exactly one pt-BR error each, keyed by 1-based table row number.
- `scripts/verify-xlsx.py` — verbatim from the brief; used by the writer test and manually below.
- `src/lib/xlsx/testModel.ts` — per the plan's Ruling 3, `sampleModel` lives here (not exported from `writer.test.ts`) and is imported by both `writer.test.ts` and `reader.test.ts`.

All four test files were transcribed verbatim from the task brief (`writer.test.ts`, `reader.test.ts`, `csv.test.ts`, `importMapping.test.ts`), with the Step 5 addition to `writer.test.ts` (temp-file + `execSync scripts/verify-xlsx.py` + `toContain('OK 2 sheets')`).

## TDD evidence

**RED** — before any implementation existed, `npx vitest run src/lib/xlsx src/lib/csv.test.ts src/lib/importMapping.test.ts` failed all 4 suites with `Failed to resolve import "./writer"` / `"./csv"` / `"./importMapping"` / `"./reader"` (0 tests ran; import resolution errors, i.e. the expected failing state before implementation).

**GREEN** — after implementing `writer.ts`, `reader.ts`, `csv.ts`, `importMapping.ts`:
```
npx vitest run src/lib
 Test Files  6 passed (6)
      Tests  23 passed (23)
```
(6 files = the two pre-existing Task 1 suites `format.test.ts`/`storage.test.ts` plus the four new ones; 23 tests total, all passing, none skipped.)

## Verification run

- `npx vitest run src/lib` → 6 passed / 6, 23 passed / 23.
- `npx vitest run` (whole project) → same 6 files / 23 tests, all green (no other test files exist yet in this worktree).
- `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) → clean, no errors.
- Manual `python3 scripts/verify-xlsx.py` on a freshly generated file (via a throwaway `node --experimental-strip-types` script that called `writeXlsx(sampleModel)`, written to disk, then deleted along with the temp `.xlsx` — nothing left in the worktree):

```
== Tempos – Corrida 5K (3x5)
    ('Nº', 'Atleta', 'Largada', 'Chegada', 'Tempo')
    ('101', 'Ana & Bia <3>', datetime.datetime(2026, 10, 11, 10, 59, 57, 120000), datetime.datetime(2026, 10, 11, 11, 19, 58, 80000), '=D2-C2')
    (None, True, datetime.datetime(1900, 1, 1, 0, 0), datetime.datetime(1900, 1, 2, 0, 0), 'Total')
== Tempos – Corrida 5K (2) (1x1)
    ('x',)
OK 2 sheets
```
openpyxl correctly opens both sheets, resolves the two time-formatted numeric cells as real datetimes (confirming the `time` numFmt is recognized), reads the boolean, reads the formula text (`=D2-C2`, openpyxl's own display convention — the file stores `<f>D2-C2</f>` with no leading `=`, per spec), and reports the accurate `(3x5)`/`(1x1)` dimensions including the omitted-cell row. This is independent, real-world confirmation beyond the vitest assertions.

## Files changed (all new; nothing pre-existing was modified)

- `/home/claude/ebc-wt/t14/src/lib/xlsx/writer.ts`
- `/home/claude/ebc-wt/t14/src/lib/xlsx/writer.test.ts`
- `/home/claude/ebc-wt/t14/src/lib/xlsx/reader.ts`
- `/home/claude/ebc-wt/t14/src/lib/xlsx/reader.test.ts`
- `/home/claude/ebc-wt/t14/src/lib/xlsx/testModel.ts`
- `/home/claude/ebc-wt/t14/src/lib/csv.ts`
- `/home/claude/ebc-wt/t14/src/lib/csv.test.ts`
- `/home/claude/ebc-wt/t14/src/lib/importMapping.ts`
- `/home/claude/ebc-wt/t14/src/lib/importMapping.test.ts`
- `/home/claude/ebc-wt/t14/scripts/verify-xlsx.py`

`git status` before committing showed only these 10 new/untracked files — no shared/owned-by-other-tasks files were touched (`package.json`, `src/App.tsx`, `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/format.ts` all untouched).

## Self-review findings

Traced every assertion in all four test files by hand against the implementation before running them, then again after GREEN. Specific things checked and confirmed correct:
- `colLetter`/inverse column-letter math (0→A, 25→Z, 26→AA, 701→ZZ, 702→AAA) verified by manual bijective-base-26 arithmetic.
- `sanitizeSheetName` de-dup truncation math for the 46-character Portuguese name, confirmed the ` (2)` suffix keeps the total ≤ 31 chars.
- Cell-style precedence (explicit `{v,s}` > column style > `default`), header-row-always-`header`-style, and null/`''`-omission (including that omitted cells leave no `<c>` element at all, not just an empty one) — matches both the regex assertions and the "not.toContain('r=\"A3\"')" check.
- Excel-serial round trip: hand-verified `33039 → 1990-06-15` via the `days - 25569` formula (same convention as the existing `excelSerialBrasilia` in `format.ts`) before trusting the test fixture's coincidental match with Ana's text-format date.
- `parseCsv`'s trailing-newline handling (no spurious empty final row) traced character-by-character for all three test strings, including the doubled-quote escape sequence in `"Beto ""Rápido"""`.
- `mapImportRows` row-number indexing (header at table index 0 → row 1, data rows → row 2..7) traced against the 7-row fixture to confirm the 4/5/6 error rows and the 2/3 accepted rows line up exactly with 1-based table positions, and that the required-column short-circuit uses the header row's own row number.
- No stray `console.*`/`TODO`/`debugger` in any new file (grep clean).
- No lint config exists in this project (checked `package.json` scripts and for `.eslintrc*`/`eslint.config*` — none), so no separate lint step was skipped.

One deviation from a literal reading of the brief, made deliberately: added a `<cellStyles>`/"Normal" block to `styles.xml` that the brief's prose doesn't mention, because without it openpyxl printed `UserWarning: Workbook contains no default style, apply openpyxl's default` — harmless to the tests but a real correctness smell for a hand-rolled OOXML writer. Adding the standard `cellStyles` entry (referencing `cellStyleXfs` index 0) removed the warning and is a one-line, spec-compliant addition; all writer tests still pass unchanged.

## Concerns

None blocking. `writer.ts` is 195 lines (comfortably under the ~300-line guidance, no restructuring needed). Two small interpretive calls where the brief was silent and no test constrained the choice, noted for awareness:
1. `readXlsxFirstSheet`'s handling of `t="b"` (boolean) cells returns the raw `<v>` text (`'1'`/`'0'`) rather than e.g. `'true'`/`'false'` — matches what our own writer emits and is the simplest defensible reading of "types `s`, `inlineStr`, `str`, `b`, default numeric raw text", but isn't exercised by any test (the roundtrip test only checks columns A–C of the boolean row).
2. `mapImportRows` reports at most one error per data row (checks name → sex → birth_date in that order, stopping at the first failure) since the fixture never exercises two simultaneous failures in one row; this seemed the natural reading of "bad rows reported with row numbers" (one message per bad row) but a different multi-error-per-row design would also have been defensible.

Both are internal to modules whose only consumers so far are this task's own tests; future tasks (15, 20) consume `writeXlsx`/`WorkbookModel`, `parseCsv`, and `mapImportRows` at the documented signatures only, so neither choice constrains them.
