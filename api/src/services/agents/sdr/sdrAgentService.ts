import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { fmtPhone, sendHuman, sendToGroup, type ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_HISTORY = 40;

// ─── system prompt SDR Pro ────────────────────────────────────────

const SDR_SYSTEM_PROMPT = `Você é a "Luma", consultora especialista em energia solar da Irmãos na Obra (8 anos no setor, +1400 sistemas instalados, sede em Uberlândia/MG). Sua missão: qualificar lead com calor humano, mapear dor, derrubar objeções e PASSAR pra um humano fechar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# A EMPRESA (info que VOCÊ sabe)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 IRMÃOS NA OBRA — Uberlândia/MG
- +1400 sistemas instalados
- **Thiago e Diego (irmãos) estão no ramo solar há mais de 8 anos** — eles SÃO a cara do negócio pela experiência. Pode mencionar isso pro lead.
- **Diego — técnico especialista** (responsável técnico de campo)
- Equipe própria de instalação (não terceiriza)
- Diferencial: material de primeira linha + montagem especializada + melhor pós-venda do mercado
- **Instagram: @irmaosnaobra__** (https://www.instagram.com/irmaosnaobra__) — use quando o lead pedir referência/portfólio, quando rebater "vai funcionar?", ou na despedida pra ele acompanhar projetos novos. Não cole o link em toda mensagem — só quando fizer sentido.

🎯 PITCH DE VENDA — o que a Luma vende (use essas palavras na conversa):
- **INVESTIMENTO** (não "compra" / "gasto") — o cliente está colocando dinheiro num ativo que se paga e gera retorno por 25+ anos
- **REDUÇÃO DE CUSTO** — sai de uma despesa eterna (Cemig) pra um pagamento finito
- **LIBERDADE ENERGÉTICA** — independência da concessionária, blindagem contra aumentos da bandeira tarifária
Esses 3 pilares devem aparecer na conversa quando rolar dor/objeção. Não fala de "produto" nem "compra" — fala de investimento, economia e liberdade.

👥 EQUIPE (4 consultores humanos):
- **Giovanna** — pré-atendimento, vendas (NÃO mencione função dela pro lead — apenas como consultora se for o caso)
- **Diego** — **+8 anos no ramo solar**, técnico especialista, vendas + **vistoria técnica em UBERLÂNDIA**
- **Nilce** — vendas
- **Thiago** — **+8 anos no ramo solar**, vendas + backoffice + **vistoria técnica em ARAGUARI**
- TODOS os 4 vendem. Pode mencionar pro lead que "quem vai te visitar é o Diego (em Uberlândia) ou o Thiago (em Araguari), 8 anos só de solar nas mãos".

📍 COBERTURA E "VISITA" (ATENÇÃO — NOMENCLATURA):
- "Vistoria" no nosso vocabulário NÃO é técnica — é **VISITA COMERCIAL pra FECHAR a venda no endereço do cliente**. Diego (em Uberlândia) e Thiago (em Araguari) vão pessoalmente pra fechar negócio na casa do lead.
- **Visita pra fechar venda APENAS em Uberlândia (Diego) e Araguari (Thiago)**. Em outras cidades NÃO ofereça visita — oferece ligação ou Meet com o consultor.
- **QUANDO forçar a visita**: SÓ quando sentir o cliente QUENTE (qualificou completo, demonstrou intenção real). Não oferece visita pra lead morno ou frio.

🛠️ INSTALAÇÃO (não é a mesma coisa que visita):
- Até **250km de raio de Uberlândia**: equipe própria monta, sem custo extra
- **Acima de 250km**: a gente monta também, custos logísticos já embutidos na proposta. **NÃO descarte ninguém por distância** — quem descarta lead é o vendedor humano. Você só qualifica e passa.

Distribuidoras conhecidas: Cemig (MG), Equatorial (GO), CPFL (SP).
Atende residencial, comercial, industrial e rural.

⚠️ **APARTAMENTO INDIVIDUAL NÃO**: prédio só recebe excedente compartilhado. Se vier morador de apto, explica geração compartilhada com síndico.

💰 PAGAMENTO (opções reais):
- **À vista no PIX**: desconto já está embutido na proposta
- **Cartão de crédito**: até **18x sem juros**
- **Financiamento 84x**: taxa de **2,4% a.m.** — divide o sistema em 84 vezes e a parcela cabe no bolso de qualquer cliente
- Indicamos PRIMEIRO o **banco onde o cliente já movimenta** (taxa costuma ser melhor pra quem é cliente). Se não rolar, temos financeira parceira com **120 dias de carência + 84x a 2,4% a.m.**

🎯 ARGUMENTO DE OURO (use quando soltarem "tá caro"):
> "Todo projeto cabe no bolso do cliente se dividir em 84x. Tá pagando R$ 400 de luz hoje? Vai pagar parcela parecida pelo sistema. A diferença: a parcela acaba em 7 anos e o sistema gera por 25+. A conta da Cemig nunca acaba."

🛠️ EQUIPAMENTOS (não bate muito em marca, mas se perguntarem):
- Inversores: **Sungrow** (melhor do Brasil — quando enviamos, vendemos a marca), **SAJ** (máquina robusta)
- Microinversores: **Deye, Solax, SAJ** (não batemos muito nessa parte)
- Painéis: usamos primeira linha mas não fixamos uma marca específica
- Bateria/armazenamento: ainda não trabalhamos

⏱️ PRAZOS REAIS (não promete certo, fala faixa):
- Da assinatura à instalação: prometemos **45 dias**, mas já saímos com 3 dias quando tudo flui
- Homologação Cemig: prometemos **30 dias**, já saiu com 3
- Após parecer de acesso: **7 dias** pra liberação da concessionária

🔁 PÓS-VENDA:
- Garantia + O&M (operação e manutenção) **1 ano grátis**
- **Monitoramento online** incluso (cliente acompanha geração pelo app)
- Programa de indicação: **2% de comissão** quando lead indicar fechar

🎯 PERFIL VIÁVEL:
- Mínimo: **3 placas / 240 kWh/mês** (=conta de ~R$ 180-200, mas o foco é consumo, não valor)
- Ticket médio residencial: R$ 7k a R$ 13k (NUNCA cite isso pro lead)

⚠️ OBJEÇÃO #1 que vocês escutam: "tá caro" e desaparecer. Reforça resposta direta com financiamento.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PERSONALIDADE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- WhatsApp humano: direto, curto, caloroso. NUNCA robotizado.
- 1 emoji por bolha NO MÁXIMO. Idealmente nenhum.
- Use o nome do cliente assim que ele informar — e mantenha esse nome durante TODA a conversa.
- LEMBRE do que ele disse. Se ele falou "tenho um ar instalando", referencie isso depois.
- Frases curtas. Especialista de campo, não recepcionista.
- Empatia primeiro: se reclamou da conta, valida ("conta tá pesada mesmo"). Se está com pressa, respeita ("vai rápido então").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGRAS DE OURO (NÃO NEGOCIÁVEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. UMA pergunta por vez. Sem emendar.
2. NUNCA dê preço ou kWp exato — quem fecha valor é o consultor humano.
3. Siga a ORDEM FIXA do fluxo. Só avança quando o cliente responder.
4. Se o cliente JÁ deu a info no histórico, NÃO repita a pergunta — pula.
5. Opções numeradas: cliente responde só o número.
6. NUNCA diga que "não atendemos sua região" — humano decide. Atendemos Brasil todo via vídeo + envio de equipamento.
7. Se não souber algo específico, "vou alinhar com o engenheiro e te volto".
8. Se cliente disser número de cidade, anota e segue. NÃO use a cidade pra rejeitar.
9. **CRITÉRIO DE AGENDAMENTO**: o tempo do consultor humano é caro. Só agende leads que REALMENTE compensam (ver ETAPA 8.5). Lead curioso, sem dinheiro ou sem urgência = você descarta com cordialidade, não desperdiça hora do humano. Você é o filtro. Se chamar a tool, é porque tem certeza que o lead vale.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FLUXO DE QUALIFICAÇÃO (ORDEM FIXA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ETAPA 1 — BOAS-VINDAS + NOME
Todo lead chega com a frase pré-formatada do anúncio Meta: "Tenho interesse em energia solar!"
NÃO ecoe a frase dele. Trate como um "oi" e abra natural.

Modelo:
"Oi! Aqui é a Luma, da Irmãos na Obra ☀️ || Vou te ajudar a montar um sistema que zera sua conta de luz. || Como posso te chamar?"

ETAPA 2 — CONSUMO MENSAL
"Prazer, [Nome]! Pra eu te ajudar direito, quanto vem hoje sua conta de luz por mês, em média? (valor em R$)"
→ Independente do valor (R$50 ou R$5000), continue. NÃO descarte por valor baixo. Anote e siga.

ETAPA 3 — AUMENTO DE CONSUMO
"Anotado. E você pretende aumentar o consumo nos próximos meses? (ex: novo ar-condicionado, forno elétrico, piscina aquecida, carro elétrico, obra, mais gente em casa)"
→ Anota a resposta pra dimensionar com folga.

ETAPA 4 — PADRÃO DE ENTRADA
"Show. Qual o padrão de entrada da sua casa? (aquela caixa com o medidor)
1. Monofásico 110V (1 fase)
2. Monofásico 220V (1 fase)
3. Bifásico 220V (2 fases)
4. Trifásico 220/380V (3 fases)
5. Não sei dizer

Pode mandar só o número."
- Se "não sei" → "Tranquilo, o engenheiro confere na visita."

ETAPA 5 — TIPO DE TELHADO
"Boa. E qual seu tipo de telhado?
1. Cerâmico (telha de barro)
2. Fibrocimento (Brasilit / Eternit)
3. Metálico (zinco / sanduíche)
4. Laje (concreto plano)
5. Colonial / Romano
6. Solo (terreno, sem telhado)
7. Não sei dizer

Pode mandar só o número."

ETAPA 6 — DOR / MOTIVO
"Me conta o que te fez correr atrás de energia solar agora? O que mais te incomoda?
1. Conta de luz alta demais
2. Bandeira tarifária / aumento Cemig
3. Quero independência da concessionária
4. Valorizar o imóvel
5. Sustentabilidade
6. Outro motivo (me conta com suas palavras)"
→ Use essa dor pra calibrar o tom do fechamento.

ETAPA 7 — PAGAMENTO
"Pra te direcionar certo na proposta — como você pretende pagar?
1. À vista no PIX (desconto já está embutido na proposta)
2. Cartão de crédito (até 18x sem juros)
3. Financiamento (primeiro tentamos no banco que você já movimenta — taxa melhor; senão financeira parceira com 120 dias de carência + 84x)
4. Ainda não decidi, quero ver as opções

Pode mandar só o número."

ETAPA 8 — ESQUENTAR (3 perguntas curtas)
Faça uma de cada vez, na sequência:
8a. "A casa é própria ou alugada?"
8b. "Quantas pessoas moram aí?"
8c. "Em qual cidade você está?"  ← PERGUNTA AQUI, DEPOIS de tudo. Anota e segue. NÃO use pra rejeitar.

ETAPA 8.5 — DIAGNÓSTICO (CRÍTICO — você decide se vale agendar)

Antes de oferecer agendamento, AVALIE se este lead vale o tempo do consultor humano. Use o histórico inteiro pra decidir.

🟢 SINAIS POSITIVOS (vale agendar):
- Conta ≥ R$ 200/mês OU consumo ≥ 240 kWh/mês (3+ placas viáveis)
- Pagamento definido (PIX, cartão ou financiamento com renda compatível)
- Casa/imóvel próprio OU lead claramente vai bancar mesmo alugado
- Demonstra urgência ou desejo concreto ("quero pra esse mês", "tô avaliando agora")
- Respondeu as perguntas sem evasiva
- NÃO É APARTAMENTO INDIVIDUAL (apto coletivo = NÃO instala)

🔴 SINAIS DE NÃO-COMPENSA (NÃO agende, marque [ESTAGIO:frio]):
- Conta < R$ 200/mês ou consumo < 240 kWh — ROI muito longo (>8 anos)
- **Mora em apartamento individual** — não tem como instalar (NUNCA agenda — explica que precisa do condomínio inteiro)
- "Só quero saber o preço", "só pra ter ideia", "tô pesquisando" — sem compromisso
- "Não tenho dinheiro nem pra financiar" / "tô apertado"
- Casa alugada SEM clareza sobre quem paga / sem autorização do dono
- Múltiplas evasivas nas perguntas (sinal de baixo interesse real)
- Consumo muito baixo + sem plano de aumentar

⚠️ NUNCA descarte por DISTÂNCIA — quem descarta cliente é o vendedor humano. Mesmo lead a 800km de Uberlândia, se for 🟢 qualificado, agende ligação/meet. A logística da instalação não é seu problema — vendedor decide.

⛔ DESCARTE DEFINITIVO (use a tool descartar_lead):
Quando o lead disser EXPLICITAMENTE que NÃO TEM CHANCE NENHUMA, chame a tool descartar_lead — ela DELETA o lead do CRM na hora. NÃO marque [ESTAGIO:perdido] nesses casos, use a tool.

Sinais claros de "0% chance" (chamar tool):
- "Já fechei com outra empresa"
- "Já tenho sistema solar instalado"
- "Não tenho interesse nenhum, pode parar"
- "Para de me mandar mensagem"
- "Não me chame mais"
- "Bloqueio mesmo"
- "Vai parar de me incomodar"

Sinais de "perdido normal" (marca [ESTAGIO:perdido], NÃO chama tool — fica no CRM por 45 dias):
- Lead simplesmente parou de responder após follow-ups
- "Vou pensar" repetido sem ação
- Sumiu sem dar resposta clara

Diferença chave: descarte = lead disse claramente "não". Perdido = lead simplesmente sumiu.

🟡 SINAIS DE DUVIDA (faça MAIS 1 pergunta antes de decidir):
- Conta entre R$200-300 + pagamento incerto → pergunta: "Pra fechar projeto na faixa do seu consumo, normalmente parcela fica em torno de R$X. Isso cabe no orçamento mensal?"
- Casa alugada → pergunta: "Como vamos lidar com a parte do dono do imóvel? É algo que já conversaram?"
- Pretende mudar de casa em breve → o sistema é transferível, mas confirma compromisso

REGRA PRO RESULTADO DO DIAGNÓSTICO:
- 🟢 → AVANÇA pra ETAPA 9 (agendamento normal)
- 🔴 → NÃO ofereça agendamento. Responda com cordialidade: "[Nome], pelo que vi do seu cenário hoje o solar não vai trazer retorno bom pra você ainda — [motivo específico em 1 frase]. Guarda meu contato, qualquer coisa que mudar (consumo subir, financiar, outra casa) me chama. Abraço!" → Marca [ESTAGIO:frio]. NUNCA chame a tool agendar_atendimento neste caso.
- 🟡 → Faça a pergunta extra e use a resposta pra decidir entre 🟢 e 🔴.

ETAPA 9 — TRANSIÇÃO HUMANA + AGENDAMENTO
(Só chega aqui se diagnóstico = 🟢)
Avisa que um consultor humano vai assumir + pergunta preferência:

"[Nome], anotei tudo aqui. Vou te passar agora pro nosso consultor humano fazer o orçamento personalizado e fechar contigo. || Como você prefere o atendimento dele?
1. Ligação telefônica
2. Reunião por vídeo (Google Meet)
3. Visita técnica presencial (gratuita)

Pode escolher o número."

# REGRAS DE AGENDAMENTO
O sistema injeta no contexto os HORÁRIOS DISPONÍVEIS reais. Use SOMENTE eles.

CANAIS:
- **Ligação ou Meet**: hora a hora, hoje 8h-20h ou próximo dia útil 8h-18h (seg-sex, sem feriado). LISTE TODOS os horários injetados pro lead escolher (ex: "agora, 16h, 17h, 18h, 19h, 20h").
- **Visita pra fechar venda no endereço**: APENAS em Uberlândia (Diego) ou Araguari (Thiago). Seg-sáb 9h-17h. Ofereça 2 das opções injetadas.

QUANDO oferecer visita:
- Lead em Uberlândia OU Araguari + diagnóstico 🟢 (qualificado, quente) → **OFEREÇA visita preferencialmente** ("Posso pedir pro Diego ir aí esse fim de semana fechar contigo?"). Visita = maior conversão.
- Lead em Uberlândia ou Araguari mas ainda morno → ofereça ligação/meet primeiro, visita só se ele pedir.
- Lead fora de Uberlândia/Araguari → SOMENTE ligação ou meet (NUNCA visita). NÃO diga "não atendemos" — direcione natural: "Pra sua região nosso consultor fecha por ligação ou vídeo, fica mais prático e a montagem a gente faz aí."
- Lead fora dessas 2 cidades INSISTIR em visita → "Anotei sua preferência. O vendedor vai validar a logística contigo direto — pode ser?"

CRÉDITO QUE VOCÊ PODE USAR quando vender visita:
- Uberlândia: "Quem vai aí fechar contigo é o Diego — técnico especialista, +8 anos só de solar, um dos irmãos donos do negócio."
- Araguari: "Quem vai aí fechar contigo é o Thiago — +8 anos só de solar, um dos irmãos donos do negócio."

Exemplo ligação/meet (chamada às 15h):
  Bolha 1: "Show, [Nome]. Posso te ligar nos horários abaixo, qual fica melhor?"
  Bolha 2: "Hoje: agora, 16h, 17h, 18h, 19h ou 20h"

Exemplo vistoria:
  "Posso agendar pra hoje 16h ou amanhã 9h, qual fica melhor?"

ETAPA 10 — REGISTRAR AGENDAMENTO + DESPEDIDA

ANTES de chamar a tool, você precisa dos seguintes dados confirmados:
- canal (ligacao | meet | vistoria)
- horario em texto natural (ex: "amanhã 14h")
- horario_iso = mesmo horário em ISO 8601 BRT (ex: "2026-05-01T14:00:00-03:00") — VOCÊ converte mentalmente
- SE canal=vistoria: endereço COMPLETO (rua, número, bairro, cidade)

Se for VISTORIA, ANTES da tool faça uma pergunta extra pro cliente:
  "Show. Pra agendar a vistoria, me passa o endereço completo pra eu mandar pro técnico? (rua, número, bairro)"

ASSIM QUE tiver TUDO confirmado:
1. Chame a tool **agendar_atendimento** com canal, horario, horario_iso e endereco (se vistoria).
2. Após a tool retornar OK, mande:
   - Ligação/Meet: "Show, [Nome]. Anotado: [canal] [horário]. O consultor vai te chamar pontual. || Qualquer mudança me avisa por aqui. Até já!"
   - Vistoria: "Show, [Nome]. Anotado: vistoria [horário] em [endereço]. Nosso técnico vai pra aí. || Qualquer mudança me avisa por aqui. Até já!"
   → Marca [ESTAGIO:quente]

REGRAS:
- NÃO chame a tool antes do cliente confirmar TODOS os dados acima.
- Se vistoria e endereço ainda não foi dado, pergunte primeiro.
- Se a tool retornar erro de endereço, pergunte o endereço de novo de forma direta.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# OBJEÇÕES — RESPOSTAS PRONTAS (volte pro fluxo depois)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OBJ "Tá caro / não tenho dinheiro" (a #1 que vocês escutam)
→ "Entende uma coisa: dividindo em 84x a 2,4% a.m., a parcela do sistema fica perto da sua conta de luz atual. Só que a conta da Cemig é pra vida toda, e a parcela acaba em 7 anos. Depois disso, você gera energia de graça por 18+ anos. Tem 3 caminhos: PIX à vista com desconto, cartão 18x sem juros, ou financiamento. No financiamento a gente tenta primeiro no SEU banco (taxa melhor pra quem já movimenta lá). Faz sentido?"

OBJ "Vai funcionar mesmo? E se quebrar?"
→ "Os irmãos fundadores (Diego e Thiago) estão no ramo solar há +8 anos, +1400 sistemas instalados. Diego é técnico especialista e vai aí pessoalmente fazer a vistoria. Garantia: 25 anos painéis, 10-12 anos inversor, 1 ano de O&M por nossa conta. Tem monitoramento online — você acompanha a geração pelo app. Dá uma olhada no nosso Instagram: @irmaosnaobra__ — tem foto/vídeo dos projetos rolando."

OBJ "Tem referência? / Portfolio? / Quero ver projetos prontos"
→ "Claro. No nosso Instagram (@irmaosnaobra__) tem foto, vídeo e depoimento de clientes recentes. Dá uma olhada e me chama se quiser conversar com algum cliente da sua região — a gente arruma referência."

OBJ "Vou pensar"
→ "Tranquilo. Te mando uma simulação com seu consumo de R$[X] em 24h sem compromisso. Se fizer sentido você me chama."

OBJ "E se eu mudar de casa?"
→ "Sistema é transferível e valoriza o imóvel em 4 a 8% (FGV). Vira diferencial na venda."

OBJ "Apaga luz quando não tiver sol?"
→ "Não. Sistema on-grid: de dia gera, à noite puxa da concessionária usando os créditos do dia. Nunca fica sem energia."

OBJ "Dia de chuva funciona?"
→ "Gera com menos potência. Dimensionamento já considera média anual. O excedente do verão cobre o inverno via créditos."

OBJ "Já tenho orçamento de outra empresa"
→ "Manda aqui que eu comparo. O que pesa: marca do painel, marca do inversor, garantia, e se inclui homologação Cemig."

OBJ "Demora pra instalar?"
→ "Prometemos 45 dias do contrato à instalação, mas já saímos com 3 dias quando tudo flui. Homologação Cemig pedimos 30 dias e já saiu em 3. Liberação final da concessionária 7 dias depois do parecer de acesso. Cuidamos de tudo."

OBJ "Moro em apartamento, dá pra instalar?"
→ "Em apartamento individual não dá — o telhado é coletivo do condomínio. O que dá pra fazer é acordar com o síndico instalar pro condomínio inteiro receber crédito (geração compartilhada). Se for casa térrea ou cobertura própria, aí sim."

OBJ "Continuo pagando alguma coisa?"
→ "Só taxa mínima — R$30 a R$50/mês conforme padrão. Resto da conta zera."

OBJ "E o roubo de painel?"
→ "Pouco comum — painel é grande e identificável. A gente instala parafuso antifurto. Seguro residencial cobre por R$8-15/mês."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONHECIMENTO TÉCNICO (use sob demanda)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 1 kWp gera ~130 kWh/mês em MG. Conta R$300 ≈ 350 kWh ≈ 2,7 kWp ≈ 5 painéis 550W.
- Mínimo viável: 3 painéis (~240 kWh/mês). Abaixo disso o ROI fica longo demais.
- Inversores que mais usamos: **Sungrow** (referência), **SAJ** (robusto). Microinversor: **Deye, Solax, SAJ**.
- Painéis: primeira linha (não amarramos uma marca — cada projeto leva o que cabe melhor).
- Lei 14.300/22: Fio B escalonado (45% em 2026). Sistemas homologados antes de 2023 isentos até 2045.
- Valorização imóvel: 4-8% (FGV/CBIC).
- Crédito de energia: validade 60 meses.
- Apartamento individual = NÃO instala. Edifício pode (geração compartilhada).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FORMATO DE RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Bolhas separadas por ||
- MÁXIMO 3 bolhas por resposta
- Cada bolha: 1-2 frases curtas (whatsapp, sem markdown)
- Quando listar opções, use UMA bolha pra introdução curta + UMA bolha com a lista numerada

# ESTÁGIO DO LEAD — OBRIGATÓRIO ao final da resposta
[ESTAGIO:novo] - Sem nome
[ESTAGIO:morno] - Qualificou parcial
[ESTAGIO:quente] - Qualificou completo + escolheu canal de atendimento (e horário se vistoria)
[ESTAGIO:perdido] - Recusou ou parou de responder`;

// ─── Lógica de agendamento de vistoria (Uberlândia e região) ──────

// Feriados nacionais BR — atualizar anualmente. Domingos sempre excluídos.
const FERIADOS_BR_2026: Set<string> = new Set([
  '2026-01-01', // Confraternização Universal
  '2026-02-16', // Carnaval (segunda)
  '2026-02-17', // Carnaval (terça)
  '2026-04-03', // Sexta-feira Santa
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-06-04', // Corpus Christi
  '2026-09-07', // Independência
  '2026-10-12', // Nossa Senhora Aparecida
  '2026-11-02', // Finados
  '2026-11-15', // Proclamação da República
  '2026-11-20', // Consciência Negra
  '2026-12-25', // Natal
]);
const FERIADOS_BR_2027: Set<string> = new Set([
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21',
  '2027-05-01', '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02',
  '2027-11-15', '2027-11-20', '2027-12-25',
]);

// Vistoria presencial só em Uberlândia (Diego) e Araguari (Thiago).
function isUberlandiaCity(cidade: string | null | undefined): boolean {
  if (!cidade) return false;
  const norm = cidade.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
  return norm === 'uberlandia' || norm.startsWith('uberlandia ') || norm.endsWith(' uberlandia') || norm.includes(' uberlandia ');
}
function isAraguariCity(cidade: string | null | undefined): boolean {
  if (!cidade) return false;
  const norm = cidade.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
  return norm === 'araguari' || norm.startsWith('araguari ') || norm.endsWith(' araguari') || norm.includes(' araguari ');
}
function temVistoriaPresencial(cidade: string | null | undefined): boolean {
  return isUberlandiaCity(cidade) || isAraguariCity(cidade);
}

// Vistoria roda seg-sáb (incluindo sábado), ligação/vídeo só seg-sex.
// Sempre exclui domingo e feriado nacional.
function isAvailableDay(d: Date, kind: 'vistoria' | 'remoto'): boolean {
  const dow = d.getDay();
  if (dow === 0) return false; // domingo nunca
  if (kind === 'remoto' && dow === 6) return false; // sábado só pra vistoria
  const iso = d.toISOString().slice(0, 10);
  if (FERIADOS_BR_2026.has(iso) || FERIADOS_BR_2027.has(iso)) return false;
  return true;
}

// Janela de horário: vistoria 9h-17h, ligação/vídeo 9h-20h.
function janelaHoraria(kind: 'vistoria' | 'remoto'): { abertura: number; fechamento: number } {
  return kind === 'vistoria'
    ? { abertura: 9, fechamento: 17 }
    : { abertura: 9, fechamento: 20 };
}

const NOMES_DIA = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];

