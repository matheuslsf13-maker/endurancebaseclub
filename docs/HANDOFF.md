# Handoff: EnduranceBaseClub (Cowork → Claude Code)

**Gerado em:** 25/09/2026.

**Branch de trabalho:** `feat/ebc-app`. `main` só tem a spec e o plano. Leia também o `CLAUDE.md` na raiz.

---

## 1. Resumo

O plano tem 29 tasks. A situação de cada uma está na tabela abaixo; o detalhe completo fica na §4.

| Situação | Tasks |
|---|---|
| Integradas em `feat/ebc-app` | 1 (scaffold), 2 (stack local), 3 (schema), 9 (domínio base), 13 (relógio/outbox), 14 (XLSX/CSV) |
| Revisada e aprovada, falta merge | 16 (kit de UI), 11 (classificação/pódios) |
| Correção aplicada, falta a re-revisão | 10 (mediana e sugestão de perna) |
| Implementadas, falta a revisão | 5 (atletas/inscrições no banco), 12 (estatísticas) |
| Precisa de uma rodada de correção | 4 (RPCs de eventos/provas), pelos Rulings 12, 14 e 16 |
| Parciais (commit WIP), testes verdes | 15 (planilha de conferência), 17 (app shell) |
| Não iniciadas | 6, 7, 8 (banco); 18–27 (telas); 28 (E2E); 29 (produção) |

**Produção:**
- O Supabase (`wlishmznbhhcqzncdxnq`) está conectado e com o banco vazio. As migrations só são aplicadas na Task 29.
- A Vercel (time "Matheus Proj") está conectada. O projeto ainda não foi criado.

**Por que parou:** o limite de uso da conta interrompeu os agentes das Tasks 15 e 17 no meio do trabalho. O Matheus pediu para parar tudo e continuar no Claude Code.

---

## 2. Como abrir no Claude Code

### Opção A (recomendada no Windows): WSL2 Ubuntu 24.04, como root

Este é o mesmo ambiente em que tudo foi construído e testado: Ubuntu 24.04 como root, com PostgreSQL 16 do apt. Os scripts `scripts/db-local.sh` e `scripts/test-sql.sh` usam `runuser -u postgres` e `/usr/lib/postgresql/16/bin`, e por isso precisam de root.

No **PowerShell** (uma vez):

```powershell
wsl --install -d Ubuntu-24.04
wsl -d Ubuntu-24.04 -u root
```

Dentro do Ubuntu, já como root:

```bash
apt update && apt install -y git curl unzip build-essential python3 python3-openpyxl postgresql-16 postgresql-client-16
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm install -g @anthropic-ai/claude-code agent-browser@0.27
agent-browser install --with-deps          # baixa o Chrome usado nos testes E2E

# o zip baixado do chat (ajuste o usuário do Windows)
cp "/mnt/c/Users/<SEU_USUARIO>/Downloads/endurance-base-club-handoff.zip" /root/
cd /root && unzip -q endurance-base-club-handoff.zip && cd endurance-base-club
npm ci
bash scripts/db-local.sh start && bash scripts/test-sql.sh   # deve imprimir PASS para os arquivos SQL
npx vitest run && npm run typecheck                          # deve ficar verde
claude                                                       # abre o Claude Code na pasta do projeto
```

- Na primeira abertura, aprove os servidores MCP do projeto (`supabase`, `vercel`) e rode `/mcp` para autenticar os dois no navegador.
- Se preferir usar um usuário comum no WSL, a primeira tarefa do Claude Code é adaptar `scripts/db-local.sh` para esse caso. Três pontos:
  - `as_pg` deve usar `sudo -u postgres` quando não for root.
  - O `chown` de `/var/tmp/ebc-pg` só deve rodar como root.
  - O teste `-s "$PGDATA/PG_VERSION"` deve rodar como postgres, porque o diretório tem modo 0700.
  - Também é preciso uma regra de sudo sem senha para o usuário postgres. Valide com `bash scripts/test-sql.sh`.
- **Atenção:** já existe uma pasta `endurancebaseclub` no seu usuário do Windows com outro projeto dentro (`.git`, `src`, `supabase`). Ela não foi tocada. Extraia este pacote em outro lugar, por exemplo `/root/endurance-base-club` no WSL.

### Opção B: Claude Code na web (repositório no GitHub)

