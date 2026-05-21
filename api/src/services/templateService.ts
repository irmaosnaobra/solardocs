import { getRef, geracaoMensal, MESES_ABREV } from './propostaSolarData';

interface Company {
  nome: string;
  cnpj: string;
  endereco?: string;
  cidade?: string;
  uf?: string;
  socio_adm?: string;
  engenheiro_nome?: string;
  engenheiro_cpf?: string;
  engenheiro_crea?: string;
  engenheiro_rg?: string;
  engenheiro_nacionalidade?: string;
  engenheiro_estado_civil?: string;
  engenheiro_profissao?: string;
  engenheiro_endereco?: string;
  tecnico_nome?: string;
  tecnico_cpf?: string;
  tecnico_rg?: string;
  tecnico_crt_cft?: string;
  tecnico_nacionalidade?: string;
  tecnico_estado_civil?: string;
  tecnico_endereco?: string;
}

export interface Client {
  nome: string;
  nacionalidade?: string;
  cpf_cnpj?: string;
  endereco?: string;
  cep?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  padrao?: string;
  tipo_telhado?: string;
  // Terceiro fields (populated when entity is a terceiro)
  tipo?: string;
  representante_nome?: string;
  representante_cpf?: string;
  email?: string;
  telefone?: string;
}

export function generateFromTemplate(
  type: string,
  company: Company,
  client: Client,
  fields: Record<string, unknown>,
  modelo: 1 | 2 = 1
): string {
  switch (type) {
    case 'contratoSolar':
      return modelo === 1
        ? contratoSolarM1(company, client, fields)
        : contratoSolarM2(company, client, fields);
    case 'contratoPJ':
      return modelo === 1
        ? contratoPjM1(company, client, fields)
        : contratoPjM2(company, client, fields);
    case 'procuracao':
      return modelo === 1
        ? procuracaoM1(company, client, fields)
        : procuracaoM2(company, client, fields);
    case 'propostaBanco':
      return modelo === 1
        ? propostaBancoM1(company, client, fields)
        : propostaBancoM2(company, client, fields);
    case 'prestacaoServico':
      return modelo === 1
        ? prestacaoServicoM1(company, client, fields)
        : prestacaoServicoM2(company, client, fields);
    case 'vistoria':
      return vistoriaM1(company, client, fields);
    case 'propostaSolar':
      return propostaSolarM1(company, client, fields);
    default:
      throw new Error(`Modelo estático não disponível para: ${type}. Use a geração por IA.`);
  }
}

// ════════════════════════════════════════════════════════════
// CONTRATO SOLAR — MODELO 1  (profissional, claro, comercial)
// ════════════════════════════════════════════════════════════
function contratoSolarM1(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const foro = company.cidade || str(f.foro_cidade) || str(client.cidade) || '___';
  const cidade = foro;
  const endInst = str(f.endereco_instalacao) !== '___' ? str(f.endereco_instalacao) : (client.endereco || '___');

  const isPJClient = (client as { tipo?: string }).tipo === 'PJ';
  const endInstCompleto = enderecoCompleto(endInst, client.bairro, client.cidade, client.uf);
  const enderecoCompletoClient = enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf);
  const clienteQualif = isPJClient
    ? `${client.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${client.cpf_cnpj || '___'}, com sede em ${enderecoCompletoClient || '___'}`
    : `${client.nome}, pessoa física, inscrita no CPF sob o nº ${client.cpf_cnpj || '___'}, residente e domiciliada em ${enderecoCompletoClient || '___'}`;

  return `CONTRATO DE FORNECIMENTO E INSTALAÇÃO DE
SISTEMA DE ENERGIA SOLAR FOTOVOLTAICA

Este contrato é celebrado entre:

CONTRATADA: ${company.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${company.cnpj}, com sede em ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}, doravante denominada simplesmente CONTRATADA.

CONTRATANTE: ${clienteQualif}, doravante denominado(a) simplesmente CONTRATANTE.

As partes, de comum acordo, celebram o presente contrato com base na transparência, na boa-fé e no interesse mútuo, sob as condições a seguir estabelecidas:


1. OBJETO DO CONTRATO

A CONTRATADA compromete-se a fornecer os equipamentos especificados, elaborar o projeto técnico, realizar a instalação completa e providenciar a homologação junto à concessionária de energia elétrica local, entregando ao CONTRATANTE um sistema de geração de energia solar fotovoltaica em pleno funcionamento.

Especificações do sistema contratado:

   Potência instalada:    ${str(f.potencia_kwp)} kWp
   Módulos:               ${str(f.quantidade_modulos)} unidade(s) — ${str(f.marca_modulos)}
   Inversores:            ${str(f.quantidade_inversores)} unidade(s) — ${str(f.tipo_inversor)} / ${str(f.marca_inversor)}
   Local de instalação:   ${endInstCompleto}

O escopo completo da CONTRATADA inclui: levantamento técnico no local, elaboração do projeto elétrico, aquisição e transporte dos equipamentos, instalação dos módulos, inversores e demais componentes, realização dos testes de funcionamento (comissionamento) e encaminhamento do pedido de conexão à concessionária de energia.

Adequações estruturais no imóvel — como reforço de telhado, terraplanagem ou obras civis — não estão incluídas no escopo deste contrato e serão informadas ao CONTRATANTE previamente, caso necessário, para deliberação conjunta.

Todos os serviços serão executados em conformidade com as normas da ABNT NBR 16690, com as resoluções normativas da ANEEL e com os requisitos técnicos da concessionária local de energia elétrica.


2. IDENTIFICAÇÃO E QUALIFICAÇÃO DAS PARTES

2.1. A CONTRATADA é uma empresa especializada no fornecimento, instalação e manutenção de sistemas fotovoltaicos, com experiência comprovada no setor de energia solar.

2.2. O CONTRATANTE declara ter tomado conhecimento das características do sistema adquirido, das condições do local de instalação e das especificações técnicas descritas neste instrumento.

2.3. Ambas as partes são capazes civilmente e firmam este contrato de forma livre e voluntária, sem qualquer vício de consentimento.


3. OBJETO DETALHADO — ETAPAS DOS SERVIÇOS

A execução dos serviços pela CONTRATADA seguirá as seguintes etapas:

a) Visita técnica e levantamento: avaliação detalhada do local de instalação, verificação da estrutura de suporte, da rede elétrica existente e das condições de acesso;

b) Projeto técnico: elaboração do projeto elétrico fotovoltaico conforme normas da ABNT e exigências da concessionária, incluindo memorial descritivo, diagramas unifilares e documentação de ART (Anotação de Responsabilidade Técnica);

c) Aquisição de materiais: fornecimento de todos os equipamentos e materiais descritos neste contrato, incluindo módulos, inversores, cabos, conectores, estruturas de fixação e dispositivos de proteção elétrica;

d) Instalação: execução da montagem física do sistema, instalação elétrica, fixação dos módulos na estrutura do telhado ou solo, instalação do inversor e realização de todas as conexões necessárias;

e) Comissionamento: testes de funcionamento e verificação dos parâmetros de operação do sistema antes da entrega ao CONTRATANTE;

f) Homologação: encaminhamento e acompanhamento do processo de solicitação de conexão junto à concessionária de energia elétrica, incluindo envio da documentação técnica e interligação da instalação à rede.


4. PRAZOS

Os prazos abaixo são contados a partir da data em que o CONTRATANTE entregar toda a documentação solicitada e efetuar o pagamento inicial previsto neste contrato:

a) Projeto técnico: até ${str(f.prazo_projeto_dias)} (${numExtenso(f.prazo_projeto_dias)}) dias úteis após o envio da documentação pelo CONTRATANTE;

b) Aprovação da concessionária: prazo médio de até ${str(f.prazo_aprovacao_dias)} (${numExtenso(f.prazo_aprovacao_dias)}) dias, podendo variar conforme a análise e cronograma interno da distribuidora de energia;

c) Instalação: até ${str(f.prazo_instalacao_dias)} (${numExtenso(f.prazo_instalacao_dias)}) dias úteis após a aprovação do projeto pela concessionária.

É importante destacar que o prazo de aprovação da concessionária está sujeito ao fluxo interno de cada distribuidora e pode sofrer variações por fatores alheios ao controle da CONTRATADA. Em todos os casos, a CONTRATADA manterá o CONTRATANTE informado sobre o andamento do processo e atuará de forma ativa para minimizar eventuais atrasos.

Os prazos ficam automaticamente suspensos em casos de: atraso na entrega de documentos pelo CONTRATANTE; necessidade de adequações no local de instalação; atrasos na distribuição de equipamentos pelos fabricantes; ou situações de força maior devidamente documentadas.


5. VALOR E CONDIÇÕES DE PAGAMENTO

O valor total deste contrato é de R$ ${curr(str(f.valor_total))} (${extenso(f.valor_total)}), a ser pago conforme as condições abaixo acordadas:

${str(f.condicoes_pagamento)}

O início dos serviços fica condicionado à confirmação do pagamento da primeira parcela.


6. GARANTIAS

A CONTRATADA oferece as seguintes garantias sobre este contrato:

a) Módulos fotovoltaicos: ${str(f.garantia_modulos_anos)} (${numExtenso(f.garantia_modulos_anos)}) anos de garantia, fornecida diretamente pelo fabricante, cobrindo defeitos de fabricação e degradação fora dos parâmetros técnicos informados em manual;

b) Inversor: ${str(f.garantia_inversor_anos)} (${numExtenso(f.garantia_inversor_anos)}) anos de garantia do fabricante, incluindo cobertura contra defeitos de funcionamento e falhas de componentes eletrônicos;

c) Serviços de instalação: ${str(f.garantia_instalacao_anos)} (${numExtenso(f.garantia_instalacao_anos)}) ano(s) de garantia sobre a execução dos serviços realizados pela CONTRATADA, cobrindo exclusivamente defeitos provenientes da instalação, como infiltrações causadas pela fixação, falhas em conexões elétricas ou problemas estruturais gerados durante a obra.

Vale destacar que as garantias dos equipamentos são administradas diretamente pelos respectivos fabricantes. Nos casos em que for necessário acionar a garantia de um equipamento, a CONTRATADA prestará suporte ao CONTRATANTE no processo de acionamento junto ao fabricante, facilitando os trâmites necessários.

A garantia perde a validade em situações de: uso inadequado do sistema; intervenções realizadas por terceiros não autorizados; danos causados por descargas elétricas, inundações, granizo ou outros eventos de força maior; ou modificações estruturais no imóvel que afetem o sistema após a instalação.

Em caso de quebra acidental de telhas durante a execução dos serviços, a CONTRATADA realizará a reposição das peças danificadas, sendo que a definição de responsabilidade levará em consideração as condições originais do material no momento da instalação.


7. OBRIGAÇÕES DO CONTRATANTE

Para que os serviços sejam executados dentro do prazo e com a qualidade esperada, o CONTRATANTE se compromete a:

a) Fornecer, no prazo de até 5 (cinco) dias úteis após a assinatura deste contrato, toda a documentação solicitada pela CONTRATADA, incluindo conta de energia elétrica, documentos do imóvel e documentos pessoais necessários para o projeto e homologação;

b) Garantir livre acesso ao imóvel nos dias e horários acordados para a realização da vistoria, da instalação e de eventuais visitas técnicas;

c) Certificar-se, antes da instalação, de que a estrutura do telhado está em condições adequadas para suportar o peso e as cargas do sistema fotovoltaico — caso haja dúvidas, a CONTRATADA poderá indicar um profissional para avaliação;

d) Verificar, com antecedência, se o padrão de entrada de energia elétrica está de acordo com as exigências da concessionária local; eventuais adequações no padrão são de responsabilidade do CONTRATANTE e poderão ser realizadas pela CONTRATADA mediante orçamento adicional;

e) Efetuar os pagamentos nas datas acordadas, conforme condições estabelecidas na cláusula 5;

f) Não realizar, por conta própria ou por meio de terceiros, qualquer modificação, intervenção ou manutenção no sistema instalado sem autorização prévia da CONTRATADA;

g) Comunicar à CONTRATADA, no menor prazo possível, qualquer anomalia, alarme ou irregularidade no funcionamento do sistema.


8. HOMOLOGAÇÃO JUNTO À CONCESSIONÁRIA

A homologação — etapa que permite a interligação do sistema fotovoltaico à rede elétrica e a geração de créditos de energia — depende da aprovação e do cronograma interno da concessionária de energia elétrica local.

A CONTRATADA é responsável por elaborar e enviar toda a documentação técnica exigida, além de acompanhar o processo junto à distribuidora. No entanto, os prazos de análise e aprovação são definidos exclusivamente pela concessionária, estando fora do controle direto da CONTRATADA.

Durante o período de análise, o sistema pode estar instalado, mas não conectado à rede. Após a aprovação, será realizada a interligação e o sistema passará a operar em sua capacidade total. A CONTRATADA informará o CONTRATANTE sobre cada etapa do processo de homologação.


9. DESEMPENHO DO SISTEMA

O sistema fornecido foi dimensionado com base no perfil de consumo informado pelo CONTRATANTE e nos dados históricos de irradiância solar da região de instalação. A estimativa de geração apresentada na proposta comercial constitui uma projeção técnica fundamentada, mas não representa uma garantia de produção exata.

A geração real de energia poderá apresentar variação de até 10% (dez por cento) em relação à estimativa, em razão de fatores naturais e externos, como: variações climáticas e de irradiância ao longo do ano; temperatura ambiente, que pode afetar o rendimento dos módulos; sombreamento por árvores, edificações ou estruturas próximas; qualidade e estabilidade da rede elétrica local.

A CONTRATADA não se responsabiliza por variações de geração decorrentes desses fatores externos. O monitoramento do sistema pode ser feito por meio de aplicativo disponibilizado pelo fabricante do inversor, permitindo ao CONTRATANTE acompanhar a produção em tempo real.


10. ENTREGA E VISTORIA TÉCNICA

Ao término da instalação, antes da entrega formal do sistema ao CONTRATANTE, será realizada uma vistoria técnica conjunta, na qual a CONTRATADA apresentará o sistema instalado, demonstrará seu funcionamento e esclarecerá eventuais dúvidas sobre a operação.

A CONTRATADA emitirá, após o comissionamento, um laudo técnico de conformidade atestando que o sistema foi instalado de acordo com as normas vigentes e com as especificações contratadas.

A entrega formal do sistema será documentada por Termo de Recebimento, a ser assinado pelo CONTRATANTE, declarando que recebeu o sistema em perfeitas condições de funcionamento e que foi devidamente orientado sobre sua operação.


11. MANUTENÇÃO

Durante o período de garantia da instalação, a CONTRATADA prestará assistência técnica sem custo adicional nos casos de defeitos cobertos pela garantia prevista na cláusula 6.

Após o encerramento do período de garantia, a CONTRATADA poderá oferecer serviço de manutenção preventiva e corretiva mediante proposta específica, que poderá incluir: inspeção visual e elétrica dos módulos e conexões; limpeza dos módulos fotovoltaicos; verificação e atualização de firmware do inversor; análise de desempenho do sistema; e relatório técnico de funcionamento.

Para preservar o desempenho do sistema ao longo do tempo, recomenda-se a realização de limpeza periódica dos módulos e a verificação das conexões ao menos uma vez por ano.


12. RESCISÃO

Este contrato poderá ser encerrado nas seguintes situações:

a) Por mútuo acordo entre as partes, a qualquer momento, mediante formalização por escrito;

b) Por iniciativa de qualquer das partes, mediante comunicação prévia de 30 (trinta) dias, sem necessidade de justificativa;

c) De imediato, pela parte prejudicada, em caso de descumprimento grave das obrigações previstas neste instrumento, desde que a parte infratora seja notificada previamente com prazo de 5 (cinco) dias úteis para sanar a irregularidade.

Na hipótese de rescisão antes do início da execução dos serviços, por iniciativa do CONTRATANTE sem justa causa, será retido um percentual de 10% (dez por cento) sobre o valor total do contrato, a título de cobertura dos custos administrativos e de projeto já incorridos pela CONTRATADA.

Se a rescisão ocorrer após o início dos serviços, os valores correspondentes ao trabalho já realizado e aos materiais já adquiridos ou instalados deverão ser apurados e compensados proporcionalmente entre as partes, de forma justa e documentada.

Em caso de rescisão por culpa exclusiva da CONTRATADA, os valores eventualmente pagos pelo CONTRATANTE que não correspondam a serviços ou materiais efetivamente entregues serão devolvidos integralmente no prazo de 15 (quinze) dias.


13. DISPOSIÇÕES GERAIS

a) Alterações: qualquer modificação nas condições deste contrato deverá ser formalizada por Termo Aditivo, assinado por ambas as partes;

b) Cessão: os direitos e obrigações deste contrato não poderão ser transferidos a terceiros sem o consentimento expresso e por escrito da outra parte;

c) Confidencialidade: as informações técnicas e comerciais trocadas em razão deste contrato são de caráter reservado e não deverão ser divulgadas a terceiros sem autorização;

d) Independência das cláusulas: a eventual nulidade ou ineficácia de qualquer disposição deste instrumento não afetará a validade das demais;

e) Integralidade: este documento representa a totalidade do acordado entre as partes, substituindo qualquer proposta, orçamento ou entendimento verbal anterior sobre o mesmo objeto.


14. FORO

As partes elegem, de comum acordo, o Foro da Comarca de ${foro} para dirimir eventuais dúvidas, divergências ou litígios decorrentes deste contrato, renunciando a qualquer outro por mais privilegiado que seja.


15. ASSINATURAS

E, por estarem de acordo com todos os termos e condições acima estabelecidos, as partes assinam o presente contrato em 2 (duas) vias de igual teor e forma.

${cidade}, ${today}.






________________________________
CONTRATADA:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
CONTRATANTE:
${client.nome.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}
`;
}

