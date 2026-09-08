import { CHAVE } from '../lib/chaves'
import type {
  AppData, Atleta, Bateria, Equipe, Evento, Marcacao, Modalidade, Trecho,
} from '../lib/types'
import { emptyData } from '../lib/types'
import type { Repo } from './repo'

/** Modo local: tudo no navegador deste aparelho. Serve para testar sem banco. */

function read(): AppData {
  try {
    const raw = localStorage.getItem(CHAVE.dados)
    if (!raw) return emptyData()
    const p = JSON.parse(raw) as Partial<AppData>
    return {
      atletas: p.atletas ?? [],
      eventos: p.eventos ?? [],
      modalidades: p.modalidades ?? [],
      equipes: p.equipes ?? [],
      trechos: p.trechos ?? [],
      baterias: p.baterias ?? [],
      marcacoes: p.marcacoes ?? [],
    }
  } catch {
    return emptyData()
  }
}

function write(d: AppData) {
  try {
    localStorage.setItem(CHAVE.dados, JSON.stringify(d))
  } catch (e) {
    console.error('nao foi possivel salvar localmente', e)
  }
}

function upsert<T extends { id: string }>(lista: T[], item: T): T[] {
  const i = lista.findIndex((x) => x.id === item.id)
  if (i < 0) return [...lista, item]
  const copia = lista.slice()
  copia[i] = item
  return copia
}

export const localRepo: Repo = {
  kind: 'local',

  async load() {
    return read()
  },

  async salvarAtleta(a: Atleta) {
    const d = read()
    d.atletas = upsert(d.atletas, a)
    write(d)
  },
  async apagarAtleta(id: string) {
    const d = read()
    d.atletas = d.atletas.filter((a) => a.id !== id)
    write(d)
  },

  async salvarEvento(e: Evento) {
    const d = read()
    d.eventos = upsert(d.eventos, e)
    write(d)
  },
  async apagarEvento(id: string) {
    const d = read()
    const equipes = d.equipes.filter((q) => q.evento_id === id).map((q) => q.id)
    d.eventos = d.eventos.filter((e) => e.id !== id)
    d.modalidades = d.modalidades.filter((m) => m.evento_id !== id)
    d.equipes = d.equipes.filter((q) => q.evento_id !== id)
    d.trechos = d.trechos.filter((t) => !equipes.includes(t.equipe_id))
    d.baterias = d.baterias.filter((b) => b.evento_id !== id)
    d.marcacoes = d.marcacoes.filter((m) => m.evento_id !== id)
    write(d)
  },

  async trocarModalidades(eventoId: string, ms: Modalidade[]) {
    const d = read()
    d.modalidades = [...d.modalidades.filter((m) => m.evento_id !== eventoId), ...ms]
    write(d)
  },

  async salvarEquipe(e: Equipe) {
    const d = read()
    d.equipes = upsert(d.equipes, e)
    write(d)
  },
  async apagarEquipe(id: string) {
    const d = read()
    d.equipes = d.equipes.filter((e) => e.id !== id)
    d.trechos = d.trechos.filter((t) => t.equipe_id !== id)
    write(d)
  },
  async trocarTrechos(equipeId: string, ts: Trecho[]) {
    const d = read()
    d.trechos = [...d.trechos.filter((t) => t.equipe_id !== equipeId), ...ts]
    write(d)
  },

  async salvarBateria(b: Bateria) {
    const d = read()
    d.baterias = upsert(d.baterias, b)
    write(d)
  },
  async apagarBateria(id: string) {
    const d = read()
    d.baterias = d.baterias.filter((b) => b.id !== id)
    write(d)
  },

  async registrarMarcacoes(ms: Marcacao[]) {
    const d = read()
    // append-only: marcacao que ja existe nao e reescrita
    const conhecidas = new Set(d.marcacoes.map((m) => m.id))
    d.marcacoes = [...d.marcacoes, ...ms.filter((m) => !conhecidas.has(m.id))]
    write(d)
  },
}
