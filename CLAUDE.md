# Endurance Base Club — guia rápido do projeto

App de **cronometragem e resultados** dos eventos multi-modalidade do clube
(corrida, natação, ciclismo — o que o organizador escrever). Configura o evento
antes da largada, cronometra no celular com **várias pessoas ao mesmo tempo**,
e guarda o histórico de cada atleta entre os eventos.

**Antes de mexer em cronometragem, relógio ou no modelo das equipes, leia
[`DECISOES.md`](DECISOES.md)** — ele guarda o porquê das escolhas que parecem
estranhas à primeira vista. O plano completo está em
[`docs/PLANO.md`](docs/PLANO.md).

O projeto irmão é o [`play-de-todas`](https://github.com/matheuslsf13-maker/play-de-todas):
mesma stack, mesmos padrões de dados e de interface.

## Stack

React 18 + TypeScript + Vite 5. Sem router (o estado das telas fica no
`App.tsx`). PWA (manifest + service worker). Português do Brasil na interface.

## Comandos

```bash
npm run dev      # servidor local em http://localhost:5173
npm run build    # tsc -b + vite build (use antes de commitar)
npx tsc --noEmit # só a checagem de tipos
```

## Mapa do código

```
src/pages/       Eventos, FormEvento (o assistente), Evento, Equipes,
                 Cronometro (a tela mais importante), Conferencia,
                 Resultados, Atletas, Atleta (o perfil com o historico)
src/lib/         types (o modelo), prova (deriva o estado do log de marcacoes),
                 resultados (classificacao e desempenho), estatisticas
                 (historico entre eventos), tempo (pace/velocidade/formatos),
                 relogio (sincronia entre aparelhos), feedback (apito e
                 vibracao), xlsx (escritor de Excel), exportar (as abas),
                 store, tema
src/data/        armazenamento: localRepo (navegador) e supabaseRepo, com
                 fila de escrita otimista que sobrevive a refresh (queue.ts)
src/config.ts    URL e chave pública do Supabase (NUNCA a secret/service_role)
supabase/*.sql   schema, rodado no SQL Editor do Supabase
docs/PLANO.md    o plano completo do sistema, com as fases
```

`hasSupabase` decide qual driver é usado. Leitura é pública; escrita de
cadastro exige login; marcação de tempo aceita também o cronometrista
convidado pelo link.

## As regras do domínio (não invente, elas são específicas)

- **Nada de esporte é fixo no código.** O organizador escreve o nome da
  modalidade e a distância dela. "Corrida" e "Natação" são só o que ele digitou
  da última vez — não existe enum de esportes, nem deve existir.
- **A distância é obrigatória** porque é ela que separa "sei o tempo" de "sei o
  desempenho": sem distância não há pace, velocidade, recorde por distância nem
  comparação entre eventos.
- **A prova de uma equipe é uma lista de `Trecho`** (ordem + modalidade +
  atleta). Solo e grupo não são dois códigos: no solo todos os trechos têm o
  mesmo atleta, no grupo cada trecho tem o seu. Formato novo entra preenchendo
  a mesma lista de outro jeito.
- **`atletas` é do clube, não do evento.** É isso que faz existir histórico.
- **`marcacoes` é append-only.** Corrigir um tempo não altera a marcação errada:
  cria uma de `ajuste` apontando para ela. Desfazer cria uma de `desfazer`. O
  estado de cada equipe é sempre **recalculado** dessa lista. Nunca faça
  `update` nem `delete` nessa tabela.
- **Todo tempo gravado passa pelo desvio do relógio** (`lib/relogio.ts`). Nunca
  use `Date.now()` cru para marcar tempo: com três celulares cronometrando, o
  relógio de cada um está em um lugar diferente.
- **Na tela do cronômetro não se digita nada.** O único gesto é um toque no
  card. Nem no modo grupo se escolhe nome: a configuração da equipe já diz quem
  faz cada modalidade. Qualquer coisa que exija leitura, busca ou escolha no
  meio da prova é bug de projeto, não recurso.
- **Toque de outro cronometrista dentro de `JANELA_CONFIRMACAO` (45s) é voto no
  mesmo trecho, não passagem nova** (`lib/prova.ts`). Sem isso, três pessoas
  marcando a mesma chegada fariam a equipe pular três trechos.
- **Quando há mais de uma marcação no trecho, o tempo é a MEDIANA**, nunca a
  média — um toque atrasado por distração arrasta a média e não a mediana. A
  média aparece na Conferência para você comparar, e a escolha final é humana.
- **Horário é guardado em UTC e mostrado em America/Sao_Paulo.** Formatação só
  por `lib/tempo.ts`.
- **O código do link do cronometrista mora em `eventos_codigo`**, tabela que
  `anon` não lê. Ele é um segredo; `eventos` tem leitura pública.
- **Comparação entre eventos é sempre por PACE ou percentil, nunca por tempo.**
  3 km e 5 km não se comparam por tempo; e 3º entre 20 vale mais que 3º entre 4.
- **No Excel, tempo vai como TEXTO** (`1:24:31`). Duração mandada como número
  vira hora do dia na planilha do outro lado — é assim que uma planilha de prova
  chega errada sem ninguém perceber.

## Convenções

- Comentários e nomes em português, sem acento em identificadores.
- Código sem dependências novas sempre que der; o bundle é servido para
  celulares na beira da pista.
- Tema **claro por padrão**, mesmo no celular em modo escuro: tela escura no sol
  vira espelho e o cronometrista erra o toque.
- Rodar `npm run build` antes de commitar; o push na `main` publica o site.
