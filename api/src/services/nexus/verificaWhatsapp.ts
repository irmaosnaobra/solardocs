import { supabase } from '../../utils/supabase';
import { hmacDe } from '../agentes5040/hmac';
import { liberarChave, reservarChave } from '../agentes5040/cota';
import { linhaEmCooldown, numeroTemWhatsApp } from '../agents/zapiClient';
import { rampaReconexaoVigente } from '../agents/whatsapp/lineThrottle';

// Verificação "esse número tem WhatsApp?" das listas de interesse (NEXUS hoje; a lista da Irmãos na
// Obra usa a MESMA função e o MESMO contador). Só LÊ na Z-API (phone-exists): nenhuma mensagem sai
// daqui. Condições do chefe-antiban, na ordem:
//   1. uma consulta por telefone, reservada por INSERT em system_state (nexus_pe:<hmac>) ANTES de consultar;
//   2. teto da rota inteira (10 em 10 min, 30 em 1 h, 200 em 24 h), contado DEPOIS de reservar e
//      incluindo a própria chave: passou, a chave é solta e não consulta (atômico contra rajada);
//   3. linha caída ou em rampa: não consulta;
//   4. consulta com prazo de 4 s ('erro' e prazo viram null; a vaga fica gasta);
//   5. faxina própria das chaves com mais de 48 h.
// Nunca lança. Telefone cru nunca vai em chave nem em log.

const PREFIXO = 'nexus_pe:';
const PRAZO_MS = 4000;
const FAXINA_MS = 48 * 3_600_000;
const TETOS = [
  { minutos: 10, max: 10 },
  { minutos: 60, max: 30 },
  { minutos: 1440, max: 200 },
] as const;

type Consulta = 'sim' | 'nao' | 'erro';

export interface ResultadoWhatsapp {
  /** true = tem WhatsApp, false = não tem, null = não verificado. */
  whatsappOk: boolean | null;
  /** Só quando a consulta (ou o que já estava guardado) deu que NÃO tem. */
  aviso?: 'sem_whatsapp';
}

const doResultado = (r: unknown): boolean | null => (r === 'sim' ? true : r === 'nao' ? false : null);
const resultado = (whatsappOk: boolean | null): ResultadoWhatsapp =>
  whatsappOk === false ? { whatsappOk, aviso: 'sem_whatsapp' } : { whatsappOk };

/** Forma canônica só para a CHAVE do contador: 55 + DDD + 8 últimos dígitos (sem o 9 de celular). */
export function telefoneCanonico(telefone: string): string {
  const d = String(telefone ?? '').replace(/\D/g, '');
  return d.startsWith('55') && d.length === 13 ? `55${d.slice(2, 4)}${d.slice(-8)}` : d;
}

async function linhaPronta(): Promise<boolean> {
  try {
    if (linhaEmCooldown('io')) return false;
    const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', 'zapi_io_health').maybeSingle();
    if (error) return false;
    const { estadoDaLinha } = await import('../gerador/caixaWhatsapp');
    const row = data as { value?: { downStreak?: number | null; ultimaConexao?: string | null } | null; updated_at?: string | null } | null;
    if (estadoDaLinha(row?.value ?? null, row?.updated_at ?? null, Date.now()).estado === 'caida') return false;
    return (await rampaReconexaoVigente()) === null;
  } catch { return false; }
}

/** Conta as janelas COM a chave própria já reservada: passou de qualquer teto = false. */
async function dentroDoTeto(agora: number): Promise<boolean> {
  try {
    for (const { minutos, max } of TETOS) {
      const desde = new Date(agora - minutos * 60_000).toISOString();
      const { count, error } = await supabase.from('system_state')
        .select('key', { count: 'exact', head: true }).like('key', `${PREFIXO}%`).gte('updated_at', desde);
      if (error || (count ?? 0) > max) return false;
    }
    return true;
  } catch { return false; }
}

async function consultar(telefone: string): Promise<Consulta> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const prazo = new Promise<Consulta>((ok) => { timer = setTimeout(() => ok('erro'), PRAZO_MS); });
    return await Promise.race([numeroTemWhatsApp(telefone, 'io'), prazo]);
  } catch { return 'erro'; } finally { clearTimeout(timer); }
}

async function guardado(chave: string): Promise<boolean | null> {
  try {
    const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    return doResultado((data as { value?: { r?: string } | null } | null)?.value?.r);
  } catch { return null; }
}

async function guardarEFaxinar(chave: string, r: Consulta, agora: number): Promise<void> {
  try {
    await supabase.from('system_state')
      .update({ value: { r, em: new Date(agora).toISOString() } }).eq('key', chave);
    await supabase.from('system_state')
      .delete().like('key', `${PREFIXO}%`).lt('updated_at', new Date(agora - FAXINA_MS).toISOString());
  } catch { /* a faxina da próxima consulta leva */ }
}

/**
 * O WhatsApp de um cadastro. Com `tabela` (precisa de `telefone` e `whatsapp_ok`), a linha que já existe
 * lá com `whatsapp_ok` preenchido vale e não consulta. Telefone de teste é decisão de quem chama (não chame).
 */
export async function verificarWhatsapp(telefone: string, opcoes: { tabela?: string } = {}): Promise<ResultadoWhatsapp> {
  return resultado(await decidir(telefone, opcoes.tabela));
}

async function decidir(telefone: string, tabela?: string): Promise<boolean | null> {
  try {
    if (tabela) {
      const { data: linha } = await supabase.from(tabela).select('whatsapp_ok').eq('telefone', telefone).maybeSingle();
      const ja = (linha as { whatsapp_ok?: boolean | null } | null)?.whatsapp_ok;
      if (typeof ja === 'boolean') return ja;
    }

    const hmac = hmacDe(telefoneCanonico(telefone));
    if (!hmac) return null;
    if (!(await linhaPronta())) return null;
    const agora = Date.now();

    const chave = `${PREFIXO}${hmac}`;
    const reserva = await reservarChave(chave, { r: 'pendente' }, new Date(agora));
    if (reserva === 'ja_existe') return guardado(chave);
    if (reserva === 'erro') return null;

    if (!(await dentroDoTeto(agora))) {
      await liberarChave(chave);
      return null;
    }

    const r = await consultar(telefone);
    await guardarEFaxinar(chave, r, agora);
    return doResultado(r);
  } catch { return null; }
}
