#!/usr/bin/env bash
# Scenario 4 — the public follows the results (desktop and phone), and a timekeeper's phone
# reloads the link with no signal: the service worker still serves the app shell.
source "$(dirname "$0")/lib.sh"
load_state

step "public results"
ab pub set viewport 1280 800 >/dev/null
ab pub open "$APP/#/p/$SLUG" >/dev/null
wait_tid pub public-results
wait_text pub "$(tid public-results)" "Tubarões"
expect_text pub "$(tid public-results)" "Resultado oficial"
snap pub 04-public-results

step "public athlete page"
click_with_text pub "$(tid public-results) a[href*=\"#/atleta/\"]" "Ana"
wait_tid pub public-athlete
wait_text pub "$(tid public-athlete)" "Participações"
snap pub 04-public-athlete

step "public pages at 390×844"
ab pub set viewport 390 844 >/dev/null
ab pub open "$APP/#/p/$SLUG" >/dev/null
wait_text pub "$(tid public-results)" "Tubarões"
snap_pages pub 04-public-results-mobile
no_hscroll pub "public results"
ab pub open "$APP/#/" >/dev/null
wait_tid pub public-events
wait_text pub "$(tid public-events)" "Desafio EBC E2E"
snap pub 04-public-home-mobile

step "timekeeper reloads the link offline (service worker)"
[[ "$(js tk1 "navigator.serviceWorker.ready.then(r => r.active !== null)")" == true ]] || fail tk1 "no active service worker"
[[ "$(ab tk1 get url)" == "$TK_LINK" ]] || fail tk1 "tk1 is not on the timekeeper link"
ab tk1 set offline on >/dev/null
ab tk1 reload >/dev/null || fail tk1 "offline reload failed (no service worker response)"
wait_tid tk1 mark-button
wait_text tk1 "$(tid tk-sync-status)" "Sem internet"
[[ "$(js tk1 "navigator.serviceWorker.controller !== null")" == true ]] || fail tk1 "page not served by the service worker"
snap tk1 04-tk-offline-reload
ab tk1 set offline off >/dev/null
wait_text tk1 "$(tid tk-sync-status)" "sincronizado" 30000
