# EnduranceBaseClub — App de organização de eventos e cronometragem

**Data:** 2026-09-24 · **Status:** aprovado (o usuário delegou a aprovação de spec e plano ao Claude após a rodada de perguntas)
**Repositório:** `/home/claude/endurance-base-club` · **Banco:** Supabase `wlishmznbhhcqzncdxnq` (us-east-1, PG 17) · **Hospedagem:** Vercel (time `team_5RKNbN1EiWlEpXuYzgVp3yy9`, conta `matheuslsf13-maker`)

---

## 1. Objetivo e critérios de sucesso

A organizadora master do EnduranceBaseClub (eventos multiesporte tipo triathlon) precisa **configurar sozinha** qualquer formato de evento, cadastrar atletas, **cronometrar sem erros** com vários ajudantes e fechar classificação e pódio corretos, com planilha de conferência.

Critérios de sucesso:
1. Criar um evento com provas de formatos diferentes (só corrida; triathlon individual; revezamento em dupla/trio com perna definida por integrante) **sem editar código**.
2. Ajudantes marcam tempos por um **link/QR code** no celular, em horário de Brasília, **funcionando offline**; marcações de vários cronometristas para a mesma passagem são consolidadas (mediana) e divergências aparecem para a master decidir.
3. No revezamento, a marcação do fim da perna de um integrante **inicia automaticamente** a perna do próximo (tempo parcial visível ao vivo).
4. Classificação, pódios por categoria (sexo / faixa etária / nível) e planilha XLSX de conferência são gerados automaticamente.
5. Atletas têm histórico e estatísticas (vitórias, pódios, recordes por modalidade/distância, ritmo).
6. Resultados ao vivo e perfis de atletas públicos (somente leitura, sem dados de contato).
7. Tudo validado por testes automatizados (unitários, SQL, integração, E2E com agent-browser) e publicado.

## 2. Decisões

**Respondidas pelo usuário**
- Banco: projeto Supabase já criado (`wlishmznbhhcqzncdxnq`).
- Hospedagem: Vercel (o usuário conectou o conector Vercel; deploy via conector).
- Login master: `matheuslsf13@gmail.com` (conta criada com senha provisória; troca obrigatória no 1º acesso).
- Público: resultados ao vivo + perfis de atletas públicos.
- Modalidades usuais: corrida, natação, ciclismo (outras continuam possíveis como "outro").
- Paleta da logo: preto quente `#191513` + off-white `#F4F1EC`.
- Mediana como "tempo do sistema" — confirmada, com alerta de divergência.

**Premissas (assumidas, documentadas para o usuário)**
- Inscrições feitas pela organização (manual, múltiplas de uma vez, importação CSV/XLSX). Sem inscrição online/pagamento.
- Cronometrista sem login: link com token do evento + nome digitado no aparelho.
- Fluxo "toca primeiro, identifica depois" (também aceita digitar o nº antes de tocar).
- Sem chip/hardware; sem app nativo (PWA web).

**Restrições do ambiente de desenvolvimento** (descobertas na exploração)
- O container de desenvolvimento **não acessa** `*.supabase.co` nem a API da Vercel diretamente; Docker registries também bloqueados. Acesso ao Supabase e à Vercel **só pelos conectores MCP**.
- Supabase Storage/Edge Functions não servem HTML (retornam `text/plain`) → frontend precisa de host estático (Vercel).
- PostgreSQL 16 está instalado localmente; PostgREST/GoTrue não estão disponíveis → testes locais usam **Postgres real + shim Node** que emula `/auth/v1` e `/rest/v1/rpc` (ver §15).
- Deploy na Vercel pelo conector: upload do **código-fonte** (texto) e build remoto na Vercel (`vite build`), porque subir o bundle pronto em base64 é caro e esbarra no limite por chamada.

## 3. Arquitetura

```
 Celulares (cronometristas)      Notebook/celular (master)        Público
   #/c/:token  (PWA offline)       #/eventos/...  (login)           #/p/:slug, #/atleta/:id
          │                               │                              │
          └──────────── HTTPS (supabase-js: auth + rpc) ─────────────────┘
                                          │
                        Supabase: Auth (e-mail/senha) + PostgREST (/rest/v1/rpc/*)
                                          │
                     Postgres: tabelas com RLS "nega tudo" + funções SECURITY DEFINER
                     (admin_* exigem organizador; tk_* exigem token; pub_* só eventos públicos)
```

- **SPA** estática: Vite + React 19 + TypeScript strict + Tailwind CSS v4 + React Router 7 (**HashRouter**, links portáveis `https://host/#/c/TOKEN`) + TanStack Query 5 + `@supabase/supabase-js` 2 + `vite-plugin-pwa` (service worker para o cronometrista abrir offline) + `fflate` (zip do XLSX) + `qrcode`.
- **API somente por RPC** (funções Postgres). Nenhuma tabela é acessível diretamente pelo cliente. Motivos: (1) toda validação e segurança num lugar só; (2) link de cronometrista baseado em token exige funções de qualquer forma; (3) testável localmente com o shim.
- **Motor de domínio em TypeScript puro** (`src/domain/`): consolidação de tempos, categorias, classificação, pódio, estatísticas, pendências, modelo da planilha. Usado por todas as telas (master, cronometrista, público) → mesma regra em todo lugar, testada por unit tests.
- **Banco guarda fatos brutos** (marcações imutáveis no instante, decisões da master); resultados são **derivados**. Ao finalizar uma prova, a master grava um **snapshot** (`results`) que alimenta as estatísticas dos atletas.
- **Atualização ao vivo por polling** (cronometrista 2 s, master 2 s nas telas ao vivo, público 10 s), com janela de sobreposição de 10 s e deduplicação por id. Mais robusto que websocket em 4G ruim.

