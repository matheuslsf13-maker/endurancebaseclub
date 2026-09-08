import type { EstadoEquipe, EstadoTrecho } from './prova'
import { emKm, idadeNa, type Atleta, type Evento, type Modalidade } from './types'

/**
 * CLASSIFICACAO E DESEMPENHO.
 *
 * Tudo aqui sai de duas coisas que ja existem: o tempo (derivado do log de
 * marcacoes) e a distancia (escrita na criacao do evento). E a distancia que
 * separa "sei o tempo" de "sei o desempenho" -- sem ela nao ha pace, nao ha
 * velocidade e nao da para comparar dois eventos.
 */

// ------------------------------------------------------------------
//  Em que categorias uma equipe disputa
// ------------------------------------------------------------------

/**
 * Os rotulos de classificacao desta equipe, conforme os criterios do evento.
 *
 * Grupo com gente de sexos diferentes e "Misto" -- isso e padrao em prova.
 *
 * Ja a FAIXA ETARIA de um grupo nao tem convencao obvia (a do mais velho? a
 * media? a do primeiro?), e inventar uma seria decidir premiacao no lugar do
 * organizador. Entao a regra e literal: o grupo so entra numa faixa se TODO
 * mundo dele estiver nela; senao fica em "Faixa mista" e disputa a geral.
 */
export function categoriasDe(
  equipe: { atleta_ids: string[]; categoria?: string | null },
  evento: Evento,
  atletas: Map<string, Atleta>,
): string[] {
  const rotulos: string[] = []
  const membros = equipe.atleta_ids.map((id) => atletas.get(id)).filter((a): a is Atleta => !!a)

  if (evento.criterios.includes('sexo')) {
    const sexos = new Set(membros.map((a) => a.sexo).filter(Boolean))
    if (sexos.size === 1) rotulos.push(sexos.has('M') ? 'Masculino' : 'Feminino')
    else if (sexos.size > 1) rotulos.push('Misto')
  }

  if (evento.criterios.includes('faixa') && evento.faixas.length > 0) {
    const faixas = membros.map((a) => {
      const idade = idadeNa(a.nascimento, evento.data)
      if (idade === null) return null
      return evento.faixas.find((f) => idade >= f.de && (f.ate === null || idade <= f.ate))?.nome ?? null
    })
    const unicas = new Set(faixas.filter(Boolean))
    if (unicas.size === 1) rotulos.push([...unicas][0] as string)
    else if (unicas.size > 1) rotulos.push('Faixa mista')
  }

  if (evento.criterios.includes('livre') && equipe.categoria) rotulos.push(equipe.categoria)

  return rotulos
}

// ------------------------------------------------------------------
//  Classificacao geral
// ------------------------------------------------------------------

export type Colocacao = {
  estado: EstadoEquipe
  /** Posicao na geral. Null para quem nao terminou. */
  posicao: number | null
  /** Diferenca para o primeiro. Null para o proprio lider e para quem nao terminou. */
  atras: number | null
  categorias: string[]
}

/** Quem terminou vem primeiro, por tempo; depois os que ainda estao na prova. */
export function classificar(
  estados: EstadoEquipe[],
  evento: Evento,
  atletas: Map<string, Atleta>,
): Colocacao[] {
  const terminaram = estados
    .filter((e) => e.status === 'finalizado' && e.total !== null)
    .sort((a, b) => (a.total as number) - (b.total as number))
  const resto = estados
    .filter((e) => e.status !== 'finalizado' || e.total === null)
    .sort((a, b) => a.equipe.dorsal - b.equipe.dorsal)

  const lider = terminaram[0]?.total ?? null

  return [
    ...terminaram.map((estado, i) => ({
      estado,
      posicao: i + 1,
      atras: lider !== null && i > 0 ? (estado.total as number) - lider : null,
      categorias: categoriasDe(estado.equipe, evento, atletas),
    })),
    ...resto.map((estado) => ({
      estado,
      posicao: null,
      atras: null,
      categorias: categoriasDe(estado.equipe, evento, atletas),
    })),
  ]
}

