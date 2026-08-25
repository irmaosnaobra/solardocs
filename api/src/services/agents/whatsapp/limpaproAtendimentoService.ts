// ─────────────────────────────────────────────────────────────────────────────
// TRILHA DE ATENDIMENTO 1x1 DO LIMPAPRO — quem já comprou e escreve na linha IO.
//
// O buraco que isto fecha: na linha IO só a Bia responde, e só quem ELA abordou (sessão
// tipo='recuperacao'). Todo o resto cai no `handleSdrLead`, que tem `if (instance ===
// 'io') return` — ou seja, SILÊNCIO. Foi assim que um aluno pagante escreveu "comprei
// esse curso mas não estou conseguindo abrir os vídeos" (03/ago 22h07) e ninguém
// respondeu. Nenhum CRM cobre o caso: `depositarOuAvisar` só conhece solar e
// eletroposto, e LimpaPro vira um aviso solto no WhatsApp do dono.
//
// A trilha tem 4 ramos, nesta ordem de valor:
//   1. ACESSO — não entra no app, esqueceu a senha, tela branca. Resolve DE VERDADE:
//      a tag [REENVIAR_ACESSO] chama o /api/membro-login do app, que manda o link
//      mágico POR E-MAIL (WhatsApp saiu da entrega de acesso em 04/ago, de propósito).
//   2. CONTEÚDO — dúvida do curso, o que é o produto, quando abre o módulo 5.
//   3. MENTORIA — quem já está rodando e quer ajuda 1x1 → escada 297/497/997.
//   4. HUMANO — reembolso, cobrança, reclamação séria, ou assunto de energia solar
//      (não é a praia dela) → [ESCALAR]: cala, marca takeover e avisa o dono.
//
// ROTEAMENTO SEGURO (a razão de isto não poder roubar conversa dos outros): só fala
// com quem está em `limpapro_membros` casando por TELEFONE. São 112 cadastros, todos
// com telefone, e ZERO deles aparece em `sdr_leads` — medido no banco. Cliente de
// energia nunca casa; lead de recuperação é da Bia, que vem antes na fila.
//
// TRANSACIONAL: a pessoa escreveu primeiro. Por isso NÃO passa pela janela diurna nem
// pelo teto de 12/h da linha (responder às 22h é normal, e gastar a cota da Bia com
// resposta de suporte tiraria envio de venda). Se um dia nascer um toque PROATIVO
// nesta trilha, aí sim ele entra em BOT_SENT_PREFIXES do lineThrottle.
//
// Desligado por padrão: LIMPAPRO_ATENDIMENTO_ENABLED=true liga (mesmo padrão da Bia).
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendHuman, sendWhatsApp, fmtPhone } from '../zapiClient';
import { porBarras } from '../bolhas';
import { tryClaimMessage } from '../sdr/sdrAgentService';
import { phoneVariants, ehLeadRecuperacao } from './biaInboundService';
import { carregarCerebro } from '../../io/cerebroAgentes';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const INSTANCE = 'io' as const;
const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 30;
const APP_URL = (process.env.LIMPAPRO_APP_URL || 'https://limpapro.solardoc.app').replace(/\/+$/, '');
const NOTIFY = (process.env.IO_INDICACOES_NOTIFY || '34991360223').trim();

// Módulo 5 e bônus abrem 7 dias depois da compra (regra do app — mesma do prompt da Bia).
const JANELA_LIBERACAO_DIAS = 7;

export function atendimentoLimpaproHabilitado(): boolean {
  return process.env.LIMPAPRO_ATENDIMENTO_ENABLED === 'true'
    && Boolean(process.env.ZAPI_INSTANCE_ID_IO?.trim());
}

// ─── quem é essa pessoa ──────────────────────────────────────────────
export interface AlunoLimpapro {
  email: string;
  nome: string | null;
  telefone: string;
  ativo: boolean;
  criado_em: string | null;
  ultimo_acesso_em: string | null;
  temSenha: boolean;
  itens: string[];              // entitlements ativos (premium, comunidade, usina...)
}

/**
 * Formatos de telefone pra procurar no cadastro. `phoneVariants` cobre as variantes BR
 * (com/sem 9, com/sem 55), mas devolve só dígitos — e o `.in()` do Postgres é comparação
 * EXATA de texto. O cadastro vem da Kiwify, não da Z-API: medido no banco, 110 dos 112
 * estão em dígitos puros e 2 estão como `+5551997518181`. Sem a forma com `+`, esses
 * dois alunos seriam invisíveis pra trilha — respondiam e não eram reconhecidos.
 */
