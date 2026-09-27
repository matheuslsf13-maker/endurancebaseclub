# EnduranceBaseClub — contexto do projeto para o Claude Code

App web para organizar o evento multiesporte **EnduranceBaseClub** (tipo triatlo: corrida, natação, ciclismo), do organizador Matheus (matheuslsf13@gmail.com, fala pt-BR). A organizadora master configura tudo sozinha: provas, pernas/modalidades, distâncias, ordem, categorias (sexo/idade/nível "Elite"/"Base"), individual ou equipe (dupla/trio com atleta por perna), pódios. Ajudantes cronometram por um **link** (`#/c/:token`) em horário de Brasília; no revezamento, a marcação que fecha a perna de um atleta inicia a do próximo. Com vários cronometristas, o tempo oficial é a **mediana** (ou a marcação escolhida, ou manual). Gera a **planilha de conferência (XLSX)**, resultados/pódios públicos e estatísticas por atleta.

**Estado atual e próximos passos: leia `docs/HANDOFF.md` antes de qualquer coisa.**

## Documentos de referência

- Spec (autoridade final, pt-BR): `docs/superpowers/specs/2026-09-24-endurance-base-club-design.md`
- Plano (29 tasks, ondas paralelas): `docs/superpowers/plans/2026-09-24-endurance-base-club.md`
- Ledger da execução SDD (estado de cada task, Rulings 1–16, minors adiados): `.superpowers/sdd/2026-09-24-endurance-base-club/progress.md`
- Contratos compartilhados (Global Constraints, Test IDs, `types.ts`, assinaturas de domínio e libs): `.superpowers/sdd/2026-09-24-endurance-base-club/contracts.md`
- Briefs e relatórios por task: `.superpowers/sdd/2026-09-24-endurance-base-club/task-N-brief.md` / `task-N-report.md`

## Stack

React 19 SPA (HashRouter, react-router 8), TanStack Query 5, Tailwind v4, TypeScript estrito, Vite 8, Vitest 5 (jsdom + Testing Library), fflate (XLSX próprio), qrcode, vite-plugin-pwa. Supabase **somente via RPC** (`supabase.rpc` em `src/lib/api.ts`; nunca `supabase.from`). Postgres: funções `security definer`, RLS ligado em todas as tabelas **sem policies**. Deploy: Vercel (frontend estático) + Supabase (projeto `wlishmznbhhcqzncdxnq`).

## Comandos

```bash
npm ci                      # dependências (Node 22)
npm run typecheck           # tsc --noEmit
npx vitest run              # testes unitários/componentes
npm run build               # build de produção (dist/)
npm run test:integration    # supabase-js contra o shim local (precisa do Postgres local)
bash scripts/test-sql.sh    # testes SQL (reseta o DB $EBC_DB, aplica bootstrap + migrations, roda supabase/tests/*.sql)
bash scripts/db-local.sh start|stop|reset|apply|psql|url
npm run shim                # shim local de Auth + PostgREST RPC na porta 54321
npm run dev:stack           # Postgres + shim + vite para desenvolvimento local
python3 scripts/verify-xlsx.py <arquivo.xlsx>   # valida uma planilha gerada (openpyxl)
```

Stack local de testes (emula Supabase): Postgres 16 em `127.0.0.1:54322` (cluster em `/var/tmp/ebc-pg`, iniciado via `runuser -u postgres`, exige root — ver HANDOFF §Ambiente), shim Node em `127.0.0.1:54321` com a chave `sb_publishable_local_dev`. Cada agente paralelo usa seu próprio banco: `EBC_DB=ebc_tN bash scripts/test-sql.sh`. Arquivos em `supabase/tests/` **não podem** ter meta-comandos do psql (`\set`, `\i`…): também rodam via MCP em produção.

## Regras globais (valem para todo código)

