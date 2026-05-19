import { createClient } from '@supabase/supabase-js';

// Supabase do projeto "Gerador de Propostas" (Irmãos na Obra B2C),
// separado do Supabase principal do SolarDoc.
// Key publishable / anon — já está exposta no frontend público em
// dashboard/public/gerador/index.html. RLS protege as tabelas.
const SUPABASE_URL = 'https://ancecdfqfwlaujknizof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';

export const supabaseGerador = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});
