# Handoff: EnduranceBaseClub (Claude Code na nuvem → Claude Code local em `C:\ENDURANCE`)

**Atualizado em:** 25/09/2026, 21h30 UTC.
**Repositório:** `github.com/matheuslsf13-maker/endurancebaseclub`, branch de trabalho **`feat/ebc-app`**.
**Leia também:** o `CLAUDE.md` na raiz e o ledger `.superpowers/sdd/2026-09-24-endurance-base-club/progress.md`. O ledger é a fonte da verdade: estado de cada task, todos os Rulings (1–45) e os minors adiados.

A `main` do GitHub ainda tem o **app antigo**. A troca para o app novo acontece no fim, conforme o Ruling 25 (ver §6).

---

## 1. Resumo do estado

| Situação | Tasks |
|---|---|
| Integradas em `feat/ebc-app` (revisão limpa) | 1–20, 23, 24, 25 |
| Implementada, gates verdes, **falta revisão** | 21 (inscrições), 26 (páginas públicas), 27 (PWA + divisão do bundle) |
| Revisada, **precisa de rodada de correção** | 22 (app do cronometrista), pelo `task-22-review.md` e pelos Rulings 44–45 |
| Não iniciadas | 28 (E2E), revisão final da branch, 29 (produção), entrega na `main` |

Números em `feat/ebc-app`:
- vitest: 443 testes verdes;
- typecheck limpo e build ok;
- SQL: 7/7 arquivos PASS;
- integração (supabase-js + shim): 16/16.

O banco de produção (Supabase `wlishmznbhhcqzncdxnq`) continua **vazio**. O projeto na Vercel ainda não foi criado.

**Por que parou na nuvem:** o limite de uso da conta interrompeu os agentes duas vezes. O Matheus pediu para continuar localmente.

---

## 2. Como abrir em `C:\ENDURANCE`

O app (front, vitest, build) roda no Windows. **O banco local, os testes SQL, o teste de integração e o E2E precisam de Linux.** Os scripts usam `runuser -u postgres` e `/usr/lib/postgresql/16/bin`.

O caminho recomendado é ter os arquivos em `C:\ENDURANCE` e trabalhar pelo **WSL2 (Ubuntu 24.04, como root)**, que enxerga a pasta em `/mnt/c/ENDURANCE`.

**Não misture `npm ci` do Windows com o do WSL na mesma pasta.** O `node_modules` tem binários por plataforma (esbuild, rollup, tailwind), então escolha um lado. Recomendado: o WSL.

### 2.1 Pegar o projeto

- **Pelo pacote:** baixe `endurance-base-club-local.zip` e extraia de modo que exista `C:\ENDURANCE\endurance-base-club\` com a pasta `.git` dentro. O pacote traz o repositório com **todas** as branches (`feat/ebc-app`, `task/21`, `task/22`, `task/26`, `task/27`, `main`), e o `origin` já aponta para o GitHub.
- **Ou pelo GitHub:** `git clone -b feat/ebc-app https://github.com/matheuslsf13-maker/endurancebaseclub.git C:\ENDURANCE\endurance-base-club`. Depois rode `git fetch origin task/21 task/22 task/26 task/27`.

### 2.2 Preparar o WSL (uma vez)

No PowerShell:

```powershell
wsl --install -d Ubuntu-24.04
wsl -d Ubuntu-24.04 -u root
```

Dentro do Ubuntu, como root:

```bash
apt update && apt install -y git curl unzip build-essential python3 python3-openpyxl postgresql-16 postgresql-client-16
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm install -g @anthropic-ai/claude-code agent-browser@0.27
agent-browser install --with-deps
cd /mnt/c/ENDURANCE/endurance-base-club
git config --global --add safe.directory /mnt/c/ENDURANCE/endurance-base-club
npm ci
bash scripts/db-local.sh start && bash scripts/test-sql.sh   # 7 arquivos PASS
npx vitest run && npm run typecheck                           # verde
npm run test:integration                                      # 16/16
claude                                                        # abre o Claude Code na pasta
```

- Na primeira abertura, aprove os servidores MCP do projeto (`supabase`, `vercel`) e rode `/mcp` para autenticar os dois. Localmente eles funcionam; na nuvem o proxy bloqueava o da Vercel.
- **Desempenho:** trabalhar em `/mnt/c` é mais lento que no disco do Linux. Se incomodar, clone também em `/root/endurance-base-club` e use `C:\ENDURANCE` só como cópia.
- **Chromium do E2E:** o `tests/e2e/lib.sh` do brief da T28 aponta para `/opt/pw-browsers/...`, que só existe na nuvem. Localmente, use o Chrome instalado pelo `agent-browser install`: não exporte `AGENT_BROWSER_EXECUTABLE_PATH`, ou aponte para o binário instalado.