1. Crie um repositório **privado** no GitHub e, dentro da pasta extraída, rode `git remote add origin <url> && git push -u origin --all`. Isso envia todas as branches: `feat/ebc-app`, `task/*` e `main`.
2. Em claude.ai/code, escolha o repositório e a branch `feat/ebc-app`.
3. No script de setup do ambiente, coloque: `apt-get update && apt-get install -y postgresql-16 postgresql-client-16 python3-openpyxl && npm ci && npm i -g agent-browser@0.27 && agent-browser install --with-deps`.

### Windows nativo, sem WSL

Serve só para as tasks de front (vitest, build). O banco local, os testes SQL e de integração e o E2E dependem de Linux.

---

## 3. Prompt para colar no Claude Code

```
Você é o controlador da execução do projeto EnduranceBaseClub. Leia CLAUDE.md, docs/HANDOFF.md (inteiro) e o ledger .superpowers/sdd/2026-09-24-endurance-base-club/progress.md. Continue a execução do plano docs/superpowers/plans/2026-09-24-endurance-base-club.md com a skill /subagent-driven-development, trabalhando em paralelo sempre que possível (/dispatching-parallel-agents, uma worktree e uma branch task/N por task), começando pela seção 5 do HANDOFF ("Próximas ações"), na ordem. Não me pergunte nada: quando precisar decidir, registre um Ruling no ledger e siga. Use os templates da skill para implementadores e revisores, TDD, revisão por task, re-revisão escopada e merge --no-ff em feat/ebc-app. No fim: revisão ampla da branch inteira, E2E com agent-browser, deploy de produção (Task 29: Supabase + Vercel via MCP ou CLI), finishing-a-development-branch para main, e me entregue a URL, o login matheuslsf13@gmail.com com a senha temporária e a lista de Rulings que você tomou. Entregue pronto, validado e testado.
```

---

## 4. Estado por task

As referências de commit são das branches locais incluídas no pacote. "Base" é o commit a partir do qual a task foi feita, e é o BASE do pacote de revisão.

