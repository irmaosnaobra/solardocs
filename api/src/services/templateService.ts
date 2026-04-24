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
// CONTRATO PJ VENDAS — PACOTE COMPLETO (4 documentos)
// ════════════════════════════════════════════════════════════
function contratoPjM1(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const foro = str(f.foro_cidade);
  const cidade = company.cidade || foro;
  const comissao = str(f.percentual_comissao);

  const isPJ = client.tipo === 'PJ';
  const contratadoQualif = isPJ
    ? `${client.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${client.cpf_cnpj || '___'}, com sede em ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}, neste ato representada por ${client.representante_nome || '___'}, inscrito(a) no CPF sob o nº ${client.representante_cpf || '___'}`
    : `${client.nome}, pessoa física, inscrita no CPF sob o nº ${client.cpf_cnpj || '___'}, residente e domiciliada em ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}`;
  const signatario = isPJ ? client.representante_nome || client.nome : client.nome;

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS COMERCIAIS
PESSOA JURÍDICA — VENDAS DE ENERGIA SOLAR FOTOVOLTAICA

Pelo presente instrumento particular, as partes abaixo qualificadas celebram o presente Contrato de Prestação de Serviços Comerciais, obrigando-se mutuamente pelo cumprimento das cláusulas e condições a seguir estabelecidas:


1. QUALIFICAÇÃO DAS PARTES

CONTRATANTE: ${company.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${company.cnpj}, com sede em ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}, doravante denominada simplesmente CONTRATANTE.

CONTRATADO(A): ${contratadoQualif}, doravante denominado(a) simplesmente CONTRATADO(A).


2. OBJETO

O presente contrato tem por objeto a prestação de serviços comerciais autônomos pelo(a) CONTRATADO(A), compreendendo:

a) Prospecção, abordagem e captação de potenciais clientes para aquisição de sistemas de energia solar fotovoltaica;
b) Apresentação técnica e comercial dos produtos e serviços da CONTRATANTE;
c) Condução do processo de negociação com clientes finais;
d) Apoio ao fechamento de contratos de venda de sistemas fotovoltaicos;
e) Acompanhamento da negociação até a assinatura do contrato pelo cliente final.

Parágrafo único: Não é objeto deste contrato a execução técnica, instalação, assistência pós-venda ou qualquer serviço operacional. O escopo do(a) CONTRATADO(A) limita-se à atividade comercial descrita acima.


3. NATUREZA JURÍDICA — INEXISTÊNCIA DE VÍNCULO EMPREGATÍCIO

As partes declaram expressamente e de forma irrevogável que a presente relação é de natureza estritamente comercial e civil, NÃO gerando qualquer vínculo empregatício entre si.

A presente contratação é firmada com base nos seguintes pressupostos:

a) O(A) CONTRATADO(A) é pessoa jurídica legalmente constituída, atuando com autonomia total;
b) Não há subordinação jurídica, pessoal ou econômica do(a) CONTRATADO(A) em relação à CONTRATANTE;
c) Não há fixação de jornada, horário, rotina ou local de trabalho;
d) Não há exclusividade de atuação ou dependência econômica;
e) O(A) CONTRATADO(A) assume integralmente os riscos da atividade empresarial que exerce.

A inobservância das condições acima por qualquer das partes não descaracteriza a natureza deste instrumento, que foi firmado com plena consciência e boa-fé.


4. AUTONOMIA OPERACIONAL

O(A) CONTRATADO(A) exercerá suas atividades com total liberdade organizacional, podendo:

a) Definir seus próprios horários e rotina de trabalho;
b) Escolher os canais e métodos de prospecção e abordagem comercial;
c) Prestar serviços para outras empresas, desde que não concorrentes diretas da CONTRATANTE;
d) Trabalhar de qualquer local, sem obrigatoriedade de presença física na CONTRATANTE;
e) Contratar colaboradores ou subcontratados, sob sua exclusiva responsabilidade.

A CONTRATANTE poderá definir metas comerciais, fornecer orientações de posicionamento de marca e estabelecer padrões mínimos de qualidade na abordagem ao cliente, sem que tais orientações impliquem subordinação ou controle de jornada.


5. REMUNERAÇÃO — COMISSÃO POR RESULTADOS

5.1. Pela prestação dos serviços contratados, o(a) CONTRATADO(A) fará jus à comissão de ${comissao}% (${numExtensoDecimal(comissao)} por cento) sobre o valor líquido de cada contrato de venda de sistema fotovoltaico efetivamente assinado e com pagamento inicial confirmado pela CONTRATANTE.

5.2. A comissão é condicionada ao efetivo recebimento pelo(a) CONTRATANTE. O mero fechamento verbal ou envio de proposta, sem assinatura formal do contrato de venda e recebimento do pagamento, NÃO gera direito à comissão.

5.3. Em caso de cancelamento do contrato pelo cliente final, inadimplência, distrato ou rescisão por qualquer motivo antes do pagamento integral, a comissão sobre os valores não recebidos não será devida ao(à) CONTRATADO(A).

5.4. Contratos renegociados com desconto posterior ao fechamento original terão a comissão recalculada proporcionalmente ao novo valor efetivamente recebido.


6. GARANTIA MÍNIMA MENSAL

6.1. Fica estipulada uma garantia mínima mensal de R$ 1.700,00 (mil e setecentos reais), aplicável exclusivamente nos meses em que o(a) CONTRATADO(A) estiver em plena atividade e cumprir as obrigações contratuais.

6.2. A aplicação da garantia mínima obedecerá as seguintes regras:

a) Se o total de comissões apuradas no mês for inferior a R$ 1.700,00 → a CONTRATANTE pagará a diferença a título de complemento, totalizando R$ 1.700,00;
b) Se o total de comissões apuradas no mês for igual ou superior a R$ 1.700,01 → a CONTRATANTE pagará exclusivamente o valor das comissões apuradas, sem qualquer acréscimo.

6.3. DECLARAÇÃO EXPRESSA: A garantia mínima de R$ 1.700,00 NÃO constitui salário, remuneração fixa, piso salarial ou qualquer obrigação de natureza trabalhista. Trata-se de política comercial de incentivo, sem caráter salarial ou empregatício, que NÃO gera vínculo de emprego, NÃO incorpora ao contrato e PODE ser alterada ou suspensa pela CONTRATANTE mediante comunicação prévia de 30 (trinta) dias.

6.4. A garantia mínima ficará automaticamente suspensa nos meses em que o(a) CONTRATADO(A): (i) não registrar nenhuma venda efetiva; (ii) estiver em afastamento voluntário; (iii) descumprir quaisquer obrigações previstas neste contrato.


7. CONDIÇÕES DE PAGAMENTO

7.1. As comissões apuradas em determinado mês serão pagas até o 10º (décimo) dia útil do mês subsequente, mediante apresentação de nota fiscal de serviços pelo(a) CONTRATADO(A).

7.2. O pagamento será realizado exclusivamente por transferência bancária na conta de titularidade da pessoa jurídica do(a) CONTRATADO(A).

7.3. Eventuais divergências no valor apurado devem ser comunicadas em até 5 (cinco) dias úteis após o recebimento do extrato de comissões, sob pena de aceitação tácita dos valores.


8. OBRIGAÇÃO DE EMISSÃO DE NOTA FISCAL

8.1. O(A) CONTRATADO(A) é obrigado(a) a emitir Nota Fiscal de Serviços (NFS-e) para cada pagamento recebido a título de comissão ou complemento de garantia, no prazo máximo de 3 (três) dias úteis após o recebimento.

8.2. A ausência de emissão de nota fiscal poderá suspender o pagamento das comissões subsequentes até a regularização, sem que tal suspensão constitua mora da CONTRATANTE.


9. ENCARGOS, TRIBUTOS E RESPONSABILIDADE FISCAL

9.1. O(A) CONTRATADO(A) é o(a) único(a) responsável pelo recolhimento de todos os tributos, contribuições e encargos incidentes sobre os valores recebidos, incluindo, mas não se limitando a: ISS, IRPJ, CSLL, PIS, COFINS, contribuições previdenciárias e quaisquer outros de competência federal, estadual ou municipal.

9.2. A CONTRATANTE não efetuará qualquer retenção na fonte além das legalmente obrigatórias.

