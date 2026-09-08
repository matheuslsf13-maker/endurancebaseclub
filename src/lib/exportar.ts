import type { EstadoEquipe } from './prova'
import { espalhamento, mediana } from './prova'
import {
  classificar, fatiaDoTempo, rankingDaModalidade, type Colocacao,
} from './resultados'
import { acumulados, historicoDoAtleta, recordes } from './estatisticas'
import { dataHoraBR, duracao, horaBR, ritmo } from './tempo'
import type { AppData, Atleta, Evento } from './types'
import { dataLabel, distanciaLabel, emKm, idadeNa } from './types'
import type { Aba } from './xlsx'

/**
 * O QUE VAI PARA O EXCEL.
 *
 * Duas escolhas atravessam todas as abas:
 *
 * 1. **Tempo vai como texto** ("1:24:31"), nunca como numero. Duracao mandada
 *    como numero vira hora do dia na planilha do outro lado, e e assim que uma
 *    planilha de prova chega errada sem ninguem perceber.
 * 2. **Distancia e pace vao junto do tempo.** Uma planilha so com tempos nao
 *    permite comparar dois eventos com percursos diferentes -- e comparar e
 *    justamente o motivo de exportar.
 *
 * A ultima aba e o log cru das marcacoes, com quem marcou e em qual aparelho.
 * Ela nao serve para analise: serve para quando alguem contestar um tempo.
 */

function abaClassificacao(linhas: Colocacao[], evento: Evento, nomeDe: (id: string) => string): Aba {
  const cabecalho = [
    'Posição', 'Nº', 'Equipe', 'Formato', 'Atletas', 'Categorias',
    'Tempo total', 'Diferença', 'Situação',
  ]
  const corpo = linhas.map((l) => [
    l.posicao ?? '',
    l.estado.equipe.dorsal,
    l.estado.equipe.nome,
    l.estado.equipe.modo === 'solo' ? 'Solo' : `Grupo de ${l.estado.equipe.atleta_ids.length}`,
    l.estado.equipe.atleta_ids.map(nomeDe).join(', '),
    l.categorias.join(', '),
    l.estado.total !== null ? duracao(l.estado.total) : '',
    l.atras !== null ? '+' + duracao(l.atras) : '',
    rotuloStatus(l.estado),
  ])
  return {
    nome: 'Classificação',
    linhas: [[evento.nome + ' — ' + dataLabel(evento.data)], [], cabecalho, ...corpo],
    larguras: [9, 6, 26, 14, 34, 20, 13, 12, 14],
  }
}

function abaTempos(
  estados: EstadoEquipe[],
  evento: Evento,
  data: AppData,
  nomeDe: (id: string) => string,
): Aba {
  const modalidades = data.modalidades
    .filter((m) => m.evento_id === evento.id)
    .sort((a, b) => a.ordem - b.ordem)

  const cabecalho = [
    'Nº', 'Equipe', 'Ordem', 'Modalidade', 'Distância', 'Atleta',
    'Tempo do trecho', 'Ritmo', 'Colocação na modalidade', 'Percentil',
    '% do tempo total', 'Cronometristas', 'Diferença entre eles', 'Tempo escolhido na mão',
  ]

  const rankings = new Map(
    modalidades.map((m) => [m.id, rankingDaModalidade(estados, m)]),
  )

  const corpo = estados.flatMap((e) => {
    const fatias = new Map(fatiaDoTempo(e).map((f) => [f.trecho.trecho.id, f.parte]))
    return e.trechos.map((t) => {
      const r = rankings.get(t.modalidade.id)?.find((x) => x.trecho === t)
      const tempos = t.marcacoes.map((m) => +new Date(m.marcado_em))
      return [
        e.equipe.dorsal,
        e.equipe.nome,
        t.trecho.ordem,
        t.modalidade.nome,
        distanciaLabel(t.modalidade),
        nomeDe(t.trecho.atleta_id),
        t.duracao !== null ? duracao(t.duracao) : '',
        t.duracao !== null ? ritmo(t.modalidade.nome, t.duracao, emKm(t.modalidade)) : '',
        r?.posicao ?? '',
        r ? r.percentil : '',
        fatias.get(t.trecho.id) !== undefined ? `${fatias.get(t.trecho.id)}%` : '',
        t.marcacoes.length,
        tempos.length > 1 ? duracao(espalhamento(tempos)) : '',
        t.corrigido ? 'sim' : '',
      ]
    })
  })

  return {
    nome: 'Tempos por modalidade',
    linhas: [cabecalho, ...corpo],
    larguras: [6, 24, 7, 16, 11, 22, 15, 14, 12, 10, 14, 14, 16, 16],
  }
}

