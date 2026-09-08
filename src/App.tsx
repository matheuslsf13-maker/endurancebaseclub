import { useEffect, useState } from 'react'
import { Logo } from './components/ui'
import { useStore } from './lib/store'
import { aplicarTema, temaSalvo, type Tema } from './lib/tema'
import Atletas from './pages/Atletas'
import Evento from './pages/Evento'
import Eventos from './pages/Eventos'
import FormEvento from './pages/FormEvento'

/**
 * Sem router: a tela atual e um estado aqui, como no Play de Todas. O unico
 * endereco que o app le e o `#/cronometrar/CODIGO` do link que o organizador
 * manda para quem vai ajudar a cronometrar.
 */
type Tela =
  | { t: 'eventos' }
  | { t: 'novo' }
  | { t: 'evento'; id: string }
  | { t: 'editar'; id: string }
  | { t: 'atletas' }

export default function App() {
  const { data, loading, error, sessao, sync, pendingCount, canEdit } = useStore()
  const [tela, setTela] = useState<Tela>({ t: 'eventos' })
  const [tema, setTema] = useState<Tema>(temaSalvo)

  useEffect(() => aplicarTema(tema), [tema])

  return (
    <div className="app">
      <header className="topo">
        <Logo size={30} />
        <div className="crescer truncar">
          <div className="titulo truncar">Endurance Base Club</div>
          <div className="sub truncar">
            {sessao.papel === 'organizador'
              ? sessao.email
              : sessao.papel === 'cronometrista'
                ? `Cronometrista · ${sessao.nome}`
                : 'Acompanhando'}
          </div>
        </div>
        <span className={`sinc ${sync}`}>
          {sync === 'saved' ? 'salvo' : sync === 'saving' ? 'enviando…' : `${pendingCount} na fila`}
        </span>
        <button
          className="btn ghost sm"
          style={{ color: 'var(--sempre-claro)', borderColor: 'rgba(255,255,255,.3)' }}
          onClick={() => setTema(tema === 'claro' ? 'escuro' : 'claro')}
          aria-label="trocar tema"
        >
          {tema === 'claro' ? '🌙' : '☀️'}
        </button>
      </header>

      <nav className="abas">
        <button className={tela.t === 'eventos' || tela.t === 'evento' ? 'on' : ''} onClick={() => setTela({ t: 'eventos' })}>
          Eventos
        </button>
        <button className={tela.t === 'atletas' ? 'on' : ''} onClick={() => setTela({ t: 'atletas' })}>
          Atletas
        </button>
      </nav>

      {error && <div className="aviso perigo">{error}</div>}
      {loading && <div className="aviso">Carregando…</div>}

      {tela.t === 'eventos' && (
        <Eventos onAbrir={(id) => setTela({ t: 'evento', id })} onNovo={() => setTela({ t: 'novo' })} />
      )}

      {tela.t === 'novo' && canEdit && (
        <FormEvento onPronto={(id) => setTela({ t: 'evento', id })} onCancelar={() => setTela({ t: 'eventos' })} />
      )}

      {tela.t === 'editar' && canEdit && (
        <FormEvento
          evento={data.eventos.find((e) => e.id === tela.id)}
          onPronto={(id) => setTela({ t: 'evento', id })}
          onCancelar={() => setTela({ t: 'evento', id: tela.id })}
        />
      )}

      {tela.t === 'evento' && (
        <Evento
          eventoId={tela.id}
          onEditar={() => setTela({ t: 'editar', id: tela.id })}
          onVoltar={() => setTela({ t: 'eventos' })}
        />
      )}

      {tela.t === 'atletas' && <Atletas />}
    </div>
  )
}