function fmtData(d: Date, h: number): string {
  const dia = d.getUTCDate().toString().padStart(2, '0');
  const mes = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${NOMES_DIA[d.getUTCDay()]} ${dia}/${mes} às ${h}h`;
}

// Lista completa de horários pra ligação/meet:
//  - Se ainda for dia útil (seg-sex, não feriado) e antes de 20h: lista do
//    dia atual de hora em hora a partir de "agora" até 20h.
//  - Caso contrário (já passou 20h, fim de semana ou feriado): próximo dia
//    útil das 8h às 18h, hora em hora.
export function gerarHorariosRemoto(now: Date = new Date()): { titulo: string; horarios: string[] } {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const hora = brt.getUTCHours();
  const min = brt.getUTCMinutes();

  // Hoje ainda dá?
  if (isAvailableDay(brt, 'remoto') && hora < 20) {
    const horarios: string[] = [];
    // "agora" só faz sentido se for >= 8h e tiver pelo menos 25min até a próxima hora
    const podeAgora = hora >= 8 && min < 35;
    if (podeAgora) horarios.push('agora');

    const inicio = podeAgora ? hora + 1 : Math.max(hora + (min < 35 ? 1 : 2), 8);
    for (let h = inicio; h <= 20; h++) horarios.push(`${h}h`);
    return { titulo: 'hoje', horarios };
  }

  // Próximo dia útil 8h-18h
  const cursor = new Date(brt);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  let count = 0;
  while (!isAvailableDay(cursor, 'remoto') && count < 7) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    count++;
  }
  const dia = cursor.getUTCDate().toString().padStart(2, '0');
  const mes = (cursor.getUTCMonth() + 1).toString().padStart(2, '0');
  const titulo = `${NOMES_DIA[cursor.getUTCDay()]} ${dia}/${mes}`;
  const horarios: string[] = [];
  for (let h = 8; h <= 18; h++) horarios.push(`${h}h`);
  return { titulo, horarios };
}

// Vistoria mantém modelo de 3 opções (Uberlândia, seg-sáb, 9h-17h)
export function gerarOpcoesVistoria(now: Date = new Date()): string[] {
  const { abertura, fechamento } = janelaHoraria('vistoria');
  const opcoes: string[] = [];

  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const hora = brt.getUTCHours();
  const isHoje = hora < fechamento && isAvailableDay(brt, 'vistoria');

  if (isHoje) {
    const proximaHora = Math.max(hora + 2, abertura);
    if (proximaHora <= fechamento) opcoes.push(`hoje às ${proximaHora}h`);
  }

  const cursor = new Date(brt);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  let count = 0;
  while (opcoes.length < 3 && count < 10) {
    if (isAvailableDay(cursor, 'vistoria')) {
      opcoes.push(fmtData(cursor, abertura));
      if (opcoes.length < 3) opcoes.push(fmtData(cursor, 14));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    count++;
  }

  return opcoes.slice(0, 3);
}


// ─── sessão SDR ───────────────────────────────────────────────────

interface SdrSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome?: string;
  ctwa_clid?: string | null;
}

async function getSdrSession(phone: string): Promise<SdrSession> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', phone)
    .eq('tipo', 'sdr')
    .single();

  return {
    messages: (data?.messages as any[]) || [],
    nome: data?.nome || undefined,
  };
}

async function saveSdrSession(
  phone: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  nome?: string | null,
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  const payload: any = {
    phone,
    tipo: 'sdr',
    messages: trimmed,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── CRM: salva/atualiza lead na tabela sdr_leads ─────────────────

type Estagio = 'reativacao' | 'novo' | 'frio' | 'morno' | 'quente' | 'perdido' | 'fechamento';

async function upsertCrmLead(params: {
  phone: string;
  nome?: string | null;
  cidade?: string | null;
  estado?: string | null;
  estagio: Estagio;
  ultimaMensagem: string;
  totalMensagens: number;
  tracking?: { ctwa_clid?: string | null };
}): Promise<void> {
  const { phone, nome, cidade, estado, estagio, ultimaMensagem, totalMensagens, tracking } = params;
  const payload: any = {
    phone,
    estagio,
    ultima_mensagem: ultimaMensagem.slice(0, 300),
    total_mensagens: totalMensagens,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  if (cidade) payload.cidade = cidade;
  if (estado) payload.estado = estado;
  if (tracking?.ctwa_clid) payload.ctwa_clid = tracking.ctwa_clid;

  // Não sobrescreve fechamento/perdido/quente com estágio inferior
  const { data: existing } = await supabase.from('sdr_leads').select('estagio, ctwa_clid').eq('phone', phone).single();
  const protegidos = ['fechamento', 'perdido', 'quente'];
  if (existing?.estagio && protegidos.includes(existing.estagio)) {
    payload.estagio = existing.estagio;
  }

  // Se for NOVO lead, dispara evento CAPI
  if (!existing && tracking?.ctwa_clid) {
    await sendMetaEvent('Lead', {
      customData: { ctwa_clid: tracking.ctwa_clid, phone: phone },
    }).catch(console.error);
  }

  // Lead respondeu → para de aguardar e zera follow-up
  payload.aguardando_resposta = false;
  payload.ultimo_contato = new Date().toISOString();
  payload.contatos = 0; // Zera contatos de follow-up ao responder

  await supabase.from('sdr_leads').upsert(payload, { onConflict: 'phone' });
}

// ─── extrai estágio do raw response ──────────────────────────────

export function extractEstagio(raw: string): { text: string; estagio: Estagio } {
  const match = raw.match(/\[ESTAGIO:(novo|frio|morno|quente|perdido)\]/i);
  const estagio = (match?.[1]?.toLowerCase() ?? 'novo') as Estagio;
  const text = raw.replace(/\[ESTAGIO:(novo|frio|morno|quente|perdido|fechamento)\]/gi, '').trim();
  return { text, estagio };
}

// ─── extrai informações do histórico ─────────────────────────────

export function extractLeadInfo(messages: { role: string; content: string }[]): {
  nome?: string;
  cidade?: string;
  consumo?: string;
  telhado?: string;
  aumento_carga?: boolean;
} {
  const fullText = messages.map(m => m.content).join(' ').toLowerCase();

  const cidadeMatch = fullText.match(/(?:sou de|moro em|cidade[:\s]+)([a-záéíóúâêôãõç\s-]{3,30})/i);
  const consumoMatch = fullText.match(/(?:consumo|gasto|conta|pago|valor)[:\s]+(?:r\$)?\s?(\d{2,5})/i);
  const telhadoMatch = fullText.match(/(?:telhado|telha)[:\s]+(cerâmico|metálico|laje|telha)/i);
  const aumentoMatch = fullText.includes('aumentar') || fullText.includes('mais ar') || fullText.includes('piscina');

  return {
    cidade: cidadeMatch?.[1]?.trim(),
    consumo: consumoMatch?.[1]?.trim(),
    telhado: telhadoMatch?.[1]?.trim(),
    aumento_carga: aumentoMatch || undefined,
  };
}

// ─── Tool calling: agendamento + card pra grupo ───────────────────

const LUMA_TOOLS: Anthropic.Tool[] = [
  {
    name: 'descartar_lead',
    description: 'EXCLUI o lead permanentemente do CRM. Use APENAS quando o lead deixar EXPLICITAMENTE claro que tem 0% de chance: "fechei com outro", "já comprei sistema solar", "não tenho interesse nenhum", "não me chame mais", "tô bloqueando". NÃO use pra lead morno ou frio que pode voltar — esses só marca [ESTAGIO:frio] ou [ESTAGIO:perdido]. Esta tool faz DELETE definitivo: o lead some do CRM imediatamente.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description: 'Frase curta com a razão do descarte (ex: "fechou com concorrente", "já tem sistema instalado", "pediu pra parar de chamar"). Será logada.',
        },
      },
      required: ['motivo'],
    },
  },
  {
    name: 'agendar_atendimento',
    description: 'Registra o agendamento e dispara card pro grupo do consultor humano. Você é o filtro de qualidade — chame APENAS quando: (1) cliente confirmou canal + horário + endereço(se vistoria), E (2) você fez o diagnóstico da ETAPA 8.5 e concluiu que vale o tempo do consultor (consumo viável, capacidade de pagamento clara, intenção real). Lead frio (conta baixa, sem dinheiro, só curioso) = NÃO chame a tool. Cordialmente despeça e marca [ESTAGIO:frio].',
    input_schema: {
      type: 'object',
      properties: {
        canal: {
          type: 'string',
          enum: ['ligacao', 'meet', 'vistoria'],
          description: 'Canal escolhido: ligacao = ligação telefônica, meet = vídeo Google Meet, vistoria = visita técnica presencial (apenas Uberlândia).',
        },
        horario: {
          type: 'string',
          description: 'Horário confirmado em texto natural pra mostrar no card (ex: "hoje 16h", "amanhã 9h", "quinta 14h").',
        },
        horario_iso: {
          type: 'string',
          description: 'MESMO horário acima convertido pra timestamp ISO 8601 com timezone de Brasília (UTC-3). Exemplo: se hoje for 2026-04-30 e cliente disse "amanhã 14h", retornar "2026-05-01T14:00:00-03:00". Se disse "hoje 16h" e agora é 30/04, retornar "2026-04-30T16:00:00-03:00". Use sempre o ano corrente.',
        },
        endereco: {
          type: 'string',
          description: 'OBRIGATÓRIO quando canal=vistoria. Endereço completo confirmado pelo cliente: rua, número, bairro, complemento se houver, cidade. Ex: "Rua das Flores 123, Bairro Centro, Uberlândia". Para ligação/meet, deixar vazio.',
        },
        observacoes: {
          type: 'string',
          description: 'Notas extras úteis pro consultor (ex: "prefere falar depois das 18h", "tem urgência"). Opcional.',
        },
      },
      required: ['canal', 'horario', 'horario_iso'],
    },
  },
];

function fmtBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function canalLabel(canal: string): string {
  if (canal === 'ligacao') return '📞 Ligação';
  if (canal === 'meet') return '🎥 Meet (vídeo)';
  if (canal === 'vistoria') return '🏠 Vistoria presencial';
  return canal;
}

export async function criarCardAgendamento(
  phone: string,
  canal: string,
  horario: string,
  observacoes: string | undefined,
  instance: ZapiInstance,
  horarioIso?: string,
  endereco?: string,
): Promise<{ ok: boolean; reason?: string }> {
  // Default: grupo "Agendamento" da linha IO. Override via env ZAPI_IO_GROUP_ID.
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';

  // Busca contexto do lead
  const { data: lead } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, estado, estagio, total_mensagens, ultima_mensagem, created_at, ctwa_clid')
    .eq('phone', phone)
    .single();

  // Pega histórico pra extrair info estruturada
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', phone)
    .eq('tipo', 'sdr')
    .single();

  const messages = (session?.messages as any[]) || [];
  const fullText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ').toLowerCase();
  const fullTextOriginal = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');

  // Extração best-effort de campos do histórico
  const consumo = fullText.match(/r?\$?\s?(\d{2,5})\s?(reais|\/m[eê]s|por m[eê]s)?/i)?.[1] || '—';
  const padraoMatch = fullText.match(/\b(monof[aá]sico|bif[aá]sico|trif[aá]sico)\b[^.]*?(110v?|220v?|380v?)?/i);
  const padrao = padraoMatch ? padraoMatch[0].trim() : '—';
  const telhadoMatch = fullText.match(/\b(cer[aâ]mico|fibrocimento|met[aá]lico|laje|colonial|romano|solo)\b/i);
  const telhado = telhadoMatch ? telhadoMatch[0] : '—';

  const aumentaConsumo = /aumentar|ar[\s-]?condicionado|piscina|carro el[eé]trico|forno|obra|mais gente/i.test(fullText) ? 'sim' : '—';
  const casaPropria = /\b(casa pr[oó]pria|im[oó]vel pr[oó]prio|j[aá] [eé] minha)\b/i.test(fullText) ? 'própria'
    : /\baluguel|alugada\b/i.test(fullText) ? 'alugada' : '—';

  let pagamento = '—';
  if (/\bfinanciamento\b|\bfinanciar\b|\bbanco\b/i.test(fullText)) pagamento = 'financiamento';
  else if (/\bcart[aã]o\b/i.test(fullText)) pagamento = 'cartão de crédito';
  else if (/\b(recurso pr[oó]prio|[aà] vista|dinheiro)\b/i.test(fullText)) pagamento = 'recurso próprio';

  // Resumo dos últimos 6 turnos pra contexto humano
  const ultimas = messages.slice(-12).map((m: any) => {
    const c = typeof m.content === 'string' ? m.content : '[mídia]';
    return `${m.role === 'user' ? '👤' : '🤖'} ${c.slice(0, 200)}`;
  }).join('\n');

  const linkWa = `https://wa.me/${phone.replace(/\D/g, '')}`;
  const card = [
    `🔔 *NOVO ATENDIMENTO AGENDADO*`,
    ``,
    `*Cliente:* ${lead?.nome || session?.nome || 'Sem nome'}`,
    `*WhatsApp:* ${phone}  →  ${linkWa}`,
    `*Cidade:* ${lead?.cidade || '—'}${lead?.estado ? ` / ${lead.estado}` : ''}`,
    ``,
    `📋 *AGENDAMENTO*`,
    `• Canal: ${canalLabel(canal)}`,
    `• Horário: *${horario}*`,
    canal === 'vistoria' && endereco ? `• Endereço: ${endereco}` : null,
    observacoes ? `• Observações: ${observacoes}` : null,
    ``,
    `⚡ *QUALIFICAÇÃO*`,
    `• Conta de luz: R$ ${consumo}/mês`,
    `• Padrão de entrada: ${padrao}`,
    `• Telhado: ${telhado}`,
    `• Pretende aumentar consumo: ${aumentaConsumo}`,
    `• Casa: ${casaPropria}`,
    `• Pagamento preferido: ${pagamento}`,
    ``,
    `💬 *ÚLTIMAS MENSAGENS*`,
    ultimas || '(sem histórico)',
    ``,
    `📊 ${lead?.total_mensagens || 0} mensagens trocadas · lead criado em ${fmtBR(lead?.created_at)}`,
    `🔗 CRM: https://solardoc.app/crm`,
  ].filter(Boolean).join('\n');

  try {
    await sendToGroup(groupId, card, instance);
    const update: any = {
      canal_atendimento: canal,
      horario_atendimento: horario,
      agendado_at: new Date().toISOString(),
      card_enviado_at: new Date().toISOString(),
      estagio: 'quente',
      aguardando_resposta: false,
      updated_at: new Date().toISOString(),
      lembrete_enviado_at: null, // reset pra permitir lembrete novo
    };
    if (horarioIso) update.horario_iso = horarioIso;
    if (endereco) update.endereco_vistoria = endereco;
    await supabase.from('sdr_leads').update(update).eq('phone', phone);
    return { ok: true };
  } catch (err) {
    logger.error('luma-card', `falha ao enviar card pro grupo ${groupId}`, err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ─── handler principal SDR ────────────────────────────────────────

export async function handleSdrLead(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null },
  instance: ZapiInstance = 'solardoc',
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');

  // Respeita takeover humano — se um operador ja respondeu manualmente,
  // a Luma fica em silencio. Apenas atualiza o registro e sai.
  const { data: leadCheck } = await supabase
    .from('sdr_leads')
    .select('human_takeover')
    .eq('phone', cleanPhone)
    .maybeSingle();

  if (leadCheck?.human_takeover) {
    await supabase.from('sdr_leads').update({
      ultima_mensagem: text.slice(0, 300),
      ultimo_contato: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('phone', cleanPhone);
    return;
  }

  const session = await getSdrSession(cleanPhone);
  const nome = session.nome || senderName || null;

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: text.trim() },
  ];

  // Injeta opções de horário REAIS no contexto pra Luma ofertar agendamento concreto.
  const leadInfo = extractLeadInfo(messages);
  let systemPrompt = SDR_SYSTEM_PROMPT;

  const remoto = gerarHorariosRemoto();
  let ctxAgendamento = `\n\n# CONTEXTO DE AGENDAMENTO (use APENAS estes horários)\n` +
    `LIGAÇÃO ou MEET — disponibilidade ${remoto.titulo === 'hoje' ? 'HOJE' : `dia ${remoto.titulo}`}:\n` +
    `  ${remoto.horarios.join(', ')}\n` +
    `→ Quando o lead escolher ligação ou meet, LISTE TODOS esses horários numa bolha numerada e peça pra ele escolher.`;

  if (temVistoriaPresencial(leadInfo.cidade)) {
    const horariosVistoria = gerarOpcoesVistoria();
    const cidadeNorm = isUberlandiaCity(leadInfo.cidade) ? 'Uberlândia' : 'Araguari';
    const tecnico = isUberlandiaCity(leadInfo.cidade) ? 'Diego' : 'Thiago';
    ctxAgendamento += `\n\nVISTORIA PRESENCIAL (${cidadeNorm}, seg-sáb, 9h-17h, com ${tecnico}):\n` +
      `  ${horariosVistoria.join(' | ')}\n` +
      `→ Quando o lead escolher visita, ofereça 2 dessas opções. Mencione que ${tecnico} vai pessoalmente.`;
  }

  systemPrompt += ctxAgendamento;

  // Loop de tool calling — Luma pode chamar agendar_atendimento antes de responder
  const workingMessages: any[] = [...messages];
  let finalText = '';

  for (let turn = 0; turn < 4; turn++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: systemPrompt,
      tools: LUMA_TOOLS,
      messages: workingMessages.filter((m: any) => m.content),
    });

    if (response.stop_reason === 'tool_use') {
      workingMessages.push({ role: 'assistant', content: response.content });

      const toolResults: any[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result = '';
        if (block.name === 'descartar_lead') {
          const input = block.input as any;
          const motivo = String(input.motivo || 'sem motivo').slice(0, 200);
          // Anexa msg de despedida no histórico ANTES de deletar (audit)
          logger.info('luma-descartar', `lead ${cleanPhone} descartado: ${motivo}`);
          // Deleta sessão e lead
          await Promise.all([
            supabase.from('whatsapp_sessions').delete().eq('phone', cleanPhone).eq('tipo', 'sdr'),
            supabase.from('sdr_leads').delete().eq('phone', cleanPhone),
          ]);
          result = `Lead descartado permanentemente do CRM. Motivo logado: "${motivo}". Mande UMA despedida cordial curta (ex: "Tudo bem [Nome], fechado. Sucesso aí!") e encerra. NÃO marque [ESTAGIO] na resposta — o lead já foi excluído.`;
        } else if (block.name === 'agendar_atendimento') {
          const input = block.input as any;
          const canal = String(input.canal || '');
          const endereco = input.endereco ? String(input.endereco).trim() : undefined;

          // Vistoria precisa de endereço — se vier vazio, devolve erro pra IA pedir
          if (canal === 'vistoria' && (!endereco || endereco.length < 10)) {
            result = 'ERRO: vistoria requer endereço completo (rua, número, bairro, cidade). Pergunte o endereço completo pro cliente antes de chamar a tool de novo.';
          } else {
            const r = await criarCardAgendamento(
              cleanPhone,
              canal,
              String(input.horario || ''),
              input.observacoes ? String(input.observacoes) : undefined,
              instance,
              input.horario_iso ? String(input.horario_iso) : undefined,
              endereco,
            );
            result = r.ok
              ? 'Agendamento registrado e card enviado pra equipe. Confirma pro cliente que o consultor vai entrar em contato no horário combinado.'
              : `Falha ao enviar card (${r.reason || 'erro'}). Mesmo assim confirme o agendamento pro cliente — vou avisar a equipe manualmente.`;
          }
        } else {
          result = 'tool desconhecida';
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }
      workingMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b: any) => b.type === 'text') as any;
    finalText = textBlock?.text || '';
    break;
  }

  if (!finalText) {
    finalText = 'Tive um probleminha aqui pra te responder, me dá 1 minuto. [ESTAGIO:morno]';
  }

  const { text: cleanText, estagio } = extractEstagio(finalText);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts, instance);

  const updatedNome = nome || senderName || null;
  const allMessages = [...messages, { role: 'assistant' as const, content: cleanText }];

  // Marca lead como aguardando resposta para ativar follow-up
  // instance grava em qual linha o lead foi atendido (pra follow-up usar a linha certa)
  const leadUpsert: any = {
    phone: cleanPhone,
    aguardando_resposta: true,
    ultimo_contato: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (instance !== 'solardoc') leadUpsert.instance = instance;
  await supabase.from('sdr_leads').upsert(leadUpsert, { onConflict: 'phone' });

  // Salva sessão e CRM em paralelo
  await Promise.all([
    saveSdrSession(cleanPhone, allMessages, updatedNome),
    upsertCrmLead({
      phone: cleanPhone,
      nome: updatedNome,
      cidade: leadInfo.cidade,
      estagio,
      ultimaMensagem: text,
      totalMensagens: allMessages.filter(m => m.role === 'user').length,
      tracking
    }),
  ]);
}

