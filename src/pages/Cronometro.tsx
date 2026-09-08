import { useMemo, useRef, useState } from 'react'
import { Toast, useToast } from '../components/ui'
import { confirmar } from '../lib/feedback'
import {
  atletaAtual, confirmando, estadoDaProva, JANELA_CONFIRMACAO, ordemDeChegada,
  trechoAberto, type EstadoEquipe,
} from '../lib/prova'
import { agoraISO, confiavel, dispositivoId, selo } from '../lib/relogio'
import { useStore } from '../lib/store'
import { duracao, horaBR } from '../lib/tempo'
import type { Evento, Marcacao } from '../lib/types'
import { uid } from '../lib/types'
import { useAgora, useRelogio } from '../lib/useRelogio'

/**
 * A TELA DO CRONOMETRO.
 *
 * Regra numero um: NAO SE DIGITA NADA AQUI. Numa chegada de natacao podem vir
 * quatro duplas quase juntas -- nao ha tempo de procurar, digitar nome nem
 * escolher em menu. O unico gesto e um toque no card.
 *
 * O toque nao pergunta nada porque nao precisa: a configuracao do evento ja
 * disse quem faz cada modalidade. Ele fecha o trecho de quem estava nele e abre
 * o do proximo -- e assim sai o tempo individual exato de cada um do grupo, sem
 * trabalho nenhum na hora da prova.
 */

/*  O segundo toque na mesma chegada nao fecha o proximo trecho: vira outra
    marcacao do mesmo. A regra e a janela vivem em lib/prova.ts, porque a
    ordenacao dos cards depende dela tambem.  */

