## Task 26: Public pages — events, live results, athlete profile

**Files:**
- Modify: `src/features/public/PublicHome.tsx`, `src/features/public/PublicEventPage.tsx`, `src/features/public/PublicAthletePage.tsx`
- Create: `src/features/public/public.test.tsx`

**Interfaces:**
- Consumes: `api.pub.*`, `computeEventTiming`, `classifyRace`, `indexEvent`, `mergeById`, `ClassificationTable`, `PodiumView` (Task 25), `StatsView` (Task 20), `Logo`, `ThemeToggle`.

Behavior:
- Public shell (no admin nav): logo + "ENDURANCE BASE CLUB", theme toggle, link "Área da organização" → `#/entrar`.
- `PublicHome` (`public-events`): list of public events (date, name, location, status "Ao vivo" highlighted) linking to `#/p/<slug>`.
- `PublicEventPage` (`public-results`): loads `pub.event(slug)`; polls `pub.live(slug, since)` every 10 s while visible (merge like the admin); per race tabs; if the race has finalized `results`, show them ordered by `overall_pos` (from snapshots) with badge "Resultado oficial"; else compute timing/classification client-side with badge "Parcial – ao vivo" and auto-refresh note; podiums; athlete names link to `#/atleta/<id>` when `public_profile`.
- `PublicAthletePage` (`public-athlete`): `pub.athlete(id)` → name/city/team + `StatsView(publicMode)`; not found message.
- `document.title` updated per page (`<Evento> – Resultados`).

- [ ] **Step 1: Failing `public.test.tsx`** (mock api): home lists events with links; event page renders classification rows from a live payload and shows "Resultado oficial" when `results` exist for a race; athlete page renders "Participações".
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(public): public results and athlete profiles`).

---

