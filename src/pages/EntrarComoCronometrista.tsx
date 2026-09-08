import { useState } from 'react'
import { Logo } from '../components/ui'
import { useStore } from '../lib/store'

/**
 * A porta de entrada de quem recebeu o link para ajudar a cronometrar.
 *
 * Digita o nome e pronto: sem conta, sem senha, sem confirmar e-mail. O nome
 * nao e enfeite -- ele fica gravado em cada marcacao, e e por ele que a tela de
 * Conferencia consegue mostrar depois quem marcou o que.
 */
export default function EntrarComoCronometrista({
  eventoId,
  codigo,
  onEntrou,
  onCancelar,
}: {
  eventoId: string
  codigo: string
  onEntrou: () => void
  onCancelar: () => void
}) {
  const { data, entrarComoCronometrista } = useStore()
  const [nome, setNome] = useState('')
  const evento = data.eventos.find((e) => e.id === eventoId)

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <Logo size={40} />
        <div>
          <h1 style={{ margin: 0 }}>Cronometrar</h1>
          <div className="pequeno muted">{evento?.nome ?? 'Carregando o evento…'}</div>
        </div>
      </div>

      <p className="pequeno muted">
        Digite seu nome para começar. Ele fica gravado em cada tempo que você
        marcar — é assim que no fim dá para conferir os tempos de todo mundo
        lado a lado.
      </p>

      <label className="campo">
        <span>Seu nome</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Arthur"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nome.trim()) {
              entrarComoCronometrista(nome.trim(), codigo, eventoId)
              onEntrou()
            }
          }}
        />
      </label>

      <button
        className="btn lg bloco"
        disabled={!nome.trim()}
        onClick={() => {
          entrarComoCronometrista(nome.trim(), codigo, eventoId)
          onEntrou()
        }}
      >
        Entrar
      </button>

      <button className="btn ghost bloco" style={{ marginTop: 8 }} onClick={onCancelar}>
        Só quero acompanhar
      </button>
    </div>
  )
}
