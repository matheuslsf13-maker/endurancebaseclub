## Task 18: Events dashboard, event general tab, settings, help

**Files:**
- Modify (replace stubs): `src/features/events/EventsPage.tsx`, `src/features/events/EventGeneralTab.tsx`, `src/features/settings/SettingsPage.tsx`, `src/features/help/HelpPage.tsx`
- Create: `src/features/events/events.test.tsx`

**Interfaces:**
- Consumes: `api.admin.listEvents/saveEvent/deleteEvent/duplicateEvent/listOrganizers/createOrganizer/deleteOrganizer`, `useEventContext`, `useSession`, UI kit.

Behavior:
- `EventsPage`: cards (name, `formatDateBR`, location, status badge, provas/inscrições counts) sorted by date desc; "Novo evento" (`new-event`) opens a modal with name (`event-name`), date (`event-date`, `type=date`), location (`event-location`), levels (`event-levels`, comma-separated text → trimmed unique list; hint "Ex.: Elite, Base") → `saveEvent` → navigate to `/eventos/:id/provas`. Card menu: Duplicar (asks new name/date → `duplicateEvent` → navigate), Excluir (confirm danger → `deleteEvent`).
- `EventGeneralTab`: edit name/date/location/description/levels/status (select Planejado/Ao vivo/Encerrado); public section: checkbox `event-public` "Resultados públicos", slug input with preview link `…/#/p/<slug>` and copy button; save `event-save` → `saveEvent` → `refresh()`; danger zone delete.
- `SettingsPage`: "Minha conta" (name/email/role, change password form reusing `useSession().changePassword`); "Organizadores" list; owner sees "Adicionar organizador" (email, name, temporary password generator button producing 12 random chars) → `createOrganizer` → shows the credentials once with a copy button; remove (confirm) → `deleteOrganizer`.
- `HelpPage`: static pt-BR guide with sections: Antes do evento (criar evento → provas/pernas/ondas → atletas/importação → inscrições → testar o link do cronometrista no local; reativar o Supabase se ficou 7 dias parado), Durante (Largar agora; cronometristas tocam MARCAR e informam o nº; revezamento automático; acompanhar Revisão), Depois (resolver pendências, finalizar provas, exportar planilha, desativar link), Como o tempo oficial é escolhido (mediana, divergência, escolher marcação ou tempo manual — include the 10:00:05/10:00:06/10:00:19 example).

- [ ] **Step 1: Failing `events.test.tsx`** (mock `api`): creating an event calls `saveEvent` with `{name, date, location, levels: ['Elite','Base']}` from input `"Elite, Base, Elite"` and navigates to the provas tab; duplicate calls `duplicateEvent`; settings shows "Adicionar organizador" only for owners.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(events): events dashboard, general tab, settings and help`).

---