### 2.3 Caminhos antigos nos briefs e no ledger

| Nos documentos | Localmente |
|---|---|
| `/home/claude/endurance-base-club` e `/home/user/endurancebaseclub` | a raiz do repositório (`/mnt/c/ENDURANCE/endurance-base-club`) |
| `/home/claude/ebc-wt/tN` e `/home/user/ebc-wt/tN` | `../ebc-wt/tN` |

Recrie as worktrees das tasks pendentes:

```bash
mkdir -p ../ebc-wt
for n in 21 22 26 27; do git worktree add ../ebc-wt/t$n task/$n && ln -s "$PWD/node_modules" ../ebc-wt/t$n/node_modules; done
```

---

## 3. Próximas ações, em ordem

Siga a skill `/subagent-driven-development`: revisor por task, rodadas de correção retomando o implementador, re-revisão escopada e merge `--no-ff`. O ledger manda: leia `progress.md` antes de despachar.

Para economizar limite de uso, **rode no máximo 3–4 agentes ao mesmo tempo**. Na nuvem, 8–10 em paralelo estouraram o limite duas vezes.

1. **T22, rodada de correção 1.**
   - A revisão (opus) está em `task-22-review.md`. O escopo é o Important 1 mais os Rulings 44 e 45:
     - seleção automática só para rajadas de até 60 s;
     - toque capturado no pointerdown;
     - deduplicação por timeStamp;
     - rejeição aplicada só com versão igual;
     - aviso de falha ao salvar;
     - "Reatribuir" em qualquer rejeitada;
     - "✓ marcada por você";
     - foco preservado no campo do nº;
     - uma aba ativa por link (Web Locks).
   - A `task/22` já tem a `feat` mesclada (`f7ef416`); a correção ainda não começou.
   - Depois: re-revisão escopada (opus) e merge.
2. **T21, revisão.**
   - Diff `221d2db..c5a9434`. O commit foi feito pelo controlador depois do corte, com os gates verificados (475 testes).
   - Falta o `task-21-report.md`: peça ao revisor que confira direto no diff, ou despache o implementador para escrever o relatório.
   - Depois: correções, se houver, e merge.
3. **T26, revisão.** Diff `221d2db..2bd2d7b`; o relatório está em `task-26-report.md`.
4. **T27, revisão.**
   - Diff `3d47624..33caf37`; o relatório está em `task-27-report.md`.
   - Antes do merge, rode `git merge feat/ebc-app` na `task/27`. Ela nasceu antes de várias telas, e o `App.tsx` com rotas lazy precisa cobrir as páginas reais.
   - Confira de novo que o chunk do `#/c/:token` não carrega as telas de admin.
5. **T28, E2E com agent-browser.**
   - Brief em `task-28-brief.md`. O ambiente foi validado na nuvem.
   - Incluir, pelo Ruling 24: conferir com openpyxl os formatos `[h]:mm:ss.0` e `hh:mm:ss.0`.
   - Incluir também os pendentes da T22: toasts do kit translúcidos e o layout a 390×844.
   - Rodada final verde: `npm run typecheck && npx vitest run && npm run test:integration && bash scripts/test-sql.sh && bash tests/e2e/run.sh`.
6. **Revisão final da branch inteira** (modelo mais forte).
   - Inclua os `minor (deferred)` e os parked do ledger (`grep -n "minor (deferred)" .superpowers/sdd/*/progress.md`).
   - Uma única leva de correção, depois uma re-revisão.
7. **T29, produção.** Brief em `task-29-brief.md`.
   - **Supabase (MCP):**
     - aplicar as migrations 0001→0006;
     - rodar os testes SQL em transação desfeita;
     - checar os grants com `has_function_privilege` (nota do Ruling 35 no ledger);
     - `get_advisors`: avisos de `security definer` em `tk_*`/`pub_*` chamáveis por anon são esperados;
     - criar o owner com `bootstrap_owner('matheuslsf13@gmail.com', <senha de 16 caracteres gerada>, 'Matheus')`. A senha **nunca** vai para commit.
   - **Vercel:** criar o projeto `endurance-base-club` no time `matheus-proj` e fazer o deploy de produção, por CLI ou MCP.
   - **Smoke test** no navegador.
   - **Entregáveis:** `docs/DEPLOY.md` e um README novo.