function abaEstatisticasDoEvento(
  estados: EstadoEquipe[],
  evento: Evento,
  data: AppData,
  atletas: Map<string, Atleta>,
): Aba {
  const modalidades = data.modalidades
    .filter((m) => m.evento_id === evento.id)
    .sort((a, b) => a.ordem - b.ordem)
  const rankings = new Map(modalidades.map((m) => [m.id, rankingDaModalidade(estados, m)]))

  const cabecalho = [
    'Atleta', 'Idade no evento', 'Equipe', 'Modalidade', 'Distância',
    'Tempo', 'Ritmo', 'Colocação na modalidade', 'Percentil',
  ]

  const corpo = estados.flatMap((e) =>
    e.trechos
      .filter((t) => t.duracao !== null)
      .map((t) => {
        const a = atletas.get(t.trecho.atleta_id)
        const r = rankings.get(t.modalidade.id)?.find((x) => x.trecho === t)
        return [
          a ? a.apelido?.trim() || a.nome : '—',
          idadeNa(a?.nascimento, evento.data) ?? '',
          e.equipe.nome,
          t.modalidade.nome,
          distanciaLabel(t.modalidade),
          duracao(t.duracao as number),
          ritmo(t.modalidade.nome, t.duracao as number, emKm(t.modalidade)),
          r?.posicao ?? '',
          r ? r.percentil : '',
        ]
      }),
  )

  return {
    nome: 'Estatísticas do evento',
    linhas: [cabecalho, ...corpo],
    larguras: [24, 14, 24, 16, 11, 13, 14, 12, 10],
  }
}

function abaAtletas(data: AppData): Aba {
  const cabecalho = ['Nome', 'Apelido', 'Sexo', 'Nascimento', 'Contato', 'Ativo']
  const corpo = data.atletas
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((a) => [
      a.nome,
      a.apelido ?? '',
      a.sexo === 'M' ? 'Masculino' : a.sexo === 'F' ? 'Feminino' : '',
      a.nascimento ? dataLabel(a.nascimento) : '',
      a.contato ?? '',
      a.ativo ? 'sim' : 'não',
    ])
  return { nome: 'Atletas', linhas: [cabecalho, ...corpo], larguras: [28, 18, 12, 13, 20, 8] }
}

/** Todos os eventos de cada atleta, para ver a evolucao numa planilha so. */
function abaHistorico(data: AppData): Aba {
  const cabecalho = [
    'Atleta', 'Data', 'Evento', 'Equipe', 'Formato', 'Colocação', 'De quantas',
    'Tempo da equipe', 'Modalidade', 'Distância', 'Tempo do trecho', 'Ritmo', 'Percentil',
  ]
  const corpo: (string | number)[][] = []

  for (const atleta of data.atletas) {
    for (const p of historicoDoAtleta(data, atleta.id)) {
      const nome = atleta.apelido?.trim() || atleta.nome
      if (p.meusTrechos.length === 0) {
        corpo.push([
          nome, dataLabel(p.evento.data), p.evento.nome, p.equipe.nome,
          p.equipe.modo === 'solo' ? 'Solo' : 'Grupo',
          p.posicao ?? '', p.quantasEquipes,
          p.estado.total !== null ? duracao(p.estado.total) : '', '', '', '', '', '',
        ])
        continue
      }
      for (const t of p.meusTrechos) {
        corpo.push([
          nome, dataLabel(p.evento.data), p.evento.nome, p.equipe.nome,
          p.equipe.modo === 'solo' ? 'Solo' : 'Grupo',
          p.posicao ?? '', p.quantasEquipes,
          p.estado.total !== null ? duracao(p.estado.total) : '',
          t.trecho.modalidade.nome,
          distanciaLabel(t.trecho.modalidade),
          duracao(t.trecho.duracao as number),
          ritmo(t.trecho.modalidade.nome, t.trecho.duracao as number, t.km),
          t.percentil,
        ])
      }
    }
  }

  return {
    nome: 'Histórico',
    linhas: [cabecalho, ...corpo],
    larguras: [24, 12, 24, 22, 10, 11, 12, 15, 16, 11, 15, 14, 10],
  }
}

