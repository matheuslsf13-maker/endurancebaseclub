# Perfis públicos e estatísticas de atletas: design

**Data:** 28/09/2026 · **Status:** aprovado em conversa. Aguarda a revisão deste documento.
**Estende** a spec principal (`2026-09-24-endurance-base-club-design.md`) nos pontos §6 (funções públicas), §10 (estatísticas) e §12 (telas). Em conflito, **este documento vale** para o que ele cobre.

## 1. Objetivo

Um atleta **sem login** abre o site para consultar o próprio perfil e as estatísticas dele, e também o perfil de qualquer outro atleta cadastrado com perfil público. As estatísticas incluem o **desempenho junto com outra pessoa** (dupla ou equipe), o **confronto direto** com ela, a **comparação lado a lado** e os **rankings e recordes do clube**, tudo com **filtro por ano**.

**Sucesso:** o atleta abre o site, busca o próprio nome, vê o perfil completo, toca num parceiro e vê "nós dois": lado a lado, juntos e confronto. Depois abre os rankings do ano.

## 2. Escopo

**Dentro:**
- lista e busca pública de atletas;
- perfil público com filtro de ano, parceiros clicáveis e "Comparar com…";
- página "Nós dois" (lado a lado, juntos e confronto direto);
- página de rankings e recordes do clube;
- a função pública `pub_stats()`;
- o mesmo filtro de ano no perfil do painel da organização.

**Fora:**
- login ou conta de atleta, e edição de dados pelo próprio atleta;
- estatísticas de provas não finalizadas ou de eventos privados;
- comparação de pernas entre provas diferentes;
- mudança na chave "Perfil público" (continua como hoje, ligada por padrão);
- remoção da `pub_athlete` (ver §4.4).

## 3. Telas e navegação

Todas as telas ficam dentro da casca pública (`PublicShell`), sem login, e são carregadas sob demanda (`React.lazy`, Ruling 30). O link do cronometrista não baixa nada disso.

### 3.1 Cabeçalho público
- O `PublicShell` sai de `PublicHome.tsx` e vai para um arquivo próprio, `src/features/public/PublicShell.tsx`.
- Ele ganha a navegação **Eventos** (`#/`) · **Atletas** (`#/perfis`) · **Rankings** (`#/ranking`), com a aba atual destacada.
- O botão "Área da organização" e o tema continuam como estão.

### 3.2 Atletas: `#/perfis`
- **Busca por nome** que ignora acentos e maiúsculas ("joao" encontra "João"). A função `foldAccents` vai para `src/lib/text.ts`, e `entryFormState.ts` passa a importá-la de lá.
- **Filtro de sexo:** Todos / Masculino / Feminino.
- **Linhas em ordem alfabética** (collation `pt-BR`). Cada linha tem nome, cidade, clube e "N provas", que são as participações da carreira pela regra de §5.1. A linha toda leva ao perfil.
- **Lista vazia:**
  - sem nenhum atleta público: "Nenhum atleta com perfil público ainda";
  - busca sem resultado: "Nenhum atleta encontrado".

### 3.3 Perfil: `#/atleta/:id` (a página atual, com mudanças)
- **Seletor de ano:**
  - fica no topo, com as opções "Carreira" e cada ano que tenha resultado desse atleta, do mais recente ao mais antigo;
  - vale para toda a página;
  - fica na URL como `?ano=AAAA`, então um link compartilhado mantém o filtro;
  - sem o parâmetro, ou com um ano inválido, vale "Carreira".
- **Estatísticas:** o `StatsView` recebe só os resultados do ano escolhido.
- **Parceiros de equipe:**
  - parceiro com perfil público vira link para `#/comparar/:id/:parceiroId` (mantendo `?ano`);
  - parceiro sem perfil público continua texto simples.
- **Botão "Comparar com…":**
  - abre uma busca de atleta com a mesma busca de §3.2, sem o próprio atleta;
  - escolher um atleta leva a `#/comparar/:id/:outroId`.
