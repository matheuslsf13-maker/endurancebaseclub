import { useState } from 'react'
import { useStore } from '../lib/store'
import type { Criterio, Evento, Faixa, Modalidade, TipoLargada, Unidade } from '../lib/types'
import { hojeISO, novoCodigo, uid } from '../lib/types'

/**
 * O ASSISTENTE DE CRIACAO DO EVENTO.
 *
 * Regra que vale para a tela inteira: **nada aqui e fixo no codigo**. O
 * organizador escreve o nome de cada modalidade, a distancia dela, as faixas
 * etarias e as categorias. O sistema nao tem uma lista de esportes -- corrida,
 * ciclismo e natacao sao so o que ele digitou da ultima vez.
 *
 * As tres secoes sao numeradas como passos, mas ficam na mesma tela: no
 * celular, rolar e mais rapido que avancar e voltar, e permite conferir tudo
 * antes de criar. A mesma tela serve para editar um evento ja criado.
 */

type Rascunho = {
  nome: string
  data: string
  local: string
  tipo_largada: TipoLargada
  criterios: Criterio[]
  faixas: Faixa[]
  categorias: string[]
  modalidades: LinhaModalidade[]
}

type LinhaModalidade = {
  id: string
  nome: string
  distancia: string
  unidade: Unidade
}

/** Sugestao inicial de faixas, so para nao comecar do zero. Tudo editavel. */
const FAIXAS_PADRAO: Faixa[] = [
  { nome: '18-29', de: 18, ate: 29 },
  { nome: '30-39', de: 30, ate: 39 },
  { nome: '40-49', de: 40, ate: 49 },
  { nome: '50+', de: 50, ate: null },
]

function linhaVazia(): LinhaModalidade {
  return { id: uid(), nome: '', distancia: '', unidade: 'km' }
}

