// ─────────────────────────────────────────────────────────────────────────────
// A porta do banco do gerador está fechada? Pergunta de fora, como um estranho.
//
// A nossa regra mais cara aprendida: arquivo `MIGRATION_*.sql` no repositório NÃO
// prova que ele rodou. Já aconteceu de um ficar 5 dias só no disco enquanto todo
// mundo achava que estava no ar.
//
// Este script não lê o repositório e não confia em nada de dentro. Ele pega a
// chave publishable — a mesma que está no código-fonte do repo PÚBLICO — e tenta
// ler as tabelas exatamente como qualquer pessoa da internet leria.
//
//   FECHADO = 401/403, ou 404 (tabela nem existe), ou lista vazia por policy
//   ABERTO  = 200 com linha voltando
//
// Rode ANTES e DEPOIS do MIGRATION_fechar_leitura_publica.sql. Antes, esperado é
// ABERTO. Depois, tem que ser FECHADO em tudo — e é isso que fecha o assunto,
// não o arquivo existir.
//
//   npx ts-node --transpile-only scripts/conferir-rls-gerador.ts
//
// Sai com código 1 se qualquer tabela responder ABERTO, para poder virar passo de CI.
// ─────────────────────────────────────────────────────────────────────────────

const URL_BASE = 'https://ancecdfqfwlaujknizof.supabase.co';

// A chave publishable é pública por natureza (ela vai pro navegador). O problema
// nunca foi ela vazar — foi o `anon` ter permissão de leitura do outro lado.
const CHAVE_PUBLICA = 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';

/** As tabelas que carregam dado de pessoa. Acrescente aqui quando criar outra. */
const TABELAS = [
  'eletroposto_nota1',
  'eletroposto_parceria',
  'eletroposto_match',
  'propostas',
  'consultores',
  'prospeccao_empresas',
  'orcamentos',
];

type Veredicto = 'ABERTO' | 'fechado' | 'inexistente';

interface Resultado {
  tabela: string;
  status: number;
  veredicto: Veredicto;
  amostra: string;
}

async function sondar(tabela: string): Promise<Resultado> {
  const url = `${URL_BASE}/rest/v1/${tabela}?select=*&limit=1`;
  let status = 0;
  let corpo = '';
  try {
    const r = await fetch(url, {
      headers: { apikey: CHAVE_PUBLICA, Authorization: `Bearer ${CHAVE_PUBLICA}` },
    });
    status = r.status;
    corpo = (await r.text()).slice(0, 120);
  } catch (e) {
    return { tabela, status: 0, veredicto: 'fechado', amostra: 'sem resposta: ' + String((e as Error).message).slice(0, 60) };
  }

  if (status === 404 || corpo.includes('PGRST205')) {
    return { tabela, status, veredicto: 'inexistente', amostra: 'tabela não existe neste projeto' };
  }
  if (status === 401 || status === 403) {
    return { tabela, status, veredicto: 'fechado', amostra: 'recusado' };
  }
  if (status === 200) {
    // 200 com lista vazia: a policy filtrou tudo. Porta fechada com educação.
    const vazio = corpo.replace(/\s/g, '') === '[]';
    return {
      tabela,
      status,
      veredicto: vazio ? 'fechado' : 'ABERTO',
      amostra: vazio ? 'lista vazia (policy filtrou)' : 'LINHA VOLTOU: ' + corpo.slice(0, 70),
    };
  }
  return { tabela, status, veredicto: 'fechado', amostra: corpo.slice(0, 60) };
}

async function principal(): Promise<void> {
  console.log(`[rls] sondando ${URL_BASE} com a chave publishable, de fora\n`);

  const resultados: Resultado[] = [];
  for (const t of TABELAS) {
    resultados.push(await sondar(t));
  }

  for (const r of resultados) {
    const marca = r.veredicto === 'ABERTO' ? '  ABERTO  ' : r.veredicto === 'inexistente' ? '     —    ' : ' fechado  ';
    console.log(`${marca} ${String(r.status).padStart(3)}  ${r.tabela.padEnd(22)} ${r.amostra}`);
  }

  const abertas = resultados.filter((r) => r.veredicto === 'ABERTO');
  console.log('');
  if (abertas.length === 0) {
    console.log('[rls] nenhuma tabela responde para o papel anônimo. Porta fechada.');
    return;
  }

  console.log(`[rls] ${abertas.length} tabela(s) ainda respondem para qualquer um: ${abertas.map((a) => a.tabela).join(', ')}`);
  console.log('[rls] o MIGRATION_fechar_leitura_publica.sql NÃO está aplicado — ou foi aplicado só em parte.');
  console.log('[rls] ordem: SUPABASE_GERADOR_SERVICE_KEY na Vercel PRIMEIRO, depois o SQL.');
  process.exitCode = 1;
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