## 4. Conceitos do domínio

| Conceito | Descrição |
|---|---|
| **Evento** | Um dia de competição (nome, data, local). Tem lista de **níveis** (ex.: Elite, Base), link de cronometragem (token), slug público. |
| **Prova** (race) | Formato dentro do evento. Tem **pernas** em ordem, **tamanho da equipe** (1 = individual, 2 = dupla, 3 = trio…), **largadas/ondas**, regras de categoria e pódio, parâmetros de cronometragem. |
| **Perna** (leg) | Segmento da prova: modalidade (`swim`, `bike`, `run`, `other`), rótulo e distância em metros. Índice 0-based; a interface mostra "Perna 1". |
| **Largada/onda** (wave) | Horário de largada. Toda prova tem ≥1 onda ("Largada geral"). Cada inscrição pertence a uma onda. |
| **Inscrição** (entry) | Participante da prova: um atleta (individual) ou uma equipe. Tem nº de peito (único no evento), nível, onda, status (`ok`, `dns`, `dnf`, `dsq`), penalidade (ms). |
| **Integrante** (entry_member) | Atleta na inscrição + lista das pernas que ele faz. Individual: faz todas. Equipe: cada perna tem exatamente 1 integrante; um integrante pode fazer várias pernas. |
| **Passagem** (crossing) | Fim da perna *k* de uma inscrição. A passagem da última perna é a **chegada**. O início da perna *k* é a passagem *k−1* (ou a largada da onda para k = 0) — é isso que faz o revezamento "começar sozinho". |
| **Marcação** (mark) | Toque de um cronometrista: instante oficial (relógio sincronizado) + (depois) inscrição e perna. Nunca é apagada; pode ser descartada. |
| **Resolução** | Decisão da master para uma passagem: usar sistema (mediana), uma marcação específica, ou tempo manual. |
| **Resultado finalizado** | Snapshot por inscrição gravado quando a master finaliza a prova. |

## 5. Banco de dados

Migrations em `supabase/migrations/` (aplicadas localmente e no Supabase pelo conector). Todas as tabelas em `public`, **RLS habilitado sem policies** (nega acesso direto), `revoke all` de `anon`/`authenticated`.

```sql
organizers(user_id uuid PK → auth.users on delete cascade, email text, name text,
           role text check in ('owner','admin') default 'admin',
           must_change_password bool default true, created_at)

athletes(id uuid PK default gen_random_uuid(), name text not null (trim ≠ ''),
         sex text not null check in ('M','F'), birth_date date null,
         email text, phone text, city text, team_club text, notes text default '',
         public_profile bool default true, created_at, updated_at)

events(id uuid PK, name text not null, date date not null, location text default '',
       description text default '', levels text[] default '{}',
       status text check in ('planejado','ao_vivo','encerrado') default 'planejado',
       is_public bool default false, public_slug text unique null,
       tk_token text unique not null (24 chars aleatórios base62), tk_enabled bool default true,
       version bigint default 1, created_at, updated_at)

races(id uuid PK, event_id → events on delete cascade, name text not null, position int default 0,
      team_size int check 1..10 default 1, legs jsonb not null, config jsonb not null,
      finalized_at timestamptz null, created_at, updated_at)

waves(id uuid PK, race_id → races on delete cascade, name text default 'Largada geral',
      position int default 0, start_at timestamptz null, created_at, updated_at)

entries(id uuid PK, event_id → events cascade, race_id → races cascade, wave_id → waves on delete set null,
        bib text not null, team_name text null, level text null,
        status text check in ('ok','dns','dnf','dsq') default 'ok', penalty_ms int default 0 (>=0),
        notes text default '', created_at, updated_at, unique(event_id, bib))

entry_members(entry_id → entries cascade, athlete_id → athletes on delete restrict,
              position int default 0, legs int[] not null, PK(entry_id, athlete_id))

timekeepers(id uuid PK, event_id → events cascade, name text not null, secret text not null,
            device_label text default '', active bool default true, created_at, last_seen_at)

marks(id uuid PK (gerado no aparelho), event_id → events cascade,
      timekeeper_id → timekeepers on delete set null (null = criada pela organização),
      ts timestamptz not null, device_ts timestamptz, clock_offset_ms int, clock_rtt_ms int,
      entry_id → entries on delete set null, leg_index int null, athlete_id → athletes on delete set null,
      discarded bool default false, discarded_by text check in ('timekeeper','organizer') null,
      created_at default now(), updated_at default now(),
      check (entry_id is null or leg_index is not null))
  index (event_id, updated_at), index (entry_id)

resolutions(entry_id → entries cascade, leg_index int, event_id → events cascade,
            mode text check in ('system','mark','manual'), mark_id → marks on delete cascade null,
            manual_ts timestamptz null, note text default '', decided_by uuid, updated_at,
            PK(entry_id, leg_index),
            check ((mode='mark') = (mark_id is not null)), check ((mode='manual') = (manual_ts is not null)))
  index (event_id, updated_at)

results(race_id → races cascade, entry_id → entries cascade, event_id → events cascade,
        athlete_ids uuid[] not null, status text, final_ms bigint null, overall_pos int null,
        data jsonb not null, finalized_at timestamptz default now(), PK(race_id, entry_id))
  index GIN (athlete_ids)
```

