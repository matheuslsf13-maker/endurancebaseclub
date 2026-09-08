import type {
  Equipe, Evento, Marcacao, Modalidade, Trecho,
} from './types'

/**
 * O ESTADO DA PROVA E CALCULADO, NUNCA GUARDADO.
 *
 * `marcacoes` e um log append-only: cada toque, cada desfazer e cada correcao
 * entram como linha nova. Este modulo le esse log e responde as perguntas que a
 * tela faz -- em que trecho cada equipe esta, quanto tempo levou em cada um,
 * quem fez o que, qual o tempo total.
 *
 * A vantagem de derivar em vez de guardar: nao existe estado "meio gravado".
 * Se a fila subir fora de ordem, se dois cronometristas marcarem quase juntos,
 * se alguem desfizer depois -- o resultado e sempre o mesmo, porque so depende
 * do conjunto de marcacoes, nao da ordem em que elas chegaram.
 */

// ------------------------------------------------------------------
//  Mediana: como varios cronometristas viram um tempo so
// ------------------------------------------------------------------

/**
 * O tempo adotado quando mais de uma pessoa marcou a mesma passagem.
 *
 * MEDIANA, nao media. Se um cronometrista se distrai e toca 30 segundos
 * atrasado, a media puxa o tempo de todo mundo para longe; a mediana ignora
 * esse toque. Com duas marcacoes as duas contas dao no mesmo -- a diferenca
 * aparece justamente quando ha uma marcacao torta no meio, que e o caso que
 * importa proteger.
 *
 * A media continua sendo calculada e mostrada na tela de Conferencia, para a
 * decisao ser sua e nao do algoritmo.
 */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const v = valores.slice().sort((a, b) => a - b)
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio] : Math.round((v[meio - 1] + v[meio]) / 2)
}

export function media(valores: number[]): number | null {
  if (valores.length === 0) return null
  return Math.round(valores.reduce((s, x) => s + x, 0) / valores.length)
}

/** Distancia entre o primeiro e o ultimo toque: o quanto eles discordaram. */
export function espalhamento(valores: number[]): number {
  if (valores.length < 2) return 0
  return Math.max(...valores) - Math.min(...valores)
}

/** Acima disso, a Conferencia pinta o trecho de vermelho: vale seu olho. */
export const DISCORDANCIA_ALTA = 5000

/**
 * Por quanto tempo, depois de uma passagem, o toque de OUTRO cronometrista
 * conta como uma segunda marcacao do MESMO trecho em vez de fechar o proximo.
 *
 * Sem essa janela, tres pessoas marcando a mesma chegada fariam a equipe pular
 * tres trechos de uma vez. Com ela, os toques viram votos sobre o mesmo
 * momento -- que e o que a Conferencia usa depois.
 *
 * 45 segundos: folgado para o segundo e o terceiro cronometrista reagirem, e
 * curto o bastante para nunca alcançar o fim do trecho seguinte, que numa prova
 * dura minutos.
 */
export const JANELA_CONFIRMACAO = 45000

/**
 * Esta equipe acabou de passar e ainda esta aceitando confirmacao?
 *
 * Nao filtra por aparelho de proposito: a ordenacao dos cards precisa manter a
 * equipe no topo enquanto QUALQUER cronometrista ainda puder confirmar. Quem
 * decide se o toque daquele aparelho vale como confirmacao e a tela, que sabe
 * quem ja marcou.
 */
export function confirmando(e: EstadoEquipe, agora: number): EstadoTrecho | null {
  const anterior =
    e.atual > 0
      ? e.trechos[e.atual - 1]
      : e.status === 'finalizado'
        ? e.trechos[e.trechos.length - 1]
        : null
  if (!anterior?.fechadoEm) return null
  return agora - anterior.fechadoEm < JANELA_CONFIRMACAO ? anterior : null
}

// ------------------------------------------------------------------
//  Estado derivado
// ------------------------------------------------------------------

