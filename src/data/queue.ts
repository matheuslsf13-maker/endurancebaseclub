import { CHAVE } from '../lib/chaves'
import type { Atleta, Bateria, Equipe, Evento, Marcacao, Modalidade, Trecho } from '../lib/types'

/**
 * Operacoes de escrita em formato serializavel: assim a fila sobrevive a um
 * refresh e a um celular sem sinal no meio da prova.
 *
 * E a fila que torna a cronometragem confiavel: o toque grava o tempo AGORA,
 * na hora do toque, e o envio acontece quando der. Rede lenta nao atrasa
 * tempo nenhum.
 */
export type WriteOp =
  | { id: string; type: 'salvarAtleta'; atleta: Atleta }
  | { id: string; type: 'apagarAtleta'; atletaId: string }
  | { id: string; type: 'salvarEvento'; evento: Evento }
  | { id: string; type: 'apagarEvento'; eventoId: string }
  | { id: string; type: 'trocarModalidades'; eventoId: string; modalidades: Modalidade[] }
  | { id: string; type: 'salvarEquipe'; equipe: Equipe }
  | { id: string; type: 'apagarEquipe'; equipeId: string }
  | { id: string; type: 'trocarTrechos'; equipeId: string; trechos: Trecho[] }
  | { id: string; type: 'salvarBateria'; bateria: Bateria }
  | { id: string; type: 'apagarBateria'; bateriaId: string }
  | { id: string; type: 'registrarMarcacoes'; marcacoes: Marcacao[]; codigo: string | null }

export function loadQueue(): WriteOp[] {
  try {
    const raw = localStorage.getItem(CHAVE.fila)
    return raw ? (JSON.parse(raw) as WriteOp[]) : []
  } catch {
    return []
  }
}

export function saveQueue(ops: WriteOp[]) {
  try {
    localStorage.setItem(CHAVE.fila, JSON.stringify(ops))
  } catch {
    /* sem espaco: a fila continua so em memoria */
  }
}

export function loadCache<T>(): T | null {
  try {
    const raw = localStorage.getItem(CHAVE.cache)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function saveCache(data: unknown) {
  try {
    localStorage.setItem(CHAVE.cache, JSON.stringify(data))
  } catch {
    /* sem espaco: o app so nao abre offline com o ultimo estado */
  }
}