export default function FormEvento({
  evento,
  onPronto,
  onCancelar,
}: {
  /** Preenchido = edicao; vazio = evento novo. */
  evento?: Evento
  onPronto: (eventoId: string) => void
  onCancelar: () => void
}) {
  const { data, salvarEvento, trocarModalidades } = useStore()

  const modalidadesDoEvento = evento
    ? data.modalidades
        .filter((m) => m.evento_id === evento.id)
        .sort((a, b) => a.ordem - b.ordem)
        .map<LinhaModalidade>((m) => ({
          id: m.id,
          nome: m.nome,
          distancia: String(m.distancia),
          unidade: m.unidade,
        }))
    : []

  const [r, setR] = useState<Rascunho>(() => ({
    nome: evento?.nome ?? '',
    data: evento?.data ?? hojeISO(),
    local: evento?.local ?? '',
    tipo_largada: evento?.tipo_largada ?? 'massa',
    criterios: evento?.criterios ?? [],
    faixas: evento?.faixas?.length ? evento.faixas : FAIXAS_PADRAO,
    categorias: evento?.categorias ?? [],
    modalidades: modalidadesDoEvento.length ? modalidadesDoEvento : [linhaVazia()],
  }))
  const [erro, setErro] = useState<string | null>(null)

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }))

  const temCriterio = (c: Criterio) => r.criterios.includes(c)
  const alternarCriterio = (c: Criterio) =>
    set('criterios', temCriterio(c) ? r.criterios.filter((x) => x !== c) : [...r.criterios, c])

  // -------- modalidades --------

  const mudarModalidade = (id: string, campo: keyof LinhaModalidade, valor: string) =>
    set('modalidades', r.modalidades.map((m) => (m.id === id ? { ...m, [campo]: valor } : m)))

  const removerModalidade = (id: string) => {
    const restantes = r.modalidades.filter((m) => m.id !== id)
    set('modalidades', restantes.length ? restantes : [linhaVazia()])
  }

  const mover = (id: string, passo: -1 | 1) => {
    const i = r.modalidades.findIndex((m) => m.id === id)
    const j = i + passo
    if (i < 0 || j < 0 || j >= r.modalidades.length) return
    const copia = r.modalidades.slice()
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
    set('modalidades', copia)
  }

  // -------- categorias escritas a mao --------

  const mudarCategoria = (i: number, valor: string) =>
    set('categorias', r.categorias.map((c, k) => (k === i ? valor : c)))
  const removerCategoria = (i: number) =>
    set('categorias', r.categorias.filter((_, k) => k !== i))

  // -------- faixas etarias --------

  const mudarFaixa = (i: number, campo: keyof Faixa, valor: string) =>
    set(
      'faixas',
      r.faixas.map((f, k) => {
        if (k !== i) return f
        if (campo === 'nome') return { ...f, nome: valor }
        // vazio no "ate" quer dizer "e acima": 50+ nao tem teto
        const n = valor.trim() === '' ? null : Number(valor)
        return { ...f, [campo]: Number.isFinite(n as number) ? n : null } as Faixa
      }),
    )

  // -------- salvar --------

  function salvar() {
    const nome = r.nome.trim()
    if (!nome) return setErro('Dê um nome ao evento.')

    const modalidades = r.modalidades
      .map((m) => ({ ...m, nome: m.nome.trim() }))
      .filter((m) => m.nome !== '')
    if (modalidades.length === 0) {
      return setErro('Escreva pelo menos uma modalidade (Corrida, Natação, Ciclismo…).')
    }
    const semDistancia = modalidades.find((m) => !(Number(m.distancia.replace(',', '.')) > 0))
    if (semDistancia) {
      return setErro(
        `Falta a distância de "${semDistancia.nome}". É ela que permite calcular pace e velocidade.`,
      )
    }
    if (temCriterio('livre') && r.categorias.filter((c) => c.trim()).length === 0) {
      return setErro('Você marcou "categorias que eu escrevo" — escreva pelo menos uma.')
    }

    const id = evento?.id ?? uid()
    const salvo: Evento = {
      id,
      nome,
      data: r.data,
      local: r.local.trim() || null,
      tipo_largada: r.tipo_largada,
      status: evento?.status ?? 'rascunho',
      // o codigo do link e gerado uma vez e vive com o evento
      codigo: evento?.codigo || novoCodigo(),
      criterios: r.criterios,
      faixas: temCriterio('faixa') ? r.faixas.filter((f) => f.nome.trim()) : [],
      categorias: temCriterio('livre') ? r.categorias.map((c) => c.trim()).filter(Boolean) : [],
      criado_em: evento?.criado_em ?? new Date().toISOString(),
    }
    salvarEvento(salvo)

    const lista: Modalidade[] = modalidades.map((m, i) => ({
      id: m.id,
      evento_id: id,
      ordem: i + 1,
      nome: m.nome,
      distancia: Number(m.distancia.replace(',', '.')),
      unidade: m.unidade,
      cor: null,
      icone: null,
    }))
    trocarModalidades(id, lista)
    onPronto(id)
  }

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{evento ? 'Editar evento' : 'Novo evento'}</h1>
        <button className="btn ghost sm" onClick={onCancelar}>Cancelar</button>
      </div>

      {/* ---------------- 1. dados ---------------- */}
      <div className="card">
        <h2>1 · O evento</h2>
        <label className="campo">
          <span>Nome</span>
          <input
            value={r.nome}
            onChange={(e) => set('nome', e.target.value)}
            placeholder="Desafio Base 2026"
          />
        </label>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="campo crescer">
            <span>Data</span>
            <input type="date" value={r.data} onChange={(e) => set('data', e.target.value)} />
          </label>
          <label className="campo crescer">
            <span>Local (opcional)</span>
            <input
              value={r.local}
              onChange={(e) => set('local', e.target.value)}
              placeholder="Parque da Cidade"
            />
          </label>
        </div>
        <label className="campo" style={{ marginBottom: 0 }}>
          <span>Como é a largada</span>
          <select
            value={r.tipo_largada}
            onChange={(e) => set('tipo_largada', e.target.value as TipoLargada)}
          >
            <option value="massa">Em massa — todos largam juntos</option>
            <option value="baterias">Em baterias — grupos largam em horários diferentes</option>
            <option value="individual">Individual — cada equipe larga no seu horário</option>
          </select>
        </label>
      </div>

      {/* ---------------- 2. modalidades ---------------- */}
      <div className="card">
        <h2>2 · As modalidades, na ordem da prova</h2>
        <p className="pequeno muted">
          Escreva o nome e a distância de cada uma. <strong>A distância é o que
          permite calcular pace e velocidade</strong> — sem ela o sistema só sabe
          o tempo.
        </p>

        {r.modalidades.map((m, i) => (
          <div className="modalidade" key={m.id}>
            <span className="ordem">{i + 1}ª</span>
            <label className="campo crescer" style={{ marginBottom: 0 }}>
              <span>Modalidade</span>
              <input
                value={m.nome}
                onChange={(e) => mudarModalidade(m.id, 'nome', e.target.value)}
                placeholder={i === 0 ? 'Corrida' : i === 1 ? 'Ciclismo' : 'Natação'}
              />
            </label>
            <label className="campo dist" style={{ marginBottom: 0 }}>
              <span>Distância</span>
              <input
                inputMode="decimal"
                value={m.distancia}
                onChange={(e) => mudarModalidade(m.id, 'distancia', e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="3"
              />
            </label>
            <label className="campo un" style={{ marginBottom: 0 }}>
              <span>&nbsp;</span>
              <select
                value={m.unidade}
                onChange={(e) => mudarModalidade(m.id, 'unidade', e.target.value)}
              >
                <option value="km">km</option>
                <option value="m">m</option>
              </select>
            </label>
          </div>
        ))}

        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn alt sm" onClick={() => set('modalidades', [...r.modalidades, linhaVazia()])}>
            + adicionar modalidade
          </button>
          {r.modalidades.length > 1 && (
            <>
              <button className="btn ghost sm" onClick={() => mover(r.modalidades[r.modalidades.length - 1].id, -1)}>
                ↑ subir a última
              </button>
              <button
                className="btn ghost sm"
                onClick={() => removerModalidade(r.modalidades[r.modalidades.length - 1].id)}
              >
                remover a última
              </button>
            </>
          )}
        </div>
      </div>

      {/* ---------------- 3. classificacao ---------------- */}
      <div className="card">
        <h2>3 · Como classificar</h2>
        <p className="pequeno muted">
          A classificação geral sai sempre. Marque aqui se quer classificações
          separadas além dela — dá para marcar mais de uma.
        </p>

        <div className="escolhas">
          <label className={`escolha${temCriterio('sexo') ? ' on' : ''}`}>
            <input type="checkbox" checked={temCriterio('sexo')} onChange={() => alternarCriterio('sexo')} />
            <span>
              <strong>Por sexo</strong>
              <span className="desc">Masculino, feminino e misto (equipe com os dois).</span>
            </span>
          </label>

          <label className={`escolha${temCriterio('faixa') ? ' on' : ''}`}>
            <input type="checkbox" checked={temCriterio('faixa')} onChange={() => alternarCriterio('faixa')} />
            <span>
              <strong>Por faixa etária</strong>
              <span className="desc">Você define as faixas. A idade é contada na data do evento.</span>
            </span>
          </label>

          <label className={`escolha${temCriterio('livre') ? ' on' : ''}`}>
            <input type="checkbox" checked={temCriterio('livre')} onChange={() => alternarCriterio('livre')} />
            <span>
              <strong>Categorias que eu escrevo</strong>
              <span className="desc">Iniciante, Master, Elite… você escolhe a de cada equipe.</span>
            </span>
          </label>
        </div>

        {temCriterio('faixa') && (
          <div style={{ marginTop: 14 }}>
            <h3>Faixas etárias</h3>
            <p className="mini muted">Deixe o “até” vazio para dizer “e acima” (ex: 50+).</p>
            {r.faixas.map((f, i) => (
              <div className="modalidade" key={i}>
                <label className="campo crescer" style={{ marginBottom: 0 }}>
                  <span>Nome</span>
                  <input value={f.nome} onChange={(e) => mudarFaixa(i, 'nome', e.target.value)} />
                </label>
                <label className="campo dist" style={{ marginBottom: 0 }}>
                  <span>De</span>
                  <input
                    inputMode="numeric"
                    value={String(f.de)}
                    onChange={(e) => mudarFaixa(i, 'de', e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <label className="campo dist" style={{ marginBottom: 0 }}>
                  <span>Até</span>
                  <input
                    inputMode="numeric"
                    value={f.ate === null ? '' : String(f.ate)}
                    placeholder="+"
                    onChange={(e) => mudarFaixa(i, 'ate', e.target.value.replace(/\D/g, ''))}
                  />
                </label>
              </div>
            ))}
            <div className="row wrap" style={{ gap: 8 }}>
              <button
                className="btn alt sm"
                onClick={() => set('faixas', [...r.faixas, { nome: '', de: 0, ate: null }])}
              >
                + faixa
              </button>
              {r.faixas.length > 1 && (
                <button className="btn ghost sm" onClick={() => set('faixas', r.faixas.slice(0, -1))}>
                  remover a última
                </button>
              )}
            </div>
          </div>
        )}

        {temCriterio('livre') && (
          <div style={{ marginTop: 14 }}>
            <h3>Categorias</h3>
            {r.categorias.map((c, i) => (
              <div className="row" key={i} style={{ marginBottom: 8 }}>
                <input
                  className="crescer"
                  value={c}
                  onChange={(e) => mudarCategoria(i, e.target.value)}
                  placeholder="Iniciante"
                />
                <button className="btn ghost sm" onClick={() => removerCategoria(i)}>remover</button>
              </div>
            ))}
            <button className="btn alt sm" onClick={() => set('categorias', [...r.categorias, ''])}>
              + categoria
            </button>
          </div>
        )}
      </div>

      {erro && <div className="aviso perigo">{erro}</div>}

      <button className="btn lg bloco" onClick={salvar}>
        {evento ? 'Salvar alterações' : 'Criar evento'}
      </button>
    </div>
  )
}
