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

step "public results page never leaks e-mail, phone or birth date (C-Minor-18)"
# Checked here, before navigating away — [data-testid=public-results] no longer exists once the
# SPA moves to the athlete page below. Defensive IIFE: an element that's momentarily absent (a
# re-render) reads as '' rather than crashing the whole scenario on a TypeError.
PUB_RESULTS_TEXT=$(js_str pub "(() => { const el = document.querySelector('[data-testid=public-results]'); return el ? el.innerText : ''; })()")
# Round 2 item 22: asserts the exact registered e-mail/phone (01_master_setup.sh gave Ana both) —
# a generic "no @ visible" check would pass even if the server started leaking a *different*
# e-mail-shaped string, or would never really have exercised the leak path at all when no athlete
# had an e-mail set.
python3 - "$PUB_RESULTS_TEXT" "$ANA_EMAIL" "$ANA_PHONE" <<'PY' || fail pub "the public results page leaks private athlete data"
import sys
text, email, phone = sys.argv[1], sys.argv[2], sys.argv[3]
assert text, 'public-results text came back empty — element not found'
assert email not in text, f'{email!r} (an athlete e-mail) is visible on the public results page'
assert phone not in text, f'{phone!r} (an athlete phone) is visible on the public results page'
assert '1990' not in text, "an athlete's birth year is visible on the public results page"
PY

step "public athlete page"
click_with_text pub "$(tid public-results) a[href*=\"#/atleta/\"]" "Ana"
wait_tid pub public-athlete
wait_text pub "$(tid public-athlete)" "Participações"
snap pub 04-public-athlete

step "public athlete page never leaks e-mail, phone or birth date (C-Minor-18)"
PUB_ATHLETE_TEXT=$(js_str pub "(() => { const el = document.querySelector('[data-testid=public-athlete]'); return el ? el.innerText : ''; })()")
python3 - "$PUB_ATHLETE_TEXT" "$ANA_EMAIL" "$ANA_PHONE" <<'PY' || fail pub "the public athlete page leaks private athlete data"
import sys
text, email, phone = sys.argv[1], sys.argv[2], sys.argv[3]
assert text, 'public-athlete text came back empty — element not found'
# Ana's fixture (01_master_setup.sh): birth date 15/06/1990. pub_athlete must return only
# {id,name,sex,city,team_club} (spec §6) — never birth_date, email or phone.
assert email not in text, f'{email!r} (an athlete e-mail) is visible on the public athlete page'
assert phone not in text, f'{phone!r} (an athlete phone) is visible on the public athlete page'
assert '1990' not in text, "Ana's birth year is visible on the public athlete page"
assert '15/06' not in text, "Ana's birth date is visible on the public athlete page"
PY

step "athletes directory → search → profile → partner → Nós dois"
ab pub open "$APP/#/perfis" >/dev/null
wait_tid pub public-athletes
set_value pub "$(tid athlete-search)" "ana"
wait_text pub "$(tid public-athletes)" "Ana"
click_with_text pub "$(tid athlete-row)" "Ana"
wait_tid pub public-athlete
wait_text pub "$(tid public-athlete)" "Participações"
click_with_text pub "$(tid public-athlete) a[href*=\"#/comparar/\"]" "Beto"
wait_tid pub public-compare
wait_text pub "$(tid compare-together)" "Tubarões"
expect_text pub "$(tid compare-side-by-side)" "Participações"
COMPARE_URL=$(ab pub get url)
snap pub 04-public-compare

step "club rankings"
ab pub open "$APP/#/ranking" >/dev/null
wait_tid pub public-ranking
# brand-title headings render uppercase (CSS text-transform), and `get text` reads innerText.
wait_text pub "$(tid public-ranking)" "VITÓRIAS GERAIS"
expect_text pub "$(tid public-ranking)" "Caio"
# C-Minor-15 across SPA navigations: the "Nós dois" title must not survive into the next page.
[[ "$(js_str pub "document.title")" == "Rankings – EnduranceBaseClub" ]] || fail pub "document.title is '$(js_str pub "document.title")' on #/ranking"
snap pub 04-public-ranking

