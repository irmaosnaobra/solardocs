require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function run() {
  console.log("Deletando lp_events...");
  const { error: e1 } = await sb.from('lp_events').delete().not('id', 'is', null);
  if (e1) console.error(e1);

  console.log("Deletando page_visits...");
  const { error: e2 } = await sb.from('page_visits').delete().not('id', 'is', null);
  if (e2) console.error(e2);
  
  console.log("Limpeza concluída.");
}
run();
