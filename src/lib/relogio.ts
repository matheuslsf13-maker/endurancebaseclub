/**
 * SINCRONIZACAO DE RELOGIO ENTRE OS APARELHOS
 *
 * O problema: tres pessoas cronometrando em tres celulares. O relogio de cada
 * um pode estar alguns segundos adiantado ou atrasado em relacao aos outros --
 * e um evento inteiro sai errado por causa disso, sem ninguem perceber.
 *
 * A solucao e a mesma ideia do NTP: medir o DESVIO do relogio local em relacao
 * ao do servidor e somar esse desvio em todo tempo gravado.
 *
 *   t0 = relogio local antes de perguntar
 *   t1 = relogio do servidor na resposta
 *   t2 = relogio local depois da resposta
 *
 *   ida-e-volta = t2 - t0
 *   desvio      = t1 - (t0 + t2) / 2      (supondo ida e volta simetricas)
 *
 * Varias amostras sao colhidas e VENCE A DE MENOR IDA-E-VOLTA, nao a media: a
 * amostra rapida e a que menos sofreu com fila de rede, entao e a que tem o
 * desvio mais confiavel. Media misturaria as boas com as ruins.
 *
 * Sem Supabase (modo local, um aparelho so) nao ha o que sincronizar: o desvio
 * e zero e o relogio do proprio aparelho manda.
 */

import { supabase } from './supabase'

export type EstadoRelogio = {
  /** Quanto somar ao relogio local para chegar no do servidor, em ms. */
  desvio: number
  /** Metade da menor ida-e-volta: a incerteza da medida, em ms. */
  incerteza: number
  /** Quando foi sincronizado. Null = ainda nao sincronizou. */
  em: number | null
  /** Modo local, sem servidor para comparar. */
  local: boolean
}

export const RELOGIO_INICIAL: EstadoRelogio = {
  desvio: 0,
  incerteza: 0,
  em: null,
  local: !supabase,
}

/** Acima disso a tela avisa que o relogio nao esta confiavel. */
export const INCERTEZA_LIMITE = 1000

const AMOSTRAS = 5

/**
 * Mede o desvio contra o `now()` do Postgres (funcao `agora` do schema).
 * Devolve o estado; nunca lanca -- sem rede, o app segue com o relogio local
 * e a tela mostra o aviso.
 */
export async function sincronizar(): Promise<EstadoRelogio> {
  if (!supabase) return { ...RELOGIO_INICIAL, em: Date.now() }

  let melhor: { desvio: number; volta: number } | null = null
  for (let i = 0; i < AMOSTRAS; i++) {
    try {
      const t0 = Date.now()
      const { data, error } = await supabase.rpc('agora')
      const t2 = Date.now()
      if (error || !data) continue
      const t1 = new Date(data as string).getTime()
      if (!Number.isFinite(t1)) continue
      const volta = t2 - t0
      const desvio = t1 - (t0 + t2) / 2
      if (!melhor || volta < melhor.volta) melhor = { desvio, volta }
    } catch {
      /* sem sinal: tenta a proxima amostra */
    }
  }

  if (!melhor) return { desvio: 0, incerteza: Infinity, em: Date.now(), local: false }
  return {
    desvio: Math.round(melhor.desvio),
    incerteza: Math.round(melhor.volta / 2),
    em: Date.now(),
    local: false,
  }
}

/** O instante de agora, ja corrigido. E o que vai para `marcado_em`. */
export function agora(r: EstadoRelogio): number {
  return Date.now() + r.desvio
}

/** O mesmo, em ISO UTC -- o formato guardado no banco. */
export function agoraISO(r: EstadoRelogio): string {
  return new Date(agora(r)).toISOString()
}

/** O relogio deste aparelho da para confiar? */
export function confiavel(r: EstadoRelogio): boolean {
  return r.local || (r.em !== null && r.incerteza <= INCERTEZA_LIMITE)
}

/** Texto do selo de sincronia mostrado na tela de cronometragem. */
export function selo(r: EstadoRelogio): string {
  if (r.local) return 'Relógio do aparelho'
  if (r.em === null) return 'Sincronizando…'
  if (!Number.isFinite(r.incerteza)) return 'Sem sincronia — verifique a conexão'
  const seg = (r.incerteza / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  return `Relógio sincronizado ±${seg}s`
}

/**
 * Id fixo deste aparelho, para saber depois do evento de qual celular veio
 * cada marcacao (e achar o relogio torto, se algum tiver ficado).
 */
export function dispositivoId(): string {
  const CHAVE = 'ebc:dispositivo'
  try {
    const salvo = localStorage.getItem(CHAVE)
    if (salvo) return salvo
    const novo =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10)
    localStorage.setItem(CHAVE, novo)
    return novo
  } catch {
    return 'anonimo'
  }
}