export function variantesDeCadastro(rawPhone: string): string[] {
  const base = phoneVariants(rawPhone);
  return Array.from(new Set([...base, ...base.map(v => `+${v}`)]));
}

/**
 * Este telefone é de um ALUNO do LimpaPro? Casa por variantes BR do número (com/sem 9,
 * com/sem 55, com/sem +) — o inbound chega num formato e o cadastro pode estar noutro.
 * Retorna null quando não é (aí a mensagem segue o fluxo de sempre).
 */
export async function ehAlunoLimpapro(rawPhone: string): Promise<AlunoLimpapro | null> {
  if (!atendimentoLimpaproHabilitado()) return null;

  const { data } = await supabase
    .from('limpapro_membros')
    .select('email, nome, telefone, ativo, criado_em, ultimo_acesso_em, senha_hash')
    .in('telefone', variantesDeCadastro(rawPhone))
    .limit(1)
    .maybeSingle();
  if (!data || data.ativo === false) return null;

  const { data: ents } = await supabase
    .from('limpapro_entitlements')
    .select('item')
    .eq('email', data.email)
    .eq('ativo', true);

  return {
    email: String(data.email),
    nome: (data.nome as string) ?? null,
    telefone: String(data.telefone ?? rawPhone),
    ativo: data.ativo !== false,
    criado_em: (data.criado_em as string) ?? null,
    ultimo_acesso_em: (data.ultimo_acesso_em as string) ?? null,
    temSenha: Boolean(data.senha_hash),
    itens: (ents ?? []).map(e => String(e.item)),
  };
}

// ─── sessão (histórico + takeover) ───────────────────────────────────
interface AtendimentoLeadData {
  email?: string;
  human_takeover?: boolean;
  acesso_reenviado_em?: string;      // rate-limit do reenvio de link
  escalado_em?: string;
  aviso_outro_assunto_em?: string;   // rate-limit do recado "isso é de outra área"
}

// Recado de assunto fora da área: no máximo 1 a cada 6h por pessoa.
const AVISO_OUTRO_ASSUNTO_COOLDOWN_MS = 6 * 60 * 60 * 1000;
interface AtendimentoSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome: string | null;
  lead_data: AtendimentoLeadData;
}

async function loadSession(rawPhone: string): Promise<AtendimentoSession & { phoneCanonico: string }> {
  const { data } = await supabase.from('whatsapp_sessions')
    .select('phone, messages, nome, lead_data')
    .in('phone', phoneVariants(rawPhone)).eq('tipo', 'limpapro')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return {
    phoneCanonico: (data?.phone as string) ?? fmtPhone(rawPhone),
    messages: (data?.messages as AtendimentoSession['messages']) || [],
    nome: data?.nome ?? null,
    lead_data: (data?.lead_data as AtendimentoLeadData) ?? {},
  };
}

async function saveSession(phone: string, msgs: AtendimentoSession['messages'], nome: string | null, ld: AtendimentoLeadData): Promise<void> {
  await supabase.from('whatsapp_sessions').upsert({
    phone, tipo: 'limpapro', nome, messages: msgs.slice(-MAX_HISTORY * 2), lead_data: ld,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });
}

/** Humano digitou do celular da linha → a agente cala nesta conversa. */
export async function marcarTakeoverLimpapro(rawPhone: string): Promise<void> {
  const s = await loadSession(rawPhone);
  await saveSession(s.phoneCanonico, s.messages, s.nome, { ...s.lead_data, human_takeover: true });
  logger.info('limpapro-atendimento', `human takeover ${s.phoneCanonico} — agente silenciada`);
}

// Opt-out duro: mesma régua da Bia. Suporte não insiste com quem mandou parar.
const OPT_OUT = /\b(parar de mandar|para de mandar|chega de mensagem|n[ãa]o (me )?manda mais|n[ãa]o quero mais|me descadastr\w*|descadastr\w*|sair da lista|stop)\b/i;

// ─── reenvio de acesso: a única ação com efeito no mundo ─────────────
// O app manda o link mágico POR E-MAIL (membro-login.js). A agente NÃO manda link de
// acesso no WhatsApp — decisão de 04/ago, o acesso sai só por e-mail. 1 reenvio a cada
// 10 min por pessoa, senão a conversa vira máquina de gerar token.
const REENVIO_COOLDOWN_MS = 10 * 60 * 1000;

