import type { EntradaCatalogo, Gatilho } from './comprasTipos';

/*
 * Catálogo de apoio da lista de compras da vistoria. Só SUGERE: a linha gravada copia nome, unidade,
 * quem providencia e especificação e nunca volta a consultar este arquivo. Texto genérico: sem marca de
 * fabricante, sem nome de loja, sem nome de distribuidora e sem número de norma no que o cliente lê.
 *
 * FONTES CONSULTADAS (pesquisa de 29/10/2026). Os nomes abaixo vivem SÓ neste comentário.
 * - CEMIG ND-5.1, fornecimento em tensão secundária, rede aérea (rev. mar/2026):
 *   https://www.cemig.com.br/wp-content/uploads/2025/10/nd5_1_000001p.pdf
 * - CEMIG ND-5.30, conexão de geração distribuída em baixa tensão (jun/2025):
 *   https://www.cemig.com.br/wp-content/uploads/2025/10/ND_5.30_Conexao-em-BT.pdf
 * - Enel, Especificação Técnica 0122, versão 05 de 02/04/2024:
 *   https://www.eneldistribuicao.com.br/rj/documentos/CNC-NDBR-DBR-18-0122-EDBR%20Conex%C3%A3o%20de%20Micro%20e%20Minigera%C3%A7%C3%A3o%20Distribu%C3%ADda%20ao%20Sistema%20El%C3%A9trico%20da%20Enel%20Grids%20Brasil.pdf
 * - Enel, PM-Br 800.01.2, haste circular de aço cobreado (25/06/2020):
 *   https://www.eneldistribuicao.com.br/ce/documentos/PM-Br%20800.01.2%20-%20Haste%20Circular%20de%20A%C3%A7o%20Cobreado.pdf
 * - Canal Solar, string box com DPS e a NBR 16690 (atualizado em 27/09/2024):
 *   https://canalsolar.com.br/stringbox-com-dps-e-necessaria-ou-nao-o-que-diz-a-nbr-16690/
 * - Canal Solar, especificações básicas da string box (15/10/2025):
 *   https://canalsolar.com.br/entenda-as-especificacoes-basicas-string-box/
 * - Canal Solar, cabos elétricos em sistemas fotovoltaicos (11/07/2025):
 *   https://canalsolar.com.br/especificacoes-dos-cabos-eletricos-nos-sistemas-fotovoltaicos/
 * - Canal Solar, dimensionamento de cabos e proteções (16/02/2026):
 *   https://canalsolar.com.br/dimensionamento-de-cabos-e-protecao/
 * - Canal Solar, DPS no padrão de entrada (21/12/2023):
 *   https://canalsolar.com.br/en/dps-is-mandatory-in-the-entry-standard-with-photovoltaic-system/
 * - Canal Solar, erros de instalação em telhados cerâmicos (15/01/2026):
 *   https://canalsolar.com.br/principais-erros-de-instalacao-de-paineis-solares-em-telhados-ceramicos/
 * - Canal Solar, módulos em laje, artigo de um fabricante de estruturas (30/10/2024):
 *   https://canalsolar.com.br/instrucoes-para-a-instalacao-de-modulos-fv-em-laje/
 * - Canal Solar, alerta do sindicato sobre cabos (30/04/2025):
 *   https://canalsolar.com.br/sindicato-alerta-sobre-seguranca-dos-cabos-eletricos-em-instalacoes-fv/
 * - Target Normas, qualificação dos cabos de potência para sistemas fotovoltaicos (08/04/2020):
 *   https://www.normas.com.br/visualizar/artigo-tecnico/3781/a-qualificacao-dos-cabos-de-potencia-para-sistemas-fotovoltaicos
 * - Cursa, estruturas e fixação de placas solares em telhados e solo (curso online, baixa autoridade):
 *   https://cursa.app/pt/pagina/estruturas-e-fixacao-de-placas-solares-em-telhados-e-solo
 * - CREA-SC, amianto (18/08/2023):
 *   https://portal.crea-sc.org.br/artigo-amianto-precisamos-falar-sobre-este-passivo-ambiental/
 * - Ministério do Trabalho, NR-35 trabalho em altura:
 *   https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/norma-regulamentadora-no-35-nr-35
 * - Ministério do Trabalho, cartilha Trabalho em Altura (2020):
 *   https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/manuais-e-publicacoes/2020/cartilha_trabalho_em_altura.pdf
 * - Ministério do Trabalho, NR-10 segurança em instalações e serviços em eletricidade:
 *   https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/norma-regulamentadora-no-10-nr-10
 * - Câmara dos Deputados, apresentação da INEL sobre riscos de incêndio em sistemas fotovoltaicos (06/07/2022):
 *   https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-permanentes/cme/apresentacoes-em-eventos/apresentacoes-de-convidados-em-eventos-em-2022/06-07-2022-riscos-de-incendio-em-instalacoes-de-geracao-fotovoltaica-de-energia/6%20-%20INEL%20Apresentacao%20INEL%2006072022.pdf
 *
 * LIMITES DA PESQUISA (por isso o texto diz "conforme a regra da distribuidora" e "conforme o projeto"):
 * - Só CEMIG e Enel foram lidas em fonte primária. Copel, CPFL, Energisa e Neoenergia NÃO foram lidas.
 * - O texto oficial da REN 1000/2021 não abriu; o que cita REN vem da especificação da Enel.
 * - NBR 16690, NBR 5410 e NBR 16612 vieram de resumos e artigos técnicos, não do texto pago.
 * - Seção do cabo de equipotencialização, corrente In e Imáx do DPS e seção do cabo solar ficaram "conforme o projeto".
 * - Prática de campo sem fonte aberta: poda, mureta, reforço de madeiramento, sinal de internet no inversor, abrigo do
 *   inversor, cercamento, rasgos e passagens, etiquetas, barra de equipotencialização, DR e lista de EPI.
 * - Fora do catálogo de propósito: medidor bidirecional (a distribuidora instala), DSV (só vale sem inversor) e AFCI (é do inversor).
 * - Telha de fibrocimento antiga pode ter amianto: a regra é não furar nem cortar (CREA-SC).
 * Um engenheiro revisa as 72 linhas `esp` antes de ir ao ar.
 */

