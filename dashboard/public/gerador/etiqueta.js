// ─────────────────────────────────────────────────────────────────────────────
// ETIQUETA DE ORIGEM DO LEAD — usada pelo CRM (/gerador) e pela Agenda.
//
// ESPELHO de api/src/services/agenda/origemEtiqueta.ts (o mesmo cálculo que a
// aba "Leads por Origem" do admin faz). Mudou lá → muda aqui. As duas telas do
// gerador carregam ESTE arquivo, então a regra do front tem uma cópia só.
//
// A etiqueta é DERIVADA na hora de mostrar, não gravada no lead: quando a regra
// é corrigida (já aconteceu — a LP lp_solar estava como Organic e é Tráfego),
// TODO card antigo se acerta sozinho, sem reprocessar nada.
//
// REGRA DO THIAGO: fonte nova gera etiqueta nova sozinha. Por isso um created_by
// desconhecido vira a PRÓPRIA etiqueta (title-case) em vez de cair num "Outros" —
// ninguém precisa mexer em código quando surge um público novo.
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_MAPA = {
  'lead-meta': 'Solar Tráfego',
  'leads-meta': 'Solar Tráfego',
  'lp_solar': 'Solar Tráfego',          // LP io/solar tem pixel → é anúncio
  'manychat': 'Solar Organic',          // form /simular (link da DM do Instagram)
  'lp_eletroposto': 'EP Tráfego',
  'ep-trafego': 'EP Tráfego',
  'manychat_eletroposto': 'EP Organic',
  'ep-organic': 'EP Organic',
  // Prospecção ATIVA (lista fria trabalhada 1 a 1 no /gerador/prospeccao). Não é
  // anúncio nem automação: o consultor foi atrás. O created_by carrega a palavra
  // "eletroposto" de propósito — crmEhEletroposto() casa por ela, então o card
  // ganha o fluxo de EP sem precisar de lista nova em lugar nenhum.
  'prosp_eletroposto': 'EP Prospec',
  'prosp_solar': 'Solar Prospec',
  'crm-bulk': 'Import',
  'import': 'Import',
  'indicacao': 'Indicado',
};

// ?src que marca canal ORGÂNICO. O mesmo intake pode servir os dois canais (a LP
// do eletroposto recebe anúncio E o link da automação do IG) — o src separa.
const ETIQUETA_SRC_ORGANIC = ['ig', 'instagram', 'organico', 'organic', 'dm'];

// Quem conta como cadastro "Manual". No backend isso sai da tabela `consultores`;
// aqui é a mesma lista que as duas telas já usam pra montar seus filtros.
const ETIQUETA_CONSULTORES = ['diego', 'giovanna', 'nilce', 'thiago'];

// Cor da etiqueta: eletroposto = família VERDE, solar = família LARANJA, o resto
// (Import/Manual/Indicado) = pill neutra. Casa pelo TEXTO da etiqueta, não por
// uma lista de fontes — assim uma fonte nova que nasça "EP Alguma Coisa" ou
// "Solar Alguma Coisa" já sai colorida sozinha.
//
// Dentro da família, cada CANAL tem o seu tom (ordem do Thiago, 06/08/2026):
// EP Tráfego, EP Organic e EP Prospec são três verdes diferentes; o mesmo vale
// pro laranja do solar. Bater o olho no quadro e saber de onde o lead veio é o
// ponto — antes os três verdes eram o mesmo verde.
//
// Devolve o sufixo da classe: 'ep-trafego', 'solar-prospec'… Canal novo que a
// família reconheça mas o mapa abaixo não cai no tom BASE ('ep' / 'solar'):
// sai colorido do jeito certo, só sem tom próprio até alguém dar um.
function etiquetaCor(etiqueta) {
  const e = String(etiqueta == null ? '' : etiqueta).toLowerCase();
  if (!e) return '';
  const familia = (/eletroposto/.test(e) || /(^|\s)ep(\s|$)/.test(e)) ? 'ep'
                : /solar/.test(e) ? 'solar'
                : '';
  if (!familia) return '';
  if (/tr[áa]fego/.test(e)) return familia + '-trafego';
  if (/organic/.test(e))    return familia + '-organic';
  if (/prosp/.test(e))      return familia + '-prospec';
  return familia;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE DE OCUPAÇÃO DA AGENDA — quem divide quadro com quem.
//
// Ordem do Thiago (06/08/2026): "quando solar cair no mesmo horário não tem
// problema dividir quadro". Um horário do consultor comporta DUAS reuniões: uma
// de solar (ligação curta) e uma de qualquer outra coisa (o vídeo do
// eletroposto, por exemplo). Duas do MESMO tipo continuam proibidas.
//
// ESPELHO do banco: os índices agendamentos_vq_solar_uniq e
// agendamentos_vq_naosolar_uniq (MIGRATION_agenda_quadro_dividido.sql) usam
// exatamente esta lista. Mudou aqui → muda lá, senão a tela oferece um horário
// que o banco recusa. Origem desconhecida cai em "não-solar", que é o lado
// seguro (não divide, recusa a segunda).
var ETIQUETA_ORIGENS_SOLAR = ['lead-meta', 'leads-meta', 'lp_solar', 'manychat', 'prosp_solar'];
function origemEhSolar(createdBy) {
  return ETIQUETA_ORIGENS_SOLAR.indexOf(String(createdBy == null ? '' : createdBy).trim()) >= 0;
}

function etiquetaDeLead(createdBy, src) {
  const cb = String(createdBy == null ? '' : createdBy).trim().toLowerCase();
  const s  = String(src == null ? '' : src).trim().toLowerCase();

  // Vazio ou nome de consultor → cadastro na mão.
  if (!cb) return 'Manual';
  if (ETIQUETA_CONSULTORES.indexOf(cb) >= 0) return 'Manual';

  // O src organic flipa o canal ANTES do mapa fixo (mesmo intake, dois canais).
  if (ETIQUETA_SRC_ORGANIC.indexOf(s) >= 0) {
    if (cb.includes('eletroposto') || cb.indexOf('ep') === 0) return 'EP Organic';
    if (cb.includes('solar') || cb === 'lead-meta' || cb === 'manychat') return 'Solar Organic';
  }

  if (ETIQUETA_MAPA[cb]) return ETIQUETA_MAPA[cb];

  // Fonte nova → etiqueta nova, auto-gerada.
  return cb.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }).join(' ');
}
