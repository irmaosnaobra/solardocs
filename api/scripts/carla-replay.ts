// ─────────────────────────────────────────────────────────────────────────────
// REPLAY DA CARLA, o cérebro novo contra as conversas que o antigo perdeu.
//
// Por que existe: até aqui a única forma de saber se a agente melhorou era
// expor lead de verdade. Isso custa caro duas vezes, porque lead novo do
// SolarDoc entra a ~5 por dia e cada conversa queimada é irreversível.
//
// O que ele faz: pega as falas REAIS do lead de uma conversa gravada, na ordem
// em que ele as escreveu, e devolve o que a Carla de HOJE responderia em cada
// turno. Não é simulação de lead, é replay: o lado humano é literal, só a
// vendedora muda. O que se compara é a resposta dela contra a que ela deu na
// vida real, no mesmo ponto da conversa.
//
// Limite honesto que este harness NÃO resolve: o lead real reagiria diferente a
// uma resposta diferente. Do turno 2 em diante a conversa replicada é
// contrafactual, porque ele está respondendo a coisas que ela não disse. Serve
// pra ver se ela mostra a folha, se fala o preço, se para de repetir pergunta.
// Não serve pra estimar taxa de fechamento.
//
// Uso:  npx ts-node --transpile-only scripts/carla-replay.ts <telefone> [maxTurnos]
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { blocoDeAcoes, parseAcoesCarla, BOLHAS_CARLA } from '../src/services/agents/sdr/carlaAcoes';
import { emBolhas } from '../src/services/agents/bolhas';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// As conversas vêm de um JSON exportado, não do banco: a chave do .env local é
// legacy e o Supabase já as desabilitou ("Legacy API keys are disabled"). Só a
// produção tem chave nova. Ler de arquivo também deixa o replay determinístico.
const CONVERSAS = 'C:/Users/55349/AppData/Local/Temp/claude/c--Users-55349-Desktop-CLAUDE/4fb841c7-5a3d-43f9-bf4f-2e059d8028b0/scratchpad/conversas.json';

const APP_URL = 'https://solardoc.app';

// O mesmo contrato que o runtime anexa. Copiado e não importado de propósito:
// sdrB2bAgentService faz efeito colateral no import (cliente Anthropic, cron),
// e o replay tem que ser inerte.
const CONTRATO = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONTRATO DO CANAL (sistema)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. BOLHAS: separe cada bolha com || (duas barras). No máximo 3 bolhas por resposta.
2. ESTÁGIO: termine SEMPRE com [ESTAGIO:novo|frio|morno|quente|fechado|perdido].
3. LINK: o checkout é ${APP_URL}. Nunca invente outra URL.
4. Suas tools: verificar_status_plataforma e registrar_chamado.
5. Você NÃO confirma pagamento, NÃO dá desconto, NÃO digita chave de Pix à mão.
`;

async function main() {
  const phone = process.argv[2];
  const maxTurnos = Number(process.argv[3] || 12);
  if (!phone) throw new Error('uso: carla-replay.ts <telefone> [maxTurnos]');

  const promptPath = process.argv[4]
    || 'C:/Users/55349/AppData/Local/Temp/claude/c--Users-55349-Desktop-CLAUDE/4fb841c7-5a3d-43f9-bf4f-2e059d8028b0/scratchpad/prompt-v2.txt';
  const cerebro = fs.readFileSync(path.resolve(promptPath), 'utf8') + CONTRATO + blocoDeAcoes();

  const todas = JSON.parse(fs.readFileSync(CONVERSAS, 'utf8')) as
    { phone: string; nome: string; falas: string[] }[];
  const data = todas.find((c) => c.phone === phone);
  if (!data) throw new Error(`conversa ${phone} não está no pacote`);
  const falasDoLead = data.falas;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`REPLAY  ${data.nome || phone}  (${falasDoLead.length} falas do lead)`);
  console.log('='.repeat(70));

  const historico: Anthropic.MessageParam[] = [];
  let imagens = 0, pixes = 0, precoNoTurno = 0, linkNoTurno = 0;

  for (let i = 0; i < Math.min(falasDoLead.length, maxTurnos); i++) {
    const fala = falasDoLead[i]!;
    historico.push({ role: 'user', content: fala });
    console.log(`\n[lead] ${fala.slice(0, 220)}`);

    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: [{ type: 'text', text: cerebro, cache_control: { type: 'ephemeral' } }],
      messages: historico,
    });
    const bruto = (r.content.find((b) => b.type === 'text') as any)?.text || '';
    historico.push({ role: 'assistant', content: bruto });

    const semEstagio = bruto.replace(/\[ESTAGIO:[^\]]*\]/gi, '').trim();
    const acoes = parseAcoesCarla(semEstagio);
    const bolhas = emBolhas(acoes.limpo, { max: BOLHAS_CARLA.max, maxBolhas: BOLHAS_CARLA.maxBolhas });

    bolhas.forEach((b) => console.log(`  [carla] ${b}`));
    if (acoes.imagem) { imagens++; console.log(`  [ANEXA IMAGEM] ${acoes.imagem}`); }
    if (acoes.pix) { pixes++; console.log('  [ENVIA PIX R$67]'); }
    if (!precoNoTurno && /R\$ ?67|67 por mês|67 reais/i.test(acoes.limpo)) precoNoTurno = i + 1;
    if (!linkNoTurno && /solardoc\.app/i.test(acoes.limpo)) linkNoTurno = i + 1;
    if (bolhas.length > 3) console.log(`  ⚠ ${bolhas.length} bolhas (teto é 3)`);
    if (/—/.test(acoes.limpo)) console.log('  ⚠ TRAVESSÃO na resposta');
  }

  console.log(`\n${'-'.repeat(70)}`);
  console.log(`PLACAR  preço no turno ${precoNoTurno || '—'} · link no turno ${linkNoTurno || 'nunca'}`
    + ` · ${imagens} imagem(ns) · ${pixes} pix`);
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
