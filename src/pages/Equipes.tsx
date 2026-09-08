import { useMemo, useState } from 'react'
import { Modal, Vazio } from '../components/ui'
import { useStore } from '../lib/store'
import type { Equipe, Evento, ModoEquipe, Modalidade, Trecho } from '../lib/types'
import { distanciaLabel, uid } from '../lib/types'

/**
 * Montagem das equipes e do "quem faz o que".
 *
 * Esta tela e o que torna o cronometro burro -- no bom sentido. Como a
 * atribuicao de cada modalidade a um atleta ja esta decidida aqui, na hora da
 * prova o cronometrista nao escolhe nome nenhum: um toque no card do grupo
 * fecha o trecho de quem estava nele e abre o do proximo, sozinho.
 *
 * Dois modos, que sao os que o clube usa:
 *  - solo  : uma pessoa faz todas as modalidades;
 *  - grupo : dupla/trio/quarteto em que cada um faz uma parte.
 * Os dois viram a mesma coisa no banco: uma lista de trechos.
 */
export default function Equipes({ evento, onVoltar }: { evento: Evento; onVoltar: () => void }) {
  const { data, canEdit, salvarEquipe, trocarTrechos, apagarEquipe, nomeDe } = useStore()
  const [editando, setEditando] = useState<{ equipe: Equipe; nova: boolean } | null>(null)

  const modalidades = useMemo(
    () => data.modalidades.filter((m) => m.evento_id === evento.id).sort((a, b) => a.ordem - b.ordem),
    [data.modalidades, evento.id],
  )
  const equipes = useMemo(
    () => data.equipes.filter((e) => e.evento_id === evento.id).sort((a, b) => a.dorsal - b.dorsal),
    [data.equipes, evento.id],
  )

  const proximoDorsal = equipes.reduce((n, e) => Math.max(n, e.dorsal), 0) + 1

  if (modalidades.length === 0) {
    return (
      <div className="card">
        <Vazio icone="⚠️">
          Este evento ainda não tem modalidades. Configure a prova antes de
          inscrever equipes.
        </Vazio>
        <button className="btn alt bloco" onClick={onVoltar}>Voltar ao evento</button>
      </div>
    )
  }

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="crescer truncar">
          <h1 style={{ margin: 0 }}>Equipes</h1>
          <div className="pequeno muted truncar">{evento.nome}</div>
        </div>
        <button className="btn ghost sm" onClick={onVoltar}>← evento</button>
      </div>

      {canEdit && (
        <button
          className="btn bloco"
          style={{ marginBottom: 12 }}
          onClick={() =>
            setEditando({
              nova: true,
              equipe: {
                id: uid(),
                evento_id: evento.id,
                dorsal: proximoDorsal,
                nome: '',
                modo: 'solo',
                atleta_ids: [],
                categoria: null,
                bateria_id: null,
                criado_em: new Date().toISOString(),
              },
            })
          }
        >
          + inscrever equipe
        </button>
      )}

      {equipes.length === 0 ? (
        <div className="card">
          <Vazio icone="👥">Nenhuma equipe inscrita ainda.</Vazio>
        </div>
      ) : (
        <div className="card">
          {equipes.map((e) => {
            const trechos = data.trechos
              .filter((t) => t.equipe_id === e.id)
              .sort((a, b) => a.ordem - b.ordem)
            return (
              <div className="item" key={e.id}>
                <span className="dorsal">{e.dorsal}</span>
                <div className="crescer truncar">
                  <div className="forte truncar">{e.nome}</div>
                  <div className="mini muted truncar">
                    {e.modo === 'solo' ? 'Solo' : `Grupo de ${e.atleta_ids.length}`}
                    {e.categoria ? ` · ${e.categoria}` : ''}
                    {trechos.length === 0 ? ' · ⚠️ sem trechos' : ''}
                  </div>
                  {e.modo === 'grupo' && trechos.length > 0 && (
                    <div className="mini muted truncar">
                      {trechos
                        .map((t) => {
                          const m = modalidades.find((x) => x.id === t.modalidade_id)
                          return `${m?.nome ?? '?'}: ${nomeDe(t.atleta_id)}`
                        })
                        .join(' · ')}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <button className="btn ghost sm" onClick={() => setEditando({ equipe: e, nova: false })}>
                    editar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <FormEquipe
          equipe={editando.equipe}
          nova={editando.nova}
          evento={evento}
          modalidades={modalidades}
          dorsaisUsados={equipes.filter((e) => e.id !== editando.equipe.id).map((e) => e.dorsal)}
          onFechar={() => setEditando(null)}
          onSalvar={(equipe, trechos) => {
            salvarEquipe(equipe)
            trocarTrechos(equipe.id, trechos)
            setEditando(null)
          }}
          onApagar={() => {
            apagarEquipe(editando.equipe.id)
            setEditando(null)
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------

function FormEquipe({
  equipe,
  nova,
  evento,
  modalidades,
  dorsaisUsados,
  onSalvar,
  onApagar,
  onFechar,
}: {
  equipe: Equipe
  nova: boolean
  evento: Evento
  modalidades: Modalidade[]
  dorsaisUsados: number[]
  onSalvar: (e: Equipe, t: Trecho[]) => void
  onApagar: () => void
  onFechar: () => void
}) {
  const { data, nomeDe } = useStore()
  const trechosAtuais = data.trechos
    .filter((t) => t.equipe_id === equipe.id)
    .sort((a, b) => a.ordem - b.ordem)

  const [e, setE] = useState<Equipe>(equipe)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  // quem faz cada modalidade, por id de modalidade
  const [porModalidade, setPorModalidade] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const t of trechosAtuais) m[t.modalidade_id] = t.atleta_id
    return m
  })
  // o nome foi escrito a mao? senao ele acompanha os atletas escolhidos
  const [nomeManual, setNomeManual] = useState(Boolean(equipe.nome))

  const atletas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return data.atletas
      .filter((a) => a.ativo)
      .filter((a) => !q || a.nome.toLowerCase().includes(q) || (a.apelido ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [data.atletas, busca])

  const escolhidos = e.atleta_ids

  function nomeAutomatico(ids: string[], modo: ModoEquipe): string {
    if (ids.length === 0) return ''
    if (modo === 'solo') return nomeDe(ids[0])
    return ids.map(nomeDe).join(' e ')
  }

  function alternarAtleta(id: string) {
    let ids: string[]
    if (e.modo === 'solo') {
      ids = escolhidos[0] === id ? [] : [id]
    } else {
      ids = escolhidos.includes(id) ? escolhidos.filter((x) => x !== id) : [...escolhidos, id]
    }
    setE((x) => ({
      ...x,
      atleta_ids: ids,
      nome: nomeManual ? x.nome : nomeAutomatico(ids, x.modo),
    }))
    // atribuicoes que apontam para quem saiu deixam de valer
    setPorModalidade((p) => {
      const novo: Record<string, string> = {}
      for (const [mid, aid] of Object.entries(p)) if (ids.includes(aid)) novo[mid] = aid
      return novo
    })
  }

  function trocarModo(modo: ModoEquipe) {
    const ids = modo === 'solo' ? escolhidos.slice(0, 1) : escolhidos
    setE((x) => ({ ...x, modo, atleta_ids: ids, nome: nomeManual ? x.nome : nomeAutomatico(ids, modo) }))
  }

  function salvar() {
    if (escolhidos.length === 0) return setErro('Escolha quem vai competir.')
    if (e.modo === 'grupo' && escolhidos.length < 2) {
      return setErro('Um grupo precisa de pelo menos duas pessoas. Para uma só, use o modo Solo.')
    }
    if (dorsaisUsados.includes(e.dorsal)) {
      return setErro(`O número ${e.dorsal} já é de outra equipe.`)
    }
    if (evento.criterios.includes('livre') && !e.categoria) {
      return setErro('Escolha a categoria desta equipe.')
    }

    // solo: a mesma pessoa em todos os trechos.
    // grupo: o que voce atribuiu a cada modalidade.
    const trechos: Trecho[] = []
    for (const [i, m] of modalidades.entries()) {
      const atleta_id = e.modo === 'solo' ? escolhidos[0] : porModalidade[m.id]
      if (!atleta_id) {
        return setErro(`Falta dizer quem faz ${m.nome}.`)
      }
      trechos.push({
        id: trechosAtuais.find((t) => t.modalidade_id === m.id)?.id ?? uid(),
        equipe_id: e.id,
        ordem: i + 1,
        modalidade_id: m.id,
        atleta_id,
      })
    }

    onSalvar({ ...e, nome: e.nome.trim() || nomeAutomatico(escolhidos, e.modo) }, trechos)
  }

  return (
    <Modal titulo={nova ? 'Inscrever equipe' : `Equipe ${equipe.dorsal}`} onFechar={onFechar}>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="campo" style={{ width: 96 }}>
          <span>Número</span>
          <input
            inputMode="numeric"
            value={String(e.dorsal)}
            onChange={(ev) => setE((x) => ({ ...x, dorsal: Number(ev.target.value.replace(/\D/g, '')) || 0 }))}
          />
        </label>
        <label className="campo crescer">
          <span>Nome da equipe</span>
          <input
            value={e.nome}
            onChange={(ev) => {
              setNomeManual(true)
              setE((x) => ({ ...x, nome: ev.target.value }))
            }}
            placeholder="Os Bagres"
          />
        </label>
      </div>

      <label className="campo">
        <span>Formato</span>
        <div className="escolhas">
          <label className={`escolha${e.modo === 'solo' ? ' on' : ''}`}>
            <input type="radio" checked={e.modo === 'solo'} onChange={() => trocarModo('solo')} />
            <span>
              <strong>Solo</strong>
              <span className="desc">Uma pessoa faz todas as modalidades.</span>
            </span>
          </label>
          <label className={`escolha${e.modo === 'grupo' ? ' on' : ''}`}>
            <input type="radio" checked={e.modo === 'grupo'} onChange={() => trocarModo('grupo')} />
            <span>
              <strong>Grupo — cada um faz uma parte</strong>
              <span className="desc">Dupla, trio, quarteto. Você diz quem faz cada modalidade.</span>
            </span>
          </label>
        </div>
      </label>

      {evento.criterios.includes('livre') && (
        <label className="campo">
          <span>Categoria</span>
          <select
            value={e.categoria ?? ''}
            onChange={(ev) => setE((x) => ({ ...x, categoria: ev.target.value || null }))}
          >
            <option value="">Escolha…</option>
            {evento.categorias.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      )}

      <label className="campo">
        <span>{e.modo === 'solo' ? 'Quem vai competir' : 'Quem está na equipe'}</span>
        <input value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Buscar atleta" />
      </label>

      <div className="card plano" style={{ maxHeight: 210, overflow: 'auto', marginBottom: 12 }}>
        {atletas.length === 0 ? (
          <p className="pequeno muted centro" style={{ margin: 0 }}>
            Nenhum atleta cadastrado. Cadastre na aba Atletas.
          </p>
        ) : (
          atletas.map((a) => (
            <label className="item" key={a.id} style={{ cursor: 'pointer' }}>
              <input
                type={e.modo === 'solo' ? 'radio' : 'checkbox'}
                checked={escolhidos.includes(a.id)}
                onChange={() => alternarAtleta(a.id)}
                style={{ flex: 'none' }}
              />
              <div className="crescer truncar">
                <div className="truncar">{a.apelido?.trim() || a.nome}</div>
              </div>
            </label>
          ))
        )}
      </div>

      {e.modo === 'grupo' && escolhidos.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <h3>Quem faz o quê</h3>
          <p className="mini muted">
            É isto que faz o cronômetro não precisar de nome na hora da prova: um
            toque no card do grupo fecha o trecho de quem estava nele e já abre o
            do próximo.
          </p>
          {modalidades.map((m) => (
            <label className="campo" key={m.id}>
              <span>
                {m.ordem}ª · {m.nome} {distanciaLabel(m)}
              </span>
              <select
                value={porModalidade[m.id] ?? ''}
                onChange={(ev) => setPorModalidade((p) => ({ ...p, [m.id]: ev.target.value }))}
              >
                <option value="">Escolha…</option>
                {escolhidos.map((id) => (
                  <option key={id} value={id}>{nomeDe(id)}</option>
                ))}
              </select>
            </label>
          ))}
          <p className="mini muted">
            Pode repetir a mesma pessoa em mais de uma modalidade — é o caso da
            dupla numa prova de três.
          </p>
        </div>
      )}

      {erro && <div className="aviso perigo">{erro}</div>}

      <button className="btn bloco" onClick={salvar}>Salvar equipe</button>

      {!nova && (
        <button
          className="btn ghost bloco"
          style={{ marginTop: 8 }}
          onClick={() => {
            if (confirm(`Tirar a equipe ${equipe.dorsal} do evento?`)) onApagar()
          }}
        >
          Remover equipe
        </button>
      )}
    </Modal>
  )
}
