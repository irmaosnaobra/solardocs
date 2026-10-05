# Contrato de Operação e Plataforma de Recarga — Irmãos na Obra
### O contrato que não termina · minuta v1 · 13/ago/2026

> **O que é:** o instrumento recorrente do ecossistema. É ele que transforma "entreguei uma obra"
> em **ponto ativo na rede** — a moeda que o `ECOSSISTEMA-ELETROPOSTO.md` manda medir nos
> primeiros 18 meses, e sem a qual o Degrau 9 (bandeira) não existe.
>
> **Serve para três públicos:** o cliente do turnkey, o eletroposto **órfão** (quem comprou
> carregador de outro fornecedor e não fatura), e o aluno da mentoria fora do raio.
> A Cláusula 10 (vínculo com a obra) só se aplica ao primeiro.
>
> 🚧 **BLOQUEIO ANTES DE ASSINAR:** ler o contrato com o fornecedor da plataforma e confirmar
> se ele permite **(a)** atender ponto que não foi obra de vocês e **(b)** white-label futuro.
> É a pergunta 3 da Parte 7, aberta desde 30/jul. Se qualquer uma for "não", as Cláusulas 1, 11
> e 20 desta minuta não podem ser honradas como estão.
>
> **⚠️ = decisão minha, não do Thiago.** Tabela completa no fim.
> **Revisão de advogado obrigatória antes de ir a cliente.**
> Arquitetura completa em [ARQUITETURA-CONTRATOS-ELETROPOSTO.md](ARQUITETURA-CONTRATOS-ELETROPOSTO.md).

---

## CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE OPERAÇÃO, GESTÃO E MONITORAMENTO DE ESTAÇÃO DE RECARGA DE VEÍCULOS ELÉTRICOS

**OPERADORA:** ______________________________________ (Irmãos na Obra), CNPJ nº ____________________, com sede em ______________________________________.

**TITULAR:** ______________________________________, CPF/CNPJ nº ____________________, com sede/residência em ______________________________________.

**PONTO:** estação de ______ kW, conector CCS2, marca/modelo ______________________, instalada em ______________________________________, unidade consumidora nº ____________________ da distribuidora ____________________.

### Considerando que:

a) o TITULAR é proprietário e explorador comercial do PONTO, atividade **livre a qualquer interessado, a preços livremente negociados**, nos termos da REN ANEEL nº 819/2018;

b) a OPERADORA presta serviços de gestão, monitoramento e habilitação de cobrança de estações de recarga, atuando também como **intermediária** na contratação da plataforma OCPP fornecida por terceiro;

c) ☐ o PONTO foi implantado pela OPERADORA por meio do Contrato de Fornecimento e Instalação nº ____________, assinado nesta mesma data — hipótese em que se aplica a Cláusula 10; ☐ o PONTO **não** foi implantado pela OPERADORA, não se aplicando a Cláusula 10;

as partes celebram o presente contrato.

---

## CLÁUSULA 1 — DO OBJETO

**1.1.** A OPERADORA prestará ao TITULAR os serviços de operação e gestão do PONTO descritos nos módulos da Cláusula 2 e detalhados no **Anexo I**.

**1.2.** A plataforma de gestão e cobrança (OCPP), o gateway de pagamento e os aplicativos de recarga são **fornecidos por terceiros**. A OPERADORA atua como intermediária na contratação, na configuração e no suporte de primeiro nível, **não respondendo** por disponibilidade, políticas comerciais, tarifas de intermediação ou descontinuação de serviços do fornecedor.

**1.3.** Este contrato **não transfere** à OPERADORA a propriedade, a posse ou a exploração comercial do PONTO, que permanecem integralmente do TITULAR.

**1.4.** Este contrato **não é de exclusividade recíproca**: a OPERADORA pode prestar os mesmos serviços a outros pontos, inclusive concorrentes, na mesma praça.

---

## CLÁUSULA 2 — DOS MÓDULOS CONTRATADOS

**2.1.** São contratados os módulos assinalados:

