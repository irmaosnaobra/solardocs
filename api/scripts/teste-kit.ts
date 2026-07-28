// Teste ponta a ponta da ponte do Kit de Fechamento (roda contra o banco real,
// com email de teste, e LIMPA tudo no fim). Uso:
//   cd api && npx ts-node --transpile-only scripts/teste-kit.ts
import 'dotenv/config';
import { supabase } from '../src/utils/supabase';
import {
  classificarProdutoKit,
  processarEventoKit,
  acessoDoUsuario,
  type EventoKit,
} from '../src/services/kitIntegradorService';

const EMAIL = `kit-teste-${Date.now()}@solardoc.app`;
const ORDER_KIT = `TESTE-KIT-${Date.now()}`;
const ORDER_BUMP = `TESTE-BUMP-${Date.now()}`;

const ok = (c: boolean, msg: string) => console.log(`${c ? '  OK  ' : ' FALHA'} · ${msg}`);

function evento(over: Partial<EventoKit>): EventoKit {
  return {
    orderId: ORDER_KIT,
    email: EMAIL,
    nome: 'Integrador de Teste',
    telefone: '34999990000',
    produto: 'Kit de Fechamento do Integrador',
    item: 'kit',
    status: 'paid',
    valorCentavos: 2700,
    utm: { utm_source: 'FB', utm_campaign: 'teste-kit|123', utm_medium: 'teste', utm_content: null, utm_term: null },
    payload: { teste: true },
    ...over,
  };
}

