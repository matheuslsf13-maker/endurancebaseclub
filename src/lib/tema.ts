/**
 * Tema claro ou escuro, escolhido pela pessoa e guardado no proprio aparelho.
 *
 * O padrao e o CLARO mesmo quando o celular esta no modo escuro: o app e usado
 * na beira da pista, no sol, e tela escura no sol vira espelho.
 */
const CHAVE_TEMA = 'ebc:tema'

export type Tema = 'claro' | 'escuro'

export function temaSalvo(): Tema {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'escuro' ? 'escuro' : 'claro'
  } catch {
    return 'claro'
  }
}

export function aplicarTema(t: Tema) {
  document.documentElement.dataset.tema = t
  try {
    localStorage.setItem(CHAVE_TEMA, t)
  } catch {
    /* aba anonima: vale so nesta sessao */
  }
}

export function aplicarTemaSalvo() {
  document.documentElement.dataset.tema = temaSalvo()
}
