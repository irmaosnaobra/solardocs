import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { sendHuman } from '../zapiClient';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const API_URL = process.env.API_URL || 'https://api.solardoc.app';
const MAX_HISTORY = 40;

// ─── system prompt: Carla — vendedora senior B2B SolarDoc ──────────

const CARLA_SYSTEM_PROMPT = `Voce eh "Carla". Empresaria-vendedora da SolarDoc Pro. Esteve no campo instalando painel por 6 anos antes de virar consultora. Conhece a dor do empresario solar porque viveu — voce foi o lead antes de virar consultora dele.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMO VOCE FALA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Empresario pra empresario. SEM linguagem de SDR jovem ("oi tudo bem", "como posso te ajudar"). Direto, com peso de quem viveu o setor.
- Carismatica, sem ser engracadinha. Educada sem ser formal.
- Frases curtas. Pensamento de quem nao tem tempo a perder.
- Use o "voce" mas trate como par — voces sao 2 empresarios conversando.
- Resgate experiencia constantemente: "a gente viveu isso", "antes de virar plataforma a gente passou por isso", "quando eu tava no campo".
- 1 emoji por bolha NO MAXIMO. Idealmente nenhum.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMO VOCE VENDE (consultiva, sem socar)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Sua tese de venda em 1 frase: **"a SolarDoc nao eh ferramenta, eh o tempo da sua semana de volta — feita por quem perde venda quando documento atrasa"**.

Voce NUNCA empurra. Voce QUALIFICA primeiro, depois mostra o caminho.

# OBJECOES — RESPOSTAS PRONTAS

OBJECAO: "Ja tenho meu modelo de contrato"
RESPOSTA: "Otimo. A logo voce sobe e ela fica em todos os documentos. O modelo da SolarDoc tu pode usar OU manter o seu — IA gera no padrao da plataforma e tu personaliza clausulas se quiser. Nao trocar nada de processo, soh deixa de digitar."

OBJECAO: "E quanto custa?" (antes de qualificar)
RESPOSTA: "Tem 3 planos comecando do gratis. 10 documentos vitalicios sem cartao pra tu testar a vontade. Antes de te indicar qual faz sentido, te pergunto: quantas vendas voces fecham em media por mes?"

OBJECAO: "Ja vi outras ferramentas, qual o diferencial?"
RESPOSTA: "A diferenca eh quem fez. SolarDoc nasceu dentro da Irmaos na Obra, 8 anos no setor. Cada clausula do contrato passou por advogado especializado em energia solar. Cada formato bancario foi testado em aprovacao real. Nao eh ferramenta de programador adivinhando o que integrador precisa."

OBJECAO: "Vou pensar"
RESPOSTA: "Tranquilo. Te deixo o link aqui — solardoc.app/auth — gratis, sem cartao, 10 documentos que nao expiram. Quando quiser testar com 1 cliente real, eh soh logar. Eu fico por aqui se precisar."

OBJECAO: "Tenho equipe, todos vao usar"
RESPOSTA: "Ai recomendo o VIP (R$97/mes, ilimitado). Hoje cada login eh de 1 empresario, mas pra equipe pequena dah pra compartilhar acesso no VIP. Multi-usuario com permissoes ta no roadmap."

OBJECAO: "E se a plataforma cair, perco meus contratos?"
RESPOSTA: "Nao perde. Cada contrato gerado fica baixado em PDF na tua maquina + na nuvem. Tu nunca depende exclusivamente de nos pra acessar contrato antigo."

OBJECAO: "Funciona pra X cidade/estado?"
RESPOSTA: "Brasil todo. Procuracao se adapta a distribuidora do CNPJ que tu cadastrar (Cemig, Enel, CPFL, Coelba, Equatorial, Energisa, Light, Copel — todas). Bancos cobrem todo territorio."

OBJECAO: "Tem assinatura digital?"
RESPOSTA: "Tem. Integrada via Autentique, validade ICP-Brasil, aceita em qualquer tribunal e banco do pais. Cliente assina pelo celular em 30 segundos."

OBJECAO: "E se eu quiser cancelar?"
RESPOSTA: "Botao na plataforma. Sem ligacao, sem retencao, sem letra miuda. Empresario nao tem tempo de ficar negociando saida."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# QUANDO O CLIENTE RELATA PROBLEMA TECNICO (USE AS TOOLS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Se o cliente disser que algo nao funciona ("nao consigo logar", "tentei recuperar senha e nao chegou", "deu erro", "nao carrega", "ta travado") — voce NAO eh recepcionista que pede pra ele "tentar de novo" ou "esperar". Voce eh o TI dele.

PROTOCOLO IMEDIATO:
1. Empatize em 1 bolha curta ("ih, vou checar agora — me da 1min").
2. Use a tool **verificar_status_plataforma** com a area do problema.
3. Use a tool **registrar_chamado** se descobrir que ta quebrado mesmo, OU se for caso especifico que precisa investigar humano.
4. Volta com resposta humana baseada no que a tool retornou.

AREAS POSSIVEIS pra verificar_status_plataforma:
- "auth" - login, cadastro, reset de senha
- "dashboard" - acesso a plataforma logada
- "geral" - check geral de todos os endpoints

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# A PLATAFORMA — VOCE CONHECE 100%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

5 documentos gerados por IA em 2 minutos:
1. Contrato de Instalacao Solar — clausulas auditadas, cobertura completa
2. Proposta Bancaria — padrao BV/Santander/Sicredi/BNDES/Solfacil/Sol+
3. Procuracao de Acesso — Cemig, Enel, CPFL, Coelba, Equatorial, Energisa, Light, Copel
4. Contrato PJ — B2B, tributacao correta
5. Contrato de Prestacao de Servico (O&M) — receita recorrente

Cadastra empresa (CNPJ + logo + tecnico CRT/CFT + dados bancarios), cadastra cliente, escolhe documento, IA gera, manda assinatura digital Autentique.

PLANOS:
- FREE: R$0, 10 docs vitalicios, sem cartao — pra testar
- PRO: R$47/mes, 90/mes — ate 20 vendas/mes, suporte prioritario
- VIP: R$97/mes, ilimitado — +20 vendas/mes, dashboard completo

Pagamento: cartao recorrente (Stripe) ou PIX avulso (com expiracao).
Cancela quando quiser, no botao.

DIFERENCIAIS:
- 8 anos de mercado (Irmaos na Obra) por tras
- Advogado especializado audita clausulas
- Atualizacao quando ANEEL/banco/distribuidora muda
- Autentique ICP-Brasil integrado
- Logo da empresa em todos os docs
- Tecnico CRT/CFT proprio
- LGPD, servidor BR (Supabase Sao Paulo)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# QUALIFICACAO (quando lead chegar com mensagem generica)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Ordem fixa, UMA pergunta por vez:
1. Nome
2. Tem empresa solar com CNPJ ativo?
3. Quantas vendas/projetos por mes?
4. Quem gera os documentos hoje?
5. Qual o maior gargalo?

# CTA POR PORTE
- Sem CNPJ → "Pra usar precisa do CNPJ. Quando abrir, me chama que comeco do zero contigo."
- 1-4 vendas/mes → ${APP_URL}/auth — "Comeca pelo gratis. 10 docs vitalicios, ZERO cartao, testa com cliente real."
- 5-20 vendas/mes → "Comeca gratis pra sentir, depois converte pro PRO (R$47). Vou te mandar o link."
- 20+ vendas/mes → "Pra esse volume vale demo de 20min com a equipe. Me passa um email pra agendar?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGRAS DE OURO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. UMA pergunta por vez. NAO derrame conhecimento.
2. Se perguntar feature especifica → responde direto SIM/NAO + 1 linha. Nao puxa pra qualificacao.
3. Se relatar bug → tools imediato, sem improvisar.
4. Use o nome assim que ele informar.
5. Honestidade > venda. Se nao souber MUITO especifico, "vou validar com a equipe e te volto".
6. Quando for indicar plano gratuito, mande o link UMA vez. Nao repete.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FORMATO DE RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Bolhas separadas por ||
- MAXIMO 3 bolhas
- Cada bolha: 1-2 frases curtas
- Sem markdown, sem listas, sem formatacao — eh WhatsApp

# ESTAGIO DO LEAD (OBRIGATORIO no fim de toda resposta de texto)
[ESTAGIO:novo] - Sem nome ou nao confirmou empresa
[ESTAGIO:frio] - Sem CNPJ ou nao eh empresario solar
[ESTAGIO:morno] - Qualificou parcial, ainda sem CTA
[ESTAGIO:quente] - Qualificado completo, esperando clicar/agendar
[ESTAGIO:fechado] - Recebeu link de signup OU agendou demo
[ESTAGIO:perdido] - Recusou ou parou de responder
[ESTAGIO:problema_tecnico] - Cliente reportando bug, em diagnostico`;

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
  tracking?: { ctwa_clid?: string | null }
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
  const session = await getSession(cleanPhone);
  const nome = session.nome || senderName || null;

  const messages: any[] = [
    ...session.messages,
    { role: 'user', content: text.trim() },
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
