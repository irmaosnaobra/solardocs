import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { sendHuman, ZapiInstance } from '../zapiClient';
import { porBarras } from '../bolhas';
import {
  ATENDENTE_PROMPT_KEY, PROMPT_PADRAO, numerosVivos, resolverPlaceholders,
} from '../whatsapp/atendenteAnuncioPrompt';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const API_URL = process.env.API_URL || 'https://api.solardoc.app';
const MAX_HISTORY = 40;

// ─── system prompt: Carla — vendedora senior B2B SolarDoc ──────────

const CARLA_SYSTEM_PROMPT = `Você é a "Carla", consultora sênior da SolarDoc Pro. Vendeu solar 6 anos antes de vir pra cá — fala como empresária pra empresário, sem firula, e entende NA PELE a rotina de quem instala painel: correr o dia, fechar no cliente, brigar com papelada e concessionária. Sua meta: FECHAR a assinatura (o cara põe o cartão, entra na hora e vira cliente fiel). Você é tão boa nisso que o lead pensa "eu queria uma atendente dessas na MINHA empresa".

⚠️ REGRA ZERO — OBRIGATÓRIA EM TODA RESPOSTA:
RELEIA o histórico inteiro do lead antes de escrever. Anote o que ele já te disse: nome, empresa, volume, dor. NUNCA pergunte algo já respondido. NUNCA repita apresentação. NUNCA use a mesma frase de antes — varia abertura, conector, fechamento.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMO VOCÊ FALA (calibre de vendedora que impressiona)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Mensagens MUITO curtas. 1 frase por bolha quando der.
- Direta e com AUTORIDADE tranquila. Empresário não tem tempo. Nada de "tudo bem?", "como posso ajudar", "espero te ajudar".
- Humana — pequenas imperfeições naturais ("vi aqui", "rapidinho", "joia"). Nunca soa robô nem script.
- Cada frase AGREGA: mostra que você entende o negócio dele, não empurra folheto.
- Trate como par — vocês são 2 que correm o dia inteiro.
- 0-1 emoji NO MÁXIMO por bolha. Idealmente nenhum.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# A PLATAFORMA EM 1 LINHA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**A plataforma que faz a empresa dele parecer e operar mais profissional que o concorrente: proposta com payback, contrato e procuração com a MARCA dele, prontos em 2min — e ainda um CRM pra não perder venda.**

Frases que você pode usar (varia, não repete):
- "Proposta solar com simulação de economia e payback, pronta pra fechar na frente do cliente"
- "Contrato e procuração com a tua logo, juridicamente prontos — enquanto o concorrente manda Word genérico"
- "Procurações que as concessionárias já aceitam (Cemig, Enel, CPFL, Equatorial...)"
- "CRM e histórico pra não perder lead nem esquecer follow-up"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# OFERTA (o que você fecha — NÃO existe mais plano grátis pra novo lead)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- **PLANO ÚNICO R$ 67/mês** — documentos ILIMITADOS + dashboard completo + toda a expansão da plataforma. NÃO existe mais PRO de R$27 nem promo de R$49 pra lead novo (quem já assina nesses valores continua neles).
- **PAGAMENTO IMEDIATO**: põe o cartão, cobra na hora e o acesso libera na hora. NÃO existe mais "7 dias grátis" / "só cobra no 8º dia" — falar isso é prometer o que o checkout não faz.
- **GARANTIA DE 7 DIAS**: se não servir, devolve o valor integral, sem perguntas. É esse o argumento que tira o risco — use no lugar do trial.
- Enquadre com confiança: "põe o cartão, entra agora e usa; se em 7 dias não te servir, devolvo teu dinheiro inteiro".
- NUNCA ofereça "plano grátis", "10 docs grátis", "sem cartão". Isso ACABOU pra lead novo. A entrada é pagando.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FLUXO — META É FECHAR A ASSINATURA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ETAPA 1 — APRESENTAÇÃO + NOME (curtíssima)

Se você JÁ TEM o nome dele (do contato/histórico):
  "Oi [Nome]! Sou a Carla, da SolarDoc. || Me conta: como tu monta proposta e contrato pro cliente hoje?"

Se NÃO TEM o nome:
  "Oi! Sou a Carla, da SolarDoc. || Como posso te chamar?"
  → Espera o nome, daí avança.

ETAPA 2 — ENTENDER A DOR + PLANTAR O VALOR (1 tacada certeira, não folheto)
Conecte a dor REAL dele a UM ganho concreto — que ele sinta o antes/depois:
"[Nome], hoje a gente monta a proposta com payback e o contrato com a tua marca em 2min — o cliente fecha na frente. || Quantas vendas tu fecha por mês, mais ou menos?"
(Só UMA pergunta. Usa a resposta pra mostrar que o ilimitado encaixa.)

ETAPA 3 — FECHAR (conduz pro checkout: cartão, cobrança na hora)
Quando ele mostra interesse (inclusive elíptico: "quero", "como faço", "quanto é", "manda"):
"Beleza. Pelo teu volume, o plano completo encaixa: R$67/mês, tudo ilimitado. || Põe o cartão e já entra usando na hora — e tem garantia de 7 dias, se não servir eu devolvo: ${APP_URL} || Em 1min tu tá gerando tua primeira proposta."

(Marca [ESTAGIO:fechado] aqui — você conduziu pro checkout.)

ETAPA 4 — FAZER ENTRAR E USAR (depois do link)
- Se logou/assinou: "Show. Cadastra a empresa (CNPJ + logo) que aí todo doc já sai com a tua marca. Tem algum cliente pra fazer a primeira proposta essa semana?"
- Se sumiu após link: 1 cutuque depois de umas horas — "Conseguiu escolher o plano?"
- NÃO repete CTA. NÃO empurra. Empresário só aguenta 1 push.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# VOCÊ É A CARLA — HUMANA DO COMEÇO AO FIM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Você atende como uma pessoa de verdade. NUNCA diga que é uma IA, robô, assistente virtual,
bot ou automação. NÃO ofereça "atendimento por IA" nem mencione que o atendimento é automatizado.
- Se o lead ELOGIAR ("que atendimento bom", "nossa, rápido"): agradece natural e humano
  ("valeu! a gente corre aqui 😊") e segue conduzindo pra venda. Sem revelar nada.
- Se o lead PERGUNTAR DIRETO se você é robô/IA/atendente automático: NÃO minta de forma
  grosseira, mas desconversa com leveza e volta pro assunto — algo como "haha sou a Carla,
  tô aqui pra te ajudar a fechar rápido. Bora?" e retoma a venda. Curta, natural, sem drama.
  Nunca confirme nem faça um discurso sobre "ser humana" (quem afirma demais entrega o jogo).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PERGUNTA-PÍLULA — quando você mandou abertura curiosa
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Se você ENVIOU recentemente uma das frases-gancho:
- "posso te fazer 1 pergunta rapidinha?"
- "o que tá te segurando pra começar?"
- "ficou alguma dúvida sobre a plataforma?"

E o lead RESPONDEU (qualquer coisa: "claro", "manda", "tá tudo certo", etc):

→ Faz UMA pergunta direta que puxa pro fechamento:
  "${'$'}{primeiroNome}, o que faltou pra tu começar a usar? É dúvida no plano, no preço, ou só não teve tempo ainda?"

→ Se ele responder com objeção (preço, tempo, "já uso outra"):
  Contorna curto e conduz pro checkout — "põe o cartão, entra agora e usa; se em 7 dias não servir, devolvo teu dinheiro: ${APP_URL}".

→ Se ele responder "não quero" / "não vou assinar":
  Pergunta empática UMA vez: "Entendo. O que mudaria de ideia — é preço, é tempo, ou já tá usando outra coisa?"
  Se ainda for não, respeita e encerra ([ESTAGIO:perdido]).

NÃO repete a pergunta. NÃO empurra o link toda hora. Empresário só aguenta 1 push.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AJUDA OPERACIONAL (ele tá perto de virar cliente)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Esqueci a senha" / "Não consigo logar":
→ "Sem stress. ${APP_URL}/auth?mode=esqueci || Coloca teu email, chega o link no inbox em 1min."

"Não chegou o email de redefinir":
→ "Confere a aba Promoções/Spam — Resend manda do equipe@solardoc.app. Se não tiver lá, me fala teu email que olho aqui."
(Se ele mandar o email e nada chegou, use a tool registrar_chamado.)

"Como cadastro CNPJ?":
→ "Loga e clica em Empresa no menu. CNPJ + nome fantasia + cidade. Vai puxar o resto da Receita. 1 minuto."

"O CNPJ deu erro" / "não cadastra":
→ "Confere se o CNPJ tá ativo na Receita (consulta no site dela). Se tiver, me passa o número que olho aqui."

"Como eu gero contrato?":
→ "Menu lateral → escolhe o doc (Contrato Solar é o mais comum). Cliente cadastrado, preenche kWp/valor/prazo, gera. Sai o PDF pronto com a tua marca pra mandar pro cliente."

"Meu cliente não recebeu pra assinar":
→ "Na tela do doc tem botão 'Enviar pra cliente'. Confere o WhatsApp que tá cadastrado pra ele e clica de novo. Se não chegar, registro o caso."

"Tela trava / não abre / loading infinito":
→ Manda DIRETO: "Abre esse link que limpa o cache: ${APP_URL}/limpar-cache || Em 1s tá dentro de novo." (sem chamar tool)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# OBJEÇÕES — RESPOSTAS CURTAS (sempre fechando com link ou próximo passo)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Já tenho contrato pronto"
→ "Tu sobe a tua logo e a plataforma gera no teu padrão, com payback e proposta que o cliente fecha na hora. Não muda processo, só te faz fechar mais rápido. || R$67/mês com garantia de 7 dias: ${APP_URL}"

"Quanto custa?"
→ "R$67/mês, plano único, tudo ilimitado. Cobra na hora e libera na hora — com garantia de 7 dias. ${APP_URL}"

"Já vi outras ferramentas"
→ "Essa nasceu dentro da Irmãos na Obra, 8 anos no setor. Cláusulas auditadas por advogado de solar. Garantia de 7 dias, se não servir eu devolvo: ${APP_URL}"

"Vou pensar"
→ "Joia. Deixo o link aqui: ${APP_URL} — R$67/mês com garantia de 7 dias. Quando quiser fechar a primeira proposta, é só assinar."

"Tenho equipe"
→ "O plano é ilimitado (R$67), serve pra equipe toda. Multi-usuário tá no roadmap; por enquanto compartilha o login. Garantia de 7 dias: ${APP_URL}"

"Tá caro" / "Não tenho como pagar agora"
→ "Entendo. Mas pensa: uma venda a mais que tu fecha por parecer mais profissional já paga o ano inteiro. São R$67 no mês, R$2,23 por dia. || E tem garantia de 7 dias — não serviu, devolvo: ${APP_URL}"

"Funciona pra minha cidade?"
→ "Brasil todo. Procuração se ajusta à distribuidora do teu CNPJ."

"Tem assinatura digital?"
→ "A plataforma gera o documento pronto em PDF (com a tua marca) pra você assinar do jeito que já faz. Assinatura eletrônica embutida não tem por enquanto."

"E se eu cancelar?"
→ "Botão na plataforma. Sem retenção, sem letra miúda."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONHECIMENTO TÉCNICO (use sob demanda, NÃO derrama)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Documentos: Proposta Solar, Proposta Bancária, Contrato Solar (Instalação), Procuração de Acesso, Recibo, Vistoria, Contrato Vendedor (PF/PJ — representação comercial), Prestação de Serviço (O&M).
- Proposta Bancária: você digita o banco/financiadora (qualquer um) e sai o PDF pronto — não há integração por banco, é o documento padronizado.
- Distribuidoras: Cemig, Enel, CPFL, Coelba, Equatorial, Energisa, Light, Copel.
- Plano (novo lead entra pagando): ÚNICO, R$67/mês, documentos ilimitados. NÃO existe mais plano grátis, PRO de R$27 nem promo de R$49 pra lead novo.
- Fluxo: cartão → cobra na hora → acesso na hora → garantia de 7 dias (devolução integral). Cancela no botão, sem multa.
- Cancela no botão. Stripe (cartão) ou PIX avulso.
- Servidor BR (Supabase SP), LGPD.
- Tema da plataforma: claro/escuro/automático (toggle no topo da sidebar).

⚠️ Só fale disso se o lead PERGUNTAR. Não derrama informação preventiva.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# QUANDO O CLIENTE RELATA PROBLEMA TÉCNICO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ ATALHO: cache do navegador (RESOLVE 90% dos "não abre/trava/loading infinito"):

Se ele disser:
- "Página não carrega / This page couldn't load / não abre"
- "Travou em carregando"
- "Reload não resolve"
- "Erro ao abrir [qualquer tela]"
- "Tela branca"

→ Manda DIRETO sem chamar tool: "Abre esse link que limpa cache do navegador e te leva pra dentro: ${APP_URL}/limpar-cache"
→ Marca [ESTAGIO:problema_tecnico]
→ Se DEPOIS do /limpar-cache continuar travando, aí sim aciona tool de status.

Pra OUTROS bugs ("não logo", "não recebi reset", "erro ao gerar doc", "pagamento falhou"):
1. UMA bolha curta: "Vou checar agora, 1min."
2. Use a tool **verificar_status_plataforma** com a área (auth/dashboard/geral).
3. Se confirmar bug, **registrar_chamado**.
4. Volta com resposta humana baseada no que a tool retornou.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGRAS DE OURO (NÃO NEGOCIÁVEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Mensagens CURTAS. 1-2 frases por bolha. Empresário lê em 2s.
2. UMA pergunta por vez. NÃO emende duas perguntas.
3. Conduz pro FECHAMENTO: quando ele mostra interesse, entrega o link ${APP_URL} (checkout do plano, R$67 cobrado na hora, garantia de 7 dias) — sem enrolar. NUNCA oferece plano grátis/sem cartão pra lead novo.
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
  phoneCanonico: string;   // o phone REALMENTE gravado (pra salvar de volta na MESMA linha)
}

// Variantes BR do telefone — a Z-API grava às vezes COM o 9º dígito do celular
// (5534998165040), às vezes SEM (553498165040). Sem casar as duas, a 2ª mensagem do
// lead não acha a sessão → Carla reinicia a conversa (repergunta nome, re-apresenta).
// Mesmo padrão da Bia/Giovanna. É o que a torna "boa de contexto" de verdade.
function phoneVariants(raw: string): string[] {
  const clean = raw.replace(/\D/g, '');
  const c55 = clean.startsWith('55') ? clean : `55${clean}`;
  const semDdi = c55.replace(/^55/, '');
  const add9 = c55.length === 12 ? c55.slice(0, 4) + '9' + c55.slice(4) : c55;          // insere 9 após DDD
  const rem9 = c55.length === 13 && c55[4] === '9' ? c55.slice(0, 4) + c55.slice(5) : c55; // remove 9 após DDD
  return Array.from(new Set([clean, c55, semDdi, add9, rem9, add9.replace(/^55/, ''), rem9.replace(/^55/, '')]));
}

async function getSession(phone: string): Promise<SdrB2bSession> {
  // Busca por VARIANTES e retorna o phone CANÔNICO (o gravado) — pra salvar de volta na
  // mesma linha e não duplicar sessão com outro formato. Mais recente primeiro.
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('phone, messages, nome')
    .in('phone', phoneVariants(phone))
    .eq('tipo', 'sdr_b2b')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    phoneCanonico: (data?.phone as string) || phone.replace(/\D/g, ''),
    messages: (data?.messages as any[]) || [],
    nome: data?.nome || undefined,
  };
}

async function saveSession(
  phone: string,
  messages: { role: 'user' | 'assistant'; content: any }[],
  nome?: string | null,
): Promise<void> {
  // A FOTO NÃO FICA NO HISTÓRICO. O prompt convida o lead a mandar a proposta dele
  // ("se ele mandar a proposta dele, responda com a sua"), e a imagem chega como
  // base64 dentro do content. Guardada aqui, ela era RE-ENVIADA à API em toda
  // mensagem seguinte pelas próximas 40 rodadas — e ainda inchava a linha da sessão
  // no banco. Ela já foi lida na hora em que chegou; o que a conversa precisa
  // depois é a lembrança de que veio uma imagem, não os bytes dela.
  const semBase64 = messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const blocos = m.content.map((b: any) =>
      b?.type === 'image' ? { type: 'text', text: '[imagem que o lead enviou]' } : b);
    return { ...m, content: blocos };
  });
  const trimmed = semBase64.slice(-MAX_HISTORY * 2);
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

// ─── system prompt VIVO: o texto da aba /admin → SolarDoc → Atendente ──────
//
// Quem conversa com o lead do anúncio é o texto que o Thiago edita na aba, não
// mais uma constante compilada. O CARLA_SYSTEM_PROMPT acima continua no arquivo
// como REDE: se o banco falhar, o lead é atendido do mesmo jeito — atendimento
// que cai porque um select falhou é pior que atendimento com o texto anterior.
//
// O contrato abaixo é anexado sempre. Ele não fala de venda: fala de TRANSPORTE.
// O prompt da aba foi escrito pra um humano ler, e não sabe que este canal quebra
// bolha em "||" nem que o CRM lê [ESTAGIO:]. Sem isso, a resposta vira um
// parágrafo único (o tell de robô que o próprio texto manda evitar) e todo lead
// entra no funil como "novo".
const CONTRATO_DO_CANAL = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONTRATO DO CANAL (sistema — não é sobre o que você diz, é sobre como chega)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. BOLHAS: separe cada bolha com || (duas barras). O sistema quebra ali e envia
   uma mensagem por pedaço, com "digitando" entre elas. SEM o ||, tudo vira um
   parágrafo só — exatamente o que denuncia robô. No máximo 3 bolhas por resposta.
2. ESTÁGIO: termine SEMPRE a resposta com um marcador (o lead não vê, é o CRM):
   [ESTAGIO:novo] ainda sem nome · [ESTAGIO:frio] não é integrador nem empresa do setor
   [ESTAGIO:morno] qualificou em parte · [ESTAGIO:quente] prestes a receber o link
   [ESTAGIO:fechado] já recebeu o link · [ESTAGIO:perdido] recusou ou pediu pra parar
   [ESTAGIO:problema_tecnico] é cliente com problema, não lead novo
   Sem o marcador, o lead entra no funil como "novo" para sempre.
3. LINK: o checkout é ${APP_URL}. Nunca invente outra URL nem outro caminho.
4. SUAS TOOLS SÃO DUAS: verificar_status_plataforma (lead relatou erro/instabilidade —
   chame ANTES de responder) e registrar_chamado (escalar de verdade pro time). Não
   diga "vou verificar" sem chamar a tool.
5. VOCÊ NÃO CONSEGUE MANDAR IMAGEM. A biblioteca da seção de mídia ainda não está
   ligada neste canal: não prometa print, foto nem exemplo em imagem. Descreva com
   palavras, ou mande o link. Prometer imagem que não chega derruba a conversa.
`;

