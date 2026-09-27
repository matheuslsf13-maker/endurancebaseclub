## Task 6: Timing RPCs (organizer live tools + timekeeper link)

**Files:**
- Create: `supabase/migrations/0005_timing.sql`, `supabase/tests/40_timing.sql`

**Interfaces:**
- Produces: `admin_live(p_event_id uuid, p_since timestamptz)`, `admin_update_mark(p_mark_id uuid, p_patch jsonb)`, `admin_set_resolution(p_entry_id uuid, p_leg_index int, p_mode text, p_mark_id uuid, p_manual_ts timestamptz, p_note text)`, `admin_clear_resolution(p_entry_id uuid, p_leg_index int)`, `admin_update_timekeeper(p_timekeeper_id uuid, p_patch jsonb)`, `admin_finalize_race(p_race_id uuid, p_rows jsonb)`, `admin_unfinalize_race(p_race_id uuid)`, `tk_open(p_token text)`, `tk_register(p_token text, p_name text, p_device_label text)`, `tk_sync(p_token text, p_timekeeper_id uuid, p_secret text, p_marks jsonb, p_since timestamptz)`; internal `tk_event(p_token text) returns public.events` (raises `Link de cronometragem inválido ou desativado`).

Behavior details:
- `admin_live`: `{server_now: now(), version, marks: marks of event with p_since is null or updated_at >= p_since (order by ts), resolutions: all of event, waves: all of event}`.
- `admin_update_mark(p_mark_id, p_patch)`: keys may be absent. `entry_id` present & null → unassign (`leg_index` null). `entry_id` non-null → entry of the same event, `leg_index` required (patch or keep existing if same entry) and `0 <= leg_index < legs length` (`Perna inválida`). `discarded` true → `discarded_by 'organizer'`; false → `discarded=false, discarded_by=null`. Returns the mark row.
- `admin_set_resolution`: leg index valid for the entry's race; `system` → no mark/manual; `mark` → mark must be non-discarded with that `entry_id` and `leg_index` (`Marcação não pertence a esta passagem`); `manual` → `p_manual_ts` not null. Upsert on `(entry_id, leg_index)`, `decided_by = auth.uid()`, `event_id` from entry. Returns the row.
- `admin_update_timekeeper`: `name` (non-empty) and/or `active` (bool). Returns row without `secret`.
- `admin_finalize_race(p_race_id, p_rows)`: delete existing results of the race; insert each row (`entry_id` must belong to the race, `athlete_ids` from the row, `status`, `final_ms`, `overall_pos`, `data`); `races.finalized_at = now()`; return `{finalized_at, count}`. `admin_unfinalize_race`: delete results, `finalized_at = null`.
- `tk_open(p_token)`: `TkSession` — event `{id,name,date,location}`, races, waves, `entries` via `entry_json(id, true)`, timekeepers `{id,name}` (all of the event), `version`, `server_now`.
- `tk_register(p_token, p_name, p_device_label)`: name trimmed 1..60 chars (`Informe seu nome`); insert timekeeper with `secret = random_token(32)`; return `{timekeeper_id, secret}`.
- `tk_sync` (critical — implement exactly):

