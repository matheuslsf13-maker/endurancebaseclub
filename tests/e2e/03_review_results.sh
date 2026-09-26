#!/usr/bin/env bash
# Scenario 3 — after the race: the master resolves the divergence in Revisão, checks the
# classification and podiums, exports the conference workbook (Ruling 24 number formats),
# finalizes the races and sees the athlete's stats. Desktop viewport (1280×800).
source "$(dirname "$0")/lib.sh"
load_state

M=master

step "Revisão: the divergence is listed"
ab $M open "$EVENT_URL/revisao" >/dev/null
wait_tid $M issues-list
wait_text $M "$(tid issues-list)" "divergência"
expect_text $M "$(tid issues-list)" "Nº $DUDA_BIB"
snap $M 03-review-issues

step "resolve it with Ana TK's mark"
found=$(js $M "(() => {
  const li = [...document.querySelectorAll('[data-testid=issues-list] li')].find(l => l.innerText.includes('divergência'));
  const btn = li && [...li.querySelectorAll('button')].find(b => b.innerText.trim() === 'Resolver');
  if (!btn) return false;
  btn.setAttribute('data-e2e-target', '1');
  return true;
})()")
[[ "$found" == true ]] || fail $M "no Resolver button on the divergence"
tap $M '[data-e2e-target="1"]'
wait_tid $M resolution-save
ANA_MARK=$(js_str $M "(() => {
  const input = [...document.querySelectorAll('input[data-testid^=resolution-mark-]')].find(i => i.closest('label')?.innerText.includes('Ana TK'));
  return input ? input.dataset.testid : null;
})()")
[[ "$ANA_MARK" == resolution-mark-* ]] || fail $M "no resolution-mark for Ana TK"
tap_tid $M "$ANA_MARK"
[[ "$(ab $M is checked "$(tid "$ANA_MARK")")" == true ]] || fail $M "Ana TK's mark not chosen"
snap $M 03-review-editor
tap_tid $M resolution-save
ab $M wait --fn "!document.querySelector('[data-testid=resolution-save]')" >/dev/null || fail $M "resolution not saved"
ab $M wait --fn "!(document.querySelector('[data-testid=issues-list]')?.innerText ?? '').includes('divergência')" >/dev/null \
  || fail $M "the divergence is still listed after the resolution"
snap $M 03-review-resolved

step "Resultados: Corrida 5 km classification and podiums"
tap_tid $M tab-resultados
wait_tid $M race-select
select_label $M "$(tid race-select)" "Corrida 5 km"
wait_text $M "$(tid classification-table)" "Caio"
expect_text $M "$(tid classification-table)" "Duda"
ROWS=$(js_str $M "JSON.stringify([...document.querySelectorAll('[data-testid=classification-row]')].map(r => r.cells[0].innerText.trim() + ' ' + r.innerText.replace(/\s+/g, ' ')))")
echo "classification: $ROWS"
python3 - "$ROWS" <<'PY' || fail $M "Caio and Duda are not both ranked (1º/2º)"
import json, sys
rows = json.loads(sys.argv[1])
ranked = {name: r.split(' ', 1)[0] for r in rows for name in ('Caio', 'Duda') if name in r}
assert sorted(ranked.values()) == ['1', '2'], ranked
PY
ab $M wait "$(tid podiums)" >/dev/null || fail $M "no podiums"
[[ "$(ab $M is visible "$(tid podiums)")" == true ]] || fail $M "podiums not visible"
expect_text $M "$(tid podiums)" "Caio"
snap $M 03-results-5k