const G = (item: string, quando: Gatilho['quando'], peso: Gatilho['peso'] = 2): Gatilho => ({ item, quando, peso });

export const CATEGORIAS: { chave: string; rotulo: string }[] = [
  { chave: 'padrao_medicao', rotulo: 'Padrão e medição' },
  { chave: 'aterramento', rotulo: 'Aterramento e equipotencialização' },
  { chave: 'quadro_ca', rotulo: 'Quadro e proteção CA' },
  { chave: 'local_inversor', rotulo: 'Local do inversor e monitoramento' },
  { chave: 'lado_cc', rotulo: 'Lado CC' },
  { chave: 'passagem_cabos', rotulo: 'Passagem de cabos' },
  { chave: 'fixacao_telhado', rotulo: 'Fixação por tipo de telhado e solo' },
  { chave: 'telhado_obra', rotulo: 'Telhado e obra civil' },
  { chave: 'entorno_seguranca', rotulo: 'Entorno e segurança no telhado' },
];

export const CATALOGO: EntradaCatalogo[] = [
  // ── Padrão e medição ──
  { cid: 'caixa-medicao', nome: 'Caixa de medição', cat: 'padrao_medicao', un: 'un', quem: 'cliente', esp: 'Modelo aprovado pela distribuidora, com espaço para o medidor bidirecional.', gatilhos: [G('padrao', 'N', 1), G('medidor', 'N', 1)] },
  { cid: 'disjuntor-geral-padrao', nome: 'Disjuntor geral do padrão de entrada', cat: 'padrao_medicao', un: 'un', quem: 'cliente', esp: 'Termomagnético, modelo aprovado pela distribuidora, corrente conforme a faixa de fornecimento.', gatilhos: [G('disjuntor_padrao', 'AN', 1)] },
  { cid: 'cabo-ramal-entrada', nome: 'Cabo do ramal de entrada', cat: 'padrao_medicao', un: 'm', quem: 'cliente', esp: 'Cobre com isolação para 70 °C, seção conforme o disjuntor geral.', gatilhos: [G('padrao', 'N', 1), G('disjuntor_padrao', 'N', 2)] },
  { cid: 'eletroduto-ramal-entrada', nome: 'Eletroduto do ramal de entrada', cat: 'padrao_medicao', un: 'barra', quem: 'cliente', esp: 'PVC rígido antichama ou aço galvanizado, diâmetro conforme a tabela da distribuidora.', gatilhos: [G('padrao', 'A', 1), G('padrao', 'N', 2)] },
  { cid: 'poste-pontalete-padrao', nome: 'Poste ou pontalete do padrão', cat: 'padrao_medicao', un: 'un', quem: 'cliente', esp: 'Aço ou concreto, conforme a faixa de fornecimento e a regra da distribuidora.', gatilhos: [G('padrao', 'N', 2)] },
  { cid: 'placa-geracao-propria', nome: 'Placa de advertência de geração própria', cat: 'padrao_medicao', un: 'un', quem: 'integrador', esp: 'Texto de geração própria no modelo da distribuidora, em material resistente ao tempo.', sempre: true },
  { cid: 'aumento-potencia-disponibilizada', nome: 'Pedido de aumento da potência disponibilizada', cat: 'padrao_medicao', un: 'servico', quem: 'a_definir', esp: 'O titular pede à distribuidora. Pode exigir troca do disjuntor geral e dos cabos.', gatilhos: [G('disjuntor_padrao', 'AN', 2)] },
  { cid: 'adequacao-padrao-eletricista', nome: 'Adequação do padrão de entrada por eletricista', cat: 'padrao_medicao', un: 'servico', quem: 'cliente', esp: 'Serviço de eletricista habilitado, conforme a regra de fornecimento da distribuidora.', gatilhos: [G('padrao', 'N', 1)] },
  { cid: 'mureta-nicho-padrao', nome: 'Mureta ou nicho de alvenaria para o padrão', cat: 'padrao_medicao', un: 'servico', quem: 'cliente', esp: 'Alvenaria rebocada, com abertura para leitura pela via pública.', gatilhos: [G('padrao', 'N', 2)] },

  // ── Aterramento e equipotencialização ──
  { cid: 'haste-aterramento', nome: 'Haste de aterramento', cat: 'aterramento', un: 'un', quem: 'cliente', esp: 'Aço cobreado, modelo aprovado pela distribuidora.', gatilhos: [G('padrao', 'AN', 1)] },
  { cid: 'cabo-cobre-nu-aterramento', nome: 'Cabo de cobre nu para aterramento', cat: 'aterramento', un: 'm', quem: 'cliente', esp: 'Cobre nu, contínuo e sem emendas, seção conforme a regra da distribuidora.', gatilhos: [G('padrao', 'A', 1), G('padrao', 'N', 2)] },
  { cid: 'caixa-inspecao-aterramento', nome: 'Caixa de inspeção do aterramento', cat: 'aterramento', un: 'un', quem: 'cliente', esp: 'Caixa ou tubo com tampa, para manter o topo da haste visível e acessível.', gatilhos: [G('padrao', 'A', 1), G('padrao', 'N', 2)] },
  { cid: 'condutor-protecao-padrao-quadro', nome: 'Condutor de proteção do padrão ao quadro', cat: 'aterramento', un: 'm', quem: 'cliente', esp: 'Cobre isolado verde ou verde e amarelo, seção conforme a regra da distribuidora.', gatilhos: [G('padrao', 'N', 2), G('quadro_distribuicao', 'N', 1)] },
  { cid: 'cabo-equipotencializacao', nome: 'Cabo e terminais de equipotencialização da estrutura', cat: 'aterramento', un: 'cj', quem: 'integrador', esp: 'Cobre isolado verde ou verde e amarelo, com terminais próprios para perfil e moldura.', sempre: true },
  { cid: 'barra-equipotencializacao', nome: 'Barra de equipotencialização', cat: 'aterramento', un: 'un', quem: 'a_definir', esp: 'Barra de cobre com bornes em caixa de proteção, com reserva de bornes.', gatilhos: [G('padrao', 'A', 2), G('estrutura', 'A', 2)] },

  // ── Quadro e proteção CA ──
  { cid: 'quadro-distribuicao', nome: 'Quadro de distribuição', cat: 'quadro_ca', un: 'un', quem: 'a_definir', esp: 'Caixa com trilho, barras de neutro e de proteção separadas e espaço de reserva.', gatilhos: [G('quadro_distribuicao', 'AN', 1)] },
  { cid: 'disjuntor-ca-inversor', nome: 'Disjuntor CA do inversor', cat: 'quadro_ca', un: 'un', quem: 'integrador', esp: 'Termomagnético, polos e corrente conforme a saída do inversor e o cabo.', sempre: true },
  { cid: 'dps-ca', nome: 'DPS do lado CA', cat: 'quadro_ca', un: 'un', quem: 'integrador', esp: 'Classe II, tensão conforme a rede, com indicador de fim de vida.', gatilhos: [G('quadro_distribuicao', 'AN', 1), G('inversores', 'AN', 1)] },
  { cid: 'dr', nome: 'DR (interruptor diferencial residual)', cat: 'quadro_ca', un: 'un', quem: 'a_definir', esp: 'Corrente diferencial de 30 mA, polos iguais aos do circuito protegido.', gatilhos: [G('quadro_distribuicao', 'A', 1), G('quadro_distribuicao', 'N', 2)] },
  { cid: 'disjuntores-reposicao-quadro', nome: 'Disjuntores de reposição do quadro', cat: 'quadro_ca', un: 'un', quem: 'cliente', esp: 'Termomagnético, corrente conforme o cabo do circuito, mesma largura e fixação do quadro.', gatilhos: [G('quadro_distribuicao', 'N', 1)] },
  { cid: 'etiquetas-circuitos', nome: 'Etiquetas de identificação dos circuitos', cat: 'quadro_ca', un: 'cj', quem: 'integrador', esp: 'Etiquetas resistentes ao tempo, com o nome de cada circuito e do desligamento do sistema.', gatilhos: [G('quadro_distribuicao', 'A', 1), G('inversores', 'A', 2)] },

  // ── Local do inversor e monitoramento ──
  { cid: 'abrigo-inversor', nome: 'Abrigo para o inversor', cat: 'local_inversor', un: 'un', quem: 'a_definir', esp: 'Cobertura ou nicho que proteja do sol direto e da chuva, sem abafar o equipamento.', gatilhos: [G('inversores', 'AN', 1)] },
  { cid: 'suporte-fixacao-inversor', nome: 'Suporte e fixação do inversor', cat: 'local_inversor', un: 'cj', quem: 'integrador', esp: 'Suporte com buchas e parafusos adequados ao tipo de parede e ao peso do inversor.', gatilhos: [G('inversores', 'AN', 1)] },
  { cid: 'ponto-internet-inversor', nome: 'Ponto de internet para o inversor', cat: 'local_inversor', un: 'cj', quem: 'cliente', esp: 'Repetidor de sinal, ponto de rede ou kit pela rede elétrica, conforme o manual do inversor.', gatilhos: [G('inversores', 'A', 2)] },
  { cid: 'cabo-rede-inversor', nome: 'Cabo de rede para o inversor', cat: 'local_inversor', un: 'm', quem: 'a_definir', esp: 'Cabo de rede com proteção UV se passar ao tempo, até 100 m por trecho.', gatilhos: [G('inversores', 'A', 2), G('cabeamento', 'A', 2)] },

  // ── Lado CC ──
  { cid: 'string-box', nome: 'String box', cat: 'lado_cc', un: 'un', quem: 'integrador', esp: 'Invólucro IP55 ou superior, com entradas conforme o número de strings.', gatilhos: [G('inversores', 'AN', 1), G('cabeamento', 'AN', 1)] },
  { cid: 'fusivel-string', nome: 'Fusível de string com porta-fusível', cat: 'lado_cc', un: 'un', quem: 'integrador', esp: 'Fusível para corrente contínua, tensão e corrente conforme o arranjo e o módulo.', sempre: true },
  { cid: 'dps-cc', nome: 'DPS do lado CC', cat: 'lado_cc', un: 'un', quem: 'integrador', esp: 'Classe II para corrente contínua, tensão acima da máxima do arranjo, com proteção em série.', gatilhos: [G('inversores', 'A', 2), G('cabeamento', 'A', 2)] },
  { cid: 'chave-seccionadora-cc', nome: 'Chave seccionadora CC', cat: 'lado_cc', un: 'un', quem: 'integrador', esp: 'Própria para corrente contínua, tensão e corrente acima das do arranjo, com trava para cadeado.', gatilhos: [G('inversores', 'A', 2)] },
  { cid: 'cabo-solar-cc', nome: 'Cabo solar CC', cat: 'lado_cc', un: 'm', quem: 'integrador', esp: '1,5 kV CC, cobre estanhado, dupla isolação, proteção UV, preto e vermelho.', sempre: true },
  { cid: 'conector-cc', nome: 'Conector CC macho e fêmea', cat: 'lado_cc', un: 'cj', quem: 'integrador', esp: 'Mesmo fabricante nas duas metades, IP67, compatível com a seção do cabo e a tensão do arranjo.', sempre: true },

  // ── Passagem de cabos ──
  { cid: 'eletroduto-aco-galvanizado', nome: 'Eletroduto rígido de aço galvanizado', cat: 'passagem_cabos', un: 'barra', quem: 'integrador', esp: 'Roscável, barras de 3 m, diâmetro conforme os cabos, com luvas e curvas.', gatilhos: [G('cabeamento', 'A', 2), G('cabeamento', 'N', 1)] },
  { cid: 'eletroduto-pvc-uv', nome: 'Eletroduto de PVC rígido com proteção UV', cat: 'passagem_cabos', un: 'barra', quem: 'integrador', esp: 'Roscável e antichama, preto com proteção UV quando exposto ao sol, barras de 3 m.', gatilhos: [G('cabeamento', 'A', 1)] },
  { cid: 'eletroduto-flexivel-metalico', nome: 'Eletroduto flexível metálico revestido', cat: 'passagem_cabos', un: 'm', quem: 'integrador', esp: 'Corrugado revestido para uso ao tempo, com conectores, só para a ligação final.', gatilhos: [G('cabeamento', 'A', 2), G('inversores', 'A', 2)] },
  { cid: 'eletroduto-corrugado-enterrar', nome: 'Eletroduto corrugado reforçado para enterrar', cat: 'passagem_cabos', un: 'm', quem: 'integrador', esp: 'Polietileno de parede dupla, com caixa de passagem nas curvas.', gatilhos: [G('cabeamento', 'AN', 2)] },
  { cid: 'eletrocalha-perfilado', nome: 'Eletrocalha ou perfilado com tampa', cat: 'passagem_cabos', un: 'm', quem: 'integrador', esp: 'Aço galvanizado ou alumínio, com tampa, emendas e suportes compatíveis.', gatilhos: [G('cabeamento', 'A', 2)] },
  { cid: 'condulete-tampa', nome: 'Condulete com tampa', cat: 'passagem_cabos', un: 'un', quem: 'integrador', esp: 'Alumínio ou PVC com rosca no diâmetro do eletroduto, tampa com vedação para uso externo.', gatilhos: [G('cabeamento', 'A', 2)] },
  { cid: 'abracadeira-d-prensa-cabo', nome: 'Abraçadeira tipo D, suporte e prensa-cabo', cat: 'passagem_cabos', un: 'cj', quem: 'integrador', esp: 'Abraçadeira com cunha no diâmetro do eletroduto, buchas e prensa-cabo com vedação.', gatilhos: [G('cabeamento', 'AN', 1)] },
  { cid: 'cabo-ca-flexivel', nome: 'Cabo CA flexível do inversor ao quadro', cat: 'passagem_cabos', un: 'm', quem: 'integrador', esp: 'Cobre flexível 0,6/1 kV, seção pela corrente do disjuntor e pela distância, com ponteiras.', gatilhos: [G('cabeamento', 'AN', 1), G('quadro_distribuicao', 'AN', 2)] },
  { cid: 'abracadeira-nylon-uv', nome: 'Abraçadeira de nylon com proteção UV e clipe de cabo', cat: 'passagem_cabos', un: 'cj', quem: 'integrador', esp: 'Nylon preto com proteção UV e clipes inox para prender os cabos fora da telha.', gatilhos: [G('cabeamento', 'A', 2)] },

  // ── Fixação por tipo de telhado e solo ──
  { cid: 'perfil-aluminio', nome: 'Perfil de alumínio para módulos', cat: 'fixacao_telhado', un: 'barra', quem: 'integrador', esp: 'Alumínio anodizado, barras de 2 a 6 m, vão entre apoios conforme o manual da estrutura.', sempre: true },
  { cid: 'emenda-perfil', nome: 'Emenda de perfil', cat: 'fixacao_telhado', un: 'pc', quem: 'integrador', esp: 'Emenda própria do perfil, com parafusos inox e folga de dilatação.', sempre: true },
  { cid: 'grampo-intermediario', nome: 'Grampo intermediário', cat: 'fixacao_telhado', un: 'pc', quem: 'integrador', esp: 'Alumínio ou inox, na altura da moldura do módulo.', sempre: true },
  { cid: 'grampo-final', nome: 'Grampo final', cat: 'fixacao_telhado', un: 'pc', quem: 'integrador', esp: 'Alumínio ou inox, na altura da moldura do módulo, uma peça em cada ponta da fileira.', sempre: true },
  { cid: 'parafusos-inox-estrutura', nome: 'Parafusos, porcas e arruelas inox para a estrutura', cat: 'fixacao_telhado', un: 'cj', quem: 'integrador', esp: 'Aço inox, comprimento conforme o perfil e o grampo, sem misturar metais diferentes sem isolar.', sempre: true },
  { cid: 'selante-fita-telhado', nome: 'Selante e fita de vedação para telhado', cat: 'fixacao_telhado', un: 'un', quem: 'integrador', esp: 'Selante neutro resistente a UV e fita butílica para sobreposições.', gatilhos: [G('telhado', 'A', 1), G('tipo_telha', 'A', 2)] },
  { cid: 'gancho-telha-ceramica', nome: 'Gancho para telha cerâmica', cat: 'fixacao_telhado', un: 'pc', quem: 'integrador', esp: 'Inox ou galvanizado, preso no caibro ou na terça, nunca só na ripa.', gatilhos: [G('tipo_telha', 'AN', 1)], alternativa: 'telha' },
  { cid: 'kit-fixacao-fibrocimento', nome: 'Kit de fixação para telha de fibrocimento', cat: 'fixacao_telhado', un: 'cj', quem: 'integrador', esp: 'Parafuso estrutural na terça, com arruela metálica e de borracha, e suporte com base plana.', gatilhos: [G('tipo_telha', 'AN', 1)], alternativa: 'telha', aviso: 'amianto' },
  { cid: 'kit-fixacao-metalica-trapezoidal', nome: 'Kit de fixação para telha metálica trapezoidal', cat: 'fixacao_telhado', un: 'cj', quem: 'integrador', esp: 'Grampo no cume da onda com parafuso autobrocante e arruela de vedação.', gatilhos: [G('tipo_telha', 'AN', 1)], alternativa: 'telha' },
  { cid: 'grampo-telha-agrafada', nome: 'Grampo para telha metálica de junta agrafada', cat: 'fixacao_telhado', un: 'pc', quem: 'integrador', esp: 'Grampo compatível com o perfil da junta, preso sem furar a telha.', gatilhos: [G('tipo_telha', 'AN', 1)], alternativa: 'telha' },
  { cid: 'estrutura-triangular-laje', nome: 'Estrutura triangular para laje', cat: 'fixacao_telhado', un: 'cj', quem: 'integrador', esp: 'Alumínio ou aço galvanizado, com inclinação conforme o projeto e ancoragem calculada para o vento.', gatilhos: [G('telhado', 'AN', 3), G('estrutura', 'AN', 3)], alternativa: 'laje' },
  { cid: 'sapata-concreto-laje', nome: 'Sapata de concreto para laje', cat: 'fixacao_telhado', un: 'un', quem: 'integrador', esp: 'Base de concreto colada na laje com adesivo estrutural, sem furar a impermeabilização.', gatilhos: [G('telhado', 'AN', 3), G('estrutura', 'AN', 3)], alternativa: 'laje' },
  { cid: 'estrutura-solo', nome: 'Estrutura de solo', cat: 'fixacao_telhado', un: 'cj', quem: 'integrador', esp: 'Mesa de aço galvanizado ou alumínio, com postes, travessas e trilhos, altura mínima conforme o projeto.', sempre: true },
  { cid: 'fundacao-estrutura-solo', nome: 'Fundação da estrutura de solo', cat: 'fixacao_telhado', un: 'un', quem: 'a_definir', esp: 'Estaca cravada, sapata ou base pré-moldada, definida pelo projetista conforme o solo.', gatilhos: [G('estrutura', 'AN', 3)] },

  // ── Telhado e obra civil ──
  { cid: 'telha-reposicao', nome: 'Telha de reposição', cat: 'telhado_obra', un: 'un', quem: 'a_definir', esp: 'Mesmo modelo, cor e dimensão da telha existente, com sobra para quebra.', gatilhos: [G('telhado', 'AN', 2), G('tipo_telha', 'AN', 2)] },
  { cid: 'troca-telhas-retelhamento', nome: 'Troca de telhas e retelhamento', cat: 'telhado_obra', un: 'servico', quem: 'cliente', esp: 'Troca das peças ruins e reassentamento da cobertura antes de montar a estrutura.', gatilhos: [G('telhado', 'AN', 1), G('tipo_telha', 'AN', 2)] },
  { cid: 'reforco-madeiramento', nome: 'Reforço do madeiramento ou da estrutura do telhado', cat: 'telhado_obra', un: 'servico', quem: 'cliente', esp: 'Troca ou reforço de caibros, terças e ripas, com tratamento contra cupim quando houver.', gatilhos: [G('telhado', 'AN', 2), G('estrutura', 'AN', 1)] },
  { cid: 'laudo-estrutural', nome: 'Laudo estrutural da cobertura ou da laje', cat: 'telhado_obra', un: 'servico', quem: 'a_definir', esp: 'Laudo de engenheiro civil com ART sobre a carga do arranjo e o vento.', gatilhos: [G('telhado', 'N', 2), G('estrutura', 'N', 1)] },
  { cid: 'impermeabilizacao-laje', nome: 'Impermeabilização da laje nos pontos de fixação', cat: 'telhado_obra', un: 'servico', quem: 'a_definir', esp: 'Recomposição da manta ou do revestimento nos pontos de fixação, com produto compatível.', gatilhos: [G('telhado', 'AN', 2), G('estrutura', 'AN', 2)] },
  { cid: 'remocao-telhado-amianto', nome: 'Remoção de telhado de fibrocimento com amianto', cat: 'telhado_obra', un: 'servico', quem: 'cliente', esp: 'Remoção por empresa habilitada, com embalagem e descarte em aterro autorizado.', gatilhos: [G('tipo_telha', 'AN', 2)], aviso: 'amianto' },
  { cid: 'rasgos-passagens', nome: 'Abertura e fechamento de rasgos e passagens', cat: 'telhado_obra', un: 'servico', quem: 'a_definir', esp: 'Rasgo ou furo em parede, laje ou forro, com fechamento, vedação e acabamento.', gatilhos: [G('cabeamento', 'AN', 2)] },
  { cid: 'limpeza-nivelamento-drenagem', nome: 'Limpeza, nivelamento e drenagem do terreno', cat: 'telhado_obra', un: 'servico', quem: 'a_definir', esp: 'Capina, retirada de entulho e nivelamento, com escoamento da água longe das fundações.', gatilhos: [G('estrutura', 'AN', 3), G('sombreamento', 'AN', 3)] },
  { cid: 'cercamento-area-solo', nome: 'Cercamento da área de solo', cat: 'telhado_obra', un: 'm', quem: 'cliente', esp: 'Tela e mourões ou alambrado, com portão para manutenção e placas de risco elétrico.', gatilhos: [G('estrutura', 'A', 3)] },

  // ── Entorno e segurança no telhado ──
  { cid: 'poda-remocao-arvore', nome: 'Poda ou remoção de árvore', cat: 'entorno_seguranca', un: 'servico', quem: 'cliente', esp: 'Poda feita por profissional habilitado, com autorização da prefeitura quando exigida.', gatilhos: [G('sombreamento', 'AN', 1)] },
  { cid: 'remanejamento-obstaculo', nome: 'Remanejamento de caixa d’água, antena ou obstáculo', cat: 'entorno_seguranca', un: 'servico', quem: 'cliente', esp: 'Mudança de lugar ou de altura do obstáculo que faz sombra nos módulos.', gatilhos: [G('sombreamento', 'AN', 1)] },
  { cid: 'escada-acesso-telhado', nome: 'Escada de acesso ao telhado', cat: 'entorno_seguranca', un: 'un', quem: 'integrador', esp: 'Escada de fibra, que não conduz eletricidade, passando do ponto de apoio e travada no topo.', gatilhos: [G('telhado', 'AN', 1)] },
  { cid: 'ancoragem-linha-vida', nome: 'Ponto de ancoragem e linha de vida', cat: 'entorno_seguranca', un: 'cj', quem: 'integrador', esp: 'Ancoragem em estrutura sã, nunca em telha ou ripa, com equipamentos de certificado válido.', gatilhos: [G('telhado', 'AN', 1)] },
  { cid: 'cinturao-paraquedista', nome: 'Cinturão paraquedista com talabarte e absorvedor', cat: 'entorno_seguranca', un: 'un', quem: 'integrador', esp: 'Com certificado de aprovação (CA) válido e tamanho certo para cada pessoa.', gatilhos: [G('telhado', 'AN', 1)] },
  { cid: 'guarda-corpo-protecao-queda', nome: 'Guarda-corpo ou proteção coletiva contra queda', cat: 'entorno_seguranca', un: 'cj', quem: 'a_definir', esp: 'Guarda-corpo provisório ou fixo na borda, ou fechamento das aberturas no piso.', gatilhos: [G('telhado', 'N', 1)] },
  { cid: 'andaime-plataforma', nome: 'Andaime ou plataforma de acesso', cat: 'entorno_seguranca', un: 'servico', quem: 'a_definir', esp: 'Andaime, torre móvel ou plataforma, montados e desmontados por equipe treinada.', gatilhos: [G('telhado', 'AN', 2)] },
  { cid: 'sinalizacao-isolamento-obra', nome: 'Sinalização e isolamento da área de trabalho', cat: 'entorno_seguranca', un: 'cj', quem: 'integrador', esp: 'Cones, fita zebrada e placas de aviso, isolando o piso sob o telhado.', gatilhos: [G('telhado', 'A', 2)] },
  { cid: 'epi-eletricidade', nome: 'EPI para trabalho com eletricidade', cat: 'entorno_seguranca', un: 'cj', quem: 'integrador', esp: 'Capacete, luva isolante, calçado sem partes metálicas, óculos e detector de tensão, com CA válido.', sempre: true },
];

