import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { localRepo } from '../data/localRepo'
import { loadCache, loadQueue, saveCache, saveQueue, type WriteOp } from '../data/queue'
import type { Repo } from '../data/repo'
import { supabaseRepo } from '../data/supabaseRepo'
import { CHAVE } from './chaves'
import { hasSupabase, supabase } from './supabase'
import type {
  AppData, Atleta, Bateria, Equipe, Evento, Marcacao, Modalidade, Trecho,
} from './types'
import { emptyData, uid } from './types'

export type SyncState = 'saved' | 'saving' | 'pending'

/** Quem esta usando o app agora. */
export type Sessao =
  | { papel: 'organizador'; email: string }
  | { papel: 'cronometrista'; nome: string; codigo: string }
  | { papel: 'visitante' }

type Ctx = {
  data: AppData
  loading: boolean
  error: string | null
  online: boolean
  /** Pode mexer no cadastro (criar evento, atleta, equipe). */
  canEdit: boolean
  /** Pode marcar tempo: o organizador logado ou quem entrou pelo link. */
  canTime: boolean
  sessao: Sessao
  sync: SyncState
  pendingCount: number
  reload: () => Promise<void>
  repo: Repo

  salvarAtleta: (a: Atleta) => void
  apagarAtleta: (id: string) => void
  salvarEvento: (e: Evento) => void
  apagarEvento: (id: string) => void
  trocarModalidades: (eventoId: string, ms: Modalidade[]) => void
  salvarEquipe: (e: Equipe) => void
  apagarEquipe: (id: string) => void
  trocarTrechos: (equipeId: string, ts: Trecho[]) => void
  salvarBateria: (b: Bateria) => void
  apagarBateria: (id: string) => void
  /** Grava marcacoes. Nunca falha na tela: entra na fila e sobe quando der. */
  registrarMarcacoes: (ms: Marcacao[]) => void

  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
  /** Entrada do cronometrista: nome + codigo que veio no link. */
  entrarComoCronometrista: (nome: string, codigo: string) => void

  atletaPorId: (id: string) => Atleta | undefined
  nomeDe: (id: string) => string
}

const StoreContext = createContext<Ctx | null>(null)

// ------------------------------------------------------------------
//  Aplicacao otimista: a tela responde no toque, o envio vem depois
// ------------------------------------------------------------------

function applyLocally(d: AppData, op: WriteOp): AppData {
  switch (op.type) {
    case 'salvarAtleta':
      return { ...d, atletas: upsert(d.atletas, op.atleta) }
    case 'apagarAtleta':
      return { ...d, atletas: d.atletas.filter((a) => a.id !== op.atletaId) }
    case 'salvarEvento':
      return { ...d, eventos: upsert(d.eventos, op.evento) }
    case 'apagarEvento': {
      const equipes = d.equipes.filter((q) => q.evento_id === op.eventoId).map((q) => q.id)
      return {
        ...d,
        eventos: d.eventos.filter((e) => e.id !== op.eventoId),
        modalidades: d.modalidades.filter((m) => m.evento_id !== op.eventoId),
        equipes: d.equipes.filter((q) => q.evento_id !== op.eventoId),
        trechos: d.trechos.filter((t) => !equipes.includes(t.equipe_id)),
        baterias: d.baterias.filter((b) => b.evento_id !== op.eventoId),
        marcacoes: d.marcacoes.filter((m) => m.evento_id !== op.eventoId),
      }
    }
    case 'trocarModalidades':
      return {
        ...d,
        modalidades: [...d.modalidades.filter((m) => m.evento_id !== op.eventoId), ...op.modalidades],
      }
    case 'salvarEquipe':
      return { ...d, equipes: upsert(d.equipes, op.equipe) }
    case 'apagarEquipe':
      return {
        ...d,
        equipes: d.equipes.filter((e) => e.id !== op.equipeId),
        trechos: d.trechos.filter((t) => t.equipe_id !== op.equipeId),
      }
    case 'trocarTrechos':
      return {
        ...d,
        trechos: [...d.trechos.filter((t) => t.equipe_id !== op.equipeId), ...op.trechos],
      }
    case 'salvarBateria':
      return { ...d, baterias: upsert(d.baterias, op.bateria) }
    case 'apagarBateria':
      return { ...d, baterias: d.baterias.filter((b) => b.id !== op.bateriaId) }
    case 'registrarMarcacoes': {
      const conhecidas = new Set(d.marcacoes.map((m) => m.id))
      return { ...d, marcacoes: [...d.marcacoes, ...op.marcacoes.filter((m) => !conhecidas.has(m.id))] }
    }
  }
}

