# Endurance Base Club — Sistema de Cronometragem

Planejamento do sistema de organização e cronometragem de eventos multi-modalidade
(corrida + natação hoje, extensível para outras provas).

---

## 1. O problema a resolver

No último evento a cronometragem falhou. O sistema precisa garantir três coisas,
nessa ordem de prioridade:

1. **Nunca perder um tempo marcado.** Nem por internet caindo, nem por celular
   travando, nem por clique errado.
2. **Marcar o tempo exato do clique**, no horário de Brasília, mesmo que o envio
   para o servidor demore.
3. **Ser rápido de operar no meio do evento**: um toque no nome da pessoa fecha o
   trecho atual e já começa o próximo.

## 2. Como o sistema funciona (visão do organizador)

1. Você cria o evento: nome, data, e as modalidades **em ordem** (1º Corrida,
   2º Natação). O tipo de largada também é escolhido aqui.
2. Cadastra os atletas e monta as inscrições: **individual** ou **dupla**.
3. Para cada inscrição você define a sequência de trechos — qual modalidade e
   **qual atleta faz cada uma**.
4. No dia: aperta **DAR LARGADA**. O sistema grava o horário de Brasília naquele
   instante e o cronômetro começa a correr na tela.
5. Cada vez que alguém termina um trecho, você (ou qualquer cronometrista da
   equipe) **toca no card daquela pessoa/dupla**. O sistema:
   - grava o horário exato do toque,
   - fecha o trecho atual (ex: Corrida 24:31),
   - abre automaticamente o próximo (ex: Natação, agora com o Mateus),
   - se era o último trecho, marca **FINALIZADO** e congela o tempo total.
6. No fim: classificação pronta, com tempo por trecho e tempo total, exportável.

## 3. Decisões já fechadas

| Tema | Decisão |
|---|---|
| Formato de dupla | **Configurável por evento e por inscrição.** O sistema não força um formato — você monta a sequência de trechos livremente. |
| Largada | **Configurável na criação do evento:** em massa, em baterias/ondas, ou individual. |
| Onde roda | **App web (PWA)** que abre no celular e no PC, instalável como app. |
| Multi-cronometrista | **Sim.** Várias pessoas marcam ao mesmo tempo, em dispositivos diferentes, tudo sincronizado ao vivo. |

## 4. Arquitetura

- **Front-end:** Next.js (App Router) + TypeScript + Tailwind, configurado como
  PWA (instala na tela inicial, abre em tela cheia, funciona offline).
- **Back-end/banco:** Supabase — Postgres + Auth + **Realtime** (é o Realtime que
  faz o clique de um celular aparecer instantaneamente nos outros).
- **Deploy:** Vercel.

### 4.1 Sincronização de relógio entre dispositivos (crítico)

Se três pessoas marcam tempo em três celulares, os relógios dos aparelhos podem
divergir vários segundos entre si — e aí o resultado sai errado.

Solução: ao abrir a tela de cronometragem, cada dispositivo mede seu **desvio em
relação ao relógio do servidor** (várias amostras de ida-e-volta, usa a de menor
latência — mesma ideia do NTP). Todo tempo gravado é
`relógio do aparelho + desvio medido`. A tela mostra um selo
`Relógio sincronizado ±0,2s`; se o desvio estiver alto ou não sincronizar, aparece
aviso vermelho **antes** da largada, não depois.

Horário é sempre exibido em **America/Sao_Paulo (Brasília)** e armazenado em UTC
no banco — isso resolve horário de verão e evita ambiguidade.

### 4.2 Funcionamento offline

O toque grava o tempo **no momento do toque**, direto no armazenamento local do
aparelho (IndexedDB), e só depois tenta enviar. Se a internet cair:

- a cronometragem continua funcionando normalmente;
- os eventos ficam numa fila local;
- quando a conexão volta, a fila sobe sozinha, com os horários originais preservados.

Atraso de rede nunca contamina o tempo registrado.

### 4.3 Registro imutável (append-only)

O coração do sistema é um **log de eventos que nunca é apagado**:
largada, cada split, DNF, correção manual, desfazer — tudo vira uma linha nova.
O estado atual de cada equipe (em que trecho está, tempo acumulado) é **derivado**
desse log.

Consequência prática: é impossível "perder" um evento por sobrescrita, e qualquer
erro é auditável e reversível. Correção manual não apaga nada — entra como um
evento de ajuste, com registro de quem ajustou e quando.

### 4.4 Cliques duplicados entre cronometristas

Se duas pessoas marcam o mesmo atleta com poucos segundos de diferença, o sistema
**mantém o primeiro toque** (menor horário capturado) e sinaliza os demais como
duplicados para revisão. Não avança dois trechos de uma vez. A janela de detecção
é configurável (padrão: 15s).

## 5. Modelo de dados

