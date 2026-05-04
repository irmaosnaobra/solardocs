import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { sendHuman } from '../zapiClient';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const API_URL = process.env.API_URL || 'https://api.solardoc.app';
const MAX_HISTORY = 40;

// ─── system prompt: Carla — vendedora senior B2B SolarDoc ──────────

const CARLA_SYSTEM_PROMPT = `Você é a "Carla", da SolarDoc Pro. Vendeu solar 6 anos antes — fala como empresária pra empresário, sem firula. Sua única meta: ENTREGAR O ACESSO e fazer o cara USAR. Nada mais importa.

⚠️ REGRA ZERO — OBRIGATÓRIA EM TODA RESPOSTA:
RELEIA o histórico inteiro do lead antes de escrever. Anote o que ele já te disse: nome, empresa, volume, dor. NUNCA pergunte algo já respondido. NUNCA repita apresentação. NUNCA use a mesma frase de antes — varia abertura, conector, fechamento.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMO VOCÊ FALA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Mensagens MUITO curtas. 1 frase por bolha quando der.
- Direta. Empresário não tem tempo. Nada de "tudo bem?", "como posso ajudar", "espero te ajudar".
- Humana — pequenas imperfeições naturais ("vi aqui", "rapidinho", "joia").
- Trate como par — vocês são 2 que correm o dia inteiro.
- 0-1 emoji NO MÁXIMO por bolha. Idealmente nenhum.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# A PLATAFORMA EM 1 LINHA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**App de celular grátis que gera contrato com o cliente do lado em 2 minutos. Sem enrolação.**

Frases que você pode usar (varia, não repete):
- "É um app no celular, faz contrato na frente do cliente em 2min"
- "Grátis, 10 docs vitalícios, sem cartão"
- "Você abre, escolhe o doc, o cliente assina pelo WhatsApp"
- "Sem precisar voltar pro escritório pra fechar"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FLUXO — META É ENTREGAR ACESSO E FAZER USAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ETAPA 1 — APRESENTAÇÃO + NOME (curtíssima)

Se você JÁ TEM o nome dele (do contato/histórico):
  "Oi [Nome]! Sou a Carla, da SolarDoc. || Tu fecha contrato com cliente como hoje?"

Se NÃO TEM o nome:
  "Oi! Sou a Carla, da SolarDoc. || Como posso te chamar?"
  → Espera o nome, daí avança.

ETAPA 2 — PRIMEIRA SEMENTE (sem qualificar muito)
"[Nome], a gente fez um app que gera contrato/proposta na frente do cliente em 2min. || Quer testar grátis?"

Se ele topa → manda link na hora (ETAPA 3).
Se pergunta detalhe → responde curto + manda link.
Se objeção → responde curto + manda link.

ETAPA 3 — ENTREGAR O ACESSO
"Beleza. ${APP_URL}/auth || 10 docs grátis pra sempre, sem cartão. Loga, cadastra teu CNPJ e gera o primeiro doc."

(Marca [ESTAGIO:fechado] aqui — você ENTREGOU o acesso. Missão técnica cumprida.)

ETAPA 4 — FAZER USAR (depois que ele logou ou recebeu o link)
- Se ele disser que logou: "Show. Cadastra a empresa (CNPJ + logo) que aí libera os docs. Algum cliente pra testar essa semana?"
- Se sumiu após link: 1 cutuque após algumas horas — "Conseguiu logar?"
- NÃO repete CTA. NÃO empurra.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# OBJEÇÕES — RESPOSTAS CURTAS (sempre fechando com link ou próximo passo)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Já tenho contrato pronto"
→ "Tu sobe a tua logo e o app gera no teu padrão. Não muda processo, só deixa de digitar. ${APP_URL}/auth"

"Quanto custa?"
→ "Começa do grátis (10 docs vitalícios, sem cartão). PRO R$47, VIP R$97. ${APP_URL}/auth"

"Já vi outras ferramentas"
→ "Essa nasceu dentro da Irmãos na Obra, 8 anos no setor. Cláusulas auditadas por advogado de solar. Testa grátis: ${APP_URL}/auth"

"Vou pensar"
→ "Joia. Link aí: ${APP_URL}/auth — sem cartão. Quando quiser testar com cliente, é só logar."

"Tenho equipe"
→ "VIP (R$97) ilimitado. Multi-usuário tá no roadmap. Por enquanto compartilha login no VIP. ${APP_URL}/auth"

"Funciona pra minha cidade?"
→ "Brasil todo. Procuração se ajusta à distribuidora do teu CNPJ."

"Tem assinatura digital?"
→ "Tem, Autentique ICP-Brasil. Cliente assina pelo celular em 30s."

"E se eu cancelar?"
→ "Botão na plataforma. Sem retenção, sem letra miúda."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONHECIMENTO TÉCNICO (use sob demanda, NÃO derrama)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 5 documentos: Contrato Instalação, Proposta Bancária, Procuração de Acesso, Contrato PJ, Prestação de Serviço (O&M).
- Bancos cobertos: BV, Santander, Sicredi, BNDES, Solfacil, Sol+.
- Distribuidoras: Cemig, Enel, CPFL, Coelba, Equatorial, Energisa, Light, Copel.
- Planos: FREE 10 docs vitalícios · PRO R$47/mês 90 docs · VIP R$97/mês ilimitado.
- Cancela no botão. Stripe (cartão) ou PIX avulso.
- Servidor BR (Supabase SP), LGPD.

⚠️ Só fale disso se o lead PERGUNTAR. Não derrama informação preventiva.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# QUANDO O CLIENTE RELATA PROBLEMA TÉCNICO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Se ele disser que algo quebrou ("não logo", "não recebi reset", "deu erro"):
1. UMA bolha curta: "Vou checar agora, 1min."
2. Use a tool **verificar_status_plataforma** com a área (auth/dashboard/geral).
3. Se confirmar bug, **registrar_chamado**.
4. Volta com resposta humana baseada no que a tool retornou.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGRAS DE OURO (NÃO NEGOCIÁVEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Mensagens CURTAS. 1-2 frases por bolha. Empresário lê em 2s.
2. UMA pergunta por vez. NÃO emende duas perguntas.
3. SEMPRE entrega o link ${APP_URL}/auth o mais cedo possível — link é a ponte.
4. NÃO repete o link toda hora. Mandou uma vez, parou.
5. NÃO repete frase usada antes — varia palavras, abertura, fechamento.
6. Se ele já te deu uma info, NUNCA pergunta de novo.
7. Se relatar bug → tools imediato, sem improvisar.
8. Honestidade > venda. Não souber, "vou validar com a equipe e te volto".
9. Sem markdown, sem lista numerada — é WhatsApp.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DESCARTE / RECUSA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Se o lead disser claramente:
- "Já tenho fornecedor / empresa / sistema"
- "Não quero mais" / "Não tenho interesse"
- "Para de me mandar mensagem"
- "Já contratei outro"

Manda UMA despedida curta sincera ("Joia, sucesso aí. Se mudar, me chama.") e marca [ESTAGIO:perdido]. NUNCA insiste.

⚠️ "Não quero financiamento" / "Não quero pagar mais que X" NÃO são recusa — é negociação. Continue.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FORMATO DE RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Bolhas separadas por ||
- MÁXIMO 2 bolhas (3 em casos raros)
- Cada bolha: 1 frase curta
- Sem markdown, sem listas, sem emojis exagerados — é WhatsApp

# ESTÁGIO DO LEAD (OBRIGATÓRIO no fim de toda resposta)
[ESTAGIO:novo] - Sem nome
[ESTAGIO:frio] - Sem CNPJ ou não é empresário solar
[ESTAGIO:morno] - Qualificou parcial, ainda sem link enviado
[ESTAGIO:quente] - Quente, prestes a receber link
[ESTAGIO:fechado] - Recebeu o link de signup
[ESTAGIO:perdido] - Recusou ou parou de responder
[ESTAGIO:problema_tecnico] - Cliente com bug em diagnóstico`;

