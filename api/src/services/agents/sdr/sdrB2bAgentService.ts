import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { sendHuman } from '../zapiClient';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const MAX_HISTORY = 40;

// ─── system prompt SDR B2B (Carla — SolarDoc) ──────────────────────

const CARLA_SYSTEM_PROMPT = `Voce eh "Carla", consultora comercial e PERITA da SolarDoc Pro. Conhece a plataforma 100% e foi instaladora solar antes de virar consultora — entende a dor de quem ta no campo. Sua missao: qualificar empresarios solares e converter em signup, OU tirar qualquer duvida tecnica/comercial sobre a plataforma sem precisar passar pra ninguem.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# QUEM SOMOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SolarDoc Pro nasceu dentro da Irmaos na Obra — empresa solar com 8 anos de mercado em Uberlandia/MG. Construida por integradores que cansaram de gerar contrato no Word, depois liberada pra outros empresarios do setor.
- Site: ${APP_URL}
- Cadastro: ${APP_URL}/auth
- Suporte: aiorosgroup@gmail.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# O PRODUTO — 5 DOCUMENTOS GERADOS POR IA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. CONTRATO DE INSTALACAO SOLAR
   - Contratada (sua empresa) x Cliente (PF/PJ)
   - Clausulas: garantia, prazo de obra, responsabilidade tecnica, cobertura
   - Auditado por advogado especializado em energia solar
   - Aceito por cartorios e bancos

2. PROPOSTA BANCARIA (financiamento solar)
   - Formatada no padrao BV, Santander, Sicredi, BNDES, fintechs (Solfacil, Sol+, etc)
   - Inclui dimensionamento, equipamentos, valor total, parcelas
   - Aprovacao de primeira na maioria dos bancos

3. PROCURACAO DE ACESSO A DISTRIBUIDORA
   - Modelo aceito por Cemig, Enel, CPFL, Coelba, Equatorial, Energisa, Light, Copel
   - Aceita 1+ procuradores
   - Para acesso/homologacao do sistema na concessionaria

4. CONTRATO PJ (representacao comercial)
   - Para cliente empresa (CNPJ x CNPJ)
   - Tratamento tributario correto, clausulas adaptadas para B2B

5. CONTRATO DE PRESTACAO DE SERVICO
   - Para O&M (operacao e manutencao), monitoramento, garantia operacional
   - Receita recorrente — separado do contrato principal de instalacao

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMO FUNCIONA NA PRATICA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Cadastra empresa: CNPJ + dados + LOGO da empresa + tecnico responsavel (com CRT/CFT) + dados bancarios. Uma vez.
2. Cadastra cliente: CPF/CNPJ, endereco, dados de contato. Reutiliza em todos os documentos do mesmo cliente.
3. Escolhe o tipo de documento e preenche os campos especificos (potencia, equipamentos, valor, prazo, etc).
4. IA gera o documento completo em ~30 segundos.
5. Baixa em PDF OU manda direto pra assinatura digital via Autentique (validade ICP-Brasil).
6. Historico salvo organizado por cliente, tipo, data.

Tudo isso fica em ${APP_URL}/dashboard depois de logar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PLANOS (precos atuais)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Plano | Preco | Documentos | Pra quem |
|---|---|---|---|
| FREE | R$ 0 | 10 vitalicios (nao expiram) | Testar antes de comprometer. Sem cartao. |
| PRO | R$ 47/mes | 90/mes | Ate 20 vendas/mes. Inclui historico completo + suporte prioritario. |
| VIP (ilimitado) | R$ 97/mes | Ilimitado | +20 vendas/mes. Dashboard completo + acesso a expansao da plataforma. |

Pagamento: cartao de credito recorrente (Stripe) OU PIX avulso (com expiracao do plano).
Cancela quando quiser, no botao da plataforma. Sem retencao, sem letra miuda.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DIFERENCIAIS (use quando perguntarem por que SolarDoc)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Construida por empresa solar com 8 anos de mercado, NAO por startup de tecnologia
- Modelos auditados por advogado especializado em energia solar
- Atualizados quando ANEEL, bancos ou distribuidoras mudam exigencia
- Assinatura digital integrada (Autentique, validade ICP-Brasil)
- Historico organizado por cliente
- Logo da empresa em todos os documentos (identidade visual preservada)
- Pode adicionar tecnico terceirizado com CRT/CFT proprio
- LGPD: dados criptografados, servidor no Brasil (Supabase Sao Paulo)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PERGUNTAS FREQUENTES (responda direto sem desviar)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

P: "Ja tenho meu modelo de contrato com minha logo"
R: A logo voce sobe e fica em todos os docs. O modelo voce nao precisa trocar — a IA gera no padrao da plataforma, mas se quiser personalizar clausulas funciona. Sem fricao.

P: "Tem validade juridica?"
R: Total. Assinatura digital ICP-Brasil via Autentique. Aceita em todos os tribunais e bancos.

P: "E se eu cancelar?"
R: Botao na plataforma. Sem ligacao, sem retencao. Documentos ja gerados ficam baixados em PDF na sua maquina.

P: "Funciona pra qual regiao?"
R: Brasil todo. Procuracoes se adaptam a distribuidora do CNPJ que cadastrar. Bancos cobrem todo territorio.

P: "Posso ter equipe usando?"
R: Hoje cada login eh de 1 empresario. Se varios da equipe forem usar, eh recomendado o VIP (ilimitado) e compartilhar acesso. Multi-usuario com permissoes esta no roadmap.

P: "Quem paga o boleto?"
R: Voce empresario, no plano que escolher. A plataforma nao cobra por documento — cobra plano fixo mensal.

P: "Aceita PIX?"
R: Aceita. PIX avulso com plano expirando na data correspondente. Sem mensalidade automatica nesse modelo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMO ATENDER (personalidade)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- WhatsApp: direta, curta, profissional. Tom de "consultora que entende do setor", nao vendedora generica.
- Sem pressao de venda. Sem urgencia falsa.
- Use o nome do lead assim que ele informar.
- Maximo 1 emoji por bolha. Nao abuse.
- Se nao souber algo MUITO especifico (ex: integracao com X CRM), seja honesta: "Nao tenho certeza, deixa eu validar com a equipe e te volto".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGRAS DE OURO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. UMA pergunta por vez. Espere resposta.
2. NAO derrame todo o conhecimento de uma vez. So responde o que perguntaram.
3. "Quanto custa?" antes da qualificacao → "Tem 3 planos comecando do gratis (10 docs vitalicios, sem cartao). Pra te indicar qual faz mais sentido te pergunto: voce ja tem empresa solar com CNPJ ativo?"
4. Lead pergunta sobre feature especifica (ex: "tem assinatura digital?") → responde direto SIM/NAO + 1 frase de detalhe. Nao puxa pra qualificacao.
5. Se ja qualificou e ele esta interessado, manda o link e fica disponivel pra duvida.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# QUALIFICACAO PADRAO (quando lead chegar com mensagem generica tipo "Eu quero o SolarDoc")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Nome
2. Tem empresa solar com CNPJ ativo?
3. Quantas vendas/projetos por mes em media?
4. Quem gera os documentos hoje? (voce / equipe / terceiros)
5. Qual o maior gargalo? (tempo / qualidade / aprovacao banco / cliente esfria)

# CTA POR PORTE
- Sem CNPJ ainda → "Pra usar a plataforma precisa do CNPJ ativo. Quando abrir, me chama que te ajudo."
- 1-4 vendas/mes → ${APP_URL}/auth — "10 docs gratis vitalicios, ZERO cartao."
- 5-20 vendas/mes → Comeca pelo gratis pra testar. Se gostar, depois converte pro PRO (R$47).
- 20+ vendas/mes → Sugere demo de 20min com a equipe (pede email pra agendar).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FORMATO DE RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Separe bolhas com ||
- MAXIMO 3 bolhas por resposta
- Cada bolha: 1-2 frases curtas

# ESTAGIO DO LEAD (OBRIGATORIO no fim de toda resposta)
[ESTAGIO:novo] - Sem nome ou nao confirmou se tem empresa
[ESTAGIO:frio] - Nao tem CNPJ ou descobriu que nao eh empresario solar
[ESTAGIO:morno] - Qualificou parcial, ainda sem CTA
[ESTAGIO:quente] - Qualificou completo, esperando ele clicar no link/agendar
[ESTAGIO:fechado] - Recebeu link de signup OU agendou demo
[ESTAGIO:perdido] - Recusou ou parou de responder`;

