# Endurance Base Club

Sistema de **cronometragem, resultados e histórico** dos eventos do clube:
corrida, natação, ciclismo — as modalidades e distâncias são escritas por quem
organiza, não fixadas no código.

- **Configura o evento antes da largada:** modalidades em ordem, distância de
  cada uma, formato (solo ou grupo com cada um fazendo uma parte) e como
  classificar.
- **Cronometra no celular**, com várias pessoas marcando ao mesmo tempo, no
  horário de Brasília, e sem parar quando cai a internet.
- **Guarda o histórico** de cada atleta e de cada formação entre os eventos, com
  pace, velocidade, recordes e evolução.

## Como rodar

```bash
npm install
npm run dev
```

O app já vem apontado para o projeto Supabase do clube
(`endurance-base-club`, região São Paulo), então abre no modo online direto.

Para rodar sem banco nenhum — só neste navegador, útil para testar — esvazie as
duas constantes de `src/config.ts`.

### Falta um passo para poder organizar

Ler o site é público; **escrever cadastro exige login**. Enquanto não existir um
usuário, o app abre em modo "Acompanhando" e não deixa criar evento.

Crie o seu login no painel do Supabase:
**Authentication → Users → Add user** (e-mail e senha, marcando *Auto Confirm
User*). Depois é só entrar no app com ele.

Quem vai ajudar a cronometrar **não** precisa de login: recebe o link do evento,
digita o próprio nome e pronto.

### Se precisar recriar o banco do zero

Rode `supabase/schema.sql` inteiro no SQL Editor do Supabase e preencha
`src/config.ts` (ou `.env`, a partir de `.env.example`) com a URL e a chave
*publishable* do projeto.

## Documentação

- [`docs/PLANO.md`](docs/PLANO.md) — o plano completo do sistema e as fases
- [`CLAUDE.md`](CLAUDE.md) — como o app funciona hoje
- [`DECISOES.md`](DECISOES.md) — por que ele funciona assim
