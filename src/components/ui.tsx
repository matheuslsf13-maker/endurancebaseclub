import React from 'react'

export function Vazio({ icone = '🏁', children }: { icone?: string; children: React.ReactNode }) {
  return (
    <div className="vazio">
      <span className="big">{icone}</span>
      {children}
    </div>
  )
}

export function Modal({
  titulo,
  onFechar,
  children,
}: {
  titulo: string
  onFechar: () => void
  children: React.ReactNode
}) {
  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread" style={{ marginBottom: 12 }}>
          <strong>{titulo}</strong>
          <button className="btn ghost sm" onClick={onFechar}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toast({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null
  return <div className="toast">{mensagem}</div>
}

export function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null)
  const mostrar = React.useCallback((m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(null), 2600)
  }, [])
  return { msg, mostrar }
}

/** Logo provisorio, ate chegar a arte do clube em public/logo.png. */
export function Logo({ size = 34 }: { size?: number }) {
  const [ok, setOk] = React.useState(true)
  if (ok) {
    return (
      <img
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt="Endurance Base Club"
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }}
        onError={() => setOk(false)}
      />
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flex: 'none' }} aria-label="Endurance Base Club">
      <circle cx="50" cy="50" r="47" fill="#0f6ea8" />
      {/* a onda da agua e o sol da pista */}
      <circle cx="50" cy="34" r="15" fill="#f2761b" />
      <path d="M8 62c11 0 11-8 21-8s10 8 21 8 11-8 21-8 10 8 21 8" stroke="#f7fbff" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M8 78c11 0 11-8 21-8s10 8 21 8 11-8 21-8 10 8 21 8" stroke="#f7fbff" strokeWidth="6" fill="none" strokeLinecap="round" opacity=".55" />
    </svg>
  )
}

/** Copia texto e cai para um campo temporario quando o navegador nao deixa. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = texto
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/** Compartilha no app do celular; sem isso, copia. */
export function compartilharOuCopiar(texto: string): Promise<boolean> {
  const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> }
  if (nav.share) return nav.share({ text: texto }).then(() => true).catch(() => copiar(texto))
  return copiar(texto)
}