// ════════════════════════════════════════════════════════════
// CONTRATO SOLAR — MODELO 2  (formato clássico, direto)
// ════════════════════════════════════════════════════════════
function contratoSolarM2(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const foro = company.cidade || str(f.foro_cidade) || str(client.cidade) || '___';
  const cidade = foro;
  const endInst = str(f.endereco_instalacao) !== '___' ? str(f.endereco_instalacao) : (client.endereco || '___');

  const isPJClient = (client as { tipo?: string }).tipo === 'PJ';
  const endInstCompleto = enderecoCompleto(endInst, client.bairro, client.cidade, client.uf);
  const enderecoCompletoClient = enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf);
  const companyLocalizacao = [company.cidade, company.uf].filter(Boolean).join(' ');
  const clienteIdent = isPJClient
    ? `${client.nome}, CNPJ nº ${client.cpf_cnpj || '___'}, sediada em ${enderecoCompletoClient || '___'}`
    : `${client.nome}, CPF nº ${client.cpf_cnpj || '___'}, residente na ${enderecoCompletoClient || '___'}`;

  return `CONTRATO DE SERVIÇOS DE INSTALAÇÃO DE USINA FOTOVOLTAICA

Entre as partes: ${company.nome}, inscrita no CNPJ sob o nº ${company.cnpj}, ${companyLocalizacao}, doravante denominada CONTRATADA,

e ${clienteIdent}, doravante denominado CLIENTE, tem-se ajustado o presente CONTRATO, conforme os seguintes termos e condições:


1. OBJETO

A CONTRATADA se compromete a instalar uma usina fotovoltaica com capacidade operacional de ${str(f.potencia_kwp)} kWp, fornecendo materiais, equipamentos e executando o comissionamento.

Os componentes principais incluem ${str(f.quantidade_modulos)} módulos de ${str(f.marca_modulos)}, ${str(f.quantidade_inversores)} inversor ${str(f.tipo_inversor)} ${str(f.marca_inversor)}, cabos e conectores. Todas as especificações técnicas seguirão as normas e resoluções aplicáveis da Agência Nacional de Energia Elétrica (ANEEL).

Local de instalação: ${endInstCompleto}

Fica no escopo do CLIENTE deixar a área em condições para implantação da usina, como por exemplo limpeza e terraplanagem quando se fizer necessário.


2. PRAZOS E EXECUÇÃO

A CONTRATADA deverá:
- Submeter o projeto técnico em até ${str(f.prazo_projeto_dias)} (${numExtenso(f.prazo_projeto_dias)}) dias após o cumprimento das obrigações pelo CLIENTE.
- Aguardar aprovação de órgãos reguladores, o que deverá ocorrer em até ${str(f.prazo_aprovacao_dias)} (${numExtenso(f.prazo_aprovacao_dias)}) dias, salvo pendências atribuídas ao CLIENTE ou terceiros.
- Realizar a instalação completa em até ${str(f.prazo_instalacao_dias)} (${numExtenso(f.prazo_instalacao_dias)}) dias úteis após a aprovação, podendo haver extensão de prazo devido a fatores externos, como condições climáticas adversas ou exigências das concessionárias locais de energia.

Nota: Os prazos serão suspensos em caso de atrasos por responsabilidade do CLIENTE, dos fabricantes ou de órgãos reguladores. Em situações de força maior, os prazos serão reajustados de acordo com novo cronograma acordado entre as partes.


3. VALOR E CONDIÇÕES DE PAGAMENTO

O valor total dos serviços é de R$ ${curr(str(f.valor_total))} (${extenso(f.valor_total)}), sendo o pagamento realizado da seguinte forma:

${str(f.condicoes_pagamento)}


4. GARANTIAS E MANUTENÇÃO

Equipamentos: As garantias dos equipamentos são exclusivamente do fabricante, cobrindo ${str(f.garantia_modulos_anos)} (${numExtenso(f.garantia_modulos_anos)}) anos para módulos fotovoltaicos, ${str(f.garantia_inversor_anos)} (${numExtenso(f.garantia_inversor_anos)}) anos para o inversor, e prazos específicos para demais componentes conforme manual do fabricante.

Instalação: A garantia de instalação é de ${str(f.garantia_instalacao_anos)} (${numExtenso(f.garantia_instalacao_anos)}) anos, válida somente para defeitos de instalação devidamente constatados por laudo técnico.

Exclusões de Garantia: A garantia não se aplica em casos de mau uso, intervenções de terceiros sem autorização da CONTRATADA, ou danos causados por eventos de força maior, como tempestades e sobrecargas da rede de energia.

Fica acordado entre as partes que, caso ocorram quebras de telhas durante a execução do serviço, será realizada a reposição das mesmas. A responsabilidade pela substituição será definida de comum acordo entre as partes, considerando a fragilidade e as condições do material.


5. OBRIGAÇÕES DO CLIENTE

O CLIENTE compromete-se a:
- Disponibilizar toda a documentação necessária para a elaboração do projeto técnico e fornecer acesso adequado ao local de instalação, incluindo rede elétrica e pontos de aterramento conforme normas vigentes.
- Monitorar a integridade do local de instalação e reportar eventuais falhas à CONTRATADA. Modificações no imóvel que prejudiquem a operação do sistema fotovoltaico são de responsabilidade do CLIENTE.


6. RESCISÃO CONTRATUAL

Este contrato poderá ser rescindido a qualquer momento, desde que uma das partes comunique a outra com antecedência mínima de 30 dias, assumindo a parte responsável os custos e penalidades decorrentes. Em caso de rescisão por descumprimento, será cobrada multa de 10% sobre o valor total do contrato.


7. DISPOSIÇÕES GERAIS

Confidencialidade: As partes concordam em manter a confidencialidade sobre as informações trocadas durante a execução do presente contrato.
Cessão de Direitos: Nenhuma das partes poderá transferir seus direitos e obrigações sob este contrato sem o consentimento por escrito da outra parte.
Alterações: Qualquer alteração neste contrato deverá ser formalizada por meio de termo aditivo assinado por ambas as partes.


8. DESEMPENHO E GERAÇÃO DE ENERGIA

O desempenho estimado da usina é baseado em condições climáticas e operacionais normais.
A geração de energia pode variar até 10% devido a condições climáticas e características do local.
A CONTRATADA não se responsabiliza por perdas de geração de energia decorrentes de fatores externos ou mudanças estruturais no local de instalação, tais como sombras adicionais.


9. MANUTENÇÃO PREVENTIVA E CORRETIVA

Após o período de garantia, a CONTRATADA poderá oferecer um serviço de manutenção preventiva e corretiva, mediante a contratação específica entre as partes. Esse serviço incluirá verificação de funcionamento, limpeza dos módulos e ajustes técnicos, caso necessários.


10. VISTORIA TÉCNICA E DOCUMENTAÇÃO DE CONFORMIDADE

Ao término da instalação, será realizada uma vistoria técnica para avaliar a conformidade do sistema com os padrões de segurança e regulamentações vigentes. A CONTRATADA emitirá um laudo técnico documentando as condições de instalação, que deverá ser assinado por ambas as partes.


11. TRANSFERÊNCIA DE CONTRATO E USINA

O CLIENTE poderá transferir este contrato para terceiros, mediante autorização expressa da CONTRATADA e desde que o novo titular cumpra com as obrigações contratuais aqui previstas.


12. RESPONSABILIDADES AMBIENTAIS E SUSTENTABILIDADE

As partes reconhecem a natureza sustentável deste contrato e comprometem-se a atuar de forma a minimizar impactos ambientais durante e após a instalação. O CLIENTE concorda em manter a área de instalação livre de obstruções e a CONTRATADA assegura que todos os materiais e equipamentos usados estão de acordo com as normas ambientais.


13. MULTA POR INTERRUPÇÃO NÃO AUTORIZADA

Caso o CLIENTE ou terceiros não autorizados interfiram no sistema sem a aprovação da CONTRATADA, estará sujeito a multa de 5% do valor total do contrato, além da perda das garantias aplicáveis.


14. FORO

As partes elegem o Foro da Comarca de ${foro} para dirimir eventuais controvérsias decorrentes deste contrato, renunciando a qualquer outro foro.

Por estarem de pleno acordo com os termos deste contrato, as partes assinam o presente documento.

${cidade}, ${today}.






________________________________
EMPRESA CONTRATADA:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
CLIENTE CONTRATANTE:
${client.nome.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}
`;
}

// ════════════════════════════════════════════════════════════
// PROCURAÇÃO — MODELO 1  (formato padrão)
// ════════════════════════════════════════════════════════════
function procuracaoM1(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const cidade = str(f.foro_cidade || (client as any).cidade || company.cidade || '___');
  const concessionaria = str(f.concessionaria);
  const uc = str(f.uc);

  // Qualificação do engenheiro
  let engQualif = '';
  if (company.engenheiro_nome) {
    let q = company.engenheiro_nome.toUpperCase();
    if (company.engenheiro_profissao) q += `, ${company.engenheiro_profissao}`;
    if (company.engenheiro_nacionalidade) q += `, ${company.engenheiro_nacionalidade}`;
    if (company.engenheiro_estado_civil) q += `, ${company.engenheiro_estado_civil}`;
    if (company.engenheiro_crea) q += `, inscrito(a) no ${company.engenheiro_crea}`;
    if (company.engenheiro_cpf) q += `, CPF nº ${company.engenheiro_cpf}`;
    if (company.engenheiro_rg) q += `, RG nº ${company.engenheiro_rg}`;
    if (company.engenheiro_endereco) q += `, residente e domiciliado(a) na ${company.engenheiro_endereco}`;
    engQualif = q;
  }

  // Qualificação do técnico
  let tecQualif = '';
  if (company.tecnico_nome) {
    let q = company.tecnico_nome.toUpperCase();
    if (company.tecnico_nacionalidade) q += `, ${company.tecnico_nacionalidade}`;
    if (company.tecnico_estado_civil) q += `, ${company.tecnico_estado_civil}`;
    if ((company as any).tecnico_crt_cft) q += `, ${(company as any).tecnico_crt_cft}`;
    if (company.tecnico_cpf) q += `, CPF nº ${company.tecnico_cpf}`;
    if (company.tecnico_rg) q += `, RG nº ${company.tecnico_rg}`;
    if (company.tecnico_endereco) q += `, residente e domiciliado(a) na ${company.tecnico_endereco}`;
    tecQualif = q;
  }

  const temEng = !!engQualif;
  const temTec = !!tecQualif;
  const plural = temEng && temTec;

  let outorgadosBloco = '';
  if (plural) {
    outorgadosBloco = `1º OUTORGADO: ${engQualif};\n\n2º OUTORGADO: ${tecQualif};`;
  } else if (temEng) {
    outorgadosBloco = `OUTORGADO: ${engQualif};`;
  } else if (temTec) {
    outorgadosBloco = `OUTORGADO: ${tecQualif};`;
  } else {
    outorgadosBloco = 'OUTORGADO: ___';
  }

  const verboProcurador = plural ? 'seus bastantes procuradores' : 'seu(ua) bastante procurador(a)';
  const verboOutorgados = plural ? 'os outorgados representem' : 'o(a) outorgado(a) represente';

  return `PROCURAÇÃO

Pelo presente instrumento particular de procuração,

OUTORGANTE: ${client.nome}
CPF/CNPJ: ${client.cpf_cnpj || '___'}
Endereço: ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}${client.cep ? `\nCEP: ${client.cep}` : ''}
Unidade Consumidora (UC): ${uc}
Concessionária: ${concessionaria}

nomeia e constitui como ${verboProcurador}:

${outorgadosBloco}

conferindo-lhe(s) amplos poderes para que ${verboOutorgados} perante a concessionária ${concessionaria}, em todos os assuntos relativos à UC nº ${uc}, incluindo: apresentação e protocolo de projetos técnicos, análise de carga, troca de titularidade, atualização cadastral, assinatura de contratos de conexão e quaisquer outros atos necessários à homologação e operação do sistema fotovoltaico.

${cidade}, ${today}




________________________________
${client.nome}
OUTORGANTE
`;
}

