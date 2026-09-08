import { useMemo, useState } from 'react'
import { Toast, useToast, Vazio } from '../components/ui'
import { nomeDeArquivo, planilhasDoEvento } from '../lib/exportar'
import { estadoDaProva } from '../lib/prova'
import {
  classificar, classificarEm, fatiaDoTempo, rankingDaModalidade,
  resumoDaModalidade, rotulosDoEvento,
} from '../lib/resultados'
import { useStore } from '../lib/store'
import { diferenca, duracao, ritmo, ritmoLabel } from '../lib/tempo'
import type { Evento } from '../lib/types'
import { distanciaLabel, emKm } from '../lib/types'
import { baixar, montarXlsx } from '../lib/xlsx'

/**
 * Resultados do evento.
 *
 * A classificacao geral existe sempre; as separadas saem dos criterios que o
 * organizador escolheu ao criar o evento. Alem delas ha uma aba por modalidade
 * -- "quem foi o melhor nadador do dia" e uma pergunta que a classificacao
 * geral nao responde, porque o tempo total mistura tudo.
 */
export default function Resultados({ evento, onVoltar }: { evento: Evento; onVoltar: () => void }) {
  const { data, nomeDe } = useStore()
  const { msg, mostrar } = useToast()
  const [aba, setAba] = useState<string>('geral')

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
    return [...mapa.values()]
  }, [evento, data.equipes, data.trechos, data.marcacoes, modalidades])

  const atletas = useMemo(() => new Map(data.atletas.map((a) => [a.id, a])), [data.atletas])
  const geral = useMemo(() => classificar(estados, evento, atletas), [estados, evento, atletas])
  const rotulos = useMemo(() => rotulosDoEvento(geral, evento), [geral, evento])

  const modalidadeAberta = modalidades.find((m) => `mod:${m.id}` === aba)
  const linhas = modalidadeAberta
    ? []
    : aba === 'geral'
      ? geral
      : classificarEm(geral, aba)

  function exportar() {
    try {
      const blob = montarXlsx(planilhasDoEvento(evento, estados, data))
      baixar(blob, nomeDeArquivo(`${evento.nome} ${evento.data}`))
      mostrar('Planilha gerada')
    } catch (e) {
      mostrar('Não consegui gerar: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const concluiram = geral.filter((l) => l.posicao !== null).length

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="crescer truncar">
          <h1 style={{ margin: 0 }}>Resultados</h1>
          <div className="pequeno muted truncar">{evento.nome}</div>
        </div>
        <button className="btn ghost sm" onClick={onVoltar}>← evento</button>
      </div>

      <button className="btn bloco" style={{ marginBottom: 12 }} onClick={exportar}>
        📊 Exportar para Excel
      </button>
      <p className="mini muted" style={{ marginTop: -6 }}>
        Sete abas: classificação, tempos por modalidade, estatísticas, atletas,
        histórico, carreira e o log completo das marcações com o nome de cada
        cronometrista.
      </p>

      <div className="abas" style={{ position: 'static' }}>
        <button className={aba === 'geral' ? 'on' : ''} onClick={() => setAba('geral')}>
          Geral
        </button>
        {rotulos.map((r) => (
          <button key={r} className={aba === r ? 'on' : ''} onClick={() => setAba(r)}>
            {r}
          </button>
        ))}
        {modalidades.map((m) => (
          <button
            key={m.id}
            className={aba === `mod:${m.id}` ? 'on' : ''}
            onClick={() => setAba(`mod:${m.id}`)}
          >
            {m.nome}
          </button>
        ))}
      </div>

      {concluiram === 0 && !modalidadeAberta && (
        <div className="card">
          <Vazio icone="🏁">Ninguém terminou a prova ainda.</Vazio>
        </div>
      )}

      {/* ---------- classificação ---------- */}
      {!modalidadeAberta &&
        linhas.map((l) => {
          const fatias = fatiaDoTempo(l.estado)
          return (
            <div className="card" key={l.estado.equipe.id}>
              <div className="row" style={{ gap: 10 }}>
                <span className={`posicao${l.posicao && l.posicao <= 3 ? ` p${l.posicao}` : ''}`}>
                  {l.posicao ?? '—'}
                </span>
                <div className="crescer truncar">
                  <div className="forte truncar">{l.estado.equipe.nome}</div>
                  <div className="mini muted truncar">
                    #{l.estado.equipe.dorsal} ·{' '}
                    {l.estado.equipe.atleta_ids.map(nomeDe).join(', ')}
                    {l.categorias.length > 0 ? ` · ${l.categorias.join(', ')}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="forte" style={{ fontSize: 17 }}>
                    {l.estado.total !== null ? duracao(l.estado.total) : '—'}
                  </div>
                  {l.atras !== null && <div className="mini muted">{diferenca(l.atras)}</div>}
                </div>
              </div>

              {l.estado.trechos.some((t) => t.duracao !== null) && (
                <div style={{ marginTop: 10 }}>
                  {l.estado.trechos
                    .filter((t) => t.duracao !== null)
                    .map((t) => (
                      <div className="row spread trecho-linha" key={t.trecho.id}>
                        <span className="pequeno truncar">
                          {t.modalidade.nome} · {nomeDe(t.trecho.atleta_id)}
                        </span>
                        <span className="pequeno">
                          <span className="muted">
                            {ritmo(t.modalidade.nome, t.duracao as number, emKm(t.modalidade))}
                            {' · '}
                            {fatias.find((f) => f.trecho === t)?.parte ?? '—'}%
                            {'  '}
                          </span>
                          <strong>{duracao(t.duracao as number)}</strong>
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )
        })}

      {/* ---------- ranking de uma modalidade ---------- */}
      {modalidadeAberta &&
        (() => {
          const ranking = rankingDaModalidade(estados, modalidadeAberta)
          const resumo = resumoDaModalidade(ranking)
          if (ranking.length === 0) {
            return (
              <div className="card">
                <Vazio icone="⏱️">Ninguém fechou {modalidadeAberta.nome} ainda.</Vazio>
              </div>
            )
          }
          return (
            <>
              <div className="card">
                <div className="row spread">
                  <strong>
                    {modalidadeAberta.nome} · {distanciaLabel(modalidadeAberta)}
                  </strong>
                  <span className="selo agua">{ritmoLabel(modalidadeAberta.nome)}</span>
                </div>
                {resumo && (
                  <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                    <span className="selo verde">melhor {duracao(resumo.melhor)}</span>
                    <span className="selo">média {duracao(resumo.media)}</span>
                    <span className="selo">pior {duracao(resumo.pior)}</span>
                  </div>
                )}
              </div>
              <div className="card">
                {ranking.map((d) => (
                  <div className="item" key={d.trecho.trecho.id}>
                    <span className={`posicao${d.posicao <= 3 ? ` p${d.posicao}` : ''}`}>{d.posicao}</span>
                    <div className="crescer truncar">
                      <div className="forte truncar">{nomeDe(d.atletaId)}</div>
                      <div className="mini muted truncar">
                        #{d.equipe.dorsal} {d.equipe.nome} · percentil {d.percentil}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="forte">{duracao(d.duracao)}</div>
                      <div className="mini muted">
                        {ritmo(modalidadeAberta.nome, d.duracao, d.km)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        })()}

      <Toast mensagem={msg} />
    </div>
  )
}