/** Recorde pessoal e acumulados de carreira, um atleta por linha. */
function abaCarreira(data: AppData): Aba {
  const cabecalho = [
    'Atleta', 'Eventos', 'Concluídos', 'Vitórias', 'Pódios', 'Km total',
    'Percentil médio', 'Modalidade mais forte', 'Recordes pessoais',
  ]
  const corpo = data.atletas.map((a) => {
    const h = historicoDoAtleta(data, a.id)
    const ac = acumulados(h)
    const rec = recordes(h)
      .map((r) => `${r.chave}: ${duracao(r.melhorTempo)}`)
      .join(' · ')
    return [
      a.apelido?.trim() || a.nome,
      ac.eventos,
      ac.concluidos,
      ac.vitorias,
      ac.podios,
      Math.round(ac.kmTotal * 100) / 100,
      ac.percentilMedio ?? '',
      ac.melhorModalidade ?? '',
      rec,
    ]
  })
  return {
    nome: 'Carreira',
    linhas: [cabecalho, ...corpo],
    larguras: [24, 9, 12, 10, 9, 11, 15, 22, 50],
  }
}

/**
 * O log cru. Nao serve para analise -- serve para quando alguem contestar um
 * tempo: aqui esta quem marcou, a que horas e em qual aparelho.
 */
function abaMarcacoes(
  evento: Evento,
  data: AppData,
  nomeDe: (id: string) => string,
): Aba {
  const equipes = new Map(data.equipes.map((e) => [e.id, e]))
  const trechos = new Map(data.trechos.map((t) => [t.id, t]))
  const modalidades = new Map(data.modalidades.map((m) => [m.id, m]))

  const cabecalho = [
    'Hora (Brasília)', 'Tipo', 'Nº', 'Equipe', 'Modalidade', 'Atleta',
    'Cronometrista', 'Aparelho', 'Observação', 'Registrado em',
  ]
  const corpo = data.marcacoes
    .filter((m) => m.evento_id === evento.id)
    .sort((a, b) => a.marcado_em.localeCompare(b.marcado_em))
    .map((m) => {
      const t = m.trecho_id ? trechos.get(m.trecho_id) : null
      const mod = t ? modalidades.get(t.modalidade_id) : null
      return [
        horaBR(m.marcado_em),
        m.tipo,
        m.equipe_id ? (equipes.get(m.equipe_id)?.dorsal ?? '') : '',
        m.equipe_id ? (equipes.get(m.equipe_id)?.nome ?? '') : 'todas',
        mod?.nome ?? '',
        t ? nomeDe(t.atleta_id) : '',
        m.operador,
        m.dispositivo,
        m.nota ?? '',
        dataHoraBR(m.criado_em),
      ]
    })

  return {
    nome: 'Marcações (bruto)',
    linhas: [cabecalho, ...corpo],
    larguras: [15, 11, 6, 24, 16, 22, 20, 12, 30, 20],
  }
}

/** As abas de um evento. */
export function planilhasDoEvento(
  evento: Evento,
  estados: EstadoEquipe[],
  data: AppData,
): Aba[] {
  const atletas = new Map(data.atletas.map((a) => [a.id, a]))
  const nomeDe = (id: string) => {
    const a = atletas.get(id)
    return a ? a.apelido?.trim() || a.nome : '—'
  }
  const linhas = classificar(estados, evento, atletas)

  return [
    abaClassificacao(linhas, evento, nomeDe),
    abaTempos(estados, evento, data, nomeDe),
    abaEstatisticasDoEvento(estados, evento, data, atletas),
    abaAtletas(data),
    abaHistorico(data),
    abaCarreira(data),
    abaMarcacoes(evento, data, nomeDe),
  ]
}

/** As abas do clube inteiro, sem amarrar a um evento. */
export function planilhasDoClube(data: AppData): Aba[] {
  return [abaAtletas(data), abaHistorico(data), abaCarreira(data)]
}

function rotuloStatus(e: EstadoEquipe): string {
  switch (e.status) {
    case 'finalizado':
      return 'Finalizou'
    case 'em_prova':
      return 'Em prova'
    case 'aguardando':
      return 'Não largou ainda'
    case 'dnf':
      return 'Não terminou (DNF)'
    case 'dns':
      return 'Não largou (DNS)'
  }
}

/** Nome do arquivo, sem acento e sem espaco, para nao brigar com nenhum sistema. */
export function nomeDeArquivo(base: string): string {
  const limpo = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira os acentos que o NFD separou
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `${limpo || 'resultados'}.xlsx`
}

// re-export para a tela nao precisar conhecer prova.ts so por causa disto
export { mediana }
