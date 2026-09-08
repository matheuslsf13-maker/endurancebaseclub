# Endurance Base Club — Sistema de Cronometragem e Estatísticas

Planejamento do sistema de organização, cronometragem e histórico de eventos
multi-modalidade (corrida, natação, ciclismo — e o que mais você escrever).

---

## 1. O problema a resolver

No último evento a cronometragem falhou. O sistema precisa garantir, nessa ordem:

1. **Nunca perder um tempo marcado.** Nem por internet caindo, nem por celular
   travando, nem por clique errado.
2. **Marcar o tempo exato do clique**, no horário de Brasília, mesmo que o envio
   ao servidor demore.
3. **Ser rápido de operar durante a prova**: um toque no card fecha o trecho
   atual e já começa o próximo.
4. **Guardar tudo para sempre**: o histórico do atleta, da dupla/trio e de cada
   modalidade atravessa os eventos.

## 2. Baseado no Play de Todas

Este projeto segue a mesma stack e os mesmos padrões do
[`play-de-todas`](https://github.com/matheuslsf13-maker/play-de-todas), que já
está rodando: mesma cara, mesmo jeito de operar pelo celular, mesma forma de
guardar dados.

| | |
|---|---|
| Front-end | React 18 + TypeScript + **Vite 5**, sem router (abas no `App.tsx`) |
| PWA | manifest + service worker, instala na tela inicial, abre em tela cheia |
| Banco | Supabase (Postgres + Auth + Realtime), `anon key` pública + RLS |
| Armazenamento | `localRepo` (navegador) e `supabaseRepo`, com **fila de escrita otimista** que sobrevive a refresh (`queue.ts`) |
| Deploy | GitHub Pages pelo workflow do push na `main` |
| Idioma | Português do Brasil na interface; comentários em português, identificadores sem acento |
| Documentação | `CLAUDE.md` (como funciona hoje) + `DECISOES.md` (por que é assim) |

**Diferença importante em relação ao Play de Todas:** lá o app pode ser operado
por uma pessoa só; aqui **vários cronometristas marcam ao mesmo tempo**, em
aparelhos diferentes. Isso exige duas coisas novas: sincronização de relógio
entre dispositivos e resolução de cliques duplicados (seções 6.1 e 6.4).

## 3. Como você configura um evento (tudo antes da largada)

Um assistente em passos. **Nada é fixo no código — você escreve tudo.**

### Passo 1 — Dados do evento
Nome, data, local, tipo de largada (**em massa**, **em baterias/ondas** ou
**individual**).

### Passo 2 — As modalidades, na ordem da prova
Você escreve o nome da modalidade e, logo abaixo, aparece o campo de distância:

```
1ª  [ Corrida    ]  distância: [ 3   ] km
2ª  [ Ciclismo   ]  distância: [ 4   ] km
3ª  [ Natação    ]  distância: [ 2   ] km
                                        [ + adicionar modalidade ]
```

O nome é livre (Corrida, Ciclismo, Natação, Remo, Trekking, o que for) e a ordem
é a ordem em que serão feitas. **A distância é o que permite calcular pace e
velocidade** — sem ela o sistema só sabe o tempo; com ela sabe o desempenho.

*Opcional por modalidade:* unidade (km ou m — natação costuma ser em metros),
cor e ícone do card.

### Passo 3 — Formato das equipes
**Solo · Dupla · Trio · Quarteto** (ou qualquer número). Pode haver mais de um
formato no mesmo evento — ex: uma disputa solo e uma disputa em dupla.

### Passo 4 — Como classificar
Você escolhe aqui, no evento, como a classificação vai sair:

- [ ] **Só geral** (sem separar nada)
- [ ] **Por sexo** (masculino / feminino / misto)
- [ ] **Por faixa etária** — e você define as faixas: `18-29`, `30-39`, `40+`…
- [ ] **Por sexo e faixa etária** (as duas juntas)
- [ ] **Categorias que eu escrevo** — texto livre: *Iniciante, Master, Elite*…

Pode combinar mais de um critério. A classificação geral sai sempre; os
critérios escolhidos geram as classificações separadas em cima dela.

### Passo 5 — Montar as equipes
Escolhe os atletas do cadastro (ou cadastra na hora) e monta cada equipe, com
nome e número de peito (dorsal).

### Passo 6 — Quem faz o quê (o coração da flexibilidade)
Para cada equipe, você escolhe um dos modos:

São **dois modos**, que são os que o evento usa hoje:

| Modo | Como fica | Exemplo |
|---|---|---|
| **Solo — a mesma pessoa faz tudo** | 1 atleta, todas as modalidades | Mateus corre, pedala e nada |
| **Grupo — cada um faz uma parte** | você escolhe o atleta de cada modalidade | Dupla: Arthur a natação, Mateus a corrida. Trio: um em cada |

No modo grupo aparece um seletor por modalidade:

```
Trio "Os Bagres" (dorsal 12)
  Corrida  3 km  →  [ Arthur ▾ ]
  Ciclismo 4 km  →  [ Mateus ▾ ]
  Natação  2 km  →  [ João   ▾ ]
```

Se o grupo tiver menos gente que modalidades, é só repetir a mesma pessoa em
duas linhas — o sistema aceita.

Os dois modos saem do **mesmo modelo de dados** (a tabela `trechos`), então
nenhum código muda entre um caso e outro. E é esse mesmo modelo que, no dia em
que você quiser o formato "todo mundo faz tudo junto", vai receber ele sem
reescrever nada (ver seção 12).

### Exemplo completo
> Evento "Desafio Base 2026" · largada em massa · Corrida 3 km → Ciclismo 4 km →
> Natação 2 km · classificação por sexo · formatos Solo e Trio.
> Trio "Os Bagres" (dorsal 12): Arthur → Corrida, Mateus → Ciclismo, João →
> Natação.
>
> O sistema vai medir: o tempo de cada um no seu trecho, o pace de cada um, e o
> tempo total do trio.

## 4. O que o sistema mede

Para **toda** configuração, sempre os dois níveis:

- **Tempo total** — da largada até o clique final da equipe.
- **Tempo de cada modalidade** — e, junto, **de qual atleta foi aquele trecho**.

Então:
- *Solo:* tempo total do Mateus + o tempo dele em cada uma das 3 modalidades.
- *Dupla ou trio:* tempo total da equipe + o tempo individual de cada um no
  trecho que fez.

**Detalhe do modo grupo:** como cada atleta faz uma parte, quem cruza a linha
final é uma pessoa só — não a equipe inteira. O clique de chegada é sempre no
card da equipe, e o tempo total é o da equipe; o tempo individual sai de cada
passagem.

## 5. Modelo de dados

```
atletas         id, nome, apelido, sexo, nascimento, contato, foto, ativo
                  -- sexo e nascimento alimentam a classificacao por sexo/faixa
                  -- cadastro do CLUBE, nao do evento: e o que permite o historico

eventos         id, nome, data, local, tipo_largada, status, codigo, criado_em
                  -- `codigo` e o segredo do link dos cronometristas (6.6)
modalidades     id, evento_id, ordem, nome, distancia, unidade (km|m), cor, icone
classificacao   id, evento_id, criterio (geral|sexo|faixa|livre), faixas, nomes
                  -- escolhido no passo 4; a geral existe sempre
baterias        id, evento_id, nome, horario_previsto, largada_em

equipes         id, evento_id, dorsal, nome, tamanho (1..N), categoria,
                bateria_id, modo (solo|grupo)
membros         id, equipe_id, atleta_id
trechos         id, equipe_id, ordem, modalidade_id, atleta_id (null = equipe junta)
                  -- ⭐ e daqui que sai toda a flexibilidade do passo 6

marcacoes       id, evento_id, equipe_id, trecho_id,
                tipo (largada|passagem|chegada|dnf|dns|ajuste|desfazer),
                marcado_em (timestamptz ja corrigido), dispositivo, operador,
                seq_cliente, nota
                  -- LOG QUE NUNCA E APAGADO. O estado atual e derivado dele.
```

## 6. Cronometragem

### 6.1 Sincronização de relógio entre os aparelhos (crítico)

Se três pessoas marcam tempo em três celulares, os relógios podem divergir
vários segundos entre si — e o resultado sai errado.

Ao abrir a tela de cronometragem, cada aparelho mede seu **desvio em relação ao
relógio do servidor** (várias amostras de ida-e-volta, fica com a de menor
latência — mesma ideia do NTP). Todo tempo gravado é
`relógio do aparelho + desvio medido`. A tela mostra `Relógio sincronizado
±0,2s`, e avisa em vermelho **antes da largada** se estiver ruim.

Horário sempre exibido em **America/Sao_Paulo (Brasília)** e guardado em UTC.

### 6.2 Funcionamento offline

O toque grava o tempo **no instante do toque**, direto no aparelho, e só depois
tenta enviar (mesma `queue.ts` do Play de Todas). Internet caindo não para a
cronometragem, e atraso de rede nunca contamina o tempo registrado.

### 6.3 Registro imutável

Largada, passagem, chegada, DNF, correção, desfazer — tudo vira **linha nova**
no log; o estado de cada equipe é **calculado** a partir dele. É impossível
perder um tempo por sobrescrita, e toda correção fica auditável (quem, quando,
o que era antes).

### 6.4 Vários cronometristas na mesma chegada: os tempos são votos

A primeira versão deste plano dizia "vence o primeiro toque, os outros são
duplicados". **Estava errado** — jogava fora justamente a informação mais
valiosa que ter três pessoas cronometrando produz.

O modelo certo: quando mais de um cronometrista marca a mesma equipe no mesmo
trecho, **todas as marcações são guardadas**, cada uma com o nome de quem
marcou. Elas não competem entre si; juntas, elas dizem qual foi o tempo real.

Durante a prova nada trava: a equipe avança para o próximo trecho no primeiro
toque, e os toques seguintes dos outros cronometristas entram como marcações
adicionais do mesmo trecho — não avançam nada de novo.

**No fim, a tela de Conferência** mostra, para cada equipe e cada trecho:

```
Dupla 12 · Natação
  Arthur (cel-1)   07:24:31
  Mateus (cel-2)   07:24:33      diferença: 3s
  João   (cel-3)   07:24:34
                   ┌────────────────────────────┐
  sugerido (mediana)  07:24:33   ← usar este
  média               07:24:32,7
```

Você confirma o sugerido ou toca no tempo de um cronometrista específico para
adotá-lo. O tempo escolhido entra como marcação de `ajuste` — as outras
continuam gravadas, ninguém apaga nada.

**Por que a mediana e não a média:** as duas aparecem na tela, mas o sugerido é
a mediana. Se um cronometrista se distrai e toca 30 segundos atrasado, a média
puxa o tempo de todos para longe; a mediana simplesmente ignora esse toque. Com
2 marcações as duas dão no mesmo. Com 3 ou mais, a mediana é a que aguenta o
erro humano — que é justamente o que acontece numa chegada em correria.

A tela também destaca em vermelho os trechos em que os cronometristas
discordaram muito (padrão: mais de 5s), que são os que merecem seu olho.

### 6.5 O link dos cronometristas

Você gera o link do evento e manda para quem vai ajudar. A pessoa abre, digita
o próprio nome e já cai na tela de cronometragem — **sem criar conta, sem
senha**. O nome dela fica gravado em cada marcação que fizer.

Como isso é seguro sem login: o link carrega um **código secreto do evento**, e
toda marcação entra por uma função do banco (`registrar_marcacao`, *security
definer*) que só aceita a gravação se o código conferir. Ou seja, quem tem o
link marca tempo **daquele evento e nada mais** — não apaga nada, não mexe em
outro evento, não edita cadastro. Isso tudo continua exigindo o seu login de
organizador.

Se o link vazar, você **gera um código novo** e os antigos param de funcionar.

### 6.6 A tela do cronômetro

**Regra número um: não se digita nada nesta tela.** Numa chegada de natação
podem vir quatro duplas quase juntas — não dá para procurar, digitar nome nem
escolher em menu. O único gesto é **um toque no card**.

- Cronômetro da prova rodando no topo, em horário de Brasília.
- **Um card grande por equipe**, do tamanho do polegar: dorsal bem legível,
  **quem está na prova agora**, modalidade atual, tempo decorrido correndo.
- **Um toque no card fecha o trecho atual e abre o próximo automaticamente**,
  na ordem que você configurou. Vibra, apita e o card muda de cor mostrando
  `Natação 24:31 ✓ → agora Ciclismo (Mateus)`. Se era o último trecho, marca
  **FINALIZADO** e congela o tempo total.
- **Vale igual para solo, dupla, trio.** No grupo você **não escolhe o nome**: a
  configuração do evento já disse quem faz cada modalidade, então o toque no
  card do grupo fecha o trecho do Arthur e abre o do Mateus sozinho. É isso que
  dá o tempo individual exato de cada um sem trabalho nenhum na hora da prova.
- **DESFAZER de 10 segundos** em toast grande — o toque errado é risco real, e é
  a única correção que precisa ser instantânea.
- Ordenação por **"próximo esperado a chegar"**: quem está em prova há mais
  tempo sobe para o topo, então o card que você procura tende a estar na mão.
  Filtro por modalidade para quem está cobrindo só a saída da água.
- Busca por dorsal existe, mas como **saída de emergência**, nunca no caminho
  normal — o caminho normal é achar o card e tocar.
- Rodapé: cronometristas online, itens na fila offline, estado do relógio.

## 7. Estatísticas

Com **tempo + distância** dá para calcular muita coisa. Tudo isso é gerado:

### Do atleta, num evento
- Tempo em cada modalidade e tempo total
- **Pace** (min/km) por modalidade — o número que corredor e nadador olham
- **Velocidade média** (km/h) — o número que ciclista olha
- Pace por 100 m na natação (padrão da piscina)
- % do tempo total gasto em cada modalidade
- Colocação geral, na categoria e **dentro de cada modalidade** ("3º melhor
  tempo de corrida do dia")
- Diferença para o líder e para o colocado à frente
- Comparação com o pelotão: média, mediana e **percentil** por modalidade

### Do atleta, ao longo dos eventos (histórico)
- Todos os eventos que participou, com tempo e colocação
- **Recorde pessoal** por modalidade e distância (ex: melhor pace nos 3 km)
- **Evolução do pace** por modalidade, evento a evento
- Acumulados de carreira: total de km corridos, pedalados e nadados; nº de
  eventos; pódios; vitórias
- Modalidade mais forte e mais fraca (percentil médio)
- Regularidade (desvio do pace entre eventos)

### Da dupla / trio / quarteto
- Todos os eventos em que essa formação competiu junta
- Retrospecto: melhor resultado, colocação média, aproveitamento
- Quem contribuiu com qual parte do tempo total da equipe
- Comparação entre parceiros dentro da mesma equipe
- **Melhores formações**: com quem cada atleta rende mais

### Do evento
- Classificação geral, por categoria e por formato (solo/dupla/trio)
- **Ranking por modalidade**: melhor corredor, melhor ciclista, melhor nadador
- Tempo médio, melhor e pior tempo de cada modalidade
- Taxa de conclusão (finalizados, DNF, DNS)

## 8. Exportação para Excel

Botão **"Exportar para Excel"** que gera um `.xlsx` com várias abas:

| Aba | Conteúdo |
|---|---|
| `Classificação` | posição, dorsal, equipe, categoria, tempo total, diferença |
| `Tempos por modalidade` | uma linha por equipe × modalidade: atleta, tempo, pace, velocidade, colocação no trecho |
| `Atletas` | cadastro completo |
| `Estatísticas` | os números da seção 7, por atleta |
| `Histórico` | todos os eventos anteriores do atleta |
| `Marcações (bruto)` | o log completo, com horário, aparelho e operador — a prova documental de tudo |

Também exporta **um evento só** ou **o histórico inteiro do clube**. A biblioteca
de Excel é carregada **só quando você clica** no botão, para não pesar no celular
durante a prova. CSV continua disponível como alternativa leve.

## 9. Telas

| # | Tela | Função |
|---|---|---|
| 1 | Eventos | Lista, criar novo, abrir |
| 2 | **Criar evento** | O assistente da seção 3 (modalidades, distâncias, formatos, categorias) |
| 3 | Atletas | Cadastro do clube, busca, importar lista, foto |
| 4 | Equipes | Montar solo/dupla/trio, dorsais, e o "quem faz o quê" |
| 5 | Baterias | Só se a largada for em ondas |
| 6 | Largada | Relógio de Brasília gigante, checagem de sincronia, botão **DAR LARGADA** |
| 7 | **Cronômetro** | A tela principal (6.6) |
| 8 | Conferência | Os tempos de cada cronometrista lado a lado, o sugerido pela mediana, correção manual, DNF/DNS |
| 9 | Resultados | Classificação geral/categoria/modalidade + **Exportar Excel** |
| 10 | Perfil do atleta | Histórico completo, recordes, evolução, formações |
| 11 | Estatísticas | Rankings do clube, acumulados, comparações |
| 12 | Página pública | Link para os atletas acompanharem ao vivo (fase final) |

## 10. Fases de implementação

| Fase | Entrega |
|---|---|
| 1 | Fundação: Vite + React + Supabase, schema, `localRepo`/`supabaseRepo`/fila, login |
| 2 | **Assistente de criação de evento**: modalidades livres com distância, categorias, formatos |
| 3 | Atletas e equipes: cadastro, dorsais, montagem do "quem faz o quê" |
| 4 | **Cronometragem**: sincronia de relógio, largada, tela de toque, log imutável, desfazer |
| 5 | Multi-cronometrista: Realtime, fila offline, e a **Conferência** (tempos de todos lado a lado, mediana sugerida) |
| 6 | Resultados e estatísticas do evento: classificações, pace, velocidade, percentis |
| 7 | Histórico: perfil do atleta, recordes, evolução, retrospecto das formações |
| 8 | **Exportação Excel** (multi-abas) e CSV |
| 9 | Polimento: PWA, som/vibração, tela cheia, e **simulação de um evento completo** |

A Fase 4 já entrega um sistema usável num evento real. As fases seguintes
aumentam segurança, análise e conforto.

**Recomendação:** antes do evento de verdade, rodar um evento de teste com 6-8
equipes fictícias e 2 celulares, cronometrando do início ao fim. É o que prova
que o problema do último evento foi resolvido.

## 11. Decidido

1. **Acesso dos cronometristas:** link com código do evento, sem conta (6.5).
2. **Classificação:** escolhida na criação do evento — geral, sexo, faixa etária,
   as duas, ou categorias escritas por você (passo 4).
3. **Formatos:** só os dois que o evento usa hoje — solo e grupo com cada um
   fazendo uma parte (passo 6).
4. **Supabase:** projeto novo, separado do Play de Todas, para os dados não se
   misturarem. Criado em São Paulo (`sa-east-1`) — a distância até o servidor
   entra direto na precisão da sincronia de relógio.
5. **Nada de digitar na cronometragem:** um toque no card, e só. Nem no modo
   grupo se escolhe nome — a configuração já sabe quem faz o quê (6.6).
6. **Marcações de vários cronometristas são votos, não duplicatas:** todas são
   guardadas com o nome de quem marcou, e a Conferência sugere a mediana (6.4).

## 12. Fora de escopo por enquanto

Coisas que o modelo de dados já comporta, mas que não vamos construir agora
porque o evento ainda não usa:

- **Formato "todo mundo faz tudo junto"** (a equipe inteira em todas as
  modalidades). Quando precisar, é uma opção a mais no passo 6.
- **Chegada em massa** (marcar o tempo primeiro e escolher o dorsal depois).
  Faz sentido quando várias equipes cruzam a linha juntas — o que não acontece
  no formato atual, em que só uma pessoa de cada equipe faz o trecho final.
- Identidade visual definitiva: cores e logo do Endurance Base Club.