| # | Task | Branch · commit | Estado | Próximo passo |
|---|---|---|---|---|
| 1 | Scaffold, contratos, format, storage | integrada | ✅ | — |
| 2 | Emulação local do Supabase (Postgres + shim) | integrada (8832b17) | ✅ | — |
| 3 | Schema + funções internas | integrada (4df3f5f) | ✅ | — |
| 4 | RPCs admin: organizadores, eventos, provas, ondas | `task/4` · b9cb55e (base 11c9660) | ❌ Precisa de correção | Rodada de correção 1 com **novo** implementador: Ruling 12 (+ `waves` JSON null = ausente), Ruling 14 e Ruling 16; minors opcionais. Revisão completa em `task-4-review.md`. Depois, re-revisão escopada e merge. |
| 5 | RPCs admin: atletas, importação, perfil, inscrições | `task/5` · d415c39 (base b9cb55e = task/4) | Implementada; SQL 4/4 PASS | Revisão (pacote pronto: `review-b9cb55e..d415c39.diff`). Depois do merge da T4: `git merge feat/ebc-app` em task/5, rodar `EBC_DB=ebc_t5 bash scripts/test-sql.sh`, merge. |
| 6 | RPCs de cronometragem + link do cronometrista | — | Não iniciada | Depois da T5 (brief `task-6-brief.md` traz o `tk_sync` completo). |
| 7 | RPCs públicas + grants + testes de segurança | — | Não iniciada | Depois da T6, **com o Ruling 15**. |
| 8 | Teste de integração (supabase-js + shim) | — | Não iniciada | Depois da T7. |
| 9 | Domínio: presets, categorias, índice, nº de peito | integrada | ✅ | — |
| 10 | Consolidação por mediana + sugestão de perna | `task/10` · bc8513e (base f7c9c74) | Aprovada; correção pelos Rulings 8/10/11 aplicada (93 testes) | Re-revisão escopada da correção (pacote pronto: `review-fb6c7d7..bc8513e.diff`), depois merge. |
| 11 | Classificação, pódios, snapshot | `task/11` · b8eb0df (base fb6c7d7) | ✅ Aprovada (`task-11-review.md`) | Merge **depois** da T10. |
| 12 | Estatísticas de atleta | `task/12` · 3741efa (base 4df3f5f) | Implementada; 67 testes | Revisão (pacote pronto: `review-4df3f5f..3741efa.diff`), depois merge. |
| 13 | Relógio sincronizado + outbox offline | integrada | ✅ | — |
| 14 | XLSX writer/reader, CSV, mapeamento de importação | integrada | ✅ | — |
| 15 | Modelo da planilha de conferência + labels | `task/15` · 198d6e8 **WIP** (base 61ead91 = feat + task/11) | Parcial; 13 testes verdes, typecheck ok | Implementador conclui a partir do WIP: auto-revisão contra o brief, `verify-xlsx`, suíte completa, relatório `task-15-report.md`. Revisão com BASE 61ead91; merge depois da T11. |
| 16 | Kit de UI, layout, tema | `task/16` · 8e8b7c4 (base 495ab7b) | ✅ Re-revisão da 2ª correção limpa | Merge. |
| 17 | App shell: api, sessão, rotas, EventContext | `task/17` · 3311334 **WIP** (base 7e293bd = feat + task/11 + task/16) | Parcial; 236 testes verdes, typecheck ok | Implementador (modelo forte) conclui: apagar `src/zz-tmp-verify-*.test.tsx`, `npm run build`, conferir Ruling 7 no `src/test/setup.ts`, auto-revisão, relatório `task-17-report.md`. Revisão com BASE 7e293bd; merge depois das T11 e T16. |
| 18 | Eventos, aba Geral, configurações, ajuda | — | Não iniciada | Onda 2a, depois da T17. |
| 19 | Editor de provas (pernas, ondas, categorias, pódio) | — | Não iniciada | Onda 2a. O horário de largada é só leitura no editor, e o servidor nunca o altera por `admin_save_race` (Rulings 12 e 16). |
| 20 | Atletas: lista, formulário, importação, perfil + StatsView | — | Não iniciada | Onda 2a (precisa da T12). |
| 21 | Inscrições individuais/equipe com perna por atleta | — | Não iniciada | Onda 2b (precisa da T20). |
| 22 | App do cronometrista `#/c/:token` (tela crítica) | — | Não iniciada | Onda 2a, com os Rulings 2, 8 e 10. |
| 23 | Aba Cronometragem: link/QR, largadas, painel ao vivo | — | Não iniciada | Onda 2a, com os Rulings 2 e 10. |
| 24 | Aba Revisão: pendências e decisão de passagens | — | Não iniciada | Onda 2a, com os Rulings 2 e 11. |
| 25 | Resultados: classificação, pódios, finalizar, XLSX, imprimir | — | Não iniciada | Onda 2a (precisa da T15). |
| 26 | Páginas públicas | — | Não iniciada | Onda 2b, com o Ruling 4. |
| 27 | PWA offline do cronometrista | — | Não iniciada | Onda 2b. |
| 28 | E2E com agent-browser | — | Não iniciada | Onda 3. No brief, `AGENT_BROWSER_EXECUTABLE_PATH` aponta para o Chromium deste ambiente antigo: só exporte se o arquivo existir; senão use o Chrome do `agent-browser install`. |
| 29 | Produção: migrations, owner, deploy, smoke test | — | Não iniciada | Onda 4 (ver §10). |

---

## 5. Próximas ações do controlador, em ordem

**0. Ambiente.** Faça a §2. Depois recrie as worktrees e suba o Postgres local:

```bash
mkdir -p ../ebc-wt
for n in 4 5 10 11 12 15 16 17; do git worktree add ../ebc-wt/t$n task/$n && ln -s "$PWD/node_modules" ../ebc-wt/t$n/node_modules; done
bash scripts/db-local.sh start
```

Mapa de caminhos: nos briefs, relatórios e no ledger, `/home/claude/endurance-base-club` é a raiz do repositório e `/home/claude/ebc-wt/tN` é `../ebc-wt/tN`.

**1. Merge da `task/16`** em `feat/ebc-app`. A revisão está limpa. Use `git merge --no-ff task/16 -m "merge: task 16"`.

**2. Task 10.** Faça a re-revisão escopada com o template `re-review-prompt.md` da skill SDD. Os achados a verificar são os Rulings 8, 10 e 11, descritos no ledger e no relatório `task-10-report.md`, seção final. O pacote é `review-fb6c7d7..bc8513e.diff`. Com o resultado limpo:
   - Faça o merge de `task/10` e depois de `task/11`.
   - Rode `npx vitest run && npm run typecheck` em `feat/ebc-app`.