function upsert<T extends { id: string }>(lista: T[], item: T): T[] {
  const i = lista.findIndex((x) => x.id === item.id)
  if (i < 0) return [...lista, item]
  const copia = lista.slice()
  copia[i] = item
  return copia
}

// ------------------------------------------------------------------

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const repo = hasSupabase ? supabaseRepo : localRepo
  // no modo online o app abre com o ultimo estado conhecido, mesmo sem sinal
  const cached = hasSupabase ? loadCache<AppData>() : null
  const [data, setData] = useState<AppData>(() => cached ?? emptyData())
  const [loading, setLoading] = useState(cached === null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [cronometrista, setCronometrista] = useState<{ nome: string; codigo: string } | null>(
    () => lerCronometrista(),
  )
  const [queue, setQueue] = useState<WriteOp[]>(() => (hasSupabase ? loadQueue() : []))
  const [syncing, setSyncing] = useState(false)

  const queueRef = useRef(queue)
  const draining = useRef(false)
  const retryTimer = useRef<number | null>(null)
  const reloadTimer = useRef<number | null>(null)

  useEffect(() => {
    queueRef.current = queue
    if (repo.kind === 'supabase') saveQueue(queue)
  }, [queue, repo.kind])

  const reload = useCallback(async () => {
    try {
      // sem isso, uma conexao que trava deixa o app preso em "Carregando..."
      const carregado = await withTimeout(repo.load(), 15000)
      // reaplica por cima o que ainda nao subiu, senao a tela "perde" o tempo
      // que foi marcado sem sinal ate a fila terminar de enviar
      const d = queueRef.current.reduce(applyLocally, carregado)
      setData(d)
      if (repo.kind === 'supabase') saveCache(d)
      setError(null)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setLoading(false)
    }
  }, [repo])

  // tenta de novo sozinho quando a primeira carga falha (sinal ruim)
  useEffect(() => {
    if (!error || loading) return
    const t = window.setTimeout(() => void reload(), 15000)
    return () => window.clearTimeout(t)
  }, [error, loading, reload])

  /** Envia a fila, uma operacao por vez, e tenta de novo se cair a rede. */
  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    try {
      while (queueRef.current.length > 0) {
        const op = queueRef.current[0]
        setSyncing(true)
        try {
          await runOp(repo, op)
        } catch (e) {
          setError(messageOf(e))
          if (retryTimer.current) window.clearTimeout(retryTimer.current)
          retryTimer.current = window.setTimeout(() => void drain(), 5000)
          return
        }
        queueRef.current = queueRef.current.filter((x) => x.id !== op.id)
        setQueue(queueRef.current)
        setError(null)
      }
    } finally {
      draining.current = false
      setSyncing(false)
    }
  }, [repo])

  const push = useCallback(
    (op: WriteOp) => {
      setData((d) => {
        const next = applyLocally(d, op)
        if (repo.kind === 'supabase') saveCache(next)
        return next
      })
      queueRef.current = [...queueRef.current, op]
      setQueue(queueRef.current)
      void drain()
    },
    [drain, repo.kind],
  )

  useEffect(() => {
    void reload().then(() => void drain())
  }, [reload, drain])

  // volta o sinal -> tenta enviar o que ficou pendente
  useEffect(() => {
    const onOnline = () => void drain()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [drain])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data: s }) => setEmail(s.session?.user.email ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setEmail(s?.user.email ?? null)
      void drain()
    })
    return () => sub.subscription.unsubscribe()
  }, [drain])

  // mudancas feitas por outra pessoa; nunca sobrescreve escrita pendente
  useEffect(() => {
    if (!repo.subscribe) return
    return repo.subscribe(() => {
      if (queueRef.current.length > 0) return
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
      reloadTimer.current = window.setTimeout(() => {
        if (queueRef.current.length === 0) void reload()
      }, 600)
    })
  }, [repo, reload])

  const value = useMemo<Ctx>(() => {
    const porId = new Map(data.atletas.map((a) => [a.id, a]))
    const sync: SyncState = queue.length === 0 ? 'saved' : syncing ? 'saving' : 'pending'
    const local = repo.kind === 'local'
    const sessao: Sessao = local
      ? { papel: 'organizador', email: 'modo local' }
      : email
        ? { papel: 'organizador', email }
        : cronometrista
          ? { papel: 'cronometrista', nome: cronometrista.nome, codigo: cronometrista.codigo }
          : { papel: 'visitante' }
    // o cronometrista so grava marcacao; ele nao mexe em cadastro
    const codigo = sessao.papel === 'cronometrista' ? sessao.codigo : null

    return {
      data,
      loading,
      error,
      repo,
      online: !local,
      canEdit: sessao.papel === 'organizador',
      canTime: sessao.papel !== 'visitante',
      sessao,
      sync,
      pendingCount: queue.length,
      reload,

      salvarAtleta: (atleta) => push({ id: uid(), type: 'salvarAtleta', atleta }),
      apagarAtleta: (atletaId) => push({ id: uid(), type: 'apagarAtleta', atletaId }),
      salvarEvento: (evento) => push({ id: uid(), type: 'salvarEvento', evento }),
      apagarEvento: (eventoId) => push({ id: uid(), type: 'apagarEvento', eventoId }),
      trocarModalidades: (eventoId, modalidades) =>
        push({ id: uid(), type: 'trocarModalidades', eventoId, modalidades }),
      salvarEquipe: (equipe) => push({ id: uid(), type: 'salvarEquipe', equipe }),
      apagarEquipe: (equipeId) => push({ id: uid(), type: 'apagarEquipe', equipeId }),
      trocarTrechos: (equipeId, trechos) =>
        push({ id: uid(), type: 'trocarTrechos', equipeId, trechos }),
      salvarBateria: (bateria) => push({ id: uid(), type: 'salvarBateria', bateria }),
      apagarBateria: (bateriaId) => push({ id: uid(), type: 'apagarBateria', bateriaId }),
      registrarMarcacoes: (marcacoes) =>
        push({ id: uid(), type: 'registrarMarcacoes', marcacoes, codigo }),

      entrar: async (mail, senha) => {
        if (!supabase) return
        const { error: e } = await supabase.auth.signInWithPassword({ email: mail, password: senha })
        if (e) throw e
      },
      sair: async () => {
        esquecerCronometrista()
        setCronometrista(null)
        if (!supabase) return
        await supabase.auth.signOut()
      },
      entrarComoCronometrista: (nome, cod) => {
        guardarCronometrista(nome, cod)
        setCronometrista({ nome, codigo: cod })
      },

      atletaPorId: (id) => porId.get(id),
      // o apelido e o nome da prova: e ele que aparece no card do cronometro,
      // onde o espaco e curto e o toque precisa ser rapido
      nomeDe: (id) => {
        const a = porId.get(id)
        if (!a) return '—'
        return a.apelido?.trim() || a.nome
      },
    }
  }, [data, loading, error, repo, email, cronometrista, reload, push, queue.length, syncing])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

