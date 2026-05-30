// Bateria de validação determinística do roteiro (0 IA, função pura, testável).
// Pega o JSON do roteirizador e checa contra as regras anti-robô.
//
// DOIS TIERS (decisão do advisor — evitar rejeitar roteiro bom):
//  - HARD-FAIL: regras mecânicas inequívocas. Reprovam e disparam regeneração.
//  - WARNING:   heurísticas estilísticas. Só LOGAM (não reprovam) até calibrar
//               contra output real — várias dão falso-positivo em texto humano
//               legítimo (ex: "que" no PT; gancho fernando sem oralidade).

interface Fala { quem: string; texto: string; }
export interface FalhaBateria { regra: string; tier: 'hard' | 'warn'; fala_idx: number; trecho: string; }
export interface ResultadoBateria {
  passou: boolean;            // true se NENHUM hard-fail
  hardFails: FalhaBateria[];
  warnings: FalhaBateria[];
  relatorio: string;          // resumo pro crítico não recontar
}

const nPalavras = (s: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;

// blocklists
const CONECTIVO_FORMAL = /\b(portanto|dessa forma|sendo assim|ademais|outrossim|conforme|uma vez que|tendo em vista|nesse sentido|por conseguinte)\b/i;
// NÃO incluir "te"/"TE" (pronome comum "te mando") nem "kwh" (aparece em fala legítima);
// só jargão técnico inequívoco que o público leigo não usa.
const JARGAO = /\b(kwp|on-grid|off-grid|inversor|tusd|compensação de energia|geração distribuída|fotovoltaic\w*|string box|microinversor)\b/i;
const SAUDACAO = /\b(oi|olá|ola|fala galera|fala pessoal|e aí|eai|bom dia|boa tarde|boa noite|pessoal)\b/i;
const GANCHO_PROIBIDO = /\b(hoje (eu )?(vim|vou)|vou (te )?(mostrar|falar)|vim falar|irmãos na obra)\b/i;
const MARCADOR_DIRECAO = /\[[^\]]*\]|\b\d+\s*-\s*\d+\s*s\b/;  // [pausa], [0-3s] dentro da fala
const NUMERO_SIMBOLO = /R\$|%|\b\d{1,3}[.,]\d|\b\d{3,}\b/;    // R$, %, 1.200, 1234
const ORALIDADE = /\b(tá|cê|ocê|pra|pro|né|tipo assim|ó|aí|daí|sô|tô|cabô|uai)\b/i;

