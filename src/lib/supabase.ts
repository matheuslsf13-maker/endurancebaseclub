import { createClient } from '@supabase/supabase-js';

// The only Supabase client of the app. Data access goes exclusively through `api.ts`
// (Postgres RPC functions); the client is also used directly for e-mail/password auth.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_KEY as string,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'ebc.auth',
    },
  },
);