export async function reenviarAcessoPorEmail(email: string): Promise<boolean> {
  try {
    const r = await fetch(`${APP_URL}/api/membro-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) { logger.error('limpapro-atendimento', `membro-login devolveu ${r.status} pra ${email}`); return false; }
    logger.info('limpapro-atendimento', `link de acesso reenviado por e-mail pra ${email}`);
    return true;
  } catch (err) {
    logger.error('limpapro-atendimento', `reenvio de acesso falhou pra ${email}`, err);
    return false;
  }
}

async function avisarDono(aluno: AlunoLimpapro, phone: string, texto: string): Promise<void> {
  const nome = aluno.nome?.trim() || 'aluno sem nome';
  const msg = `ATENDIMENTO LIMPAPRO — precisa de você\n\n`
    + `${nome} (${aluno.email})\nwa.me/${phone.replace(/\D/g, '')}\n\n`
    + `Última mensagem: "${texto.slice(0, 240)}"\n\n`
    + `A agente parou de responder esta conversa.`;
  await sendWhatsApp(NOTIFY, msg, INSTANCE)
    .catch(err => logger.error('limpapro-atendimento', 'aviso ao dono falhou', err));
}

// ─── prompt ──────────────────────────────────────────────────────────
// Exportado pra teste: o valor deste arquivo está no que a agente NÃO pode dizer.
export function buildAtendimentoSystemPrompt(ctx: {
  nome?: string | null;
  email: string;
  itens: string[];
  diasDesdeCompra: number | null;
  jaAcessou: boolean;
  temSenha: boolean;
  persona?: string | null;
}): string {
  const nome = ctx.nome ? ctx.nome.trim().split(/\s+/)[0] : null;
  const liberado = ctx.diasDesdeCompra != null && ctx.diasDesdeCompra >= JANELA_LIBERACAO_DIAS;
  const faltam = ctx.diasDesdeCompra != null ? Math.max(0, JANELA_LIBERACAO_DIAS - ctx.diasDesdeCompra) : null;
  const extras = ctx.itens.filter(i => i !== 'curso-principal');

  const persona = (ctx.persona && ctx.persona.trim()) || `Você é a "Bia", do suporte do LimpaPro Solar no WhatsApp. Quem está falando com você
JÁ COMPROU — é aluno, não é lead. Seu trabalho é resolver o problema dele rápido e sem
enrolação, com jeito de gente que conhece o produto por dentro. Acolhedora, direta e
resolutiva: primeiro resolve, depois conversa.`;

  return `${persona}

━━ QUEM É ESTA PESSOA (dado do banco — confie, não pergunte de novo) ━━
${nome ? `- Nome: ${nome}` : '- Nome: desconhecido (não invente)'}
- E-mail da conta: ${ctx.email}
- Já comprou o curso principal. ${extras.length ? `Também tem liberado: ${extras.join(', ')}.` : 'Não tem extras liberados.'}
${ctx.diasDesdeCompra != null ? `- Comprou há ${ctx.diasDesdeCompra} dia(s).` : '- Data da compra: desconhecida.'}
${liberado
    ? '- O módulo 5 e os bônus JÁ estão abertos pra ele.'
    : faltam != null
      ? `- O módulo 5 e os bônus abrem ${faltam === 0 ? 'hoje' : `em ${faltam} dia(s)`} (abrem 7 dias depois da compra). Se ele reclamar de cadeado, é ISSO — explique com naturalidade, não é erro.`
      : '- Não sei se o módulo 5 já abriu; não afirme nem uma coisa nem outra.'}
- ${ctx.jaAcessou ? 'Já entrou no app pelo menos uma vez.' : 'NUNCA entrou no app ainda.'}
- ${ctx.temSenha ? 'Já criou senha.' : 'Ainda não criou senha (o primeiro acesso é ele quem escolhe a senha).'}

━━ O PRODUTO (formato REAL — aqui já se errou antes) ━━
- É um APP (${APP_URL}/membros): entra com E-MAIL e SENHA, pelo celular ou computador,
  sem instalar nada e sem prazo pra terminar.
- NÃO É VIDEOAULA. Não tem vídeo, nem aula gravada, nem live. É o passo a passo ESCRITO,
  em aulas curtas (6 a 11 min de leitura), e o app marca o que já foi concluído.
  NUNCA prometa vídeo — se ele diz "não abro os vídeos", explique com cuidado que o curso
  é escrito no app, e ajude ele a entrar.
- 5 módulos: 1) Técnica de Limpeza · 2) Segurança em Altura · 3) Precificação ·
  4) Captação de Clientes · 5) Renda Recorrente.