async function main() {
  console.log('\n=== 1. Classificação do produto ===');
  ok(classificarProdutoKit('Kit de Fechamento do Integrador', null) === 'kit', 'nome do produto principal → kit');
  ok(classificarProdutoKit('SolarDoc VIP — 30 dias', null) === 'bump_vip', 'bump do VIP reconhecido');
  ok(classificarProdutoKit('Kit de Prospecção', null) === 'bump_prospeccao', 'bump de prospecção reconhecido');
  ok(classificarProdutoKit('Limpa Solar Pro', null) === null, 'LimpaPro NÃO é do kit (segue no funil dele)');
  ok(classificarProdutoKit('Comunidade +Sol', null) === null, 'order bump do LimpaPro não vaza pro kit');

  console.log('\n=== 2. Pix aguardando (não pode liberar nada) ===');
  const pend = await processarEventoKit(evento({ status: 'waiting_payment', orderId: `${ORDER_KIT}-P` }));
  ok(pend.acao === 'registrado', `pedido pendente só registra (acao=${pend.acao})`);
  const { data: semConta } = await supabase.from('users').select('id').eq('email', EMAIL).maybeSingle();
  ok(!semConta, 'nenhuma conta criada com pagamento pendente');

  console.log('\n=== 3. Compra aprovada do kit ===');
  const r1 = await processarEventoKit(evento({}));
  ok(r1.acao === 'acesso_liberado', `acesso liberado (acao=${r1.acao})`);
  ok(!!r1.userId, 'conta criada/vinculada');
  ok(r1.contaCriada === true, 'conta é nova (pendente, sem senha)');

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plano, limite_documentos, password_hash, reset_token, utm_source, utm_medium, whatsapp, nome')
    .eq('email', EMAIL)
    .single();
  ok(user.password_hash === null, 'conta PENDENTE — cliente ainda vai definir a senha');
  ok(!!user.reset_token, 'reset_token gerado (é o link do e-mail de acesso)');
  ok(user.plano === 'free' && user.limite_documentos === 10, 'entra como free com 10 documentos');
  ok(user.utm_medium === 'teste' || user.utm_medium === 'isca-integrador', `origem carimbada (utm_medium=${user.utm_medium})`);
  ok(user.whatsapp === '34999990000', 'whatsapp salvo');

  console.log('\n=== 4. Reentrega do MESMO pedido (idempotência) ===');
  const r2 = await processarEventoKit(evento({}));
  ok(r2.acao === 'ja_processado', `reentrega não duplica (acao=${r2.acao})`);
  const { count } = await supabase.from('kit_pedidos').select('*', { count: 'exact', head: true }).eq('email', EMAIL);
  ok(count === 2, `2 linhas em kit_pedidos (1 pendente + 1 paga) — veio ${count}`);
  const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('email', EMAIL);
  ok(users === 1, `1 única conta — veio ${users}`);

  console.log('\n=== 5. Bump do VIP (webhook separado, como a Kiwify manda) ===');
  const r3 = await processarEventoKit(
    evento({ orderId: ORDER_BUMP, item: 'bump_vip', produto: 'SolarDoc VIP — 30 dias', valorCentavos: 1900 }),
  );
  ok(r3.trialVip === true, 'trial VIP concedido');
  const { data: comVip } = await supabase
    .from('users').select('plano, limite_documentos, pack_trial_until').eq('email', EMAIL).single();
  ok(comVip.plano === 'ilimitado' && comVip.limite_documentos === 999999, 'conta virou ilimitado');
  const dias = Math.round((new Date(comVip.pack_trial_until).getTime() - Date.now()) / 86400000);
  ok(dias === 30, `pack_trial_until = +30 dias (veio ${dias})`);

  console.log('\n=== 6. Reentrega do bump não estende o trial ===');
  const antes = comVip.pack_trial_until;
  const r4 = await processarEventoKit(
    evento({ orderId: ORDER_BUMP, item: 'bump_vip', produto: 'SolarDoc VIP — 30 dias', valorCentavos: 1900 }),
  );
  const { data: depois } = await supabase.from('users').select('pack_trial_until').eq('email', EMAIL).single();
  ok(r4.trialVip === false, 'segunda entrega não concede de novo');
  ok(depois.pack_trial_until === antes, 'validade do trial inalterada');

  console.log('\n=== 7. Leitura do acesso (o que a aba /materiais vê) ===');
  const acesso = await acessoDoUsuario(user.id, EMAIL);
  ok(acesso.temKit === true, 'temKit = true');
  ok(acesso.itens.includes('kit') && acesso.itens.includes('bump_vip'), `itens = ${JSON.stringify(acesso.itens)}`);
  ok(!!acesso.trialVipAte, 'trialVipAte preenchido');

  console.log('\n=== 8. Progresso do material ===');
  await supabase.from('kit_progresso').upsert({ user_id: user.id, modulo: 'objecoes' }, { onConflict: 'user_id,modulo' });
  await supabase.from('kit_progresso').upsert({ user_id: user.id, modulo: 'objecoes' }, { onConflict: 'user_id,modulo' });
  const { count: prog } = await supabase
    .from('kit_progresso').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
  ok(prog === 1, `marcar duas vezes não duplica (veio ${prog})`);

  console.log('\n=== 9. Assinante que compra o kit não é rebaixado nem "ganha" o que já paga ===');
  await supabase.from('users').update({ plano: 'ilimitado', pack_trial_until: null }).eq('id', user.id);
  const r5 = await processarEventoKit(
    evento({ orderId: `${ORDER_BUMP}-2`, item: 'bump_vip', produto: 'SolarDoc VIP — 30 dias' }),
  );
  ok(r5.trialVip === false, 'não concede trial pra quem já é ilimitado');

  // ── Limpeza: apaga só o que ESTE teste criou ──
  console.log('\n=== Limpando dados de teste ===');
  await supabase.from('kit_progresso').delete().eq('user_id', user.id);
  const { error: e1 } = await supabase.from('kit_pedidos').delete().eq('email', EMAIL);
  const { error: e2 } = await supabase.from('users').delete().eq('email', EMAIL);
  ok(!e1 && !e2, 'kit_pedidos, kit_progresso e a conta de teste removidos');

  const { count: sobrou } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('email', EMAIL);
  ok(sobrou === 0, 'banco limpo');
  console.log('\nFIM\n');
}

main().catch((e) => {
  console.error('ERRO NO TESTE:', e);
  process.exit(1);
});