- **Link inválido:** atleta inexistente ou privado mostra "Atleta não encontrado ou perfil privado", como hoje.

### 3.4 Nós dois: `#/comparar/:a/:b`
- **Cabeçalho:** o nome dos dois, cada um com link para o próprio perfil, e o seletor de ano. Os anos são a união dos anos de A e de B.
- **Lado a lado:**
  - duas colunas com participações, conclusões, vitórias gerais, vitórias em categoria, pódios, melhor colocação geral, Top X% médio, ritmo por modalidade e recordes pessoais;
  - um recorde aparece numa linha quando pelo menos um dos dois tem tempo naquela modalidade e distância, e o outro lado mostra "—".
- **Juntos:**
  - só aparece se os dois estiveram na mesma inscrição (§5.2);
  - mostra os números da dupla ou equipe e o histórico, com o tempo de cada integrante na própria perna.
- **Confronto direto:**
  - só aparece se houver pelo menos uma prova em comum com inscrições diferentes (§5.3);
  - mostra o placar "A ganhou N × M" (o "sem decisão" aparece à parte) e a lista das provas.
- **Nenhum cruzamento:** se não houver "Juntos" nem "Confronto", aparece a nota "Vocês ainda não correram juntos nem na mesma prova".
- **Links inválidos:**
  - `a` igual a `b`: a mensagem é "Escolha dois atletas diferentes", com um link para o perfil;
  - `a` ou `b` inexistente ou privado: "Atleta não encontrado ou perfil privado".

### 3.5 Rankings: `#/ranking`
- **Filtros:**
  - ano: "Carreira" ou cada ano com resultados;
  - sexo: Geral / Masculino / Feminino;
  - os dois ficam na URL (`?ano=AAAA&sexo=M|F`).
- **Líderes**, 4 quadros:
  - vitórias gerais;
  - pódios;
  - provas concluídas;
  - km em prova.
  - Cada quadro mostra posição, atleta (link para o perfil) e valor.
- **Recordes do clube:** um quadro por modalidade e distância, com os 3 melhores atletas: tempo, ritmo, evento e data. As regras estão em §5.5.
- **Sem dados:** "Ainda não há resultados oficiais neste período".

### 3.6 Painel da organização
O perfil do painel (`#/atletas/:id`) ganha o mesmo seletor de ano, com as mesmas regras de §3.3. Ele continua usando os dados do painel, que incluem os eventos privados.

### 3.7 Test IDs
Estes somam-se aos da spec principal:
- navegação: `public-nav-events`, `public-nav-athletes` e `public-nav-ranking`;
- lista de atletas: `public-athletes` (lista), `athlete-search` (campo de busca) e `athlete-row` (cada linha);
- filtros e comparação: `year-filter`, `compare-with` (botão) e `compare-picker` (busca do "Comparar com…");
- página "Nós dois": `public-compare`, com as seções `compare-side-by-side`, `compare-together` e `compare-head-to-head`;
- rankings: `public-ranking` e `sex-filter`.

## 4. Dados e privacidade

### 4.1 Função `pub_stats()`

A função entra na migration `supabase/migrations/0009_pub_stats.sql` e é aplicada em produção como `ebc_0009_pub_stats`. Ela é `language plpgsql stable security definer set search_path = public, extensions, pg_temp` e não recebe parâmetros. Retorna:

```json
{
  "athletes": [{ "id": "…", "name": "…", "sex": "M|F", "city": "…|null", "team_club": "…|null" }],
  "results":  [ /* linhas de public.results, no mesmo formato de pub_athlete (to_jsonb(r)) */ ]
}
```