**3. Task 4, rodada de correção 1.** O agente original não pode ser retomado, então despache um **novo** implementador na worktree `t4`. Passe a ele:
   - os achados de `task-4-review.md`;
   - o Ruling 12, incluindo o caso de `waves` como JSON null;
   - o Ruling 14;
   - o Ruling 16 (adendo no fim de `task-4-review.md`).

   A correção deve reescrever o teste `20_admin_events.sql:84-93` para exigir que a onda e o `start_at` sobrevivam, e incluir um teste novo para o Ruling 16. Os minors (NULL bypass) são baratos e podem entrar junto. Depois: `EBC_DB=ebc_t4 bash scripts/test-sql.sh`, re-revisão escopada e merge.

**4. Tasks 5 e 12.** Faça a revisão com o template `task-reviewer-prompt.md`, usando os pacotes prontos. Aplique as correções, se houver.
   - A T12 pode ir direto para merge.
   - A T5 só entra depois da T4. Em `task/5`, rode `git merge feat/ebc-app`, depois o SQL, depois o merge.

**5. Tasks 15 e 17.** Primeiro, em cada worktree, rode `git merge feat/ebc-app` para trazer as versões finais das T10, T11 e T16. Depois despache implementadores para concluir a partir do WIP: a T17 com o modelo mais forte e a T15 com o padrão. Siga revisão, correções e merge.

**6. Trilha do banco.**
   - T6, a partir de `feat/ebc-app` depois da T5.
   - T7, com o **Ruling 15**.
   - T8.

**7. Onda 2a**, em paralelo e em worktrees a partir de `feat/ebc-app` já com a T17, a T12 e a T15: T18, T19, T20, T22, T23, T24 e T25. Inclua nos prompts os Rulings que se aplicam a cada task (ver §6).

**8. Onda 2b:** T21, T26 e T27.

**9. T28, E2E.** Rode `bash tests/e2e/run.sh` e revise as capturas de tela em 390×844 e 1280×800. A rodada final verde é: `npm run typecheck && npx vitest run && npm run test:integration && bash scripts/test-sql.sh && bash tests/e2e/run.sh`.

**10. Revisão final.** Faça uma revisão ampla da branch inteira com o modelo mais forte. Inclua os minors adiados (§7) e corrija o que for Critical ou Important.

**11. T29, produção.** Ver §10.

**12. `/finishing-a-development-branch`.**
   - Antes de ir para `main`, remova `.superpowers/` do índice com `git rm -r --cached .superpowers`; ele foi versionado só para este handoff.
   - Mantenha `docs/` e `CLAUDE.md`.
   - Entregue ao Matheus a URL, o login, a senha temporária, a lista de Rulings e o checklist pré-evento.

---

## 6. Rulings que valem daqui para frente

A lista completa, com justificativa e custo se estiver errado, está no ledger (`progress.md`).

- **R2:** `planBibAssignment` em `src/domain/suggestLeg.ts` é o helper único de "nº digitado → inscrição → perna sugerida". As T22, T23 e T24 usam esse helper e não fazem cópias próprias.
- **R4:** as marcações públicas não trazem `device_ts`, `clock_offset_ms` e `clock_rtt_ms`. Telas públicas não dependem desses campos.
- **R7:** `afterEach(cleanup)` fica em `src/test/setup.ts`. Já está no WIP da T17; confirme.
- **R8:** a frase certa é "fim da perna k/N (Rótulo)", nunca "fim da <Rótulo>".
  - Aviso da T10: `Nº 101 já concluiu — registrada como fim da perna 2/2 (Corrida)`.
  - Mensagem da T22 (`assignmentMessage`): `✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)`.
