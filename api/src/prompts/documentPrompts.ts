interface Company {
  nome: string;
  cnpj: string;
  endereco?: string;
}

interface Client {
  nome: string;
  cpf_cnpj?: string;
  endereco?: string;
  cep?: string;
}

export function getPrompt(
  type: string,
  company: Company,
  client: Client,
  fields: Record<string, unknown>
): string {
  const today = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });

  switch (type) {
    case 'contratoSolar':
      return `Você é um especialista jurídico em contratos de energia solar no Brasil. Gere um CONTRATO DE INSTALAÇÃO DE SISTEMA DE ENERGIA SOLAR FOTOVOLTAICA completo, profissional e juridicamente válido.

DADOS DA CONTRATADA (empresa instaladora):
- Razão Social: ${company.nome}
- CNPJ: ${company.cnpj}
- Endereço: ${company.endereco || 'a ser preenchido'}

DADOS DO CONTRATANTE (cliente):
- Nome completo: ${client.nome}
- CPF/CNPJ: ${client.cpf_cnpj || 'a ser preenchido'}
- Endereço: ${client.endereco || 'a ser preenchido'}
- CEP: ${client.cep || 'a ser preenchido'}

ESPECIFICAÇÕES DO SISTEMA:
- Potência do sistema: ${fields.potencia_kwp} kWp
- Quantidade de módulos: ${fields.quantidade_modulos} unidades
- Marca dos módulos: ${fields.marca_modulos}
- Tipo de inversor: ${fields.tipo_inversor}
- Marca do inversor: ${fields.marca_inversor}
- Valor total do contrato: R$ ${fields.valor_total}
- Endereço de instalação: ${fields.endereco_instalacao}

PRAZOS:
- Prazo para elaboração do projeto: ${fields.prazo_projeto_dias} dias úteis
- Prazo para aprovação na concessionária: ${fields.prazo_aprovacao_dias} dias úteis
- Prazo para instalação após aprovação: ${fields.prazo_instalacao_dias} dias úteis

GARANTIAS:
- Módulos fotovoltaicos: ${fields.garantia_modulos_anos} anos
- Inversor: ${fields.garantia_inversor_anos} anos
- Serviço de instalação: ${fields.garantia_instalacao_anos} anos

FORO: Comarca de ${fields.foro_cidade}

DATA: ${today}

INSTRUCOES: Gere o contrato completo incluindo OBRIGATORIAMENTE todas estas cláusulas:
1. IDENTIFICAÇÃO COMPLETA DAS PARTES (qualificação completa da Contratante e Contratada)
2. OBJETO DO CONTRATO (descrição técnica detalhada do sistema solar)
3. VALOR E CONDIÇÕES DE PAGAMENTO
4. PRAZOS (projeto, aprovação junto à concessionária, instalação — cada um separado)
5. GARANTIAS (módulos, inversor e instalação separadamente)
6. VARIAÇÃO DE GERAÇÃO (cláusula informando que a geração pode variar em até 10% dependendo de fatores climáticos)
7. DEPENDÊNCIA DA CONCESSIONÁRIA (os prazos de aprovação e conexão dependem exclusivamente da concessionária de energia e não são de responsabilidade da Contratada)
8. OBRIGAÇÕES DO CONTRATANTE (garantir acesso ao local, estrutura do telhado adequada, padrão de entrada elétrica conforme normas)
9. OBRIGAÇÕES DA CONTRATADA (executar o serviço conforme especificações, fornecer equipamentos acordados)
10. RESCISÃO (multa de 20% sobre o valor total em caso de rescisão imotivada por qualquer das partes)
11. FORO (comarca de ${fields.foro_cidade} para dirimir quaisquer controvérsias)
12. LOCAL E DATA, ESPAÇOS PARA ASSINATURA DE AMBAS AS PARTES E DUAS TESTEMUNHAS

Use linguagem jurídica formal, cláusulas numeradas, sem abreviações. O documento deve ser completo e utilizável sem edições adicionais.`;

    case 'prestacaoServico':
      return `Você é um especialista jurídico. Gere um CONTRATO DE PRESTAÇÃO DE SERVIÇOS completo e juridicamente válido para serviços técnicos na área de energia solar.

CONTRATANTE:
- Nome: ${client.nome}
- CPF/CNPJ: ${client.cpf_cnpj || 'a ser preenchido'}
- Endereço: ${client.endereco || 'a ser preenchido'}
- CEP: ${client.cep || 'a ser preenchido'}

CONTRATADA (prestadora):
- Razão Social: ${company.nome}
- CNPJ: ${company.cnpj}
- Endereço: ${company.endereco || 'a ser preenchido'}

DETALHES DO SERVIÇO:
- Descrição: ${fields.descricao_servico}
- Valor total: R$ ${fields.valor}
- Prazo de execução: ${fields.prazo_execucao_dias} dias úteis
- Responsável técnico: ${fields.responsavel_tecnico}
- Local de execução: ${fields.endereco_instalacao}
- Foro: ${fields.foro_cidade}

DATA: ${today}

INSTRUCOES: Gere o contrato completo incluindo OBRIGATORIAMENTE:
1. IDENTIFICAÇÃO DAS PARTES (Contratante e Contratada com qualificação completa)
2. OBJETO (descrição detalhada do serviço a ser prestado)
3. VALOR E FORMA DE PAGAMENTO
4. PRAZO DE EXECUÇÃO
5. RESPONSABILIDADE TÉCNICA (menção ao responsável técnico e documentação ART/RRT quando aplicável)
6. NORMAS TÉCNICAS (conformidade com normas ABNT, NR-10 e NR-35 onde aplicável)
7. OBRIGAÇÕES DAS PARTES
8. AUSÊNCIA DE VÍNCULO TRABALHISTA (a Contratada é empresa autônoma, sem qualquer vínculo empregatício)
9. RESCISÃO
10. FORO
11. LOCAL E DATA, ASSINATURAS E TESTEMUNHAS

Use linguagem jurídica formal e profissional.`;

    case 'procuracao': {
      const procuradores = Array.isArray(fields.nomes_procuradores)
        ? (fields.nomes_procuradores as string[]).join(', ')
        : fields.nomes_procuradores;

      return `Você é um especialista jurídico. Gere uma PROCURAÇÃO com poderes específicos para representação junto à concessionária de energia e/ou instituição financeira bancária.

OUTORGANTE (cliente que concede os poderes):
- Nome completo: ${client.nome}
- CPF/CNPJ: ${client.cpf_cnpj || 'a ser preenchido'}
- Endereço completo: ${client.endereco || 'a ser preenchido'}
- CEP: ${client.cep || 'a ser preenchido'}

OUTORGADOS (procuradores):
${procuradores}

DADOS DO SISTEMA SOLAR:
- Unidade Consumidora (UC): ${fields.uc}
- Concessionária de energia: ${fields.concessionaria}
${fields.banco ? `- Banco: ${fields.banco}` : ''}
${fields.agencia ? `- Agência: ${fields.agencia}` : ''}

FINALIDADE: ${fields.finalidade}
DATA: ${today}

INSTRUCOES: Gere a procuração completa incluindo:
1. QUALIFICAÇÃO COMPLETA DO OUTORGANTE (nome, CPF/CNPJ, endereço completo com CEP, estado civil se pessoa física)
2. NOMEAÇÃO DOS OUTORGADOS com os nomes indicados
3. PODERES PARA CONCESSIONÁRIA: assinar requerimentos, solicitações e documentos junto à ${fields.concessionaria}, retirar documentos, acompanhar processo de homologação da unidade consumidora ${fields.uc}, assinar o contrato de conexão e geração de energia
${fields.finalidade === 'banco' || fields.finalidade === 'ambos' ? `4. PODERES PARA BANCO: assinar contratos de financiamento junto ao ${fields.banco || 'banco indicado'}, agência ${fields.agencia || 'a ser informada'}, representar o outorgante em todos os atos necessários para obtenção de crédito para aquisição de sistema fotovoltaico` : ''}
5. PRAZO DE VALIDADE (mencionar validade de 1 ano ou indeterminado)
6. FECHO FORMAL com local, data e espaço para assinatura do outorgante com reconhecimento de firma

Use linguagem jurídica formal. O documento deve ter o formato tradicional de procuração brasileira.`;
    }

    case 'contratoPJ':
      return `Você é um especialista jurídico trabalhista. Gere um CONTRATO DE REPRESENTAÇÃO COMERCIAL ENTRE PESSOAS JURÍDICAS completo e juridicamente válido.

CONTRATANTE (empresa contratante):
- Razão Social: ${company.nome}
- CNPJ: ${company.cnpj}
- Endereço: ${company.endereco || 'a ser preenchido'}

CONTRATADO (representante comercial PJ):
- Nome/Razão Social: ${client.nome}
- CNPJ/CPF: ${client.cpf_cnpj || 'a ser preenchido'}
- Endereço: ${client.endereco || 'a ser preenchido'}

CONDIÇÕES COMERCIAIS:
- Objeto do contrato: ${fields.objeto_contrato}
- Comissão: ${fields.comissao_percentual}% sobre o valor de cada contrato fechado
- Meta de bônus: R$ ${fields.meta_bonus}
- Valor do bônus por meta: R$ ${fields.valor_bonus}
- Foro: ${fields.foro_cidade}

DATA: ${today}

INSTRUCOES: Gere o contrato completo incluindo OBRIGATORIAMENTE:
1. IDENTIFICAÇÃO DAS PARTES (Contratante e Contratado com qualificação completa de PJ)
2. OBJETO DETALHADO (atividade de representação comercial, prospecção de clientes e fechamento de contratos)
3. REMUNERAÇÃO POR COMISSÃO (${fields.comissao_percentual}% do valor do contrato, pago após recebimento pela Contratante)
4. CONDIÇÃO DE PAGAMENTO (a comissão só é devida após efetivo pagamento do cliente final à Contratante)
5. CANCELAMENTO (se o cliente cancelar o contrato após a venda, não é devida comissão)
6. BÔNUS POR META (ao atingir R$ ${fields.meta_bonus} em vendas no mês, o Contratado recebe bônus de R$ ${fields.valor_bonus})
7. AUSÊNCIA ABSOLUTA DE VÍNCULO EMPREGATÍCIO (as partes reconhecem expressamente que esta relação é estritamente comercial, sem qualquer vínculo de emprego, subordinação habitual ou exclusividade)
8. OBRIGAÇÕES DAS PARTES
9. VIGÊNCIA E RESCISÃO
10. FORO (${fields.foro_cidade})
11. LOCAL E DATA, ASSINATURAS E TESTEMUNHAS

Use linguagem jurídica formal e profissional.`;

    case 'propostaBanco': {
      const equipamentos = Array.isArray(fields.lista_equipamentos)
        ? (fields.lista_equipamentos as Array<{ item: string; quantidade: number; valor: number }>)
            .map((e) => `  - ${e.item}: ${e.quantidade} unidade(s) — R$ ${e.valor} cada`)
            .join('\n')
        : String(fields.lista_equipamentos);

      const valorTotal = Number(fields.valor_total);
      const valorEquipamentos = (valorTotal * 0.7).toFixed(2);
      const valorMaoDeObra = (valorTotal * 0.3).toFixed(2);

      return `Você é um especialista em documentação técnica e financeira para energia solar. Gere uma PROPOSTA TÉCNICA E COMERCIAL PARA FINANCIAMENTO BANCÁRIO completa e profissional.

DADOS DO CLIENTE (tomador do crédito):
- Nome completo: ${client.nome}
- CPF/CNPJ: ${client.cpf_cnpj || 'a ser preenchido'}
- Endereço: ${client.endereco || 'a ser preenchido'}
- CEP: ${client.cep || 'a ser preenchido'}

DADOS DO BANCO:
- Instituição financeira: ${fields.banco}
- Agência: ${fields.agencia}
- Conta: ${fields.conta}

CONCESSIONÁRIA: ${fields.concessionaria}

EMPRESA FORNECEDORA:
- Razão Social: ${company.nome}
- CNPJ: ${company.cnpj}
- Endereço: ${company.endereco || 'a ser preenchido'}

DESCRIÇÃO DO SISTEMA:
${fields.descricao_sistema}

LISTA DE EQUIPAMENTOS:
${equipamentos}

VALORES:
- Valor total do projeto: R$ ${valorTotal.toFixed(2)}
- Equipamentos (70%): R$ ${valorEquipamentos}
- Mão de obra e instalação (30%): R$ ${valorMaoDeObra}
- Validade desta proposta: ${fields.validade_dias} dias

DATA: ${today}

INSTRUCOES: Gere a proposta completa com:
1. CABEÇALHO: "PROPOSTA TÉCNICA E COMERCIAL PARA FINANCIAMENTO BANCÁRIO" em destaque
2. DADOS DO CLIENTE (completos)
3. DADOS DA INSTITUIÇÃO FINANCEIRA
4. DADOS DA EMPRESA FORNECEDORA
5. DESCRIÇÃO TÉCNICA DO SISTEMA FOTOVOLTAICO
6. TABELA DE EQUIPAMENTOS (com quantidade e valores unitários e totais)
7. COMPOSIÇÃO DO VALOR:
   - Equipamentos: R$ ${valorEquipamentos} (70% do valor total)
   - Mão de obra e instalação: R$ ${valorMaoDeObra} (30% do valor total)
   - TOTAL: R$ ${valorTotal.toFixed(2)}
8. VALIDADE DA PROPOSTA: ${fields.validade_dias} dias a partir da data de emissão
9. RODAPÉ OBRIGATÓRIO: "Este documento é destinado exclusivamente à análise de crédito junto à instituição financeira acima identificada. Não constitui contrato de prestação de serviços."
10. LOCAL, DATA E ASSINATURA DO RESPONSÁVEL DA EMPRESA

Use linguagem técnica e formal, adequada para análise de crédito bancário.`;
    }

    default:
      throw new Error(`Tipo de documento não suportado: ${type}`);
  }
}