- **`athletes`:** só atletas com `public_profile`, em ordem de `name`. Nunca `birth_date`, `email`, `phone`, `notes` nem o próprio `public_profile`.
- **`results`:** entra uma linha de `public.results` quando o evento é público (`events.is_public`) **e** pelo menos um id de `athlete_ids` pertence a um atleta com `public_profile`. A ordem é pela data do evento (`data->'event'->>'date'`), da mais recente para a mais antiga.
- **A regra de privacidade**, testada: o conjunto `results` é **exatamente** a união dos `results` de `pub_athlete(id)` para todos os atletas públicos, e os campos de cada atleta são os mesmos de `pub_athlete`. A função nova não expõe nada que já não estivesse exposto.
- **Permissões:** o fim da migration repete o bloco de permissões da `0006` (DEPLOY.md). Pelo prefixo `pub_`, a função fica executável por `anon` e `authenticated`.

### 4.2 Atleta privado dentro de uma equipe
Ele aparece **só pelo nome e pelos tempos de perna** dentro do resultado da equipe, como já aparece hoje na página do evento e no perfil do parceiro público. Não aparece:
- na lista de atletas;
- nos rankings;
- nos recordes do clube;
- em "Nós dois" (nem como `a`, nem como `b`);
- como link.

### 4.3 Cliente
- `api.pub.stats()` chama `pub_stats`. O tipo novo é `PubStatsPayload { athletes: PublicAthleteRow[]; results: ResultRow[] }`, com `PublicAthleteRow = Pick<AthleteRow, 'id'|'name'|'sex'|'city'|'team_club'>`.
- O hook `usePublicStats()` usa a query key `['pub-stats']`, `staleTime` de 5 minutos e refaz a consulta ao voltar o foco para a página. As quatro telas públicas usam só esse hook, então navegar entre elas não faz requisição nova.
- **Erro de carga:** "Não foi possível carregar os atletas", com o botão "Tentar de novo". Um erro de rede usa a mensagem padrão da `api` ("Sem conexão com o servidor").

### 4.4 Compatibilidade
A página `#/atleta/:id` deixa de chamar `pub_athlete` e passa a usar `pub_stats`. A função `pub_athlete` **continua no banco**, porque celulares com a versão anterior do app ainda a chamam até reabrir o app (Ruling 26). `api.pub.athlete` continua disponível. A remoção fica para uma limpeza futura.

## 5. Regras de cálculo

Todas as regras são funções puras em TypeScript, em `src/domain/`, sobre `ResultRow[]`.

### 5.1 Ano e perfil
- O **ano** de um resultado é `data.event.date.slice(0, 4)`.
- `resultYears(results)` devolve os anos distintos, do mais recente para o mais antigo.
- `filterResultsByYear(results, year | null)`: `null` significa carreira.
- O perfil é `computeAthleteStats(id, filterResultsByYear(...))`, com as regras de §10 da spec principal, sem mudança.

### 5.2 Juntos: `computeTogether(a, b, results)`
- **Resultados juntos:** os que têm `athlete_ids` com `a` **e** `b`, ou seja, a mesma inscrição.
- **Resumo:** participações, conclusões, vitórias gerais, vitórias em categoria, pódios, melhor colocação geral e Top X% médio, com as mesmas definições de §10. São números da inscrição, iguais para os dois.
- **Histórico**, da data mais recente para a mais antiga: evento, data, prova, nome da equipe, status, tempo final, colocação geral, concluintes e, para cada integrante da inscrição, nome, perna (rótulo) e tempo da perna.

### 5.3 Confronto direto: `computeHeadToHead(a, b, results)`
- **Prova em comum:** o mesmo `race_id`, com `a` numa inscrição e `b` em outra. A regra das inscrições garante no máximo uma inscrição por atleta em cada prova.
- **Os dois precisam ter largado:** o status não pode ser `dns` nem `not_started`. Caso contrário, a prova fica fora do confronto.
- **Vencedor:**
  - os dois com `overall_pos`: vence a menor;
  - só um com `overall_pos`: vence esse (o outro teve DNF, DSQ ou ficou em prova);
  - nenhum com `overall_pos`: "sem decisão", fora do placar.
