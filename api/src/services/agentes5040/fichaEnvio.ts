// ─────────────────────────────────────────────────────────────────────────────
// O ENVIO DA FICHA AO CONSULTOR (A4). ÚNICO arquivo da pasta agentes5040/ que importa o
// zapiClient: o ensaio e o resto do núcleo não enviam nada, e o teste de isolamento
// depende de isto continuar verdadeiro.
//
// Condições do chefe-antiban (robô `ficha_consultor_5040`, aviso_interno_p2):
//  · UMA bolha por ficha, para UM consultor, pela instância 'io';
//  · nunca em paralelo: quem chama envia um card por vez, esperando o anterior;
//  · o telefone vem da tabela `consultores` do banco do gerador (a mesma do
//    reagendarDigest), nunca de um mapa copiado no código;
//  · o carimbo é a reserva `ficha_card:<id>` (fichaTick.ts), fora de BOT_SENT_PREFIXES
//    e nunca `aviso_sent:` (que conta como frio no lineThrottle).
// ─────────────────────────────────────────────────────────────────────────────

import { sendWhatsApp, linhaEmCooldown } from '../agents/zapiClient';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { MAX_CARACTERES_FICHA } from './chaves';
import { hmacDe, idChaveHmac } from './hmac';
import { lerAlvoVivo } from './interruptores';


const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
const chaveNome = (s: unknown): string => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Os mesmos números que os avisos antigos usam (TEL_CONSULTOR de leadsMetaService.ts e manychatLeadService.ts,
 * EQUIPE de ioSolar.ts). Só entram quando a tabela `consultores` não tem o telefone do dono do card:
 * ficha sem destino é aviso perdido. Um teste confere que os números seguem iguais aos do leadsMetaService.
 */
export const TELEFONES_DE_RESERVA: Readonly<Record<string, string>> = Object.freeze({
  thiago: '34991360223', diego: '34991360172', nilce: '34991516846', giovanna: '34993396255',
});

/** O celular do dono (o mesmo RESUMO_DIA_WHATS do cron.ts). Recebe a ficha quando o card não tem consultor com telefone. */
export function telefoneDoDono(): string {
  const v = soDigitos(process.env.RESUMO_DIA_WHATS);
  return v.length >= 10 && v.length <= 13 ? v : '34991360223';
}

/** A linha 'io' está em cooldown (falhou há menos de 60 s)? Pergunta ANTES de reservar: em cooldown não sai nada. */
export function linhaIoEmCooldown(): boolean { return linhaEmCooldown('io'); }

/** O erro PROVA que nada saiu (cooldown ou credencial ausente)? Então a reserva volta a pendente. 5xx e timeout podem ter saído: ficam finais. */
export function erroProvaQueNaoSaiu(err: unknown): boolean {
  return /em cooldown|credenciais Z-API ausentes/i.test(String((err as { message?: string } | null)?.message ?? err));
}

/** nome do consultor (minúsculo) -> telefone só com dígitos, ou erro (nunca lista vazia fingindo que está tudo bem). */
export async function carregarTelefonesConsultores(): Promise<{ ok: true; mapa: Map<string, string> } | { ok: false; codigo: string }> {
  try {
    const { data, error } = await supabaseGerador.from('consultores').select('nome, whatsapp');
    if (error) return { ok: false, codigo: String((error as { code?: string }).code ?? 'desconhecido') };
    const mapa = new Map<string, string>();
    for (const c of (data ?? []) as Array<{ nome: string | null; whatsapp: string | null }>) {
      const tel = soDigitos(c.whatsapp);
      if (c.nome && tel.length >= 10 && tel.length <= 13) mapa.set(chaveNome(c.nome), tel);
    }
    return { ok: true, mapa };
  } catch {
    return { ok: false, codigo: 'interno' };
  }
}