- **R9:** inscrição com passagem de chegada mas sem largada tem status `finished` com tempo nulo. Fica sem colocação e aparece primeiro entre as sem colocação.
- **R10:** o passo `same_crossing` de `suggestLeg` considera **todas** as pernas; só o passo "próxima" se restringe às pernas do atleta escolhido. As T22 e T23 **não** passam `athleteId` a partir da linha "Em prova".
- **R11:** uma pendência de divergência sempre traz pelo menos um `mark_id`. Se nenhuma marcação passar do limite, vai a mais distante da mediana.
- **R12:** em `admin_save_race`, a ausência da chave `waves` num UPDATE mantém as ondas. Um array presente faz upsert por id e apaga as ondas que faltam. Zero ondas geram a "Largada geral".
- **R13:** T15 e T17 nasceram de branches de integração: `feat` + `task/11`, e `feat` + `task/11` + `task/16`.
- **R14:** em `admin_save_race`, num UPDATE o `config` final é `default_race_config(novo team_size) || config existente || config do payload`.
- **R16:** `admin_save_race` nunca altera o `start_at` de uma onda existente. O `on conflict do update` mexe só em `race_id`, `name` e `position`. Ondas novas nascem sem largada, e o horário de largada só muda via `admin_set_wave_start`. Assim um editor de prova com dados velhos não apaga uma largada registrada.
- **R15:** a migration de grants da T7 começa com `revoke execute on all functions in schema public from public, anon, authenticated`, mais os default privileges. Só depois concede `admin_*` a `authenticated` e `tk_*`/`pub_*` a `anon` e `authenticated`. O `60_security.sql` prova que `entry_json`, `bootstrap_owner` e `internal_create_auth_user` não são chamáveis.

---

## 7. Minors adiados para a revisão final

Todos estão no ledger (`grep -n "minor (deferred)" .superpowers/sdd/*/progress.md`):

- **T1:** boilerplate do `npm init` no `package.json`; mapa de fallback do `storage.ts` em escopo de módulo.
- **T2:** o shim guarda em cache assinaturas de função não encontradas, ignora chaves desconhecidas do body e trata JSON inválido como `{}`; o `shim.test` fixa banco e porta.
- **T3:** apagar provas em cascata incrementa `events.version` menos vezes; o parâmetro de `slugify` não tem prefixo `p_` (mandado pelo plano).
- **T4:** NULL bypass em `validate_race_config`; corrida (TOCTOU) no `public_slug`.
- **T9:** `entryCategory` ignora membros ausentes; o teste de `indexEvent` cobre uma inscrição por prova.
- **T10:** o texto "descartada" também aparece para marcações movidas; a ordem é checada só contra a perna anterior.
- **T11:** faltam teste de snapshot multi-perna, teste de pódio com `dims: []` e teste de desempate numérico do nº de peito.
- **T13:** a sanitização do outbox só olha um nível; a sincronização precisa ser single-flight (atenção na T22).
- **T14:** um erro por linha de importação; booleanos voltam como `'1'`/`'0'`; o teste em Python deixa arquivos temporários.
- **T16:** o QrCode não tem placeholder; LineChart com `role=img` + `tabIndex`; o Field mostra erro OU dica; o botão sm tem a mesma altura do md; alt text do logo; o LineChart pinta primeiro com 640 px.

---

## 8. O que tem no pacote

- `.git` completo com todas as branches: `main`, `feat/ebc-app`, `task/2` … `task/17`.
- `CLAUDE.md`: contexto do projeto para o Claude Code.
- `docs/HANDOFF.md` (este arquivo), `docs/superpowers/specs/…` (spec) e `docs/superpowers/plans/…` (plano).
- `.superpowers/sdd/2026-09-24-endurance-base-club/`, com:
  - o ledger (`progress.md`) e os contratos (`contracts.md`);
  - os 29 briefs, os relatórios dos implementadores e as revisões salvas (`task-4-review.md`, `task-11-review.md`);
  - os pacotes de revisão pendentes (`review-*.diff`) e o `pkg.sh`.
- `.claude/skills/`: as skills instaladas no nível do projeto (§9).
- `.claude/settings.json`: comandos pré-aprovados (git, npm, vitest, scripts) para rodar sem prompts.
- `.mcp.json`: servidores MCP `supabase` (projeto `wlishmznbhhcqzncdxnq`) e `vercel`.
- `skills-lock.json`: origem e hash das skills externas. Reinstale com `npx skills experimental_install`.
- Não vai no pacote: `node_modules` (restaure com `npm ci`), `dist` e o cluster Postgres local (recriado por `bash scripts/db-local.sh start`).

---

## 9. Skills instaladas no projeto (`.claude/skills/`)

O Claude Code carrega estas skills automaticamente nesta pasta. O comando é `/nome-da-pasta`.

