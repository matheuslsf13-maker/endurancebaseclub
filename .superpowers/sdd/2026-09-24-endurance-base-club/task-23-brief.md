## Task 23: Timing tab — link/QR, timekeepers, starts, live board

**Files:**
- Modify: `src/features/timing/TimingTab.tsx`
- Create: `src/features/timing/TimekeepersPanel.tsx`, `src/features/timing/WavesPanel.tsx`, `src/features/timing/LiveBoard.tsx`, `src/features/timing/timing.test.tsx`

**Interfaces:**
- Consumes: `useEventContext` (`agg`, `index`, `timing`, `clock`, `refresh`, `patchAgg`), `api.admin.saveEvent/rotateTkToken/updateTimekeeper/setWaveStart/updateMark`, `QrCode`, `suggestLeg`, `resolveBib`, `formatClock`, `parseClockInput`, `formatDuration`, `useNow`, `useConfirm`, `useToast`.

Behavior:
- **Link dos cronometristas**: URL `${location.origin}${location.pathname}#/c/${event.tk_token}` shown in `tk-link` (read-only input), copy `tk-copy` (clipboard + toast), share (Web Share API when available, WhatsApp link fallback `https://wa.me/?text=…`), QR `tk-qr`, toggle "Link ativo" (`saveEvent({ ...event, tk_enabled })`), "Gerar novo link" (confirm → `rotateTkToken`).
- **Cronometristas**: table (nome, última atividade relative "há 12 s", marcações, ativo toggle → `updateTimekeeper`), note which one is the reference per race (from race configs).
- **Largadas** (`WavesPanel`): per race and wave: status (horário `formatClock(…, {tenths:true})` or "Não largou"), **Largar agora** `wave-start` → `useConfirm` ("Largar <prova> – <onda> agora?") → `setWaveStart(wave.id, new Date(clock.now()).toISOString())` → `patchAgg` + `refresh`; edit time: input `wave-time-input` (`hh:mm:ss.d`) → `parseClockInput(text, event.date)`; clear (confirm).
- **Ao vivo** (`LiveBoard`, `live-board`): counters (em prova, concluídos, não largaram, pendências with link to `revisao`); per race the on-course entries with current athlete, leg label and running leg timer (`useNow(500)`); recent 30 marks feed (hora, cronometrista, Nº, perna, situação); "Sem atleta" list with an inline bib input per mark → `resolveBib` → `suggestLeg` → `updateMark(id, {entry_id, leg_index})` → `refresh`.

- [ ] **Step 1: Failing `timing.test.tsx`** (mock context/api): `wave-start` + `confirm-ok` calls `setWaveStart(waveId, <ISO equal to clock.now()>)` using a fake clock; typing `08:00:05.3` in `wave-time-input` and saving calls `setWaveStart` with `2026-10-11T11:00:05.300Z` for event date `2026-10-11`; assigning an unassigned mark to bib `101` calls `updateMark(id, {entry_id: 'en1', leg_index: 0})`; `tk-link` contains `#/c/<token>`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(timing): timekeeper link, starts and live board`).

---

