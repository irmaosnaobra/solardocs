// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, VENDAS FINALIZADAS (05/11/2026): o bloco "Dados da planilha" de uma obra finalizada. PURO (sem banco e sem relógio).
//
// A visibilidade é EXATAMENTE a da Planilha de clientes (`GET /solar/obras`): quem não pode ver a linha (`podeVer`: sócio, ou consultor da venda,
// pela coluna CONSULTOR já com a troca da Gestão de clientes) não recebe o bloco; o dinheiro (valor vendido, forma de pagamento, recebido, a receber)
// só vai para sócio, e para os outros a chave nem existe; o texto cru da origem do lead é só de sócio. Campo vazio não aparece. A planilha só é
// LIDA aqui: nada se grava.
// ─────────────────────────────────────────────────────────────────────────────
import { ehSocio, parseDataBR, podeVer, type ObraBruta, type ObraMontada } from './solarObras';

export interface CampoPlanilha { chave: string; rotulo: string; valor: string }
export interface DadosDaPlanilha { codigo: string; campos: CampoPlanilha[] }

const dataBR = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const reais = (n: number): string => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (s: string | undefined): number | null => {
  const t = String(s ?? '').trim().replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const n = Number(t);
  return t && Number.isFinite(n) && n > 0 ? n : null;
};

const ROTULO_ORIGEM: Record<ObraMontada['origem']['tipo'], string> = { trafego: 'Tráfego', indicacao: 'Indicação', recorrente: 'Cliente recorrente', outro: 'Outro' };
const ROTULO_DEPOIMENTO: Record<NonNullable<ObraMontada['depoimento']>, string> = { sim: 'Feito', pedido: 'Pedido', insatisfeito: 'Cliente insatisfeito', nao_faz: 'Não faz' };

/**
 * `bruta` é a linha da planilha já com a troca de consultor da Gestão de clientes; `m` é o `montarObra` dela. Devolve `null` quando `nome` não pode
 * ver a linha. O `kWp` sai de placas x potência da placa, só quando as duas colunas têm número.
 */
export function dadosDaPlanilha(bruta: ObraBruta, m: ObraMontada, nome: string): DadosDaPlanilha | null {
  if (!podeVer(nome, m.consultor)) return null;
  const socio = ehSocio(nome);
  const campos: CampoPlanilha[] = [];
  const poe = (chave: string, rotulo: string, valor: string | null | undefined): void => {
    const v = String(valor ?? '').trim();
    if (v) campos.push({ chave, rotulo, valor: v });
  };
  const etapa = (c: string) => m.etapas.find((e) => e.chave === c);

  if (socio) {
    poe('valor_vendido', 'Valor vendido', m.valores.venda > 0 ? reais(m.valores.venda) : '');
    poe('forma_pagamento', 'Forma de pagamento', bruta.formaPagto);
    poe('recebido', 'Recebido', m.valores.recebido > 0 ? reais(m.valores.recebido) : '');
    poe('a_receber', 'A receber', m.valores.aReceber > 0 ? reais(m.valores.aReceber) : '');
  }
  poe('recebimento', 'Recebimento', m.recebimento === 'quitado' ? 'Quitado' : m.recebimento === 'nao_quitado' ? 'Não quitado' : '');
  poe('nome_homologacao', 'Nome na homologação', m.homologacao && m.homologacao !== m.cliente ? m.homologacao : '');
  poe('consultor', 'Consultor', m.consultor);
  poe('telefone', 'Telefone', m.telefone);
  poe('endereco', 'Endereço', m.endereco);
  poe('cidade', 'Cidade', [m.cidade, m.uf].filter(Boolean).join(' - '));
  poe('concessionaria', 'Concessionária', m.concessionaria);

  const placas = m.sistema.placas;
  const pot = numero(bruta.potPlaca);
  poe('placas', 'Placas', placas ? `${placas}${m.sistema.modeloPlaca ? ` x ${m.sistema.modeloPlaca}` : ''}${pot ? ` (${pot} W)` : ''}` : m.sistema.modeloPlaca);
  if (placas && pot) poe('kwp', 'Potência', `${(Math.round(placas * pot / 10) / 100).toLocaleString('pt-BR')} kWp`);
  poe('inversor', 'Inversor', m.sistema.inversores ? `${m.sistema.inversores}${m.sistema.inversor ? ` x ${m.sistema.inversor}` : ''}` : m.sistema.inversor);
  poe('estrutura', 'Estrutura', m.sistema.estrutura);

  poe('data_venda', 'Data da venda', dataBR(m.vendaEm));
  poe('homologacao', 'Parecer de acesso (homologação)', dataBR(etapa('projeto')?.em));
  poe('material', 'Entrega do material', dataBR(etapa('material')?.em));
  const inicio = dataBR(parseDataBR(bruta.inicioInstalacao));
  const fim = dataBR(etapa('instalacao')?.em);
  poe('instalacao', 'Instalação', inicio && fim ? `${inicio} a ${fim}` : fim || inicio);
  poe('pedido_vistoria', 'Pedido de vistoria', dataBR(parseDataBR(bruta.pedidoVistoria)));
  poe('liberacao', 'Liberação da vistoria', dataBR(etapa('vistoria')?.em));
  poe('liberado', 'Sistema liberado pela concessionária', etapa('liberado')?.feito ? 'Sim' : '');
  poe('engenheiro', 'Engenheiro', m.engenheiro);
  poe('equipe', 'Equipe', m.equipe);
  poe('origem', 'Origem do lead', socio && m.origem.texto ? m.origem.texto : ROTULO_ORIGEM[m.origem.tipo]);
  poe('depoimento', 'Depoimento', m.depoimento ? ROTULO_DEPOIMENTO[m.depoimento] : '');
  return { codigo: m.codigo, campos };
}
