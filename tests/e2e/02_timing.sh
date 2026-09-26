#!/usr/bin/env bash
# Scenario 2 — race day: the master starts both waves, two volunteers time on phones (390×844)
# through the timekeeper link. Covers the relay handoff, a mark identified afterwards, an offline
# mark synced later, an "Em prova" arrival tap, a ≥ 4 s divergence, the one-tab-per-link lock
# (Ruling 45), focus staying in the bib field (Ruling 44 M10) and both themes (Ruling 21).
source "$(dirname "$0")/lib.sh"
load_state

M=master

# The bib field keeps the focus (and the phone keyboard) after MARCAR and after an "Em prova" tap.
expect_bib_focus() {
  local got
  got=$(js_str "$1" "document.activeElement?.dataset?.testid ?? document.activeElement?.tagName ?? ''")
  [[ "$got" == bib-input ]] || fail "$1" "focus left the bib field after $2 (active: $got)"
}
# The assignment toast must name the bib and `want`.
expect_assigned() { # session bib want
  wait_tid "$1" assign-toast
  expect_text "$1" "$(tid assign-toast)" "Nº $2"
  expect_text "$1" "$(tid assign-toast)" "$3"
}
# MARCAR with a typed bib (MARCAR already assigns it).
mark_bib() { # session bib
  ab "$1" fill "$(tid bib-input)" "$2" >/dev/null
  tap_tid "$1" mark-button
}
dismiss_toasts() { js "$1" "document.querySelectorAll('[data-testid=assign-toast] button[aria-label=Fechar]').forEach(b => b.click())" >/dev/null; }

step "master: timekeeper link"
ab $M open "$EVENT_URL/cronometragem" >/dev/null
wait_tid $M tk-link
TK_LINK=$(ab $M get value "$(tid tk-link)")
[[ "$TK_LINK" == "$APP/#/c/"* ]] || fail $M "unexpected timekeeper link: $TK_LINK"
save_state TK_LINK "$TK_LINK"

step "timekeepers register (390×844, light theme by default)"
register() { # session name
  ab "$1" set viewport 390 844 >/dev/null
  ab "$1" open "$TK_LINK" >/dev/null
  wait_tid "$1" tk-name
  [[ "$(js_str "$1" "document.documentElement.dataset.theme")" == light ]] || fail "$1" "timekeeper link did not open in the light theme"
  ab "$1" fill "$(tid tk-name)" "$2" >/dev/null
  tap_tid "$1" tk-register
  wait_tid "$1" mark-button
  wait_text "$1" "$(tid tk-sync-status)" "sincronizado"
}
register tk1 "Ana TK"
snap tk1 02-tk-registered
register tk2 "Bia TK"

step "Ruling 45: a second tab of the same link on the same device does not time"
ab tk1 tab new "$TK_LINK" >/dev/null
ab tk1 wait --text "já está aberto em outra aba" >/dev/null || fail tk1 "second tab did not show the one-tab message"
expect_text tk1 main "Este link já está aberto em outra aba deste aparelho — use aquela aba"
[[ "$(ab tk1 get count "$(tid mark-button)")" == 0 ]] || fail tk1 "second tab shows MARCAR"
snap tk1 02-tk-second-tab
ab tk1 tab close >/dev/null
ab tk1 tab t1 >/dev/null
wait_tid tk1 mark-button

step "master: start both waves"
[[ "$(ab $M get count "$(tid wave-start)")" == 2 ]] || fail $M "expected 2 waves"
for i in 0 1; do
  tap_nth $M "$(tid wave-start)" $i
  wait_tid $M confirm-ok
  tap_tid $M confirm-ok
  ab $M wait --fn "!document.querySelector('[data-testid=confirm-ok]')" >/dev/null
done
ab $M wait --fn "[...document.querySelectorAll('[data-testid=wave-time-input]')].every(i => i.value !== '')" >/dev/null \
  || fail $M "wave start times not recorded"
snap $M 02-master-waves
wait_text tk1 "$(tid oncourse-list)" "Perna 1/2 · Natação"

