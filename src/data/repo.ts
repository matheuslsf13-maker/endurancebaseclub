import type {
  AppData, Atleta, Bateria, Equipe, Evento, Marcacao, Modalidade, Trecho,
} from '../lib/types'

/**
 * O que o app precisa saber fazer com os dados, independente de onde eles
 * estao. Duas implementacoes: `localRepo` (so este navegador) e
 * `supabaseRepo` (banco compartilhado). Quem escolhe e o `hasSupabase`.
 *
 * Repare que marcacao so tem `registrar` -- nao ha apagar nem editar. O log da
 * cronometragem e append-only de proposito (ver types.ts).
 */
export interface Repo {
  readonly kind: 'local' | 'supabase'
  load(): Promise<AppData>

  salvarAtleta(a: Atleta): Promise<void>
  apagarAtleta(id: string): Promise<void>

  salvarEvento(e: Evento): Promise<void>
  apagarEvento(id: string): Promise<void>

  /** Substitui as modalidades do evento pela lista dada (elas vivem juntas). */
  trocarModalidades(eventoId: string, ms: Modalidade[]): Promise<void>

  salvarEquipe(e: Equipe): Promise<void>
  apagarEquipe(id: string): Promise<void>
  /** Substitui os trechos da equipe: o "quem faz o que" e sempre reescrito. */
  trocarTrechos(equipeId: string, ts: Trecho[]): Promise<void>

  salvarBateria(b: Bateria): Promise<void>
  apagarBateria(id: string): Promise<void>

  /**
   * Grava marcacoes. `codigo` vem preenchido quando quem esta marcando e um
   * cronometrista convidado pelo link -- ai a gravacao passa pela funcao do
   * banco que confere o codigo, em vez do insert direto do organizador.
   */
  registrarMarcacoes(ms: Marcacao[], codigo: string | null): Promise<void>

  /** Notifica mudancas feitas por outras pessoas (so no modo online). */
  subscribe?(cb: () => void): () => void
}
