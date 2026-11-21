// ─────────────────────────────────────────────────────────────────────────────
// HOMOLOGAÇÃO LIDA DO TRELLO (20/11/2026), a leitura por IA de UM anexo do cartão: que documento é (ART, protocolo, parecer de acesso ou outro) e, se
// for protocolo, o número e a data. Só entra aqui quando o NOME do anexo não decide (ou quando é protocolo, para ler número e data). Mesma família de
// modelos e mesmo cliente da leitura do cadastro (`cadastroVendaLeitura.ts`): saída estruturada, plano B se o modelo não existir.
// Nada do documento nem do que foi lido vai para o log: só modelo, status e tempo. Nunca lança.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { novoAnthropic } from '../../utils/anthropicClient';
import { logger } from '../../utils/logger';
import { modeloInexistente, type ClienteLeitura } from './financeiroLeitura';
import { MODELO_PLANO_B, modeloPadrao } from './cadastroVendaLeitura';
import { ehSlotHomolog, type SlotHomolog } from './trelloHomologPuro';

const LOG = 'trello-homolog';
export const HOMOLOG_IA_TEMPO_MS = 45_000;

// Sem `.max()` nem regex (a saída estruturada aceita só um pedaço do JSON Schema): a conferência é feita aqui embaixo.
const Esquema = z.object({
  tipo: z.enum(['art', 'protocolo', 'parecer_acesso', 'outro']),
  numero: z.string(),
  data: z.string(),
});
const formatoZod = zodOutputFormat(Esquema);
const FORMATO = { type: formatoZod.type, schema: formatoZod.schema };

const SISTEMA = `Você lê UM documento anexado ao cartão de homologação de uma usina solar fotovoltaica no Brasil e diz que documento é.
- "art": a ART (Anotação de Responsabilidade Técnica) do CREA, ou o documento dela. O comprovante ou boleto de pagamento da ART NÃO é a ART: é "outro".
- "protocolo": o protocolo ou comprovante de solicitação de acesso feito na distribuidora de energia (Cemig e outras).
- "parecer_acesso": o parecer de acesso da distribuidora, aprovando (ou não) a ligação da usina.
- "outro": qualquer outra coisa (foto, datasheet, contrato, conta de luz, boleto, comprovante de pagamento, projeto).
Se for "protocolo": "numero" é o número do protocolo ou da solicitação, exatamente como está escrito (só letras, números, ponto, barra e hífen), e "data" é a data do protocolo em AAAA-MM-DD. Sem um deles, deixe "" naquele campo.
Se não for "protocolo": "numero" e "data" ficam "". Não invente nada: na dúvida, "outro" e campos vazios.`;
const PEDIDO = 'Que documento é este? Responda no formato pedido.';

export interface LeituraAnexo { tipo: SlotHomolog | 'outro'; numero: string; data: string }

const RE_NUMERO = /^[A-Za-z0-9./-]{1,40}$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
function dataValida(s: string): boolean {
  if (!RE_DATA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A resposta bruta da IA conferida: tipo da lista, número no formato do protocolo, data real. Campo ruim vira "". */
export function limparLeituraAnexo(bruta: unknown): LeituraAnexo | null {
  const r = Esquema.safeParse(bruta);
  if (!r.success) return null;
  const tipo = ehSlotHomolog(r.data.tipo) ? r.data.tipo : 'outro';
  const numero = r.data.numero.trim();
  const data = r.data.data.trim();
  return { tipo, numero: tipo === 'protocolo' && RE_NUMERO.test(numero) ? numero : '', data: tipo === 'protocolo' && dataValida(data) ? data : '' };
}

function saidaDaMensagem(msg: { parsed_output?: unknown; content?: unknown }): unknown {
  if (msg.parsed_output && typeof msg.parsed_output === 'object') return msg.parsed_output;
  const blocos = Array.isArray(msg.content) ? (msg.content as Array<{ type?: string; text?: unknown }>) : [];
  const texto = blocos.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
  try { return texto.trim() ? JSON.parse(texto) : null; } catch { return null; }
}

/** Lê o anexo. `null` = a IA não respondeu (fora do ar, recusou, formato errado): quem chama tenta de novo depois. */
export async function lerAnexoPorIa(a: { bytes: Buffer; mime: string }, cliente?: ClienteLeitura): Promise<LeituraAnexo | null> {
  const t0 = Date.now();
  try {
    const dados = a.bytes.toString('base64');
    const arquivo: Anthropic.ContentBlockParam = a.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dados } }
      : { type: 'image', source: { type: 'base64', media_type: a.mime as 'image/jpeg' | 'image/png' | 'image/webp', data: dados } };
    const ia: ClienteLeitura = cliente ?? (novoAnthropic() as unknown as ClienteLeitura);
    const modelos = [modeloPadrao(), MODELO_PLANO_B].filter((m, i, l) => m && l.indexOf(m) === i);
    for (let i = 0; i < modelos.length; i++) {
      try {
        const stream = ia.messages.stream({
          model: modelos[i], max_tokens: 1500, output_config: { format: FORMATO }, system: SISTEMA,
          messages: [{ role: 'user', content: [arquivo, { type: 'text', text: PEDIDO }] }],
        }, { timeout: HOMOLOG_IA_TEMPO_MS, maxRetries: 1 });
        const msg = ((await stream.finalMessage()) ?? {}) as { stop_reason?: unknown; parsed_output?: unknown; content?: unknown };
        if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return null;
        return limparLeituraAnexo(saidaDaMensagem(msg));
      } catch (err: unknown) {
        if (i < modelos.length - 1 && modeloInexistente(err)) continue;
        logger.error(LOG, 'leitura do anexo falhou', { modelo: modelos[i], status: Number((err as { status?: unknown })?.status) || null, ms: Date.now() - t0 });
        return null;
      }
    }
    return null;
  } catch (err: unknown) {
    logger.error(LOG, 'leitura do anexo lançou erro', { tipo: String((err as { name?: unknown })?.name || 'erro'), ms: Date.now() - t0 });
    return null;
  }
}