━━ RAMO 1 — NÃO CONSEGUE ENTRAR (resolva primeiro, sempre) ━━
- Primeiro acesso: é em ${APP_URL}/membros, com o e-mail da compra (${ctx.email}).
  Na primeira vez ELE cria a senha — não existe senha vinda por e-mail.
- Esqueceu a senha / não lembra o e-mail / não recebeu nada: termine a resposta com a tag
  literal [REENVIAR_ACESSO]. O sistema dispara na hora um LINK DE ENTRADA pro e-mail dele.
  Avise que o link vai pro E-MAIL (${ctx.email}) e peça pra olhar também o spam/promoções.
  NUNCA prometa mandar o link aqui no WhatsApp — o acesso sai só por e-mail.
- Tela branca / página não carrega / fica carregando / erro ao abrir: mande ele abrir
  ${APP_URL.replace('limpapro.', '')}/limpar-cache — limpa o cache e resolve a maioria.
  (Se não souber a URL de cabeça, diga "solardoc.app/limpar-cache".)
- iPhone que não instala o app: tem que ser pelo Safari, não pelo Chrome.

━━ RAMO 2 — DÚVIDA DE CONTEÚDO ━━
- Responda pelo que está aqui em cima. Se perguntarem algo que você NÃO sabe de fato
  (preço de equipamento específico, promessa de resultado, prazo), NÃO invente: diga que
  confirma com o time e siga.

━━ RAMO 3 — QUER AJUDA 1x1 (só ofereça se ELE puxar) ━━
Se ele disser que quer acompanhamento, ajuda direta, "me ajuda a começar", "cobra quanto
pra me orientar", ou está travado pra pegar o primeiro cliente, aí você PODE apresentar:
- 30 Minutos Comigo — R$ 297 · ${APP_URL}/mentoria-297
- Até o Primeiro Cliente (4 sessões em 60 dias) — R$ 497 · ${APP_URL}/mentoria-497
- Acompanhamento de 30 dias — R$ 997 · ${APP_URL}/mentoria
Regras: no máximo UM degrau por conversa (o que couber no que ele contou), com o link
exato acima. NUNCA invente outro preço, desconto, parcelamento ou bônus. Não empurre
mentoria pra quem só quer resolver acesso — primeiro resolve, e só oferece se ele puxar.

━━ RAMO 4 — PASSAR PRO HUMANO (tag [ESCALAR]) ━━
Responda UMA vez acolhendo, diga que vai passar pro time, e termine com [ESCALAR] quando for:
- reembolso, cobrança duplicada, problema de pagamento, cartão, nota fiscal
- reclamação séria, ameaça de Procon, pedido de cancelamento
- qualquer coisa que você tentou resolver e não resolveu
Depois de [ESCALAR] você fica em silêncio nessa conversa — use quando o time PRECISA assumir.

━━ RAMO 4b — NÃO É SUA ÁREA (tag [NAO_E_COMIGO]) ━━
Se ele falar de ENERGIA SOLAR (orçamento de instalação, placa, eletroposto, serviço de
limpeza pra ele contratar), diga com simpatia que quem cuida disso é o time e que já
avisou — e termine com [NAO_E_COMIGO]. O time recebe o recado.
DIFERENÇA IMPORTANTE: aqui você NÃO some. Continua disponível pro que é seu (acesso,
curso, mentoria) — se ele voltar a falar do curso depois, atenda normalmente.

━━ REGRAS DURAS — NUNCA ━━
- NUNCA invente preço, link, prazo, política ou promessa de resultado.
- NUNCA mande link de acesso/senha por aqui — acesso é por e-mail, via [REENVIAR_ACESSO].
- NUNCA diga que o curso tem vídeo.
- NUNCA venda o curso pra quem já comprou (ele já é aluno).

━━ COMO ESCREVER ━━
- WhatsApp: curto e humano, no máximo 3 bolhas separadas por ||. 1-2 frases por bolha.
  No máximo 1 emoji. UMA resposta por mensagem dele. Nome só se souber.
