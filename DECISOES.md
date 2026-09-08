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

## Nada de digitar no cronômetro

Numa chegada de natação podem vir quatro duplas quase juntas. Não existe tempo
para procurar numa lista, digitar nome nem escolher em menu — o gesto tem que
ser um só: **tocar no card**.

Isso decidiu o desenho de duas telas, não de uma. É porque a montagem das
equipes já diz **quem faz cada modalidade** que o cronômetro pode ser burro: o
toque fecha o trecho de quem estava nele e abre o do próximo sem perguntar
nada. É daí que sai o tempo individual exato de cada um do grupo, sem trabalho
nenhum na hora da prova.

Busca por nome existe na tela, mas como saída de emergência, e só aparece com
mais de 8 equipes. O caminho normal é achar o card e tocar.

## Vários cronometristas: os toques são votos, não duplicatas

A primeira versão do plano dizia "vence o primeiro toque, os outros são
duplicados". Estava errado — jogava fora justamente o que ter três pessoas
cronometrando produz de mais valioso.

Hoje **todas as marcações são guardadas**, cada uma com o nome de quem marcou.
Na Conferência elas aparecem lado a lado e o tempo final é escolhido.

### A janela de 45 segundos

Se cada toque avançasse um trecho, o terceiro cronometrista a reagir teria
"terminado" a prova de uma equipe que acabou de sair da água. Então, por 45
segundos depois de uma passagem, o toque conta como **outra marcação do mesmo
trecho**.

45s é folgado para o segundo e o terceiro reagirem, e curto o bastante para
nunca alcançar o fim do trecho seguinte, que numa prova dura minutos. O card
diz na cara o que o próximo toque vai fazer (`Corrida 24:31 ✓ — toque para
confirmar (32s)`), para não virar adivinhação.

### O card em confirmação sobe para o topo

Descoberto testando: sem isso, o card que você acabou de tocar sai debaixo do
seu dedo, porque a ordenação "quem está em prova há mais tempo primeiro" o
empurra para baixo. Duas consequências ruins — os outros cronometristas não
acham o card para confirmar, e o próximo toque de quem já tocou cai no card
errado. Quem está na janela de confirmação fica acima de todos.

### Mediana, não média

As duas aparecem na Conferência, mas a **sugerida é a mediana**. Se alguém se
distrai e toca 30 segundos atrasado, a média puxa o tempo de todos para longe;
a mediana ignora esse toque. Com duas marcações as duas contas dão no mesmo — a
diferença aparece exatamente quando há um toque torto no meio, que é o caso que
importa proteger.

E a decisão final é humana: dá para adotar o tempo de um cronometrista
específico. O que for escolhido entra como marcação de `ajuste`; as outras
continuam gravadas.

## O Excel é escrito à mão, sem biblioteca

Um `.xlsx` é um ZIP com alguns XML dentro. As bibliotecas prontas pesam algumas
centenas de KB — caro num app que é aberto no celular na beira da pista, para
uma função que só roda depois da prova.

`src/lib/xlsx.ts` escreve o mínimo que o Excel, o LibreOffice e o Google
Planilhas abrem: ZIP sem compressão (o método "store", que o formato aceita e
dispensa implementar deflate) e planilhas com texto em linha, sem tabela de
strings compartilhadas nem estilos. Dá ~200 linhas e zero dependência.

O arquivo gerado foi conferido abrindo com o SheetJS — as sete abas, os
cabeçalhos e os valores chegaram certos do outro lado.

**Tempo vai como texto** (`1:24:31`), nunca como número. Duração mandada como
número vira hora do dia na planilha de quem recebe, e é assim que uma planilha
de prova chega errada sem ninguém perceber.

## Comparar eventos: pace e percentil, nunca tempo

"Melhor tempo de corrida" não quer dizer nada se num evento foram 3 km e no
outro 8. Por isso:

- o **recorde pessoal** é por modalidade **e distância** (`Corrida 3 km`);
- a **evolução** entre eventos é medida em pace, não em tempo;
- o **percentil** compara desempenho entre provas de tamanhos diferentes —
  3º entre 20 vale mais que 3º entre 4.

Nada disso existiria sem a distância obrigatória lá na criação do evento. É o
mesmo campo pagando de novo.

## Faixa etária de um grupo: a regra é literal

Sexo de um grupo tem convenção: gente de sexos diferentes é "Misto", e ponto.

Faixa etária não tem. A do mais velho? A média? A do primeiro? Escolher uma
seria decidir premiação no lugar do organizador. Então a regra aqui é literal:
o grupo só entra numa faixa se **todo mundo dele** estiver nela; senão fica em
"Faixa mista" e disputa a geral.

## Quem já marcou não fica preso na janela de confirmação

A janela de 45s existe para o toque do SEGUNDO cronometrista virar confirmação
em vez de passagem nova. Mas aplicá-la a quem já marcou travava a prova: o
cronometrista ficava 45 segundos sem conseguir fechar o trecho seguinte.

Hoje a janela vale só para quem ainda não votou naquele trecho. Quem já votou
tem o próximo toque tratado normalmente — seu voto já está dado.

## Tema claro por padrão

O app é usado na beira da pista, no sol. Tela escura no sol vira espelho e o
cronometrista erra o toque — e um toque errado no cronômetro é tempo errado. O
tema escuro continua disponível no botão, para conferir resultado em casa.

## O assistente é uma tela só, não passos separados

O plano falava em "assistente em passos". Na prática as três seções ficaram na
mesma tela rolável, numeradas como passos. No celular, rolar é mais rápido que
avançar e voltar, e permite conferir tudo antes de criar. A mesma tela serve
para editar um evento já criado, sem código duplicado.