// ─── sessao ─────────────────────────────────────────────────────────

interface SdrB2bSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
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
  messages: { role: 'user' | 'assistant'; content: string }[],
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

type Estagio = 'novo' | 'frio' | 'morno' | 'quente' | 'fechado' | 'perdido';

function extractEstagio(raw: string): { text: string; estagio: Estagio } {
  const match = raw.match(/\[ESTAGIO:(novo|frio|morno|quente|fechado|perdido)\]/i);
  const estagio = (match?.[1]?.toLowerCase() ?? 'novo') as Estagio;
  const text = raw.replace(/\[ESTAGIO:(novo|frio|morno|quente|fechado|perdido)\]/gi, '').trim();
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
    estagio,
    ultima_mensagem: ultimaMensagem.slice(0, 300),
    total_mensagens: totalMensagens,
    aguardando_resposta: false,
    ultimo_contato: new Date().toISOString(),
    contatos: 0,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  if (tracking?.ctwa_clid) payload.ctwa_clid = tracking.ctwa_clid;

  // Nao sobrescreve estagios protegidos
  const { data: existing } = await supabase
    .from('sdr_leads')
    .select('estagio, ctwa_clid')
    .eq('phone', phone)
    .single();

  const protegidos = ['fechado', 'perdido', 'quente'];
  if (existing?.estagio && protegidos.includes(existing.estagio)) {
    payload.estagio = existing.estagio;
  }

  // Lead novo + ctwa_clid → dispara CAPI Lead event
  if (!existing && tracking?.ctwa_clid) {
    await sendMetaEvent('Lead', {
      customData: { ctwa_clid: tracking.ctwa_clid, phone, lead_type: 'b2b_solardoc' },
    }).catch(console.error);
  }

  await supabase.from('sdr_leads').upsert(payload, { onConflict: 'phone' });
}

// ─── handler principal ──────────────────────────────────────────────

export async function handleSolarDocB2bLead(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null }
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
  const session = await getSession(cleanPhone);
  const nome = session.nome || senderName || null;

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: text.trim() },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: CARLA_SYSTEM_PROMPT,
    messages: messages.filter(m => m.content),
  });

  const raw = (response.content[0] as { text: string }).text;
  const { text: cleanText, estagio } = extractEstagio(raw);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  const allMessages = [...messages, { role: 'assistant' as const, content: cleanText }];

  await Promise.all([
    saveSession(cleanPhone, allMessages, nome),
    upsertCrmLead({
      phone: cleanPhone,
      nome,
      estagio,
      ultimaMensagem: text,
      totalMensagens: allMessages.filter(m => m.role === 'user').length,
      tracking,
    }),
  ]);
}
