import { useMemo } from 'react'
import { Vazio } from '../components/ui'
import { acumulados, evolucao, formacoes, historicoDoAtleta, recordes } from '../lib/estatisticas'
import { useStore } from '../lib/store'
import { duracao, pace } from '../lib/tempo'
import { dataLabel, idadeNa, numeroBR } from '../lib/types'

/**
 * Perfil do atleta: o que ele ja fez, e se esta melhorando.
 *
 * A comparacao entre eventos e sempre por PACE, nunca por tempo: 3 km e 5 km
 * nao se comparam por tempo. E o percentil serve para comparar desempenho entre
 * provas de tamanhos diferentes -- 3o entre 20 vale mais que 3o entre 4.
 */
export default function Atleta({ atletaId, onVoltar }: { atletaId: string; onVoltar: () => void }) {
  const { data, nomeDe } = useStore()
  const atleta = data.atletas.find((a) => a.id === atletaId)

  const participacoes = useMemo(() => historicoDoAtleta(data, atletaId), [data, atletaId])
  const ac = useMemo(() => acumulados(participacoes), [participacoes])
  const recs = useMemo(() => recordes(participacoes), [participacoes])
  const forms = useMemo(() => formacoes(participacoes, atletaId), [participacoes, atletaId])

  const modalidadesFeitas = useMemo(
    () => [...new Set(participacoes.flatMap((p) => p.meusTrechos.map((t) => t.trecho.modalidade.nome)))],
    [participacoes],
  )

  if (!atleta) {
    return (
      <div className="card">
        <p>Atleta não encontrado.</p>
        <button className="btn alt" onClick={onVoltar}>Voltar</button>
      </div>
    )
  }

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="crescer truncar">
          <h1 style={{ margin: 0 }} className="truncar">{atleta.apelido?.trim() || atleta.nome}</h1>
          <div className="pequeno muted truncar">
            {atleta.apelido?.trim() ? atleta.nome : ''}
          </div>
        </div>
        <button className="btn ghost sm" onClick={onVoltar}>← atletas</button>
      </div>

      {participacoes.length === 0 ? (
        <div className="card">
          <Vazio icone="🏃">
            Ainda não participou de nenhuma prova. O histórico começa no primeiro
            evento.
          </Vazio>
        </div>
      ) : (
        <>
          {/* ---------- carreira ---------- */}
          <div className="card">
            <h2>Carreira</h2>
            <div className="numeros">
              <Numero k="Eventos" v={ac.eventos} />
              <Numero k="Concluídos" v={ac.concluidos} />
              <Numero k="Pódios" v={ac.podios} />
              <Numero k="Vitórias" v={ac.vitorias} />
            </div>
            <div className="numeros" style={{ marginTop: 8 }}>
              <Numero k="Km total" v={numeroBR(ac.kmTotal, 1)} />
              {ac.percentilMedio !== null && <Numero k="Percentil médio" v={ac.percentilMedio} />}
            </div>
            {ac.kmPorModalidade.length > 0 && (
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                {ac.kmPorModalidade.map((k) => (
                  <span className="selo agua" key={k.nome}>
                    {k.nome} {numeroBR(k.km, 1)} km
                  </span>
                ))}
              </div>
            )}
            {ac.melhorModalidade && (
              <p className="pequeno muted" style={{ marginTop: 10, marginBottom: 0 }}>
                Rende mais em <strong>{ac.melhorModalidade}</strong>
                {ac.piorModalidade && ac.piorModalidade !== ac.melhorModalidade
                  ? ` e menos em ${ac.piorModalidade}`
                  : ''}
                . Comparação por percentil, então vale entre provas de tamanhos
                diferentes.
              </p>
            )}
          </div>

          {/* ---------- recordes ---------- */}
          {recs.length > 0 && (
            <div className="card">
              <h2>Recordes pessoais</h2>
              <p className="mini muted">
                Por modalidade <strong>e distância</strong> — “melhor tempo de
                corrida” não diz nada se num evento foram 3 km e no outro 8.
              </p>
              {recs.map((r) => (
                <div className="item" key={r.chave}>
                  <div className="crescer truncar">
                    <div className="forte truncar">{r.chave}</div>
                    <div className="mini muted">
                      {dataLabel(r.quando)} · {r.vezes}x
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="forte">{duracao(r.melhorTempo)}</div>
                    <div className="mini muted">{pace(r.melhorPace, 1)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---------- evolução ---------- */}
          {modalidadesFeitas.map((nome) => {
            const pontos = evolucao(participacoes, nome)
            if (pontos.length < 2) return null
            const melhor = Math.min(...pontos.map((p) => p.paceMs))
            const pior = Math.max(...pontos.map((p) => p.paceMs))
            const primeiro = pontos[0].paceMs
            const ultimo = pontos[pontos.length - 1].paceMs
            const ganho = primeiro - ultimo
            return (
              <div className="card" key={nome}>
                <div className="row spread">
                  <h2 style={{ margin: 0 }}>Evolução · {nome}</h2>
                  <span className={`selo ${ganho > 0 ? 'verde' : ganho < 0 ? 'perigo' : ''}`}>
                    {ganho > 0
                      ? `${duracao(ganho)}/km mais rápido`
                      : ganho < 0
                        ? `${duracao(-ganho)}/km mais lento`
                        : 'igual'}
                  </span>
                </div>
                <div className="barras">
                  {pontos.map((p, i) => {
                    // barra mais alta = mais rapido, que e o que a pessoa quer ver
                    const escala = pior === melhor ? 1 : (pior - p.paceMs) / (pior - melhor)
                    return (
                      <div className="barra" key={i} title={`${p.evento}: ${pace(p.paceMs, 1)}`}>
                        <div className="haste" style={{ height: `${20 + escala * 70}%` }} />
                        <span className="mini muted">{p.data.slice(5).split('-').reverse().join('/')}</span>
                      </div>
                    )
                  })}
                </div>
                <p className="mini muted" style={{ marginBottom: 0 }}>
                  Barra mais alta = pace melhor. Melhor: {pace(melhor, 1)} · pior:{' '}
                  {pace(pior, 1)}
                </p>
              </div>
            )
          })}

          {/* ---------- formações ---------- */}
          {forms.length > 0 && (
            <div className="card">
              <h2>Com quem já competiu</h2>
              {forms.map((f) => (
                <div className="item" key={f.chave}>
                  <div className="crescer truncar">
                    <div className="forte truncar">{f.parceiros.map(nomeDe).join(' e ')}</div>
                    <div className="mini muted">
                      {f.eventos} evento(s) · {f.concluidos} concluído(s)
                      {f.vitorias > 0 ? ` · ${f.vitorias} vitória(s)` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="forte">{f.melhorPosicao ? `${f.melhorPosicao}º` : '—'}</div>
                    <div className="mini muted">
                      {f.posicaoMedia !== null ? `média ${f.posicaoMedia}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---------- participações ---------- */}
          <div className="card">
            <h2>Provas</h2>
            {participacoes.map((p) => (
              <div className="item" key={`${p.evento.id}-${p.equipe.id}`} style={{ display: 'block' }}>
                <div className="row spread">
                  <div className="crescer truncar">
                    <div className="forte truncar">{p.evento.nome}</div>
                    <div className="mini muted truncar">
                      {dataLabel(p.evento.data)} · {p.equipe.nome}
                      {p.categorias.length ? ` · ${p.categorias.join(', ')}` : ''}
                      {idadeNa(atleta.nascimento, p.evento.data) !== null
                        ? ` · ${idadeNa(atleta.nascimento, p.evento.data)} anos`
                        : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="forte">
                      {p.posicao ? `${p.posicao}º` : '—'}
                      {p.posicao ? <span className="mini muted"> de {p.quantasEquipes}</span> : null}
                    </div>
                    <div className="mini muted">
                      {p.estado.total !== null ? duracao(p.estado.total) : ''}
                    </div>
                  </div>
                </div>
                {p.meusTrechos.map((t) => (
                  <div className="row spread trecho-linha" key={t.trecho.trecho.id}>
                    <span className="pequeno truncar">{t.trecho.modalidade.nome}</span>
                    <span className="pequeno">
                      <span className="muted">
                        {pace(t.paceMs, 1)} · {t.posicao}º · perc. {t.percentil}{'  '}
                      </span>
                      <strong>{duracao(t.trecho.duracao as number)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Numero({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="numero">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  )
}
