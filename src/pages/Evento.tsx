import { useMemo, useState } from 'react'
import { compartilharOuCopiar, useToast, Toast } from '../components/ui'
import { useStore } from '../lib/store'
import { dataLabel, distanciaLabel, emKm, novoCodigo } from '../lib/types'

const ROTULO_LARGADA: Record<string, string> = {
  massa: 'Em massa — todos largam juntos',
  baterias: 'Em baterias',
  individual: 'Individual',
}

export default function Evento({
  eventoId,
  onEditar,
  onEquipes,
  onCronometro,
  onConferencia,
  onResultados,
  onVoltar,
}: {
  eventoId: string
  onEditar: () => void
  onEquipes: () => void
  onCronometro: () => void
  onConferencia: () => void
  onResultados: () => void
  onVoltar: () => void
}) {
  const { data, canEdit, salvarEvento, apagarEvento } = useStore()
  const { msg, mostrar } = useToast()
  const [mostrandoCodigo, setMostrandoCodigo] = useState(false)

  const evento = data.eventos.find((e) => e.id === eventoId)

  const modalidades = useMemo(
    () => data.modalidades.filter((m) => m.evento_id === eventoId).sort((a, b) => a.ordem - b.ordem),
    [data.modalidades, eventoId],
  )
  const equipes = useMemo(
    () => data.equipes.filter((q) => q.evento_id === eventoId),
    [data.equipes, eventoId],
  )

  if (!evento) {
    return (
      <div className="card">
        <p>Evento não encontrado.</p>
        <button className="btn alt" onClick={onVoltar}>Voltar</button>
      </div>
    )
  }

  const distanciaTotal = modalidades.reduce((s, m) => s + emKm(m), 0)
  // o id do evento vai no link porque quem recebe o convite nao tem permissao
  // de ler a tabela dos codigos -- ele precisa saber de qual evento se trata
  const linkCronometrista =
    `${location.origin}${location.pathname}#/cronometrar/${evento.id}/${evento.codigo}`

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="crescer truncar">
          <h1 style={{ margin: 0 }} className="truncar">{evento.nome}</h1>
          <div className="pequeno muted">
            {dataLabel(evento.data)}
            {evento.local ? ` · ${evento.local}` : ''}
          </div>
        </div>
        <button className="btn ghost sm" onClick={onVoltar}>← eventos</button>
      </div>

      <div className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>A prova</h2>
          {canEdit && <button className="btn ghost sm" onClick={onEditar}>editar</button>}
        </div>
        <p className="pequeno muted">{ROTULO_LARGADA[evento.tipo_largada] ?? evento.tipo_largada}</p>
        {modalidades.map((m, i) => (
          <div className="item" key={m.id}>
            <span className="dorsal">{i + 1}ª</span>
            <div className="crescer">
              <div className="forte">{m.nome}</div>
              <div className="mini muted">{distanciaLabel(m)}</div>
            </div>
          </div>
        ))}
        {modalidades.length > 0 && (
          <p className="mini muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Total: {distanciaTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km
          </p>
        )}
      </div>

      <div className="card">
        <h2>Classificação</h2>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="selo verde">Geral</span>
          {evento.criterios.includes('sexo') && <span className="selo agua">Por sexo</span>}
          {evento.criterios.includes('faixa') &&
            evento.faixas.map((f) => <span className="selo agua" key={f.nome}>{f.nome}</span>)}
          {evento.criterios.includes('livre') &&
            evento.categorias.map((c) => <span className="selo sol" key={c}>{c}</span>)}
        </div>
      </div>

      {canEdit && (
        <div className="card">
          <h2>Quem vai cronometrar</h2>
          <p className="pequeno muted">
            Mande este link para quem vai ajudar. A pessoa abre, digita o próprio
            nome e já marca tempo — sem criar conta. Ela só consegue marcar tempo
            <strong> deste evento</strong>: não apaga nada nem mexe no cadastro.
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              className="btn"
              onClick={() =>
                void compartilharOuCopiar(
                  `Cronometragem do ${evento.nome}\n${linkCronometrista}`,
                ).then((ok) => mostrar(ok ? 'Link copiado' : 'Não consegui copiar'))
              }
            >
              Compartilhar link
            </button>
            <button className="btn ghost sm" onClick={() => setMostrandoCodigo((v) => !v)}>
              {mostrandoCodigo ? 'esconder código' : 'ver código'}
            </button>
            <button
              className="btn ghost sm"
              onClick={() => {
                if (!confirm('Gerar um código novo? Os links antigos param de funcionar.')) return
                salvarEvento({ ...evento, codigo: novoCodigo() })
                mostrar('Código novo gerado')
              }}
            >
              gerar código novo
            </button>
          </div>
          {mostrandoCodigo && (
            <p className="forte" style={{ marginTop: 10, letterSpacing: 2, fontSize: 20 }}>
              {evento.codigo || '—'}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <h2>Equipes</h2>
        <p className="pequeno muted">
          {equipes.length === 0
            ? 'Nenhuma equipe inscrita ainda.'
            : `${equipes.length} equipe(s) inscrita(s).`}
        </p>
        <button className="btn alt bloco" onClick={onEquipes}>
          {equipes.length === 0 ? 'Inscrever equipes' : 'Ver e editar equipes'}
        </button>
      </div>

      <button
        className="btn sol lg bloco"
        style={{ marginBottom: 12 }}
        onClick={onCronometro}
        disabled={equipes.length === 0}
      >
        ⏱️ Cronometrar
      </button>
      {equipes.length === 0 && (
        <p className="mini muted centro" style={{ marginTop: -6 }}>
          Inscreva pelo menos uma equipe para poder cronometrar.
        </p>
      )}

      <button className="btn alt bloco" style={{ marginBottom: 12 }} onClick={onResultados}>
        🏆 Resultados e Excel
      </button>

      <button className="btn alt bloco" style={{ marginBottom: 12 }} onClick={onConferencia}>
        Conferência dos tempos
      </button>

      {canEdit && (
        <button
          className="btn ghost bloco"
          onClick={() => {
            if (!confirm(`Apagar o evento "${evento.nome}" e tudo dele?`)) return
            apagarEvento(evento.id)
            onVoltar()
          }}
        >
          Apagar evento
        </button>
      )}

      <Toast mensagem={msg} />
    </div>
  )
}
