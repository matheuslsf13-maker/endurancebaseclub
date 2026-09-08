/**
 * A confirmacao fisica do toque.
 *
 * Na beira da pista a pessoa nao esta olhando a tela quando toca -- esta
 * olhando o atleta chegar. O apito e a vibracao sao o que dizem "marquei",
 * sem exigir o olho. Por isso os dois juntos, e nao um so.
 */

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    // o navegador suspende o audio ate o primeiro toque da pessoa
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Apito curto. `agudo` marca a chegada; o grave marca a passagem. */
export function apitar(agudo = false) {
  const a = audio()
  if (!a) return
  try {
    const osc = a.createOscillator()
    const vol = a.createGain()
    osc.type = 'sine'
    osc.frequency.value = agudo ? 1320 : 880
    vol.gain.setValueAtTime(0.0001, a.currentTime)
    vol.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.01)
    vol.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.16)
    osc.connect(vol).connect(a.destination)
    osc.start()
    osc.stop(a.currentTime + 0.18)
  } catch {
    /* sem audio: a vibracao e a tela ja confirmam */
  }
}

export function vibrar(forte = false) {
  try {
    navigator.vibrate?.(forte ? [40, 60, 40] : 35)
  } catch {
    /* aparelho sem vibracao */
  }
}

/** Confirmacao completa de um toque que marcou tempo. */
export function confirmar(chegada = false) {
  vibrar(chegada)
  apitar(chegada)
}
