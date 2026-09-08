# 📌 Decisões do projeto — por que as coisas são do jeito que são

O `CLAUDE.md` diz *como o app funciona hoje*; aqui está *por que ele funciona
assim*. Serve para não refazer discussão já encerrada.

---

## O que aconteceu no último evento

A cronometragem falhou. É esse o problema que o sistema existe para resolver, e
é por isso que três coisas aqui parecem exageradas para um app pequeno: a fila
de escrita, o log append-only e a sincronia de relógio. Nenhuma delas é
sofisticação — cada uma tampa um jeito diferente de perder tempo marcado.

## O formato da prova é escrito pelo organizador, não pelo código

Não existe lista de esportes no sistema. O organizador digita "Corrida",
"Ciclismo", "Natação" — ou "Remo", ou "Trekking" — e a distância de cada uma.

A razão é prática: a alternativa era ele pedir uma alteração no código toda vez
que o evento mudasse de formato. Foi um pedido explícito, e o modelo inteiro foi
desenhado em cima dele.

**Consequência:** nada no código pode ramificar por nome de modalidade. A única
exceção é `ritmo()` em `lib/tempo.ts`, que escolhe entre min/km, min/100m e km/h
olhando o nome — e mesmo ali o padrão (min/km) funciona para qualquer coisa que
não reconheça.

## A distância é obrigatória

Sem distância o sistema só sabe dizer "24:31". Com distância ele sabe dizer
"pace de 5:12/km, seu terceiro melhor nos 3 km, 8 segundos mais rápido que em
março". Todas as estatísticas de desempenho — pace, velocidade, recorde por
distância, evolução entre eventos, percentil — dependem dela. Por isso o
assistente recusa criar o evento sem ela, em vez de aceitar zero.

## Solo e grupo não são dois códigos

A prova de uma equipe é uma lista de `Trecho`: ordem + modalidade + atleta.

- Solo com 3 modalidades: 3 trechos, todos com o mesmo atleta.
- Trio com 3 modalidades: 3 trechos, um atleta em cada.
- Dupla com 3 modalidades: 3 trechos, um dos dois repete.

Foi tentador criar `EquipeSolo` e `EquipeGrupo` com telas próprias. Não: seriam
dois cronômetros, duas classificações e dois lugares para o mesmo bug. Do jeito
atual o cronômetro não sabe se está cronometrando um solo ou um trio — ele só
fecha o trecho atual e abre o próximo.

E o formato "todo mundo faz tudo junto", que o clube ainda não usa, entra
preenchendo a mesma lista de outro jeito.

## `marcacoes` é append-only

Nada é alterado nem apagado nessa tabela. Corrigir um tempo cria uma marcação de
`ajuste` que aponta para a errada; desfazer cria uma de `desfazer`. O estado de
cada equipe é sempre recalculado da lista inteira.

Duas coisas vêm de graça com isso: é impossível perder um tempo por
sobrescrita, e depois do evento dá para responder "quem marcou isso, a que
horas, em qual celular" — que é o que faltava quando a cronometragem falhou.

O custo é que o estado nunca está pronto no banco, sempre é derivado. Vale.

## Sincronia de relógio: por que não `Date.now()`

Várias pessoas cronometram ao mesmo tempo, em celulares diferentes. O relógio de
cada aparelho pode estar alguns segundos deslocado dos outros, e o resultado
sai errado sem ninguém perceber — o pior tipo de erro.

Cada aparelho mede o próprio desvio contra o `now()` do Postgres (função
`agora()` no schema), no estilo NTP, e soma esse desvio em todo tempo gravado.

**Vence a amostra de menor ida-e-volta, não a média.** A amostra rápida é a que
menos pegou fila de rede, então é a de desvio mais confiável; média misturaria
as boas com as ruins.

## O tempo é gravado no toque, não no envio

O toque grava o horário na hora e joga a operação na fila (`data/queue.ts`); o
envio acontece quando houver rede. Sem isso, um celular sem sinal na beira da
pista atrasaria o tempo registrado — ou o perderia.

É o mesmo mecanismo do Play de Todas, que já sobreviveu a quadra sem sinal.

## O código do cronometrista fica em tabela separada

Quem vai ajudar a cronometrar recebe um link e digita só o próprio nome. Não
cria conta.

Duas alternativas foram descartadas: dar escrita ao papel `anon` abriria o banco
inteiro para qualquer visitante, e criar conta para cada voluntário é atrito
demais no dia do evento.

O que existe é uma função `security definer` (`registrar_marcacoes`) que confere
o código do evento antes de inserir — e insere **só em `marcacoes`, só naquele
evento**. Por isso o código **não pode** viver em `eventos`, que tem leitura
pública: ele mora em `eventos_codigo`, tabela que `anon` não enxerga.

## O banco fica em São Paulo, e o projeto é separado do Play de Todas

Projeto Supabase próprio (`endurance-base-club`), não o do Play de Todas: são
campeonatos diferentes, e misturar as tabelas bagunçaria os dois.

A região é **sa-east-1 (São Paulo)**, não a us-east-1 do projeto irmão. Aqui a
distância até o servidor tem efeito direto na precisão: a incerteza da sincronia
de relógio é metade da ida-e-volta, então quanto mais perto o banco, mais
confiável o horário gravado por cada celular.

Medido no primeiro teste, através de dois proxies (o pior caso possível):
ida-e-volta 442 ms, incerteza ±221 ms — já dentro do limite de 1 s que o app
exige. De um celular na rede de verdade fica bem abaixo disso.

## Dois avisos do verificador de segurança ficam de propósito

O linter do Supabase reclama que `registrar_marcacoes` é `security definer` e
pode ser chamada sem login. É exatamente o desenho: é assim que o cronometrista
convidado grava tempo sem ter conta.

O que torna isso seguro está dentro da função — ela só insere em `marcacoes`, só
do evento cujo código confere, e o `evento_id` gravado é sempre o do código,
nunca o que veio no pedido. Foi testado antes de entrar: visitante não lê
`eventos_codigo`, não insere direto em `marcacoes`, código errado é recusado,
código certo grava, e reenvio da mesma marcação não duplica o tempo.

O terceiro aviso, esse sim, foi corrigido: `agora()` estava sem `search_path`
fixo. Numa função que serve de relógio para a prova inteira, é o pior lugar
possível para uma surpresa.

## Tema claro por padrão

O app é usado na beira da pista, no sol. Tela escura no sol vira espelho e o
cronometrista erra o toque — e um toque errado no cronômetro é tempo errado. O
tema escuro continua disponível no botão, para conferir resultado em casa.

## O assistente é uma tela só, não passos separados

O plano falava em "assistente em passos". Na prática as três seções ficaram na
mesma tela rolável, numeradas como passos. No celular, rolar é mais rápido que
avançar e voltar, e permite conferir tudo antes de criar. A mesma tela serve
para editar um evento já criado, sem código duplicado.
