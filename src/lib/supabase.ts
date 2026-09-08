import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config'

// variavel de ambiente tem prioridade; senao usa o que estiver em src/config.ts
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY

export const hasSupabase = Boolean(url && key && url.startsWith('http'))

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(url as string, key as string, { auth: { persistSession: true } })
  : null
