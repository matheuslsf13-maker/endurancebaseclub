# Task 22 — task review (opus), diff 2b0471a..e0882f9 — verdict: Needs fixes
(saved by the controller from the reviewer's message; core verified: synchronous ts at the tap, outbox before assignment, single-flight, cadence/backoff/since/≤200, version-checked accepted acks, Rulings 2/8/10/21/22/27/28/34, wake lock, phases)

## Spec ❌ / Important 1 — one unidentified mark takes over every later identification
TimekeeperPage.tsx:200-206, 297, 321, 334. Spec §7.3.2: MARCAR without a bib → the NEW mark enters "Sem atleta" and "fica selecionada". The implementation auto-selects the OLDEST unassigned mark of the whole list; a new mark is selected only when nothing is selected. Trace: stale mark S (2 min old) → A1 arrives, MARCAR (not selected) → type 101 + Atribuir → 101 gets S's time; A2 → 102 gets A1's crossing … every later identification off by one until "Sem atleta" empties. "Em prova" arrival taps (line 334) likewise assign the stale mark instead of marking now.
Fix: FIFO only within a burst — auto mode and the bib-submit fallback consider only unassigned marks younger than the 60 s unassigned-issue threshold; older marks must be selected explicitly; MARCAR without bib selects the new mark when the current auto-selection is older than that. Test: a 2-min-old mark, then MARCAR, then 101 + bib-submit → the NEW mark gets en1; the 4-tap burst test still passes.

## Minors (those promoted by Ruling 44 are marked ★)
★1. "Em prova" rows move under the finger (tkStore.ts:219-224, TimekeeperPage.tsx:601-603): pinned rows are inserted at the top by every crossing (sync every 2 s) and move when windows close; arrival taps fire on click → a shift during the press drops the tap or hits the neighbour row; arrival ts ~0.1 s later than MARCAR (pointerup). Fix: capture entry + timestamp on pointerdown, commit on pointerup if the finger barely moved (or freeze list order while a pointer is down).
★2. Stale pointerMarked flag (TimekeeperPage.tsx:303-312): only click resets it; a pointerdown without click (slide-off, long-press) leaves it true → the next click with detail>0 and no pointerdown (VoiceOver/TalkBack activation) is swallowed → mark lost. Fix: store pointerdown timeStamp, ignore only clicks within ~1 s. Space untested; holding Enter auto-repeats marks.
★3. Rejected acks not version-checked (outbox.ts:106-111): v1 rejected while v2 edited in flight → v2 marked ⚠ and never sent. Guard in applySyncResult: apply rejections only where sent_at_version === mark.local_updated_at.
★4. (→ Ruling 45) Outbox + single-flight per instance: two tabs of the same link overwrite each other's unsynced marks in storage.
★5. Storage failures silent (storage.ts:44-47): after a quota error the outbox falls back to memory with no UI signal; reload loses unsynced marks → show a header warning when persistence fails (pruning deferred).
★6. loadError shown only in `loading` (TimekeeperPage.tsx:102); the `invalid` screen doesn't say local marks are kept.
★7. A rejected new mark whose entry is gone is stuck: mergedMarks leaves it out of "Sem atleta" (tkStore.ts:43-46) and "Reatribuir" requires entry (TimekeeperPage.tsx:661) → offer Reatribuir/unassign on any rejected mark.
★8. Pinned rows invite a timekeeper to confirm their own crossing → self-duplicate issue → show "✓ marcada por você" when this device's mark is among that crossing's marks.
9. Perf: onCourse rebuilds sessionIndex + computeEntryTiming every second; MainScreen re-renders "Minhas marcações" every second; markSent rewrites the outbox every 2 s even for empty batches. (deferred)
★10. Keyboard closes after each MARCAR (focus leaves bib-input) → preventDefault on pointerdown keeps focus; click still fires.
11. Nested role=alert inside the kit's role=status toast item. (deferred)
12. Test gaps: edited-in-flight stays pending at screen level; rejection after in-flight edit; stale unassigned mark + MARCAR; Space key.
