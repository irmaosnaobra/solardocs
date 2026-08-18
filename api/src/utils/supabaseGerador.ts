import { createClient } from '@supabase/supabase-js';

// Supabase do projeto "Gerador de Propostas" (Irmãos na Obra B2C),
// separado do Supabase principal do SolarDoc.
//
// O COMENTÁRIO ANTIGO AQUI DIZIA "RLS protege as tabelas" — e era falso. Em
// 18/08/2026 isso foi conferido com curl de fora: `eletroposto_nota1` estava com
// RLS desligada e a chave publishable, que ficava no código-fonte da LP pública,
// lia as 63 fichas com nome, telefone e endereço, e era aceita num DELETE.
//
// Desde então: as LPs não carregam mais chave nenhuma (agendam pela API), o
// /gerador tem login de verdade (cada consultor manda o token dele), e sobrou
// ESTE arquivo como último consumidor do papel anônimo.
//
// SUPABASE_GERADOR_SERVICE_KEY é o que fecha a porta: a service_role ignora RLS,
// então com ela a API pode continuar lendo depois que o anon perder a leitura.
// O fallback pra chave publishable existe pra um deploy sem a variável não
// derrubar o agendamento — mas enquanto o fallback estiver em uso, o passo 2 do
// MIGRATION_fechar_leitura_publica.sql NÃO pode ser rodado.
const SUPABASE_URL = 'https://ancecdfqfwlaujknizof.supabase.co';
const SUPABASE_PUBLICA = 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';
const SUPABASE_KEY = (process.env.SUPABASE_GERADOR_SERVICE_KEY || '').trim() || SUPABASE_PUBLICA;

/** `true` quando a API já está com a service key — é a condição pra fechar a
 *  leitura do anon. Exportado pra dar pra conferir sem adivinhar. */
export const geradorComServiceKey = SUPABASE_KEY !== SUPABASE_PUBLICA;

export const supabaseGerador = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});