9.3. Em caso de autuação fiscal decorrente de irregularidade na situação tributária do(a) CONTRATADO(A), este(a) responderá integralmente, sem direito de regresso contra a CONTRATANTE.


10. AUSÊNCIA DE EXCLUSIVIDADE

O(A) CONTRATADO(A) poderá representar comercialmente outras empresas, desde que não atuem no mesmo segmento de mercado ou concorram diretamente com os produtos e serviços da CONTRATANTE. A violação desta cláusula ensejará rescisão imediata por justa causa.


11. OBRIGAÇÕES DO(A) CONTRATADO(A)

O(A) CONTRATADO(A) compromete-se a:

a) Atuar com ética, integridade e profissionalismo na representação da CONTRATANTE;
b) Utilizar exclusivamente os materiais institucionais, tabelas de preços e condições comerciais fornecidos e aprovados pela CONTRATANTE;
c) Não prometer condições, descontos ou benefícios não previamente autorizados;
d) Comunicar imediatamente à CONTRATANTE qualquer reclamação, questionamento ou litígio envolvendo clientes abordados;
e) Manter sigilo absoluto sobre dados técnicos, estratégicos, comerciais e financeiros da CONTRATANTE durante toda a vigência deste contrato e por 2 (dois) anos após seu encerramento;
f) Manter sua pessoa jurídica em situação regular perante a Receita Federal e demais órgãos competentes;
g) Emitir nota fiscal por todos os valores recebidos nos prazos estabelecidos.


12. OBRIGAÇÕES DA CONTRATANTE

A CONTRATANTE compromete-se a:

a) Fornecer ao(à) CONTRATADO(A) os materiais comerciais e técnicos necessários para a execução das atividades;
b) Efetuar o pagamento das comissões nos prazos estipulados, uma vez atendidas as condições estabelecidas neste instrumento;
c) Comunicar alterações de preços, condições comerciais ou produtos com antecedência mínima de 5 (cinco) dias úteis;
d) Disponibilizar canais de comunicação para suporte à atividade comercial do(a) CONTRATADO(A).


13. RESCISÃO

13.1. O presente contrato poderá ser rescindido por qualquer das partes mediante notificação escrita com antecedência mínima de 30 (trinta) dias, sem penalidades.

13.2. A rescisão imediata, independentemente de aviso prévio, poderá ser exercida pela parte inocente nas seguintes hipóteses:

a) Descumprimento de qualquer cláusula essencial deste instrumento;
b) Prática de ato ilícito, desonesto ou contrário à ética comercial;
c) Violação do dever de sigilo;
d) Representação de empresa concorrente sem autorização prévia;
e) Irregularidade fiscal ou tributária que comprometa a relação contratual.

13.3. Na hipótese de rescisão, o(a) CONTRATADO(A) fará jus exclusivamente às comissões de contratos assinados e pagamentos recebidos pela CONTRATANTE até a data de rescisão. Nenhuma outra verba, indenização, aviso prévio ou direito trabalhista será devido, dado o caráter estritamente civil desta relação.


14. DISPOSIÇÕES FINAIS

14.1. Este instrumento representa a totalidade do acordado entre as partes, substituindo qualquer entendimento verbal ou escrito anterior.

14.2. Qualquer alteração deste contrato somente terá validade se formalizada por aditivo assinado por ambas as partes.

14.3. A tolerância de qualquer das partes não implicará novação, renúncia ou alteração das condições aqui estabelecidas.

14.4. Este contrato é firmado de forma livre e consciente, sem qualquer coação, e as partes declaram ter lido e compreendido integralmente seu conteúdo antes da assinatura.


15. FORO

Fica eleito o foro da comarca de ${foro}, com exclusão de qualquer outro, para dirimir quaisquer dúvidas ou litígios decorrentes deste instrumento.

E, por estarem justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor e forma.

${cidade}, ${today}






________________________________
CONTRATANTE:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
CONTRATADO(A):
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}


Testemunhas:

________________________________        ________________________________
Nome:                                   Nome:
CPF:                                    CPF:

════════════════════════════════════════════════════════════

TERMO DE AUTONOMIA PROFISSIONAL

Pelo presente instrumento, as partes abaixo identificadas declaram, para todos os fins de direito:

DECLARANTE: ${signatario.toUpperCase()}, ${isPJ ? `representante legal de ${client.nome}, CNPJ ${client.cpf_cnpj || '___'}` : `CPF ${client.cpf_cnpj || '___'}`}, doravante denominado(a) PRESTADOR(A).

EMPRESA: ${company.nome}, CNPJ ${company.cnpj}, doravante denominada EMPRESA.

1. DECLARAÇÃO DE AUTONOMIA

O(A) PRESTADOR(A) declara, de forma livre, consciente e sem qualquer coação, que:

1.1. Exerce suas atividades comerciais com TOTAL AUTONOMIA, sem qualquer forma de subordinação à EMPRESA;

1.2. Define livremente seus horários, rotinas e metodologia de trabalho, não estando sujeito(a) a controle de jornada, ponto eletrônico, escala ou qualquer forma de controle de presença;

1.3. Não recebe ordens diretas sobre como executar seu trabalho, limitando-se as orientações recebidas a padrões mínimos de qualidade e alinhamento de marca;

1.4. É livre para organizar sua agenda conforme sua conveniência, podendo trabalhar em qualquer horário, local ou formato que julgar adequado;

1.5. Pode recusar negociações ou clientes específicos sem que isso constitua infração contratual, desde que comunique à EMPRESA com razoável antecedência.

2. LIBERDADE DE ATUAÇÃO

2.1. O(A) PRESTADOR(A) declara que tem plena liberdade para prestar serviços a outras empresas e clientes, sem exclusividade em favor da EMPRESA, exceto quanto a concorrentes diretos;

2.2. O(A) PRESTADOR(A) pode constituir sociedade, contratar funcionários ou subcontratados para auxiliar em sua atividade, sendo o(a) único(a) responsável por esses vínculos;

2.3. O(A) PRESTADOR(A) pode interromper ou suspender suas atividades temporariamente, desde que comunique à EMPRESA previamente, sem que isso gere qualquer penalidade de natureza trabalhista.

3. AUSÊNCIA DE SUBORDINAÇÃO

3.1. Não existe hierarquia funcional entre o(a) PRESTADOR(A) e qualquer colaborador ou gestor da EMPRESA;

3.2. O(A) PRESTADOR(A) não integra o quadro funcional da EMPRESA, não está sujeito(a) a avaliações de desempenho como empregado(a), não participa de reuniões obrigatórias e não recebe benefícios típicos de vínculo empregatício (férias, 13º salário, FGTS, plano de saúde como empregado, etc.);

3.3. A EMPRESA não exerce qualquer poder disciplinar sobre o(a) PRESTADOR(A) nos termos da CLT.

4. RESPONSABILIDADE TRIBUTÁRIA E PREVIDENCIÁRIA

4.1. O(A) PRESTADOR(A) declara estar ciente de que é o(a) único(a) responsável pelo recolhimento de todos os tributos, contribuições e encargos incidentes sobre sua remuneração, incluindo ISS, IRPJ, CSLL, contribuições previdenciárias e quaisquer outros;

4.2. O(A) PRESTADOR(A) se compromete a manter sua situação fiscal e empresarial regularizada durante toda a vigência da relação com a EMPRESA;

4.3. Eventuais contingências de natureza fiscal, previdenciária ou trabalhista decorrentes da atividade do(a) PRESTADOR(A) são de responsabilidade exclusiva deste(a).

5. NATUREZA COMERCIAL DA RELAÇÃO

5.1. O(A) PRESTADOR(A) reconhece que a relação estabelecida com a EMPRESA é de natureza estritamente comercial e civil, regida pelo Código Civil brasileiro e pelo presente instrumento;

5.2. O(A) PRESTADOR(A) declara que firmou o contrato de prestação de serviços de forma livre e consciente, após leitura integral e compreensão de seus termos;

5.3. O(A) PRESTADOR(A) concorda que eventuais discussões sobre a natureza da relação deverão ser resolvidas à luz do presente Termo e do contrato firmado, afastando-se qualquer presunção de vínculo empregatício.

${cidade}, ${today}






