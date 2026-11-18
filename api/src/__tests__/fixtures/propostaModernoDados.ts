// Dados FIXOS (fictícios) do Moderno (propostaSolar, modelos 2 e 3). Nenhum dado de cliente real.
// Os quatro cenários cobrem o que o Moderno precisa aguentar sem campo vazio nem folha estourada:
// completa com bateria e financiamento, só à vista, dados mínimos e sistema grande.
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

export const empresaModerno: any = {
  nome: 'Sol Forte Energia Ltda', nome_fantasia: 'Sol Forte Energia', cnpj: '11222333000181',
  endereco: 'Av. João Naves de Ávila, 1000, Uberlândia-MG', cidade: 'Uberlândia', uf: 'MG', socio_adm: 'Carlos Pereira',
  whatsapp: '34999990000', email: 'contato@solforte.example', cor_marca: '#1E3A8A', cor_secundaria: '#F7B500',
};
export const empresaModernoVerde: any = { ...empresaModerno, cor_marca: '#0F766E', whatsapp: '' };

export interface CenarioModerno { nome: string; empresa: any; cliente: any; campos: Record<string, unknown> }

const base: Record<string, unknown> = {
  emitido_em: '2026-11-18T15:00:00.000Z', cidade: 'Araguari', uf: 'MG', consumo_kwh: '650',
  qtd_modulos: '12', potencia_modulo: '590', marca_modulo: 'Canadian Solar', marca_inversor: 'Growatt',
  potencia_inversor: '6', garantia_inversor: '10', investimento: '29.900,00', codigo: '202611180001',
  tarifa_kwh: '1,05', taxa_minima: '95',
};

export const cenariosModerno: CenarioModerno[] = [
  {
    // (a) Completa: cliente com CPF, e-mail e telefone; bateria; foto; à vista com desconto, cartão, financiamento,
    // entrada e garantias extras; assinatura preenchida.
    nome: 'completa-bateria', empresa: empresaModerno,
    cliente: {
      nome: 'Maria Aparecida Souza', cidade: 'Araguari', uf: 'MG', cpf_cnpj: '52998224725',
      email: 'maria.souza@exemplo.com', telefone: '34988887777',
    },
    campos: {
      ...base, endereco: 'Rua das Acácias, 245, Jardim Brasília, Araguari - MG, 38440-000', tipo_telhado: 'Cerâmico',
      area_m2: '34', preco_avista: '28.400,00', pag_vista: true, pag_cartao_10: true, pag_cartao_12: true, pag_cartao_18: true,
      pag_fin_60: true, pag_fin_72: true, pag_fin_84: true, pag_entrada: true, entrada_valor: '8.000,00', entrada_modo: 'contrato',
      bateria_marca: 'BYD Battery-Box', bateria_qtd: '2', bateria_capacidade_kwh: '5,12', bateria_potencia_kw: '5', bateria_ciclos: '6000',
      bateria_garantia_anos: '10', garantia_extra1_nome: 'Monitoramento', garantia_extra1_anos: '2',
      prazo_instalacao_dias: '40', foto_telhado_b64: PNG, validade_dias: '10',
      assinatura: {
        empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio administrador' },
        cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' },
      },
    },
  },
  {
    // (b) Sem bateria, só à vista (cartão e financiamento desligados).
    nome: 'so-avista', empresa: empresaModernoVerde,
    cliente: { nome: 'José Carlos Ribeiro', cidade: 'Uberaba', uf: 'MG', telefone: '34977776666' },
    campos: {
      ...base, cidade: 'Uberaba', consumo_kwh: '420', qtd_modulos: '8', investimento: '19.500,00', codigo: '202611180002',
      pag_vista: true, pag_cartao: false, pag_fin: false, tipo_telhado: 'Fibrocimento',
    },
  },
  {
    // (c) Mínimo: sem e-mail, CPF, telefone, foto, endereço, garantias extras, código nem forma de pagamento marcada.
    nome: 'minimo', empresa: { nome: 'Luz do Vale Solar', cnpj: '' },
    cliente: { nome: 'Ana Lima' },
    campos: {
      emitido_em: '2026-11-18T15:00:00.000Z', uf: 'GO', consumo_kwh: '300', qtd_modulos: '6', potencia_modulo: '550',
      marca_modulo: 'Jinko', investimento: '14000',
    },
  },
  {
    // (d) Sistema grande: 40 módulos, três inversores com garantias diferentes, consumo alto, todas as parcelas.
    nome: 'grande', empresa: empresaModerno,
    cliente: { nome: 'Padaria Pão Quente Ltda', cidade: 'Uberlândia', uf: 'MG', cpf_cnpj: '11222333000181', email: 'compras@paoquente.example' },
    campos: {
      ...base, cidade: 'Uberlândia', consumo_kwh: '3.600', qtd_modulos: '44', potencia_modulo: '700', marca_modulo: 'Trina Solar',
      investimento: '128.000,00', preco_avista: '121.500,00', codigo: '202611180004', tipo_telhado: 'Metálico', area_m2: '138',
      inversores: [
        { qtd: 2, marca: 'Growatt', potencia: '10', garantia: '10' },
        { qtd: 1, marca: 'Huawei', potencia: '8', garantia: '12' },
        { qtd: 1, marca: 'Deye', potencia: '3,6', garantia: '5' },
      ],
      ...Object.fromEntries([...Array(21).keys()].map((i) => [`pag_cartao_${i + 1}`, true])),
      ...Object.fromEntries([36, 48, 60, 72, 84].map((n) => [`pag_fin_${n}`, true])),
      pag_custom: '30% na assinatura e o restante na entrega do material', garantia_extra1_nome: 'Monitoramento',
      garantia_extra1_anos: '3', garantia_extra2_nome: 'Limpeza dos módulos', garantia_extra2_anos: '1',
      iluminacao_publica: '42,50', prazo_instalacao_dias: '60',
    },
  },
];