| | Módulo | O que entrega | Remuneração |
|:---:|---|---|---|
| ☐ | **A — Plataforma e cobrança** *(obrigatório)* | Habilitação OCPP, cobrança pelo app, conciliação, cadastro nos aplicativos e mapas de recarga, painel de tarifa | Cl. 5.2 |
| ☐ | **B — Monitoramento e suporte** | Monitoramento remoto, alarmes, suporte N1 ao TITULAR e ao motorista, acionamento do N2 do fabricante | Cl. 5.3 |
| ☐ | **C — Manutenção e SLA** | Manutenção preventiva e corretiva após o término da garantia de obra, conforme Anexo II | Cl. 5.4 |
| ☐ | **D — Marketing local** | Divulgação e tráfego local do PONTO, gestão de presença nos mapas e campanhas | Cl. 5.5 |
| ☐ | **E — Seguro do ativo** | Intermediação junto a corretora parceira *(a apólice é contratada pelo TITULAR, em seu nome)* | Cl. 5.6 |

**2.2.** O módulo A é condição dos demais. Módulos podem ser incluídos ou excluídos por **aditivo escrito**, com efeito no ciclo de faturamento seguinte.

---

## CLÁUSULA 3 — DAS OBRIGAÇÕES DA OPERADORA

**3.1.** Compete à OPERADORA:

I. habilitar o PONTO na plataforma, configurar tarifas segundo instrução escrita do TITULAR e mantê-lo publicado nos aplicativos e mapas de recarga;

II. monitorar remotamente a disponibilidade do PONTO e comunicar indisponibilidades ao TITULAR, nos prazos do **Anexo II**;

III. prestar suporte de primeiro nível e acionar o suporte do fabricante ou do fornecedor da plataforma quando a causa lhe for atribuível;

IV. disponibilizar ao TITULAR **acesso permanente ao painel** com sessões, kWh, faturamento e disponibilidade do PONTO;

V. emitir relatório mensal de operação e o demonstrativo de sua própria remuneração;

VI. comunicar ao TITULAR, com **30 (trinta) dias** de antecedência, alteração de política, de preço ou de fornecedor da plataforma que o afete;

VII. manter sigilo sobre os dados comerciais do TITULAR e observar a LGPD (Cláusula 18).

**3.2.** As obrigações da OPERADORA são de **meio** quanto à disponibilidade de sistemas de terceiros e de **resultado** apenas quanto aos atos sob seu controle direto.

---

## CLÁUSULA 4 — DAS OBRIGAÇÕES DO TITULAR

**4.1.** Compete ao TITULAR:

I. manter a unidade consumidora **adimplente** e as instalações elétricas internas regulares e seguras;

II. manter **conectividade** permanente do PONTO (internet ou chip de dados), por sua conta — sem conexão não há telemetria, cobrança nem SLA;

III. manter o acesso ao PONTO livre, iluminado, sinalizado e desobstruído, e impedir estacionamento irregular nas vagas de recarga;

IV. arcar com a **energia elétrica** consumida nas recargas e com os tributos da exploração comercial;

V. comunicar de imediato qualquer avaria, vandalismo, furto ou acidente, lavrando boletim de ocorrência quando aplicável;

VI. não intervir na configuração da plataforma, nas tarifas publicadas ou no equipamento sem informar a OPERADORA;

VII. informar por escrito qualquer alteração de tarifa com **antecedência mínima de 5 (cinco) dias úteis**; ⚠️

VIII. efetuar os pagamentos da Cláusula 5;

IX. comunicar previamente a intenção de **alienar o PONTO** ou o estabelecimento, para os fins da Cláusula 20.

---

## CLÁUSULA 5 — DA REMUNERAÇÃO

**5.1.** A remuneração da OPERADORA é composta pelos módulos contratados, faturada mensalmente, com vencimento todo dia ______ do mês subsequente.

**5.2. Módulo A — Plataforma e cobrança:** R$ ____________/mês por ponto de recarga, acrescido de ______% sobre o faturamento bruto de recarga do PONTO. ⚠️

**5.3. Módulo B — Monitoramento e suporte:** R$ ____________/mês. ⚠️

