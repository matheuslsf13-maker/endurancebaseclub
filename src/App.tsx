import { useEffect, useMemo, useState } from 'react'
import { Logo } from './components/ui'
import { useStore } from './lib/store'
import { aplicarTema, temaSalvo, type Tema } from './lib/tema'
import Atleta from './pages/Atleta'
import Atletas from './pages/Atletas'
import Conferencia from './pages/Conferencia'
import Cronometro from './pages/Cronometro'
import Entrar from './pages/Entrar'
import EntrarComoCronometrista from './pages/EntrarComoCronometrista'
import Equipes from './pages/Equipes'
import Evento from './pages/Evento'
import Eventos from './pages/Eventos'
import Resultados from './pages/Resultados'
import FormEvento from './pages/FormEvento'

/**
 * Sem router: a tela atual e um estado aqui, como no Play de Todas.
 *
 * O unico endereco que o app le e o convite do cronometrista,
 * `#/cronometrar/<evento>/<codigo>`. O id do evento vai no link porque quem
 * recebe o convite nao tem permissao de ler a tabela dos codigos -- ele precisa
 * saber de qual evento se trata sem poder consultar isso no banco.
 */
type Tela =
  | { t: 'eventos' }
  | { t: 'novo' }
  | { t: 'evento'; id: string }
  | { t: 'editar'; id: string }
  | { t: 'equipes'; id: string }
  | { t: 'cronometro'; id: string }
  | { t: 'conferencia'; id: string }
  | { t: 'resultados'; id: string }
  | { t: 'atletas' }
  | { t: 'atleta'; id: string }

type Convite = { eventoId: string; codigo: string }

function lerConvite(): Convite | null {
  const m = /^#\/cronometrar\/([^/]+)\/([^/]+)$/.exec(location.hash)
  return m ? { eventoId: m[1], codigo: m[2] } : null
}

export default function App() {
  const { data, loading, error, sessao, sync, pendingCount, canEdit, sair } = useStore()
  const [tema, setTema] = useState<Tema>(temaSalvo)
  const [entrando, setEntrando] = useState(false)
  const convite = useMemo(lerConvite, [])
  // Quem chega pelo convite abre direto no cronometro daquele evento -- e quem
  // JA entrou pelo convite tambem, mesmo sem o link na mao. Isso importa: o
  // cronometrista instala o app na tela inicial e no dia do evento abre pelo
  // icone, sem hash nenhum. Sem esta segunda condicao ele cairia na lista de
  // eventos, que e uma tela que ele nem tem permissao de usar.
  const [tela, setTela] = useState<Tela>(() => {
    if (convite) return { t: 'cronometro', id: convite.eventoId }
    if (sessao.papel === 'cronometrista') return { t: 'cronometro', id: sessao.eventoId }
    return { t: 'eventos' }
  })

  useEffect(() => aplicarTema(tema), [tema])

  const evento =
    'id' in tela && tela.t !== 'atleta' ? data.eventos.find((e) => e.id === tela.id) : undefined

  // chegou pelo link e ainda nao disse o nome: e a primeira coisa a fazer
  if (convite && sessao.papel !== 'cronometrista' && sessao.papel !== 'organizador') {
    return (
      <div className="app">
        <EntrarComoCronometrista
          eventoId={convite.eventoId}
          codigo={convite.codigo}
          onEntrou={() => setTela({ t: 'cronometro', id: convite.eventoId })}
          onCancelar={() => {
            location.hash = ''
            setTela({ t: 'eventos' })
          }}
        />
      </div>
    )
  }

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

      {/* o cronometrista nao navega: a tela dele e o cronometro, e ponto */}
      {sessao.papel !== 'cronometrista' && (
        <nav className="abas">
          <button
            className={tela.t !== 'atletas' && tela.t !== 'atleta' ? 'on' : ''}
            onClick={() => setTela({ t: 'eventos' })}
          >
            Eventos
          </button>
          <button
            className={tela.t === 'atletas' || tela.t === 'atleta' ? 'on' : ''}
            onClick={() => setTela({ t: 'atletas' })}
          >
            Atletas
          </button>
          <span className="crescer" />
          {sessao.papel === 'organizador' ? (
            <button onClick={() => void sair()}>sair</button>
          ) : (
            <button onClick={() => setEntrando(true)}>entrar</button>
          )}
        </nav>
      )}

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
          evento={evento}
          onPronto={(id) => setTela({ t: 'evento', id })}
          onCancelar={() => setTela({ t: 'evento', id: tela.id })}
        />
      )}

      {tela.t === 'evento' && (
        <Evento
          eventoId={tela.id}
          onEditar={() => setTela({ t: 'editar', id: tela.id })}
          onEquipes={() => setTela({ t: 'equipes', id: tela.id })}
          onCronometro={() => setTela({ t: 'cronometro', id: tela.id })}
          onConferencia={() => setTela({ t: 'conferencia', id: tela.id })}
          onResultados={() => setTela({ t: 'resultados', id: tela.id })}
          onVoltar={() => setTela({ t: 'eventos' })}
        />
      )}

      {tela.t === 'equipes' &&
        (evento ? (
          <Equipes evento={evento} onVoltar={() => setTela({ t: 'evento', id: tela.id })} />
        ) : (
          <NaoAchou onVoltar={() => setTela({ t: 'eventos' })} />
        ))}

      {tela.t === 'cronometro' &&
        (evento ? (
          <Cronometro
            evento={evento}
            onVoltar={() =>
              sessao.papel === 'cronometrista'
                ? void sair()
                : setTela({ t: 'evento', id: tela.id })
            }
          />
        ) : (
          <NaoAchou onVoltar={() => setTela({ t: 'eventos' })} />
        ))}

      {tela.t === 'conferencia' &&
        (evento ? (
          <Conferencia evento={evento} onVoltar={() => setTela({ t: 'evento', id: tela.id })} />
        ) : (
          <NaoAchou onVoltar={() => setTela({ t: 'eventos' })} />
        ))}

      {tela.t === 'resultados' &&
        (evento ? (
          <Resultados evento={evento} onVoltar={() => setTela({ t: 'evento', id: tela.id })} />
        ) : (
          <NaoAchou onVoltar={() => setTela({ t: 'eventos' })} />
        ))}

      {tela.t === 'atletas' && <Atletas onAbrir={(id) => setTela({ t: 'atleta', id })} />}

      {tela.t === 'atleta' && (
        <Atleta atletaId={tela.id} onVoltar={() => setTela({ t: 'atletas' })} />
      )}

      {entrando && <Entrar onFechar={() => setEntrando(false)} />}
    </div>
  )
}

function NaoAchou({ onVoltar }: { onVoltar: () => void }) {
  return (
    <div className="card">
      <p>Evento não encontrado. Pode ser que ainda esteja carregando.</p>
      <button className="btn alt" onClick={onVoltar}>Voltar</button>
    </div>
  )
}