- Primeiro a solução, depois o resto. Nada de parede de texto.`;
}

// ─── handler principal ───────────────────────────────────────────────
export async function handleLimpaproAtendimento(
  rawPhone: string,
  text: string,
  senderName?: string | null,
  alunoJaCarregado?: AlunoLimpapro | null,
): Promise<void> {
  if (!atendimentoLimpaproHabilitado()) return;
  const clean = (text || '').trim();
  if (!clean) return;

  // ── GUARDA DE PORTA: conversa do SolarDoc é da vendedora do SolarDoc ──
  // Mesma guarda da Bia, mesmo motivo: o aluno do LimpaPro que clicar no anúncio do
  // SolarDoc receberia DOIS atendimentos na mesma linha, um dizendo que o produto do
  // anúncio não é com ele. Cede no gatilho e enquanto a vendedora for dona (sdr_b2b).
  {
    const { ehGatilhoSolarDoc, vendedoraJaAtende } = await import('./whatsappAgentService');
    if (ehGatilhoSolarDoc(clean) || await vendedoraJaAtende(rawPhone)) return;
  }

  const aluno = alunoJaCarregado ?? await ehAlunoLimpapro(rawPhone);
  if (!aluno) return;

  const session = await loadSession(rawPhone);
  const phone = session.phoneCanonico;
  const nome = session.nome ?? aluno.nome ?? senderName ?? null;

  // Humano assumiu → só registra e cala.
  if (session.lead_data.human_takeover === true) {
    await saveSession(phone, [...session.messages, { role: 'user', content: clean }], nome, session.lead_data);
    return;
  }
  if (OPT_OUT.test(clean)) {
    await sendHuman(rawPhone, ['Sem problema, parei por aqui.', 'Seu acesso ao curso continua normal — qualquer coisa é só chamar.'], INSTANCE);
    await saveSession(phone, [...session.messages, { role: 'user', content: clean }], nome,
      { ...session.lead_data, human_takeover: true });
    logger.info('limpapro-atendimento', `opt-out → silêncio ${phone}`);
    return;
  }

  const diasDesdeCompra = aluno.criado_em
    ? Math.floor((Date.now() - new Date(aluno.criado_em).getTime()) / 86_400_000)
    : null;

  const messages = [...session.messages, { role: 'user' as const, content: clean }];
  let raw: string;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 400,
      system: buildAtendimentoSystemPrompt({
        nome, email: aluno.email, itens: aluno.itens, diasDesdeCompra,
        jaAcessou: Boolean(aluno.ultimo_acesso_em), temSenha: aluno.temSenha,
        persona: await carregarCerebro('atendimento_limpapro'),
      }),
      messages,
    });
    const block = resp.content.find(b => b.type === 'text') as { text: string } | undefined;
    raw = block?.text ?? '';
  } catch (err) {
    logger.error('limpapro-atendimento', `claude falhou ${phone}`, err);
    return;
  }
  if (!raw.trim()) return;

  const escalar = /\[ESCALAR\]/i.test(raw);
  const pediuReenvio = /\[REENVIAR_ACESSO\]/i.test(raw);
  const outroAssunto = /\[NAO_E_COMIGO\]/i.test(raw);
  const parts = porBarras(
    raw.replace(/\[ESCALAR\]/ig, '').replace(/\[REENVIAR_ACESSO\]/ig, '').replace(/\[NAO_E_COMIGO\]/ig, ''),
  ).slice(0, 3);
  if (parts.length) await sendHuman(phone, parts, INSTANCE);

  const novoLeadData: AtendimentoLeadData = { ...session.lead_data, email: aluno.email };

  // Reenvio de acesso: dispara DEPOIS de responder (a pessoa já leu que o link vem por
  // e-mail) e com cooldown — senão cada "não recebi" vira um token novo.
  if (pediuReenvio) {
    const ultimo = novoLeadData.acesso_reenviado_em ? new Date(novoLeadData.acesso_reenviado_em).getTime() : 0;
    if (Date.now() - ultimo > REENVIO_COOLDOWN_MS) {
      const ok = await reenviarAcessoPorEmail(aluno.email);
      if (ok) novoLeadData.acesso_reenviado_em = new Date().toISOString();
      else {
        // Não conseguiu resolver de verdade → não deixa o aluno esperando um e-mail que
        // não vem: cala e chama o humano.
        novoLeadData.human_takeover = true;
        novoLeadData.escalado_em = new Date().toISOString();
        await avisarDono(aluno, phone, `${clean}  [reenvio de acesso FALHOU]`);
      }
    } else {
      logger.info('limpapro-atendimento', `reenvio ignorado (cooldown) ${phone}`);
    }
  }

  if (escalar) {
    novoLeadData.human_takeover = true;
    novoLeadData.escalado_em = new Date().toISOString();
    await avisarDono(aluno, phone, clean);
  } else if (outroAssunto) {
    // Assunto de outra área (energia solar): o time recebe o recado, mas a trilha NÃO
    // morre. Silenciar de vez aqui significaria que o aluno que perguntou de placa hoje
    // não consegue destravar a senha semana que vem. Cooldown pra não virar sino.
    const ultimo = novoLeadData.aviso_outro_assunto_em ? new Date(novoLeadData.aviso_outro_assunto_em).getTime() : 0;
    if (Date.now() - ultimo > AVISO_OUTRO_ASSUNTO_COOLDOWN_MS) {
      novoLeadData.aviso_outro_assunto_em = new Date().toISOString();
      await avisarDono(aluno, phone, `${clean}  [assunto de outra área — a agente segue atendendo o curso]`);
    }
  }

  await saveSession(phone, [...messages, { role: 'assistant', content: raw }], nome, novoLeadData);

  // Marcador de auditoria. NÃO entra no BOT_SENT_PREFIXES do lineThrottle de propósito:
  // isto é resposta a quem escreveu primeiro, não envio frio — não pode comer a cota da Bia.
  await supabase.from('system_state').upsert(
    { key: `limpapro_atendimento:${phone}`, value: { em: new Date().toISOString(), escalado: escalar }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  ).then(() => {}, () => {});

  if (escalar) logger.info('limpapro-atendimento', `escalado pra humano: ${phone} (${aluno.email})`);
}

// ─── poll (via REAL da linha IO) ─────────────────────────────────────
// Mesma via da Bia: o webhook da linha nem sempre entrega o texto, então o inbound é
// lido de `webhook_debug`. Roteamento: pula quem é lead de recuperação (é da Bia) e
// quem não está em `limpapro_membros`.
const INSTANCE_ID_IO = '3F26F6ECE67D72BB7FCA6244BF24326C';

export async function pollLimpaproAtendimento(): Promise<{ processed: number; skipped: number; errors: number }> {
  if (!atendimentoLimpaproHabilitado()) return { processed: 0, skipped: 0, errors: 0 };

  const desde = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('webhook_debug')
    .select('payload, created_at')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) { logger.error('limpapro-poll', 'ler webhook_debug falhou', error); return { processed: 0, skipped: 0, errors: 1 }; }

  let processed = 0, skipped = 0, errors = 0;
  for (const r of rows ?? []) {
    const p = (r.payload ?? {}) as Record<string, any>;
    if (p.type !== 'ReceivedCallback' || p.instanceId !== INSTANCE_ID_IO) { skipped++; continue; }
    if (p.isGroup === true || p.isGroup === 'true') { skipped++; continue; }

    const phone = String(p.phone || p.senderPhone || '').replace(/\D/g, '');
    if (!phone) { skipped++; continue; }

    // A Bia tem preferência: quem ela abordou é dela, do começo ao fim.
    if (await ehLeadRecuperacao(phone)) { skipped++; continue; }

    const aluno = await ehAlunoLimpapro(phone);
    if (!aluno) { skipped++; continue; }

    const fromMe = p.fromMe === true || p.fromMe === 'true';
    const fromApi = p.fromApi === true || p.fromApi === 'true';

    if (fromMe) {
      if (!fromApi) {
        try { await marcarTakeoverLimpapro(phone); processed++; } catch (err) { errors++; logger.error('limpapro-poll', `takeover ${phone}`, err); }
      } else skipped++;
      continue;
    }

    const texto = p.text?.message ?? (typeof p.text === 'string' ? p.text : '') ?? p.message ?? p.body ?? '';
    if (!String(texto).trim()) { skipped++; continue; }

    const messageId = p.messageId || p.zaapId || p.id || null;
    if (messageId) {
      const claimed = await tryClaimMessage(`limpa:${messageId}`, phone, 'poll');
      if (!claimed) { skipped++; continue; }
    }

    try {
      await handleLimpaproAtendimento(phone, String(texto), p.senderName || p.pushname || null, aluno);
      processed++;
    } catch (err) {
      logger.error('limpapro-poll', `handleLimpaproAtendimento ${phone} falhou`, err);
      errors++;
    }
  }
  return { processed, skipped, errors };
}
