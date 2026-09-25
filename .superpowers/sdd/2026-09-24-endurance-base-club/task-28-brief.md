## Task 28: E2E validation with agent-browser (Vercel) against the local stack

**Files:**
- Create: `tests/e2e/run.sh`, `tests/e2e/lib.sh`, `tests/e2e/01_master_setup.sh`, `tests/e2e/02_timing.sh`, `tests/e2e/03_review_results.sh`, `tests/e2e/04_public_offline.sh`, `tests/e2e/artifacts/.gitkeep`, `tests/e2e/README.md`
- Modify: any source file needed to fix defects found (each fix gets its own failing unit test first, per TDD, then a `fix:` commit).

**Interfaces:**
- Consumes: everything; `agent-browser` 0.27 (`npm i -g agent-browser` already done), Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

`tests/e2e/lib.sh` essentials:

```bash
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
APP=${APP:-http://127.0.0.1:4173}
ART=tests/e2e/artifacts
ab() { local s=$1; shift; agent-browser --session "$s" "$@"; }                  # ab master click '[data-testid=x]'
tid() { printf '[data-testid="%s"]' "$1"; }
wait_tid() { ab "$1" wait "$(tid "$2")" >/dev/null; }
expect_text() { local s=$1 sel=$2 want=$3 got; got=$(ab "$s" get text "$sel"); [[ "$got" == *"$want"* ]] || { echo "EXPECT FAIL: '$want' not in $sel: $got"; ab "$s" screenshot "$ART/fail-$(date +%s).png"; exit 1; }; }
snap() { ab "$1" screenshot "$ART/$2.png" >/dev/null; }
step() { echo "--- $*"; }
```

`tests/e2e/run.sh`: `set -euo pipefail`; `export EBC_DB=ebc_e2e SHIM_PORT=54321`; `bash scripts/db-local.sh reset`; seed `select public.bootstrap_owner('master@ebc.local','ebc-dev-12345','Master E2E')` (keeps `must_change_password = true`); start the shim in background (log to `$ART/shim.log`) and wait for `/rest/v1/`; `npx vite build --mode e2e` then `npx vite preview --mode e2e --port 4173 --strictPort &` (log) and wait; run `01..04` in order with `bash`; on exit (`trap`) `agent-browser close --all`, kill background jobs; print `E2E PASS` or the failing script. Scenario scripts share state through `tests/e2e/artifacts/state.env` (e.g. `TK_LINK`, `SLUG`, bibs).

Scenarios (use `data-testid`s from "Test IDs"; use `find text "<label>" click` only for list items without testids):
1. `01_master_setup.sh` — open `$APP/#/entrar`, log in, forced password change to `ebc-dev-67890` (`newpass-*`), create event "Desafio EBC E2E" (today's date, levels `Elite, Base`), enable public results in Geral (`event-public`, `event-save`); Provas: create "Revezamento em dupla (natação + corrida)" preset and "Corrida 5 km" preset; Atletas: create Ana (F, 15/06/1990), Beto (M, 20/01/1988), Caio (M, 03/03/1995), Duda (F, 09/09/1999); Inscrições: team "Tubarões" (Ana → Natação, Beto → Corrida) and bulk entries for Corrida 5 km (Caio, Duda); assert the entries table lists the three bibs; screenshots `01-*.png`.
2. `02_timing.sh` — master: Cronometragem, read `TK_LINK` from `tk-link` (`get value`), start both waves (`wave-start` ×2 + `confirm-ok`); sessions `tk1` and `tk2` open `TK_LINK`, register "Ana TK" / "Bia TK"; tk1 types the team bib and taps `mark-button` → `assign-toast` contains "Natação"; `oncourse-list` then shows the team with "Corrida" (relay handoff); tk2 taps `mark-button` without bib then assigns it via `bib-input` + `bib-submit`; tk1 `set offline on`, marks the team finish, `tk-sync-status` contains "Sem internet", `set offline off`, wait until it contains "sincronizado"; tk1 and tk2 mark Caio's finish; tk1 marks Duda, `wait 4500`, tk2 marks Duda (≥ 4 s divergence); screenshots of the timekeeper screen in light and dark themes.
3. `03_review_results.sh` — master Revisão: `issues-list` contains "divergência"; open it, pick `resolution-mark-*` of Ana TK, `resolution-save`; issue gone; Resultados: select Corrida 5 km (`race-select`), `classification-table` lists Caio and Duda with positions; `podiums` visible; `ab master download "$(tid export-xlsx)" "$ART/planilha.xlsx"` then `python3 scripts/verify-xlsx.py "$ART/planilha.xlsx"` prints `OK`; `finalize-race` + `confirm-ok` → badge "Oficial"; Atletas → Ana profile shows "Pódios".
4. `04_public_offline.sh` — session `pub` opens `$APP/#/p/<slug>` → `public-results` contains "Tubarões"; opens an athlete link → `public-athlete` contains "Participações"; session `tk1`: reload `TK_LINK` with `set offline on` → the page still renders `mark-button` (service worker), then `set offline off`.

- [ ] **Step 1:** write the scripts. **Step 2:** `bash tests/e2e/run.sh` — iterate: for every failure, reproduce, write a failing unit/component test that captures the defect, fix, re-run the unit suite and E2E. **Step 3:** review every screenshot (Read the PNGs) for layout problems at 390×844 (timekeeper: `ab tk1 set viewport 390 844`) and 1280×800 (master); fix visual defects. **Step 4:** final green run of `npm run typecheck && npx vitest run && npm run test:integration && bash scripts/test-sql.sh && bash tests/e2e/run.sh`. **Step 5: Commit** (`test(e2e): agent-browser scenarios for setup, timing, review, results and public pages`).

---