```
events           id, nome, data, local, timezone, start_mode (massa|baterias|individual), status
event_segments   id, event_id, ordem, nome ("Corrida"/"Natação"), distancia, cor, icone
waves            id, event_id, nome, horario_previsto, started_at        -- baterias
athletes         id, nome, apelido, sexo, nascimento, contato            -- cadastro do clube
teams            id, event_id, dorsal, nome, tipo (individual|dupla), categoria, wave_id
team_legs        id, team_id, ordem, segment_id, athlete_id              -- ⭐ a flexibilidade mora aqui
timing_events    id, event_id, team_id, leg_id, tipo (start|split|finish|dnf|dns|adjust|undo),
                 captured_at (timestamptz, já corrigido), device_id, operator, client_seq, nota
```

**`team_legs` é o que torna tudo configurável.** Exemplos com o mesmo modelo:

- *Individual:* leg 1 = Corrida/Mateus, leg 2 = Natação/Mateus.
- *Dupla, revezamento por prova:* leg 1 = Corrida/Arthur, leg 2 = Natação/Mateus.
- *Dupla, revezamento por volta:* leg 1 = Corrida/Arthur, leg 2 = Natação/Arthur,
  leg 3 = Corrida/Mateus, leg 4 = Natação/Mateus.
- *Dupla junta:* legs com os dois atletas vinculados, um clique só.

Nenhum código muda entre esses casos — só a configuração da inscrição.

## 6. Telas

| # | Tela | Função |
|---|---|---|
| 1 | Login / eventos | Entrar e escolher o evento |
| 2 | Criar evento | Wizard: dados, modalidades em ordem, tipo de largada, categorias |
| 3 | Atletas | Cadastro rápido (nome + dorsal), busca, importar CSV |
| 4 | Inscrições | Montar individual ou dupla e ordenar os trechos (quem faz o quê) |
| 5 | Baterias | Só se a largada for em ondas |
| 6 | Largada | Relógio de Brasília gigante + botão **DAR LARGADA** + checagem de sincronia |
| 7 | **Cronômetro** | Tela principal — detalhada abaixo |
| 8 | Revisão | Conferir marcações, corrigir horário, resolver duplicados, DNF/DNS |
| 9 | Resultados | Classificação geral e por categoria, tempo por trecho, exportar CSV/PDF |
| 10 | Página pública | Link para atletas acompanharem ao vivo (opcional, fase final) |

### Tela do cronômetro (a mais importante)

- Cronômetro da prova rodando no topo, em horário de Brasília.
- Um **card grande por equipe**, mostrando: dorsal, **nome de quem está na prova
  agora**, modalidade atual com ícone, e o tempo decorrido correndo ao vivo.
- **Um toque no card = marca o split.** Confirmação por vibração + som + o card
  muda de cor e mostra `Corrida 24:31 ✓ → agora Natação (Mateus)`.
- **DESFAZER de 10 segundos** em toast grande, para o clique errado — foi um dos
  riscos reais do evento passado.
- Busca por dorsal/nome e filtros (só corrida, só natação, já finalizados).
- Cards ordenados por "próximo esperado a chegar", para reduzir procura.
- Rodapé com: cronometristas online, itens na fila offline, status do relógio.

## 7. Fases de implementação

| Fase | Entrega | Resultado |
|---|---|---|
| 1 | Fundação | Projeto Next.js + Supabase, schema, login, criação de evento com modalidades e tipo de largada |
| 2 | Cadastro | Atletas, inscrições individual/dupla, montagem de trechos, dorsais |
| 3 | **Cronometragem** | Sincronia de relógio, largada, tela de toque, log append-only, desfazer |
| 4 | Multi-dispositivo | Realtime entre cronometristas, fila offline, deduplicação |
| 5 | Resultados | Cálculo, classificação, correção manual, exportação CSV/PDF |
| 6 | Polimento | PWA instalável, som/vibração, tela cheia, **simulação de evento completo** |

A Fase 3 já entrega um sistema utilizável num evento real. As fases 4-6 aumentam
segurança e conforto.

**Recomendação:** antes do evento de verdade, rodar um "evento de teste" com 6-8
inscrições fictícias e 2 celulares, cronometrando de mentira do início ao fim.
É o que valida se o problema do último evento realmente foi resolvido.

## 8. Pontos em aberto

1. **Login dos cronometristas:** proposta simples — o organizador gera um
   *código do evento*; o cronometrista abre o link, digita o código e o próprio
   nome. Sem criar conta. (Só o organizador tem login de verdade.)
2. **Categorias/premiação:** classificar por sexo, faixa etária, ou só geral?
3. **Chegada em massa:** se várias duplas chegarem juntas, vale ter um modo
   "fila de chegada" (registra o tempo primeiro, atribui o dorsal depois)?
4. Nome/identidade visual do app (cores, logo do Endurance Base Club).