// ════════════════════════════════════════════════════════════
// PROCURAÇÃO — MODELO 2  (formato jurídico completo)
// ════════════════════════════════════════════════════════════
function procuracaoM2(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const cidade = str(f.foro_cidade || (client as any).cidade || company.cidade || '___');
  const concessionaria = str(f.concessionaria);
  const uc = str(f.uc);

  // Qualificação do engenheiro
  let engQualif = '';
  if (company.engenheiro_nome) {
    let q = company.engenheiro_nome.toUpperCase();
    if (company.engenheiro_profissao) q += `, ${company.engenheiro_profissao}`;
    if (company.engenheiro_nacionalidade) q += `, ${company.engenheiro_nacionalidade}`;
    if (company.engenheiro_estado_civil) q += `, ${company.engenheiro_estado_civil}`;
    if (company.engenheiro_crea) q += `, inscrito(a) no ${company.engenheiro_crea}`;
    if (company.engenheiro_cpf) q += `, CPF nº ${company.engenheiro_cpf}`;
    if (company.engenheiro_rg) q += `, RG nº ${company.engenheiro_rg}`;
    if (company.engenheiro_endereco) q += `, residente e domiciliado(a) na ${company.engenheiro_endereco}`;
    engQualif = q;
  }

  // Qualificação do técnico
  let tecQualif = '';
  if (company.tecnico_nome) {
    let q = company.tecnico_nome.toUpperCase();
    if (company.tecnico_nacionalidade) q += `, ${company.tecnico_nacionalidade}`;
    if (company.tecnico_estado_civil) q += `, ${company.tecnico_estado_civil}`;
    if ((company as any).tecnico_crt_cft) q += `, ${(company as any).tecnico_crt_cft}`;
    if (company.tecnico_cpf) q += `, CPF nº ${company.tecnico_cpf}`;
    if (company.tecnico_rg) q += `, RG nº ${company.tecnico_rg}`;
    if (company.tecnico_endereco) q += `, residente e domiciliado(a) na ${company.tecnico_endereco}`;
    tecQualif = q;
  }

  const temEng = !!engQualif;
  const temTec = !!tecQualif;
  const plural = temEng && temTec;

  let outorgadosBloco = '';
  if (plural) {
    outorgadosBloco = `1º OUTORGADO: ${engQualif};\n\n2º OUTORGADO: ${tecQualif};`;
  } else if (temEng) {
    outorgadosBloco = `OUTORGADO: ${engQualif};`;
  } else if (temTec) {
    outorgadosBloco = `OUTORGADO: ${tecQualif};`;
  } else {
    outorgadosBloco = 'OUTORGADO: ___';
  }

  const tituloProcurador = plural ? 'seus legítimos procuradores' : 'seu(ua) legítimo(a) procurador(a)';
  const pronomeOutorgados = plural ? 'lhes' : 'lhe';
  const verboCriterio = plural ? 'dos procuradores' : 'do(a) procurador(a)';

  return `INSTRUMENTO PARTICULAR DE PROCURAÇÃO

SAIBAM todos quantos este instrumento virem que, na data abaixo indicada,

OUTORGANTE: ${client.nome}, inscrito(a) no CPF/CNPJ sob o nº ${client.cpf_cnpj || '___'}, residente e domiciliado(a) à ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}${client.cep ? `, CEP ${client.cep}` : ''}, doravante denominado(a) simplesmente OUTORGANTE,

pelo presente instrumento particular e na melhor forma de direito, nomeia e constitui como ${tituloProcurador}:

${outorgadosBloco}

conferindo-${pronomeOutorgados} os seguintes poderes especiais:

   a) Representar o(a) OUTORGANTE junto à concessionária de energia elétrica ${concessionaria}, em todos os assuntos relacionados à Unidade Consumidora de nº ${uc};

   b) Assinar e protocolar requerimentos, projetos técnicos, formulários, contratos de conexão e todos os documentos necessários ao processo de homologação e conexão do sistema fotovoltaico;

   c) Solicitar análise de carga, troca de titularidade, atualização cadastral e quaisquer serviços técnicos junto à ${concessionaria};

   d) Receber notificações, intimações e quaisquer comunicados em nome do(a) OUTORGANTE;

   e) Substabelecer este mandato, no todo ou em parte, com ou sem reserva de iguais poderes, a critério ${verboCriterio}.

Esta procuração terá validade de 1 (um) ano a contar da data de sua assinatura, salvo revogação expressa anterior.

O(A) OUTORGANTE declara que as informações constantes neste instrumento são verdadeiras e assume integral responsabilidade pelo seu conteúdo.

${cidade}, ${today}




________________________________
${client.nome}
OUTORGANTE — CPF/CNPJ: ${client.cpf_cnpj || '___'}
`;
}
// ════════════════════════════════════════════════════════════
// PROPOSTA DE BANCO — MODELO 1  (formato Documento2.pdf)
// ════════════════════════════════════════════════════════════
function propostaBancoM1(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const banco = str(f.banco);
  const agencia = str(f.agencia);
  const conta = str(f.conta);
  const valorTotal = parseBRL(f.valor_total);
  const valorEq = parseBRL(f.valor_equipamentos) || valorTotal * 0.82;
  const valorMo = parseBRL(f.valor_mao_de_obra) || valorTotal * 0.18;
  const validadeDias = str(f.validade_dias || '30');
  const descSistema = str(f.descricao_sistema);
  const clienteEndereco = enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf);
  const clienteCep = client.cep || '___';
  const equipamentos = equipamentosTexto(f);

  return `${company.nome.toUpperCase()}
CNPJ: ${company.cnpj}${company.endereco ? `\n${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}` : ''}

PROPOSTA DE BANCO

CLIENTE: ${client.nome.toUpperCase()}
BANCO: ${banco}
AGÊNCIA: ${agencia}
CONTA CORRENTE: ${conta}

Encaminhamos a V.Sa. os documentos necessários para formalização da operação de crédito para aquisição de sistema fotovoltaico.

PARA APROVAÇÃO DO FATURAMENTO ORÇAMENTO COM OS SEGUINTES DADOS:

• Nome do comprador, CPF, endereço;
• Descrição completa do equipamento (quantidade, marca, modelo, ano, etc.);
• Prazo de entrega;

Autorizamos o acesso aos registros contábeis da mesma, assinada abaixo pelo seu representante legal.

Declaramos, ainda, a esse Agente Financeiro, que temos plena ciência das regras emanadas pela Agência Especial de Financiamento Industrial, no tocante a formalização das vendas dos nossos produtos, através daquela modalidade, principalmente no que tange a elaboração e apresentação de orçamentos, notas fiscais, faturas, bem como aquelas relativas à efetiva entrega do(s) bem(ns).






________________________________
${client.nome.toUpperCase()}
${client.cpf_cnpj || '___'}






________________________________
${company.nome.toUpperCase()}

════════════════════════════════════════════════════════════

CNPJ: ${company.cnpj}

NOME: ${client.nome.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}
END. CORRESP: ${clienteEndereco}${clienteCep !== '___' ? `   CEP: ${clienteCep}` : ''}

Prezado(s) Senhor(s), atendendo solicitação de V.Sa., fornecemos características e preço público à vista do produto abaixo.

${descSistema}

QTD.   EQUIPAMENTOS
${equipamentos}

NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40% E INFERIOR OU IGUAL A 70%

VALOR TOTAL: R$ ${fmtBRL(valorTotal)}
VALOR EQUIPAMENTO: R$ ${fmtBRL(valorEq)}
VALOR MÃO DE OBRA: R$ ${fmtBRL(valorMo)}
DATA DE EMISSÃO: ${today}
VALIDADE DA PROPOSTA: ${validadeDias} (${numExtenso(validadeDias)}) dias






________________________________
${client.nome.toUpperCase()}
${client.cpf_cnpj || '___'}






________________________________
${company.nome.toUpperCase()}
${company.cnpj}
`;
}

// ════════════════════════════════════════════════════════════
// PROPOSTA DE BANCO — MODELO 2  (carta formal com tabela)
// ════════════════════════════════════════════════════════════
function propostaBancoM2(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const banco = str(f.banco);
  const agencia = str(f.agencia);
  const conta = str(f.conta);
  const concessionaria = str(f.concessionaria);
  const valorTotal = parseBRL(f.valor_total);
  const valorEq = parseBRL(f.valor_equipamentos) || valorTotal * 0.82;
  const valorMo = parseBRL(f.valor_mao_de_obra) || valorTotal * 0.18;
  const validadeDias = str(f.validade_dias || '30');
  const descSistema = str(f.descricao_sistema);
  const equipamentos = equipamentosTexto(f);
  const clienteEndereco = enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf);
  const clienteCep = client.cep || '___';
  const clienteBairro = client.bairro || '___';
  const clienteCidade = client.cidade || '___';
  const clienteUf = client.uf || '___';

  return `PROPOSTA TÉCNICA E COMERCIAL
PARA FINS DE FINANCIAMENTO BANCÁRIO

──────────────────────────────────────────────────────────────

DADOS DO TOMADOR DO CRÉDITO

Nome / Razão Social:  ${client.nome.toUpperCase()}
CPF / CNPJ:           ${client.cpf_cnpj || '___'}
Endereço:             ${clienteEndereco}
CEP:                  ${clienteCep}
Bairro:               ${clienteBairro}
Cidade / UF:          ${clienteCidade} — ${clienteUf}

──────────────────────────────────────────────────────────────

DADOS DA INSTITUIÇÃO FINANCEIRA

Banco:                ${banco}
Agência:              ${agencia}
Conta Corrente:       ${conta}
Concessionária:       ${concessionaria}

──────────────────────────────────────────────────────────────

EMPRESA FORNECEDORA / INSTALADORA

Razão Social:         ${company.nome.toUpperCase()}
CNPJ:                 ${company.cnpj}
Endereço:             ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}

──────────────────────────────────────────────────────────────

DESCRIÇÃO DO SISTEMA FOTOVOLTAICO

${descSistema}

──────────────────────────────────────────────────────────────

RELAÇÃO DE EQUIPAMENTOS E SERVIÇOS

QTD.   ITEM / DESCRIÇÃO
${equipamentos}

──────────────────────────────────────────────────────────────

COMPOSIÇÃO DE VALORES

   Equipamentos e materiais:         R$ ${fmtBRL(valorEq)}
   Mão de obra e instalação:         R$ ${fmtBRL(valorMo)}
                                    ─────────────────────
   VALOR TOTAL DO PROJETO:           R$ ${fmtBRL(valorTotal)}

Data de emissão:      ${today}
Validade da proposta: ${validadeDias} (${numExtenso(validadeDias)}) dias corridos

──────────────────────────────────────────────────────────────

DECLARAÇÕES

Declaramos, para os devidos fins junto à ${banco}, que:

1. O orçamento acima representa fielmente os preços praticados pela empresa para fornecimento e instalação do sistema fotovoltaico descrito.

2. Os equipamentos listados são novos, de primeira linha e acompanhados de nota fiscal e certificado de garantia do fabricante.

3. O prazo estimado de instalação após liberação do crédito é de até ${str(f.prazo_instalacao_dias) || '30'} (${numExtenso(f.prazo_instalacao_dias || '30')}) dias úteis.

4. A empresa possui capacidade técnica e operacional para execução dos serviços descritos nesta proposta.

5. Estamos cientes das normas da Agência Especial de Financiamento Industrial relativas à formalização de vendas financiadas, comprometendo-nos a apresentar nota fiscal, documentação técnica e comprovante de entrega dos bens quando solicitados.

Autorizamos o acesso aos registros contábeis desta empresa, assinada abaixo pelo seu representante legal.

──────────────────────────────────────────────────────────────

NOTA: Este documento é destinado exclusivamente à análise de crédito junto à instituição financeira acima identificada. Não constitui contrato de prestação de serviços.

──────────────────────────────────────────────────────────────

${clienteCidade}, ${today}.






________________________________        ________________________________
TOMADOR DO CRÉDITO:                     EMPRESA FORNECEDORA:
${client.nome.toUpperCase()}            ${company.nome.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}  CNPJ: ${company.cnpj}
`;
}