- `updated_at` mantido por trigger em todas as tabelas que o têm.
- `events.version` é incrementado (trigger) em qualquer mudança em `events`, `races`, `waves`, `entries`, `entry_members` e em `athletes` (para eventos onde o atleta está inscrito). Clientes recarregam os dados estruturais quando a versão muda.
- `legs` (jsonb): `[{ "modality": "swim"|"bike"|"run"|"other", "label": "Natação", "distance_m": 750 }]` (≥1 item; `distance_m` null permitido para `other`).
- `config` (jsonb) — `RaceConfig`, com defaults aplicados pelo servidor e pelo cliente:

```json
{
  "age_rule": "year_end",            // idade em 31/12 do ano do evento | "event_date"
  "team_age_rule": "sum",            // "sum" | "oldest" | "youngest"
  "age_groups": [{"label":"20-29","min":20,"max":29}],   // max null = sem limite
  "rankings": [{"id":"geral","name":"Geral","dims":["sex"],"size":3}],
  "cumulative": false,               // premiação cumulativa
  "same_crossing_window_s": 30,      // janela para considerar "a mesma passagem"
  "divergence_threshold_s": 3,       // acima disso => pendência de divergência
  "time_source": "median",           // "median" | "reference"
  "reference_timekeeper_id": null
}
```