________________________________
PRESTADOR(A):
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}






________________________________
EMPRESA:
${company.nome}
CNPJ: ${company.cnpj}

════════════════════════════════════════════════════════════

POLÍTICA DE COMISSÃO COMERCIAL

EMPRESA: ${company.nome} — CNPJ: ${company.cnpj}
VIGÊNCIA: A partir de ${today}

AVISO IMPORTANTE: Este documento é uma Política Comercial interna e NÃO faz parte integrante do Contrato de Prestação de Serviços. Não gera direito adquirido, pode ser alterada ou revogada a qualquer momento pela EMPRESA, e não produz efeitos trabalhistas de qualquer natureza.

1. PERCENTUAL DE COMISSÃO

1.1. O percentual de comissão para vendas de sistemas de energia solar fotovoltaica é de ${comissao}% (${numExtensoDecimal(comissao)} por cento) sobre o valor líquido de cada contrato efetivamente recebido pela EMPRESA.

1.2. O percentual pode ser revisto pela EMPRESA a qualquer momento, mediante comunicação escrita ao(à) representante com antecedência mínima de 30 (trinta) dias.

2. REGRAS DE APURAÇÃO

2.1. A comissão é apurada mensalmente com base nos contratos com pagamento efetivamente recebido no período de referência;

2.2. O critério de competência é o recebimento, e não a assinatura ou o fechamento verbal;

2.3. Contratos que tiveram o primeiro pagamento recebido no mês de referência são incluídos na apuração desse mês.

3. CANCELAMENTOS E INADIMPLÊNCIA

3.1. Contratos cancelados pelo cliente final antes do pagamento integral NÃO geram comissão sobre os valores não recebidos;

3.2. Em caso de devolução de valores já recebidos pela EMPRESA (chargeback, rescisão com restituição), a comissão correspondente será deduzida dos créditos futuros do(a) representante;

3.3. A EMPRESA não assume responsabilidade por inadimplência de clientes finais para fins de pagamento de comissão.

4. GARANTIA MÍNIMA MENSAL

4.1. A EMPRESA adota, como política comercial de incentivo, uma garantia mínima mensal de R$ 1.700,00 (mil e setecentos reais), conforme regras abaixo:

REGRA DE APLICAÇÃO:
— Comissão apurada ABAIXO de R$ 1.700,00 → EMPRESA paga complemento até atingir R$ 1.700,00
— Comissão apurada IGUAL OU ACIMA de R$ 1.700,01 → EMPRESA paga somente a comissão apurada

4.2. DECLARAÇÕES OBRIGATÓRIAS SOBRE A GARANTIA MÍNIMA:

a) A garantia mínima de R$ 1.700,00 NÃO é salário;
b) NÃO constitui piso salarial de qualquer natureza;
c) NÃO gera vínculo empregatício;
d) NÃO incorpora ao contrato como obrigação permanente;
e) NÃO gera direito adquirido ao(à) representante;
f) PODE ser alterada, reduzida, suspensa ou extinta pela EMPRESA a qualquer momento, com aviso prévio de 30 dias;
g) É política comercial discricionária da EMPRESA, criada com finalidade de incentivo e suporte inicial à atividade comercial.

4.3. A garantia mínima ficará automaticamente suspensa nos meses em que o(a) representante: (i) não registrar nenhum contrato efetivo; (ii) estiver em afastamento por iniciativa própria; (iii) estiver em processo de rescisão contratual; (iv) descumprir obrigações contratuais.

5. FORMA E PRAZO DE PAGAMENTO

5.1. Pagamento até o 10º (décimo) dia útil do mês subsequente ao de apuração;

5.2. Exclusivamente mediante transferência bancária para conta da pessoa jurídica do(a) representante;

5.3. Condicionado à apresentação de Nota Fiscal de Serviços válida.

6. VALIDADE E ALTERAÇÕES

6.1. Esta Política entra em vigor na data de sua publicação e permanece válida até nova versão ser emitida;

6.2. Alterações serão comunicadas com antecedência mínima de 30 (trinta) dias;

6.3. A continuidade da prestação de serviços após o recebimento da comunicação de alteração implica aceitação tácita das novas condições.

${cidade}, ${today}






________________________________
REPRESENTANTE:
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}






________________________________
EMPRESA:
${company.nome}
CNPJ: ${company.cnpj}

════════════════════════════════════════════════════════════

TERMO DE ENCERRAMENTO DE PRESTAÇÃO DE SERVIÇOS

Pelo presente instrumento particular, as partes abaixo qualificadas formalizam o encerramento amigável da relação de prestação de serviços estabelecida entre si:

EMPRESA: ${company.nome}, CNPJ ${company.cnpj}, ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}, doravante denominada EMPRESA.

PRESTADOR(A): ${contratadoQualif}, doravante denominado(a) PRESTADOR(A).

1. ENCERRAMENTO AMIGÁVEL

As partes declaram que o Contrato de Prestação de Serviços Comerciais firmado entre si é encerrado nesta data de forma amigável, por mútuo acordo e sem qualquer litígio entre as partes.

2. DECLARAÇÃO DE INEXISTÊNCIA DE VÍNCULO EMPREGATÍCIO

2.1. As partes reafirmam, de forma irrevogável, que a relação ora encerrada foi, desde seu início, de natureza estritamente comercial e civil, JAMAIS tendo constituído relação de emprego nos termos da Consolidação das Leis do Trabalho — CLT;

2.2. O(A) PRESTADOR(A) declara expressamente que:

a) Em nenhum momento da relação existiu subordinação jurídica, pessoal ou econômica;
b) Em nenhum momento houve controle de jornada, imposição de horário ou fixação de local de trabalho;
c) Em nenhum momento recebeu salário, benefícios empregatícios ou qualquer verba de natureza trabalhista;
d) Atuou sempre como pessoa jurídica autônoma, com plena consciência da natureza civil da relação.

3. QUITAÇÃO TOTAL

3.1. O(A) PRESTADOR(A) declara ter recebido todos os valores de comissões devidos até a data deste Termo, encontrando-se integralmente quitado(a) perante a EMPRESA;

3.2. A EMPRESA declara que não possui pendências, débitos ou créditos em aberto com o(a) PRESTADOR(A), salvo eventuais comissões de contratos já assinados e com pagamentos ainda a receber, que serão liquidadas conforme previsto no contrato;

3.3. Ambas as partes declaram que nada mais têm a reclamar uma da outra a título de comissões, complementos, bônus, indenizações, compensações ou qualquer outra verba decorrente da relação ora encerrada.

4. AUSÊNCIA DE PENDÊNCIAS

4.1. O(A) PRESTADOR(A) devolverá à EMPRESA, na data de assinatura deste Termo, todos os materiais institucionais, listas de clientes, propostas em andamento, acessos a sistemas e quaisquer outros recursos fornecidos pela EMPRESA para a execução das atividades;

4.2. O dever de sigilo sobre informações técnicas, comerciais e financeiras da EMPRESA permanece vigente por 2 (dois) anos após a data deste Termo.

5. CLÁUSULA DE NÃO REIVINDICAÇÃO

5.1. O(A) PRESTADOR(A) declara expressamente que, em razão da inequívoca natureza civil e comercial da relação ora encerrada, RENUNCIA de forma livre, consciente e irrevogável a qualquer direito, pretensão ou ação de natureza trabalhista, previdenciária ou correlata perante qualquer instância judicial ou administrativa, incluindo, sem limitação:

a) Reconhecimento de vínculo empregatício;
b) Pagamento de horas extras, adicional noturno ou qualquer jornada especial;
c) 13º salário, férias ou verbas rescisórias;
d) Contribuições previdenciárias patronais;
e) FGTS ou qualquer fundo de natureza similar;
f) Qualquer outra verba típica de relação de emprego.

5.2. O(A) PRESTADOR(A) reconhece que esta renúncia é válida e eficaz, pois a relação jamais teve natureza empregatícia, e que eventual demanda trabalhista configuraria litigância de má-fé, sujeitando-o(a) às penalidades legais cabíveis.

6. DISPOSIÇÕES FINAIS

Este Termo é firmado de forma livre e consciente, após plena leitura e compreensão de seu conteúdo, e produz todos os efeitos legais a partir da data de sua assinatura.

