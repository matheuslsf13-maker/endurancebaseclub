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

Sem configurar o Supabase o app roda em **modo local** (dados só no navegador),
o que já serve para testar tudo.

Para usar de verdade, com vários celulares: crie um projeto no
[Supabase](https://supabase.com), rode `supabase/schema.sql` no SQL Editor e
preencha `.env` a partir de `.env.example`.

## Documentação

- [`docs/PLANO.md`](docs/PLANO.md) — o plano completo do sistema e as fases
- [`CLAUDE.md`](CLAUDE.md) — como o app funciona hoje
- [`DECISOES.md`](DECISOES.md) — por que ele funciona assim