- Texto de UI em **português do Brasil**; código, identificadores, comentários e commits em inglês.
- Campos de DTO/JSON em **snake_case** espelhando as colunas (`src/lib/types.ts`); nada de cópias camelCase.
- Tempos armazenados em UTC; **toda hora exibida em `America/Sao_Paulo`** via `src/lib/format.ts`. Nunca `toLocaleTimeString()` sem `timeZone`.
- Índices de perna são 0-based internamente; a UI mostra "Perna 1..N".
- SQL: `security definer`, `set search_path = public, extensions, pg_temp`, parâmetros `p_`, erros de validação `raise exception '<mensagem pt-BR>' using errcode = 'P0001'`, permissão `42501`.
- Padrões de cronometragem: janela de mesma passagem 30 s, divergência 3 s, fonte `median`, marcação sem atleta vira pendência após 60 s, sync 2 s (backoff até 10 s), público 10 s, sobreposição de fetch 10 s.
- Marca: tinta `#191513`, papel `#F4F1EC`, neutros `#241F1C #2E2825 #3A332F #6F665E #A39D93 #D9D3C9`, sucesso `#3F8F5B`, alerta `#C8922E`, perigo `#C2413B`, info `#5B7C99`; só fontes do sistema; números tabulares em todo tempo. Logo em `public/logo.png`.
- Todo controle crítico para E2E tem o `data-testid` exato da seção "Test IDs" do plano/contracts.
- Propriedade de arquivos: cada task só cria/edita os arquivos do bloco **Files** do seu brief (arquivos compartilhados como `package.json`, `src/App.tsx`, `src/lib/types.ts`, `src/lib/api.ts` só quando listados).
- Commits convencionais (`feat:`, `fix:`, `test:`, `chore:`) terminando com as linhas de trailer:
  `Co-Authored-By: Claude <noreply@anthropic.com>` (ajuste ao modelo em uso) e, se desejar, um link de sessão.
- Nunca commitar a senha da conta owner (criada só no deploy, Task 29).

## Processo (skills em `.claude/skills/`)

A execução segue **subagent-driven-development** (SDD): um implementador novo por task (worktree + branch `task/N`), revisão de task (spec + qualidade) com os templates da skill, rodadas de correção retomando o implementador, re-revisão escopada, merge `--no-ff` em `feat/ebc-app`, linha no ledger. Tasks independentes rodam em paralelo (`/dispatching-parallel-agents`), cada uma na sua worktree. No fim: revisão ampla de toda a branch (modelo mais forte), deploy (Task 29) e `/finishing-a-development-branch` para levar `feat/ebc-app` a `main`.

- Nas skills, referências como `superpowers:test-driven-development` apontam para a skill de mesmo nome em `.claude/skills/`.
- Scripts da SDD: `.claude/skills/subagent-driven-development/scripts/{task-brief,review-package,sdd-workspace}`. Para pacotes de revisão sem o lockfile, use `bash .superpowers/sdd/2026-09-24-endurance-base-club/pkg.sh BASE HEAD` (a partir da raiz do repo).
- Outras skills instaladas: `agent-browser` (E2E da Task 28), `supabase` e `supabase-postgres-best-practices` (Tasks 6, 7 e 29), `deploy-to-vercel` e `vercel-cli-with-tokens` (Task 29), `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines` (telas da onda 2). `skills-lock.json` permite reinstalar com `npx skills experimental_install`.
- MCP do projeto (`.mcp.json`): `supabase` (projeto `wlishmznbhhcqzncdxnq`) e `vercel`; autentique com `/mcp` na primeira vez.

## Produção

- Supabase: URL `https://wlishmznbhhcqzncdxnq.supabase.co`, chave publicável `sb_publishable_Py0jUHGMNAjCM8C488RvZg_qviJupEk` (pública, já em `.env.production`). Postgres 17 em produção (local é 16). Banco de produção **ainda vazio** — as migrations só são aplicadas na Task 29.
- Vercel: time "Matheus Proj" (`team_5RKNbN1EiWlEpXuYzgVp3yy9`, slug `matheus-proj`); projeto planejado `endurance-base-club` (ainda não criado).
- Conta owner: `bootstrap_owner('matheuslsf13@gmail.com', <senha gerada>, 'Matheus')` na Task 29; primeiro login força troca de senha.