**5.4. Módulo C — Manutenção e SLA:** R$ ____________/ano ou ______% do valor do equipamento/ano, conforme Anexo II. ⚠️

**5.5. Módulo D — Marketing local:** R$ ____________/mês, mais a verba de mídia, que é repassada ao TITULAR pelo custo, sem markup. ⚠️

**5.6. Módulo E — Seguro:** sem custo direto; a OPERADORA é remunerada por comissão da corretora, **fato que declara expressamente ao TITULAR neste ato**.

**5.7.** As tarifas e taxas cobradas pelo **fornecedor da plataforma e pelo gateway** não integram a remuneração da OPERADORA e são suportadas pelo TITULAR, sendo discriminadas no relatório mensal.

**5.8. Carência de faturamento.** Nos primeiros **90 (noventa) dias** de operação, incide apenas a parcela fixa, sem o percentual sobre faturamento — período de rampa em que o PONTO ainda não tem demanda formada. ⚠️

**5.9. Reajuste.** Os valores fixos são reajustados anualmente pelo **IPCA**, ou pelo índice que o substituir.

**5.10. Mora.** O atraso sujeita o TITULAR a multa de 2%, juros de 1% ao mês pro rata die e correção pelo IPCA.

---

## CLÁUSULA 6 — DA TARIFA AO USUÁRIO FINAL

**6.1.** O **preço da recarga ao motorista é definido exclusiva e livremente pelo TITULAR**, na forma da REN ANEEL nº 819/2018.

**6.2.** A OPERADORA pode **sugerir** faixas de tarifa com base em dados de mercado, sem qualquer poder de fixação, imposição ou veto.

**6.3.** A OPERADORA não pratica, não coordena e não intermedeia alinhamento de preços entre pontos de titulares distintos.

> *Nota de desenho: 6.2 e 6.3 existem porque a OPERADORA atenderá pontos concorrentes na mesma praça (Cl. 1.4). Sugerir tarifa a vários pontos concorrentes sem esta redação flerta com coordenação de preços.* ⚠️ *— confirmar com advogado se convém manter a sugestão de tarifa ou eliminá-la de vez.*

---

## CLÁUSULA 7 — DO FLUXO FINANCEIRO

**7.1.** Os valores pagos pelos motoristas são recebidos pelo **gateway do fornecedor da plataforma** e repassados **diretamente ao TITULAR**, na periodicidade e nas condições do fornecedor.

**7.2.** A OPERADORA **não retém, não custodia e não intermedeia** os recursos de recarga do TITULAR, faturando sua remuneração em separado, por documento fiscal próprio.

**7.3.** A OPERADORA não responde por atraso, bloqueio, chargeback, retenção ou falha de repasse praticados pelo gateway ou pelo fornecedor da plataforma, cabendo-lhe apenas o dever de **apoiar o TITULAR** na solução junto ao terceiro.

> ⚠️ *Alternativa a decidir: se o fornecedor só repassar para uma única conta (a da IO), a Cláusula 7 muda de natureza — a IO passa a movimentar dinheiro de terceiro e precisa de conta segregada, prazo de repasse cravado e provavelmente enquadramento fiscal diferente. **Descubra isso antes de assinar o primeiro contrato**, não no primeiro repasse.*

---

## CLÁUSULA 8 — DOS NÍVEIS DE SERVIÇO

**8.1.** Os prazos de resposta e de restabelecimento constam do **Anexo II**.

**8.2.** O SLA **fica suspenso** enquanto perdurar: falta de conectividade por causa do TITULAR; falta ou interrupção do fornecimento de energia pela distribuidora; unidade consumidora inadimplente ou suspensa; vandalismo, furto, acidente ou caso fortuito; indisponibilidade do sistema do fornecedor da plataforma; e intervenção de terceiro não autorizado no PONTO.

**8.3.** Descumprido o SLA por causa imputável à OPERADORA, o TITULAR faz jus a **abatimento proporcional** da mensalidade do módulo afetado, limitado a 100% da mensalidade do mês. Esse abatimento é o **remédio único e exclusivo** pelo descumprimento de SLA. ⚠️