// ════════════════════════════════════════════════════════════
// CONTRATO VENDEDOR — Representação comercial autônoma (PF ou PJ)
// ════════════════════════════════════════════════════════════
function contratoPjM1(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const foro = str(f.foro_cidade) === '___' ? (company.cidade || '___') : str(f.foro_cidade);
  const cidade = company.cidade || foro;
  const comissao = str(f.percentual_comissao) === '___' ? '3' : str(f.percentual_comissao);
  const adiantamento = str(f.adiantamento_quinzenal) === '___' ? '900,00' : str(f.adiantamento_quinzenal);
  const meta = str(f.meta_semanal) === '___' ? '2' : str(f.meta_semanal);

  const isPJ = client.tipo === 'PJ';
  const contratadoQualif = isPJ
    ? `${client.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${client.cpf_cnpj || '___'}, com sede em ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}, neste ato representada por ${client.representante_nome || '___'}, inscrito(a) no CPF sob o nº ${client.representante_cpf || '___'}`
    : `${client.nome}, CPF nº ${client.cpf_cnpj || '___'}, residente em ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}`;
  const signatario = isPJ ? client.representante_nome || client.nome : client.nome;
  const docTipo = isPJ ? 'CNPJ' : 'CPF';

  // Bloco 6.3/6.4 — retenções e recomendação MEI só fazem sentido pra PF
  const bloco6 = isPJ
    ? `6.3. O(A) CONTRATADO(A) é responsável pelo recolhimento de todos os tributos incidentes sobre os valores recebidos (ISS, IRPJ, CSLL, PIS, COFINS, contribuições previdenciárias e demais), bem como pela emissão da Nota Fiscal de Serviços (NFS-e) correspondente.`
    : `6.3. Por se tratar de prestação de serviços por pessoa física, a CONTRATANTE efetuará as retenções legais obrigatórias na fonte (IRRF e INSS — contribuinte individual), nos termos da legislação vigente. O CONTRATADO é responsável pelo recolhimento de eventuais tributos complementares (ISS como autônomo, ajuste anual de IRPF e demais obrigações acessórias).

6.4. A CONTRATANTE recomenda ao CONTRATADO a constituição de pessoa jurídica (MEI ou ME), hipótese em que este contrato poderá ser substituído por instrumento na modalidade PJ, mediante aditivo.`;

  return `${company.nome.toUpperCase()}
CNPJ: ${company.cnpj}
${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}

CONTRATO DE PRESTAÇÃO DE SERVIÇOS COMERCIAIS
Representação comercial autônoma — Energia solar fotovoltaica


1. PARTES

CONTRATANTE: ${company.nome}, inscrita no CNPJ nº ${company.cnpj}, com sede em ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}.

CONTRATADO: ${contratadoQualif}.


2. OBJETO

O CONTRATADO prestará, de forma autônoma, serviços comerciais de prospecção, abordagem, apresentação e negociação com potenciais clientes, visando à venda de sistemas de energia solar fotovoltaica comercializados pela CONTRATANTE, até a assinatura do contrato pelo cliente final.

Não integram este objeto a execução técnica, instalação, projeto, homologação ou pós-venda.


3. NATUREZA DA RELAÇÃO

As partes declaram que a presente relação é estritamente civil e comercial, regida pelo Código Civil e, no que couber, pela Lei nº 4.886/65, NÃO gerando vínculo empregatício, em razão dos seguintes pressupostos, livremente pactuados:

a) autonomia plena do CONTRATADO na organização da própria atividade;
b) ausência de subordinação, jornada, horário, rotina ou local de trabalho fixados pela CONTRATANTE;
c) ausência de exclusividade e de dependência econômica;
d) assunção, pelo CONTRATADO, dos riscos da atividade que exerce.

O CONTRATADO poderá definir seus próprios métodos, canais e horários de prospecção, atuar de qualquer localidade e prestar serviços a outras empresas, vedada apenas a representação de concorrentes diretos da CONTRATANTE no mesmo segmento.

A CONTRATANTE poderá estabelecer metas, padrões mínimos de qualidade na abordagem ao cliente e diretrizes de posicionamento de marca, sem que isso configure subordinação.


4. REMUNERAÇÃO POR RESULTADO

4.1. O CONTRATADO fará jus à comissão de ${comissao}% (${numExtensoDecimal(comissao)} por cento) calculada sobre o valor líquido efetivamente recebido pela CONTRATANTE em cada contrato de venda intermediado, observado o seguinte:

a) a comissão é devida apenas após a assinatura do contrato pelo cliente final E o efetivo recebimento do pagamento pela CONTRATANTE;
b) propostas, reservas, aceites verbais ou contratos não pagos NÃO geram direito à comissão;
c) em caso de pagamento parcelado, a comissão será paga proporcionalmente, conforme o efetivo recebimento de cada parcela;
d) em caso de cancelamento, distrato, inadimplência, devolução ou renegociação com redução do valor, a comissão será recalculada pro rata sobre o valor efetivamente recebido, podendo a CONTRATANTE compensar valores já adiantados em comissões futuras.


5. ADIANTAMENTO DE COMISSÕES

5.1. A CONTRATANTE poderá conceder ao CONTRATADO adiantamento quinzenal de R$ ${adiantamento} (${numExtensoDecimal(adiantamento.replace(/[^0-9,]/g, '').split(',')[0]) || adiantamento} reais), pago nos dias 5 e 20 de cada mês, a título de antecipação de comissões futuras.

5.2. Os valores adiantados serão integralmente compensados com as comissões que vierem a ser apuradas. Eventual saldo devedor do CONTRATADO ao final de cada trimestre poderá ser compensado em comissões futuras ou exigido pela CONTRATANTE em caso de rescisão.

5.3. O adiantamento NÃO constitui salário, piso, remuneração fixa ou qualquer obrigação de natureza trabalhista, tratando-se exclusivamente de antecipação de valor variável, sem habitualidade salarial, podendo ser suspenso pela CONTRATANTE a qualquer tempo, com aviso prévio de 30 (trinta) dias, ou imediatamente nas hipóteses do item 5.4.

5.4. O adiantamento será automaticamente suspenso quando o CONTRATADO:

a) não registrar nenhuma venda em 30 (trinta) dias consecutivos;
b) estiver em afastamento voluntário por qualquer motivo;
c) descumprir qualquer obrigação prevista neste contrato.

5.5. Meta comercial de referência: ${meta} (${numExtensoDecimal(meta)}) venda${meta === '1' ? '' : 's'} semanal${meta === '1' ? '' : 'is'}. O não atingimento da meta NÃO gera multa, desconto ou penalidade, mas autoriza a revisão ou suspensão do adiantamento previsto neste item.


6. PAGAMENTO E TRIBUTOS

6.1. As comissões apuradas em cada mês serão pagas até o 10º (décimo) dia útil do mês subsequente, mediante ${isPJ ? 'Nota Fiscal de Serviços (NFS-e) emitida' : 'recibo de prestação de serviços (RPA) emitido'} pelo CONTRATADO, por transferência bancária em conta de sua titularidade.

6.2. Eventuais divergências no extrato de comissões devem ser apontadas em até 5 (cinco) dias úteis do recebimento, sob pena de aceitação tácita.

${bloco6}


7. OBRIGAÇÕES DO CONTRATADO

a) atuar com ética, integridade e profissionalismo na representação da CONTRATANTE;
b) utilizar somente os materiais, tabelas, condições e propostas comerciais aprovados pela CONTRATANTE, vedada a concessão de descontos ou benefícios não autorizados;
c) comunicar imediatamente qualquer reclamação, litígio ou questionamento de cliente;
d) manter sigilo absoluto sobre informações técnicas, comerciais, estratégicas e financeiras da CONTRATANTE durante a vigência deste contrato e por 2 (dois) anos após seu término;
e) não representar, direta ou indiretamente, empresa concorrente da CONTRATANTE no segmento de energia solar fotovoltaica.


8. OBRIGAÇÕES DA CONTRATANTE

a) disponibilizar materiais comerciais, tabelas e suporte técnico necessários à atividade;
b) comunicar alterações de preços e condições com antecedência mínima de 5 (cinco) dias úteis;
c) efetuar o pagamento das comissões nas condições e prazos pactuados.


9. RESCISÃO

9.1. Este contrato vigora por prazo indeterminado e poderá ser rescindido por qualquer das partes, sem ônus, mediante aviso escrito com 30 (trinta) dias de antecedência.

9.2. Rescisão imediata, independentemente de aviso prévio e sem qualquer indenização, ocorrerá nas hipóteses de: (a) descumprimento contratual relevante; (b) ato ilícito, fraude ou conduta antiética; (c) violação de sigilo; (d) representação de concorrente; (e) irregularidade fiscal grave do CONTRATADO.

9.3. Rescindido o contrato, o CONTRATADO fará jus apenas às comissões correspondentes a contratos pagos pela CONTRATANTE até a data da rescisão, deduzidos eventuais adiantamentos não compensados, vedada qualquer outra verba, indenização ou aviso prévio, dada a natureza civil desta relação.


10. DISPOSIÇÕES FINAIS

10.1. Este instrumento representa o acordo integral entre as partes, substituindo entendimentos anteriores. Alterações somente terão validade por aditivo escrito assinado por ambas.

10.2. A tolerância de qualquer parte quanto ao descumprimento de cláusulas não implica novação ou renúncia.

10.3. Fica eleito o foro da comarca de ${foro}, com renúncia a qualquer outro, para dirimir controvérsias decorrentes deste contrato.

10.4. As partes declaram ter lido, compreendido e aceito livremente todos os termos deste contrato.


${cidade}, ${today}.




_______________________________________________________________
CONTRATANTE
${company.nome} — CNPJ: ${company.cnpj}




_______________________________________________________________
CONTRATADO
${signatario.toUpperCase()} — ${docTipo}: ${client.cpf_cnpj || '___'}
`;
}

// ════════════════════════════════════════════════════════════
// CONTRATO VENDEDOR — modelo 2 (idêntico ao 1; substituído na unificação)
// ════════════════════════════════════════════════════════════
function contratoPjM2(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  return contratoPjM1(company, client, f);
}

// ════════════════════════════════════════════════════════════
// PRESTAÇÃO DE SERVIÇO — MODELO 1  (montagem sistema fotovoltaico)
// ════════════════════════════════════════════════════════════
function prestacaoServicoM1(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const foro = str(f.foro_cidade);
  const cidade = company.cidade || foro;

  // CONTRATADA = terceiro (client param)
  const contratadaEndereco = enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf);
  const contratadaDoc = client.cpf_cnpj || '___';

  // CLIENTE FINAL fields (pre-populated by controller)
  const cfNome = str(f.cliente_final_nome || '___');
  const cfTelefone = str(f.cliente_final_telefone);
  const cfEndereco = str(f.cliente_final_endereco_instalacao || '___');
  const cfTelhado = str(f.cliente_final_tipo_telhado);
  const cfPadrao = str(f.cliente_final_padrao);

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE MONTAGEM DE SISTEMA FOTOVOLTAICO

Entre as partes:

CONTRATANTE: ${company.nome}, inscrita no CNPJ sob o nº ${company.cnpj}, com sede em ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}, doravante denominada CONTRATANTE;

e

CONTRATADA: ${client.nome}, CPF/CNPJ ${contratadaDoc}, residente/sediada em ${contratadaEndereco}, doravante denominada CONTRATADA;

referente ao cliente final abaixo descrito:

CLIENTE FINAL: ${cfNome}${cfTelefone ? `\nTelefone: ${cfTelefone}` : ''}
Endereço da instalação: ${cfEndereco}

tem entre si justo e contratado o seguinte:


1. OBJETO

O presente contrato tem por objeto a prestação de serviços de montagem de sistema fotovoltaico no endereço do CLIENTE FINAL acima identificado.

Características da instalação:

- Tipo de telhado: ${cfTelhado || '___'}
- Tipo de padrão elétrico: ${cfPadrao || '___'}

Dados do sistema:

- Quantidade de módulos: ${str(f.qtd_modulos || '___')} unidades
- Modelo dos módulos: ${str(f.modelo_modulo || '___')}
- Quantidade de inversores: ${str(f.qtd_inversores || '___')}
- Modelo do inversor: ${str(f.modelo_inversor || '___')}

A montagem compreende:

- Instalação dos módulos fotovoltaicos
- Instalação do(s) inversor(es) ou microinversores
- Montagem da estrutura de fixação
- Passagem e organização de cabeamento
- Conexões elétricas do sistema
- Entrega do sistema pronto para vistoria e comissionamento


2. VALOR E CONDIÇÕES DE PAGAMENTO

O valor total pelos serviços prestados será de R$ ${curr(str(f.valor_servico))} (${extenso(f.valor_servico)}).

O pagamento será realizado da seguinte forma:

${str(f.forma_pagamento)}

O pagamento está condicionado à execução completa e adequada dos serviços.


3. PRAZO DE EXECUÇÃO

Os serviços deverão ser executados no prazo de até ${str(f.prazo)} (${numExtenso(f.prazo)}) dias, contados a partir da liberação da obra pela CONTRATANTE.

O prazo poderá sofrer alterações em função de:

- condições climáticas
- indisponibilidade do local
- fatores externos alheios à CONTRATADA


4. OBRIGAÇÕES DA CONTRATADA

A CONTRATADA compromete-se a:

- Executar os serviços com qualidade técnica e conforme normas vigentes
- Utilizar mão de obra qualificada
- Seguir integralmente o projeto técnico fornecido
- Utilizar EPIs e garantir a segurança da equipe
- Preservar a integridade do telhado e da estrutura do cliente
- Informar imediatamente qualquer problema técnico identificado
- Manter o local organizado durante e após a execução


5. OBRIGAÇÕES DA CONTRATANTE

A CONTRATANTE compromete-se a:

- Fornecer projeto técnico completo
- Disponibilizar materiais e equipamentos
- Garantir acesso ao local da instalação
- Efetuar o pagamento conforme acordado
- Designar responsável para acompanhamento da obra


6. RESPONSABILIDADE TÉCNICA

A responsabilidade técnica pelo dimensionamento e projeto do sistema é da CONTRATANTE.

A CONTRATADA é responsável exclusivamente pela execução da montagem conforme orientação recebida.


7. SEGURANÇA E CONDIÇÕES DE TRABALHO

A CONTRATADA deverá:

- Cumprir normas de segurança do trabalho
- Utilizar equipamentos de proteção individual (EPIs)
- Garantir a segurança da equipe e do local


8. VÍNCULO CONTRATUAL

Este contrato não gera vínculo empregatício entre as partes, sendo a CONTRATADA responsável por seus encargos trabalhistas, previdenciários e fiscais.


9. RESCISÃO

Este contrato poderá ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias.

Em caso de descumprimento contratual, será aplicada multa equivalente a 10% sobre o valor total do contrato.


10. FORO

Fica eleito o foro da comarca de ${foro} para dirimir quaisquer dúvidas oriundas deste contrato.

${cidade}, ${today}