- **Diferença:** `final_ms` de B − `final_ms` de A, quando os dois têm `final_ms`. Caso contrário, `null`.
- **Saída:** vitórias de A, vitórias de B, quantidade de "sem decisão" e a lista das provas (evento, data, prova, status, tempo e colocação de cada um, vencedor, diferença), da data mais recente para a mais antiga.

### 5.4 Líderes: `computeLeaders(athletes, results, { year, sex })`
- **Universo:** só atletas de `athletes` (os públicos), filtrados pelo sexo do cadastro, e os resultados do ano escolhido.
- **Métricas**, por atleta, com as definições de §10:
  - vitórias gerais: uma vitória de equipe conta para cada integrante;
  - pódios: 1 por resultado com algum pódio ≤ 3;
  - provas concluídas;
  - km em prova: soma das distâncias das **pernas qualificadas** do próprio atleta (§5.5).
- **Ordem:**
  - valor decrescente;
  - empates dividem a posição (1º, 1º, 3º) e ficam em ordem alfabética (`pt-BR`);
  - valor zero não entra.
- **Corte:** 10 posições. Quem empatar com o 10º também entra.

### 5.5 Recordes do clube: `computeClubRecords(athletes, results, { year, sex })`
- **Pernas qualificadas:**
  - valem as mesmas regras do recorde pessoal: resultado não DSQ, `time_ms > 0` e `distance_m` conhecida;
  - `athlete_id` precisa estar em `athletes`, depois do filtro de sexo;
  - o ano do resultado precisa ser o escolhido.
  - Para não duplicar a regra, a função interna `ownLegs` de `stats.ts` vira uma função exportada, usada pelo perfil e pelo clube.
- **Grupos:** um por (modalidade, distância).
  - Em cada grupo fica o **melhor tempo de cada atleta**, e os **3 melhores atletas** aparecem, cada um com tempo, ritmo (`formatPace`; "Outro" mostra só o tempo), evento e data.
  - Empate de tempo: ganha a data mais antiga, porque quem fez primeiro detém o recorde.
- **Ordem dos grupos:** Corrida, Natação, Ciclismo, Outro. Dentro de cada modalidade, distância crescente.

## 6. Unidades e arquivos

| Unidade | O que faz | Depende de |
|---|---|---|
| `supabase/migrations/0009_pub_stats.sql` | função `pub_stats()` e bloco de permissões | tabelas `athletes`, `events`, `results` |
| `supabase/tests/70_pub_stats.sql` | regra de privacidade e exclusões | `00_helpers.sql` |
| `supabase/tests/60_security.sql` | inclui `pub_stats` na lista de funções de `anon` | — |
| `src/lib/text.ts` | `foldAccents` | — |
| `src/lib/api.ts` e `src/lib/types.ts` | `api.pub.stats`, `PubStatsPayload` e `PublicAthleteRow` | — |
| `src/domain/stats.ts` | exporta pernas qualificadas, `resultYears` e `filterResultsByYear` | — |
| `src/domain/pairStats.ts` | `computeTogether` e `computeHeadToHead` | `stats.ts` |
| `src/domain/clubStats.ts` | `computeLeaders` e `computeClubRecords` | `stats.ts` e `format.ts` |
| `src/features/public/PublicShell.tsx` | casca e navegação pública | — |
| `src/features/public/usePublicStats.ts` | hook da query `pub-stats` | `api` |
| `src/components/YearSelect.tsx` | seletor de ano ligado a `?ano` | react-router |
| `src/features/public/AthletePicker.tsx` | busca de atleta ("Comparar com…") | `text.ts` |
| `src/features/public/PublicAthletesPage.tsx` | `#/perfis` | hook, `text.ts` |
| `src/features/public/PublicAthletePage.tsx` | `#/atleta/:id` (mudanças de §3.3) | hook, `StatsView`, `YearSelect`, `AthletePicker` |
| `src/features/public/PublicComparePage.tsx` | `#/comparar/:a/:b` | hook, `pairStats`, `stats` e `YearSelect` |
| `src/features/public/PublicRankingPage.tsx` | `#/ranking` | hook, `clubStats` e `YearSelect` |
| `src/features/athletes/StatsView.tsx` | prop nova `partnerLink?: (id) => string \| null`: no modo público, liga um parceiro a "Nós dois" quando ele é público | — |
| `src/features/athletes/AthleteProfilePage.tsx` | seletor de ano no painel | `YearSelect` |
| `src/App.tsx` | rotas `/perfis`, `/comparar/:a/:b` e `/ranking` (lazy) | — |