| Uso | Skills |
|---|---|
| Processo (as mesmas usadas aqui) | `using-superpowers`, `brainstorming`, `writing-plans`, `subagent-driven-development` (com scripts e templates de prompt), `dispatching-parallel-agents`, `using-git-worktrees`, `test-driven-development`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `finishing-a-development-branch`, `systematic-debugging`, `executing-plans` |
| Banco (T6, T7, T29) | `supabase`, `supabase-postgres-best-practices` (supabase/agent-skills, MIT) |
| Deploy (T29) | `deploy-to-vercel`, `vercel-cli-with-tokens` (vercel-labs/agent-skills, MIT) |
| Telas da onda 2 | `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines` |
| E2E (T28) | `agent-browser` (vercel-labs/agent-browser) |

Para deixar as skills disponíveis em **todos** os seus projetos:
- No WSL/Linux: `mkdir -p ~/.claude/skills && cp -r .claude/skills/* ~/.claude/skills/`.
- No Windows: copie a pasta `.claude\skills\*` para `%USERPROFILE%\.claude\skills\`.

Para atualizar as externas:
- `npx skills add supabase/agent-skills -a claude-code -s '*' -y --copy`
- `npx skills add vercel-labs/agent-skills -a claude-code -s deploy-to-vercel -s vercel-cli-with-tokens -s vercel-react-best-practices -s vercel-composition-patterns -s web-design-guidelines -y --copy`
- `npx skills add vercel-labs/agent-browser -a claude-code -s agent-browser -y --copy`

---

## 10. Produção (Task 29) pelo Claude Code

O brief `task-29-brief.md` descreve o caminho via MCP. No Claude Code:

**Supabase (MCP `supabase` do `.mcp.json`):**
1. Aplique as migrations com `apply_migration`, na ordem 0001 → 0006, com os nomes `ebc_000N_*`.
2. Rode os testes SQL em produção dentro de uma transação desfeita com rollback.
3. Rode `get_advisors` (segurança e desempenho).
4. Crie o owner com `select public.bootstrap_owner('matheuslsf13@gmail.com', '<senha de 16 caracteres gerada>', 'Matheus');`. A senha **nunca** vai para commit; só na mensagem final ao Matheus.
- A produção roda Postgres 17 e o ambiente local roda 16. Os testes rodados em produção cobrem essa diferença.

**Vercel:** localmente o caminho mais simples é a CLI (skill `deploy-to-vercel`):
1. `npx vercel login`
2. `npx vercel link --yes --project endurance-base-club --scope matheus-proj`
3. `npx vercel deploy --prod`

Configurações do projeto: framework Vite, build `vite build`, saída `dist`. O `vercel.json` e o `.env.production` já estão no repositório. A alternativa é o MCP `vercel` (`create_project` / `create_deployment`), como no brief.

**Smoke test:**
1. Abra a URL, faça login com o owner e confirme a tela de troca de senha. Não troque a senha do Matheus; saia.
2. Confirme que a página de eventos carrega.
3. Faça uma marcação num evento descartável e confirme que ela chegou via SQL.
4. Apague o evento descartável.

**Entregáveis finais:**
- `docs/DEPLOY.md`: URLs, como refazer o deploy, aviso de pausa do Supabase no plano gratuito, como redefinir senha.
- A planilha de exemplo gerada no E2E.
- A mensagem final para o Matheus, com URL, login, senha temporária e checklist pré-evento.

---

## 11. Decisões já tomadas pelo Matheus (não perguntar de novo)

- O banco é o projeto Supabase já criado: `wlishmznbhhcqzncdxnq`.
- O frontend fica na Vercel. Ele conectou o conector; o time é "Matheus Proj".
- O login master é `matheuslsf13@gmail.com`.
- Resultados e perfis de atletas são **públicos**.
- As modalidades são Corrida, Natação e Ciclismo.
- O tempo do sistema é a **mediana** das marcações, uma por cronometrista. A organizadora pode escolher uma marcação específica ou digitar um tempo manual.
- A logo do evento (`public/logo.png`) define a paleta, em preto e off-white.
- A forma de trabalhar é: planejar com writing-plans, executar com subagent-driven-development, paralelizar quando possível, **não perguntar nada durante a execução**, entregar pronto, validado e testado, e testar o frontend com o agent-browser da Vercel.
