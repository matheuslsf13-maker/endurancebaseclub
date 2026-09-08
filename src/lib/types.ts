/**
 * Tipos do sistema de cronometragem do Endurance Base Club.
 *
 * Duas ideias organizam tudo aqui:
 *
 * 1. **O atleta e do clube, nao do evento.** Por isso `Atleta` nao tem
 *    `evento_id`: e o mesmo registro que atravessa todos os eventos, e e dele
 *    que sai o historico e a evolucao de cada um.
 *
 * 2. **A prova de uma equipe e uma lista de trechos.** Solo e grupo nao sao
 *    dois codigos diferentes: sao duas formas de preencher `Trecho[]`. No solo
 *    todos os trechos tem o mesmo atleta; no grupo, cada trecho tem o seu.
 */

// ------------------------------------------------------------------
//  Atleta
// ------------------------------------------------------------------

export type Sexo = 'M' | 'F'

export type Atleta = {
  id: string
  /** Nome de cadastro, completo -- serve para nao confundir dois Mateus. */
  nome: string
  /** Como ele aparece na prova. Vazio quer dizer "usa o nome do cadastro". */
  apelido?: string | null
  /** Alimenta a classificacao por sexo. Vazio = fica so na geral. */
  sexo?: Sexo | null
  /** YYYY-MM-DD. Alimenta a classificacao por faixa etaria. */
  nascimento?: string | null
  contato?: string | null
  foto_url?: string | null
  ativo: boolean
  criado_em: string
}

// ------------------------------------------------------------------
//  Evento
// ------------------------------------------------------------------

/**
 * Como a prova comeca:
 *  - 'massa'      : um botao larga todo mundo ao mesmo tempo;
 *  - 'baterias'   : grupos largam em horarios diferentes;
 *  - 'individual' : cada equipe larga no seu horario.
 */
export type TipoLargada = 'massa' | 'baterias' | 'individual'

/**
 * Criterios de classificacao alem da geral, escolhidos ao criar o evento.
 * A classificacao geral existe sempre; estes criterios geram as separadas.
 */
export type Criterio = 'sexo' | 'faixa' | 'livre'

/** Faixa etaria escrita pelo organizador. `ate: null` = "e acima" (ex: 40+). */
export type Faixa = {
  nome: string
  de: number
  ate: number | null
}

export type StatusEvento = 'rascunho' | 'pronto' | 'em_prova' | 'encerrado'

export type Evento = {
  id: string
  nome: string
  data: string // YYYY-MM-DD
  local?: string | null
  tipo_largada: TipoLargada
  status: StatusEvento
  /**
   * Segredo do link dos cronometristas. Quem tem o codigo pode registrar
   * marcacao DESTE evento e nada mais (ver `registrar_marcacao` no schema).
   * Gerando um codigo novo, os links antigos param de valer.
   */
  codigo: string
  criterios: Criterio[]
  /** Usado quando `criterios` inclui 'faixa'. */
  faixas: Faixa[]
  /** Usado quando `criterios` inclui 'livre': Iniciante, Master, Elite... */
  categorias: string[]
  criado_em: string
}

// ------------------------------------------------------------------
//  Modalidade (a "prova" dentro do evento)
// ------------------------------------------------------------------

/**
 * Natacao costuma ser medida em metros e corrida em quilometros. Guardar a
 * unidade evita o organizador ter que converter 400 m para 0,4 km na mao.
 */
export type Unidade = 'km' | 'm'

export type Modalidade = {
  id: string
  evento_id: string
  /** 1, 2, 3... e a ordem em que as modalidades sao feitas. */
  ordem: number
  /** Escrito pelo organizador: Corrida, Ciclismo, Natacao, Remo... */
  nome: string
  /**
   * A distancia e o que separa "sei o tempo" de "sei o desempenho": sem ela
   * nao ha pace, velocidade, recorde por distancia nem comparacao entre
   * eventos.
   */
  distancia: number
  unidade: Unidade
  cor?: string | null
  icone?: string | null
}

/** Distancia sempre em km, para as contas de pace e velocidade. */
export function emKm(m: Pick<Modalidade, 'distancia' | 'unidade'>): number {
  return m.unidade === 'm' ? m.distancia / 1000 : m.distancia
}

/** Como a distancia aparece na tela: "3 km", "400 m". */
export function distanciaLabel(m: Pick<Modalidade, 'distancia' | 'unidade'>): string {
  return `${numeroBR(m.distancia)} ${m.unidade}`
}

// ------------------------------------------------------------------
//  Equipe e trechos
// ------------------------------------------------------------------

/**
 * Os dois formatos que o evento usa hoje:
 *  - 'solo'  : uma pessoa faz todas as modalidades;
 *  - 'grupo' : dupla/trio/quarteto em que cada um faz uma parte.
 *
 * O formato "a equipe inteira faz tudo junta" ainda nao existe -- e quando
 * existir entra aqui como mais um valor, sem mexer no resto (ver docs/PLANO.md).
 */
export type ModoEquipe = 'solo' | 'grupo'

