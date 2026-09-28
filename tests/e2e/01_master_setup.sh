#!/usr/bin/env bash
# Scenario 1 — the organizer prepares the event: first login with the forced password change,
# event with public results, a relay and an individual race, four athletes, a team entry and bulk
# individual entries. Desktop viewport (1280×800).
source "$(dirname "$0")/lib.sh"
: >"$STATE"

M=master
TODAY=$(TZ=America/Sao_Paulo date +%F)

step "login + forced password change"
ab $M set viewport 1280 800 >/dev/null
ab $M open "$APP/#/entrar" >/dev/null
wait_tid $M login-email
ab $M fill "$(tid login-email)" master@ebc.local >/dev/null
ab $M fill "$(tid login-password)" ebc-dev-12345 >/dev/null
snap $M 01-login
tap_tid $M login-submit
wait_tid $M newpass-1
ab $M fill "$(tid newpass-1)" ebc-dev-67890 >/dev/null
ab $M fill "$(tid newpass-2)" ebc-dev-67890 >/dev/null
snap $M 01-change-password
tap_tid $M newpass-submit
wait_tid $M new-event

step "create event"
tap_tid $M new-event
wait_tid $M event-name
ab $M fill "$(tid event-name)" "Desafio EBC E2E" >/dev/null
set_value $M "$(tid event-date)" "$TODAY"
ab $M fill "$(tid event-levels)" "Elite, Base" >/dev/null
snap $M 01-new-event
tap_tid $M event-create-submit
wait_tid $M new-race
EVENT_URL=$(ab $M get url)
EVENT_URL=${EVENT_URL%/provas}
save_state EVENT_URL "$EVENT_URL"

step "Geral: public results"
tap_tid $M tab-geral
wait_tid $M event-public
tap_tid $M event-public
[[ "$(ab $M is checked "$(tid event-public)")" == true ]] || fail $M "event-public not checked"
tap_tid $M event-save
ab $M wait --text "Evento salvo" >/dev/null || fail $M "event not saved"
SLUG=$(js_str $M "(() => {
  const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Endereço público'));
  return label ? document.getElementById(label.htmlFor).value : null;
})()")
[[ -n "$SLUG" && "$SLUG" != null ]] || fail $M "no public slug"
save_state SLUG "$SLUG"
snap $M 01-general

step "Provas: relay + 5 km presets"
new_race() { # preset-id expected-name
  tap_tid $M tab-provas
  wait_tid $M new-race
  tap_tid $M new-race
  wait_tid $M race-preset
  ab $M select "$(tid race-preset)" "$1" >/dev/null
  wait_tid $M race-save
  [[ "$(ab $M get value "$(tid race-name)")" == "$2" ]] || fail $M "preset $1 did not fill '$2'"
  tap_tid $M race-save
  wait_tid $M new-race
  expect_text $M main "$2"
}
new_race revezamento-dupla-aquathlon "Revezamento em dupla (natação + corrida)"
new_race corrida-5k "Corrida 5 km"
snap $M 01-races

step "Atletas"
tap $M 'nav a[href="#/atletas"]'
wait_tid $M new-athlete
new_athlete() { # name sex dd/mm/aaaa [email] [phone]
  tap_tid $M new-athlete
  wait_tid $M athlete-name
  ab $M fill "$(tid athlete-name)" "$1" >/dev/null
  ab $M select "$(tid athlete-sex)" "$2" >/dev/null
  ab $M fill "$(tid athlete-birth)" "$3" >/dev/null
  [ -n "${4:-}" ] && ab $M fill "$(tid athlete-email)" "$4" >/dev/null
  [ -n "${5:-}" ] && ab $M fill "$(tid athlete-phone)" "$5" >/dev/null
  tap_tid $M athlete-save
  ab $M wait --fn "!document.querySelector('[data-testid=athlete-name]')" >/dev/null || fail $M "athlete $1 not saved"
}
# Round 2 item 22: Ana gets an e-mail and phone so the public-page/public-payload PII checks in
# 04_public_offline.sh assert the absence of a real, exact value — a generic "no @ visible" check
# passes even when the server never omits an athlete's e-mail at all.
ANA_EMAIL="ana.e2e@example.test"
ANA_PHONE="27999990000"
new_athlete Ana F 15/06/1990 "$ANA_EMAIL" "$ANA_PHONE"
new_athlete Beto M 20/01/1988
new_athlete Caio M 03/03/1995
new_athlete Duda F 09/09/1999
save_state ANA_EMAIL "$ANA_EMAIL"
save_state ANA_PHONE "$ANA_PHONE"
for n in Ana Beto Caio Duda; do expect_text $M table "$n"; done
snap $M 01-athletes

step "Inscrições: team Tubarões + bulk 5 km"
ab $M open "$EVENT_URL/inscricoes" >/dev/null
wait_tid $M new-entry
tap_tid $M new-entry
wait_tid $M entry-race
select_label $M "$(tid entry-race)" "Revezamento em dupla (natação + corrida)"
ab $M fill "$(tid entry-team-name)" "Tubarões" >/dev/null
pick_member $M 0 Ana
pick_member $M 1 Beto
select_label $M "$(tid entry-leg-0)" Ana
select_label $M "$(tid entry-leg-1)" Beto
snap $M 01-entry-form
tap_tid $M entry-save
ab $M wait --fn "!document.querySelector('[data-testid=entry-save]')" >/dev/null || fail $M "team entry not saved"

tap_tid $M bulk-entries
wait_tid $M bulk-confirm
click_with_text $M '[role=dialog] label' Caio
click_with_text $M '[role=dialog] label' Duda
snap $M 01-bulk-entries
tap_tid $M bulk-confirm
ab $M wait --fn "!document.querySelector('[data-testid=bulk-confirm]')" >/dev/null || fail $M "bulk entries not saved"

bib_of() { # display name in the entries table → bib
  js_str $M "(() => {
    const row = [...document.querySelectorAll('table tbody tr')].find(r => r.cells[2]?.innerText.trim() === $(json "$1"));
    return row ? row.cells[0].innerText.trim() : null;
  })()"
}
TEAM_BIB=$(bib_of Tubarões); CAIO_BIB=$(bib_of Caio); DUDA_BIB=$(bib_of Duda)
for b in "$TEAM_BIB" "$CAIO_BIB" "$DUDA_BIB"; do [[ "$b" =~ ^[0-9]+$ ]] || fail $M "entries table lacks a bib (got '$b')"; done
[[ "$TEAM_BIB" != "$CAIO_BIB" && "$CAIO_BIB" != "$DUDA_BIB" && "$TEAM_BIB" != "$DUDA_BIB" ]] || fail $M "duplicate bibs"
expect_text $M table "Ana – Natação · Beto – Corrida"
save_state TEAM_BIB "$TEAM_BIB"
save_state CAIO_BIB "$CAIO_BIB"
save_state DUDA_BIB "$DUDA_BIB"
snap $M 01-entries
echo "event $EVENT_URL · slug $SLUG · bibs team=$TEAM_BIB caio=$CAIO_BIB duda=$DUDA_BIB"
