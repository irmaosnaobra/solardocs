// Gera os DOCUMENTOS DE VERDADE pra galeria da LP.
// Chama generateFromTemplate — a mesmíssima função que o app usa quando o
// cliente clica em "Gerar" — com uma empresa e um cliente de demonstração.
// Não é maquete: é o mesmo HTML que sai no PDF do assinante.
import fs from 'fs';
import path from 'path';
import { generateFromTemplate } from '../src/services/templateService';

const OUT = 'C:/Users/55349/AppData/Local/Temp/claude/c--Users-55349-Desktop-CLAUDE/5152d4bc-9891-49a3-ae64-3332367bba7d/scratchpad/docs';
fs.mkdirSync(OUT, { recursive: true });

const empresa: any = {
  nome: 'Sol Mineira Energia LTDA',
  cnpj: '12.345.678/0001-90',
  endereco: 'Av. Rondon Pacheco, 1200 — Sala 8',
  cidade: 'Uberlândia',
  uf: 'MG',
  cep: '38400-000',
  telefone: '(34) 99999-0000',
  email: 'contato@solmineira.com.br',
  socio_adm: 'Ricardo Alves Pereira',
  socio_cpf: '111.222.333-44',
  cor_primaria: '#F26513',
  cor_destaque: '#FBBF24',
  logo_base64: null,
};

const cliente: any = {
  nome: 'João Batista Moreira',
  cpf_cnpj: '123.456.789-00',
  nacionalidade: 'brasileiro',
  estado_civil: 'casado',
  profissao: 'comerciante',
  endereco: 'Rua das Acácias, 245 — Bairro Santa Mônica',
  cep: '38408-100',
  bairro: 'Santa Mônica',
  cidade: 'Uberlândia',
  uf: 'MG',
  email: 'joao.moreira@email.com',
  telefone: '(34) 98888-7777',
  padrao: 'Trifásico 380V',
  tipo_telhado: 'Cerâmico',
};

const camposProposta = {
  consumo_kwh: 780, tarifa_kwh: 0.98, taxa_minima: 100,
  potencia_modulo: 550, qtd_modulos: 15, marca_modulo: 'Trina Vertex',
  potencia_inversor: 8, qtd_inversores: 1, marca_inversor: 'Growatt',
  investimento: 38900, garantia_paineis: 25, garantia_inversor: 10,
  cidade: 'Uberlândia', uf: 'MG',
  vendedor_nome: 'Ricardo Alves', vendedor_whatsapp: '34999990000',
  vendedor_email: 'ricardo@solmineira.com.br',
};

// nomes conferidos nos próprios templates (f.*) — campo errado sai como
// linha em branco no contrato, e branco em página de venda parece rascunho
const camposContrato = {
  potencia_kwp: 8.25,
  quantidade_modulos: 15, marca_modulos: 'Trina Vertex 550W',
  quantidade_inversores: 1, marca_inversor: 'Growatt 8kW', tipo_inversor: 'Trifásico 380V',
  valor_total: 38900,
  condicoes_pagamento: 'Entrada de R$ 10.000,00 no PIX + 18x de R$ 1.605,55 no cartão',
  endereco_instalacao: 'Rua das Acácias, 245 — Santa Mônica, Uberlândia/MG',
  prazo_projeto_dias: 5, prazo_aprovacao_dias: 30, prazo_instalacao_dias: 10,
  garantia_modulos_anos: 25, garantia_inversor_anos: 10,
  foro_cidade: 'Uberlândia',
};

const camposProcuracao = {
  concessionaria: 'CEMIG', uc: '3009123456', foro_cidade: 'Uberlândia',
};

const camposRecibo = {
  numero: '0042', valor_contrato: 38900, data_contrato: '2026-08-05',
  descricao_servico: 'Fornecimento e instalação de sistema fotovoltaico de 8,25 kWp — 15 módulos Trina Vertex 550W e inversor Growatt 8kW',
  endereco_instalacao: 'Rua das Acácias, 245 — Santa Mônica, Uberlândia/MG',
  banco: 'Banco do Brasil', agencia: '1234-5', conta: '98765-4',
  chave_pix: 'contato@solmineira.com.br', foro_cidade: 'Uberlândia',
  pagamentos: [
    { data: '05/08/2026', valor: 10000, forma: 'PIX' },
    { data: '05/09/2026', valor: 14450, forma: 'Cartão' },
  ],
};

const camposBanco = {
  banco: 'BV Financeira', agencia: '1234-5', conta: '98765-4',
  descricao_sistema: 'Sistema fotovoltaico on-grid de 8,25 kWp — 15 módulos Trina Vertex 550W, inversor Growatt 8kW trifásico 380V, estrutura para telhado cerâmico, projeto e homologação inclusos',
  valor_equipamentos: 27300, valor_mao_de_obra: 11600, valor_total: 38900,
  validade_dias: 7,
};

const camposVistoria = {
  modo: 'completo', data_visita: '2026-08-05', tecnico_nome: 'Ricardo Alves',
  endereco_visita: 'Rua das Acácias, 245 — Santa Mônica, Uberlândia/MG',
  consumo_kwh: 780,
  telhado_tipo: 'Cerâmico', telhado_area: 60, telhado_orientacao: 'Norte',
  telhado_estrutura_ok: true, telhado_sem_sombra: true,
  padrao_tipo: 'Trifásico 380V', padrao_disjuntor: '63A',
  padrao_estado_ok: true, padrao_espaco_inversor: true,
  dim_potencia: 8.25, dim_distancia: 12,
  observacoes: 'Telhado em bom estado, sem sombreamento no período de maior geração. Padrão de entrada compatível — não precisa de troca.',
  conclusao: 'Imóvel apto para instalação de 8,25 kWp com 15 módulos.',
};

const DOCS: Array<{ nome: string; tipo: string; campos: any; modelo?: 1 | 2 | 3 }> = [
  { nome: 'proposta-1pagina', tipo: 'propostaSolar', campos: camposProposta, modelo: 1 },
  { nome: 'proposta-moderna', tipo: 'propostaSolar', campos: camposProposta, modelo: 2 },
  { nome: 'contrato',         tipo: 'contratoSolar', campos: camposContrato },
  { nome: 'procuracao',       tipo: 'procuracao',    campos: camposProcuracao },
  { nome: 'recibo',           tipo: 'recibo',        campos: camposRecibo },
  { nome: 'proposta-banco',   tipo: 'propostaBanco', campos: camposBanco },
  { nome: 'vistoria',         tipo: 'vistoria',      campos: camposVistoria },
];

for (const d of DOCS) {
  try {
    const html = generateFromTemplate(d.tipo, empresa, cliente, d.campos, d.modelo ?? 1);
    fs.writeFileSync(path.join(OUT, `${d.nome}.html`), html, 'utf8');
    console.log(d.nome, '->', Math.round(html.length / 1024), 'KB');
  } catch (e: any) {
    console.log(d.nome, 'ERRO:', e.message.slice(0, 120));
  }
}
