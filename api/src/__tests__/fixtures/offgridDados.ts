// Dados FIXOS (fictícios) do off-grid: servem ao teste byte a byte do modelo 1 e aos testes do modelo 2.
// Os números imitam o que o motor do front (dashboard/src/lib/offgrid/engine.ts) devolve.
export const empresaOffGrid: any = {
  nome: 'Sol Forte Energia Ltda', nome_fantasia: 'Sol Forte Energia', cnpj: '11222333000181',
  endereco: 'Av. João Naves de Ávila, 1000, Uberlândia-MG', cidade: 'Uberlândia', uf: 'MG', socio_adm: 'Carlos Pereira',
  whatsapp: '34999990000', email: 'contato@solforte.example', cor_marca: '#0B3D2E', cor_secundaria: '#F7B500',
};

export const clienteOffGrid: any = { nome: 'Maria Aparecida Souza', cidade: 'Araguari', uf: 'MG' };

export const dadosOffGrid: Record<string, unknown> = {
  cidade: 'Araguari', uf: 'MG',
  consumo_dia: 9.4, consumo_essencial_dia: 7.1, consumo_mes: 282,
  dias_pedidos: 2, autonomia_sobre: 'essencial',
  aut_essencial_dias: 2.1, aut_tudo_dias: 1.6, aut_chuva_dias: 4.3, aut_chuva_infinita: false,
  aut_recarga_dias: 1.4, geracao_dia_fechado: 2.2,
  kwp: 4.4, qtd_modulos: 8, area_m2: 20.8,
  banco_kwh: 15.36, banco_utilizavel: 12.29, banco_reserva: 3.07, qtd_baterias: 3,
  bateria_nome: 'Bateria lítio 48V 100Ah (5,12 kWh)', bateria_garantia: 5,
  inversor_nome: 'Inversor híbrido 5 kW', inversor_kw: 5, inversor_saida: '220V', tensao: 48,
  hsp_anual: 5.3, hsp_pior: 4.4, criterio_hsp: 'pior',
  arranjo_serie: 4, arranjo_paralelo: 2, arranjo_voc_frio: 207, arranjo_vmp_quente: 142, arranjo_corrente: 26, arranjo_ok: true,
  ciclos_dia: 0.6, sombra: 'nenhuma', geracao_dia_pior: 16.2, geracao_mes_media: 590,
  itens_cliente: [
    { nome: 'Módulo fotovoltaico 550 W', qtd: 8, garantia: 12 },
    { nome: 'Inversor híbrido 5 kW 48V', qtd: 1, garantia: 5 },
    { nome: 'Bateria de lítio 48V 100Ah', qtd: 3, garantia: 5 },
    { nome: 'Estrutura de fixação do arranjo', qtd: 1 },
    { nome: 'String box CC, DPS e cabos solares', qtd: 1 },
  ],
  investimento: 78900, prazo_entrega: '20 dias úteis', validade_dias: 7,
  parcela_cartao: '12x de R$ 7.142 no cartão', parcela_financiamento: 'ou 60x de R$ 2.020 no financiamento',
  comp_anos: 10, comp_distancia_m: 800,
  comp_opcoes: [
    { id: 'rede', nome: 'Puxar a rede (800 m)', entrada: 96000, mensal: 310, total: 175200, porKwh: 1.71, linhas: [{ rotulo: 'Obra da rede', valor: 96000 }, { rotulo: 'Conta de luz em 10 anos', valor: 79200 }], observacao: 'Valores da concessionária podem variar.' },
    { id: 'diesel', nome: 'Gerador a diesel', entrada: 18000, mensal: 1150, total: 156000, porKwh: 1.52, linhas: [{ rotulo: 'Gerador', valor: 18000 }, { rotulo: 'Combustível e revisão', valor: 138000 }], observacao: 'Considera 4 horas por dia de funcionamento.' },
    { id: 'offgrid', nome: 'Sistema off-grid', entrada: 78900, mensal: 90, total: 89700, porKwh: 0.87, linhas: [{ rotulo: 'Sistema instalado', valor: 78900 }, { rotulo: 'Manutenção em 10 anos', valor: 10800 }], observacao: 'Sem conta de luz e sem combustível.' },
  ],
  comp_economia_rede: 85500, comp_economia_diesel: 66300, comp_equilibrio_m: 410, comp_vence_na_porta: false,
  comp_payback_diesel: 74, comp_vencedor: 'offgrid',
};
