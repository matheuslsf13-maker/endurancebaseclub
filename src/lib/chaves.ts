/** Nomes das chaves guardadas no navegador de quem usa o app. */
export const CHAVE = {
  /** Dados completos, no modo local (sem Supabase). */
  dados: 'ebc:v1',
  /** Escritas pendentes, que sobrevivem a refresh e a celular sem sinal. */
  fila: 'ebc:fila',
  /** Ultimo estado conhecido, para o app abrir offline. */
  cache: 'ebc:cache',
  /** Nome digitado pelo cronometrista ao abrir o link do evento. */
  operador: 'ebc:operador',
  /** Codigo do evento que veio no link. */
  codigo: 'ebc:codigo',
  /** Qual evento o link do cronometrista abre. */
  eventoConvite: 'ebc:evento-convite',
} as const