---

## CLÁUSULA 9 — DOS DADOS OPERACIONAIS

**9.1.** Os dados operacionais do PONTO — sessões, kWh, faturamento, disponibilidade — **pertencem ao TITULAR**.

**9.2.** O TITULAR autoriza a OPERADORA a acessar e tratar esses dados durante a vigência, para operação, suporte, diagnóstico, faturamento e cumprimento de obrigações legais.

**9.3.** O TITULAR autoriza a OPERADORA a utilizar os dados de forma **agregada e anonimizada** — sem identificação do PONTO, do TITULAR ou de motoristas — para estudos de mercado, benchmarking, material comercial e desenvolvimento de produto.

**9.4.** Encerrado o contrato, a OPERADORA entrega ao TITULAR, em até **15 (quinze) dias**, o **histórico completo em formato aberto** (CSV ou equivalente) e elimina as cópias que não seja obrigada a reter por lei.

> *A 9.3 é a cláusula que constrói o Degrau 9 sem tirar nada de ninguém: o dado agregado da rede é o que permite dizer "o ponto médio da nossa base fatura X" — e o ponto médio da base é o argumento de venda do próximo turnkey. A 9.4 é o oposto: uma saída limpa. Ela existe porque contrato de recorrência sem porta de saída visível não é assinado por quem tem advogado.*

---

## CLÁUSULA 10 — DO VÍNCULO COM O CONTRATO DE OBRA

> *Aplica-se somente à hipótese "c" do preâmbulo — PONTO implantado pela OPERADORA.*

**10.1.** ⚠️ O preço do Contrato de Fornecimento e Instalação assinado nesta data contempla desconto de **R$ ____________**, concedido **expressamente como contrapartida** da contratação dos serviços deste instrumento pelo prazo mínimo da Cláusula 12.

**10.2.** Rescindindo o TITULAR este contrato antes do prazo mínimo, sem justo motivo, fica devido à OPERADORA o **reembolso proporcional (pro rata temporis)** do desconto do item 10.1, correspondente ao período não cumprido.

**10.3.** O reembolso do item 10.2 é **a única consequência** da saída antecipada: não há multa adicional, não há retenção de dados, não há impedimento de migração para outra operadora, e a Cláusula 13 (portabilidade) é cumprida integralmente.

**10.4.** Nada neste contrato condiciona a **venda, a entrega, a garantia ou o funcionamento** do equipamento à manutenção dos serviços aqui contratados. O TITULAR pode operar o PONTO com qualquer plataforma, a qualquer tempo, sujeito apenas ao item 10.2.

> *10.3 e 10.4 não são generosidade — são a diferença entre "preço condicionado", que é comum e válido, e "venda casada", que é o art. 39, I do CDC. O contrato de obra e este são separados de propósito, assinados na mesma mesa. Ver a seção "por que ② e ③ são separados" na arquitetura.*

---

## CLÁUSULA 11 — DO DIREITO DE PREFERÊNCIA NA REDE

**11.1.** Vindo a OPERADORA a constituir **rede ou bandeira própria** de pontos de recarga, com marca única, roaming e tarifa de rede, o TITULAR terá **direito de preferência** para aderir, nas mesmas condições oferecidas a pontos de porte e localização comparáveis.

**11.2.** O direito de preferência é **faculdade do TITULAR**, e não obrigação de aderir. A recusa não afeta este contrato nem sua renovação.

**11.3.** A OPERADORA comunicará a abertura da adesão com antecedência mínima de **30 (trinta) dias**, e o TITULAR terá **30 (trinta) dias** para manifestar interesse.

> *Não existe aqui obrigação de aderir a condições futuras — obrigação de conteúdo indeterminado não se executa. O que se cria é fila preferencial, que é executável e, comercialmente, faz o mesmo trabalho.*

---

## CLÁUSULA 12 — DO PRAZO

**12.1.** Vigência de **______ meses** ⚠️, contados da **ativação do PONTO na plataforma**, renovando-se automaticamente por períodos iguais, salvo denúncia escrita de qualquer parte com **60 (sessenta) dias** de antecedência.

