import { supabase } from '../lib/supabase'
import type {
  AppData, Atleta, Bateria, Equipe, Evento, Marcacao, Modalidade, Trecho,
} from '../lib/types'
import type { Repo } from './repo'

function client() {
  if (!supabase) throw new Error('Supabase nao configurado')
  return supabase
}

export const supabaseRepo: Repo = {
  kind: 'supabase',

  async load(): Promise<AppData> {
    const sb = client()
    const [atletas, eventos, codigos, modalidades, equipes, trechos, baterias, marcacoes] = await Promise.all([
      sb.from('atletas').select('*').order('nome'),
      sb.from('eventos').select('*').order('data', { ascending: false }),
      // so o organizador logado enxerga esta tabela; para os outros vem vazia
      sb.from('eventos_codigo').select('*'),
      sb.from('modalidades').select('*').order('ordem'),
      sb.from('equipes').select('*').order('dorsal'),
      sb.from('trechos').select('*').order('ordem'),
      sb.from('baterias').select('*'),
      sb.from('marcacoes').select('*').order('marcado_em'),
    ])
    const erro =
      atletas.error || eventos.error || modalidades.error ||
      equipes.error || trechos.error || marcacoes.error
    if (erro) throw erro
    // tabela mais nova: se ainda nao foi criada, o app segue sem ela
    if (baterias.error) console.warn('baterias indisponível:', baterias.error.message)
    // o codigo do link vive em tabela separada, porque e segredo (ver schema)
    const porEvento = new Map(
      ((codigos.data ?? []) as { evento_id: string; codigo: string }[]).map((c) => [c.evento_id, c.codigo]),
    )
    return {
      atletas: (atletas.data ?? []) as Atleta[],
      eventos: ((eventos.data ?? []) as Evento[]).map((e) => ({
        ...e,
        codigo: porEvento.get(e.id) ?? '',
      })),
      modalidades: (modalidades.data ?? []) as Modalidade[],
      equipes: (equipes.data ?? []) as Equipe[],
      trechos: (trechos.data ?? []) as Trecho[],
      baterias: (baterias.data ?? []) as Bateria[],
      marcacoes: (marcacoes.data ?? []) as Marcacao[],
    }
  },

  async salvarAtleta(a: Atleta) {
    const { error } = await client().from('atletas').upsert(a)
    if (error) throw error
  },
  async apagarAtleta(id: string) {
    const { error } = await client().from('atletas').delete().eq('id', id)
    if (error) throw error
  },

  async salvarEvento(e: Evento) {
    const sb = client()
    const { codigo, ...evento } = e
    const { error } = await sb.from('eventos').upsert(evento)
    if (error) throw error
    if (!codigo) return
    const c = await sb.from('eventos_codigo').upsert({ evento_id: e.id, codigo })
    if (c.error) throw c.error
  },
  async apagarEvento(id: string) {
    // as tabelas filhas caem por `on delete cascade` no schema
    const { error } = await client().from('eventos').delete().eq('id', id)
    if (error) throw error
  },

  async trocarModalidades(eventoId: string, ms: Modalidade[]) {
    const sb = client()
    const apagou = await sb.from('modalidades').delete().eq('evento_id', eventoId)
    if (apagou.error) throw apagou.error
    if (ms.length === 0) return
    const { error } = await sb.from('modalidades').insert(ms)
    if (error) throw error
  },

  async salvarEquipe(e: Equipe) {
    const { error } = await client().from('equipes').upsert(e)
    if (error) throw error
  },
  async apagarEquipe(id: string) {
    const { error } = await client().from('equipes').delete().eq('id', id)
    if (error) throw error
  },
  async trocarTrechos(equipeId: string, ts: Trecho[]) {
    const sb = client()
    const apagou = await sb.from('trechos').delete().eq('equipe_id', equipeId)
    if (apagou.error) throw apagou.error
    if (ts.length === 0) return
    const { error } = await sb.from('trechos').insert(ts)
    if (error) throw error
  },

  async salvarBateria(b: Bateria) {
    const { error } = await client().from('baterias').upsert(b)
    if (error) throw error
  },
  async apagarBateria(id: string) {
    const { error } = await client().from('baterias').delete().eq('id', id)
    if (error) throw error
  },

  async registrarMarcacoes(ms: Marcacao[], codigo: string | null) {
    if (ms.length === 0) return
    const sb = client()
    if (codigo) {
      // cronometrista convidado pelo link: quem confere o codigo e o banco
      const { error } = await sb.rpc('registrar_marcacoes', { p_codigo: codigo, p_marcacoes: ms })
      if (error) throw error
      return
    }
    // organizador logado: insert direto.
    // `ignoreDuplicates` porque a fila pode reenviar a mesma marcacao depois
    // de uma resposta perdida -- e reenvio nunca pode virar tempo duplicado.
    const { error } = await sb.from('marcacoes').upsert(ms, { ignoreDuplicates: true })
    if (error) throw error
  },

  subscribe(cb: () => void) {
    const sb = client()
    const ch = sb
      .channel('endurance-base-club')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'atletas' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'eventos' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'modalidades' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipes' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trechos' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marcacoes' }, cb)
      .subscribe()
    return () => {
      void sb.removeChannel(ch)
    }
  },
}