## 7. Testes

1. **SQL** (`scripts/test-sql.sh`), no arquivo `70_pub_stats.sql`:
   - `athletes` só tem atletas públicos, sem os campos proibidos;
   - evento privado fica fora;
   - uma inscrição só de atletas privados fica fora;
   - uma equipe com um atleta público entra;
   - `results` é igual à união de `pub_athlete` de todos os públicos;
   - no `60_security`, `anon` executa `pub_stats`.
2. **Unitários** (Vitest):
   - `filterResultsByYear` e `resultYears`;
   - `computeTogether`;
   - `computeHeadToHead`: vitória por colocação, colocação contra DNF ou DSQ, os dois sem colocação ("sem decisão"), DNS fora, diferença nula sem `final_ms`;
   - `computeLeaders`: empates, corte com empate no 10º, zero fora, filtros de sexo e ano, equipe contando para cada integrante;
   - `computeClubRecords`: melhor tempo por atleta, top 3, DSQ, tempo zero e sem distância fora, desempate pela data, ordem dos grupos, atleta privado fora;
   - `foldAccents`.
3. **Componentes:**
   - busca sem acento e filtro de sexo;
   - seletor de ano ligado a `?ano`;
   - parceiro público com link e privado sem;
   - "Comparar com…";
   - seções de "Nós dois" que somem quando vazias;
   - mensagens de link inválido;
   - filtros de rankings;
   - a navegação do cabeçalho.
4. **Integração** (supabase-js + shim): `pub_stats` chamada como `anon`.
5. **E2E** (agent-browser), no cenário `04_public_offline.sh`, com os dados do cenário 01:
   - Atletas → busca "ana" → perfil → parceiro "Beto" → "Nós dois" com a seção "Juntos";
   - Rankings com o quadro "Vitórias gerais".
6. **Suíte completa** antes do merge:

   ```bash
   npm run typecheck && npx vitest run && npm run test:integration && bash scripts/test-sql.sh && bash tests/e2e/run.sh
   ```

## 8. Entrega

- **Código:** na branch `feat/public-stats`, criada a partir da `main`, com PR para a `main`. O merge publica em produção (Vercel).
- **Banco:** antes do merge, aplicar `ebc_0009_pub_stats` em produção e rodar em produção o `70_pub_stats.sql` e o `60_security.sql`, cada um numa transação desfeita, como em DEPLOY.md.
  - A função nova só é chamada pela versão nova do app, então aplicá-la antes do merge não afeta quem usa a versão atual.
- **Documentação:** o `DEPLOY.md` passa a listar as migrations até a `0009`, e o `README.md` inclui as páginas novas.

## 9. Decisões registradas

| Decisão | Custo se estiver errada |
|---|---|
| Os cálculos ficam no app, sobre um pacote único de resultados públicos (opção A) | Com dezenas de milhares de resultados, o pacote fica pesado; aí se cria uma função paginada ou agregada |
| A chave "Perfil público" continua valendo, e o padrão é ligada | Quem quiser sair pede à organização |
| Nos recordes do clube, vale o melhor tempo por atleta, e o empate vai para a data mais antiga | Um atleta dominante aparece uma vez só por grupo |
| No confronto, "sem decisão" fica fora do placar e DNS fica fora do confronto | O placar ignora provas em que os dois abandonaram |
| A `pub_athlete` fica no banco por compatibilidade | Uma função pública a mais até a limpeza |
| O filtro de ano fica na URL (`?ano`) | Nenhum |