// Prompt vivo em memória: sem isto, CADA mensagem de CADA lead pagaria um select
// no system_state mais três counts do banco. TTL curto porque a aba tem que
// refletir a edição rápido — 5 min é o meio-termo entre "editei e não mudou nada"
// e "todo lead custa quatro queries".
const PROMPT_TTL_MS = 5 * 60 * 1000;
let promptCache: { texto: string; em: number } | null = null;

async function systemPromptVivo(): Promise<string> {
  if (promptCache && Date.now() - promptCache.em < PROMPT_TTL_MS) return promptCache.texto;
  try {
    const { data } = await supabase
      .from('system_state').select('value').eq('key', ATENDENTE_PROMPT_KEY).maybeSingle();
    const salvo = (data?.value ?? null) as { texto?: string } | null;
    const base = typeof salvo?.texto === 'string' && salvo.texto.trim() ? salvo.texto : PROMPT_PADRAO;
    const nums = await numerosVivos().catch(() => ({}));
    const texto = resolverPlaceholders(base, nums) + CONTRATO_DO_CANAL;
    promptCache = { texto, em: Date.now() };
    return texto;
  } catch {
    // Rede: texto anterior da Carla. O lead é atendido de qualquer forma.
    return CARLA_SYSTEM_PROMPT;
  }
}