8. **Entrega na `main`** (Rulings 17 e 25):
   - `git rm -r --cached .superpowers`;
   - merge com a árvore igual à da `feat/ebc-app`, mantendo o app antigo no histórico e sem force-push;
   - apagar as branches remotas `gh-pages` e `claude/event-timing-system-e6oups`;
   - avisar que o projeto Supabase antigo (`ljwcqnrjsmcgqqxsgfaf`) pode ser pausado ou apagado pelo painel.

---

## 4. Decisões desta fase (Rulings 17–45)

A lista completa, com o custo se estiver errado, está no ledger. Estas são as que mais afetam o trabalho que falta:

- **R17 e R25:** a `main` recebe o app novo no fim, com o antigo preservado no histórico. `gh-pages` e a branch da sessão antiga são apagadas, com autorização do Matheus.
- **Lições de campo do app antigo:**
  - **R21:** o cronometrista abre no tema claro.
  - **R22:** o card recém-passado sobe para o topo com "toque para confirmar".
  - **R24:** o Excel mantém números com formato, e o E2E confere os formatos.
- **R26:** o PWA usa `prompt`. Uma versão nova nunca recarrega a tela do cronometrista.
- **R27 e R28:**
  - uma correção da organizadora prevalece sobre um reenvio atrasado ("Alterada pela organização");
  - campo opcional inválido nunca rejeita uma marcação;
  - erro inesperado deixa a marcação pendente, para tentar de novo.
- **R29 e R42:** nada privado nas rotas públicas: sem `notes`, sem nota da decisão, sem `decided_by`, sem dados de contato, nascimento ou token.
- **Permissões:**
  - **R15:** revoke geral e depois grants por prefixo.
  - **R35:** revoke do default PUBLIC também para funções futuras.
  - **R37:** o shim concede permissão explícita às suas funções de teste.
- **R32–R34:** `.env.test` com valores locais; cronometristas atualizados no painel ao vivo; timeout em toda chamada ao servidor.
- **R36:** os testes da casca usam marcadores, nunca o texto dos stubs.
- **R38:** os agentes podem ver no contexto o `CLAUDE.md` do app antigo e devem ignorá-lo. Localmente isso não acontece.
- **R40:** formulários não perdem edição não salva quando os dados mudam em outro lugar.
- **R41:** `ClassificationTable` e `PodiumView` recebem `athletesById`.
- **R43:** as rotas públicas trazem também as marcações descartadas, para o descarte chegar ao cliente.
- **R44 e R45:** o escopo da correção da T22 (§3, item 1).

---

## 5. O que tem no repositório

- `.superpowers/sdd/2026-09-24-endurance-base-club/`, com:
  - o ledger (`progress.md`) e os contratos (`contracts.md`);
  - os 29 briefs e os relatórios;
  - as revisões salvas (`task-4/6/11/17/22-review.md`);
  - os pacotes de revisão (`review-*.diff`), gerados com `pkg.sh`;
  - `wave2-context.md` (contexto comum das telas) e `screen-review-instructions.md` (template de revisão das telas).
- `.claude/skills/`: as skills do processo, mais `supabase`, `deploy-to-vercel` e `agent-browser`.
- `.claude/settings.json`: comandos pré-aprovados.
- `.mcp.json`: os servidores MCP `supabase` e `vercel`.

---

## 6. Prompt para colar no Claude Code local

```
Você é o controlador da execução do projeto EnduranceBaseClub. Leia CLAUDE.md, docs/HANDOFF.md (inteiro) e o ledger .superpowers/sdd/2026-09-24-endurance-base-club/progress.md. Os caminhos /home/claude/... e /home/user/... dos documentos são a raiz deste repositório (ver HANDOFF §2.3). Continue pela seção 3 do HANDOFF, na ordem, com /subagent-driven-development (revisão por task, correções retomando o implementador, re-revisão escopada, merge --no-ff em feat/ebc-app, ledger atualizado a cada passo), no máximo 3-4 agentes em paralelo. Não me pergunte nada: decida, registre um Ruling no ledger e siga. No fim: E2E com agent-browser, revisão final ampla, deploy de produção (Task 29: Supabase + Vercel via MCP), entrega na main pelos Rulings 17/25, e me entregue a URL, o login matheuslsf13@gmail.com com a senha temporária, a lista de Rulings e o checklist pré-evento. Entregue pronto, validado e testado.
```
