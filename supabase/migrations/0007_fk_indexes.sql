-- T29 (Supabase advisor "unindexed_foreign_keys"): a covering index for every foreign key that
-- lacked one -- the per-event filters in admin_get_event/tk_open/pub_event (timekeepers, results),
-- admin_save_race's started-or-entered wave check (entries.wave_id), and the cascade / set-null
-- actions when an event, entry, wave, timekeeper, mark or athlete is deleted. Indexes only: no
-- functions are added, so the grant block of 0006 does not need repeating.
create index entries_wave_idx on public.entries (wave_id);
create index marks_athlete_idx on public.marks (athlete_id);
create index marks_timekeeper_idx on public.marks (timekeeper_id);
create index resolutions_mark_idx on public.resolutions (mark_id);
create index results_entry_idx on public.results (entry_id);
create index results_event_idx on public.results (event_id);
create index timekeepers_event_idx on public.timekeepers (event_id);