${cidade}, ${today}






________________________________
EMPRESA:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
PRESTADOR(A):
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}


Testemunhas:

________________________________        ________________________________
Nome:                                   Nome:
CPF:                                    CPF:
`;
}

// ════════════════════════════════════════════════════════════
// CONTRATO PJ VENDAS — PACOTE REFORÇADO (4 documentos, linguagem jurídica aprimorada)
// ════════════════════════════════════════════════════════════
function contratoPjM2(
  company: Company,
  client: Client,
  f: Record<string, unknown>
): string {
  const today = dateBR();
  const foro = str(f.foro_cidade);
  const cidade = company.cidade || foro;
  const comissao = str(f.percentual_comissao);

  const isPJ = client.tipo === 'PJ';
  const contratadoQualif = isPJ
    ? `${client.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${client.cpf_cnpj || '___'}, com sede em ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}, neste ato representada por ${client.representante_nome || '___'}, inscrito(a) no CPF sob o nº ${client.representante_cpf || '___'}`
    : `${client.nome}, pessoa física, inscrita no CPF sob o nº ${client.cpf_cnpj || '___'}, residente e domiciliada em ${enderecoCompleto(client.endereco, client.bairro, client.cidade, client.uf)}`;
  const signatario = isPJ ? client.representante_nome || client.nome : client.nome;

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS COMERCIAIS
PESSOA JURÍDICA — VENDAS DE ENERGIA SOLAR FOTOVOLTAICA
VERSÃO REFORÇADA

Pelo presente instrumento particular, de um lado como CONTRATANTE e de outro como CONTRATADO(A), as partes abaixo qualificadas e identificadas firmam o presente Contrato de Prestação de Serviços Comerciais Autônomos, que será regido pelas cláusulas e condições a seguir estabelecidas, às quais as partes aderem de forma livre, consciente e irrevogável:


CLÁUSULA PRIMEIRA — DA QUALIFICAÇÃO DAS PARTES

1.1. CONTRATANTE: ${company.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${company.cnpj}, com sede em ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}, doravante denominada simplesmente CONTRATANTE.

1.2. CONTRATADO(A): ${contratadoQualif}, doravante denominado(a) simplesmente CONTRATADO(A).

1.3. As partes declaram ter plena capacidade jurídica para celebrar o presente instrumento, tendo lido e compreendido integralmente seu conteúdo antes da assinatura.


CLÁUSULA SEGUNDA — DO OBJETO DO CONTRATO

2.1. O presente instrumento tem por objeto exclusivo a prestação de serviços comerciais autônomos pelo(a) CONTRATADO(A) em favor da CONTRATANTE, abrangendo as seguintes atividades:

   a) Prospecção ativa e receptiva de potenciais clientes para aquisição de sistemas de energia solar fotovoltaica;
   b) Apresentação técnica, comercial e institucional dos produtos e serviços da CONTRATANTE;
   c) Condução do processo de negociação com clientes finais, observando as diretrizes e tabelas de preços fornecidas pela CONTRATANTE;
   d) Apoio ao fechamento formal de contratos de venda de sistemas fotovoltaicos;
   e) Acompanhamento da negociação desde o primeiro contato com o cliente até a assinatura do contrato e confirmação do pagamento inicial.

2.2. Parágrafo único: Não integram o objeto deste contrato quaisquer atividades de execução técnica, instalação, manutenção, assistência pós-venda, suporte operacional ou qualquer serviço de natureza não comercial. O escopo do(a) CONTRATADO(A) restringe-se estritamente à atividade comercial descrita no caput desta cláusula.


CLÁUSULA TERCEIRA — DA NATUREZA JURÍDICA E INEXISTÊNCIA DE VÍNCULO EMPREGATÍCIO

3.1. As partes declaram, de forma expressa, inequívoca e irrevogável, que a presente relação jurídica é de natureza estritamente comercial e civil, regulada pelo Código Civil Brasileiro, NÃO constituindo, em hipótese alguma, relação de emprego nos termos da Consolidação das Leis do Trabalho — CLT.

3.2. A presente contratação é caracterizada pelos seguintes elementos estruturantes, que afastam qualquer configuração de vínculo empregatício:

   a) O(A) CONTRATADO(A) é pessoa jurídica legalmente constituída, dotada de autonomia empresarial plena;
   b) Inexiste subordinação jurídica, pessoal, econômica ou funcional do(a) CONTRATADO(A) em relação à CONTRATANTE;
   c) Não há estipulação de jornada de trabalho, horário fixo, escala, frequência ou local obrigatório de atuação;
   d) Não há exclusividade de dedicação ou dependência econômica exclusiva em relação à CONTRATANTE;
   e) O(A) CONTRATADO(A) assume integralmente os riscos, responsabilidades e ônus da atividade empresarial que exerce;
   f) A remuneração é variável, condicionada a resultados efetivos, sem garantia de remuneração fixa de natureza salarial.

3.3. A eventual concessão de orientações, diretrizes de posicionamento de marca ou padrões mínimos de qualidade pela CONTRATANTE não caracteriza subordinação nem altera a natureza civil deste instrumento.

3.4. Quaisquer contingências de natureza trabalhista, previdenciária ou correlata que eventualmente sejam reclamadas por terceiros em razão da atividade do(a) CONTRATADO(A) são de responsabilidade exclusiva deste(a), que responderá integralmente por tais demandas, sem direito de regresso contra a CONTRATANTE.


CLÁUSULA QUARTA — DA AUTONOMIA OPERACIONAL

4.1. O(A) CONTRATADO(A) exercerá suas atividades com total liberdade organizacional, sem qualquer forma de controle ou ingerência da CONTRATANTE sobre a forma de execução dos serviços, podendo:

   a) Estabelecer livremente seus horários, rotinas e metodologia de trabalho;
   b) Selecionar os canais, métodos e ferramentas de prospecção e abordagem comercial que julgar mais adequados;
   c) Prestar serviços a outras empresas cujos produtos ou serviços não concorram diretamente com os da CONTRATANTE;
   d) Exercer suas atividades de qualquer local, sem obrigatoriedade de presença física nas dependências da CONTRATANTE;
   e) Constituir equipe própria, contratar colaboradores ou subcontratados, sendo o(a) único(a) responsável por esses vínculos.

4.2. A CONTRATANTE poderá, sem que isso implique subordinação ou controle de jornada, definir metas comerciais orientativas, fornecer treinamentos opcionais e estabelecer padrões mínimos de qualidade na abordagem ao cliente final.

4.3. A recusa pelo(a) CONTRATADO(A) de atender a determinada orientação da CONTRATANTE, desde que não configure descumprimento contratual, não poderá ser utilizada como fundamento para rescisão por justa causa.


CLÁUSULA QUINTA — DA REMUNERAÇÃO E COMISSÃO POR RESULTADOS

5.1. Pela prestação dos serviços contratados, o(a) CONTRATADO(A) fará jus à comissão de ${comissao}% (${numExtensoDecimal(comissao)} por cento) calculada sobre o valor líquido de cada contrato de venda de sistema fotovoltaico efetivamente assinado pelo cliente final e com pagamento inicial confirmado nos sistemas financeiros da CONTRATANTE.

5.2. A comissão é condicionada, de forma absoluta, ao efetivo recebimento dos valores pela CONTRATANTE. O mero fechamento verbal, o envio de proposta, a visita técnica realizada ou qualquer etapa do processo anterior à assinatura formal do contrato de venda e à confirmação do pagamento inicial NÃO geram direito à comissão.

5.3. Em caso de cancelamento do contrato pelo cliente final, inadimplência, distrato, chargeback ou rescisão por qualquer motivo antes do pagamento integral, a comissão correspondente aos valores não recebidos não será devida ao(à) CONTRATADO(A), e os valores eventualmente já pagos a esse título serão compensados em comissões futuras.

5.4. Contratos renegociados com concessão de desconto posterior ao fechamento original terão o valor da comissão recalculado proporcionalmente ao novo valor líquido efetivamente recebido pela CONTRATANTE.

5.5. A CONTRATANTE disponibilizará ao(à) CONTRATADO(A), mensalmente, extrato detalhado dos contratos computados na apuração de comissões, com indicação dos valores recebidos e das comissões devidas.


CLÁUSULA SEXTA — DA GARANTIA MÍNIMA MENSAL

6.1. Fica estipulada, como política comercial de incentivo e suporte inicial, uma garantia mínima mensal de R$ 1.700,00 (mil e setecentos reais), aplicável nos meses em que o(a) CONTRATADO(A) estiver em plena atividade e cumprir integralmente as obrigações contratuais.

6.2. A aplicação da garantia mínima obedecerá, de forma exclusiva e taxativa, às seguintes regras:

   a) Se o total de comissões apuradas no mês for inferior a R$ 1.700,00 → a CONTRATANTE pagará a diferença a título de complemento, totalizando R$ 1.700,00 ao(à) CONTRATADO(A);
   b) Se o total de comissões apuradas no mês for igual ou superior a R$ 1.700,01 → a CONTRATANTE pagará exclusivamente o valor das comissões efetivamente apuradas, sem qualquer acréscimo.

6.3. DECLARAÇÕES OBRIGATÓRIAS — NATUREZA DA GARANTIA MÍNIMA:

   As partes declaram expressamente e de forma irrevogável que a garantia mínima de R$ 1.700,00:

   a) NÃO constitui salário, remuneração fixa, piso salarial ou qualquer obrigação de natureza trabalhista ou previdenciária;
   b) NÃO gera vínculo empregatício entre as partes, em nenhuma circunstância;
   c) NÃO se incorpora ao contrato como obrigação permanente nem gera direito adquirido ao(à) CONTRATADO(A);
   d) NÃO produz efeitos rescisórios, indenizatórios ou compensatórios de qualquer espécie;
   e) Trata-se de política comercial discricionária e revogável da CONTRATANTE, criada com finalidade exclusiva de incentivo;
   f) PODE ser alterada, reduzida, suspensa ou extinta pela CONTRATANTE a qualquer momento, mediante comunicação prévia de 30 (trinta) dias ao(à) CONTRATADO(A).

6.4. A garantia mínima ficará automaticamente suspensa, sem necessidade de comunicação formal, nos meses em que o(a) CONTRATADO(A): (i) não registrar nenhuma venda com pagamento efetivo confirmado; (ii) estiver em afastamento voluntário; (iii) estiver em período de aviso rescisório; (iv) descumprir quaisquer obrigações previstas neste contrato.


CLÁUSULA SÉTIMA — DAS CONDIÇÕES DE PAGAMENTO

7.1. As comissões e, quando aplicável, o complemento da garantia mínima apurados em determinado mês serão pagos até o 10º (décimo) dia útil do mês subsequente, condicionado à apresentação prévia de Nota Fiscal de Serviços válida pelo(a) CONTRATADO(A).

7.2. O pagamento será realizado exclusivamente por transferência bancária (TED, PIX ou equivalente) para conta de titularidade da pessoa jurídica do(a) CONTRATADO(A), não sendo admitidos pagamentos em espécie ou para pessoa física.

7.3. Eventuais divergências no valor apurado devem ser formalmente comunicadas à CONTRATANTE em até 5 (cinco) dias úteis após o recebimento do extrato mensal de comissões, sob pena de aceitação tácita e irrevogável dos valores informados.

7.4. O atraso no pagamento das comissões por culpa exclusiva da CONTRATANTE, após o prazo estipulado no item 7.1, sujeitará o valor em atraso à atualização pelo IPCA e acréscimo de multa moratória de 2% (dois por cento).


CLÁUSULA OITAVA — DA OBRIGAÇÃO DE EMISSÃO DE NOTA FISCAL

8.1. O(A) CONTRATADO(A) é obrigado(a) a emitir Nota Fiscal de Serviços Eletrônica (NFS-e) para cada pagamento recebido a título de comissão ou complemento de garantia mínima, no prazo máximo de 3 (três) dias úteis contados do recebimento.

8.2. A ausência ou atraso na emissão da nota fiscal autorizará a CONTRATANTE a suspender o pagamento das comissões subsequentes até a plena regularização, sem que tal suspensão configure mora ou inadimplemento por parte da CONTRATANTE.

8.3. O(A) CONTRATADO(A) é integralmente responsável pela correta emissão da nota fiscal, pelo recolhimento dos tributos incidentes e pela regularidade de seu cadastro fiscal perante os órgãos competentes.


CLÁUSULA NONA — DOS ENCARGOS, TRIBUTOS E RESPONSABILIDADE FISCAL

9.1. O(A) CONTRATADO(A) é o(a) único(a) e exclusivo(a) responsável pelo recolhimento de todos os tributos, contribuições sociais e encargos que incidam ou venham a incidir sobre os valores recebidos em razão deste contrato, incluindo, sem caráter taxativo: ISS, IRPJ, CSLL, PIS, COFINS, contribuições previdenciárias, contribuições ao Sistema S e quaisquer outros tributos de competência federal, estadual ou municipal.

9.2. A CONTRATANTE não realizará qualquer retenção na fonte além das legalmente obrigatórias para a modalidade contratual ora estipulada.

9.3. Em caso de autuação, notificação fiscal, auto de infração ou qualquer exigência de autoridade tributária decorrente de irregularidade na situação fiscal ou tributária do(a) CONTRATADO(A), este(a) responderá integralmente por todos os valores, acrescidos de multas, juros e demais encargos, sem qualquer direito de regresso ou reembolso contra a CONTRATANTE.


CLÁUSULA DÉCIMA — DA AUSÊNCIA DE EXCLUSIVIDADE

O(A) CONTRATADO(A) poderá representar comercialmente outras empresas e atuar em outros segmentos de mercado, desde que tais empresas ou atividades não concorram diretamente com os produtos e serviços da CONTRATANTE no mercado de energia solar fotovoltaica. A violação desta cláusula, após notificação com prazo de 5 (cinco) dias úteis para cessação da atividade conflitante, ensejará rescisão imediata por justa causa, sem qualquer ônus para a CONTRATANTE.


CLÁUSULA DÉCIMA PRIMEIRA — DAS OBRIGAÇÕES DO(A) CONTRATADO(A)

11.1. O(A) CONTRATADO(A) compromete-se, irrevogavelmente, a:

   a) Atuar com ética, integridade, boa-fé e profissionalismo na representação comercial da CONTRATANTE, zelando pela imagem e reputação institucional desta;
   b) Utilizar exclusivamente os materiais institucionais, tabelas de preços, condições comerciais e argumentos de venda fornecidos e previamente aprovados pela CONTRATANTE;
   c) Não prometer condições comerciais, descontos, prazos, bônus ou benefícios não previamente autorizados por escrito pela CONTRATANTE;
   d) Comunicar imediatamente à CONTRATANTE qualquer reclamação, contestação, ameaça de ação judicial ou questionamento formulado por clientes abordados no exercício deste contrato;
   e) Observar estritamente a legislação aplicável no exercício de suas atividades, incluindo as normas de proteção ao consumidor e de proteção de dados pessoais (LGPD);
   f) Manter sigilo absoluto e irrestrito sobre dados técnicos, estratégicos, comerciais, financeiros e operacionais da CONTRATANTE, bem como sobre sua carteira de clientes, durante toda a vigência deste contrato e por 2 (dois) anos após seu encerramento, sob pena de responsabilidade civil e criminal;
   g) Manter sua pessoa jurídica em situação fiscal, previdenciária e cadastral regular perante todos os órgãos competentes durante toda a vigência deste instrumento;
   h) Emitir Nota Fiscal de Serviços por todos os valores recebidos, nos prazos e condições estabelecidas neste instrumento.


CLÁUSULA DÉCIMA SEGUNDA — DAS OBRIGAÇÕES DA CONTRATANTE

12.1. A CONTRATANTE compromete-se a:

   a) Fornecer ao(à) CONTRATADO(A) os materiais comerciais, técnicos e institucionais necessários para a execução adequada das atividades previstas neste instrumento;
   b) Efetuar o pagamento das comissões nos prazos estipulados, uma vez atendidas integralmente as condições estabelecidas neste instrumento;
   c) Comunicar alterações de preços, condições comerciais, produtos ou políticas com antecedência mínima de 5 (cinco) dias úteis, salvo situações emergenciais devidamente justificadas;
   d) Disponibilizar canais de comunicação para suporte à atividade comercial do(a) CONTRATADO(A);
   e) Fornecer mensalmente extrato detalhado das comissões apuradas, com descrição dos contratos considerados na apuração.


CLÁUSULA DÉCIMA TERCEIRA — DA RESCISÃO CONTRATUAL

13.1. O presente contrato poderá ser rescindido por qualquer das partes mediante notificação escrita com antecedência mínima de 30 (trinta) dias corridos, sem necessidade de justificativa e sem incidência de penalidades.

13.2. A rescisão imediata, independentemente de aviso prévio e sem ônus para a parte inocente, poderá ser exercida nas seguintes hipóteses:

   a) Descumprimento de qualquer cláusula essencial deste instrumento pela parte infratora, após notificação com prazo de 5 (cinco) dias úteis para saneamento;
   b) Prática de ato ilícito, antiético, desonesto ou contrário às boas práticas comerciais por qualquer das partes;
   c) Violação do dever de sigilo e confidencialidade;
   d) Representação de empresa concorrente direta sem autorização prévia e expressa da CONTRATANTE;
   e) Irregularidade fiscal, tributária ou societária do(a) CONTRATADO(A) que comprometa a higidez da relação contratual;
   f) Declaração de insolvência, falência ou recuperação judicial de qualquer das partes.

13.3. Na hipótese de rescisão por qualquer motivo, o(a) CONTRATADO(A) fará jus exclusivamente às comissões de contratos formalmente assinados e cujos pagamentos sejam efetivamente recebidos pela CONTRATANTE até a data de rescisão. Nenhuma outra verba, indenização, aviso prévio ou direito de qualquer natureza trabalhista será devido, dada a inequívoca natureza estritamente civil e comercial deste instrumento.


CLÁUSULA DÉCIMA QUARTA — DAS DISPOSIÇÕES GERAIS

14.1. Este instrumento representa a totalidade do acordado entre as partes com relação ao seu objeto, substituindo e revogando quaisquer entendimentos verbais, escritos, memorandos ou cartas-intenção anteriores sobre a mesma matéria.

14.2. Qualquer alteração ou aditamento a este contrato somente terá validade jurídica se formalizado por instrumento escrito, assinado por ambas as partes ou seus representantes legais devidamente habilitados.

14.3. A tolerância de qualquer das partes quanto ao descumprimento de obrigação pela outra não implicará novação, renúncia, modificação ou alteração das condições aqui estabelecidas, podendo a parte tolerante exigir o cumprimento integral a qualquer momento.

14.4. A eventual nulidade ou invalidade de qualquer cláusula deste instrumento não contaminará as demais, que permanecerão em pleno vigor, devendo as partes negociar de boa-fé a substituição da cláusula inválida por outra de efeito equivalente.

14.5. As partes declaram que celebraram este instrumento de forma livre, espontânea e consciente, sem qualquer coação, dolo, erro ou lesão, após leitura integral e compreensão plena de seu conteúdo.


CLÁUSULA DÉCIMA QUINTA — DO FORO

15.1. Fica eleito, pelas partes, de forma irrevogável e com exclusão de qualquer outro, por mais privilegiado que seja, o Foro da Comarca de ${foro} para dirimir quaisquer dúvidas, conflitos ou litígios decorrentes deste instrumento ou de sua execução.

E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor e forma, na presença das testemunhas abaixo.

${cidade}, ${today}






________________________________
CONTRATANTE:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
CONTRATADO(A):
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}


Testemunhas:

________________________________        ________________________________
Nome:                                   Nome:
CPF:                                    CPF:

════════════════════════════════════════════════════════════

TERMO DE AUTONOMIA PROFISSIONAL E DECLARAÇÃO DE INEXISTÊNCIA DE VÍNCULO EMPREGATÍCIO

Pelo presente instrumento, as partes abaixo identificadas declaram e afirmam, para todos os fins de direito e sob as penas da lei:

DECLARANTE: ${signatario.toUpperCase()}, ${isPJ ? `representante legal de ${client.nome}, CNPJ ${client.cpf_cnpj || '___'}` : `CPF ${client.cpf_cnpj || '___'}`}, doravante denominado(a) PRESTADOR(A).

EMPRESA: ${company.nome}, CNPJ ${company.cnpj}, doravante denominada EMPRESA.


CLÁUSULA PRIMEIRA — DA DECLARAÇÃO DE AUTONOMIA PLENA

1.1. O(A) PRESTADOR(A) declara, de forma livre, voluntária, consciente e irrevogável, que exerce suas atividades comerciais com TOTAL E ABSOLUTA AUTONOMIA, sem qualquer forma de subordinação, controle ou ingerência da EMPRESA sobre o modo, o tempo ou o local de execução dos serviços.

1.2. O(A) PRESTADOR(A) afirma categoricamente que:

   a) Define com exclusividade seus próprios horários, agenda, rotinas e metodologia de trabalho, não estando sujeito(a) a qualquer forma de controle de jornada, ponto eletrônico, escala ou frequência;
   b) Não recebe ordens diretas sobre como executar sua atividade comercial, limitando-se eventuais orientações da EMPRESA a parâmetros mínimos de qualidade, posicionamento de marca e conformidade comercial;
   c) É livre para organizar sua agenda conforme sua exclusiva conveniência e estratégia comercial, podendo trabalhar em qualquer horário, local ou formato que julgar adequado ao seu modelo de negócio;
   d) Pode declinar de atender a determinados clientes ou negociações específicas sem que isso constitua infração contratual ou justificativa para rescisão por justa causa.


CLÁUSULA SEGUNDA — DA LIBERDADE DE ATUAÇÃO NO MERCADO

2.1. O(A) PRESTADOR(A) declara possuir plena liberdade para prestar serviços a outras empresas, clientes e contratantes, sem exclusividade em favor da EMPRESA, respeitado apenas o limite de não atuar em favor de concorrentes diretos desta no mercado de energia solar fotovoltaica.

2.2. O(A) PRESTADOR(A) tem capacidade e autonomia para constituir ou ampliar sua estrutura empresarial, contratar funcionários, sócios ou subcontratados para auxiliar em sua atividade comercial, sendo o(a) único(a) responsável por todos os vínculos jurídicos assim estabelecidos.

2.3. O(A) PRESTADOR(A) pode interromper ou suspender temporariamente suas atividades, mediante comunicação prévia à EMPRESA, sem que isso implique qualquer penalidade de natureza trabalhista, rescisão indireta ou obrigação de indenização.


CLÁUSULA TERCEIRA — DA AUSÊNCIA TOTAL DE SUBORDINAÇÃO

3.1. O(A) PRESTADOR(A) confirma inexistir qualquer hierarquia funcional, vínculo de subordinação ou relação de poder entre si e qualquer colaborador, gestor, sócio ou preposto da EMPRESA.

3.2. O(A) PRESTADOR(A) declara que não integra, em nenhuma medida, o quadro funcional ou organograma da EMPRESA, não está sujeito(a) a avaliações de desempenho como empregado(a), não participa de reuniões obrigatórias como condição do contrato e não recebe, nem tem direito a receber, benefícios típicos de vínculo empregatício (férias remuneradas, 13º salário, FGTS, adicional de insalubridade, plano de saúde como empregado, vale-transporte obrigatório, etc.).

3.3. O(A) PRESTADOR(A) reconhece que a EMPRESA não exerce sobre si qualquer poder disciplinar nos termos da CLT e que eventuais orientações recebidas não configuram, sob nenhuma hipótese, poder diretivo de empregador.


CLÁUSULA QUARTA — DA RESPONSABILIDADE TRIBUTÁRIA E PREVIDENCIÁRIA

4.1. O(A) PRESTADOR(A) declara estar plenamente ciente de que é o(a) único(a) e exclusivo(a) responsável pelo recolhimento de todos os tributos, contribuições e encargos incidentes sobre sua remuneração, incluindo ISS, IRPJ, CSLL, PIS, COFINS, contribuições previdenciárias e quaisquer outros tributos de competência federal, estadual ou municipal, sem possibilidade de transferência de tal responsabilidade à EMPRESA.

4.2. O(A) PRESTADOR(A) compromete-se a manter sua situação fiscal, previdenciária e empresarial regularizada durante toda a vigência da relação com a EMPRESA, apresentando, sempre que solicitado, as certidões negativas de débito pertinentes.

4.3. Eventuais contingências de natureza fiscal, previdenciária ou trabalhista decorrentes da atividade do(a) PRESTADOR(A) são de responsabilidade exclusiva e integral deste(a), sem qualquer ônus para a EMPRESA.


CLÁUSULA QUINTA — DO RECONHECIMENTO DA NATUREZA COMERCIAL DA RELAÇÃO

5.1. O(A) PRESTADOR(A) reconhece e confirma que a relação estabelecida com a EMPRESA é de natureza estritamente comercial e civil, regida pelo Código Civil Brasileiro e pelo Contrato de Prestação de Serviços firmado entre as partes.

5.2. O(A) PRESTADOR(A) declara ter firmado o contrato de prestação de serviços de forma livre e consciente, após leitura integral, compreensão plena e, se necessário, consulta a assessoria jurídica de sua confiança.

5.3. O(A) PRESTADOR(A) concorda expressamente que eventuais discussões sobre a natureza jurídica da relação entre as partes deverão ser resolvidas exclusivamente à luz do presente Termo, do Contrato firmado e dos elementos fáticos concretos que caracterizam a relação autônoma, afastando-se qualquer presunção de vínculo empregatício.

${cidade}, ${today}






________________________________
PRESTADOR(A):
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}






________________________________
EMPRESA:
${company.nome}
CNPJ: ${company.cnpj}

════════════════════════════════════════════════════════════

POLÍTICA DE COMISSÃO COMERCIAL — VERSÃO DETALHADA

EMPRESA: ${company.nome} — CNPJ: ${company.cnpj}
VIGÊNCIA: A partir de ${today}

AVISO IMPORTANTE: Este documento é uma Política Comercial interna de natureza administrativa e NÃO constitui parte integrante do Contrato de Prestação de Serviços. Não gera direito adquirido de qualquer espécie, pode ser alterada, suspensa ou revogada a qualquer momento pela EMPRESA mediante comunicação prévia, e não produz efeitos trabalhistas, previdenciários ou de qualquer natureza não comercial.


CAPÍTULO I — DO PERCENTUAL DE COMISSÃO

1.1. O percentual de comissão aplicável às vendas de sistemas de energia solar fotovoltaica realizadas no âmbito do Contrato de Prestação de Serviços é de ${comissao}% (${numExtensoDecimal(comissao)} por cento) incidente sobre o valor líquido de cada contrato de venda efetivamente recebido pela EMPRESA.

1.2. Entende-se por "valor líquido" o valor total do contrato de venda, deduzidos eventuais descontos, abatimentos, estornos ou devoluções realizados após o fechamento original.

1.3. O percentual de comissão poderá ser revisto e atualizado pela EMPRESA a qualquer momento, mediante comunicação escrita ao(à) representante com antecedência mínima de 30 (trinta) dias, sem que a revisão configure alteração prejudicial indenizável.


CAPÍTULO II — DAS REGRAS DE APURAÇÃO DE COMISSÕES

2.1. A apuração de comissões é realizada mensalmente, com base nos contratos de venda cujo pagamento inicial tenha sido efetivamente recebido pela EMPRESA no período de referência (critério de caixa).

2.2. O critério determinante para inclusão de um contrato na apuração mensal é o recebimento efetivo do pagamento, e não a data de assinatura do contrato, a data de fechamento verbal, a data de cadastro no sistema ou qualquer outro marco anterior ao recebimento financeiro.

2.3. Contratos cujo pagamento inicial seja recebido em determinado mês serão computados integralmente na apuração desse mês, independentemente de quando foram assinados ou iniciados.

2.4. A EMPRESA disponibilizará ao(à) representante, até o 5º (quinto) dia útil do mês subsequente, extrato detalhado das comissões apuradas no mês anterior, com identificação dos contratos, valores recebidos e comissões correspondentes.


CAPÍTULO III — DOS CANCELAMENTOS, INADIMPLÊNCIA E DEVOLUÇÕES

3.1. Contratos de venda cancelados pelo cliente final antes do pagamento integral NÃO geram comissão sobre os valores não recebidos pela EMPRESA, independentemente do estágio de execução da venda.

3.2. Em caso de devolução de valores já recebidos pela EMPRESA decorrente de chargeback, rescisão com restituição, liminar judicial ou qualquer outra causa, a comissão correspondente aos valores devolvidos será deduzida dos créditos de comissões futuras do(a) representante.

3.3. A EMPRESA não assume qualquer responsabilidade perante o(a) representante por inadimplência, insolvência ou incapacidade de pagamento de clientes finais, para fins de apuração e pagamento de comissões.

3.4. Em caso de renegociação de contrato com redução de valor após o fechamento original, a comissão será recalculada proporcionalmente ao novo valor líquido efetivamente recebido, com ajuste no próximo extrato mensal.


CAPÍTULO IV — DA GARANTIA MÍNIMA MENSAL

4.1. A EMPRESA adota, como política comercial de incentivo e suporte inicial à atividade do(a) representante, uma garantia mínima mensal no valor de R$ 1.700,00 (mil e setecentos reais), sujeita às regras e condições estabelecidas neste Capítulo.

4.2. REGRAS DE APLICAÇÃO DA GARANTIA MÍNIMA:

   — Comissão total apurada no mês ABAIXO de R$ 1.700,00:
     → A EMPRESA pagará a diferença a título de complemento, totalizando R$ 1.700,00

   — Comissão total apurada no mês IGUAL OU ACIMA de R$ 1.700,01:
     → A EMPRESA pagará exclusivamente o valor das comissões efetivamente apuradas, sem acréscimo algum

4.3. DECLARAÇÕES OBRIGATÓRIAS SOBRE A NATUREZA DA GARANTIA MÍNIMA:

As partes declaram, de forma expressa e irrevogável, que a garantia mínima de R$ 1.700,00:

   a) NÃO é salário, nem remuneração fixa de qualquer espécie;
   b) NÃO constitui piso salarial, salário normativo ou obrigação de natureza trabalhista;
   c) NÃO gera vínculo empregatício entre as partes, sob nenhuma interpretação;
   d) NÃO se incorpora ao contrato como obrigação definitiva nem gera direito adquirido;
   e) NÃO produz efeitos rescisórios, indenizatórios ou verbas rescisórias de qualquer natureza;
   f) É política comercial discricionária da EMPRESA, de caráter temporário e sujeito a alterações;
   g) PODE ser alterada, reduzida, suspensa temporariamente ou extinta definitivamente pela EMPRESA, mediante aviso prévio de 30 (trinta) dias.

4.4. A garantia mínima ficará automaticamente suspensa, sem necessidade de notificação formal, nos meses em que o(a) representante: (i) não registrar nenhum contrato de venda com pagamento efetivo confirmado; (ii) estiver em afastamento voluntário ou inatividade por iniciativa própria; (iii) estiver em período de cumprimento de aviso rescisório; (iv) estiver em descumprimento de qualquer obrigação contratual.


CAPÍTULO V — DA FORMA E DO PRAZO DE PAGAMENTO

5.1. O pagamento das comissões e, quando aplicável, do complemento da garantia mínima será efetuado até o 10º (décimo) dia útil do mês subsequente ao de apuração.

5.2. O pagamento será realizado exclusivamente mediante transferência bancária (TED, PIX ou equivalente) para conta de titularidade da pessoa jurídica do(a) representante, não sendo admitido pagamento para pessoas físicas ou em espécie.

5.3. O pagamento é condicionado à apresentação prévia de Nota Fiscal de Serviços Eletrônica (NFS-e) válida, emitida pelo(a) representante no valor correspondente.

5.4. O atraso no recebimento do extrato de comissões ou qualquer divergência de valores deve ser comunicado formalmente à EMPRESA em até 5 (cinco) dias úteis após o recebimento do extrato, sob pena de aceitação tácita dos valores apurados.


CAPÍTULO VI — DA VALIDADE, VIGÊNCIA E ALTERAÇÕES

6.1. Esta Política entra em vigor na data de sua publicação e assinatura, permanecendo válida até que nova versão seja emitida e comunicada ao(à) representante.

6.2. Alterações desta Política serão comunicadas ao(à) representante com antecedência mínima de 30 (trinta) dias, por escrito.

6.3. A continuidade da prestação de serviços após o recebimento da comunicação de alteração, sem manifestação formal de discordância no prazo de 10 (dez) dias úteis, implica aceitação tácita e irrevogável das novas condições.

6.4. Esta Política não substitui nem altera qualquer cláusula do Contrato de Prestação de Serviços firmado entre as partes, prevalecendo as disposições contratuais em caso de conflito.

${cidade}, ${today}






________________________________
REPRESENTANTE:
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}






________________________________
EMPRESA:
${company.nome}
CNPJ: ${company.cnpj}

════════════════════════════════════════════════════════════

TERMO DE ENCERRAMENTO DE PRESTAÇÃO DE SERVIÇOS
DECLARAÇÃO DE INEXISTÊNCIA DE VÍNCULO EMPREGATÍCIO E QUITAÇÃO GERAL

Pelo presente instrumento particular, lavrado em conformidade com o ordenamento jurídico brasileiro, especialmente o Código Civil e os princípios da autonomia da vontade e da boa-fé objetiva, as partes abaixo qualificadas formalizam o encerramento amigável, consensual e definitivo da relação de prestação de serviços entre si estabelecida:

EMPRESA: ${company.nome}, CNPJ ${company.cnpj}, ${enderecoCompleto(company.endereco, undefined, company.cidade, company.uf)}, doravante denominada EMPRESA.

PRESTADOR(A): ${contratadoQualif}, doravante denominado(a) PRESTADOR(A).


CLÁUSULA PRIMEIRA — DO ENCERRAMENTO AMIGÁVEL E CONSENSUAL

1.1. As partes declaram, de forma livre e consciente, que o Contrato de Prestação de Serviços Comerciais firmado entre si é encerrado nesta data de forma completamente amigável, por mútuo acordo e consenso, sem qualquer litígio, ressalva, impugnação ou questionamento entre as partes.

1.2. O encerramento ora formalizado decorre exclusivamente da vontade bilateral das partes, exercida com plena capacidade jurídica e sem qualquer coação, dolo, erro ou lesão.


CLÁUSULA SEGUNDA — DA REAFIRMAÇÃO DA NATUREZA JURÍDICA DA RELAÇÃO

2.1. As partes reafirmam, de forma irrevogável e com plena consciência das consequências jurídicas desta declaração, que a relação ora encerrada foi, desde seu nascedouro até este ato de encerramento, de natureza estritamente comercial e civil, JAMAIS tendo constituído, em nenhum momento, relação de emprego nos termos da Consolidação das Leis do Trabalho — CLT ou de qualquer legislação trabalhista aplicável.

2.2. O(A) PRESTADOR(A) declara expressa e categoricamente que, durante toda a vigência da relação com a EMPRESA:

   a) Em nenhum momento existiu subordinação jurídica, pessoal, econômica ou funcional;
   b) Em nenhum momento houve controle de jornada, imposição de horário fixo, escala de trabalho ou fixação de local obrigatório de atividade;
   c) Em nenhum momento recebeu salário, remuneração fixa de natureza trabalhista, benefícios empregatícios, adicionais, gratificações ou qualquer verba de caráter salarial;
   d) Atuou sempre e exclusivamente como pessoa jurídica autônoma, com plena consciência da natureza civil e comercial da relação;
   e) Não foi submetido(a) a qualquer poder disciplinar de empregador, não integrou quadro funcional, não participou de benefícios coletivos de empregados.


CLÁUSULA TERCEIRA — DA QUITAÇÃO TOTAL E IRREVOGÁVEL

3.1. O(A) PRESTADOR(A) declara ter recebido, integralmente e sem ressalvas, todos os valores de comissões, complementos de garantia mínima e quaisquer outros valores devidos em razão do Contrato de Prestação de Serviços, até a data de assinatura deste Termo, encontrando-se completamente quitado(a) e satisfeito(a) em relação a todos os créditos decorrentes da relação ora encerrada.

3.2. A EMPRESA declara não possuir pendências, débitos em aberto, ressalvas ou qualquer crédito não liquidado com o(a) PRESTADOR(A), salvo eventuais comissões de contratos de venda já assinados e formalizados cujos pagamentos ainda estejam pendentes de recebimento pela EMPRESA, que serão liquidadas conforme as regras estabelecidas no Contrato.

3.3. Ambas as partes declaram, de forma recíproca e irrevogável, que NADA MAIS TÊM A RECLAMAR uma da outra, a qualquer título ou a qualquer tempo, em razão da relação ora encerrada, seja a título de comissões, complementos, bônus, indenizações, compensações, reembolsos, verbas rescisórias, benefícios ou qualquer outra verba de qualquer natureza.


CLÁUSULA QUARTA — DAS OBRIGAÇÕES PÓS-ENCERRAMENTO

4.1. O(A) PRESTADOR(A) restituirá à EMPRESA, na data de assinatura deste Termo ou em prazo acordado entre as partes, todos os materiais institucionais, listas de clientes, propostas em andamento, senhas de acesso a sistemas, equipamentos e quaisquer outros recursos fornecidos pela EMPRESA para a execução das atividades.

4.2. O dever de sigilo e confidencialidade sobre todas as informações técnicas, estratégicas, comerciais, financeiras e operacionais da EMPRESA, bem como sobre sua carteira de clientes, permanece plenamente vigente pelo prazo de 2 (dois) anos contados da data de assinatura deste Termo.

4.3. O(A) PRESTADOR(A) se abstém de utilizar, reproduzir, divulgar ou comercializar qualquer informação obtida em razão da relação com a EMPRESA, sob pena de responsabilidade civil e criminal.


CLÁUSULA QUINTA — DA RENÚNCIA EXPRESSA A DIREITOS TRABALHISTAS

5.1. O(A) PRESTADOR(A) declara, de forma livre, voluntária, consciente e irrevogável, que, em razão da inequívoca natureza civil e comercial da relação ora encerrada, RENUNCIA expressamente, em caráter definitivo e irretratável, a qualquer direito, pretensão, ação ou demanda de natureza trabalhista, previdenciária, correlata ou acessória perante qualquer instância judicial, arbitral ou administrativa, incluindo, sem caráter taxativo:

   a) Reconhecimento ou declaração de vínculo empregatício;
   b) Pagamento de horas extras, horas de sobreaviso, adicional noturno ou qualquer outra remuneração por jornada especial;
   c) 13º salário integral ou proporcional;
   d) Férias remuneradas ou indenizadas, com ou sem adicional de 1/3;
   e) Verbas rescisórias de qualquer natureza (aviso prévio, saldo de salário, multas do FGTS);
   f) Contribuições previdenciárias patronais ou quotas do FGTS;
   g) Indenizações por danos morais ou materiais decorrentes da relação de trabalho;
   h) Qualquer outra verba típica, acessória ou derivada de relação empregatícia.

5.2. O(A) PRESTADOR(A) reconhece expressamente que a presente renúncia é plenamente válida, eficaz e juridicamente vinculante, pois a relação jamais teve natureza empregatícia, e que o eventual ajuizamento de demanda trabalhista em contradição com este Termo configurará litigância de má-fé, sujeitando o(a) litigante às penalidades previstas no Código de Processo Civil.


CLÁUSULA SEXTA — DAS DISPOSIÇÕES FINAIS

6.1. Este Termo é firmado de forma livre, consciente e deliberada, após plena leitura, compreensão integral de seu conteúdo e, se necessário, consulta a assessoria jurídica de confiança de cada parte.

6.2. Este instrumento produz todos os seus efeitos legais a partir da data de sua assinatura, sendo irretratável e irrevogável.

6.3. Quaisquer controvérsias decorrentes da interpretação ou execução deste Termo serão resolvidas pelo Foro da Comarca de ${foro}, com exclusão de qualquer outro.

${cidade}, ${today}






________________________________
EMPRESA:
${company.nome}
CNPJ: ${company.cnpj}






________________________________
PRESTADOR(A):
${signatario.toUpperCase()}
CPF/CNPJ: ${client.cpf_cnpj || '___'}


Testemunhas:

________________________________        ________________________________
Nome:                                   Nome:
CPF:                                    CPF:
`;
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