export type EstadoTrecho = {
  trecho: Trecho
  modalidade: Modalidade
  /** Todas as marcacoes validas que fecham este trecho, de todos os aparelhos. */
  marcacoes: Marcacao[]
  /** O tempo adotado: a correcao manual, se houver; senao a mediana. */
  fechadoEm: number | null
  /** Verdadeiro quando o tempo veio de uma correcao manual. */
  corrigido: boolean
  /** Quando este trecho comecou (fim do anterior, ou a largada). */
  iniciadoEm: number | null
  /** Quanto durou. Null enquanto nao fechou. */
  duracao: number | null
}

export type StatusEquipe = 'aguardando' | 'em_prova' | 'finalizado' | 'dnf' | 'dns'

export type EstadoEquipe = {
  equipe: Equipe
  largadaEm: number | null
  trechos: EstadoTrecho[]
  /** Indice do trecho em andamento. -1 quando nao largou ou ja acabou. */
  atual: number
  status: StatusEquipe
  /** Da largada ate a chegada. Null enquanto nao terminou. */
  total: number | null
}

/**
 * Le o log de um evento e devolve o estado de cada equipe.
 *
 * Regras de leitura do log, nesta ordem:
 *  1. uma marcacao de 'desfazer' apaga da conta a marcacao que ela aponta;
 *  2. uma de 'ajuste' num trecho define o tempo daquele trecho na mao
 *     (a mais recente manda) -- e o que a tela de Conferencia grava;
 *  3. o que sobra sao os toques dos cronometristas: o tempo do trecho e a
 *     mediana deles.
 */
export function estadoDaProva(
  evento: Evento,
  equipes: Equipe[],
  trechos: Trecho[],
  modalidades: Modalidade[],
  marcacoes: Marcacao[],
): Map<string, EstadoEquipe> {
  const doEvento = marcacoes.filter((m) => m.evento_id === evento.id)

  // 1) o que foi desfeito sai da conta
  const anuladas = new Set(
    doEvento.filter((m) => m.tipo === 'desfazer' && m.anula_id).map((m) => m.anula_id as string),
  )
  const validas = doEvento.filter((m) => !anuladas.has(m.id))

  // largada em massa: vale para todas as equipes que nao tem largada propria
  const largadaGeral = validas
    .filter((m) => m.tipo === 'largada' && !m.equipe_id)
    .map((m) => ms(m.marcado_em))
    .sort((a, b) => a - b)[0]

  const modPorId = new Map(modalidades.map((m) => [m.id, m]))
  const trechosPorEquipe = new Map<string, Trecho[]>()
  for (const t of trechos) {
    const lista = trechosPorEquipe.get(t.equipe_id) ?? []
    lista.push(t)
    trechosPorEquipe.set(t.equipe_id, lista)
  }

  const porEquipe = new Map<string, Marcacao[]>()
  for (const m of validas) {
    if (!m.equipe_id) continue
    const lista = porEquipe.get(m.equipe_id) ?? []
    lista.push(m)
    porEquipe.set(m.equipe_id, lista)
  }

  const saida = new Map<string, EstadoEquipe>()

  for (const equipe of equipes) {
    if (equipe.evento_id !== evento.id) continue
    const minhas = porEquipe.get(equipe.id) ?? []
    const meusTrechos = (trechosPorEquipe.get(equipe.id) ?? []).slice().sort((a, b) => a.ordem - b.ordem)

    const largadaPropria = minhas
      .filter((m) => m.tipo === 'largada')
      .map((m) => ms(m.marcado_em))
      .sort((a, b) => a - b)[0]
    const largadaEm = largadaPropria ?? largadaGeral ?? null

    // 2) correcoes manuais: a mais recente de cada trecho manda
    const ajustePorTrecho = new Map<string, Marcacao>()
    for (const m of minhas) {
      if (m.tipo !== 'ajuste' || !m.trecho_id) continue
      const atual = ajustePorTrecho.get(m.trecho_id)
      if (!atual || m.criado_em > atual.criado_em) ajustePorTrecho.set(m.trecho_id, m)
    }

    const estados: EstadoTrecho[] = []
    let anterior = largadaEm
    for (const trecho of meusTrechos) {
      const modalidade = modPorId.get(trecho.modalidade_id)
      if (!modalidade) continue

      // 3) os toques dos cronometristas neste trecho
      const toques = minhas
        .filter((m) => m.trecho_id === trecho.id && (m.tipo === 'passagem' || m.tipo === 'chegada'))
        .sort((a, b) => ms(a.marcado_em) - ms(b.marcado_em))

      const ajuste = ajustePorTrecho.get(trecho.id)
      const fechadoEm = ajuste
        ? ms(ajuste.marcado_em)
        : mediana(toques.map((m) => ms(m.marcado_em)))

      estados.push({
        trecho,
        modalidade,
        marcacoes: toques,
        fechadoEm,
        corrigido: Boolean(ajuste),
        iniciadoEm: anterior,
        duracao: fechadoEm !== null && anterior !== null ? fechadoEm - anterior : null,
      })
      if (fechadoEm !== null) anterior = fechadoEm
    }

    const abandonou = minhas.filter((m) => m.tipo === 'dnf' || m.tipo === 'dns')
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em))
      .pop()

    const atual = estados.findIndex((e) => e.fechadoEm === null)
    const terminou = estados.length > 0 && atual < 0

    let status: StatusEquipe
    if (abandonou) status = abandonou.tipo === 'dnf' ? 'dnf' : 'dns'
    else if (terminou) status = 'finalizado'
    else if (largadaEm !== null) status = 'em_prova'
    else status = 'aguardando'

    const ultimo = estados[estados.length - 1]
    saida.set(equipe.id, {
      equipe,
      largadaEm,
      trechos: estados,
      atual: status === 'em_prova' ? atual : -1,
      status,
      total:
        terminou && largadaEm !== null && ultimo?.fechadoEm !== null && ultimo?.fechadoEm !== undefined
          ? ultimo.fechadoEm - largadaEm
          : null,
    })
  }

  return saida
}