step "relay handoff: tk1 bib + MARCAR, tk2 MARCAR at the same crossing and identifies later"
ab tk1 fill "$(tid bib-input)" "$TEAM_BIB" >/dev/null
tap_tid tk1 mark-button
tap_tid tk2 mark-button   # within ~1 s: the same crossing, no divergence
HANDOFF_AT=$(date +%s)
expect_assigned tk1 "$TEAM_BIB" "fim da perna 1/2 (Natação)"
expect_bib_focus tk1 MARCAR
snap tk1 02-tk-assign-toast
wait_text tk2 "$(tid unassigned-list)" "Selecionada"
ab tk2 fill "$(tid bib-input)" "$TEAM_BIB" >/dev/null
tap_tid tk2 bib-submit
wait_tid tk2 assign-toast
expect_text tk2 "$(tid assign-toast)" "Natação"
ab tk2 wait --fn "document.querySelectorAll('[data-testid=unassigned-list] li').length === 0" >/dev/null \
  || fail tk2 "the identified mark is still in Sem atleta"
wait_text tk1 "$(tid oncourse-list)" "Beto · Perna 2/2 · Corrida"
expect_text tk1 "$(tid oncourse-list)" "Tubarões"
no_hscroll tk1 "after the handoff"

step "team finish marked offline (≥ 30 s after the handoff, so it is the next crossing)"
while (( $(date +%s) - HANDOFF_AT < 33 )); do sleep 1; done
dismiss_toasts tk1
ab tk1 set offline on >/dev/null
mark_bib tk1 "$TEAM_BIB"
expect_assigned tk1 "$TEAM_BIB" "fim da perna 2/2 (Corrida)"
wait_text tk1 "$(tid tk-sync-status)" "Sem internet"
expect_text tk1 "$(tid tk-sync-status)" "1 marcação guardada"
snap tk1 02-tk-offline
ab tk1 set offline off >/dev/null
wait_text tk1 "$(tid tk-sync-status)" "sincronizado" 30000

step "Caio: tk1 bib + MARCAR, tk2 taps the Em prova row (arrival tap)"
dismiss_toasts tk1
dismiss_toasts tk2
tap_tid tk2 bib-input
mark_bib tk1 "$CAIO_BIB"
click_with_text tk2 "$(tid oncourse-list) button" "Caio"
expect_assigned tk1 "$CAIO_BIB" "fim da perna 1/1 (Corrida)"
expect_assigned tk2 "$CAIO_BIB" "fim da perna 1/1 (Corrida)"
expect_bib_focus tk2 "an Em prova tap"
snap tk2 02-tk2-row-tap

step "Duda: ≥ 4 s divergence between tk1 and tk2"
dismiss_toasts tk1
dismiss_toasts tk2
mark_bib tk1 "$DUDA_BIB"
ab tk1 wait 4500 >/dev/null
mark_bib tk2 "$DUDA_BIB"
expect_assigned tk1 "$DUDA_BIB" "Duda"
expect_assigned tk2 "$DUDA_BIB" "Duda"

step "everything synced; Ruling 44 M8 pinned row"
wait_text tk1 "$(tid tk-sync-status)" "tudo sincronizado"
wait_text tk2 "$(tid tk-sync-status)" "tudo sincronizado"
wait_text tk1 "$(tid oncourse-list)" "marcada por você"
dismiss_toasts tk1
no_hscroll tk1 "end of timing"

step "themes: light (default) and dark"
snap_pages tk1 02-tk-light
tap_tid tk1 theme-toggle
[[ "$(js_str tk1 "document.documentElement.dataset.theme")" == dark ]] || fail tk1 "theme toggle did not switch to dark"
snap_pages tk1 02-tk-dark
tap_tid tk1 theme-toggle
[[ "$(js_str tk1 "document.documentElement.dataset.theme")" == light ]] || fail tk1 "theme toggle did not switch back"
ab $M scrollintoview "$(tid live-board)" >/dev/null
snap $M 02-master-live