Função interna de criação de usuário do Auth (usada pelo bootstrap e por `admin_create_organizer`): insere em `auth.users` (`instance_id` = zeros, `aud`/`role` = `authenticated`, `encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf'))`, `email_confirmed_at = now()`, `raw_app_meta_data = {"provider":"email","providers":["email"]}`, `raw_user_meta_data = {}`, e **todas as colunas de token em `''`**: `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, `email_change_token_current`, `phone_change`, `phone_change_token`, `reauthentication_token`) e em `auth.identities` (`provider='email'`, `provider_id = user_id::text`, `identity_data = {sub, email, email_verified:true}`; **não** inserir a coluna gerada `email`). Senha mínima 8 caracteres. E-mail normalizado em minúsculas; e-mail repetido → erro.

Colunas reais do Supabase (para a emulação local): `auth.users(instance_id uuid, id uuid not null, aud varchar, role varchar, email varchar, encrypted_password varchar, email_confirmed_at, invited_at, confirmation_token varchar, confirmation_sent_at, recovery_token varchar, recovery_sent_at, email_change_token_new varchar, email_change varchar, email_change_sent_at, last_sign_in_at, raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin bool, created_at, updated_at, phone text default null, phone_confirmed_at, phone_change text default '', phone_change_token varchar default '', phone_change_sent_at, confirmed_at (generated), email_change_token_current varchar default '', email_change_confirm_status smallint default 0, banned_until, reauthentication_token varchar default '', reauthentication_sent_at, is_sso_user bool not null default false, deleted_at, is_anonymous bool not null default false)`; `auth.identities(provider_id text not null, user_id uuid not null, identity_data jsonb not null, provider text not null, last_sign_in_at, created_at, updated_at, email text generated, id uuid default gen_random_uuid())`.

## 6. API (funções RPC)

Convenções: `public.<nome>`, `language plpgsql`, `security definer`, `set search_path = public, extensions, pg_temp`, parâmetros com prefixo `p_`, retorno `jsonb` (ou `void`/escalar), JSON em **snake_case** espelhando as colunas, timestamps em ISO 8601. Erros de validação: `raise exception '<mensagem em português>' using errcode = 'P0001'`; sem permissão: errcode `42501`. Grants: `revoke execute on all functions in schema public from public, anon, authenticated`; depois `grant` explícito por grupo.

**Utilitária** (anon + authenticated)
- `server_time() → bigint` — `clock_timestamp()` em epoch ms (para sincronizar relógios).

**Organização** (authenticated; toda função começa com `perform assert_organizer()`; `assert_owner()` onde indicado)
- `admin_me()` → `{user_id,email,name,role,must_change_password}`.
- `admin_password_changed()` → zera `must_change_password` do usuário atual.
- `admin_list_organizers()`; `admin_create_organizer(p_email,p_password,p_name)` (owner); `admin_delete_organizer(p_user_id)` (owner, não pode excluir a si mesmo; remove também o usuário do Auth).
- `admin_list_events()` → lista com contagens (provas, inscrições).
- `admin_get_event(p_event_id)` → agregado completo: `{event, races[], waves[], entries[] (com members[]), athletes[] (dos inscritos: id,name,sex,birth_date,team_club,city), timekeepers[], marks[], resolutions[], results[], version, server_now}`.
- `admin_save_event(p_event jsonb)` → cria (sem `id`) ou atualiza; na criação gera `tk_token` e `public_slug` (slug de nome+data, único) e **não** cria provas.
- `admin_delete_event(p_event_id)`; `admin_duplicate_event(p_event_id,p_name,p_date) → uuid` (copia provas e ondas sem horário; sem inscrições/marcações); `admin_rotate_tk_token(p_event_id) → text`.
- `admin_save_race(p_race jsonb)` → cria/atualiza prova + `waves[]` (upsert por id; ondas ausentes são removidas; se nenhuma, cria "Largada geral"). Valida: ≥1 perna, modalidades válidas, `team_size` 1..10, rankings com dims ⊆ {sex, age, level} e `size` 1..10, faixas etárias sem sobreposição. **Bloqueia** mudar a quantidade/ordem de pernas ou o `team_size` se já houver marcações não descartadas em inscrições da prova.
- `admin_delete_race(p_race_id)`.
- `admin_set_wave_start(p_wave_id, p_start_at)` → define/limpa a largada (o cliente envia o instante sincronizado do toque em "Largar agora").
- `admin_list_athletes()` → atletas + `participations`, `wins`, `podiums` (dos resultados finalizados).
- `admin_save_athlete(p)`, `admin_delete_athlete(id)` (erro amigável se tiver inscrições).
- `admin_import_athletes(p_event_id uuid null, p_rows jsonb)` → cada linha `{name, sex, birth_date?, email?, phone?, city?, team_club?, race_name?}`; deduplica por `lower(email)` quando há e-mail, senão por `lower(trim(name))` + `birth_date` (existente → atualiza campos não vazios; a pré-visualização no cliente também avisa possíveis duplicados ignorando acentos); se `p_event_id` e `race_name` casar (sem diferenciar maiúsculas, com trim) com uma prova **individual** do evento, cria a inscrição com o próximo nº livre (se o atleta ainda não estiver nela). Retorna `{inserted, updated, entries_created, errors:[{row, message}]}`.
- `admin_athlete_profile(p_athlete_id)` → `{athlete, results[]}` (results com dados do evento e da prova).
- `admin_save_entry(p_entry jsonb)` → `{id?, race_id, wave_id?, bib?, team_name?, level?, notes?, members:[{athlete_id, legs:int[]}]}`. Regras: nº vazio → próximo número livre do evento (máx numérico + 1, começando em 1); nº único no evento; `members` = exatamente `team_size` atletas distintos; individual → integrante recebe todas as pernas; equipe → cada perna 0..N−1 atribuída a exatamente um integrante; atleta não pode estar em duas inscrições da mesma prova; `level` ∈ `events.levels` (ou null); onda pertence à prova (default: primeira). Não permite trocar `race_id` se a inscrição tiver marcações.
- `admin_bulk_create_entries(p_race_id, p_athlete_ids uuid[])` → inscrições individuais com nºs sequenciais; ignora quem já está na prova.
- `admin_update_entry_status(p_entry_id, p_status, p_penalty_ms, p_notes)`; `admin_delete_entry(p_entry_id)` (marcações ficam sem atleta).
- `admin_live(p_event_id, p_since timestamptz null)` → `{server_now, version, marks[], resolutions[], waves[]}` alterados desde `p_since` (null = tudo).
- `admin_update_mark(p_mark_id, p_patch jsonb)` → campos `entry_id` (null = desatribuir), `leg_index`, `discarded` (bool). Valida inscrição do mesmo evento e perna existente. Descartar grava `discarded_by='organizer'`.
- `admin_set_resolution(p_entry_id, p_leg_index, p_mode, p_mark_id, p_manual_ts, p_note)`; `admin_clear_resolution(p_entry_id, p_leg_index)`.
- `admin_update_timekeeper(p_timekeeper_id, p_patch)` → `name`, `active`.
- `admin_finalize_race(p_race_id, p_rows jsonb)` → substitui os `results` da prova pelo snapshot calculado no cliente e grava `finalized_at`. `admin_unfinalize_race(p_race_id)` → apaga snapshot e limpa `finalized_at`.

**Cronometrista** (anon + authenticated; validam `events.tk_token = p_token and tk_enabled`, senão erro "Link de cronometragem inválido ou desativado")
- `tk_open(p_token)` → `{event:{id,name,date,location}, races[] (id,name,team_size,legs,config), waves[], entries[] (id,race_id,wave_id,bib,team_name,status, members:[{athlete_id,name,legs}]), timekeepers[] (id,name), version, server_now}`.
- `tk_register(p_token, p_name, p_device_label)` → `{timekeeper_id, secret}` (secret = 32 chars aleatórios).
- `tk_sync(p_token, p_timekeeper_id, p_secret, p_marks jsonb, p_since timestamptz null)` → exige cronometrista ativo do evento com o secret correto. Para cada marcação recebida `{id, ts, device_ts, clock_offset_ms, clock_rtt_ms, entry_id, leg_index, athlete_id, discarded}`: id novo → insere (dono = este cronometrista); id existente → só se for dele; `ts` é imutável; não pode "desdescartar" marcação descartada pela organização; valida inscrição/perna. Atualiza `last_seen_at`. Retorna `{accepted:[id], rejected:[{id,reason}], server_now, version, marks[] (todas do evento alteradas desde p_since), waves[] (id,start_at)}`.

**Público** (anon + authenticated; somente `is_public = true`; nunca retorna e-mail/telefone/data de nascimento)
- `pub_events()` → eventos públicos (id, slug, name, date, location, status).
- `pub_event(p_slug)` → como `tk_open` + `athletes[]` com `{id,name,sex,team_club,city,age_event,age_year_end,public_profile}` + `marks[]` (não descartadas) + `resolutions[]` + `results[]` + `levels`.
- `pub_live(p_slug, p_since)` → `{server_now, version, marks[], resolutions[], waves[]}`.
- `pub_athlete(p_athlete_id)` → só se `public_profile`; `{athlete:{id,name,sex,city,team_club}, results[]}` apenas de eventos públicos.

**Internas** (sem grant): `assert_organizer()`, `assert_owner()`, `random_token(n)`, `internal_create_auth_user(email,password) → uuid`, `bootstrap_owner(email,password,name)`, `bump_event_version(event_id)`, `slugify(text)`.

## 7. Cronometragem

### 7.1 Link e cadastro do cronometrista
A master copia o link `…/#/c/<tk_token>` ou mostra o **QR code** (aba Cronometragem). O ajudante abre, digita o nome uma vez (`tk_register`) e o aparelho guarda `{timekeeper_id, secret, name}` no `localStorage`. A master vê a lista de cronometristas (nome, última atividade, nº de marcações), pode desativar alguém e pode **rotacionar o token** (links antigos param).

### 7.2 Relógio sincronizado (horário de Brasília)
- Amostras estilo NTP: `t0 = Date.now()`, `srv = server_time()`, `t1 = Date.now()`; `rtt = t1 − t0`; `offset = srv − (t0 + t1)/2`.
- 5 amostras ao abrir (a cada 300 ms), depois 1 a cada 20 s e ao voltar para a aba. Mantém as 10 últimas; usa o **offset da amostra de menor RTT**; qualidade exibida = `±rtt_min/2`.
- `agoraOficial() = Date.now() + offset`. Offset salvo no `localStorage` (com data) para funcionar offline após recarregar; se nunca sincronizou, usa o relógio do aparelho e mostra alerta "relógio não sincronizado".
- Exibição sempre em `America/Sao_Paulo`, com décimos (`10:32:15.4`). Armazenamento em UTC.
- Cada marcação guarda `device_ts`, `clock_offset_ms` e `clock_rtt_ms` (auditoria).

### 7.3 Fluxo de marcação (tela do cronometrista, mobile-first)
1. **MARCAR** (botão enorme): grava o instante na hora (`agoraOficial()`), vibra 50 ms, cria a marcação com `id = crypto.randomUUID()` e salva no aparelho.
2. Se o campo "Nº" já tinha um nº válido → atribui imediatamente. Senão a marcação entra em **"Sem atleta"** (mais antiga primeiro) e fica selecionada.
3. Atribuir: digitar o nº + Enter, ou tocar na inscrição na lista **"Em prova"** (busca por nº/nome, filtro por prova, mostra quem está na perna atual e o cronômetro da perna).
4. A perna é **sugerida** (§7.5) e aplicada na hora; um aviso mostra "✓ Nº 101 · Matheus · fim da Corrida (2/2)" com **Desfazer** e **Trocar perna**.
5. "Minhas marcações": lista com estado (⏳ pendente / ✓ sincronizada / ⚠ rejeitada + motivo), descartar, reatribuir.
6. Extras: tema claro/escuro (claro recomendado ao sol), wake lock (tela sempre ligada), aviso de offline com contador de pendentes.

### 7.4 Offline e sincronização
- **Outbox** no `localStorage` (`ebc.tk.<eventId>.<timekeeperId>`): mapa id → `{mark, state:'pending'|'synced'|'rejected', reason?}`. Toda alteração local marca `pending`.
- Loop de sync a cada 2 s (backoff até 10 s em erro): envia até 200 pendentes em `tk_sync` e recebe `marks` de todos os cronometristas alteradas desde `last_server_now − 10 s` (sobreposição), mesclando por id (vence o `updated_at` maior).
- Dados estruturais (`tk_open`) em cache no aparelho; recarregados quando `version` muda.
- Service worker (vite-plugin-pwa, `autoUpdate`) pré-carrega o app → o link abre sem internet depois do primeiro acesso.

### 7.5 Sugestão de perna (`suggestLeg`)
Entrada: inscrição, prova, marcações conhecidas (sincronizadas + locais), instante `t` da nova marcação, atleta selecionado (opcional).
1. `candidatas` = pernas do atleta selecionado na inscrição (se houver) senão todas `0..N−1`.
2. Para cada perna com marcações conhecidas, `passagem_k` = mediana dos instantes delas.
3. Se existe perna candidata com `|t − passagem_k| ≤ same_crossing_window_s` → sugere essa perna (é outro cronometrista confirmando a mesma passagem).
4. Senão: `ultima` = maior índice k (entre **todas** as pernas) com `passagem_k < t − janela` (−1 se nenhuma); sugere a menor perna candidata `> ultima`; se não houver, a última candidata e marca aviso "atleta já concluiu".
Exemplos que devem virar teste: solo sem marcações → perna 0; segunda marcação 2 s depois → mesma perna; 30 min depois → perna seguinte; dupla (João perna 0, Matheus perna 1) selecionando Matheus → perna 1 mesmo sem a perna 0 marcada; dupla com João nas pernas 0 e 2 → primeira chegada de João = 0, segunda = 2.

### 7.6 Largadas
Aba Cronometragem → por prova/onda: **Largar agora** (confirmação) grava o instante sincronizado do toque; também é possível digitar/corrigir o horário (hh:mm:ss.d, Brasília) ou limpar. Largadas aparecem para os cronometristas via `tk_sync`.

## 8. Consolidação de tempos (motor)

Para cada inscrição e perna k (`crossing`):
1. `M` = marcações não descartadas com `entry_id` = inscrição e `leg_index = k`.
2. Por cronometrista, a **mais antiga** é candidata; as demais viram pendência "duplicada" (fora do cálculo). Marcações da organização (sem cronometrista) contam cada uma como candidata.
3. `median` = mediana dos instantes candidatos (par → média dos dois centrais, arredondada ao ms); `spread = max − min`.
4. **Tempo do sistema** = `time_source == 'reference'` e o cronometrista de referência tem candidata ? a dele : a mediana.
5. **Tempo oficial** = resolução `mark` → instante da marcação escolhida (se descartada: volta ao sistema + pendência); `manual` → `manual_ts`; `system` ou sem resolução → tempo do sistema. Sem candidatas e sem manual → sem passagem.
6. `divergent = candidatas ≥ 2 e spread > divergence_threshold_s` (pendência só se não houver resolução).

Por inscrição: `start` = `start_at` da onda da inscrição (ou 1ª onda da prova). `leg_ms[k] = oficial[k] − oficial[k−1]` (com `oficial[−1] = start`), null se faltar um dos lados. `total_ms = oficial[N−1] − start`; `final_ms = total_ms + penalty_ms`.
Status: `dns/dnf/dsq` se definido pela master; senão `not_started` (sem largada), `finished` (tem chegada e largada), `on_course`. `current_leg` (em prova) = maior k com passagem + 1 (0 se nenhuma); o atleta da perna atual e o cronômetro da perna saem daí → **revezamento automático**.

**Pendências** (tipo, severidade, mensagem em PT, referências):
`divergence` (aviso), `missing_crossing` (erro: existe passagem posterior sem a anterior), `order` (erro: passagem ≤ anterior/largada), `duplicate` (info), `no_start` (aviso: marcação em inscrição sem largada), `unassigned` (aviso: marcação sem atleta há >60 s), `chosen_mark_discarded` (aviso), `not_finished` (info: em prova — ao finalizar, sugerir DNF).

## 9. Categorias, classificação e pódio

- **Sexo da inscrição**: individual = sexo do atleta (`M`/`F`); equipe = `M` se todos M, `F` se todos F, senão `MISTO`. Rótulos: Masculino, Feminino, Misto.
- **Idade**: `year_end` → ano do evento − ano de nascimento; `event_date` → idade completa na data do evento. Equipe: `sum` / `oldest` / `youngest` das idades dos integrantes. Sem data de nascimento → sem idade → faixa "Sem faixa".
- **Faixa etária**: primeira faixa com `min ≤ idade ≤ max` (max null = sem limite).
- **Nível**: `entry.level` (ex.: Elite/Base) — só se o evento tiver níveis.
- **Classificação**: apenas `finished`, ordenados por `final_ms`; empate exato → mesma posição (1, 2, 2, 4); desempate de exibição pelo nº. Depois vêm em prova, DNF, DNS, DSQ. Calcula posição geral, posição por sexo e posição em cada ranking configurado.
- **Rankings** (`config.rankings`, em ordem): cada um agrupa por uma combinação de dimensões (`[]` = geral absoluto; `["sex"]`; `["sex","age"]`; `["level"]`; `["sex","level"]`…) com `size` lugares. Ordem dos grupos: sexo M, F, MISTO; faixas por `min`; níveis na ordem do evento; "Sem faixa" por último.
- **Pódio**: para cada ranking/grupo, os primeiros `size`. Se `cumulative = false`, quem já foi premiado num ranking anterior **não** entra nos seguintes e os próximos sobem.
- Defaults de prova nova — individual: `[{id:'geral',name:'Geral',dims:['sex'],size:3}, {id:'faixa',name:'Faixa etária',dims:['sex','age'],size:3}]`, faixas `até 19, 20-29, 30-39, 40-49, 50-59, 60+`, `cumulative:false`; equipe: `[{id:'geral',name:'Geral',dims:['sex'],size:3}]`, sem faixas.
- **Modelos de prova** (atalhos na criação): Corrida 5 km; Corrida 10 km; Natação 1.500 m; Ciclismo 20 km; Duathlon (5 km/20 km/2,5 km); Aquathlon (750 m/5 km); Triathlon Sprint (750 m/20 km/5 km); Triathlon Olímpico (1.500 m/40 km/10 km); Revezamento dupla natação+corrida (750 m/5 km, equipe 2); Revezamento trio triathlon (equipe 3); Personalizada.

## 10. Estatísticas do atleta (de resultados finalizados)

- Participações (status ≠ dns), conclusões, DNF, DSQ, DNS; taxa de conclusão.
- **Vitórias gerais** (posição geral 1); **vitórias em categoria** (1º em algum grupo de pódio); **pódios** (algum lugar ≤ 3 em pódio; conta 1 por prova); melhor posição geral; percentil médio ("Top X%" = média de posição/concluintes).
- **Recordes pessoais** por (modalidade, distância): melhor tempo de perna feita pelo atleta, com evento/data e ritmo.
- **Ritmo por modalidade** (tempo total ÷ distância total das pernas do atleta): corrida min/km, natação min/100 m, ciclismo km/h; `other` só tempo.
- Km totais em prova por modalidade; histórico completo (data desc); evolução do tempo na combinação modalidade+distância mais frequente (gráfico de linha simples em SVG); parceiros de equipe mais frequentes.

## 11. Planilha XLSX de conferência

Gerada no navegador (escritor XLSX próprio sobre `fflate`: workbook, estilos mínimos, inline strings, números, fórmulas com valor em cache, formatos de hora/duração, largura de colunas, linha de cabeçalho congelada). Nome: `EBC_<slug-do-evento>_<AAAA-MM-DD>.xlsx`. Abas:
1. **Resumo** — evento, data, local, gerada em (Brasília); por prova: inscritos, concluintes, em prova, DNF/DNS/DSQ, pendências, finalizada?
2. **Inscritos** — Nº, Prova, Onda, Equipe, Atleta(s) com perna(s), Sexo, Idade, Faixa, Nível, Status, Penalidade.
3. **Tempos – <Prova>** (uma por prova) — Nº, Atleta/Equipe, Largada (hora), para cada perna: Passagem (hora), Tempo da perna (**fórmula** = passagem − anterior), Fonte (Sistema/mediana, Cronometrista X, Manual); Total (fórmula), Penalidade, Final (fórmula), Divergência máx. (s), Status.
4. **Classificação – <Prova>** — Pos, Nº, Atleta/Equipe, Sexo, Faixa, Nível, Pos. sexo, Tempo final, Dif. p/ 1º, Status.
5. **Pódios** — prova → ranking → grupo → 1º/2º/3º… com nome e tempo.
6. **Marcações** — hora (hh:mm:ss.000 Brasília), cronometrista, Nº, atleta/equipe, prova, perna, situação (usada/descartada/duplicada/sem atleta), Δ para o oficial (s), id.
7. **Pendências** — tipo, severidade, descrição.
8. **Súmula manual** — lista de largada (Nº, nome, prova) com colunas em branco por perna, para backup em papel.
Horas: número serial Excel no fuso de Brasília, formato `hh:mm:ss.0`; durações formato `[h]:mm:ss.0`. Nomes de aba ≤ 31 caracteres e sem `[]:*?/\`.

## 12. Telas (HashRouter)

| Rota | Tela |
|---|---|
| `#/` | Logado: painel de eventos. Anônimo: eventos públicos + "Entrar (organização)". |
| `#/entrar` | Login e-mail/senha. Após login chama `admin_me`; sem permissão → mensagem + logout. `must_change_password` → força troca. |
| `#/eventos` | Lista/cria eventos, duplicar edição. |
| `#/eventos/:id/geral` | Dados do evento, níveis, público (slug + link), status, excluir. |
| `#/eventos/:id/provas` | Provas: modelos, pernas (modalidade/rótulo/distância m|km, reordenar), tamanho da equipe, ondas, idade/faixas, rankings/pódio, cumulativa, janela/limite de divergência, fonte do tempo. |
| `#/eventos/:id/inscricoes` | Tabela de inscrições (nº, prova, equipe/atleta, pernas, categoria calculada, onda, status/penalidade); criar individual/equipe (atribuir perna por integrante, criar atleta na hora); inscrever vários; importar planilha. |
| `#/eventos/:id/cronometragem` | Link + QR + cronometristas; largadas; painel ao vivo (em prova com cronômetro da perna, feed de marcações, sem atleta). |
| `#/eventos/:id/revisao` | Pendências e passagens: candidatas com Δ para mediana; escolher Sistema / marcação / Manual; descartar; mover marcação. |
| `#/eventos/:id/resultados` | Classificação, parciais, pódios; exportar XLSX; imprimir; finalizar/reabrir. |
| `#/atletas`, `#/atletas/:id` | Lista, cadastro, importação; perfil com estatísticas. |
| `#/config` | Organizadores (owner cria com senha provisória / remove); trocar senha. |
| `#/c/:token` | App do cronometrista. |
| `#/p/:slug` | Resultados públicos ao vivo/oficiais e pódios. |
| `#/atleta/:id` | Perfil público do atleta. |

Textos da interface em português do Brasil; números/datas `pt-BR`; horas sempre de Brasília.

## 13. Identidade visual

- Tokens: `--ink #191513`, `--paper #F4F1EC`, neutros `#241F1C`, `#2E2825`, `#3A332F`, `#6F665E`, `#A39D93`, `#D9D3C9`; status: sucesso `#3F8F5B`, aviso `#C8922E`, erro `#C2413B`, info `#5B7C99`.
- Tema escuro (ink de fundo, paper no texto) como padrão do painel; tema claro (paper de fundo) disponível em tudo e recomendado no cronometrista ao sol; alternância salva no aparelho.
- Tipografia: pilha do sistema (sem web fonts, para funcionar offline); títulos em caixa alta com espaçamento largo (ecoa a logo); **números tabulares** em todos os tempos.
- Logo do usuário (`public/logo.png`, a partir do JPEG enviado) no cabeçalho, favicon e manifest. Alvos de toque ≥ 44 px; botão MARCAR ≥ 35% da altura da tela.

## 14. Segurança e privacidade

- Acesso só por RPC; RLS nega tudo; funções com `search_path` fixo; grants explícitos.
- Organizador = linha em `organizers` (não basta estar autenticado). Contas criadas só por SQL/owner (sem cadastro público na interface).
- Token do link com 24 caracteres base62 (≈143 bits); secret por aparelho impede editar marcações de outros.
- Páginas públicas sem e-mail/telefone/nascimento; perfil público pode ser desligado por atleta.
- Chave publicável do Supabase no frontend (é pública por design). Nenhum segredo no repositório.

## 15. Testes e validação

1. **Unitários (Vitest)** — todo `src/domain/*` (consolidação, sugestão de perna, categorias, classificação, pódio cumulativo/não cumulativo, estatísticas, pendências, formatação de tempo, relógio, outbox, escritor/leitor XLSX, CSV).
2. **SQL** — `supabase/tests/*.sql` com asserts (`do $$ … assert … $$`), cada arquivo em `begin … rollback`. Rodam no Postgres local (`scripts/test-sql.sh`) e, no final, no Supabase real pelo conector (também dentro de transação revertida).
3. **Stack local** — `dev/db/bootstrap.sql` emula o Supabase (roles `anon`/`authenticated`/`service_role`, schemas `auth` e `extensions`, `pgcrypto` em `extensions`, `auth.users`/`auth.identities` com as colunas reais, `auth.uid()/role()/jwt()` lendo `request.jwt.claims`, default privileges iguais aos do Supabase). `dev/shim/server.mjs` (porta 54321) emula GoTrue (`/auth/v1/token?grant_type=password|refresh_token`, `/auth/v1/user` GET/PUT, `/auth/v1/logout`) com JWT HS256 e o PostgREST RPC (`POST /rest/v1/rpc/:fn` com parâmetros nomeados tipados pelo `pg_proc`, `set local role` + `request.jwt.claims`, erros no formato `{code,message,details,hint}`, CORS). Postgres local na porta 54322.
4. **Integração (Vitest, Node)** — `@supabase/supabase-js` real contra o shim: fluxo completo organizador → evento → prova → atletas → inscrições → cronometrista (open/register/sync) → live → resolução → finalizar → público.
5. **E2E (agent-browser da Vercel)** — app buildado (`vite build --mode e2e`, `vite preview`) + stack local; sessões separadas para master e 2 cronometristas; cenários: login e troca de senha; criar evento com prova individual e revezamento dupla; atletas e inscrições; link do cronometrista; largada; marcações com divergência; **revezamento inicia a 2ª perna**; offline e ressincronização; revisão escolhendo a marcação de um cronometrista; classificação/pódio; finalizar; exportar XLSX; página pública; perfil do atleta. Screenshots conferidos visualmente.
6. **Produção** — migrations e testes SQL pelo conector Supabase; `get_advisors` (segurança/performance) sem problemas críticos; deploy pelo conector Vercel; conferência via `web_fetch_vercel_url`; teste de fumaça no navegador do app Claude (login real, fluxo curto), conferindo o banco pelo conector; dados de teste removidos no fim.

## 16. Cálculos (precisão e capacidade)

- **Precisão do relógio**: RTT Brasil → us-east-1 ≈ 120–180 ms (+30–80 ms no 4G) ⇒ erro máx. da sincronização = RTT/2 ≈ 60–130 ms; com filtro de menor RTT em 10 amostras, tipicamente < 50 ms. Tempo de reação humano ≈ 200–300 ms (desvio ≈ 50 ms). Após sincronizar, diferenças entre cronometristas ficam em ~0,1–0,5 s ⇒ limite de divergência padrão de 3 s indica erro real (atleta errado ou toque atrasado).
- **Mediana vs média**: com marcações 10:00:05, 10:00:06, 10:00:19 → mediana 10:00:06, média 10:00:10. Com 2 marcações a mediana = média (por isso o alerta de divergência).
- **Carga**: 8 cronometristas × 0,5 req/s + master 0,5 req/s + 100 espectadores × 0,1 req/s ≈ 14,5 req/s de RPCs pequenas; evento de 3 h ≈ 160 mil requisições, ~2 KB cada ⇒ ~300 MB de tráfego (plano grátis do Supabase: 5 GB/mês).
- **Armazenamento**: 300 inscrições × 3 pernas × 4 cronometristas ≈ 3.600 marcações ≈ 1 MB/evento (limite grátis 500 MB).
- **Offline**: marcação ≈ 300 B no aparelho ⇒ `localStorage` (5 MB) comporta > 10 mil marcações.

## 17. Deploy e operação

- **Banco**: migrations aplicadas pelo conector Supabase; `bootstrap_owner('matheuslsf13@gmail.com', <senha provisória forte>, 'Matheus')`.
- **Frontend**: projeto Vercel `endurance-base-club` (framework Vite, `installCommand: npm install`, `buildCommand: vite build`, `outputDirectory: dist`), variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` (publishable) embutidas em `.env.production` (valores públicos). Deploy por `create_deployment` enviando os arquivos-fonte (sem testes/docs), alvo production.
- **Operação**: projetos grátis do Supabase pausam após ~7 dias sem uso ⇒ checklist pré-evento: abrir o painel do Supabase 1 dia antes e reativar se necessário; testar o link do cronometrista no local da prova; exportar a planilha ao final.

## 18. Fora do escopo

Pagamentos, inscrição online, login de atletas, e-mails/notificações, chip/hardware de cronometragem, GPS, multi-organização, app nativo, recuperação de senha por e-mail (a owner redefine pelo app/painel do Supabase).