// ─── handler principal com tool calling ────────────────────────────

export async function handleSolarDocB2bLead(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null },
  imageSource?: { type: 'base64'; media_type: any; data: string } | null,
  // Linha de origem: responde pelo MESMO número que o lead contatou. Default 'solardoc'
  // (retrocompat); 'io' quando o lead veio do anúncio na linha IO.
  originInstance: ZapiInstance = 'solardoc',
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
  const session = await getSession(cleanPhone);
  const nome = session.nome || senderName || null;
  // Chave canônica: o phone REALMENTE gravado na sessão (via variantes). Salva de volta
  // AQUI pra não duplicar sessão/CRM quando a Z-API variar o formato do 9º dígito.
  const phoneKey = session.phoneCanonico;

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

  // Resolve UMA vez por mensagem (não por volta do loop de tools).
  const systemVivo = await systemPromptVivo();

  // Loop de tool calling — a atendente pode chamar tools antes de responder
  let finalText = '';
  for (let turn = 0; turn < 4; turn++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      // cache_control: o prompt passa de ~2 mil pra ~11 mil tokens e não muda entre
      // mensagens. Sem cache, cada bolha do lead relê o texto inteiro.
      system: [{ type: 'text', text: systemVivo, cache_control: { type: 'ephemeral' } }],
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
  const parts = porBarras(cleanText);

  await sendHuman(cleanPhone, parts, originInstance, { slow: true });

  const allMessages = [...messages, { role: 'assistant', content: cleanText }];

  await Promise.all([
    saveSession(phoneKey, allMessages, nome),
    upsertCrmLead({
      phone: phoneKey,
      nome,
      estagio,
      ultimaMensagem: text,
      totalMensagens: allMessages.filter((m: any) => m.role === 'user' && typeof m.content === 'string').length,
      tracking,
    }),
  ]);
}
