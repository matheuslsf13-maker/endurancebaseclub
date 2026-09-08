import { useMemo, useState } from 'react'
import { Toast, useToast, Vazio } from '../components/ui'
import {
  DISCORDANCIA_ALTA, espalhamento, estadoDaProva, media, mediana,
  type EstadoEquipe, type EstadoTrecho,
} from '../lib/prova'
import { dispositivoId } from '../lib/relogio'
import { useStore } from '../lib/store'
import { duracao, horaBR } from '../lib/tempo'
import type { Evento, Marcacao } from '../lib/types'
import { uid } from '../lib/types'

/**
 * CONFERENCIA — o acerto dos tempos entre os cronometristas.
 *
 * Ter tres pessoas cronometrando produz tres tempos para a mesma chegada. Isso
 * nao e problema, e informacao: juntos, os tres dizem qual foi o tempo real
 * melhor do que qualquer um deles sozinho.
 *
 * A tela poe as marcacoes lado a lado, com o nome de quem marcou, e sugere um
 * tempo. Voce confirma ou escolhe o de um cronometrista especifico.
 *
 * POR QUE A MEDIANA E NAO A MEDIA (as duas aparecem, mas a sugerida e a
 * mediana): se alguem se distrai e toca 30 segundos atrasado, a media puxa o
 * tempo de todos para longe -- a mediana simplesmente ignora esse toque. Com
 * duas marcacoes as duas contas dao no mesmo; a diferenca aparece exatamente
 * quando ha um toque torto no meio, que e o que acontece numa chegada em
 * correria.
 *
 * Adotar um tempo nao apaga nada: entra como marcacao de 'ajuste'. As dos
 * cronometristas continuam gravadas, e da para mudar de ideia depois.
 */
