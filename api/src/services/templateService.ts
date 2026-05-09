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
// Imprimível em A4. Boxes vazios pro instalador marcar à mão na obra.
// 7 etapas seguindo a ordem real da visita (~75min).
// Form pede só: cliente, endereço, data, técnico responsável.
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

  // Caixa em quadrado sólido — renderiza bonito no PDF (font-family Inter cobre).
  const BX = '☐';

  return `VISTORIA TÉCNICA — CHECKLIST DE VISITA
Sistema fotovoltaico — Energia solar

EMPRESA: ${company.nome}    CNPJ: ${company.cnpj}
CLIENTE: ${client.nome}    ${client.cpf_cnpj ? `CPF/CNPJ: ${client.cpf_cnpj}` : ''}
LOCAL DA VISITA: ${endereco}
DATA: ${today}    TÉCNICO RESPONSÁVEL: ${tecnico || '___________________________'}

────────────────────────────────────────────────────────────

1. CHEGADA E IDENTIFICAÇÃO    (~5 min)

  ${BX} Identidade e endereço do cliente confirmados
  ${BX} Credencial / contrato de visita apresentado
  ${BX} Etapas da visita explicadas ao cliente
  ${BX} Foto: fachada do imóvel


2. ANÁLISE DE CONSUMO    (~10 min)

  ${BX} Última conta de luz coletada (foto/anexo)
  ${BX} Histórico de 12 meses verificado
  ${BX} Padrão de uso:  ${BX} Diurno   ${BX} Noturno   ${BX} Misto
  ${BX} Cargas pesadas listadas (chuveiro / AC / piscina / carro elétrico)
  ${BX} Crescimento futuro previsto:  ${BX} Sim   ${BX} Não

  Consumo médio mensal: _____________ kWh
  Observações: _________________________________________________________


3. PADRÃO ELÉTRICO    (~15 min)

  Tipo:           ${BX} Monofásico   ${BX} Bifásico   ${BX} Trifásico
  Disjuntor:      _______ A
  Estado:         ${BX} Bom   ${BX} Regular   ${BX} Precisa reforma

  ${BX} Lacre da concessionária íntegro
  ${BX} Aterramento existente e adequado
  ${BX} Espaço para inversor (próximo ao padrão, ventilado)
  ${BX} DPS / proteção contra surtos
  ${BX} Foto: padrão de entrada (geral + lacre)


4. ANÁLISE DO TELHADO    (~20 min)

  ${BX} Subida segura validada (escada, EPI)

  Tipo de telha:  ${BX} Cerâmica  ${BX} Fibrocimento  ${BX} Metálica  ${BX} Laje  ${BX} Outro: _______
  Estado:         ${BX} Novo  ${BX} Bom  ${BX} Regular  ${BX} Precisa reforço
  Área útil:      _________ m²
  Inclinação:     _________ °
  Orientação:     ${BX} N   ${BX} NE   ${BX} NO   ${BX} L   ${BX} O
  Sombreamento:   ${BX} Sem   ${BX} Manhã   ${BX} Tarde   ${BX} Total

  Causa do sombreamento (se houver): _____________________________________
  ${BX} Estrutura suporta peso (laje/madeira/metálica avaliada)
  ${BX} Foto: telhado completo + detalhes


5. DIMENSIONAMENTO PRELIMINAR    (~10 min)

  Potência sugerida:                _________ kWp
  Quantidade de módulos:            _____ × _______ Wp
  Inversor:                         _________ kW    Modelo: _______________
  Distância módulos → inversor:     _________ m
  Distância inversor → padrão:      _________ m
  ${BX} Arranjo em string viável (esboço no verso)


6. HOMOLOGAÇÃO / DISTRIBUIDORA    (~5 min)

  Distribuidora: _______________________________________
  Nº instalação na concessionária: _________________________

  Documentos cliente coletados:
  ${BX} RG    ${BX} CPF    ${BX} Comprovante de residência    ${BX} Conta de luz

  ${BX} Procuração assinada (gerar no app)
  ${BX} Cliente ciente do prazo de homologação (~30-45 dias)


7. CONCLUSÃO E PRÓXIMOS PASSOS    (~10 min)

  Conclusão:  ${BX} Viável   ${BX} Viável com ressalvas   ${BX} Não viável

  Ressalvas / observações:
  __________________________________________________________________________
  __________________________________________________________________________
  __________________________________________________________________________

  Proposta a ser enviada em ______ dias.
  Cliente concorda com prosseguimento:  ${BX} Sim   ${BX} Não

────────────────────────────────────────────────────────────



_______________________________________            _______________________________________
TÉCNICO RESPONSÁVEL                                CLIENTE
${tecnico || ''}                                   ${client.nome}
${company.nome}                                    Data: ${today}


Documento gerado por SolarDoc Pro — solardoc.app
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