export type Equipe = {
  id: string
  evento_id: string
  /** Numero de peito. Unico dentro do evento. */
  dorsal: number
  nome: string
  modo: ModoEquipe
  /** Quem esta na equipe. No solo, um id so. */
  atleta_ids: string[]
  /** Preenchido quando o evento classifica por categoria escrita a mao. */
  categoria?: string | null
  bateria_id?: string | null
  criado_em: string
}

/**
 * Um pedaco da prova de uma equipe: qual modalidade, feita por quem.
 *
 * Solo com 3 modalidades  -> 3 trechos, todos com o mesmo `atleta_id`.
 * Trio com 3 modalidades  -> 3 trechos, um atleta em cada.
 * Dupla com 3 modalidades -> 3 trechos, um dos dois repete em duas.
 */
export type Trecho = {
  id: string
  equipe_id: string
  ordem: number
  modalidade_id: string
  atleta_id: string
}

export type Bateria = {
  id: string
  evento_id: string
  nome: string
  /** HH:MM previsto na programacao. So informativo. */
  horario_previsto?: string | null
  /** Quando a largada foi realmente dada. Null = ainda nao largou. */
  largada_em?: string | null
}

// ------------------------------------------------------------------
//  Marcacoes (o log da cronometragem)
// ------------------------------------------------------------------

/**
 * O que aconteceu:
 *  - 'largada'  : a prova comecou (equipe_id null = largada em massa);
 *  - 'passagem' : uma equipe terminou um trecho e comecou o proximo;
 *  - 'chegada'  : terminou o ultimo trecho;
 *  - 'dnf'      : abandonou; 'dns': nao largou;
 *  - 'desfazer' : anula uma marcacao anterior (`anula_id`);
 *  - 'ajuste'   : corrige o horario de uma marcacao anterior (`anula_id`).
 */
export type TipoMarcacao =
  | 'largada'
  | 'passagem'
  | 'chegada'
  | 'dnf'
  | 'dns'
  | 'desfazer'
  | 'ajuste'

/**
 * NADA AQUI E APAGADO OU SOBRESCRITO.
 *
 * Corrigir um tempo nao altera a marcacao errada: cria uma de 'ajuste' que
 * aponta para ela. Desfazer cria uma de 'desfazer'. O estado de cada equipe e
 * SEMPRE recalculado a partir desta lista.
 *
 * E isso que garante que nenhum tempo se perde por sobrescrita, e que da para
 * responder depois do evento "quem marcou isso, a que horas, em qual celular".
 */
export type Marcacao = {
  id: string
  evento_id: string
  /** Null na largada em massa (vale para o evento inteiro). */
  equipe_id: string | null
  /** Qual trecho foi FECHADO por esta marcacao. Null na largada. */
  trecho_id: string | null
  tipo: TipoMarcacao
  /**
   * O instante do toque, ja corrigido pelo desvio do relogio do aparelho
   * (ver lib/relogio.ts). ISO em UTC; a tela mostra em horario de Brasilia.
   */
  marcado_em: string
  /** Id do aparelho que marcou, para achar relogio torto depois do evento. */
  dispositivo: string
  /** Nome que o cronometrista digitou ao abrir o link. */
  operador: string
  /** Ordem do clique dentro do aparelho: desempata toques no mesmo instante. */
  seq_cliente: number
  /** Em 'desfazer' e 'ajuste': a marcacao que esta sendo anulada/corrigida. */
  anula_id?: string | null
  nota?: string | null
  criado_em: string
}

// ------------------------------------------------------------------
//  Estado da aplicacao
// ------------------------------------------------------------------

export type AppData = {
  atletas: Atleta[]
  eventos: Evento[]
  modalidades: Modalidade[]
  equipes: Equipe[]
  trechos: Trecho[]
  baterias: Bateria[]
  marcacoes: Marcacao[]
}

export const emptyData = (): AppData => ({
  atletas: [],
  eventos: [],
  modalidades: [],
  equipes: [],
  trechos: [],
  baterias: [],
  marcacoes: [],
})

// ------------------------------------------------------------------
//  Utilidades
// ------------------------------------------------------------------

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Codigo do link dos cronometristas: curto de digitar, dificil de adivinhar. */
export function novoCodigo(): string {
  // sem 0/O e 1/I: sao os que a pessoa erra ao digitar do print no WhatsApp
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  const bytes = new Uint8Array(8)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  for (const b of bytes) s += alfabeto[b % alfabeto.length]
  return s
}

export function hojeISO(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

export function dataLabel(dataISO: string): string {
  const [y, m, d] = dataISO.split('-')
  return `${d}/${m}/${y}`
}

/** Numero no formato do Brasil, sem zeros a toa: 3 · 2,5 · 0,4 */
export function numeroBR(n: number, casas = 2): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas })
}

/** Idade em anos completos na data do evento (nao no dia de hoje). */
export function idadeNa(nascimento: string | null | undefined, dataISO: string): number | null {
  if (!nascimento) return null
  const [ny, nm, nd] = nascimento.split('-').map(Number)
  const [ey, em, ed] = dataISO.split('-').map(Number)
  if (!ny || !ey) return null
  let idade = ey - ny
  if (em < nm || (em === nm && ed < nd)) idade--
  return idade
}