/**
 * A ordem dos cards na tela de cronometragem.
 *
 * Quem esta em prova ha mais tempo sobe. Numa chegada de natacao com quatro
 * duplas quase juntas, o card que a pessoa procura tende a estar no topo --
 * e essa e a unica ajuda que da para oferecer, porque procurar na lista e
 * exatamente o que nao da tempo de fazer.
 *
 * ACIMA DE TODOS fica quem acabou de passar e ainda aceita confirmacao. Sao
 * duas razoes: os outros cronometristas precisam achar esse card AGORA para
 * confirmar o mesmo momento, e sem isso o card sairia debaixo do dedo de quem
 * acabou de tocar nele -- convite para tocar no card errado em seguida.
 */
export function ordemDeChegada(estados: EstadoEquipe[], agora = Date.now()): EstadoEquipe[] {
  const peso = (e: EstadoEquipe) => {
    if (confirmando(e, agora)) return -1
    if (e.status === 'em_prova') return 0
    if (e.status === 'aguardando') return 1
    if (e.status === 'finalizado') return 2
    return 3 // dnf/dns por ultimo
  }
  return estados.slice().sort((a, b) => {
    const p = peso(a) - peso(b)
    if (p !== 0) return p
    if (a.status === 'em_prova' && b.status === 'em_prova') {
      // ha mais tempo no trecho atual = mais perto de chegar
      const ia = a.trechos[a.atual]?.iniciadoEm ?? Infinity
      const ib = b.trechos[b.atual]?.iniciadoEm ?? Infinity
      if (ia !== ib) return ia - ib
    }
    if (a.status === 'finalizado' && b.status === 'finalizado') {
      return (a.total ?? Infinity) - (b.total ?? Infinity)
    }
    return a.equipe.dorsal - b.equipe.dorsal
  })
}

/** Quem esta na prova agora por esta equipe (o atleta do trecho atual). */
export function atletaAtual(e: EstadoEquipe): string | null {
  if (e.status === 'aguardando') return e.trechos[0]?.trecho.atleta_id ?? null
  if (e.atual < 0) return null
  return e.trechos[e.atual]?.trecho.atleta_id ?? null
}

/** O trecho que o proximo toque vai fechar. Null quando nao ha o que fechar. */
export function trechoAberto(e: EstadoEquipe) {
  if (e.status !== 'em_prova' || e.atual < 0) return null
  return e.trechos[e.atual] ?? null
}

function ms(iso: string): number {
  return new Date(iso).getTime()
}