**12.2.** Prazo mínimo de permanência, para os fins da Cláusula 10: **______ meses** ⚠️.

**12.3.** Findo o prazo mínimo, o contrato passa a vigorar por prazo indeterminado, denunciável por qualquer parte com **60 (sessenta) dias**, sem qualquer ônus.

---

## CLÁUSULA 13 — DA RESCISÃO E DA PORTABILIDADE

**13.1.** O contrato pode ser resolvido: por denúncia (Cl. 12); por descumprimento não sanado em **15 (quinze) dias** após notificação escrita; por inadimplência superior a **60 (sessenta) dias**; por desativação definitiva do PONTO; ou por recuperação judicial, falência ou insolvência de qualquer das partes.

**13.2.** Descontinuando o fornecedor da plataforma o serviço, ou alterando-o de modo que inviabilize a execução, qualquer parte pode resolver o contrato **sem ônus**, com aviso de 30 dias.

**13.3. Portabilidade — saída limpa.** Encerrado o contrato por qualquer motivo, a OPERADORA, em até **15 (quinze) dias**:

I. entrega o histórico completo de operação em formato aberto (Cl. 9.4);

II. entrega as credenciais administrativas do PONTO na plataforma, ou promove a transferência da titularidade da conta ao TITULAR ou a quem ele indicar;

III. entrega as configurações técnicas (endpoint OCPP, chaves, parâmetros de tarifa) necessárias à migração;

IV. **não obstrui, não atrasa e não condiciona** a migração ao pagamento de qualquer valor controvertido.

**13.4.** Débitos vencidos são cobrados pelas vias próprias e **nunca** por retenção de dados, de credenciais ou por bloqueio do PONTO.

> *13.3 e 13.4 parecem contra vocês e são a favor: o motivo número um de um dono de ponto recusar contrato de operação é medo de ficar refém. Uma porta de saída escrita vende mais contratos do que uma trava vende retenção — e retenção por refém não sustenta uma bandeira.*

---

## CLÁUSULA 14 — DA LIMITAÇÃO DE RESPONSABILIDADE

**14.1.** A OPERADORA não responde por: indisponibilidade, falha, alteração ou descontinuação da plataforma, do gateway ou dos aplicativos de terceiros; interrupção, variação ou oscilação do fornecimento de energia pela distribuidora; falhas do equipamento cobertas pela garantia do fabricante; vandalismo, furto, acidente e caso fortuito; e atos de motoristas usuários do PONTO.

**14.2.** Nenhuma das partes responde por **lucros cessantes, perda de receita ou danos indiretos** da outra.

**14.3.** A responsabilidade total da OPERADORA por este contrato, em qualquer hipótese e por qualquer fundamento, fica limitada ao **valor por ela efetivamente recebido do TITULAR nos 12 (doze) meses anteriores** ao evento. ⚠️

**14.4.** A relação entre o TITULAR e os motoristas usuários do PONTO é exclusiva do TITULAR, que é o fornecedor do serviço de recarga perante o consumidor final.

---

## CLÁUSULA 15 — DA AUSÊNCIA DE PROMESSA DE RESULTADO

**15.1.** A OPERADORA **não garante** faturamento, número de sessões, ocupação, margem, payback ou retorno do investimento do PONTO.

**15.2.** Estudos de viabilidade, simulações, projeções e materiais comerciais entregues em qualquer fase — inclusive o Estudo de Viabilidade e o Business Plan — são **cenários baseados em premissas informadas pelo TITULAR**, e não constituem garantia, compromisso de resultado ou obrigação de meio ou de fim.

**15.3.** O resultado econômico do PONTO decorre de fatores fora do controle da OPERADORA, entre eles frota elétrica local, concorrência, tarifa de energia, localização, horário de funcionamento e política de preço do próprio TITULAR.

---

## CLÁUSULA 16 — DA MARCA E DA IMAGEM

**16.1.** Cada parte conserva a titularidade de suas marcas. Este contrato **não** licencia uso de marca.