/**
 * O lead é NÚMERO DE TESTE (o hmac da chave dele está em ag5040_vivo_alvo.hmacs, com o mesmo kid)? Ficha de número de teste vai
 * só para o celular do DONO (telefoneDoDono), nunca para a consultora nem para a Giovanna. true = é de teste; false = não é;
 * null = não deu para ler o alvo (quem chama decide: a rodada viva manda ao dono, o fichaTick segue o destino normal).
 * Vale o alvo inteiro, em qualquer modo da dona: número que está na lista de teste é de teste.
 */
export async function leadEhDeTeste(chave: string | null | undefined): Promise<boolean | null> {
  try {
    const k = String(chave ?? '');
    if (!k) return false;
    const alvo = await lerAlvoVivo();
    if (!alvo) return null;
    const kid = idChaveHmac();
    if (!kid || alvo.kid !== kid) return false;
    const h = hmacDe(k);
    return !!h && alvo.hmacs.includes(h);
  } catch {
    return null;
  }
}

/** O telefone do consultor dono do card, ou null. */
export function telefoneDoConsultor(mapa: ReadonlyMap<string, string>, vendedorNome: string | null | undefined): string | null {
  const nome = chaveNome(vendedorNome);
  if (!nome) return null;
  return mapa.get(nome) ?? TELEFONES_DE_RESERVA[nome] ?? null;
}

/** Manda UMA bolha ao consultor pela linha IO. Lança se o envio falhar (quem chama decide o que fazer). */
export async function enviarFichaAoConsultor(telefone: string, texto: string): Promise<void> {
  const tel = soDigitos(telefone);
  if (tel.length < 10 || tel.length > 13) throw new Error('telefone do consultor inválido');
  const corpo = String(texto ?? '');
  if (!corpo.trim()) throw new Error('ficha vazia');
  if (corpo.length > MAX_CARACTERES_FICHA) throw new Error('ficha passa de uma bolha');
  await sendWhatsApp(tel, corpo, 'io');
}

/**
 * Teto de emergência da linha para a ficha da B1d (a rodada viva confere ANTES de cada ficha): a mesma conta do
 * vivoEnvio (tudo que a linha conta, mais ag5040_sent: e ficha_lead:), 60 na última hora e 450 em 24 h.
 * 'teto' = a linha já passou do limite (a ficha espera); 'erro' = não deu para contar (conta que não se fez não passa).
 * O lineThrottle e o vivoEnvio entram por import dinâmico: só quem chama este teto os carrega, e os
 * testes da ficha antiga seguem sem eles. Só este arquivo da pasta pode tocar a contagem da linha (isolamento).
 */
export async function tetoDaLinhaPermiteFicha(agora: Date): Promise<'ok' | 'teto' | 'erro'> {
  try {
    const { supabase } = await import('../../utils/supabase');
    const { prefixosDaLinha, PREFIXOS_AGENDA, PREFIXOS_RESPOSTA_AGENTES } = await import('../agents/whatsapp/lineThrottle');
    const envio = await import('./vivoEnvio');
    const prefixos = [...new Set([...prefixosDaLinha(), ...PREFIXOS_AGENDA, ...PREFIXOS_RESPOSTA_AGENTES])];
    const filtro = prefixos.map(p => `key.like.${p}%`).join(',');
    const contar = async (desde: Date, parar: number): Promise<number | null> => {
      let total = 0;
      for (let de = 0; de < 100_000; de += 1000) {
        const { data, error } = await supabase.from('system_state').select('key').or(filtro)
          .gte('updated_at', desde.toISOString()).order('key', { ascending: true }).range(de, de + 999);
        if (error) return null;
        const lote = (data ?? []) as unknown[];
        total += lote.length;
        if (total >= parar || lote.length < 1000) return total;
      }
      return total;
    };
    const hora = await contar(new Date(agora.getTime() - 3_600_000), envio.LIMITES.tetoLinhaHora);
    if (hora === null) return 'erro';
    if (hora >= envio.LIMITES.tetoLinhaHora) return 'teto';
    const dia = await contar(new Date(agora.getTime() - 86_400_000), envio.LIMITES.tetoLinhaDia);
    if (dia === null) return 'erro';
    return dia >= envio.LIMITES.tetoLinhaDia ? 'teto' : 'ok';
  } catch {
    return 'erro';
  }
}
