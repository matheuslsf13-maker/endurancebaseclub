/**
 * Tempo, ritmo e horario de Brasilia.
 *
 * Duracao e sempre em MILISSEGUNDOS aqui dentro; o formato so aparece na hora
 * de mostrar. Horario e sempre guardado em UTC e exibido em America/Sao_Paulo
 * -- assim o horario de verao (se voltar) e a viagem para outro fuso nao
 * mudam o que ja foi gravado.
 */

export const FUSO = 'America/Sao_Paulo'

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const HORA_MIN = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** "07:00:12" no horario de Brasilia. */
export function horaBR(iso: string | number | Date): string {
  return HORA.format(new Date(iso))
}

/** "07:00" no horario de Brasilia. */
export function horaCurtaBR(iso: string | number | Date): string {
  return HORA_MIN.format(new Date(iso))
}

/** "08/09/2026 07:00:12" no horario de Brasilia. */
export function dataHoraBR(iso: string | number | Date): string {
  return DATA_HORA.format(new Date(iso))
}

/**
 * Duracao no formato da prova:
 *   menos de 1 hora -> 24:31
 *   1 hora ou mais  -> 1:24:31
 * Com `decimos`, acrescenta o decimo de segundo: 24:31,4
 */
export function duracao(ms: number, decimos = false): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const d = decimos ? ',' + Math.floor((ms % 1000) / 100) : ''
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}${d}`
}

/** Diferenca para o lider: "+2:14". Zero vira "—". */
export function diferenca(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return '—'
  return '+' + duracao(ms)
}

/**
 * PACE -- o numero que corredor e nadador olham: quanto tempo por quilometro.
 * "5:12 /km". Sem distancia nao ha pace.
 */
export function pace(ms: number, km: number): string {
  if (!km || km <= 0 || !Number.isFinite(ms) || ms <= 0) return '—'
  return duracao(ms / km) + ' /km'
}

/** Pace da natacao, que a piscina mede por 100 m: "1:48 /100m". */
export function pace100m(ms: number, km: number): string {
  if (!km || km <= 0 || !Number.isFinite(ms) || ms <= 0) return '—'
  return duracao(ms / (km * 10)) + ' /100m'
}

/** VELOCIDADE MEDIA -- o numero que ciclista olha: "28,4 km/h". */
export function velocidade(ms: number, km: number): string {
  if (!km || km <= 0 || !Number.isFinite(ms) || ms <= 0) return '—'
  const kmh = km / (ms / 3600000)
  return kmh.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km/h'
}

/**
 * O ritmo que faz sentido para a modalidade. Ciclismo se le em km/h; corrida
 * em min/km; natacao em min/100m. A escolha e pelo nome porque o nome e
 * escrito pelo organizador -- nao ha lista fixa de modalidades no sistema.
 */
export function ritmo(nomeModalidade: string, ms: number, km: number): string {
  const n = nomeModalidade.toLowerCase()
  if (/cicl|bike|bicicl|pedal|mtb|patin|remo|caia|canoa/.test(n)) return velocidade(ms, km)
  if (/nata|nado|swim|aqua|agua|água/.test(n)) return pace100m(ms, km)
  return pace(ms, km)
}

/** Rotulo do ritmo, para o cabecalho da tabela. */
export function ritmoLabel(nomeModalidade: string): string {
  const n = nomeModalidade.toLowerCase()
  if (/cicl|bike|bicicl|pedal|mtb|patin|remo|caia|canoa/.test(n)) return 'Velocidade'
  return 'Pace'
}

/** "24:31" de volta para milissegundos. Aceita 1:24:31 e 24:31,4. */
export function paraMs(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.')
  if (!limpo) return null
  const partes = limpo.split(':').map((p) => Number(p))
  if (partes.some((p) => !Number.isFinite(p))) return null
  let ms = 0
  if (partes.length === 3) ms = ((partes[0] * 60 + partes[1]) * 60 + partes[2]) * 1000
  else if (partes.length === 2) ms = (partes[0] * 60 + partes[1]) * 1000
  else if (partes.length === 1) ms = partes[0] * 1000
  else return null
  return Math.round(ms)
}

/**
 * "07:00:12" (horario de Brasilia daquele dia) de volta para ISO em UTC.
 * Usado na correcao manual de um tempo na tela de revisao.
 */
export function horaBRparaISO(dataISO: string, hora: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hora.trim())
  if (!m) return null
  const [, h, mi, se] = m
  // o Brasil esta em UTC-3 o ano inteiro desde 2019 (sem horario de verao).
  // Se o horario de verao voltar, este e o unico ponto a mudar.
  const iso = `${dataISO}T${h.padStart(2, '0')}:${mi}:${se ?? '00'}.000-03:00`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
