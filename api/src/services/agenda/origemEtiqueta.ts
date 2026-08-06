// ─────────────────────────────────────────────────────────────────────────────
// Etiqueta de ORIGEM do lead — deriva de `created_by` (+ `src`) do agendamento.
//
// REGRA EXPLÍCITA DO DONO: toda vez que criarmos um público/fonte novo, ele tem
// que GERAR uma etiqueta nova e o dashboard ATUALIZAR SOZINHO. Por isso a
// derivação é DINÂMICA: created_by conhecido cai no mapa abaixo; created_by
// desconhecido (que não é consultor nem vazio) vira a PRÓPRIA etiqueta
// (title-case). Assim um intake novo aparece no gráfico sem ninguém mexer aqui.
//
// Duas dimensões: PRODUTO (Solar | EP/Eletroposto) × CANAL (Tráfego = anúncio
// pago no Meta | Organic = automação do Instagram: comentário→DM→form/LP).
// Fora do produto×canal: Import (planilha/CRM antigo), Indicado (indicação),
// Manual (cadastro na mão pelo consultor).
// ─────────────────────────────────────────────────────────────────────────────

const norm = (v: unknown): string => (v ?? '').toString().trim().toLowerCase();

/**
 * O lead é de ELETROPOSTO? Casa pela palavra no `created_by`, não por lista —
 * é a mesma regra do repasse no banco (processar_repasses: `like '%eletroposto%'`)
 * e do CRM/Agenda no front (crmEhEletroposto / ehCardEletroposto).
 *
 * Por que família e não lista: as origens de EP já são três (lp_eletroposto,
 * manychat_eletroposto, prosp_eletroposto) e uma quarta nasce a cada canal novo.
 * Toda lista fixa que alguém esquecer de atualizar vira o mesmo buraco: a ficha
 * aparece na agenda com a etiqueta certa e fica FORA do fluxo do produto. Foi
 * exatamente o que aconteceu com a prospecção — reunião de eletroposto marcada,
 * e nenhum aviso de confirmação saiu porque o slug não estava na lista.
 */
export function ehOrigemEletroposto(createdBy: unknown): boolean {
  return norm(createdBy).includes('eletroposto');
}

// created_by que já sabemos mapear. Os dois intakes de solar pago (Meta Lead Ads
// = `lead-meta`, e a LP com pixel = `lp_solar`) contam como Solar Tráfego.
const MAPA: Record<string, string> = {
  'lead-meta': 'Solar Tráfego',
  'leads-meta': 'Solar Tráfego',
  'lp_solar': 'Solar Tráfego',
  'manychat': 'Solar Organic',        // form /simular (link da DM do Instagram)
  'lp_eletroposto': 'EP Tráfego',     // LP/"site de agendamento" do eletroposto (anúncio)
  'ep-trafego': 'EP Tráfego',
  'manychat_eletroposto': 'EP Organic',
  'ep-organic': 'EP Organic',
  // Prospecção ATIVA — lista fria trabalhada 1 a 1 na tela /gerador/prospeccao.
  // Terceiro canal, ao lado de Tráfego e Organic: ninguém levantou a mão, o
  // consultor foi atrás. `prosp_eletroposto` guarda a palavra "eletroposto" de
  // propósito: o CRM casa card de EP por ela.
  'prosp_eletroposto': 'EP Prospec',
  'prosp_solar': 'Solar Prospec',
  'crm-bulk': 'Import',
  'import': 'Import',
  'indicacao': 'Indicado',
};

// Valores de ?src que marcam canal ORGÂNICO (veio da automação do IG). Quando o
// MESMO intake serve tráfego e organic (ex.: a LP do eletroposto recebe anúncio
// E o link da automação), o ?src=ig separa: sem src = tráfego; com src=ig = organic.
const SRC_ORGANIC = new Set(['ig', 'instagram', 'organico', 'organic', 'dm']);

function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Deriva a etiqueta de origem de UM lead.
 * @param createdBy  agendamentos.created_by
 * @param src        agendamentos.src (marcador de canal, tipo UTM; pode ser null)
 * @param consultores nomes de consultor (lower-case) que contam como "Manual"
 */
export function etiquetaDeLead(
  createdBy: unknown,
  src: unknown,
  consultores: Set<string>,
): string {
  const cb = norm(createdBy);
  const s = norm(src);

  // Vazio ou nome de consultor → cadastro manual.
  if (!cb) return 'Manual';
  if (consultores.has(cb)) return 'Manual';

  // Canal orgânico marcado via ?src flipa o PRODUTO pra Organic (mesmo intake
  // que serve os dois canais). Roda antes do mapa fixo de propósito.
  if (SRC_ORGANIC.has(s)) {
    if (cb.includes('eletroposto') || cb.startsWith('ep')) return 'EP Organic';
    if (cb.includes('solar') || cb === 'lead-meta' || cb === 'manychat') return 'Solar Organic';
  }

  const conhecida = MAPA[cb];
  if (conhecida) return conhecida;

  // Público novo/desconhecido → vira a própria etiqueta (auto-gerada). É ISTO que
  // garante "público novo = etiqueta nova, sem mexer no código".
  return titleCase(cb);
}

// Ordem estável das etiquetas base (define ordem de empilhamento e cor no gráfico).
// Etiquetas desconhecidas/novas entram depois destas, em ordem alfabética.
export const ETIQUETAS_ORDEM: string[] = [
  // Agrupado por PRODUTO e, dentro dele, por canal (tráfego → organic → prospecção).
  // É a mesma leitura das cores: cada produto é uma família, cada canal um tom.
  'Solar Tráfego',
  'Solar Organic',
  'Solar Prospec',
  'EP Tráfego',
  'EP Organic',
  'EP Prospec',
  'Indicado',
  'Import',
  'Manual',
];