/** A mesma classificacao, recontada dentro de um rotulo (ex: só "Feminino"). */
export function classificarEm(linhas: Colocacao[], rotulo: string): Colocacao[] {
  const dentro = linhas.filter((l) => l.categorias.includes(rotulo))
  const terminaram = dentro.filter((l) => l.posicao !== null)
  const lider = terminaram[0]?.estado.total ?? null
  return [
    ...terminaram.map((l, i) => ({
      ...l,
      posicao: i + 1,
      atras: lider !== null && i > 0 ? (l.estado.total as number) - lider : null,
    })),
    ...dentro.filter((l) => l.posicao === null),
  ]
}

/** Todos os rotulos que aparecem no evento, na ordem em que foram configurados. */
export function rotulosDoEvento(linhas: Colocacao[], evento: Evento): string[] {
  const usados = new Set(linhas.flatMap((l) => l.categorias))
  const ordem: string[] = []
  if (evento.criterios.includes('sexo')) ordem.push('Masculino', 'Feminino', 'Misto')
  if (evento.criterios.includes('faixa')) ordem.push(...evento.faixas.map((f) => f.nome), 'Faixa mista')
  if (evento.criterios.includes('livre')) ordem.push(...evento.categorias)
  return ordem.filter((r) => usados.has(r))
}

// ------------------------------------------------------------------
//  Desempenho trecho a trecho
// ------------------------------------------------------------------

export type Desempenho = {
  trecho: EstadoTrecho
  equipe: EstadoEquipe['equipe']
  atletaId: string
  duracao: number
  km: number
  /** Colocacao dentro desta modalidade, entre quem ja fechou o trecho. */
  posicao: number
  /**
   * Onde ficou em relacao ao pelotao, de 0 a 100. 100 = o melhor tempo da
   * modalidade. Serve para comparar desempenho entre eventos e distancias
   * diferentes, coisa que o tempo cru nao permite.
   */
  percentil: number
}

/** Ranking de uma modalidade: quem foi mais rapido naquele trecho. */
export function rankingDaModalidade(
  estados: EstadoEquipe[],
  modalidade: Modalidade,
): Desempenho[] {
  const km = emKm(modalidade)
  const linhas = estados.flatMap((e) =>
    e.trechos
      .filter((t) => t.modalidade.id === modalidade.id && t.duracao !== null && t.duracao > 0)
      .map((t) => ({
        trecho: t,
        equipe: e.equipe,
        atletaId: t.trecho.atleta_id,
        duracao: t.duracao as number,
        km,
      })),
  )
  linhas.sort((a, b) => a.duracao - b.duracao)
  const n = linhas.length
  return linhas.map((l, i) => ({
    ...l,
    posicao: i + 1,
    percentil: n <= 1 ? 100 : Math.round(((n - i - 1) / (n - 1)) * 100),
  }))
}

/** Media, melhor e pior tempo de uma modalidade no evento. */
export function resumoDaModalidade(linhas: Desempenho[]) {
  if (linhas.length === 0) return null
  const tempos = linhas.map((l) => l.duracao)
  return {
    melhor: tempos[0],
    pior: tempos[tempos.length - 1],
    media: Math.round(tempos.reduce((s, x) => s + x, 0) / tempos.length),
    quantos: tempos.length,
  }
}

/** Quanto do tempo total da equipe foi gasto em cada trecho, em %. */
export function fatiaDoTempo(e: EstadoEquipe): { trecho: EstadoTrecho; parte: number }[] {
  const total = e.total
  if (!total) return []
  return e.trechos
    .filter((t) => t.duracao !== null)
    .map((t) => ({ trecho: t, parte: Math.round(((t.duracao as number) / total) * 100) }))
}