step "export the workbook (verify-xlsx + Ruling 24 number formats)"
ab $M scrollintoview "$(tid export-xlsx)" >/dev/null
ab $M download "$(tid export-xlsx)" "$ART/planilha.xlsx" >/dev/null || fail $M "workbook download failed"
python3 scripts/verify-xlsx.py "$ART/planilha.xlsx" >"$ART/verify-xlsx.txt" || fail $M "verify-xlsx crashed"
tail -1 "$ART/verify-xlsx.txt" | grep -q '^OK' || fail $M "verify-xlsx did not print OK: $(tail -1 "$ART/verify-xlsx.txt")"
python3 - "$ART/planilha.xlsx" <<'PY' || fail $M "workbook number formats (Ruling 24)"
# Ruling 24: typed durations/clock serials keep explicit number formats.
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
CLOCK, DURATION = 'hh:mm:ss.0', '[h]:mm:ss.0'
checked = {CLOCK: 0, DURATION: 0}
def expect(cell, fmt, where):
    if cell.value is None:
        return
    assert cell.number_format == fmt, f'{where} {cell.coordinate}: {cell.number_format!r} != {fmt!r}'
    # 'n' number, 'd' a number openpyxl turned into a date/time because of its format, 'f' formula
    # (with a cached numeric result) — never 's': the old "tempo como TEXTO" is what Ruling 24 rejects.
    assert cell.data_type in ('n', 'd', 'f'), f'{where} {cell.coordinate}: {cell.data_type} {cell.value!r}'
    checked[fmt] += 1
tempos = [ws for ws in wb.worksheets if ws.title.startswith('Tempos')]
assert len(tempos) == 2, [ws.title for ws in wb.worksheets]
for ws in tempos:
    headers = [c.value or '' for c in ws[1]]
    for col, h in enumerate(headers, start=1):
        fmt = CLOCK if h == 'Largada' or h.startswith('Passagem') else \
              DURATION if h.startswith('Tempo ') or h in ('Total', 'Penalidade', 'Final') else None
        if fmt:
            for row in range(2, ws.max_row + 1):
                expect(ws.cell(row, col), fmt, f'{ws.title} [{h}]')
for ws in wb.worksheets:
    if ws.title.startswith('Classificação'):
        headers = [c.value or '' for c in ws[1]]
        for col, h in enumerate(headers, start=1):
            if h in ('Tempo final', 'Dif. p/ 1º'):
                for row in range(2, ws.max_row + 1):
                    expect(ws.cell(row, col), DURATION, f'{ws.title} [{h}]')
assert checked[CLOCK] >= 6 and checked[DURATION] >= 6, checked
print('number formats OK', checked)
PY

step "finalize both races"
finalize() { # race name
  select_label $M "$(tid race-select)" "$1"
  wait_tid $M finalize-race
  tap_tid $M finalize-race
  wait_tid $M confirm-ok
  tap_tid $M confirm-ok
  wait_tid $M unfinalize-race
  expect_text $M main "Oficial"
}
finalize "Corrida 5 km"
snap $M 03-results-official
finalize "Revezamento em dupla (natação + corrida)"
expect_text $M "$(tid classification-table)" "Tubarões"

step "Atletas: Ana's profile shows her stats"
tap $M 'nav a[href="#/atletas"]'
wait_tid $M new-athlete
click_with_text $M 'table a' Ana
wait_text $M main "Pódios"
expect_text $M main "Participações"
snap $M 03-athlete-ana

step "master screens at 390×844"
ab $M set viewport 390 844 >/dev/null
for tab in cronometragem revisao resultados; do
  ab $M open "$EVENT_URL/$tab" >/dev/null
  wait_tid $M tab-$tab
  ab $M wait 800 >/dev/null
  snap_pages $M "03-mobile-$tab"
  no_hscroll $M "$tab"
done
ab $M open "$EVENT_URL/revisao" >/dev/null
wait_tid $M crossing-row
click_with_text $M "$(tid crossing-row)" "Nº $DUDA_BIB ·"
wait_tid $M resolution-save
snap $M 03-mobile-review-editor
ab $M press Escape >/dev/null
ab $M open "$APP/#/eventos" >/dev/null
wait_tid $M new-event
snap $M 03-mobile-events
no_hscroll $M "eventos"
ab $M set viewport 1280 800 >/dev/null