async function runOp(repo: Repo, op: WriteOp): Promise<void> {
  switch (op.type) {
    case 'salvarAtleta':
      return repo.salvarAtleta(op.atleta)
    case 'apagarAtleta':
      return repo.apagarAtleta(op.atletaId)
    case 'salvarEvento':
      return repo.salvarEvento(op.evento)
    case 'apagarEvento':
      return repo.apagarEvento(op.eventoId)
    case 'trocarModalidades':
      return repo.trocarModalidades(op.eventoId, op.modalidades)
    case 'salvarEquipe':
      return repo.salvarEquipe(op.equipe)
    case 'apagarEquipe':
      return repo.apagarEquipe(op.equipeId)
    case 'trocarTrechos':
      return repo.trocarTrechos(op.equipeId, op.trechos)
    case 'salvarBateria':
      return repo.salvarBateria(op.bateria)
    case 'apagarBateria':
      return repo.apagarBateria(op.bateriaId)
    case 'registrarMarcacoes':
      return repo.registrarMarcacoes(op.marcacoes, op.codigo)
  }
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore precisa estar dentro de <StoreProvider>')
  return ctx
}

// ------------------------------------------------------------------

function lerCronometrista(): { nome: string; codigo: string } | null {
  try {
    const nome = localStorage.getItem(CHAVE.operador)
    const codigo = localStorage.getItem(CHAVE.codigo)
    return nome && codigo ? { nome, codigo } : null
  } catch {
    return null
  }
}

function guardarCronometrista(nome: string, codigo: string) {
  try {
    localStorage.setItem(CHAVE.operador, nome)
    localStorage.setItem(CHAVE.codigo, codigo)
  } catch {
    /* aba anonima: vale so nesta sessao */
  }
}

function esquecerCronometrista() {
  try {
    localStorage.removeItem(CHAVE.operador)
    localStorage.removeItem(CHAVE.codigo)
  } catch {
    /* nada a fazer */
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Sem resposta do servidor. Verifique sua conexão.')), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

function messageOf(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