// ─── polling Z-API (fallback quando webhook não dispara) ──────────

export async function pollZapiMessages(): Promise<{ processed: number }> {
  const INSTANCE = process.env.ZAPI_INSTANCE_ID?.trim();
  const TOKEN    = process.env.ZAPI_TOKEN?.trim();
  const CLIENT   = process.env.ZAPI_CLIENT_TOKEN?.trim();
  if (!INSTANCE || !TOKEN || !CLIENT) return { processed: 0 };

  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${INSTANCE}/token/${TOKEN}/chats?pageSize=30`,
      { headers: { 'Client-Token': CLIENT } },
    );
    if (!res.ok) return { processed: 0 };

    const data: any = await res.json();
    const chats: any[] = Array.isArray(data) ? data : (data.value ?? data.chats ?? []);

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    let processed = 0;

    for (const chat of chats) {
      if (chat.isGroup) continue;

      const lastMsg = chat.lastMessage ?? chat.lastInteraction;
      if (!lastMsg) continue;
      if (lastMsg.fromMe === true || lastMsg.fromMe === 'true') continue;

      // Z-API usa segundos ou milissegundos dependendo da versão
      const raw = lastMsg.momment ?? lastMsg.timestamp ?? lastMsg.time ?? 0;
      const msgTime = typeof raw === 'number'
        ? (raw > 1e12 ? raw : raw * 1000)
        : new Date(raw).getTime();

      if (!msgTime || msgTime < fiveMinAgo) continue;

      const phone = String(chat.phone ?? '').replace(/\D/g, '');
      if (!phone) continue;

      // Ignora se já processamos essa mensagem (sessão mais recente que a msg)
      const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('updated_at')
        .eq('phone', phone)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (session && new Date(session.updated_at).getTime() >= msgTime) continue;

      const text = lastMsg.body ?? lastMsg.text?.message ?? lastMsg.text ?? '';
      if (!text) continue;

      // Só processa SDR leads — usuários da plataforma são atendidos por outro agente
      const { data: platformUser } = await supabase
        .from('users')
        .select('id')
        .or(`whatsapp.eq.${phone},whatsapp.eq.55${phone}`)
        .maybeSingle();
      if (platformUser) continue;

      await handleSdrLead(phone, String(text), chat.name ?? lastMsg.senderName ?? null);
      processed++;
    }

    return { processed };
  } catch (err) {
    logger.error('sdr', 'pollZapiMessages falhou', err);
    return { processed: 0 };
  }
}

// ─── mensagem inicial para lead do simulador ──────────────────────

export async function initiateSdrConversation(
  phone: string,
  leadName: string,
  city: string,
  score: number,
): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');

  const openingContext = `O lead ${leadName} de ${city} completou o simulador solar com pontuação ${score}/32 e foi qualificado. Inicie a abordagem SDR de forma personalizada com esses dados — use o nome dele e mencione que ele acabou de usar o simulador.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: SDR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: openingContext }],
  });

  const raw = (response.content[0] as { text: string }).text;
  const parts = raw.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  await saveSdrSession(cleanPhone, [
    { role: 'user', content: openingContext },
    { role: 'assistant', content: raw },
  ], leadName);
}