**16.2.** ☐ O TITULAR **autoriza** ☐ **não autoriza** o uso do nome e das imagens do PONTO pela OPERADORA em material institucional, comercial e publicitário.

**16.3.** Havendo sinalização da OPERADORA no PONTO, ela é removida em até 15 dias do encerramento do contrato, às expensas da OPERADORA.

---

## CLÁUSULA 17 — DA SUSPENSÃO POR INADIMPLÊNCIA

**17.1.** Vencidos **30 (trinta) dias** de inadimplência, e após notificação escrita com prazo de 10 dias para purgação, a OPERADORA pode **suspender os módulos B, C e D**.

**17.2.** A suspensão **não alcança** o módulo A no que se refere à continuidade da cobrança e do repasse ao TITULAR, nem autoriza desativar o PONTO ou retirá-lo dos aplicativos — o motorista não pode ser prejudicado por disputa entre as partes. ⚠️

**17.3.** Durante a suspensão, o SLA não corre e a mensalidade continua devida.

---

## CLÁUSULA 18 — DA LGPD

**18.1.** No tratamento de dados pessoais de **motoristas usuários**, as partes reconhecem que a definição de finalidades e meios cabe primordialmente ao **fornecedor da plataforma**, atuando a OPERADORA e o TITULAR nos limites do que lhes for atribuído pelos termos daquele fornecedor.

**18.2.** No tratamento de dados pessoais do TITULAR, de seus prepostos e de seus contatos comerciais, a OPERADORA atua como **controladora** para as finalidades de execução contratual, faturamento e cumprimento legal.

**18.3.** As partes adotam medidas técnicas e administrativas de segurança compatíveis e comunicam incidentes de segurança **em até 48 (quarenta e oito) horas** da ciência.

**18.4.** Encerrado o contrato, aplica-se a Cláusula 9.4 quanto aos dados operacionais.

> ⚠️ *18.1 precisa ser conferida contra os termos reais do fornecedor da plataforma. Papéis de controlador e operador não são escolha das partes — decorrem de quem decide finalidade e meios. Escrever o papel errado não protege ninguém.*

---

## CLÁUSULA 19 — DA AUSÊNCIA DE VÍNCULO

**19.1.** Este contrato não gera vínculo empregatício, societário, de franquia, de representação comercial, de exclusividade, de joint venture ou de solidariedade.

**19.2.** A OPERADORA não é sócia, participante ou coexploradora do PONTO, e não responde por obrigações do TITULAR perante terceiros, motoristas, distribuidora ou fisco.

---

## CLÁUSULA 20 — DA CESSÃO E DA SUCESSÃO

**20.1.** Alienando o TITULAR o PONTO ou o estabelecimento em que ele se situa, obriga-se a **dar ciência prévia ao adquirente** deste contrato e a **oferecer-lhe a sub-rogação** nas mesmas condições.

**20.2.** Recusando o adquirente a sub-rogação, o contrato se resolve na data da transferência, aplicando-se a Cláusula 10.2 quando cabível e a Cláusula 13.3 integralmente.

**20.3.** A OPERADORA pode ceder este contrato a empresa de seu grupo econômico ou à sociedade que vier a operar a rede da Cláusula 11, mediante comunicação ao TITULAR.

> *20.1 é a cláusula mais barata da minuta e uma das que mais valem: o ponto muda de dono e o contrato acompanha o ativo. Sem ela, cada venda de posto ou de loja é um ponto que evapora da base — e a base é a única coisa que constrói a bandeira.*

---

## CLÁUSULA 21 — DAS DISPOSIÇÕES GERAIS E DO FORO

**21.1.** Integram este contrato os **Anexos I a III**. Prevalece o corpo do contrato em caso de divergência.

**21.2.** Alterações só valem por **aditivo escrito**. A tolerância é liberalidade e não implica novação.

**21.3.** As comunicações são válidas por escrito aos endereços do preâmbulo ou aos e-mails e números de WhatsApp abaixo, presumindo-se recebidas na data de entrega ou leitura.

