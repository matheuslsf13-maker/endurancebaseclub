import { useEffect, useState } from 'react'
import { RELOGIO_INICIAL, sincronizar, type EstadoRelogio } from './relogio'

/**
 * Mantem o relogio deste aparelho sincronizado com o do servidor.
 *
 * Sincroniza ao abrir a tela e a cada 5 minutos: o relogio de um celular anda
 * devagar demais para precisar de mais que isso, e cada sincronia sao 5 idas e
 * voltas ate o banco -- de graca nao e.
 *
 * Tambem sincroniza de novo quando o app volta do segundo plano, porque e ai
 * que o relogio costuma ter dado um pulo (o sistema ajustou pela rede enquanto
 * a tela estava apagada).
 */
export function useRelogio(): EstadoRelogio {
  const [estado, setEstado] = useState<EstadoRelogio>(RELOGIO_INICIAL)

  useEffect(() => {
    let vivo = true
    const medir = () => {
      void sincronizar().then((r) => {
        if (vivo) setEstado(r)
      })
    }
    medir()
    const t = window.setInterval(medir, 5 * 60 * 1000)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') medir()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      vivo = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  return estado
}

/** Relogio que anda: devolve o instante corrigido, atualizado 10x por segundo. */
export function useAgora(relogio: EstadoRelogio, ativo = true): number {
  const [agora, setAgora] = useState(() => Date.now() + relogio.desvio)
  useEffect(() => {
    if (!ativo) return
    const t = window.setInterval(() => setAgora(Date.now() + relogio.desvio), 100)
    return () => window.clearInterval(t)
  }, [relogio.desvio, ativo])
  return agora
}
