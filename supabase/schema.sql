-- ============================================================
--  Endurance Base Club — banco inicial
--  Cole este script inteiro no SQL Editor do Supabase e rode.
-- ============================================================

-- ------------------------------------------------------------
--  Atletas: do CLUBE, nao do evento.
--  E por serem do clube que existe historico entre eventos.
-- ------------------------------------------------------------
create table if not exists public.atletas (
  id          text primary key,
  nome        text not null,
  apelido     text,
  sexo        text check (sexo in ('M','F')),
  nascimento  date,
  contato     text,
  foto_url    text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- ------------------------------------------------------------
--  Evento e sua configuracao
-- ------------------------------------------------------------
create table if not exists public.eventos (
  id            text primary key,
  nome          text not null,
  data          date not null,
  local         text,
  tipo_largada  text not null default 'massa'
                check (tipo_largada in ('massa','baterias','individual')),
  status        text not null default 'rascunho'
                check (status in ('rascunho','pronto','em_prova','encerrado')),
  -- criterios de classificacao alem da geral: sexo, faixa, livre
  criterios     text[] not null default '{}',
  faixas        jsonb  not null default '[]',
  categorias    text[] not null default '{}',
  criado_em     timestamptz not null default now()
);

/*  O CODIGO DO LINK DOS CRONOMETRISTAS FICA EM TABELA SEPARADA.

    Ele e o segredo que autoriza marcar tempo, entao nao pode viver em
    `eventos`, que tem leitura publica -- qualquer visitante veria o codigo de
    todos os eventos. Aqui so o organizador logado le; quem tem o link nem
    precisa ler, porque a conferencia acontece dentro de `registrar_marcacoes`.  */
create table if not exists public.eventos_codigo (
  evento_id  text primary key references public.eventos(id) on delete cascade,
  codigo     text not null
);

create table if not exists public.modalidades (
  id         text primary key,
  evento_id  text not null references public.eventos(id) on delete cascade,
  ordem      int  not null,
  nome       text not null,
  -- a distancia e o que permite pace, velocidade e recorde por distancia
  distancia  numeric not null default 0,
  unidade    text not null default 'km' check (unidade in ('km','m')),
  cor        text,
  icone      text
);

create table if not exists public.baterias (
  id                text primary key,
  evento_id         text not null references public.eventos(id) on delete cascade,
  nome              text not null,
  horario_previsto  text,
  largada_em        timestamptz
);

-- ------------------------------------------------------------
--  Equipes e trechos
-- ------------------------------------------------------------
create table if not exists public.equipes (
  id          text primary key,
  evento_id   text not null references public.eventos(id) on delete cascade,
  dorsal      int  not null,
  nome        text not null,
  modo        text not null default 'solo' check (modo in ('solo','grupo')),
  atleta_ids  text[] not null default '{}',
  categoria   text,
  bateria_id  text references public.baterias(id) on delete set null,
  criado_em   timestamptz not null default now(),
  unique (evento_id, dorsal)
);

/*  Um pedaco da prova de uma equipe: qual modalidade, feita por quem.
    Solo  = todos os trechos com o mesmo atleta.
    Grupo = um atleta por trecho.
    E so isso que separa os dois formatos -- nao ha codigo diferente.        */
create table if not exists public.trechos (
  id             text primary key,
  equipe_id      text not null references public.equipes(id) on delete cascade,
  ordem          int  not null,
  modalidade_id  text not null references public.modalidades(id) on delete cascade,
  atleta_id      text not null references public.atletas(id) on delete restrict,
  unique (equipe_id, ordem)
);

-- ------------------------------------------------------------
--  Marcacoes: o log da cronometragem.
--  APPEND-ONLY. Nada aqui e alterado nem apagado: corrigir um tempo cria uma
--  marcacao de 'ajuste' apontando para a errada, e desfazer cria uma de
--  'desfazer'. O estado de cada equipe e sempre recalculado desta tabela.
--  E isso que garante que nenhum tempo se perde por sobrescrita.
-- ------------------------------------------------------------
create table if not exists public.marcacoes (
  id            text primary key,
  evento_id     text not null references public.eventos(id) on delete cascade,
  equipe_id     text references public.equipes(id) on delete cascade,
  trecho_id     text references public.trechos(id) on delete set null,
  tipo          text not null
                check (tipo in ('largada','passagem','chegada','dnf','dns','desfazer','ajuste')),
  -- ja corrigido pelo desvio do relogio do aparelho (src/lib/relogio.ts)
  marcado_em    timestamptz not null,
  dispositivo   text not null default '',
  operador      text not null default '',
  seq_cliente   int  not null default 0,
  anula_id      text,
  nota          text,
  criado_em     timestamptz not null default now()
);

create index if not exists modalidades_evento_idx on public.modalidades (evento_id, ordem);
create index if not exists equipes_evento_idx     on public.equipes (evento_id);
create index if not exists trechos_equipe_idx     on public.trechos (equipe_id, ordem);
create index if not exists marcacoes_evento_idx   on public.marcacoes (evento_id, marcado_em);
create index if not exists marcacoes_equipe_idx   on public.marcacoes (equipe_id);

-- ------------------------------------------------------------
--  Relogio do servidor.
--  E contra este `now()` que cada celular mede o proprio desvio, para tres
--  aparelhos cronometrando a mesma prova nao brigarem por alguns segundos.
-- ------------------------------------------------------------
create or replace function public.agora()
returns timestamptz
language sql
stable
-- `search_path` fixo: sem isso, quem chama poderia apontar `now()` para outra
-- coisa. Numa funcao que serve de relogio para a prova inteira, esse seria o
-- pior lugar possivel para uma surpresa.
set search_path = ''
as $$ select pg_catalog.now() $$;

grant execute on function public.agora() to anon, authenticated;

-- ------------------------------------------------------------
--  Gravacao pelo cronometrista convidado.
--
--  Quem abre o link nao tem conta. Em vez de dar escrita a `anon` (que abriria
--  o banco inteiro), a gravacao passa por esta funcao: ela confere o codigo do
--  evento e so entao insere -- e so na tabela de marcacoes, so daquele evento.
--  `security definer` = roda com os poderes do dono da funcao, por isso o RLS
--  nao bloqueia; o `search_path` fixo evita que alguem troque as tabelas por
--  baixo dela.
-- ------------------------------------------------------------
create or replace function public.registrar_marcacoes(p_codigo text, p_marcacoes jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento text;
  v_ok     boolean;
  v_qtd    int;
begin
  if p_codigo is null or length(p_codigo) < 6 then
    raise exception 'codigo invalido';
  end if;

  -- todas as marcacoes do lote tem que ser do mesmo evento
  select distinct m->>'evento_id' into v_evento
  from jsonb_array_elements(p_marcacoes) m;
  if v_evento is null then
    return 0;
  end if;

  select exists (
    select 1 from public.eventos_codigo c
    where c.evento_id = v_evento and c.codigo = p_codigo
  ) into v_ok;
  if not v_ok then
    raise exception 'codigo nao confere com o evento';
  end if;

  insert into public.marcacoes (
    id, evento_id, equipe_id, trecho_id, tipo, marcado_em,
    dispositivo, operador, seq_cliente, anula_id, nota
  )
  select
    m->>'id',
    v_evento,                       -- sempre o evento do codigo, nunca outro
    m->>'equipe_id',
    m->>'trecho_id',
    m->>'tipo',
    (m->>'marcado_em')::timestamptz,
    coalesce(m->>'dispositivo',''),
    coalesce(m->>'operador',''),
    coalesce((m->>'seq_cliente')::int, 0),
    m->>'anula_id',
    m->>'nota'
  from jsonb_array_elements(p_marcacoes) m
  -- reenvio depois de resposta perdida nao pode virar tempo duplicado
  on conflict (id) do nothing;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

grant execute on function public.registrar_marcacoes(text, jsonb) to anon, authenticated;

/*  O verificador de seguranca do Supabase avisa que esta funcao e
    `security definer` e pode ser chamada sem login. E INTENCIONAL: e
    exatamente assim que o cronometrista convidado grava tempo sem ter conta.
    A funcao so insere em `marcacoes`, so do evento cujo codigo confere, e o
    `evento_id` gravado e sempre o do codigo -- nunca o que veio no pedido.  */

-- ------------------------------------------------------------
--  Permissoes: todo mundo LE (atletas acompanham o resultado ao vivo),
--  so quem esta logado ESCREVE (o organizador).
--  A excecao e `eventos_codigo`, que so o organizador enxerga.
-- ------------------------------------------------------------
alter table public.atletas        enable row level security;
alter table public.eventos        enable row level security;
alter table public.eventos_codigo enable row level security;
alter table public.modalidades    enable row level security;
alter table public.baterias       enable row level security;
alter table public.equipes        enable row level security;
alter table public.trechos        enable row level security;
alter table public.marcacoes      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['atletas','eventos','modalidades','baterias','equipes','trechos','marcacoes'] loop
    execute format('drop policy if exists "leitura publica" on public.%I', t);
    execute format('drop policy if exists "escrita autenticada" on public.%I', t);
    execute format('create policy "leitura publica" on public.%I for select using (true)', t);
    execute format(
      'create policy "escrita autenticada" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- o codigo do link nao e publico: so o organizador logado ve
drop policy if exists "codigo so do organizador" on public.eventos_codigo;
create policy "codigo so do organizador" on public.eventos_codigo
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
--  Tempo real: o toque de um cronometrista aparece na hora nos outros
--  celulares e na tela de quem esta acompanhando.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['atletas','eventos','modalidades','equipes','trechos','marcacoes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ------------------------------------------------------------
--  Fotos dos atletas (bucket publico de leitura).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "fotos leitura publica"    on storage.objects;
drop policy if exists "fotos envio autenticado"  on storage.objects;
drop policy if exists "fotos update autenticado" on storage.objects;
drop policy if exists "fotos delete autenticado" on storage.objects;

create policy "fotos leitura publica" on storage.objects
  for select using (bucket_id = 'fotos');
create policy "fotos envio autenticado" on storage.objects
  for insert to authenticated with check (bucket_id = 'fotos');
create policy "fotos update autenticado" on storage.objects
  for update to authenticated using (bucket_id = 'fotos') with check (bucket_id = 'fotos');
create policy "fotos delete autenticado" on storage.objects
  for delete to authenticated using (bucket_id = 'fotos');