export const OBSERVACOES_PRONTAS: { texto: string; itens: string[] }[] = [
  { texto: 'Padrão de entrada fora da norma da distribuidora. Precisa de adequação antes da instalação.', itens: ['padrao'] },
  { texto: 'Caixa de medição antiga ou pequena. Não comporta o medidor bidirecional. Trocar a caixa.', itens: ['padrao', 'medidor'] },
  { texto: 'Padrão sem aterramento ou com haste sem acesso para inspeção. Refazer o aterramento.', itens: ['padrao'] },
  { texto: 'Padrão sem placa de geração própria. Instalar a placa na entrega do sistema.', itens: ['padrao'] },
  { texto: 'O medidor bidirecional é instalado pela distribuidora. Não entra na lista de compra.', itens: ['medidor'] },
  { texto: 'Disjuntor geral abaixo da potência do sistema. Pedir aumento da potência disponibilizada à distribuidora.', itens: ['disjuntor_padrao'] },
  { texto: 'Disjuntor geral antigo, fora do modelo aprovado. Trocar por disjuntor aprovado pela distribuidora.', itens: ['disjuntor_padrao'] },
  { texto: 'Quadro sem espaço para o disjuntor do inversor. Instalar quadro novo ou ampliar.', itens: ['quadro_distribuicao', 'inversores'] },
  { texto: 'Quadro sem barra de terra. Instalar o barramento de proteção antes de ligar o sistema.', itens: ['quadro_distribuicao'] },
  { texto: 'Quadro sem DPS. Recomendado instalar DPS no quadro interno.', itens: ['quadro_distribuicao'] },
  { texto: 'Cabos e disjuntores do quadro com sinal de aquecimento. Trocar antes de instalar.', itens: ['quadro_distribuicao'] },
  { texto: 'Inversor ficará ao tempo. Pedir abrigo contra sol direto e chuva.', itens: ['inversores'] },
  { texto: 'Sem sinal de Wi-Fi no local do inversor. Pedir ao cliente repetidor, ponto de rede ou kit pela rede elétrica.', itens: ['inversores'] },
  { texto: 'Parede do inversor sem condição de fixação. Pedir reforço ou escolher outro local.', itens: ['inversores'] },
  { texto: 'Local do inversor de difícil acesso. A distribuidora precisa de acesso livre ao equipamento.', itens: ['inversores'] },
  { texto: 'Telhado sem acesso seguro. Pedir liberação de acesso e ponto de ancoragem.', itens: ['telhado'] },
  { texto: 'Laje ou telhado sem platibanda ou guarda-corpo. Prever proteção coletiva contra queda.', itens: ['telhado'] },
  { texto: 'Telhas quebradas ou porosas. Trocar antes de instalar a estrutura.', itens: ['tipo_telha', 'telhado'] },
  { texto: 'Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar. Avaliar a troca da cobertura.', itens: ['tipo_telha', 'telhado'] },
  { texto: 'Telha cerâmica frágil. Levar telhas de reposição do mesmo modelo.', itens: ['tipo_telha'] },
  { texto: 'Madeiramento com cupim ou apodrecido. Reforçar antes de instalar.', itens: ['estrutura', 'telhado'] },
  { texto: 'Laje impermeabilizada. Fixar sem furar a manta ou refazer a impermeabilização nos pontos de fixação.', itens: ['estrutura', 'telhado'] },
  { texto: 'Estrutura metálica existente sem aterramento. Equipotencializar com cabo próprio.', itens: ['estrutura'] },
  { texto: 'Telhado ou laje sem capacidade comprovada. Pedir laudo de engenheiro civil.', itens: ['estrutura', 'telhado'] },
  { texto: 'Edificação com para-raios (SPDA). O responsável técnico deve avaliar a ligação com o aterramento do sistema.', itens: ['estrutura', 'padrao'] },
  { texto: 'Trajeto dos cabos sem passagem pronta. Prever eletroduto, rasgo ou abertura no forro.', itens: ['cabeamento'] },
  { texto: 'Distância grande até o quadro. Calcular a seção do cabo pela queda de tensão.', itens: ['cabeamento'] },
  { texto: 'Cabos expostos ao sol e à chuva. Passar em eletroduto com proteção UV.', itens: ['cabeamento'] },
  { texto: 'Árvore sombreia os módulos. Pedir poda ou remoção, com autorização da prefeitura quando exigida.', itens: ['sombreamento'] },
  { texto: 'Caixa d’água ou antena sombreia o arranjo. Pedir a mudança de lugar ou refazer o desenho.', itens: ['sombreamento'] },
  { texto: 'A conta de luz não está no nome do cliente. Pedir documento que comprove a titularidade.', itens: ['conta_luz', 'documento_pessoal'] },
  { texto: 'Conta de luz sem o consumo legível. Pedir outra via com o histórico em kWh.', itens: ['conta_luz'] },
  { texto: 'Documento do titular ilegível ou cortado. Pedir nova foto, com rosto e dados legíveis.', itens: ['documento_pessoal'] },
];
