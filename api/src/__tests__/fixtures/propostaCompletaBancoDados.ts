// Dados FIXOS (fictícios) da "Completa + Banco" (propostaSolar, modelo 4), usados pelo teste byte a byte.
// As mesmas variantes geraram os .golden.html com o código de f0f29da4, antes da refatoração para o off-grid.
const HTTPS = 'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u1/obra/1-abc123.jpg?token=xyz';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

export const empresaCB: any = {
  nome: 'Sol Forte Energia Ltda', nome_fantasia: 'Sol Forte Energia', cnpj: '11222333000181',
  endereco: 'Av. João Naves de Ávila, 1000, Uberlândia-MG', cidade: 'Uberlândia-MG', uf: 'MG', socio_adm: 'Carlos Pereira',
  whatsapp: '34999990000', email: 'contato@solforte.example', cor_marca: '#1E3A8A', cor_secundaria: '#F7B500',
  dados_bancarios: { banco: 'Banco Exemplo', agencia: '0001', conta: '12345-6', tipo_conta: 'poupanca', titular: 'Sol Forte', pix: 'pix@exemplo.com' },
};
export const empresaCBSemBanco: any = { ...empresaCB, dados_bancarios: undefined };
export const clienteCB: any = { nome: 'Maria Aparecida Souza', cidade: 'Araguari', uf: 'MG' };

const base: Record<string, unknown> = {
  emitido_em: '2026-11-05T15:00:00.000Z', cidade: 'Araguari', uf: 'MG', consumo_kwh: '650',
  qtd_modulos: '12', potencia_modulo: '550', marca_modulo: 'Canadian', marca_inversor: 'Growatt',
  potencia_inversor: '5', investimento: '28.900,00', codigo: '20261105',
};
const obras = (n: number) => Array.from({ length: n }, (_, i) => ({ url: HTTPS, legenda: `Obra ${i + 1} em Araguari` }));
const ASSIN = {
  empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio administrador' },
  cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' },
};

export interface VarianteCB { nome: string; empresa: any; campos: Record<string, unknown> }

export const variantesCB: VarianteCB[] = [
  {
    // A completa: 6 obras, empresas atendidas, foto do telhado, bancos, dados bancários, assinatura e financiamento.
    nome: 'completa', empresa: empresaCB,
    campos: {
      ...base, preco_avista: '27.000,00', pag_vista: true, pag_cartao_6: true, pag_cartao_12: true,
      pag_fin_36: true, pag_fin_60: true, pag_fin_84: true,
      bancos_logos: ['itau', 'bb', 'caixa'], mostrar_dados_bancarios: true,
      fotos_obras: obras(6), empresas_atendidas: [{ url: HTTPS, nome: 'Empresa X' }], foto_telhado_b64: PNG,
      assinatura: ASSIN,
    },
  },
  {
    // Sem fotos e sem assinatura: o mínimo.
    nome: 'sem-fotos-sem-assinatura', empresa: empresaCBSemBanco,
    campos: { ...base, pag_cartao_12: true },
  },
  {
    // 12 obras (o limite), vários inversores, todos os bancos fixos, assinatura de PJ, cartão e financiamento cheios.
    nome: '12-fotos-varios-inversores', empresa: empresaCB,
    campos: {
      ...base, preco_avista: '27.000,00', pag_vista: true, pag_entrada: true, entrada_valor: '5.000,00', entrada_modo: 'contrato',
      ...Object.fromEntries([...Array(21).keys()].map((i) => [`pag_cartao_${i + 1}`, true])),
      ...Object.fromEntries([36, 48, 60, 72, 84].map((n) => [`pag_fin_${n}`, true])),
      inversores: [
        { qtd: 2, marca: 'Growatt', potencia: '5', garantia: '10' },
        { qtd: 1, marca: 'Huawei', potencia: '3,6', garantia: '12' },
      ],
      mostrar_dados_bancarios: true, fotos_obras: obras(12), foto_telhado_b64: PNG,
      empresas_atendidas: Array.from({ length: 4 }, (_, i) => ({ url: HTTPS, nome: `Empresa ${i + 1}` })),
      assinatura: { ...ASSIN, cliente: { tipo: 'PJ', nome: 'Padaria Pão Quente Ltda', documento: '11222333000181', representante: 'Ana Lima' }, local: 'Araguari-MG' },
    },
  },
];
