# Task 17 — task review (opus), diff d648fac..3cd4f76 — verdict: Needs fixes
(saved by the controller from the reviewer's message)

Spec ✅ — api surface (38 RPCs) matches contracts method by method; client options; ApiError network mapping; useClock singleton cadence/persistence; useSession shape/42501/changePassword order; RequireOrganizer 4 branches; useEventData key/2 s/15 s/hidden pause/since−10 s/mergeById/version refresh; EventContext 9 fields; EventLayout tabs + badge; routes; providers; stubs verbatim; test ids; Ruling 7.

## Important
1. Session restore misclassifies failures (session.tsx:87-103, :55): (a) getSession()'s `error` is ignored — offline reload after the access token expired (>1 h, normal on race morning) returns {session:null, error: AuthRetryableFetchError} with the session still stored; line 89 sets `anon` → bounced to /entrar; the offline-retry branch (96-99) is never reached; the auth listener only handles SIGNED_OUT (110) so TOKEN_REFRESHED never recovers. (b) Any non-network restore failure (PostgREST 5xx, PGRST002, 502/captive portal mapped to ApiError without network code) calls dropSession() → supabase.auth.signOut() whose default scope is 'global' → revokes refresh tokens on every device (one hiccup on the phone logs the laptop out mid-race). Brief only asks sign-out on 42501. Fix: retryable getSession error → network branch; drop only on 42501 and JWT/auth errors (401, PGRST301/PGRST303); otherwise stay loading + retry (or show retry); signOut({scope:'local'}) in dropSession (and consider for "Sair"); optionally re-run loadMe on SIGNED_IN/TOKEN_REFRESHED while anon/loading; tests for both paths.
2. (controller) importing lib/supabase throws "supabaseUrl is required." in Vitest (no .env.test) — reached via EventContext → useClock → api → supabase and via session.tsx; wave-2a tests would crash or work around it inconsistently.
3. (controller, plan-mandated) agg.timekeepers goes stale during a live event: admin_live returns only marks/resolutions/waves; registering a timekeeper / last_seen_at updates do not bump events.version → useEventData never refreshes the timekeeper list (T23 needs "última atividade há 12 s", per-timekeeper counts, names of timekeepers registered mid-event).

## Minor
1. No request timeout: a request hanging on bad 4G blocks all clock re-syncs and master live polls (single-flight) until the browser gives up (useClock.ts:48, useEventData.ts:97) — add abortSignal timeout in api.ts:39.
2. Live board can show stale data silently: poll swallows permanent errors (42501, P0001 "Evento não encontrado") and keeps polling; EventLayout ignores `error` once agg exists; `since` computed outside try (:95).
3. TanStack refetchOnWindowFocus refetches the whole aggregate on every focus (staleTime 5 s) on top of the delta poll.
4. changePassword not retryable after partial success (same_password on retry) (session.tsx:147-153).
5. Revisão tab accessible name reads "Revisão2" — badge bare text (EventLayout.tsx:66).
6. Bundle 605 kB — assign route-level lazy loading (T27 per Ruling 30).
7. Test gaps: agg reference stability after an empty poll; getSession error / 5xx during restore; SIGNED_OUT clears query cache.
