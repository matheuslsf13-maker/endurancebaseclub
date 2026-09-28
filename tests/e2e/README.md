# End-to-end tests (agent-browser)

`bash tests/e2e/run.sh` plays a whole event day against the local stack and prints `E2E PASS`
or the scenario that failed:

1. resets the Postgres database `ebc_e2e` (`scripts/db-local.sh`) and seeds the owner
   `master@ebc.local` / `ebc-dev-12345` (password change still required);
2. starts the auth/RPC shim on `:54321` and waits for it;
3. builds the app with `vite build --mode e2e` (`.env.e2e` → the local shim) and serves it with
   `vite preview` on `:4173`;
4. runs the scenarios in order, each driving one or more `agent-browser --session <name>` browsers:

| Script | Viewport | What it proves |
|---|---|---|
| `01_master_setup.sh` | 1280×800 | login + forced password change; event with public results; relay and 5 km races from presets; four athletes; team "Tubarões" and bulk entries; the three bibs |
| `02_timing.sh` | master 1280×800, `tk1`/`tk2` 390×844 | timekeeper link opens in the light theme (Ruling 21); one tab per link and device (Ruling 45); both waves started; relay handoff (bib + MARCAR, and a mark identified afterwards); a mark taken offline and synced; an "Em prova" arrival tap; a ≥ 4 s divergence; the bib field keeps the focus after MARCAR and after a row tap (Ruling 44); no sideways scroll; light and dark screenshots |
| `03_review_results.sh` | 1280×800, then 390×844 | the divergence is resolved with Ana TK's mark; classification and podiums; the exported workbook passes `scripts/verify-xlsx.py` and keeps its number formats (Ruling 24: clock `hh:mm:ss.0`, durations `[h]:mm:ss.0`); both races finalized ("Oficial"); athlete stats; admin screens at phone width |
| `04_public_offline.sh` | 1280×800 and 390×844 | public results (with the team name) and a public athlete page; a timekeeper reloading the link with no signal still gets the app from the service worker |

Scenarios share values (event URL, public slug, timekeeper link, bibs) through
`tests/e2e/artifacts/state.env`. Screenshots (`01-*.png` … `04-*.png`), the downloaded
`planilha.xlsx`, the shim/build/preview logs and any `fail-<session>-<time>.png` land in
`tests/e2e/artifacts/` (git-ignored, emptied at the start of each run).

## Requirements

Linux (WSL on the Windows machine), as root because `scripts/db-local.sh` runs Postgres 16 through
`runuser`: Node 22 with this repo's Linux `node_modules`, Postgres 16 at `/usr/lib/postgresql/16/bin`,
`python3` + `openpyxl`, `curl`, and `agent-browser` 0.27 with its installed Chrome
(`npm i -g agent-browser && agent-browser install`). Set `AGENT_BROWSER_EXECUTABLE_PATH` only to
use another browser binary; `APP` overrides the app URL (default `http://127.0.0.1:4173`).

```bash
wsl.exe -d Ubuntu-24.04 -u root -e bash -lc 'cd /mnt/c/ENDURANCE/<worktree> && bash tests/e2e/run.sh'
```

## Writing steps

Helpers live in `lib.sh`. Click through `tap`/`tap_tid` (agent-browser 0.27 does not scroll a CSS
selector into view before clicking it), select options by label with `select_label`, and set
`<input type=date>` with `set_value` (typed dates depend on the browser locale). Selectors are the
`data-testid`s of the contract; `click_with_text` is only for list items without one.
