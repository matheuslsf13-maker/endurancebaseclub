import { useMemo } from 'react'
import { Vazio } from '../components/ui'
import { useStore } from '../lib/store'
import { dataLabel, distanciaLabel } from '../lib/types'

const ROTULO_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  pronto: 'Pronto',
  em_prova: 'Em prova',
  encerrado: 'Encerrado',
}

export default function Eventos({
  onAbrir,
  onNovo,
}: {
  onAbrir: (id: string) => void
  onNovo: () => void
}) {
  const { data, canEdit } = useStore()

  const eventos = useMemo(
    () => data.eventos.slice().sort((a, b) => b.data.localeCompare(a.data)),
    [data.eventos],
  )

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Eventos</h1>
        {canEdit && <button className="btn sm" onClick={onNovo}>+ novo evento</button>}
      </div>

      {eventos.length === 0 ? (
        <div className="card">
          <Vazio icone="🏁">
            Nenhum evento ainda.
            {canEdit && (
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={onNovo}>Criar o primeiro</button>
              </div>
            )}
          </Vazio>
        </div>
      ) : (
        eventos.map((e) => {
          const modalidades = data.modalidades
            .filter((m) => m.evento_id === e.id)
            .sort((a, b) => a.ordem - b.ordem)
          const equipes = data.equipes.filter((q) => q.evento_id === e.id).length
          return (
            <button
              key={e.id}
              className="card"
              onClick={() => onAbrir(e.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
            >
              <div className="row spread">
                <strong>{e.nome}</strong>
                <span className={`selo${e.status === 'em_prova' ? ' sol' : e.status === 'encerrado' ? ' verde' : ''}`}>
                  {ROTULO_STATUS[e.status] ?? e.status}
                </span>
              </div>
              <div className="pequeno muted">
                {dataLabel(e.data)}
                {e.local ? ` · ${e.local}` : ''}
                {` · ${equipes} equipe(s)`}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                {modalidades.map((m) => (
                  <span className="selo agua" key={m.id}>
                    {m.nome} {distanciaLabel(m)}
                  </span>
                ))}
                {modalidades.length === 0 && <span className="selo perigo">sem modalidades</span>}
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}