________________________________
CONTRATANTE:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
CONTRATADA:
${client.nome.toUpperCase()}
CPF/CNPJ: ${contratadaDoc}
`;
}

// ════════════════════════════════════════════════════════════
// PRESTAÇÃO DE SERVIÇO — MODELO 2  (formal, cláusulas detalhadas)
// ════════════════════════════════════════════════════════════
function prestacaoServicoM2(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const foro = str(f.foro_cidade);
  const cidade = company.cidade || foro;
  const contratadaDoc = client.cpf_cnpj || '___';

  const cfNome = str(f.cliente_final_nome || '___');
  const cfTelefone = str(f.cliente_final_telefone);
  const cfEndereco = str(f.cliente_final_endereco_instalacao || '___');
  const cfTelhado = str(f.cliente_final_tipo_telhado);
  const cfPadrao = str(f.cliente_final_padrao);

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE MONTAGEM DE SISTEMA FOTOVOLTAICO

Pelo presente instrumento particular, as partes abaixo qualificadas celebram o presente contrato, que se regerá pelas cláusulas e condições seguintes:

──────────────────────────────────────────────────────────────

CLÁUSULA PRIMEIRA — DAS PARTES

CONTRATANTE: ${company.nome}, inscrita no CNPJ sob o nº ${company.cnpj}, com sede em ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}${company.socio_adm ? `, representada por ${company.socio_adm}` : ''}, doravante denominada CONTRATANTE.

CONTRATADA: ${client.nome}, CPF/CNPJ ${contratadaDoc}, residente/sediada em ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}, doravante denominada CONTRATADA.

CLIENTE FINAL: ${cfNome}${cfTelefone ? ` — Telefone: ${cfTelefone}` : ''}
Endereço da instalação: ${cfEndereco}

──────────────────────────────────────────────────────────────

CLÁUSULA SEGUNDA — DO OBJETO

O presente contrato tem por objeto a prestação de serviços de montagem de sistema fotovoltaico no endereço do CLIENTE FINAL acima identificado.

Características da instalação:
   - Tipo de telhado: ${cfTelhado || '___'}
   - Padrão elétrico: ${cfPadrao || '___'}

Dados do sistema:
   - Módulos: ${str(f.qtd_modulos || '___')} unidades — ${str(f.modelo_modulo || '___')}
   - Inversores: ${str(f.qtd_inversores || '___')} — ${str(f.modelo_inversor || '___')}

Os serviços compreendem instalação dos módulos e inversores, montagem da estrutura de fixação, cabeamento, conexões elétricas e entrega do sistema pronto para vistoria e comissionamento.

──────────────────────────────────────────────────────────────

CLÁUSULA TERCEIRA — DO VALOR E PAGAMENTO

O valor total pelos serviços é de R$ ${curr(str(f.valor_servico))} (${extenso(f.valor_servico)}).

Condições de pagamento: ${str(f.forma_pagamento)}

O atraso no pagamento sujeitará a CONTRATANTE à incidência de juros de 1% ao mês e multa moratória de 2% sobre o valor em atraso.

──────────────────────────────────────────────────────────────

CLÁUSULA QUARTA — DO PRAZO DE EXECUÇÃO

Os serviços serão executados em até ${str(f.prazo)} (${numExtenso(f.prazo)}) dias corridos, contados da liberação da obra pela CONTRATANTE.

Os prazos serão suspensos em caso de condições climáticas adversas, indisponibilidade do local ou fatores externos alheios à CONTRATADA, devidamente comprovados.

──────────────────────────────────────────────────────────────

CLÁUSULA QUINTA — DAS OBRIGAÇÕES DA CONTRATADA

A CONTRATADA obriga-se a:
   a) Executar os serviços com qualidade técnica e conforme normas vigentes (ABNT, NR-10, NR-35);
   b) Utilizar exclusivamente mão de obra qualificada e habilitada;
   c) Seguir integralmente o projeto técnico fornecido pela CONTRATANTE;
   d) Utilizar EPIs e garantir a segurança da equipe e do local;
   e) Preservar a integridade do telhado e das estruturas do cliente;
   f) Informar imediatamente qualquer problema técnico identificado durante a execução;
   g) Manter o local organizado e entregar o ambiente limpo ao final dos serviços.

──────────────────────────────────────────────────────────────

CLÁUSULA SEXTA — DAS OBRIGAÇÕES DA CONTRATANTE

A CONTRATANTE obriga-se a:
   a) Fornecer projeto técnico completo antes do início dos serviços;
   b) Disponibilizar materiais e equipamentos conforme cronograma;
   c) Garantir acesso ao local da instalação;
   d) Efetuar os pagamentos nos prazos acordados;
   e) Designar responsável para acompanhamento da obra.

──────────────────────────────────────────────────────────────

CLÁUSULA SÉTIMA — DA RESPONSABILIDADE TÉCNICA

A responsabilidade técnica pelo dimensionamento e projeto do sistema é da CONTRATANTE. A CONTRATADA responde exclusivamente pela execução da montagem conforme orientação recebida.

──────────────────────────────────────────────────────────────

CLÁUSULA OITAVA — DO VÍNCULO CONTRATUAL

Este contrato não gera vínculo empregatício entre as partes. A CONTRATADA é responsável por todos os encargos trabalhistas, previdenciários e fiscais de seus colaboradores.

──────────────────────────────────────────────────────────────

CLÁUSULA NONA — DA RESCISÃO

O contrato poderá ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias. Em caso de descumprimento contratual, aplica-se multa de 10% sobre o valor total. Alterações de escopo somente produzirão efeitos se formalizadas por aditivo assinado por ambas as partes.

──────────────────────────────────────────────────────────────

CLÁUSULA DÉCIMA — DO FORO

Fica eleito o foro da comarca de ${foro}, com exclusão de qualquer outro, para dirimir quaisquer dúvidas oriundas deste contrato.

──────────────────────────────────────────────────────────────

E, por estarem justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor.

${cidade}, ${today}






________________________________
CONTRATANTE:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
CONTRATADA:
${client.nome.toUpperCase()}
CPF/CNPJ: ${contratadaDoc}


Testemunhas:

________________________________        ________________________________
Nome:                                   Nome:
CPF:                                    CPF:
`;
}

// ════════════════════════════════════════════════════════════
// VISTORIA CHECKLIST — checklist operacional pra visita técnica
// ════════════════════════════════════════════════════════════
// 2 modos:
//  - "em_branco" (default): boxes vazios pro instalador marcar à mão na obra
//  - "digital": vendedor preenche no celular, PDF sai com tudo marcado
//
// Form pede mínimo no modo em_branco. No digital, todos os checks expostos.
function vistoriaM1(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = str(f.data_visita) !== '___' ? str(f.data_visita) : dateBR();
  const endereco = str(f.endereco_visita) !== '___'
    ? str(f.endereco_visita)
    : enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf);
  const tecnico = str(f.tecnico_nome);
  const modoDigital = f.modo === 'digital';

  // ☐ pra unchecked, ☒ pra checked. No modo "em_branco" sempre ☐.
  const bx = (checked?: unknown): string =>
    modoDigital && checked === true ? '☒' : '☐';

  // No modo digital substitui linhas de preenchimento pelo valor; em branco mantém ___
  const v = (val: unknown, placeholder = '_________'): string => {
    if (!modoDigital) return placeholder;
    const s = str(val);
    return s === '___' ? placeholder : s;
  };

  // Helper pra opções com 1 selecionada (radio-like). value é o que veio do form,
  // option é o que essa caixa específica representa.
  const opt = (value: unknown, option: string): string => bx(value === option);

  return `VISTORIA TÉCNICA — CHECKLIST DE VISITA
Sistema fotovoltaico

EMPRESA: ${company.nome}    CNPJ: ${company.cnpj}
CLIENTE: ${client.nome}${client.cpf_cnpj ? `    CPF/CNPJ: ${client.cpf_cnpj}` : ''}
LOCAL: ${endereco}
DATA: ${today}    TÉCNICO: ${tecnico || '___________________________'}

────────────────────────────────────────────────────────────


1. CONSUMO

  Consumo médio: ${v(f.consumo_kwh)} kWh/mês


2. PADRÃO ELÉTRICO

  Tipo:       ${opt(f.padrao_tipo, 'mono')} Monofásico   ${opt(f.padrao_tipo, 'bi')} Bifásico   ${opt(f.padrao_tipo, 'tri')} Trifásico
  Disjuntor:  ${v(f.padrao_disjuntor, '_______')} A

  ${bx(f.padrao_estado_ok)} Padrão em bom estado
  ${bx(f.padrao_espaco_inversor)} Espaço para inversor próximo


3. TELHADO

  Tipo:        ${opt(f.telhado_tipo, 'ceramica')} Cerâmica   ${opt(f.telhado_tipo, 'fibrocimento')} Fibrocimento   ${opt(f.telhado_tipo, 'metalica')} Metálica   ${opt(f.telhado_tipo, 'laje')} Laje
  Área útil:   ${v(f.telhado_area)} m²
  Orientação:  ${opt(f.telhado_orientacao, 'N')} N   ${opt(f.telhado_orientacao, 'NE')} NE   ${opt(f.telhado_orientacao, 'NO')} NO   ${opt(f.telhado_orientacao, 'L')} L   ${opt(f.telhado_orientacao, 'O')} O

  ${bx(f.telhado_sem_sombra)} Sem sombreamento crítico
  ${bx(f.telhado_estrutura_ok)} Estrutura ok pra suportar painéis


4. DIMENSIONAMENTO PRELIMINAR

  Potência sugerida: ${v(f.dim_potencia)} kWp
  Distância padrão → inversor: ${v(f.dim_distancia)} m


5. FOTOS & DOCUMENTOS COLETADOS

  ${bx(f.foto_fachada)} Fachada do imóvel
  ${bx(f.foto_padrao)} Padrão de entrada
  ${bx(f.foto_disjuntor)} Disjuntor (close-up)
  ${bx(f.foto_relogio)} Relógio / medidor
  ${bx(f.foto_conta_luz)} Conta de luz
  ${bx(f.foto_cnh)} CNH do cliente


6. CONCLUSÃO

  ${opt(f.conclusao, 'viavel')} Viável   ${opt(f.conclusao, 'ressalvas')} Viável com ressalvas   ${opt(f.conclusao, 'nao_viavel')} Não viável

  Observações:
  ${modoDigital && str(f.observacoes) !== '___'
    ? String(f.observacoes).split('\n').map((l) => '  ' + l).join('\n')
    : '__________________________________________________________________________\n  __________________________________________________________________________\n  __________________________________________________________________________\n  __________________________________________________________________________\n  __________________________________________________________________________\n  __________________________________________________________________________'}


────────────────────────────────────────────────────────────



_______________________________________            _______________________________________
TÉCNICO                                            CLIENTE
${tecnico || ''}                                   ${client.nome}


Gerado por SolarDoc Pro — solardoc.app
`;
}

// ════════════════════════════════════════════════════════════
// PROPOSTA SOLAR — landing page rica pra cliente final
// ════════════════════════════════════════════════════════════
// Retorna HTML completo (não plain text). Renderizado como iframe na
// preview, perfeito em PDF via puppeteer, imprimível em A4 com cores
// vibrantes. SVG inline pro gráfico de geração mensal (zero JS).
//
// Paleta de cor escolhível pelo vendedor (5 opções pré-definidas).
// Logo da empresa puxada do cadastro (logo_base64).

interface Palette { c1: string; c2: string; c3: string; nome: string; }
const PALETTES: Record<string, Palette> = {
  // 2026-05-21: solar/oceano/floresta agora usam tons fortes/escuros pra
  // dar mais autoridade visual no PDF. Royal e carbono mantidos.
  solar:    { c1: '#B45309', c2: '#D97706', c3: '#FFFBEB', nome: 'Solar' },
  oceano:   { c1: '#1E3A8A', c2: '#1D4ED8', c3: '#EFF6FF', nome: 'Oceano' },
  floresta: { c1: '#065F46', c2: '#047857', c3: '#ECFDF5', nome: 'Floresta' },
  royal:    { c1: '#8B5CF6', c2: '#A78BFA', c3: '#F5F3FF', nome: 'Royal' },
  carbono:  { c1: '#1F2937', c2: '#F59E0B', c3: '#FAFAF9', nome: 'Carbono' },
};

function pBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function pNum(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(n));
}

// Formato pra kWp: mostra decimais se não for inteiro (5 → "5", 9,6 → "9,6")
function pKwp(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.01) return String(Math.round(n));
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

function pEsc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

// PMT Price com carência: juros capitalizam no saldo durante a carência, depois Price padrão
function pmtPriceCarencia(pv: number, i: number, n: number, carenciaMeses: number): number {
  if (!pv || pv <= 0) return 0;
  const saldo = pv * Math.pow(1 + i, carenciaMeses);
  return saldo * i / (1 - Math.pow(1 + i, -n));
}