```sql
create or replace function public.tk_sync(p_token text, p_timekeeper_id uuid, p_secret text, p_marks jsonb, p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events := public.tk_event(p_token);
        tk public.timekeepers; m jsonb; v_id uuid; ex public.marks; v_entry public.entries; v_legs int;
        v_entry_id uuid; v_leg int; v_discarded boolean; v_ts timestamptz;
        accepted jsonb := '[]'; rejected jsonb := '[]';
begin
  select * into tk from public.timekeepers where id = p_timekeeper_id and event_id = ev.id and secret = p_secret;
  if not found then raise exception 'Cronometrista não autorizado' using errcode = 'P0001'; end if;
  if not tk.active then raise exception 'Seu acesso foi desativado pela organização' using errcode = 'P0001'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    begin
      v_id := (m ->> 'id')::uuid;
      v_entry_id := nullif(m ->> 'entry_id', '')::uuid;
      v_leg := (m ->> 'leg_index')::int;
      v_discarded := coalesce((m ->> 'discarded')::boolean, false);
      if v_entry_id is null then v_leg := null;
      else
        select * into v_entry from public.entries where id = v_entry_id and event_id = ev.id;
        if not found then raise exception 'Atleta não encontrado neste evento'; end if;
        select jsonb_array_length(legs) into v_legs from public.races where id = v_entry.race_id;
        if v_leg is null or v_leg < 0 or v_leg >= v_legs then raise exception 'Perna inválida'; end if;
      end if;
      select * into ex from public.marks where id = v_id;
      if not found then
        v_ts := (m ->> 'ts')::timestamptz;
        if v_ts is null or abs(extract(epoch from v_ts - now())) > 172800 then raise exception 'Horário inválido'; end if;
        insert into public.marks (id, event_id, timekeeper_id, ts, device_ts, clock_offset_ms, clock_rtt_ms,
                                  entry_id, leg_index, athlete_id, discarded, discarded_by)
        values (v_id, ev.id, tk.id, v_ts, (m ->> 'device_ts')::timestamptz, (m ->> 'clock_offset_ms')::int,
                (m ->> 'clock_rtt_ms')::int, v_entry_id, v_leg, nullif(m ->> 'athlete_id', '')::uuid,
                v_discarded, case when v_discarded then 'timekeeper' end);
      else
        if ex.timekeeper_id is distinct from tk.id then raise exception 'Marcação pertence a outro cronometrista'; end if;
        if ex.discarded_by = 'organizer' and not v_discarded then raise exception 'Descartada pela organização'; end if;
        update public.marks set entry_id = v_entry_id, leg_index = v_leg,
               athlete_id = nullif(m ->> 'athlete_id', '')::uuid, discarded = v_discarded,
               discarded_by = case when v_discarded then coalesce(ex.discarded_by, 'timekeeper') end
         where id = v_id;
      end if;
      accepted := accepted || to_jsonb(v_id::text);
    exception when others then
      rejected := rejected || jsonb_build_object('id', m ->> 'id', 'reason', sqlerrm);
    end;
  end loop;
  update public.timekeepers set last_seen_at = now() where id = tk.id;
  return jsonb_build_object(
    'accepted', accepted, 'rejected', rejected, 'server_now', now(), 'version', ev.version,
    'marks', coalesce((select jsonb_agg(to_jsonb(k) order by k.ts) from public.marks k
                       where k.event_id = ev.id and (p_since is null or k.updated_at >= p_since)), '[]'::jsonb),
    'waves', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'start_at', w.start_at))
                       from public.waves w join public.races r on r.id = w.race_id where r.event_id = ev.id), '[]'::jsonb));
end $$;
```

- [ ] **Step 1: Write failing `supabase/tests/40_timing.sql`**: setup (owner, event, relay race team 2 swim/run, athletes A (M) and B (F), team entry bib 101 with A leg 0, B leg 1, wave start set), then:
  - as anon: `tk_open('errado')` → P0001 like `Link de cronometragem%`; `tk_open(<token>)` returns 1 race, 1 entry whose members include `name`.
  - `tk_register(<token>, '  ', '')` → P0001; `tk_register(<token>, 'Ana', 'iPhone')` → returns id + 32-char secret (store both in ctx).
  - `tk_sync` with wrong secret → P0001 `Cronometrista não autorizado`.
  - `tk_sync` with two marks: one assigned (entry 101, leg 0, ts = start + 10 min) and one unassigned → `accepted` has 2 ids; `marks` returns both.
  - re-send the first mark with `leg_index` 1 → accepted and updated; re-send with a different `ts` → `ts` unchanged.
  - mark with `leg_index` 2 → rejected with reason `Perna inválida`; mark with `ts` 3 days away → rejected `Horário inválido`.
  - second timekeeper cannot modify the first one's mark (rejected `Marcação pertence a outro cronometrista`).
  - as owner: `admin_update_mark(<id>, '{"discarded":true}')` → `discarded_by='organizer'`; then timekeeper re-sends it with `discarded:false` → rejected `Descartada pela organização`.
  - `admin_update_timekeeper(<tk>, '{"active":false}')` then `tk_sync` → P0001 `Seu acesso foi desativado%`.
  - `admin_set_resolution(entry, 0, 'mark', <a mark of leg 1>, null, '')` → P0001; with a valid mark → row; `manual` without ts → P0001; `admin_clear_resolution` removes it.
  - `admin_live(event, null)` returns all marks, resolutions, waves; `admin_live(event, now() + interval '1 hour')` returns 0 marks but still all waves.
  - `admin_finalize_race(race, '[{"entry_id":"<id>","athlete_ids":["<A>","<B>"],"status":"finished","final_ms":1800000,"overall_pos":1,"data":{}}]')` → count 1, `races.finalized_at` set; `admin_unfinalize_race` clears both.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5: Commit** (`feat(db): timing RPCs for organizers and timekeeper links`).

---