> OPERADORA: ____________________  ·  TITULAR: ____________________

**21.4.** As partes tratam como confidenciais as informações comerciais, técnicas e financeiras trocadas, salvo exigência legal ou regulatória.

**21.5.** A nulidade de uma cláusula não contamina as demais.

**21.6.** Fica eleito o foro da Comarca de ______________________ ⚠️, renunciando as partes a qualquer outro.

E por estarem justas e contratadas, assinam em 2 (duas) vias.

______________________, ______ de ______________________ de ________.

| | |
|---|---|
| **OPERADORA** — Irmãos na Obra | **TITULAR** |
| Nome: | Nome: |
| CPF: | CPF/CNPJ: |


---

## ANEXO I — MÓDULOS, ESCOPO E PREÇOS

| Módulo | Contratado | Escopo detalhado | Valor |
|---|:---:|---|---|
| A — Plataforma e cobrança | ☐ | | R$ ______/mês + ____% |
| B — Monitoramento e suporte | ☐ | | R$ ______/mês |
| C — Manutenção e SLA | ☐ | | R$ ______/ano |
| D — Marketing local | ☐ | | R$ ______/mês + verba |
| E — Seguro (intermediação) | ☐ | | comissão da corretora |

## ANEXO II — NÍVEIS DE SERVIÇO

| Evento | Prazo de resposta | Prazo de solução | Janela |
|---|---|---|---|
| Ponto offline (telemetria) | | | |
| Falha de cobrança / gateway | | | |
| Falha de recarga reportada por motorista | | | |
| Manutenção preventiva (módulo C) | — | ____ visitas/ano | |
| Manutenção corretiva (módulo C) | | | |

⚠️ *Preencher com prazos que vocês conseguem cumprir com dois sócios e a distância real dos pontos. SLA que não se cumpre é multa que se assina.*

## ANEXO III — DADOS E RELATÓRIOS

Painel em tempo real (acesso permanente do TITULAR) · Relatório mensal: sessões, kWh, faturamento bruto, disponibilidade %, ticket médio, horários de pico · Demonstrativo de remuneração da OPERADORA · Extrato de taxas do fornecedor e do gateway

---

## ⚠️ Decisões pendentes

Completa — uma linha por ⚠️ e por 🚧 do arquivo.

| # | Cláusula | Decisão |
|---|---|---|
| 0 | 🚧 Abertura | **Ler o contrato do fornecedor da plataforma**: permite ponto de terceiro? permite white-label? |
| 1 | 4.1.VII | Antecedência de 5 dias úteis para o TITULAR mudar tarifa |
| 2 | 5.2 a 5.5 | **Os preços de todos os módulos.** O simulador debita 14% de gateway do lucro do investidor — a sua fatia precisa caber dentro ou ao lado disso, sem estourar o payback que vocês vendem |
| 3 | 5.8 | Carência de 90 dias sem o % sobre faturamento |
| 4 | 6.2 | Manter ou eliminar a sugestão de tarifa, já que a OPERADORA atende pontos concorrentes |
| 5 | 7 | **Como o dinheiro chega ao TITULAR?** Se o gateway só repassa para a conta da IO, a Cláusula 7 inteira muda |
| 6 | 8.3 | Abatimento da mensalidade como remédio único de SLA |
| 7 | 12.1 / 12.2 | Vigência e prazo mínimo de permanência |
| 8 | 10.1 / 10.2 | Valor do desconto vinculado e o claw-back proporcional |
| 9 | 14.3 | Teto de responsabilidade nos 12 meses de receita |
| 10 | 17.2 | Nunca desativar o ponto por inadimplência — confirma? |
| 11 | 18.1 | Papéis de controlador/operador conferidos contra os termos do fornecedor |
| 12 | 21.6 | Comarca do foro |
| 13 | Anexo II | Prazos de SLA que vocês conseguem cumprir de verdade |

**Revisão de advogado obrigatória.** As cláusulas 6, 7, 10, 17 e 18 são as que mais dependem de fatos que só o contrato do fornecedor e o CNPJ do cliente revelam.
