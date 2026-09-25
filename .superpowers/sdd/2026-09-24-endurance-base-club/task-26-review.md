# Task 26 — task review (sonnet), diff 221d2db..2bd2d7b — verdict: Needs fixes
(saved by the controller from the reviewer's message)

## Spec: ❌ one item (podium group order); everything else ✅
✅ Public shell (no admin nav, routes outside RequireOrganizer); PublicHome (public-events, "Ao vivo", loading/error/empty); PublicEventPage (pub.event, 10 s live poll with admin-style merge, per-race tabs, finalized races from frozen `results` with "Resultado oficial", live races via computeEventTiming/classifyRace with "Parcial – ao vivo", athlete links only when public_profile); PublicAthletePage (StatsView publicMode, never reads birth_date/public_profile); Rulings 4/29/42/43 respected in the pages; document.title per page; Step-1 tests present + 5 more.
⚠️ pub_event runtime shape (private fields stripped) — resolved by the controller: 0006_public_grants.sql pub_event emits no email/phone/birth_date (computed age_event/age_year_end instead) and supabase/tests/50_public.sql:88-95 asserts it (Task 7, reviewed clean).
Strengths: ClassificationTable/PodiumView reused for live and official views (Ruling 41); usePublicLivePoll mirrors useEventData's single-flight/visibility pattern; privacy discipline; DOM-level tests.

## Important
1. Podium groups of a FINALIZED race render in the wrong order — spec §9 ("Ordem dos grupos: sexo M, F, MISTO; faixas por `min`; níveis na ordem do evento"). `reconstructPodiums` (src/features/public/PublicEventPage.tsx:76-101) sorts groups inside a ranking alphabetically by `group_label` (line 99 localeCompare), instead of the canonical order implemented by `compareGroupOrder`/`SEX_ORDER`/`ageGroupMin`/`levelIndex` in src/domain/ranking.ts:76-158 (used by buildPodiums everywhere else). Effects: Feminino before Masculino on the official page while the live view/admin show Masculino first; age labels misorder ("até 19" sorts after "60+"). Fires for any ranking with more than one populated group; untested because the fixture has one group per ranking. Fix: reuse the domain ordering (export it from src/domain/ranking.ts) instead of the ad-hoc sort; add a finalized-race test with several sex and age groups asserting the §9 order (and that it matches the live view's order).

## Minor (deferred to the final review)
2. PublicHome.tsx:76 query-error banner uses `instanceof ApiError` (siblings and convention use `instanceof Error`); error path untested.
3. usePublicLivePoll (PublicEventPage.tsx:170-178) lacks useEventData's `refetched` guard — a delta applied after a concurrent version refetch can briefly revert resolutions/waves (self-heals on the next 10 s poll).
4. UNRANKED_STATUS_ORDER (PublicEventPage.tsx:35-36) and the numeric bib Intl.Collator (:33-34) copied from domain/ranking.ts (value-correct today).
