# EnduranceBaseClub

Site para organizar e cronometrar eventos multiesporte do **EnduranceBaseClub**: corrida, natação, ciclismo, provas individuais e revezamentos.

**App:** https://endurance-base-club.vercel.app

## O que ele faz

- **Organização**, com login:
  - eventos, provas e pernas (modalidade, distância, ordem);
  - largadas por onda;
  - categorias por sexo, faixa etária e nível;
  - pódios e inscrições individuais ou de equipe, com um atleta por perna;
  - importação de atletas por planilha.
- **Cronometragem pelo celular**:
  - cada voluntário abre um link, sem login;
  - o relógio é sincronizado com o servidor, em horário de Brasília;
  - o app funciona sem internet e envia as marcações quando a conexão volta;
  - com vários cronometristas, o tempo oficial é a **mediana**, ou uma marcação escolhida, ou um horário manual;
  - no revezamento, a chegada de um atleta abre a perna do próximo.
- **Revisão e resultados**:
  - pendências para resolver (divergências, marcações sem atleta, duplicadas);
  - classificação e pódios;
  - finalização da prova, que congela os resultados oficiais;
  - planilha de conferência em XLSX.
- **Páginas públicas**:
  - resultados ao vivo e oficiais;
  - lista e busca de atletas (`#/perfis`) e perfis com histórico e estatísticas, filtráveis por ano, para quem aceitou ter perfil público;
  - "Nós dois" (`#/comparar/…`): dois atletas lado a lado, o desempenho juntos em dupla ou equipe e o confronto direto;
  - rankings e recordes do clube (`#/ranking`), por ano e por sexo.

## Documentação

- [docs/DEPLOY.md](docs/DEPLOY.md): produção, atualizações, banco, contas e checklist antes de cada evento.
- [docs/superpowers/specs/2026-09-24-endurance-base-club-design.md](docs/superpowers/specs/2026-09-24-endurance-base-club-design.md): especificação completa.
- [CLAUDE.md](CLAUDE.md): regras do projeto para quem for mexer no código.

## Tecnologia

- **Front-end:** React 19 (SPA com HashRouter), TanStack Query, Tailwind v4 e TypeScript.
- **App instalável:** PWA com vite-plugin-pwa.
- **Planilhas:** XLSX gerado pelo próprio app.
- **Banco e login:** Supabase (Postgres 17 + Auth). O acesso é **somente por funções** (RPC `security definer`). Todas as tabelas têm RLS ligado e nenhuma política.
- **Hospedagem:** Vercel, com publicação automática a cada merge na `main`.

## Rodando localmente

O app roda no Windows. O banco local, os testes de banco e o E2E precisam de Linux; use o WSL2 com Ubuntu 24.04, Node 22, PostgreSQL 16 e python3-openpyxl.

```bash
npm ci
npm run typecheck && npx vitest run && npm run build     # front-end
bash scripts/test-sql.sh                                 # testes do banco (Postgres local)
npm run test:integration                                 # supabase-js contra o emulador local
bash tests/e2e/run.sh                                    # dia de evento completo no navegador (agent-browser)
npm run dev:stack                                        # banco + emulador para desenvolver (login local em scripts/dev-stack.sh)
```