// ─── tools que Carla pode chamar ────────────────────────────────────

const CARLA_TOOLS: Anthropic.Tool[] = [
  {
    name: 'verificar_status_plataforma',
    description: 'Verifica em tempo real se uma area da plataforma SolarDoc esta funcionando. Use quando cliente reportar bug.',
    input_schema: {
      type: 'object',
      properties: {
        area: {
          type: 'string',
          enum: ['auth', 'dashboard', 'geral'],
          description: 'auth = login/cadastro/reset senha; dashboard = pagina logada; geral = check completo',
        },
      },
      required: ['area'],
    },
  },
  {
    name: 'registrar_chamado',
    description: 'Registra um chamado tecnico para a equipe humana investigar. Use quando o problema for confirmado ou for caso especifico que precisa validacao manual.',
    input_schema: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Area afetada (ex: reset_senha, login, geracao_doc, pagamento)' },
        descricao: { type: 'string', description: 'Descricao curta do problema do cliente' },
      },
      required: ['area', 'descricao'],
    },
  },
];

// ─── tool implementations ──────────────────────────────────────────

async function verificarStatusPlataforma(area: string): Promise<string> {
  const checks: Array<{ url: string; method: 'GET' | 'POST'; expect: number; label: string; body?: any }> = [];

  if (area === 'auth' || area === 'geral') {
    checks.push({
      url: `${API_URL}/auth/forgot-password`,
      method: 'POST',
      expect: 200,
      label: 'reset_senha',
      body: { email: 'healthcheck@solardoc.app' },
    });
  }
  if (area === 'dashboard' || area === 'geral') {
    checks.push({
      url: `${APP_URL}/`,
      method: 'GET',
      expect: 200,
      label: 'dashboard',
    });
    checks.push({
      url: `${API_URL}/`,
      method: 'GET',
      expect: 200,
      label: 'api',
    });
  }

  const results: string[] = [];
  for (const c of checks) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(c.url, {
        method: c.method,
        headers: { 'Content-Type': 'application/json' },
        body: c.body ? JSON.stringify(c.body) : undefined,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const ok = res.status === c.expect || (res.status >= 200 && res.status < 400);
      results.push(`${c.label}: ${ok ? 'OK' : `FALHA (HTTP ${res.status})`}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`${c.label}: TIMEOUT/ERRO (${msg.slice(0, 60)})`);
    }
  }

  return results.join(' | ');
}

async function registrarChamado(phone: string, nome: string | null, area: string, descricao: string, diagnostico: string): Promise<string> {
  const { data, error } = await supabase
    .from('tech_issues')
    .insert({
      phone,
      nome,
      area,
      descricao: descricao.slice(0, 500),
      diagnostico_automatico: diagnostico.slice(0, 500),
      status: 'aberto',
    })
    .select('id')
    .single();

  if (error) return `falha ao registrar (${error.message.slice(0, 80)})`;
  return `chamado #${(data?.id as string)?.slice(0, 8)} aberto`;
}

// ─── sessao ─────────────────────────────────────────────────────────

interface SdrB2bSession {
  messages: { role: 'user' | 'assistant'; content: any }[];
  nome?: string;
}

async function getSession(phone: string): Promise<SdrB2bSession> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', phone)
    .eq('tipo', 'sdr_b2b')
    .single();
  return {
    messages: (data?.messages as any[]) || [],
    nome: data?.nome || undefined,
  };
}

async function saveSession(
  phone: string,
  messages: { role: 'user' | 'assistant'; content: any }[],
  nome?: string | null,
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  const payload: any = {
    phone,
    tipo: 'sdr_b2b',
    messages: trimmed,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── extracao de estagio ────────────────────────────────────────────

type Estagio = 'novo' | 'frio' | 'morno' | 'quente' | 'fechado' | 'perdido' | 'problema_tecnico';

function extractEstagio(raw: string): { text: string; estagio: Estagio } {
  const match = raw.match(/\[ESTAGIO:(novo|frio|morno|quente|fechado|perdido|problema_tecnico)\]/i);
  const estagio = (match?.[1]?.toLowerCase() ?? 'novo') as Estagio;
  const text = raw.replace(/\[ESTAGIO:(novo|frio|morno|quente|fechado|perdido|problema_tecnico)\]/gi, '').trim();
  return { text, estagio };
}

// ─── CRM ────────────────────────────────────────────────────────────

async function upsertCrmLead(params: {
  phone: string;
  nome?: string | null;
  estagio: Estagio;
  ultimaMensagem: string;
  totalMensagens: number;
  tracking?: { ctwa_clid?: string | null };
}): Promise<void> {
  const { phone, nome, estagio, ultimaMensagem, totalMensagens, tracking } = params;

  const payload: any = {
    phone,
    tipo: 'b2b',
    estagio: estagio === 'problema_tecnico' ? 'morno' : estagio,
    ultima_mensagem: ultimaMensagem.slice(0, 300),
    total_mensagens: totalMensagens,
    aguardando_resposta: false,
    ultimo_contato: new Date().toISOString(),
    contatos: 0,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  if (tracking?.ctwa_clid) payload.ctwa_clid = tracking.ctwa_clid;

  const { data: existing } = await supabase
    .from('sdr_leads')
    .select('estagio, ctwa_clid')
    .eq('phone', phone)
    .single();

  const protegidos = ['fechado', 'perdido', 'quente'];
  if (existing?.estagio && protegidos.includes(existing.estagio)) {
    payload.estagio = existing.estagio;
  }

  if (!existing && tracking?.ctwa_clid) {
    await sendMetaEvent('Lead', {
      customData: { ctwa_clid: tracking.ctwa_clid, phone, lead_type: 'b2b_solardoc' },
    }).catch(console.error);
  }

  await supabase.from('sdr_leads').upsert(payload, { onConflict: 'phone' });
}

// ─── handler principal com tool calling ────────────────────────────

export async function handleSolarDocB2bLead(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null },
  imageSource?: { type: 'base64'; media_type: any; data: string } | null
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
  const session = await getSession(cleanPhone);
  const nome = session.nome || senderName || null;

  // Se tem imagem, content multimodal; senao texto puro
  const userContent: any = imageSource
    ? [
        { type: 'image', source: imageSource },
        { type: 'text', text: text.trim() || 'Cliente enviou esta imagem.' },
      ]
    : text.trim();

  const messages: any[] = [
    ...session.messages,
    { role: 'user', content: userContent },
  ];

  // Loop de tool calling — Carla pode chamar tools antes de responder
  let finalText = '';
  for (let turn = 0; turn < 4; turn++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: CARLA_SYSTEM_PROMPT,
      tools: CARLA_TOOLS,
      messages: messages.filter(m => m.content),
    });

    if (response.stop_reason === 'tool_use') {
      // Anexa a resposta dela (com tool_use blocks) ao histórico
      messages.push({ role: 'assistant', content: response.content });

      // Executa cada tool e devolve os resultados
      const toolResults: any[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result = '';
        if (block.name === 'verificar_status_plataforma') {
          const area = (block.input as any)?.area || 'geral';
          result = await verificarStatusPlataforma(area);
        } else if (block.name === 'registrar_chamado') {
          const area = (block.input as any)?.area || 'desconhecido';
          const descricao = (block.input as any)?.descricao || text;
          // Diagnostico = ultima saida de verificar_status, se houver
          const lastDiag = toolResults
            .map(r => r.content)
            .find((c: string) => c.includes('OK') || c.includes('FALHA'));
          result = await registrarChamado(cleanPhone, nome, area, descricao, lastDiag || 'sem diagnostico previo');
        } else {
          result = 'tool desconhecida';
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Resposta final em texto
    const textBlock = response.content.find((b: any) => b.type === 'text') as any;
    finalText = textBlock?.text || '';
    break;
  }

  if (!finalText) {
    finalText = 'Tive um problema aqui pra te responder, me da 30 segundos. [ESTAGIO:morno]';
  }

  const { text: cleanText, estagio } = extractEstagio(finalText);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  const allMessages = [...messages, { role: 'assistant', content: cleanText }];

  await Promise.all([
    saveSession(cleanPhone, allMessages, nome),
    upsertCrmLead({
      phone: cleanPhone,
      nome,
      estagio,
      ultimaMensagem: text,
      totalMensagens: allMessages.filter((m: any) => m.role === 'user' && typeof m.content === 'string').length,
      tracking,
    }),
  ]);
}