export function rodarBateria(falas: Fala[], gancho: string, palavrasAlvo: number): ResultadoBateria {
  const hard: FalhaBateria[] = [];
  const warn: FalhaBateria[] = [];
  const f = falas || [];

  // ── HARD-FAIL (mecânicos inequívocos) ──
  // 1. marcador de direção dentro da fala (CRÍTICO HeyGen — voz leria "colchete")
  f.forEach((x, i) => { if (MARCADOR_DIRECAO.test(x.texto || '')) hard.push({ regra: 'marcador_na_fala', tier: 'hard', fala_idx: i, trecho: x.texto }); });
  // 2. número com símbolo dentro da fala (voz lê errado)
  f.forEach((x, i) => { if (NUMERO_SIMBOLO.test(x.texto || '')) hard.push({ regra: 'numero_simbolo', tier: 'hard', fala_idx: i, trecho: x.texto }); });
  // 3. conectivo formal de redação
  f.forEach((x, i) => { if (CONECTIVO_FORMAL.test(x.texto || '')) hard.push({ regra: 'conectivo_formal', tier: 'hard', fala_idx: i, trecho: x.texto }); });
  // 4. jargão técnico sem tradução
  f.forEach((x, i) => { if (JARGAO.test(x.texto || '')) hard.push({ regra: 'jargao', tier: 'hard', fala_idx: i, trecho: x.texto }); });
  // 5. gancho: saudação / proibido / >12 palavras
  if (SAUDACAO.test(gancho) || GANCHO_PROIBIDO.test(gancho) || nPalavras(gancho) > 12) {
    hard.push({ regra: 'gancho', tier: 'hard', fala_idx: -1, trecho: gancho });
  }
  // 6. minutagem ±12%
  // banda ±18%: Reel não precisa de minutagem cirúrgica e ±12% fazia o regen
  // não convergir (a IA escreve naturalmente mais enxuto que o alvo teórico).
  const palGer = f.reduce((s, x) => s + nPalavras(x.texto), 0);
  const desvio = palavrasAlvo > 0 ? Math.abs(palGer - palavrasAlvo) / palavrasAlvo : 0;
  if (desvio > 0.18) hard.push({ regra: 'minutagem', tier: 'hard', fala_idx: -1, trecho: `${palGer} palavras, alvo ${palavrasAlvo} (${(desvio * 100).toFixed(0)}% fora)` });

  // ── WARNINGS (estilísticos — só logam até calibrar) ──
  // frase longa (>14 palavras)
  f.forEach((x, i) => { if (nPalavras(x.texto) > 14) warn.push({ regra: 'frase_longa', tier: 'warn', fala_idx: i, trecho: x.texto }); });
  // subordinação (vírgulas + "que" > 2) — heurística frágil no PT, fica warn
  f.forEach((x, i) => {
    const v = (x.texto.match(/,/g) || []).length;
    const q = (x.texto.match(/\bque\b/gi) || []).length;
    if (v + q > 3) warn.push({ regra: 'subordinacao', tier: 'warn', fala_idx: i, trecho: x.texto });
  });
  // oralidade zero no roteiro inteiro (não por bloco — menos agressivo)
  const temOralidade = f.some(x => ORALIDADE.test(x.texto || ''));
  if (f.length >= 3 && !temOralidade) warn.push({ regra: 'oralidade', tier: 'warn', fala_idx: -1, trecho: '(nenhuma marca de oralidade no roteiro)' });
  // simetria robótica (desvio-padrão dos tamanhos quase zero)
  if (f.length >= 4) {
    const ts = f.map(x => nPalavras(x.texto));
    const media = ts.reduce((a, b) => a + b, 0) / ts.length;
    const dp = Math.sqrt(ts.reduce((a, b) => a + (b - media) ** 2, 0) / ts.length);
    if (dp < 1.5) warn.push({ regra: 'simetria', tier: 'warn', fala_idx: -1, trecho: `desvio-padrão ${dp.toFixed(1)} (falas muito uniformes)` });
  }

  const relatorio = `bateria: ${hard.length ? 'REPROVOU' : 'passou'} | hard-fails: ${hard.map(h => h.regra).join(',') || 'nenhum'} | warnings: ${warn.map(w => w.regra).join(',') || 'nenhum'} | minutagem ${palGer}/${palavrasAlvo}`;
  return { passou: hard.length === 0, hardFails: hard, warnings: warn, relatorio };
}

// instruções cirúrgicas pra regeneração, a partir dos hard-fails
export function montaFeedback(falhas: FalhaBateria[], palavrasAlvo: number): string {
  const linhas = falhas.map(h => {
    switch (h.regra) {
      case 'marcador_na_fala': return `- A fala "${h.trecho.slice(0, 50)}..." tem marcação de direção ([..]) DENTRO do texto falado. Tire — direção vai só no campo "roteiro".`;
      case 'numero_simbolo': return `- A fala "${h.trecho.slice(0, 50)}..." tem número com símbolo (R$/%/dígitos). Escreva por extenso ("uns oitocentos", "metade da conta").`;
      case 'conectivo_formal': return `- A fala "${h.trecho.slice(0, 50)}..." usa conectivo de redação (portanto/dessa forma...). Troque por "aí/então/só que".`;
      case 'jargao': return `- A fala "${h.trecho.slice(0, 50)}..." tem jargão técnico. Traduza pra linguagem de dono de casa.`;
      case 'gancho': return `- O gancho "${h.trecho}" viola a regra (saudação, ou >12 palavras, ou cita a empresa). Reescreva curto, com tensão, sem saudação.`;
      case 'minutagem': return `- Minutagem fora do alvo: ${h.trecho}. Ajuste o total de palavras pra ~${palavrasAlvo} (encurte/alongue as falas mais longas).`;
      default: return `- Corrigir ${h.regra}: ${h.trecho.slice(0, 50)}`;
    }
  });
  return `O roteiro anterior REPROVOU nestes pontos — corrija TODOS mantendo a qualidade:\n${linhas.join('\n')}`;
}