export default function Conferencia({ evento, onVoltar }: { evento: Evento; onVoltar: () => void }) {
  const { data, registrarMarcacoes, sessao, nomeDe, canEdit } = useStore()
  const { msg, mostrar } = useToast()
  const [soDiscordantes, setSoDiscordantes] = useState(false)

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
    return [...mapa.values()].sort((a, b) => a.equipe.dorsal - b.equipe.dorsal)
  }, [evento, data.equipes, data.trechos, data.marcacoes, modalidades])

  const operador =
    sessao.papel === 'cronometrista' ? sessao.nome : sessao.papel === 'organizador' ? sessao.email : '—'

  function adotar(e: EstadoEquipe, t: EstadoTrecho, quando: number, origem: string) {
    const m: Marcacao = {
      id: uid(),
      evento_id: evento.id,
      equipe_id: e.equipe.id,
      trecho_id: t.trecho.id,
      tipo: 'ajuste',
      marcado_em: new Date(quando).toISOString(),
      dispositivo: dispositivoId(),
      operador,
      seq_cliente: 0,
      nota: origem,
      criado_em: new Date().toISOString(),
    }
    registrarMarcacoes([m])
    mostrar(`Adotado: ${horaBR(quando)}`)
  }

  const comMarcacoes = estados.filter((e) => e.trechos.some((t) => t.marcacoes.length > 0))
  const quantosDiscordam = estados.reduce(
    (n, e) =>
      n + e.trechos.filter((t) => espalhamento(t.marcacoes.map((x) => +new Date(x.marcado_em))) > DISCORDANCIA_ALTA).length,
    0,
  )

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="crescer truncar">
          <h1 style={{ margin: 0 }}>Conferência</h1>
          <div className="pequeno muted truncar">{evento.nome}</div>
        </div>
        <button className="btn ghost sm" onClick={onVoltar}>← evento</button>
      </div>

      <div className="card">
        <p className="pequeno muted" style={{ margin: 0 }}>
          Os tempos de cada cronometrista, lado a lado. O sugerido é a
          <strong> mediana</strong> — ela ignora um toque muito atrasado, coisa
          que a média não faz. Toque em qualquer linha para adotar aquele tempo.
        </p>
        {quantosDiscordam > 0 && (
          <div className="aviso perigo" style={{ marginTop: 10, marginBottom: 0 }}>
            {quantosDiscordam} trecho(s) com mais de {DISCORDANCIA_ALTA / 1000}s de diferença entre
            os cronometristas. São esses que merecem seu olho.
          </div>
        )}
        {quantosDiscordam > 0 && (
          <label className="row" style={{ marginTop: 10, gap: 8 }}>
            <input
              type="checkbox"
              checked={soDiscordantes}
              onChange={(ev) => setSoDiscordantes(ev.target.checked)}
              style={{ flex: 'none' }}
            />
            <span className="pequeno">Mostrar só os que discordam</span>
          </label>
        )}
      </div>

      {comMarcacoes.length === 0 && (
        <div className="card">
          <Vazio icone="⏱️">Nenhuma marcação ainda.</Vazio>
        </div>
      )}

      {comMarcacoes.map((e) => {
        const trechos = e.trechos.filter((t) => {
          if (t.marcacoes.length === 0 && !t.corrigido) return false
          if (!soDiscordantes) return true
          return espalhamento(t.marcacoes.map((x) => +new Date(x.marcado_em))) > DISCORDANCIA_ALTA
        })
        if (trechos.length === 0) return null
        return (
          <div className="card" key={e.equipe.id}>
            <div className="row spread">
              <div className="row" style={{ gap: 10 }}>
                <span className="dorsal">{e.equipe.dorsal}</span>
                <strong>{e.equipe.nome}</strong>
              </div>
              {e.total !== null && <span className="selo verde">{duracao(e.total)}</span>}
            </div>

            {trechos.map((t) => {
              const tempos = t.marcacoes.map((m) => +new Date(m.marcado_em))
              const med = mediana(tempos)
              const avg = media(tempos)
              const esp = espalhamento(tempos)
              const alto = esp > DISCORDANCIA_ALTA
              return (
                <div className={`conf-trecho${alto ? ' discordante' : ''}`} key={t.trecho.id}>
                  <div className="row spread">
                    <strong className="pequeno">
                      {t.modalidade.nome} · {nomeDe(t.trecho.atleta_id)}
                    </strong>
                    <span className={`selo${alto ? ' perigo' : t.corrigido ? ' sol' : ''}`}>
                      {t.corrigido
                        ? 'tempo escolhido'
                        : tempos.length === 0
                          ? 'sem marcação'
                          : tempos.length === 1
                            ? '1 cronometrista'
                            : `${tempos.length} cronometristas · ${duracao(esp)} de diferença`}
                    </span>
                  </div>

                  {t.marcacoes.map((m) => {
                    const q = +new Date(m.marcado_em)
                    return (
                      <button
                        key={m.id}
                        className={`conf-marca${t.fechadoEm === q ? ' adotado' : ''}`}
                        disabled={!canEdit}
                        onClick={() => adotar(e, t, q, `escolhido: marcação de ${m.operador}`)}
                      >
                        <span className="op truncar">
                          {m.operador || '—'}
                          <span className="mini muted"> · {m.dispositivo}</span>
                        </span>
                        <span className="hora">{horaBR(q)}</span>
                      </button>
                    )
                  })}

                  {tempos.length > 1 && (
                    <>
                      <button
                        className={`conf-marca${!t.corrigido ? ' adotado' : ''}`}
                        disabled={!canEdit}
                        onClick={() => med !== null && adotar(e, t, med, 'mediana dos cronometristas')}
                      >
                        <span className="op forte">Sugerido (mediana)</span>
                        <span className="hora">{med !== null ? horaBR(med) : '—'}</span>
                      </button>
                      <button
                        className="conf-marca"
                        disabled={!canEdit}
                        onClick={() => avg !== null && adotar(e, t, avg, 'média dos cronometristas')}
                      >
                        <span className="op muted">Média</span>
                        <span className="hora muted">{avg !== null ? horaBR(avg) : '—'}</span>
                      </button>
                    </>
                  )}

                  {t.duracao !== null && (
                    <p className="mini muted" style={{ margin: '8px 0 0' }}>
                      Tempo do trecho com o valor adotado: <strong>{duracao(t.duracao)}</strong>
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      <Toast mensagem={msg} />
    </div>
  )
}
