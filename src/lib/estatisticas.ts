import { estadoDaProva, type EstadoEquipe, type EstadoTrecho } from './prova'
import { categoriasDe, classificar, rankingDaModalidade } from './resultados'
import type { AppData, Atleta, Equipe, Evento, Modalidade } from './types'
import { emKm } from './types'

/**
 * HISTORICO E ESTATISTICAS DO CLUBE.
 *
 * O que torna isto possivel e uma decisao la do modelo: `atletas` pertence ao
 * clube, nao ao evento. O Mateus que correu em marco e o mesmo registro que
 * nada em setembro -- entao da para dizer se ele melhorou, e nao so quanto ele
 * fez naquele dia.
 *
 * As contas atravessam eventos comparando PACE, nao tempo: 3 km e 5 km nao se
 * comparam por tempo, mas se comparam por minuto/km. E por isso que a distancia
 * e obrigatoria na criacao do evento.
 */

/** O estado de todos os eventos, calculado uma vez e reaproveitado. */
export function estadosDeTodos(data: AppData): Map<string, Map<string, EstadoEquipe>> {
  const mapa = new Map<string, Map<string, EstadoEquipe>>()
  for (const evento of data.eventos) {
    mapa.set(
      evento.id,
      estadoDaProva(
        evento,
        data.equipes.filter((e) => e.evento_id === evento.id),
        data.trechos,
        data.modalidades.filter((m) => m.evento_id === evento.id),
        data.marcacoes,
      ),
    )
  }
  return mapa
}

// ------------------------------------------------------------------

export type TrechoDoAtleta = {
  trecho: EstadoTrecho
  km: number
  /** Minutos por km. E a unidade que atravessa eventos e distancias. */
  paceMs: number
  posicao: number
  percentil: number
}

export type Participacao = {
  evento: Evento
  equipe: Equipe
  estado: EstadoEquipe
  posicao: number | null
  quantasEquipes: number
  categorias: string[]
  /** Só os trechos que este atleta fez (no solo, todos). */
  meusTrechos: TrechoDoAtleta[]
}

/** Tudo que um atleta já fez, do evento mais recente para o mais antigo. */
export function historicoDoAtleta(data: AppData, atletaId: string): Participacao[] {
  const estados = estadosDeTodos(data)
  const atletas = new Map(data.atletas.map((a) => [a.id, a]))
  const saida: Participacao[] = []

  for (const evento of data.eventos) {
    const doEvento = estados.get(evento.id)
    if (!doEvento) continue
    const equipes = data.equipes.filter(
      (e) => e.evento_id === evento.id && e.atleta_ids.includes(atletaId),
    )
    if (equipes.length === 0) continue

    const modalidades = data.modalidades
      .filter((m) => m.evento_id === evento.id)
      .sort((a, b) => a.ordem - b.ordem)
    const linhas = classificar([...doEvento.values()], evento, atletas)
    // ranking de cada modalidade, para saber a colocacao do atleta em cada trecho
    const rankings = new Map(
      modalidades.map((m) => [m.id, rankingDaModalidade([...doEvento.values()], m)]),
    )

    for (const equipe of equipes) {
      const estado = doEvento.get(equipe.id)
      if (!estado) continue
      const linha = linhas.find((l) => l.estado.equipe.id === equipe.id)

      const meusTrechos: TrechoDoAtleta[] = []
      for (const t of estado.trechos) {
        if (t.trecho.atleta_id !== atletaId || t.duracao === null || t.duracao <= 0) continue
        const km = emKm(t.modalidade)
        const r = rankings.get(t.modalidade.id)?.find((x) => x.trecho === t)
        meusTrechos.push({
          trecho: t,
          km,
          paceMs: km > 0 ? t.duracao / km : 0,
          posicao: r?.posicao ?? 0,
          percentil: r?.percentil ?? 0,
        })
      }

      saida.push({
        evento,
        equipe,
        estado,
        posicao: linha?.posicao ?? null,
        quantasEquipes: linhas.filter((l) => l.posicao !== null).length,
        categorias: linha?.categorias ?? [],
        meusTrechos,
      })
    }
  }

  return saida.sort((a, b) => b.evento.data.localeCompare(a.evento.data))
}

// ------------------------------------------------------------------
//  Recordes e acumulados
// ------------------------------------------------------------------

export type Recorde = {
  /** Modalidade + distancia: "Corrida 3 km". Comparar 3 km com 5 km nao faz sentido. */
  chave: string
  modalidade: string
  km: number
  melhorTempo: number
  melhorPace: number
  quando: string
  vezes: number
}

/**
 * Recorde pessoal por modalidade E distancia.
 *
 * A distancia entra na chave de proposito: "melhor tempo de corrida" nao quer
 * dizer nada se num evento foram 3 km e no outro 8 km.
 */
export function recordes(participacoes: Participacao[]): Recorde[] {
  const mapa = new Map<string, Recorde>()
  for (const p of participacoes) {
    for (const t of p.meusTrechos) {
      const km = t.km
      const chave = `${t.trecho.modalidade.nome} ${km.toLocaleString('pt-BR')} km`
      const tempo = t.trecho.duracao as number
      const atual = mapa.get(chave)
      if (!atual) {
        mapa.set(chave, {
          chave,
          modalidade: t.trecho.modalidade.nome,
          km,
          melhorTempo: tempo,
          melhorPace: t.paceMs,
          quando: p.evento.data,
          vezes: 1,
        })
      } else {
        atual.vezes++
        if (tempo < atual.melhorTempo) {
          atual.melhorTempo = tempo
          atual.melhorPace = t.paceMs
          atual.quando = p.evento.data
        }
      }
    }
  }
  return [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave, 'pt-BR'))
}