step "pub_event RPC payload never leaks e-mail, phone or birth date (round 2 item 22)"
# Belt-and-suspenders beyond the rendered-page checks above: fetches the raw RPC responses the
# page itself consumed (same shim, same anonymous role — no Authorization header) and asserts the
# exact secrets are absent from the JSON text itself, not just from whatever the UI happens to
# render from it.
PUB_EVENT_JSON=$(curl -sS -X POST "http://127.0.0.1:$SHIM_PORT/rest/v1/rpc/pub_event" \
  -H 'Content-Type: application/json' -H 'apikey: sb_publishable_local_dev' \
  -d "{\"p_slug\":\"$SLUG\"}")
ANA_ID=$(python3 - "$PUB_EVENT_JSON" "$ANA_EMAIL" "$ANA_PHONE" <<'PY'
import json, sys
raw, email, phone = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.loads(raw)  # fails loudly if the shim didn't return valid JSON (e.g. an RPC error)
assert email not in raw, f'{email!r} is present in the pub_event RPC payload'
assert phone not in raw, f'{phone!r} is present in the pub_event RPC payload'
assert 'birth_date' not in raw, "'birth_date' key is present in the pub_event RPC payload"
ana = next((a for a in data.get('athletes', []) if a.get('name') == 'Ana'), None)
assert ana is not None, 'Ana not found in the pub_event payload athletes'
print(ana['id'])
PY
) || fail pub "pub_event RPC payload leaks private athlete data or is malformed"

PUB_ATHLETE_JSON=$(curl -sS -X POST "http://127.0.0.1:$SHIM_PORT/rest/v1/rpc/pub_athlete" \
  -H 'Content-Type: application/json' -H 'apikey: sb_publishable_local_dev' \
  -d "{\"p_athlete_id\":\"$ANA_ID\"}")
python3 - "$PUB_ATHLETE_JSON" "$ANA_EMAIL" "$ANA_PHONE" <<'PY' || fail pub "pub_athlete RPC payload leaks private athlete data or is malformed"
import json, sys
raw, email, phone = sys.argv[1], sys.argv[2], sys.argv[3]
json.loads(raw)  # must be valid JSON
assert email not in raw, f'{email!r} is present in the pub_athlete RPC payload'
assert phone not in raw, f'{phone!r} is present in the pub_athlete RPC payload'
assert 'birth_date' not in raw, "'birth_date' key is present in the pub_athlete RPC payload"
PY

PUB_STATS_JSON=$(curl -sS -X POST "http://127.0.0.1:$SHIM_PORT/rest/v1/rpc/pub_stats" \
  -H 'Content-Type: application/json' -H 'apikey: sb_publishable_local_dev' -d '{}')
python3 - "$PUB_STATS_JSON" "$ANA_EMAIL" "$ANA_PHONE" <<'PY' || fail pub "pub_stats RPC payload leaks private athlete data or is malformed"
import json, sys
raw, email, phone = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.loads(raw)
assert email not in raw and phone not in raw, 'pub_stats carries an athlete e-mail or phone'
assert 'birth_date' not in raw and 'public_profile' not in raw, 'pub_stats carries birth_date or public_profile'
assert all(set(a) == {'id', 'name', 'sex', 'city', 'team_club'} for a in data['athletes']), 'unexpected athlete fields'
assert data['results'], 'pub_stats returned no result although scenario 03 finalized the races'
PY

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
ab pub open "$APP/#/perfis" >/dev/null
wait_tid pub public-athletes
no_hscroll pub "public athletes"
snap pub 04-public-athletes-mobile
ab pub open "$APP/#/atleta/$ANA_ID" >/dev/null
wait_tid pub public-athlete
wait_text pub "$(tid public-athlete)" "Participações"
no_hscroll pub "public athlete"
snap pub 04-public-athlete-mobile
ab pub open "$COMPARE_URL" >/dev/null
wait_tid pub public-compare
no_hscroll pub "public compare"
# "Lado a lado" is the point of the page: both athletes' columns must fit a 390 px phone, not
# hide behind the table's own horizontal scroll.
FITS=$(js pub "(() => { const w = document.querySelector('[data-testid=compare-side-by-side] table').parentElement; return w.scrollWidth <= w.clientWidth; })()")
[[ "$FITS" == true ]] || fail pub "the side-by-side table does not fit a 390 px screen"
snap_pages pub 04-public-compare-mobile
ab pub open "$APP/#/ranking" >/dev/null
wait_tid pub public-ranking
no_hscroll pub "public ranking"
snap_pages pub 04-public-ranking-mobile

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
