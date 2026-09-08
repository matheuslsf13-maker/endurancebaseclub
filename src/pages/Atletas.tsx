import { useMemo, useState } from 'react'
import { Modal, Vazio } from '../components/ui'
import { useStore } from '../lib/store'
import type { Atleta, Sexo } from '../lib/types'
import { uid } from '../lib/types'

/**
 * Cadastro de atletas — do CLUBE, nao de um evento.
 *
 * E aqui que o historico nasce: o mesmo registro atravessa todos os eventos,
 * entao a pessoa que correu em marco e a mesma que nada em setembro, e da para
 * ver a evolucao dela. Por isso apagar atleta e evitado quando ele ja competiu:
 * some com o passado junto.
 */
export default function Atletas() {
  const { data, salvarAtleta, apagarAtleta, canEdit } = useStore()
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Atleta | null>(null)

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return data.atletas
      .filter((a) => !q || a.nome.toLowerCase().includes(q) || (a.apelido ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [data.atletas, busca])

  /** Em quantas equipes o atleta ja entrou (em qualquer evento). */
  const participacoes = useMemo(() => {
    const conta = new Map<string, number>()
    for (const e of data.equipes) {
      for (const id of e.atleta_ids) conta.set(id, (conta.get(id) ?? 0) + 1)
    }
    return conta
  }, [data.equipes])

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Atletas</h1>
        {canEdit && (
          <button className="btn sm" onClick={() => setEditando(novoAtleta())}>
            + novo
          </button>
        )}
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou apelido"
        style={{ marginBottom: 12 }}
      />

      <div className="card">
        {lista.length === 0 ? (
          <Vazio icone="🏃">
            {data.atletas.length === 0
              ? 'Nenhum atleta cadastrado ainda.'
              : 'Ninguém com esse nome.'}
          </Vazio>
        ) : (
          lista.map((a) => (
            <div className="item" key={a.id}>
              <div className="crescer truncar">
                <div className="forte truncar">{a.apelido?.trim() || a.nome}</div>
                <div className="mini muted truncar">
                  {a.apelido?.trim() ? a.nome : ''}
                  {a.apelido?.trim() && (a.sexo || a.nascimento) ? ' · ' : ''}
                  {a.sexo === 'M' ? 'Masculino' : a.sexo === 'F' ? 'Feminino' : ''}
                  {a.sexo && a.nascimento ? ' · ' : ''}
                  {a.nascimento ? `nasc. ${a.nascimento.split('-').reverse().join('/')}` : ''}
                </div>
              </div>
              <span className="selo">{participacoes.get(a.id) ?? 0} prova(s)</span>
              {canEdit && (
                <button className="btn ghost sm" onClick={() => setEditando(a)}>editar</button>
              )}
            </div>
          ))
        )}
      </div>

      {editando && (
        <FormAtleta
          atleta={editando}
          jaCompetiu={(participacoes.get(editando.id) ?? 0) > 0}
          onFechar={() => setEditando(null)}
          onSalvar={(a) => {
            salvarAtleta(a)
            setEditando(null)
          }}
          onApagar={() => {
            apagarAtleta(editando.id)
            setEditando(null)
          }}
        />
      )}
    </div>
  )
}

function novoAtleta(): Atleta {
  return {
    id: uid(),
    nome: '',
    apelido: '',
    sexo: null,
    nascimento: null,
    contato: '',
    foto_url: null,
    ativo: true,
    criado_em: new Date().toISOString(),
  }
}

function FormAtleta({
  atleta,
  jaCompetiu,
  onSalvar,
  onApagar,
  onFechar,
}: {
  atleta: Atleta
  jaCompetiu: boolean
  onSalvar: (a: Atleta) => void
  onApagar: () => void
  onFechar: () => void
}) {
  const [a, setA] = useState<Atleta>(atleta)
  const [erro, setErro] = useState<string | null>(null)
  const set = <K extends keyof Atleta>(k: K, v: Atleta[K]) => setA((x) => ({ ...x, [k]: v }))

  return (
    <Modal titulo={atleta.nome ? 'Editar atleta' : 'Novo atleta'} onFechar={onFechar}>
      <label className="campo">
        <span>Nome completo</span>
        <input value={a.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Mateus Lima" />
      </label>
      <label className="campo">
        <span>Apelido (como aparece na prova)</span>
        <input
          value={a.apelido ?? ''}
          onChange={(e) => set('apelido', e.target.value)}
          placeholder="Mateus"
        />
      </label>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="campo crescer">
          <span>Sexo</span>
          <select
            value={a.sexo ?? ''}
            onChange={(e) => set('sexo', (e.target.value || null) as Sexo | null)}
          >
            <option value="">Não informar</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </label>
        <label className="campo crescer">
          <span>Nascimento</span>
          <input
            type="date"
            value={a.nascimento ?? ''}
            onChange={(e) => set('nascimento', e.target.value || null)}
          />
        </label>
      </div>
      <p className="mini muted" style={{ marginTop: -4 }}>
        Sexo e nascimento só são necessários se algum evento classificar por eles.
      </p>
      <label className="campo">
        <span>Contato (opcional)</span>
        <input
          value={a.contato ?? ''}
          onChange={(e) => set('contato', e.target.value)}
          placeholder="WhatsApp"
        />
      </label>

      {erro && <div className="aviso perigo">{erro}</div>}

      <button
        className="btn bloco"
        onClick={() => {
          if (!a.nome.trim()) return setErro('O nome é obrigatório.')
          onSalvar({ ...a, nome: a.nome.trim(), apelido: a.apelido?.trim() || null })
        }}
      >
        Salvar
      </button>

      {atleta.nome && (
        <button
          className="btn ghost bloco"
          style={{ marginTop: 8 }}
          onClick={() => {
            if (jaCompetiu) {
              setErro(
                'Este atleta já participou de alguma prova. Apagar levaria o histórico junto — ' +
                  'se ele saiu do clube, prefira deixar como está.',
              )
              return
            }
            if (confirm(`Apagar ${a.nome}?`)) onApagar()
          }}
        >
          Apagar atleta
        </button>
      )}
    </Modal>
  )
}