export type Acumulado = {
  eventos: number
  concluidos: number
  vitorias: number
  podios: number
  /** Quilometragem somada por modalidade: quanto ele já correu, nadou, pedalou. */
  kmPorModalidade: { nome: string; km: number }[]
  kmTotal: number
  /** Media dos percentis: onde ele costuma ficar em relacao ao pelotao. */
  percentilMedio: number | null
  melhorModalidade: string | null
  piorModalidade: string | null
}

export function acumulados(participacoes: Participacao[]): Acumulado {
  const km = new Map<string, number>()
  const percentisPorModalidade = new Map<string, number[]>()
  let vitorias = 0
  let podios = 0
  let concluidos = 0

  for (const p of participacoes) {
    if (p.estado.status === 'finalizado') concluidos++
    if (p.posicao === 1) vitorias++
    if (p.posicao !== null && p.posicao <= 3) podios++
    for (const t of p.meusTrechos) {
      const nome = t.trecho.modalidade.nome
      km.set(nome, (km.get(nome) ?? 0) + t.km)
      const lista = percentisPorModalidade.get(nome) ?? []
      lista.push(t.percentil)
      percentisPorModalidade.set(nome, lista)
    }
  }

  const medias = [...percentisPorModalidade.entries()].map(([nome, v]) => ({
    nome,
    media: v.reduce((s, x) => s + x, 0) / v.length,
  }))
  medias.sort((a, b) => b.media - a.media)

  const todos = [...percentisPorModalidade.values()].flat()

  return {
    eventos: participacoes.length,
    concluidos,
    vitorias,
    podios,
    kmPorModalidade: [...km.entries()]
      .map(([nome, k]) => ({ nome, km: k }))
      .sort((a, b) => b.km - a.km),
    kmTotal: [...km.values()].reduce((s, x) => s + x, 0),
    percentilMedio: todos.length ? Math.round(todos.reduce((s, x) => s + x, 0) / todos.length) : null,
    melhorModalidade: medias[0]?.nome ?? null,
    piorModalidade: medias.length > 1 ? medias[medias.length - 1].nome : null,
  }
}

/** A evolucao do pace numa modalidade, do evento mais antigo para o mais novo. */
export function evolucao(
  participacoes: Participacao[],
  modalidade: string,
): { data: string; evento: string; paceMs: number; km: number }[] {
  const pontos = participacoes
    .flatMap((p) =>
      p.meusTrechos
        .filter((t) => t.trecho.modalidade.nome === modalidade)
        .map((t) => ({ data: p.evento.data, evento: p.evento.nome, paceMs: t.paceMs, km: t.km })),
    )
    .sort((a, b) => a.data.localeCompare(b.data))
  return pontos
}

// ------------------------------------------------------------------
//  Formacoes: com quem ele rende mais
// ------------------------------------------------------------------

export type Formacao = {
  /** Os ids dos parceiros, sem o proprio atleta. */
  parceiros: string[]
  chave: string
  eventos: number
  concluidos: number
  melhorPosicao: number | null
  posicaoMedia: number | null
  vitorias: number
}

/** Retrospecto de cada dupla/trio que este atleta ja formou. */
export function formacoes(participacoes: Participacao[], atletaId: string): Formacao[] {
  const mapa = new Map<string, Formacao>()
  for (const p of participacoes) {
    const parceiros = p.equipe.atleta_ids.filter((id) => id !== atletaId).sort()
    if (parceiros.length === 0) continue // solo nao forma dupla
    const chave = parceiros.join('|')
    const f = mapa.get(chave) ?? {
      parceiros,
      chave,
      eventos: 0,
      concluidos: 0,
      melhorPosicao: null,
      posicaoMedia: null,
      vitorias: 0,
    }
    f.eventos++
    if (p.estado.status === 'finalizado') f.concluidos++
    if (p.posicao !== null) {
      f.melhorPosicao = f.melhorPosicao === null ? p.posicao : Math.min(f.melhorPosicao, p.posicao)
      if (p.posicao === 1) f.vitorias++
    }
    mapa.set(chave, f)
  }

  // a media so faz sentido sobre as vezes em que houve colocacao
  for (const [chave, f] of mapa) {
    const posicoes = participacoes
      .filter((p) => p.equipe.atleta_ids.filter((id) => id !== atletaId).sort().join('|') === chave)
      .map((p) => p.posicao)
      .filter((x): x is number => x !== null)
    f.posicaoMedia = posicoes.length
      ? Math.round((posicoes.reduce((s, x) => s + x, 0) / posicoes.length) * 10) / 10
      : null
  }

  return [...mapa.values()].sort((a, b) => b.eventos - a.eventos)
}

/** Modalidades distintas que ja apareceram em qualquer evento do clube. */
export function modalidadesDoClube(data: AppData): Modalidade[] {
  const vistas = new Map<string, Modalidade>()
  for (const m of data.modalidades) if (!vistas.has(m.nome)) vistas.set(m.nome, m)
  return [...vistas.values()]
}

/** Atalho: o atleta com o nome pronto para a tela. */
export function nomeDoAtleta(a: Atleta | undefined): string {
  if (!a) return '—'
  return a.apelido?.trim() || a.nome
}

/** Categorias de uma equipe, para as planilhas. */
export function categoriasDaEquipe(equipe: Equipe, evento: Evento, atletas: Map<string, Atleta>) {
  return categoriasDe(equipe, evento, atletas)
}
