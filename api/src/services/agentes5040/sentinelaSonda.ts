// ─────────────────────────────────────────────────────────────────────────────
// SONDA DA SENTINELA. Prova no banco de verdade o que o teste unitário só finge:
//   1. a foto da Giovanna escreve, lê e apaga (giov_snap:teste);
//   2. a reserva do dia só deixa UM vencer: o 2º insert da mesma chave dá 23505
//      (conta 1 linha), e depois de apagar a conta é 0 (sentinela_ferr:teste).
// Só chaves de teste; não envia nada e não toca na reserva nem na foto do dia.
// ─────────────────────────────────────────────────────────────────────────────

import { reservarNoBanco } from './sentinelaRodada';

type Banco = { from: (t: string) => any };

const CHAVE_FOTO = 'giov_snap:teste';
const CHAVE_RESERVA = 'sentinela_ferr:teste';

async function contar(b: Banco, chave: string): Promise<number> {
  const { count, error } = await b.from('system_state').select('key', { count: 'exact', head: true }).eq('key', chave);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function apagar(b: Banco, chave: string): Promise<void> {
  const { error } = await b.from('system_state').delete().eq('key', chave);
  if (error) throw new Error(error.message);
}

export async function sondaSentinela(principal: Banco, agora: Date = new Date()): Promise<{ ok: boolean; passos: Record<string, unknown> }> {
  const passos: Record<string, unknown> = {};
  try {
    // limpa resto de uma sonda que morreu no meio
    await apagar(principal, CHAVE_FOTO);
    await apagar(principal, CHAVE_RESERVA);

    const foto = { '1': 'agendado', '2': 'vendido' };
    const { error: eGrava } = await principal.from('system_state')
      .upsert({ key: CHAVE_FOTO, value: foto, updated_at: agora.toISOString() }, { onConflict: 'key' });
    if (eGrava) throw new Error(eGrava.message);
    const { data } = await principal.from('system_state').select('value').eq('key', CHAVE_FOTO).maybeSingle();
    passos.foto_leu_igual = JSON.stringify(data?.value) === JSON.stringify(foto);
    await apagar(principal, CHAVE_FOTO);
    passos.foto_apagada = (await contar(principal, CHAVE_FOTO)) === 0;

    passos.reserva_1 = await reservarNoBanco(principal, CHAVE_RESERVA, agora);
    passos.reserva_2 = await reservarNoBanco(principal, CHAVE_RESERVA, agora);   // tem que ser 'ja' (23505)
    passos.conta_depois_de_duas = await contar(principal, CHAVE_RESERVA);        // tem que ser 1
    await apagar(principal, CHAVE_RESERVA);
    passos.conta_depois_de_apagar = await contar(principal, CHAVE_RESERVA);      // tem que ser 0
  } catch (err: any) {
    passos.erro = String(err?.message || err);
    try { await apagar(principal, CHAVE_FOTO); await apagar(principal, CHAVE_RESERVA); } catch { /* melhor esforço */ }
    return { ok: false, passos };
  }
  const ok = passos.foto_leu_igual === true && passos.foto_apagada === true
    && passos.reserva_1 === 'reservado' && passos.reserva_2 === 'ja'
    && passos.conta_depois_de_duas === 1 && passos.conta_depois_de_apagar === 0;
  return { ok, passos };
}