function propostaSolarM1(company: Company, client: Client, f: Record<string, unknown>): string {
  // Inputs do form
  const palette = PALETTES[String(f.paleta || 'solar')] || PALETTES.solar;
  const codigoProposta = str(f.codigo) === '___' ? '' : String(f.codigo);
  // Vendedor caiu do form — usa contato da empresa cadastrada (sócio admin / razão social + WhatsApp da empresa).
  // Se o form ainda mandar (proposta antiga ou white-label custom), prioriza o do form.
  const vendedorForm = str(f.vendedor_nome) === '___' ? '' : String(f.vendedor_nome).trim();
  const vendedor = vendedorForm || String(company.socio_adm || company.nome || '').trim();
  const vendedorWhatsAppForm = (str(f.vendedor_whatsapp) === '___' ? '' : String(f.vendedor_whatsapp)).replace(/\D/g, '');
  const vendedorWhatsApp = vendedorWhatsAppForm || String((company as { whatsapp?: string }).whatsapp || '').replace(/\D/g, '');
  const fotoTelhado = str(f.foto_telhado_b64) === '___' ? '' : String(f.foto_telhado_b64);
  const tipoTelhado = str(f.tipo_telhado) === '___' ? (client.tipo_telhado || '') : String(f.tipo_telhado);
  const cidade = (str(f.cidade) === '___' ? (client.cidade || '') : String(f.cidade)).trim();
  const uf = (str(f.uf) === '___' ? (client.uf || 'SP') : String(f.uf)).trim().toUpperCase();
  const consumoKwh = parseFloat(String(f.consumo_kwh || '0')) || 0;
  const qtdModulos = parseInt(String(f.qtd_modulos || '0'), 10) || 0;
  const marcaModulo = String(f.marca_modulo || '');
  const potenciaModulo = parseInt(String(f.potencia_modulo || '0'), 10) || 0;
  // kWp deriva de qtd × W ÷ 1000 (verdade técnica: 10 placas × 620W = 6,2 kWp)
  const kwp = (qtdModulos * potenciaModulo) / 1000;
  const qtdInversores = parseInt(String(f.qtd_inversores || '1'), 10) || 1;
  const marcaInversor = String(f.marca_inversor || '');
  // Aceita vírgula (1,875) ou ponto (1.875) — vendedor digita em pt-BR
  const potenciaInversor = parseFloat(String(f.potencia_inversor || '0').replace(',', '.')) || 0;
  const investimento = parseFloat(String(f.investimento || '0').toString().replace(',', '.')) || 0;
  const precoAvistaInput = parseFloat(String(f.preco_avista || '0').toString().replace(',', '.')) || 0;
  const precoAvista = precoAvistaInput > 0 && precoAvistaInput < investimento ? precoAvistaInput : 0;
  // Parcelas no cartão — taxa total média sobre o preço cheio (tabela 2026-05-21).
  // 6x=8,90% · 10x=12,65% · 12x=14,30% · 18x=18,65% · 21x=20,50%. Padrão: 10x marcado.
  const valor6x  = investimento > 0 ? Math.ceil((investimento * 1.0890) /  6) : 0;
  const valor10x = investimento > 0 ? Math.ceil((investimento * 1.1265) / 10) : 0;
  const valor12x = investimento > 0 ? Math.ceil((investimento * 1.1430) / 12) : 0;
  const valor18x = investimento > 0 ? Math.ceil((investimento * 1.1865) / 18) : 0;
  const valor21x = investimento > 0 ? Math.ceil((investimento * 1.2050) / 21) : 0;
  // Financiamento Price com 120 dias (4 meses) de carência a 2,2% a.m.
  // Taxa interna — não exibida no PDF nem no form.
  const FIN_RATE = 0.022;
  const FIN_CARENCIA_MESES = 4;
  const valor36x = investimento > 0 ? Math.ceil(pmtPriceCarencia(investimento, FIN_RATE, 36, FIN_CARENCIA_MESES)) : 0;
  const valor48x = investimento > 0 ? Math.ceil(pmtPriceCarencia(investimento, FIN_RATE, 48, FIN_CARENCIA_MESES)) : 0;
  const valor60x = investimento > 0 ? Math.ceil(pmtPriceCarencia(investimento, FIN_RATE, 60, FIN_CARENCIA_MESES)) : 0;
  // Entrada + saldo: integrador define a entrada (R$) e como/quando quitar o restante.
  // Modo do restante: 'dias' (N dias) | 'entrega' | 'montagem' | 'liberacao'.
  const entradaValor = parseFloat(String(f.entrada_valor || '0').toString().replace(',', '.')) || 0;
  const entradaRestante = investimento > 0 && entradaValor > 0 ? Math.max(0, investimento - entradaValor) : 0;
  const entradaModoRaw = String(f.entrada_modo || 'dias');
  const entradaModo: 'dias' | 'entrega' | 'montagem' | 'liberacao' =
    entradaModoRaw === 'entrega' || entradaModoRaw === 'montagem' || entradaModoRaw === 'liberacao' ? entradaModoRaw : 'dias';
  const entradaDias = parseInt(String(f.entrada_dias || '30'), 10) || 30;
  const entradaPrazoLabel = entradaModo === 'dias'
    ? `em ${entradaDias} dia${entradaDias === 1 ? '' : 's'}`
    : entradaModo === 'entrega'    ? 'na entrega do material'
    : entradaModo === 'montagem'   ? 'na montagem do sistema'
    :                                 'na liberação do sistema';

  // Texto livre de "outro tipo de pagamento" (vendedor preenche se quiser)
  const pagCustom = String(f.pag_custom || '').trim();

  // Quais opções aparecem para o cliente (consultor escolhe no form).
  // Defaults novos: vista/cartão 10x/fin 48-60x ligados; 36x e entrada desligados.
  const pagOpts = {
    vista:  f.pag_vista === false ? false : true,
    cartao: f.pag_cartao === false ? false : true,
    p6:     f.pag_cartao_6 === true,                                  // off by default
    p10:    f.pag_cartao_10 === false ? false : true,                 // on by default
    p12:    f.pag_cartao_12 === true,                                 // off by default
    p18:    f.pag_cartao_18 === true,                                 // off by default
    p21:    f.pag_cartao_21 === true,                                 // off by default
    fin:    f.pag_fin === false ? false : true,
    p36:    f.pag_fin_36 === true,                                    // off by default
    p48:    f.pag_fin_48 === false ? false : true,                    // on by default
    p60:    f.pag_fin_60 === false ? false : true,                    // on by default
    entrada: f.pag_entrada === true,                                  // off by default
  };

  // Campos editáveis pelo tenant (com defaults seguros — propostas antigas continuam funcionando)
  const taxaMinima = parseFloat(String(f.taxa_minima || '90').toString().replace(',', '.')) || 90;
  const prazoDias = parseInt(String(f.prazo_instalacao_dias || '45'), 10) || 45;
  const garPaineis = parseInt(String(f.garantia_paineis || '25'), 10) || 25;
  const garInversor = parseInt(String(f.garantia_inversor || '10'), 10) || 10;
  const garEstrutura = parseInt(String(f.garantia_estrutura || '10'), 10) || 10;
  const garInstalacao = parseInt(String(f.garantia_instalacao || '1'), 10) || 1;
  // Garantias extras (até 2) — só renderizam se nome e anos > 0 estiverem preenchidos.
  type GarExtra = { nome: string; anos: number };
  const garExtras: GarExtra[] = ([1, 2] as const).flatMap((i): GarExtra[] => {
    const nome = String(f[`garantia_extra${i}_nome` as keyof typeof f] || '').trim();
    const anos = parseInt(String(f[`garantia_extra${i}_anos` as keyof typeof f] || '0'), 10) || 0;
    if (!nome || anos <= 0) return [];
    return [{ nome, anos }];
  });
  const inflacaoPct = parseFloat(String(f.inflacao_aa || '6').toString().replace(',', '.')) || 6;
  const inflacao = inflacaoPct / 100;
  const inflacaoTaxaMinPct = parseFloat(String(f.taxa_minima_inflacao_aa || '6').toString().replace(',', '.')) || 6;
  const inflacaoTaxaMin = inflacaoTaxaMinPct / 100;

  // Cálculos solares — usa HSP da cidade se cadastrada (top 50 mercados),
  // cai pro estado caso contrário.
  const refBase = getRef(uf, cidade);
  // Tarifa: vendedor pode sobrescrever por proposta (conta de luz do cliente
  // é a fonte de verdade — varia por concessionária e faixa de consumo).
  const tarifaOverride = parseFloat(String(f.tarifa_kwh || '').replace(',', '.'));
  const ref = {
    ...refBase,
    tarifa: tarifaOverride > 0 ? tarifaOverride : refBase.tarifa,
  };
  const mensal = geracaoMensal(kwp, uf, cidade);
  const geracaoAnual = mensal.reduce((a, b) => a + b, 0);
  const mediaMensalGerada = Math.round(geracaoAnual / 12);
  const economiaPercent = consumoKwh > 0 ? Math.min(100, Math.round((mediaMensalGerada / consumoKwh) * 100)) : 100;
  // Payback usando o MESMO modelo dual-inflação do chart 25 anos
  // (senão o "X anos pra retorno" diverge dos números mostrados nas curvas)
  const paybackMeses = (() => {
    if (investimento <= 0 || consumoKwh <= 0) return 0;
    let acum = 0;
    for (let a = 1; a <= 25; a++) {
      const ftar = Math.pow(1 + inflacao, a - 1);
      const fmin = Math.pow(1 + inflacaoTaxaMin, a - 1);
      const economiaAno = consumoKwh * 12 * ref.tarifa * ftar - taxaMinima * 12 * fmin;
      if (acum + economiaAno >= investimento) {
        const restante = investimento - acum;
        return (a - 1) * 12 + Math.ceil((restante / economiaAno) * 12);
      }
      acum += economiaAno;
    }
    return 0;
  })();
  const paybackAnos = paybackMeses > 0 ? (paybackMeses / 12).toFixed(1).replace('.', ',') : '—';
  const paybackTexto = (() => {
    const m = paybackMeses;
    if (!m) return '—';
    const anos = Math.floor(m / 12);
    const meses = m % 12;
    if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    if (meses === 0) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
    return `${anos} ${anos === 1 ? 'ano' : 'anos'} e ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  })();

  // Conta antes vs depois: hoje paga consumo × tarifa; com solar paga taxa mínima
  const contaHoje = Math.round(consumoKwh * ref.tarifa);
  const contaComSolar = taxaMinima;
  const economiaMensal = Math.max(0, contaHoje - contaComSolar);

  // Série anual acumulada pros 25 anos: conta SEM solar × conta COM solar.
  // "Sem solar" = consumo × tarifa × 12 (tarifa cresce 7%/ano histórico ANEEL)
  // "Com solar" = taxa mínima × 12 (taxa mínima cresce ~4%/ano — fixa, menos
  // exposta ao mercado de geração)
  // Economia = diff entre as duas curvas — número que o cliente sente no bolso.
  const NUM_ANOS = 25;
  const semSolarAcum: number[] = [];
  const comSolarAcum: number[] = [];
  {
    let sem = 0, com = 0;
    for (let a = 1; a <= NUM_ANOS; a++) {
      const fatorTarifa = Math.pow(1 + inflacao, a - 1);
      const fatorMin = Math.pow(1 + inflacaoTaxaMin, a - 1);
      sem += consumoKwh * 12 * ref.tarifa * fatorTarifa;
      com += taxaMinima * 12 * fatorMin;
      semSolarAcum.push(Math.round(sem));
      comSolarAcum.push(Math.round(com));
    }
  }
  const economia25 = semSolarAcum[NUM_ANOS - 1] - comSolarAcum[NUM_ANOS - 1];

  // Breakdown da economia em 25 anos (ano 1, 5, 10, 25) — usa o MESMO modelo do chart
  // pra não dar números contraditórios na mesma proposta.
  const breakdownAnos = [1, 5, 10, 25];
  const breakdownEconomia = breakdownAnos.map((anoAlvo) => {
    return semSolarAcum[anoAlvo - 1] - comSolarAcum[anoAlvo - 1];
  });

  // SVG comparativo 25 anos: 2 áreas (sem/com solar) com gap destacado em verde.
  const CW = 700, CH = 280, CP = { top: 24, right: 20, bottom: 50, left: 70 };
  const cInnerW = CW - CP.left - CP.right;
  const cInnerH = CH - CP.top - CP.bottom;
  const yMaxComp = Math.max(...semSolarAcum, 1);
  const pBRLshort = (n: number): string => {
    if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
    if (n >= 1_000) return `R$ ${Math.round(n / 1_000)}k`;
    return `R$ ${Math.round(n)}`;
  };
  const cYTicks = 5;
  const cYLines = Array.from({ length: cYTicks + 1 }, (_, i) => {
    const v = (yMaxComp * i) / cYTicks;
    const y = CP.top + cInnerH - (cInnerH * i) / cYTicks;
    return `<line x1="${CP.left}" y1="${y}" x2="${CP.left + cInnerW}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>
<text x="${CP.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9CA3AF">${pBRLshort(v)}</text>`;
  }).join('\n');
  const xCoord = (i: number): number => CP.left + (cInnerW * i) / (NUM_ANOS - 1);
  const yCoord = (v: number): number => CP.top + cInnerH - (cInnerH * v) / yMaxComp;

  // Path da linha "sem solar"
  const semPath = semSolarAcum.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i).toFixed(1)} ${yCoord(v).toFixed(1)}`).join(' ');
  // Path da linha "com solar"
  const comPath = comSolarAcum.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i).toFixed(1)} ${yCoord(v).toFixed(1)}`).join(' ');
  // Área de economia: polygon do sem (topo) descendo ao com (base) e fechando
  const areaEconomia = semSolarAcum.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i).toFixed(1)} ${yCoord(v).toFixed(1)}`).join(' ')
    + ' ' + [...comSolarAcum].reverse().map((v, i) => {
        const idx = NUM_ANOS - 1 - i;
        return `L ${xCoord(idx).toFixed(1)} ${yCoord(v).toFixed(1)}`;
      }).join(' ')
    + ' Z';

  // Labels do eixo X: anos 1, 5, 10, 15, 20, 25
  const cXLabels = [1, 5, 10, 15, 20, 25].map(a => {
    const i = a - 1;
    return `<text x="${xCoord(i).toFixed(1)}" y="${(CP.top + cInnerH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#6B7280" font-weight="600">Ano ${a}</text>`;
  }).join('\n');

  // SVG bar chart 12 meses (puro SVG, sem JS)
  const W = 600, H = 240, P = { top: 24, right: 16, bottom: 50, left: 48 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;
  const barCount = 12;
  const barGap = 6;
  const barW = (innerW - barGap * (barCount - 1)) / barCount;
  const maxKwh = Math.max(...mensal, 1);
  // Y axis ticks (4 níveis)
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxKwh * i) / yTicks));
  const yLines = yLabels.map((v, i) => {
    const y = P.top + innerH - (innerH * i) / yTicks;
    return `<line x1="${P.left}" y1="${y}" x2="${P.left + innerW}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>
<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#9CA3AF">${pNum(v)}</text>`;
  }).join('\n');
  const bars = mensal.map((kwh, i) => {
    const x = P.left + i * (barW + barGap);
    const h = (kwh / maxKwh) * innerH;
    const y = P.top + innerH - h;
    return `<g>
  <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="url(#g1)"/>
  <text x="${x + barW / 2}" y="${P.top + innerH + 16}" text-anchor="middle" font-size="11" fill="#6B7280">${MESES_ABREV[i]}</text>
  <text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${palette.c1}">${pNum(kwh)}</text>
</g>`;
  }).join('\n');

  // Logo da empresa: usa logo_base64 se tiver, senão texto
  const empresaCompany = company as Company & { logo_base64?: string };
  const logoHtml = empresaCompany.logo_base64
    ? `<img src="${empresaCompany.logo_base64}" alt="${pEsc(company.nome)}" style="max-height: 56px; max-width: 220px; object-fit: contain;"/>`
    : `<div style="font-size: 24px; font-weight: 800; letter-spacing: -1px;">${pEsc(company.nome)}</div>`;

  // Bloco de pagamento: monta os cards que o consultor marcou no form
  const cards: string[] = [];

  // À vista — usa desconto se houver, senão preço cheio
  if (pagOpts.vista) {
    const valorVista = precoAvista > 0 ? precoAvista : investimento;
    const economia = precoAvista > 0 ? `<div class="invest-avista-economia">economia de ${pBRL(investimento - precoAvista)}</div>` : '';
    cards.push(`<div class="invest-avista">
        <div class="invest-avista-label">${precoAvista > 0 ? 'Desconto à vista' : 'À vista'}</div>
        <div class="invest-avista-value">${pBRL(valorVista)}</div>
        ${economia}
      </div>`);
  }

  // Cartão de crédito — 5 prazos possíveis. Padrão exibe 10x; resto opcional.
  if (pagOpts.cartao && investimento > 0) {
    const subs: Array<[boolean, number, number]> = [
      [pagOpts.p6,   6, valor6x],
      [pagOpts.p10, 10, valor10x],
      [pagOpts.p12, 12, valor12x],
      [pagOpts.p18, 18, valor18x],
      [pagOpts.p21, 21, valor21x],
    ];
    for (const [ativo, n, valor] of subs) {
      if (ativo && valor > 0) {
        cards.push(`<div class="invest-cartao">
          <div class="invest-cartao-label">Cartão de crédito</div>
          <div class="invest-cartao-value">${n}× de ${pBRL(valor)}</div>
          <div class="invest-cartao-sub">no cartão sem entrada</div>
        </div>`);
      }
    }
  }

  // Financiamento bancário — 36x / 48x / 60x. Taxa interna, não exibida.
  if (pagOpts.fin && investimento > 0) {
    const subs: Array<[boolean, number, number]> = [
      [pagOpts.p36, 36, valor36x],
      [pagOpts.p48, 48, valor48x],
      [pagOpts.p60, 60, valor60x],
    ];
    for (const [ativo, n, valor] of subs) {
      if (ativo && valor > 0) {
        cards.push(`<div class="invest-financ">
          <div class="invest-financ-label">Financiamento bancário</div>
          <div class="invest-financ-value">${n}× de ${pBRL(valor)}</div>
          <div class="invest-financ-sub">120 dias de carência</div>
        </div>`);
      }
    }
  }

  // Entrada + saldo — integrador define a entrada e como o restante é quitado.
  if (pagOpts.entrada && investimento > 0 && entradaValor > 0 && entradaRestante > 0) {
    cards.push(`<div class="invest-cartao">
      <div class="invest-cartao-label">Entrada + saldo</div>
      <div class="invest-cartao-value">${pBRL(entradaValor)} + ${pBRL(entradaRestante)}</div>
      <div class="invest-cartao-sub">${pBRL(entradaValor)} hoje · ${pBRL(entradaRestante)} ${entradaPrazoLabel}</div>
    </div>`);
  }

  // Pagamento customizado — texto livre que o vendedor digitou no form
  if (pagCustom) {
    cards.push(`<div class="invest-cartao">
      <div class="invest-cartao-label">Condição especial</div>
      <div class="invest-cartao-value">${pEsc(pagCustom)}</div>
      <div class="invest-cartao-sub">a combinar com o vendedor</div>
    </div>`);
  }

  const investCardsCount = cards.length;

  const today = dateBR();

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Proposta Solar — ${pEsc(client.nome)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root { --c1: ${palette.c1}; --c2: ${palette.c2}; --c3: ${palette.c3}; --c-text: #1F2937; --c-muted: #6B7280; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: var(--c-text); background: #F9FAFB; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.page { max-width: 794px; margin: 0 auto; background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
/* Topo com logo */
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; border-bottom: 1px solid #F3F4F6; }
.topbar .meta { font-size: 12px; color: var(--c-muted); text-align: right; }
/* Hero */
.hero { background: linear-gradient(135deg, var(--c1) 0%, var(--c2) 100%); color: white; padding: 56px 40px; text-align: center; position: relative; overflow: hidden; }
.hero::before { content: ''; position: absolute; top: -50%; right: -10%; width: 400px; height: 400px; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%); pointer-events: none; }
.hero h1 { font-size: 30px; font-weight: 800; margin-bottom: 6px; letter-spacing: -0.5px; position: relative; }
.hero .subtitle { font-size: 15px; opacity: 0.95; margin-bottom: 32px; position: relative; }
.hero .economia { background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.25); border-radius: 16px; padding: 22px 32px; display: inline-block; backdrop-filter: blur(10px); position: relative; }
.hero .economia-label { font-size: 11px; text-transform: uppercase; letter-spacing: 2.5px; opacity: 0.9; margin-bottom: 6px; font-weight: 600; }
.hero .economia-value { font-size: 44px; font-weight: 900; line-height: 1; letter-spacing: -1px; }
.hero .economia-period { font-size: 12px; opacity: 0.85; margin-top: 6px; }
/* Stats grid */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 32px 40px; background: var(--c3); }
.stat { background: white; border-radius: 12px; padding: 18px 12px; text-align: center; border-bottom: 3px solid var(--c1); }
.stat-icon { font-size: 22px; margin-bottom: 6px; }
.stat-value { font-size: 22px; font-weight: 800; color: var(--c1); line-height: 1.1; letter-spacing: -0.5px; }
.stat-label { font-size: 10px; color: var(--c-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; font-weight: 600; }
/* Section */
.section { padding: 28px 40px; }
.section + .section { border-top: 1px solid #F3F4F6; }
.section h2 { font-size: 18px; font-weight: 700; margin-bottom: 14px; color: var(--c1); display: flex; align-items: center; gap: 8px; }
/* Chart */
.chart-wrap { background: white; padding: 4px 0; border-radius: 8px; overflow: hidden; }
.chart-wrap svg { width: 100%; height: auto; display: block; }
.chart-caption { text-align: center; color: var(--c-muted); font-size: 12px; margin-top: 6px; }
.chart-caption strong { color: var(--c-text); }
/* Specs */
.specs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.spec { padding: 14px 16px; background: #F9FAFB; border-radius: 8px; border-left: 3px solid var(--c1); }
.spec-label { font-size: 10px; color: var(--c-muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
.spec-value { font-size: 14px; font-weight: 700; margin-top: 4px; color: var(--c-text); }
/* Investment */
.invest-box { background: linear-gradient(135deg, var(--c3) 0%, white 100%); padding: 28px 24px; border-radius: 16px; border: 2px solid var(--c1); text-align: center; }
.invest-label { color: var(--c-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }
.invest-value { font-size: 38px; font-weight: 900; color: var(--c1); margin: 6px 0; line-height: 1; letter-spacing: -1px; }
.invest-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 18px; }
.invest-avista { background: linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02)); border: 2px solid #10B981; border-radius: 12px; padding: 16px; text-align: center; }
.invest-avista-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #059669; font-weight: 700; }
.invest-avista-value { font-size: 26px; font-weight: 900; color: #10B981; margin: 6px 0 2px; line-height: 1; letter-spacing: -0.5px; }
.invest-avista-economia { font-size: 11px; color: #059669; font-weight: 600; }
.invest-cartao { background: linear-gradient(135deg, var(--c1), var(--c2)); color: white; border-radius: 12px; padding: 16px; text-align: center; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
.invest-cartao-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.9; font-weight: 700; }
.invest-cartao-value { font-size: 24px; font-weight: 900; margin-top: 4px; line-height: 1; letter-spacing: -0.5px; }
.invest-cartao-sub { font-size: 10px; opacity: 0.85; margin-top: 4px; font-weight: 500; }
.invest-financ { background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02)); border: 2px solid #6366F1; border-radius: 12px; padding: 16px; text-align: center; }
.invest-financ-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #4F46E5; font-weight: 700; }
.invest-financ-value { font-size: 24px; font-weight: 900; color: #4F46E5; margin: 4px 0 2px; line-height: 1; letter-spacing: -0.5px; }
.invest-financ-sub { font-size: 10px; color: #4F46E5; font-weight: 600; opacity: 0.85; }
.invest-grid-1 { grid-template-columns: 1fr; }
.invest-grid-2 { grid-template-columns: 1fr 1fr; }
.invest-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
/* Antes vs depois */
.compare { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; align-items: center; }
.compare-card { padding: 18px 16px; border-radius: 12px; text-align: center; }
.compare-antes { background: linear-gradient(135deg, #FEF2F2, #FEE2E2); border: 2px solid #FCA5A5; }
.compare-depois { background: linear-gradient(135deg, #ECFDF5, #D1FAE5); border: 2px solid #6EE7B7; }
.compare-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
.compare-antes .compare-label { color: #DC2626; }
.compare-depois .compare-label { color: #059669; }
.compare-value { font-size: 26px; font-weight: 900; margin: 6px 0 2px; line-height: 1; letter-spacing: -0.5px; }
.compare-antes .compare-value { color: #DC2626; }
.compare-depois .compare-value { color: #059669; }
.compare-sub { font-size: 11px; color: var(--c-muted); }
.compare-arrow { font-size: 28px; color: var(--c1); font-weight: 900; }
.compare-savings { text-align: center; margin-top: 12px; padding: 10px 14px; background: var(--c3); border-radius: 10px; font-size: 13px; color: var(--c1); font-weight: 700; }
/* Prazo */
.prazo-box { display: flex; align-items: center; gap: 16px; background: linear-gradient(135deg, var(--c3) 0%, white 100%); border-radius: 12px; padding: 18px 20px; border-left: 4px solid var(--c1); }
.prazo-num { font-size: 36px; font-weight: 900; color: var(--c1); line-height: 1; letter-spacing: -1px; }
.prazo-info { flex: 1; }
.prazo-titulo { font-size: 14px; font-weight: 700; color: var(--c-text); margin-bottom: 2px; }
.prazo-desc { font-size: 12px; color: var(--c-muted); line-height: 1.4; }
/* Breakdown 25 anos */
.breakdown { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.breakdown-card { background: #F9FAFB; padding: 14px 10px; border-radius: 10px; text-align: center; border-bottom: 3px solid var(--c1); }
.breakdown-ano { font-size: 11px; color: var(--c-muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 4px; }
.breakdown-val { font-size: 17px; font-weight: 800; color: var(--c1); line-height: 1.1; letter-spacing: -0.3px; }
.breakdown-nota { text-align: center; color: var(--c-muted); font-size: 11px; margin-top: 10px; font-style: italic; }
/* Gráfico 25 anos */
.chart25-legend { display: flex; justify-content: center; gap: 20px; margin-top: 4px; flex-wrap: wrap; }
.chart25-leg-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--c-text); font-weight: 600; }
.chart25-leg-dot { width: 14px; height: 14px; border-radius: 3px; }
.chart25-economia-card { background: linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02)); border: 2px solid #10B981; border-radius: 12px; padding: 14px 18px; text-align: center; margin-top: 12px; }
.chart25-economia-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #059669; font-weight: 700; }
.chart25-economia-val { font-size: 24px; font-weight: 900; color: #10B981; margin-top: 4px; line-height: 1; letter-spacing: -0.5px; }
/* Foto do telhado */
.foto-wrap {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(0,0,0,0.10);
  background: linear-gradient(135deg, var(--c1) 0%, var(--c2) 50%, #87CEEB 100%);
  min-height: 280px;
  position: relative;
}
.foto-wrap img { width: 100%; height: auto; display: block; max-height: 420px; object-fit: cover; }
.foto-caption { text-align: center; color: var(--c-muted); font-size: 12px; margin-top: 8px; font-style: italic; }
/* CTA — Quero fechar */
.cta-box { background: linear-gradient(135deg, var(--c1) 0%, var(--c2) 100%); color: white; padding: 28px 24px; text-align: center; border-radius: 16px; margin: 8px 0; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
.cta-title { font-size: 20px; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.3px; }
.cta-sub { font-size: 13px; opacity: 0.95; margin-bottom: 16px; }
.cta-pill { display: inline-block; background: white; color: var(--c1); padding: 12px 28px; border-radius: 100px; font-weight: 800; font-size: 15px; text-decoration: none; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
.cta-phone { display: block; margin-top: 10px; font-size: 16px; font-weight: 700; opacity: 0.95; letter-spacing: 0.3px; font-family: 'Inter', monospace; }
/* Garantias destacadas */
.garantias { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.garantia { background: var(--c3); padding: 16px 12px; border-radius: 10px; text-align: center; }
.garantia-num { font-size: 24px; font-weight: 900; color: var(--c1); line-height: 1; }
.garantia-label { font-size: 11px; color: var(--c-muted); margin-top: 4px; line-height: 1.3; }
/* Footer */
.footer { padding: 32px 40px 40px; text-align: center; border-top: 1px solid #F3F4F6; background: #FAFAFA; }
.footer .vendedor-label { color: var(--c-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; font-weight: 600; }
.footer .vendedor-nome { font-weight: 700; font-size: 16px; color: var(--c-text); }
.footer .empresa-info { color: var(--c-muted); font-size: 12px; margin-top: 20px; }
.footer .gerado { color: #9CA3AF; font-size: 10px; margin-top: 12px; }
/* Print */
@page { size: A4; margin: 8mm; }
@media print {
  html, body { background: white !important; font-size: 10pt; }
  body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  .page { box-shadow: none !important; max-width: 100% !important; margin: 0 !important; }
  .topbar { padding: 6px 0 8px !important; }
  .hero { padding: 22px 20px !important; }
  .hero h1 { font-size: 20px !important; margin-bottom: 4px !important; }
  .hero .subtitle { font-size: 12px !important; margin-bottom: 18px !important; }
  .hero .economia-value { font-size: 28px !important; }
  .hero .economia { padding: 14px 22px !important; }
  .stats { padding: 12px 0 !important; gap: 6px !important; }
  .stat { padding: 10px 6px !important; }
  .stat-value { font-size: 18px !important; }
  .stat-label { font-size: 9px !important; }
  .section { padding: 12px 0 !important; page-break-inside: avoid; break-inside: avoid; }
  .section h2 { font-size: 15px !important; margin-bottom: 8px !important; }
  .invest-box { padding: 16px 16px !important; }
  .invest-value { font-size: 28px !important; margin: 2px 0 !important; }
  .invest-grid { margin-top: 12px !important; gap: 8px !important; }
  .invest-avista, .invest-cartao, .invest-financ { padding: 12px !important; }
  .invest-avista-value, .invest-cartao-value, .invest-financ-value { font-size: 18px !important; }
  .invest-cartao { border: 2px solid var(--c1) !important; }
  .compare-card { padding: 12px !important; }
  .compare-value { font-size: 20px !important; }
  .compare-arrow { font-size: 22px !important; }
  .prazo-box { padding: 12px 14px !important; }
  .prazo-num { font-size: 28px !important; }
  .breakdown-card { padding: 10px 6px !important; }
  .breakdown-val { font-size: 14px !important; }
  .chart25-economia-val { font-size: 18px !important; }
  .chart25-leg-item { font-size: 10px !important; }
  .cta-box { padding: 18px 16px !important; }
  .cta-title { font-size: 17px !important; }
  .cta-sub { font-size: 12px !important; margin-bottom: 10px !important; }
  .cta-phone { font-size: 14px !important; margin-top: 6px !important; }
  .garantia { padding: 12px 8px !important; }
  .garantia-num { font-size: 20px !important; }
  .garantia-label { font-size: 9px !important; }
  .footer { padding: 12px 0 16px !important; }
  .footer .empresa-info { margin-top: 12px !important; font-size: 10px !important; }
  .footer .gerado { font-size: 9px !important; margin-top: 6px !important; }
  .invest-box, .cta-box, .chart-wrap, .foto-wrap { page-break-inside: avoid; break-inside: avoid; }
  .no-print { display: none !important; }
}
/* Mobile */
@media (max-width: 640px) {
  .topbar { padding: 12px 20px; flex-direction: column; gap: 8px; align-items: flex-start; }
  .topbar .meta { text-align: left; }
  .hero { padding: 40px 20px; }
  .hero h1 { font-size: 22px; }
  .hero .subtitle { font-size: 13px; margin-bottom: 24px; }
  .hero .economia { padding: 18px 20px; display: block; }
  .hero .economia-value { font-size: 32px; }
  .stats { grid-template-columns: repeat(2, 1fr); padding: 20px; gap: 10px; }
  .section { padding: 24px 20px; }
  .specs, .garantias { grid-template-columns: 1fr 1fr; }
  .invest-value { font-size: 28px; }
  .invest-grid, .invest-grid-2, .invest-grid-3 { grid-template-columns: 1fr; }
  .invest-avista-value, .invest-cartao-value, .invest-financ-value { font-size: 22px; }
  .compare { grid-template-columns: 1fr; gap: 8px; }
  .compare-arrow { transform: rotate(90deg); }
  .breakdown { grid-template-columns: 1fr 1fr; }
  .footer { padding: 24px 20px 32px; }
}
@media (max-width: 400px) {
  .stats { grid-template-columns: 1fr 1fr; }
  .garantias { grid-template-columns: 1fr 1fr; }
}
</style>
</head>
<body>
<div class="page">
  <div class="topbar">
    ${logoHtml}
    <div class="meta">
      ${codigoProposta ? `Proposta <strong style="font-family: monospace; color: var(--c-text);">${pEsc(codigoProposta)}</strong>` : `Proposta nº ${Date.now().toString().slice(-6)}`}<br/>
      ${today}
    </div>
  </div>

  <div class="hero">
    <h1>Olá,&nbsp;${pEsc(client.nome.trim())}!</h1>
    <p class="subtitle">Sua proposta de energia solar pra economizar pelos próximos 25 anos</p>
    <div class="economia">
      <div class="economia-label">Economia em 25 anos</div>
      <div class="economia-value">${pBRL(economia25)}</div>
      <div class="economia-period">Tarifa cresce ${inflacaoPct.toFixed(0).replace('.', ',')}% a.a. e taxa mínima ${inflacaoTaxaMinPct.toFixed(0).replace('.', ',')}% a.a. — médias históricas ANEEL</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${pKwp(kwp)} kWp</div>
      <div class="stat-label">Sistema</div>
    </div>
    <div class="stat">
      <div class="stat-value">${pNum(mediaMensalGerada)}</div>
      <div class="stat-label">kWh/mês</div>
    </div>
    <div class="stat">
      <div class="stat-value">${economiaPercent}%</div>
      <div class="stat-label">Da sua conta</div>
    </div>
    <div class="stat">
      <div class="stat-value">${paybackAnos}</div>
      <div class="stat-label">${paybackAnos === '—' ? 'Anos pra retorno' : 'Anos pra retorno'}</div>
    </div>
  </div>

  ${consumoKwh > 0 && contaHoje > 0 ? `<div class="section">
    <h2>Sua conta de luz: antes vs depois</h2>
    <div class="compare">
      <div class="compare-card compare-antes">
        <div class="compare-label">Hoje você paga</div>
        <div class="compare-value">${pBRL(contaHoje)}</div>
        <div class="compare-sub">por mês na sua conta</div>
      </div>
      <div class="compare-arrow">→</div>
      <div class="compare-card compare-depois">
        <div class="compare-label">Com energia solar</div>
        <div class="compare-value">${pBRL(contaComSolar)}</div>
        <div class="compare-sub">taxa mínima da concessionária</div>
      </div>
    </div>
    <div class="compare-savings">💰 Economia de ${pBRL(economiaMensal)} todo mês — em ${paybackTexto} o sistema se paga sozinho</div>
  </div>` : ''}

  <div class="section">
    <h2>Geração mensal estimada — ${pEsc(cidade)}/${uf}</h2>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.c1}"/>
            <stop offset="100%" stop-color="${palette.c2}"/>
          </linearGradient>
        </defs>
        ${yLines}
        ${bars}
      </svg>
    </div>
    <div class="chart-caption">
      Geração média anual: <strong>${pNum(geracaoAnual)} kWh</strong> · HSP da região: <strong>${ref.hsp.toFixed(1)} h/dia</strong>
    </div>
  </div>

  <div class="section">
    <h2>Equipamentos e instalação</h2>
    <div class="specs">
      <div class="spec">
        <div class="spec-label">Módulos fotovoltaicos</div>
        <div class="spec-value">${qtdModulos > 0 ? pNum(qtdModulos) : '—'} × ${pEsc(marcaModulo) || '—'}${potenciaModulo > 0 ? ' ' + potenciaModulo + ' W' : ''}</div>
      </div>
      <div class="spec">
        <div class="spec-label">Inversor</div>
        <div class="spec-value">${qtdInversores}× ${pEsc(marcaInversor) || '—'}${potenciaInversor > 0 ? ' ' + potenciaInversor.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' kW' : ''}</div>
      </div>
      <div class="spec">
        <div class="spec-label">Localização</div>
        <div class="spec-value">${pEsc(cidade) || '—'}/${uf}</div>
      </div>
      <div class="spec">
        <div class="spec-label">Consumo médio do cliente</div>
        <div class="spec-value">${consumoKwh > 0 ? pNum(consumoKwh) + ' kWh/mês' : '—'}</div>
      </div>
      ${tipoTelhado ? `<div class="spec">
        <div class="spec-label">Tipo de instalação</div>
        <div class="spec-value">${pEsc(tipoTelhado)}</div>
      </div>` : ''}
    </div>
  </div>

  ${fotoTelhado ? `<div class="section">
    <h2>Local da instalação</h2>
    <div class="foto-wrap">
      <img src="${fotoTelhado}" alt="Local da instalação"/>
    </div>
    <div class="foto-caption">${vendedor ? 'Vistoria realizada por ' + pEsc(vendedor) : 'Foto do local da instalação'}</div>
  </div>` : ''}

  <div class="section">
    <h2>Investimento</h2>
    <div class="invest-box">
      <div class="invest-label">Preço do projeto</div>
      <div class="invest-value">${pBRL(investimento)}</div>
      <div class="invest-grid invest-grid-${Math.max(1, Math.min(3, investCardsCount))}">
        ${cards.join('\n        ')}
      </div>
    </div>
  </div>

  ${investimento > 0 ? `<div class="section">
    <h2>Economia ao longo dos anos</h2>
    <div class="breakdown">
      ${breakdownAnos.map((ano, i) => `<div class="breakdown-card">
        <div class="breakdown-ano">em ${ano} ${ano === 1 ? 'ano' : 'anos'}</div>
        <div class="breakdown-val">${pBRL(breakdownEconomia[i])}</div>
      </div>`).join('')}
    </div>
    <div class="breakdown-nota">Tarifa atual ${ref.tarifa.toFixed(2).replace('.', ',')} R$/kWh · cresce ${inflacaoPct.toFixed(0).replace('.', ',')}% a.a. · taxa mínima cresce ${inflacaoTaxaMinPct.toFixed(0).replace('.', ',')}% a.a.</div>
  </div>` : ''}

  <div class="section">
    <h2>Prazo de instalação</h2>
    <div class="prazo-box">
      <div class="prazo-num">${prazoDias}</div>
      <div class="prazo-info">
        <div class="prazo-titulo">dias úteis do contrato à ligação</div>
        <div class="prazo-desc">Inclui projeto, vistoria técnica, instalação, homologação na concessionária e ART. Pode variar conforme aprovação do órgão regulador.</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Garantias inclusas</h2>
    <div class="garantias">
      <div class="garantia"><div class="garantia-num">${garPaineis}</div><div class="garantia-label">anos<br/>painéis</div></div>
      <div class="garantia"><div class="garantia-num">${garInversor}</div><div class="garantia-label">${garInversor === 1 ? 'ano' : 'anos'}<br/>inversor</div></div>
      <div class="garantia"><div class="garantia-num">${garEstrutura}</div><div class="garantia-label">${garEstrutura === 1 ? 'ano' : 'anos'}<br/>estrutura</div></div>
      <div class="garantia"><div class="garantia-num">${garInstalacao}</div><div class="garantia-label">${garInstalacao === 1 ? 'ano' : 'anos'}<br/>instalação</div></div>
      ${garExtras.map(g => `<div class="garantia"><div class="garantia-num">${g.anos}</div><div class="garantia-label">${g.anos === 1 ? 'ano' : 'anos'}<br/>${pEsc(g.nome)}</div></div>`).join('')}
    </div>
  </div>

  ${consumoKwh > 0 ? `<div class="section">
    <h2>Conta de luz nos próximos 25 anos</h2>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="gEco" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10B981" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#10B981" stop-opacity="0.10"/>
          </linearGradient>
        </defs>
        ${cYLines}
        <path d="${areaEconomia}" fill="url(#gEco)" stroke="none"/>
        <path d="${semPath}" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${comPath}" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${cXLabels}
      </svg>
    </div>
    <div class="chart25-legend">
      <div class="chart25-leg-item"><span class="chart25-leg-dot" style="background:#EF4444"></span>Sem energia solar (${pBRLshort(semSolarAcum[NUM_ANOS - 1])} em 25 anos)</div>
      <div class="chart25-leg-item"><span class="chart25-leg-dot" style="background:#10B981"></span>Com energia solar (${pBRLshort(comSolarAcum[NUM_ANOS - 1])} em 25 anos)</div>
    </div>
    <div class="chart25-economia-card">
      <div class="chart25-economia-label">A área verde é sua economia</div>
      <div class="chart25-economia-val">${pBRL(economia25)} a mais no seu bolso</div>
    </div>
  </div>` : ''}

  ${vendedorWhatsApp ? (() => {
    const phoneClean = vendedorWhatsApp.replace(/^55/, '');
    // Formato BR: (XX) XXXXX-XXXX
    const phonePretty = phoneClean.length === 11
      ? `(${phoneClean.slice(0,2)}) ${phoneClean.slice(2,7)}-${phoneClean.slice(7)}`
      : phoneClean;
    const waLink = `https://wa.me/55${phoneClean}?text=${encodeURIComponent(`Olá ${vendedor || ''}! Quero fechar a proposta — ${client.nome}.`)}`;
    return `<div class="section">
    <div class="cta-box">
      <div class="cta-title">Quer fechar essa proposta?</div>
      <div class="cta-sub">Me chama no WhatsApp que a gente tira do papel agora</div>
      <a href="${waLink}" class="cta-pill" target="_blank" rel="noopener noreferrer">Quero fechar — WhatsApp</a>
      <div class="cta-phone">${phonePretty}</div>
    </div>
  </div>`;
  })() : ''}

  <div class="footer">
    <div class="gerado">Proposta gerada por SolarDoc Pro · solardoc.app</div>
  </div>
</div>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════
function dateBR(): string {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

function str(v: unknown): string {
  return v != null ? String(v) : '___';
}

// Monta endereço no padrão: Logradouro, Bairro, Cidade/UF
function enderecoCompleto(endereco?: string, bairro?: string, cidade?: string, uf?: string): string {
  const cidadeUf = [cidade, uf].filter(Boolean).join('/');
  const parts = [endereco, bairro, cidadeUf].map(p => (p || '').trim()).filter(Boolean);
  return parts.join(', ') || '___';
}

function parseBRL(v: unknown): number {
  return parseFloat(String(v ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function curr(v: string): string {
  const n = parseBRL(v);
  if (!n && String(v).trim() === '') return v;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

const _UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const _DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const _CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function _abaixoMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(_CENTENAS[c]);
  if (resto > 0) {
    if (resto < 20) partes.push(_UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u === 0 ? _DEZENAS[d] : `${_DEZENAS[d]} e ${_UNIDADES[u]}`);
    }
  }
  return partes.join(' e ');
}

function numExtenso(v: unknown): string {
  const raw = parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(raw) || raw < 0) return String(v ?? '');
  const n = Math.floor(raw);
  if (n === 0) return 'zero';
  if (n < 1000) return _abaixoMil(n);

  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];
  let lastCoef = 0;
  if (milhoes > 0) {
    partes.push(milhoes === 1 ? 'um milhão' : `${_abaixoMil(milhoes)} milhões`);
    lastCoef = milhoes;
  }
  if (milhares > 0) {
    partes.push(milhares === 1 ? 'mil' : `${_abaixoMil(milhares)} mil`);
    lastCoef = milhares;
  }
  if (resto > 0) {
    partes.push(_abaixoMil(resto));
    lastCoef = resto;
  }
  if (partes.length === 1) return partes[0];
  const useE = lastCoef < 100 || lastCoef % 100 === 0;
  return useE
    ? partes.slice(0, -1).join(' ') + ' e ' + partes[partes.length - 1]
    : partes.join(' ');
}

function extenso(v: unknown): string {
  const n = parseBRL(v);
  if (!n) return 'valor a ser definido';
  const reais = Math.floor(n);
  const centavos = Math.round((n - reais) * 100);
  const partes: string[] = [];
  if (reais > 0) partes.push(`${numExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`);
  if (centavos > 0) partes.push(`${numExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ');
}

function numExtensoDecimal(v: string): string {
  const n = parseFloat(v);
  const m: Record<number, string> = {
    1: 'um', 2: 'dois', 3: 'três', 4: 'quatro', 5: 'cinco',
    6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove', 10: 'dez',
    15: 'quinze', 20: 'vinte',
  };
  return m[n] || String(n);
}

function procuradoresTexto(f: Record<string, unknown>): string {
  if (!f.nomes_procuradores) return '___';
  if (Array.isArray(f.nomes_procuradores)) {
    return (f.nomes_procuradores as string[]).join('\n\n');
  }
  return String(f.nomes_procuradores);
}

function equipamentosTexto(f: Record<string, unknown>): string {
  if (!Array.isArray(f.lista_equipamentos)) {
    return str(f.lista_equipamentos);
  }
  return (f.lista_equipamentos as Array<{ item: string; quantidade: number; valor?: number }>)
    .map((e) => {
      return `${String(e.quantidade).padEnd(6)} ${e.item}`;
    })
    .join('\n');
}