export default function Cronometro({ evento, onVoltar }: { evento: Evento; onVoltar: () => void }) {
  const { data, registrarMarcacoes, sessao, nomeDe, pendingCount } = useStore()
  const relogio = useRelogio()
  const agora = useAgora(relogio)
  const { msg, mostrar } = useToast()
  const [filtro, setFiltro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ultima, setUltima] = useState<{ marcacao: Marcacao; texto: string; em: number } | null>(null)
  const seq = useRef(0)

  const operador =
    sessao.papel === 'cronometrista' ? sessao.nome : sessao.papel === 'organizador' ? sessao.email : '—'
  const dispositivo = useMemo(() => dispositivoId(), [])

  const modalidades = useMemo(
    () => data.modalidades.filter((m) => m.evento_id === evento.id).sort((a, b) => a.ordem - b.ordem),
    [data.modalidades, evento.id],
  )

  const estados = useMemo(() => {
    const mapa = estadoDaProva(
      evento,
      data.equipes.filter((e) => e.evento_id === evento.id),
      data.trechos,
      modalidades,
      data.marcacoes,
    )
    // reordena a cada segundo (nao a cada decimo): o suficiente para o card em
    // confirmacao subir na hora, sem a lista tremer debaixo do dedo
    return ordemDeChegada([...mapa.values()], Math.floor(agora / 1000) * 1000)
  }, [evento, data.equipes, data.trechos, data.marcacoes, modalidades, agora])

  const largou = estados.some((e) => e.largadaEm !== null)
  const largadaEm = estados.map((e) => e.largadaEm).filter((x): x is number => x !== null).sort()[0] ?? null

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return estados.filter((e) => {
      if (q) {
        const alvo = `${e.equipe.dorsal} ${e.equipe.nome} ${e.equipe.atleta_ids.map(nomeDe).join(' ')}`
        if (!alvo.toLowerCase().includes(q)) return false
      }
      if (filtro) {
        const t = trechoAberto(e)
        if (!t || t.modalidade.id !== filtro) return false
      }
      return true
    })
  }, [estados, busca, filtro, nomeDe])

  function nova(parcial: Omit<Marcacao, 'id' | 'evento_id' | 'dispositivo' | 'operador' | 'seq_cliente' | 'criado_em'>): Marcacao {
    return {
      id: uid(),
      evento_id: evento.id,
      dispositivo,
      operador,
      seq_cliente: seq.current++,
      criado_em: new Date().toISOString(),
      ...parcial,
    }
  }

  function darLargada() {
    if (!confirm('Dar a largada agora? O tempo começa a contar neste instante.')) return
    const m = nova({ equipe_id: null, trecho_id: null, tipo: 'largada', marcado_em: agoraISO(relogio) })
    registrarMarcacoes([m])
    confirmar(true)
    mostrar(`Largada às ${horaBR(m.marcado_em)}`)
  }

  /** O que o proximo toque neste card vai fazer. */
  function alvo(e: EstadoEquipe) {
    // largada individual: o toque larga esta equipe
    if (e.status === 'aguardando' && evento.tipo_largada === 'individual') {
      return { tipo: 'largar' as const }
    }
    // Acabou de passar: o toque de QUEM AINDA NAO MARCOU aquele trecho e uma
    // confirmacao do mesmo momento, nao uma passagem nova.
    //
    // Para quem ja marcou, a janela nao vale -- seu voto ja esta dado, entao o
    // proximo toque fecha o trecho seguinte normalmente. Sem essa ressalva, o
    // cronometrista que marcou ficava 45 segundos sem conseguir fechar o
    // proximo trecho, o que trava a prova quando um trecho e curto.
    const anterior = confirmando(e, agora)
    if (anterior && !anterior.marcacoes.some((m) => m.dispositivo === dispositivo)) {
      return { tipo: 'confirmar' as const, trecho: anterior }
    }
    const aberto = trechoAberto(e)
    if (aberto) {
      const ultimo = e.atual === e.trechos.length - 1
      return { tipo: ultimo ? ('chegada' as const) : ('passagem' as const), trecho: aberto }
    }
    return { tipo: 'nada' as const }
  }

  function tocar(e: EstadoEquipe) {
    const a = alvo(e)
    if (a.tipo === 'nada') return

    if (a.tipo === 'largar') {
      const m = nova({ equipe_id: e.equipe.id, trecho_id: null, tipo: 'largada', marcado_em: agoraISO(relogio) })
      registrarMarcacoes([m])
      confirmar()
      setUltima({ marcacao: m, texto: `${e.equipe.nome} largou`, em: Date.now() })
      mostrar(`${e.equipe.nome} largou às ${horaBR(m.marcado_em)}`)
      return
    }

    // o mesmo aparelho nao vota duas vezes no mesmo trecho
    if (a.trecho.marcacoes.some((x) => x.dispositivo === dispositivo)) {
      mostrar('Você já marcou este trecho')
      return
    }

    const chegada = a.tipo === 'chegada' || (a.tipo === 'confirmar' && a.trecho === e.trechos[e.trechos.length - 1])
    const m = nova({
      equipe_id: e.equipe.id,
      trecho_id: a.trecho.trecho.id,
      tipo: chegada ? 'chegada' : 'passagem',
      marcado_em: agoraISO(relogio),
    })
    registrarMarcacoes([m])
    confirmar(chegada)

    const quem = nomeDe(a.trecho.trecho.atleta_id)
    const texto =
      a.tipo === 'confirmar'
        ? `Confirmou ${a.trecho.modalidade.nome} de ${quem}`
        : chegada
          ? `${e.equipe.nome} FINALIZOU`
          : `${a.trecho.modalidade.nome} de ${quem} fechada`
    setUltima({ marcacao: m, texto, em: Date.now() })
  }

  function desfazer() {
    if (!ultima) return
    registrarMarcacoes([
      nova({
        equipe_id: ultima.marcacao.equipe_id,
        trecho_id: ultima.marcacao.trecho_id,
        tipo: 'desfazer',
        marcado_em: agoraISO(relogio),
        anula_id: ultima.marcacao.id,
      }),
    ])
    setUltima(null)
    mostrar('Desfeito')
  }

  const podeDesfazer = ultima && Date.now() - ultima.em < 10000

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 10 }}>
        <div className="crescer truncar">
          <h1 style={{ margin: 0 }} className="truncar">{evento.nome}</h1>
          <div className="pequeno muted truncar">Cronometrando como {operador}</div>
        </div>
        <button className="btn ghost sm" onClick={onVoltar}>sair</button>
      </div>

      <div className="card relogio-card">
        <div className="hora-agora">{horaBR(agora)}</div>
        <div className="pequeno muted">horário de Brasília</div>
        {largadaEm !== null && <div className="prova-corrida">{duracao(agora - largadaEm)}</div>}
        <div className={`selo ${confiavel(relogio) ? 'verde' : 'perigo'}`} style={{ marginTop: 8 }}>
          {selo(relogio)}
        </div>
        {pendingCount > 0 && (
          <div className="selo sol" style={{ marginTop: 6 }}>
            {pendingCount} marcação(ões) na fila — os tempos já estão gravados
          </div>
        )}
      </div>

      {!confiavel(relogio) && (
        <div className="aviso perigo">
          O relógio deste aparelho ainda não bateu com o do servidor. Espere
          alguns segundos antes de dar a largada — os tempos podem sair
          deslocados dos outros celulares.
        </div>
      )}

      {!largou && evento.tipo_largada === 'massa' && (
        <button className="btn sol lg bloco largada" onClick={darLargada}>
          DAR LARGADA
        </button>
      )}
      {!largou && evento.tipo_largada === 'individual' && (
        <div className="aviso">Largada individual: toque no card da equipe para largar.</div>
      )}
      {!largou && evento.tipo_largada === 'baterias' && (
        <div className="aviso">
          Largada em baterias ainda não está pronta. Por ora, use “em massa” ou
          “individual” na configuração do evento.
        </div>
      )}

      {modalidades.length > 1 && (
        <div className="abas" style={{ position: 'static', marginBottom: 10 }}>
          <button className={filtro === null ? 'on' : ''} onClick={() => setFiltro(null)}>
            Todas
          </button>
          {modalidades.map((m) => (
            <button key={m.id} className={filtro === m.id ? 'on' : ''} onClick={() => setFiltro(m.id)}>
              {m.nome}
            </button>
          ))}
        </div>
      )}

      {estados.length > 8 && (
        <input
          value={busca}
          onChange={(ev) => setBusca(ev.target.value)}
          placeholder="Buscar (só se precisar)"
          style={{ marginBottom: 10 }}
        />
      )}

      {visiveis.map((e) => {
        const a = alvo(e)
        // o card mostra sempre o trecho EM ANDAMENTO na linha principal; o
        // trecho que acabou de fechar aparece so na linha de confirmacao
        const atual = trechoAberto(e)
        const fechou = a.tipo === 'confirmar' ? a.trecho : null
        const quem = atletaAtual(e)
        const desde = atual?.iniciadoEm ?? null
        return (
          <button
            key={e.equipe.id}
            className={`equipe-card ${e.status}${a.tipo === 'confirmar' ? ' confirmando' : ''}`}
            onClick={() => tocar(e)}
            disabled={a.tipo === 'nada'}
          >
            <span className="dorsal">{e.equipe.dorsal}</span>
            <span className="crescer" style={{ minWidth: 0, textAlign: 'left' }}>
              <span className="nome truncar">{e.equipe.nome}</span>
              <span className="linha truncar">
                {e.status === 'finalizado' && a.tipo !== 'confirmar'
                  ? `Finalizou em ${duracao(e.total ?? 0)}`
                  : e.status === 'aguardando'
                    ? 'Aguardando largada'
                    : e.status === 'dnf'
                      ? 'Não terminou'
                      : e.status === 'dns'
                        ? 'Não largou'
                        : `${atual?.modalidade.nome ?? ''}${quem ? ` · ${nomeDe(quem)}` : ''}`}
              </span>
              {fechou && (
                <span className="confirma">
                  {fechou.modalidade.nome} {fechou.duracao !== null ? duracao(fechou.duracao) : ''} ✓
                  {' — toque para confirmar '}
                  ({Math.ceil((JANELA_CONFIRMACAO - (agora - (fechou.fechadoEm ?? 0))) / 1000)}s
                  {fechou.marcacoes.length > 1 ? ` · ${fechou.marcacoes.length} marcaram` : ''})
                </span>
              )}
            </span>
            <span className="tempo">
              {e.status === 'em_prova' && desde !== null
                ? duracao(agora - desde)
                : e.status === 'finalizado'
                  ? duracao(e.total ?? 0)
                  : '—'}
            </span>
          </button>
        )
      })}

      {visiveis.length === 0 && (
        <div className="card">
          <p className="centro muted" style={{ margin: 0 }}>
            {estados.length === 0 ? 'Nenhuma equipe inscrita.' : 'Nada nesse filtro.'}
          </p>
        </div>
      )}

      {podeDesfazer && (
        <div className="desfazer-barra">
          <span className="texto">{ultima?.texto}</span>
          <button className="btn alt sm" onClick={desfazer}>DESFAZER</button>
        </div>
      )}

      <Toast mensagem={msg} acima={Boolean(podeDesfazer)} />
    </div>
  )
}
