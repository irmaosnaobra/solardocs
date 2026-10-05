# Ecossistema Eletroposto — Irmãos na Obra
### Esteira de produtos, roteamento de lead e plano de negócio

> **Status:** desenho estratégico para aprovação (30/jul/2026). Nada construído ainda.
> **Base real usada:** LP `/io/eletroposto`, simulador (CONFIGS 40–160 kW), CRM `agendamentos`,
> fila de repasse Thiago↔Diego, `entrega-completa-eletroposto.md` (as 8 fases do turnkey).
> **Preços marcados com ⚠️ são propostas minhas** — precisam bater com o custo real de vocês antes de ir pro ar.
>
> **Decisões já tomadas (30/jul):** raio do turnkey = **Triângulo Mineiro e região** · plataforma OCPP/cobrança = **revenda com comissão** (hoje não é de vocês).
>
> ⚠️ **REPRECIFICADO EM 02/08/2026.** Os preços de turnkey deste documento foram
> reescritos para a tabela da apresentação comercial
> (`Desktop/EletroPosto/Apresentacao-IrmaosNaObra`), que passou a ser a fonte única —
> o simulador da LP já foi alinhado a ela. O ticket do 80 kW caiu de R$ 180.000 para
> **R$ 144.595**, e com ele a linha de turnkey da Parte 4 (de R$ 2,16 mi para R$ 1,74 mi).
> **A margem por unidade NÃO foi recalculada** — continua sendo a pergunta 1 da Parte 7.
> Duas notas de campo: (a) o 60 kW ficou a R$ 3.000 do 80 kW e perdeu razão de existir;
> (b) quem declara até R$ 140 mil não compra mais nada à vista.

---

## PARTE 0 — A decisão que sustenta tudo (leia antes do resto)

Você está pedindo para vender **conhecimento e material no custo** para o mesmo mercado onde vende **obra chave na mão de R$ 110k a R$ 280k**. Isso funciona, mas só com trava. Sem trava, uma mentoria de R$ 15k mata um turnkey de R$ 145k — e você troca margem de serviço por margem de curso.

São três travas. Elas precisam existir juntas:

### Trava 1 — Raio geográfico (a mais importante)

**Raio definido: Triângulo Mineiro e região.**

| Dentro do raio — Triângulo Mineiro | Fora do raio — resto do Brasil |
|---|---|
| Vende **turnkey**. Ponto final. | Vende **Business Plan, mentoria, supply no custo, plataforma** |
| Business Plan e Raio-X existem só como **degrau de entrada** (100% abatido na obra) | Turnkey só via parceiro local, com royalty |
| **Não** vende mentoria nem equipamento avulso | Aqui o "concorrente" nunca ia ser seu cliente mesmo |

**Por quê:** você não pode formar o cara que vai disputar o ponto da esquina com você. Mas o integrador de Recife ou de Goiânia nunca ia comprar sua obra — ele é receita 100% incremental, e ainda vira **cliente da sua plataforma** (Parte 4), que é a parte que compõe.

**Consequência prática do raio ser pequeno:** o mercado de DIY (mentoria + supply + business plan) é **o Brasil inteiro menos o Triângulo** — ou seja, ~99% do país. A esteira de conhecimento não é um apêndice do turnkey; ela tem mercado próprio, muito maior que a obra, e não disputa um único cliente com ela. Isso justifica investir em produtizar de verdade os degraus 3 a 5, não tratá-los como brinde.

**Operacional:** o roteamento precisa de um campo de **UF/cidade** confiável — a LP já pede `f-cidade`, mas é texto livre. Para separar dentro/fora do raio automaticamente, esse campo precisa virar seleção ou ter normalização (o `agendamentos.cidade` já existe e é usado no alerta de WhatsApp).

### Trava 2 — Crédito de upgrade (transforma degrau em entrada, não em substituto)

- **Raio-X do Ponto** → 100% abatido no Business Plan ou no turnkey
- **Business Plan** → 100% abatido no turnkey (validade 90 dias)
- **Sessão Estratégica 1h** → 100% abatida no Business Plan ou turnkey
- **Mentoria** → 30% abatido se virar turnkey (fora do raio, via parceiro)

Efeito: quem tem capital sente que o produto barato é **um depósito**, não um desvio. E quem não tem capital paga pelo seu tempo em vez de consumir de graça.

### Trava 3 — Os buracos são de propósito

Tudo que é DIY (mentoria, supply, business plan) **exclui**, por escrito:

- ART em nome do engenheiro da Irmãos na Obra
- Representação junto à concessionária no parecer de acesso
- Garantia de obra e de comissionamento
- Responsabilidade técnica sobre a instalação

Isso não é maldade comercial — é a Fase 2 do `entrega-completa-eletroposto.md`, o gargalo regulatório real. Quem tem capital e olha essa lista de exclusões **sobe sozinho para o turnkey**. Quem não tem, você monetiza no degrau que ele aguenta. É a mesma lógica do "Comprar o carregador é 20% do trabalho" — só que agora ela também vende o degrau de baixo.

---

## PARTE 1 — Onde o dinheiro está vazando HOJE (conserto de 1 semana)

O problema que você descreveu — reuniões demais com quem só quer entender — **já está codificado na LP**, e o conserto não é produto novo, é regra de roteamento.

Em [index.html:1055](dashboard/public/io/eletroposto/index.html#L1055):

```js
temperatura: (capital === '140_260' || capital === 'acima_260') ? 'quente'
           : (capital === '85_140'  || capital === 'financiar') ? 'morno' : 'frio',
```

A LP **já sabe** quem é frio (`pesquisando`) — e mesmo assim marca pra ele **o mesmo horário 1:1 com o Thiago ou o Diego** que ela marca pro investidor de R$ 260 mil. O lead frio custa exatamente o mesmo que o quente: ~1,5h de um dos dois sócios (prep + reunião + follow-up), e a agenda tem dono — vocês são dois.

### A nova régua de acesso à agenda

Com o raio definido, o roteamento tem **dois eixos, não um**: capital **×** dentro-ou-fora do Triângulo. Hoje a LP só olha o capital — por isso um `pesquisando` de Uberlândia e um `pesquisando` de Recife caem no mesmo lugar, sendo que um é curioso a desviar e o outro é o ICP da mentoria.

| `f-capital` | **Dentro do Triângulo** (tem obra pra vender) | **Fora do Triângulo** (não tem obra pra vender) |
|---|---|---|
| `acima_260` | **1:1 grátis** — cliente-alvo do turnkey | **1:1 grátis**, mas pauta é **parceria/mentoria 1:1 + supply**, não obra |
| `140_260` | **1:1 grátis** | **Mentoria 1:1** ou parceiro local com royalty |
| `85_140` · já tem ponto | **1:1 grátis**, com Raio-X enviado 24h antes | **Business Plan** → mentoria (turma) |
| `85_140` · sem ponto | **Sessão em grupo** → 1:1 se qualificar | **Sessão em grupo** → mentoria (turma) |
| `financiar` | **Sessão em grupo** → 1:1 se aprovar crédito | **Business Plan** (documento bancável) → mentoria |
| `pesquisando` | **Nunca 1:1.** Grupo grátis ou **Raio-X R$ 397** ← *aqui está o vazamento de hoje* | **Nunca 1:1.** Grupo grátis → Mentoria. É a maior fonte de aluno que existe. |
| perfil "quero só o equipamento" | **Recusa** — a headline de filtro da LP já faz isso e está certa | **Supply** (custo + 12%) |

**Como o sistema sabe dentro/fora:** o campo `f-cidade` é texto livre hoje. Precisa virar seleção (ou lista normalizada de cidades do raio, ver pergunta 6 da Parte 7). Sem esse campo confiável, o eixo do raio não roda automático e o roteamento continua manual.

**Leitura da tabela:** dentro do raio, o objetivo é **proteger a hora do sócio** e empurrar curioso para produto pago ou grupo. Fora do raio, o objetivo é **oposto** — capturar o máximo de gente para a esteira de conhecimento, porque ali não existe obra pra perder. O mesmo lead frio que é custo em Uberlândia é receita em Recife.

**Sessão em grupo:** 1 horário fixo por semana, 1h, N pessoas, sempre o mesmo roteiro (as 8 fases + simulador ao vivo + Q&A). Custa 1h de um sócio para 10–30 pessoas em vez de 1,5h para uma. Grava uma vez, reaproveita como material de venda.

**Conta do vazamento** (preencha com o número real de vocês):

```
reuniões/mês × 1,5h × (% frias) = horas de sócio queimadas/mês
```

Se são 20 reuniões/mês e 40% são frias: **12h/mês de sócio** — mais de um dia e meio de trabalho, todo mês, com quem não tem capital. Roteado, isso vira 4h de grupo + tempo livre para atender quente.

### Como implementar (é código pequeno, no que já existe)

1. No `agendar()` da LP, ramificar **antes** do insert: `frio` não cai na grade 1:1 — cai na grade "grupo" (mesmo `agendamentos`, `vendedor_nome` = sala fixa) ou no checkout do Raio-X.
2. Marcar o SKU no lead. Reaproveitar as **etiquetas dinâmicas de origem** que já existem no admin (memória `leads-origem-etiquetas`) — cada produto vira etiqueta, o dashboard agrega sozinho.
3. **Nada de novo ping de WhatsApp.** O alerta de `ioEletroposto.ts` já resolve o 1:1; grupo e produto pago não precisam de aviso — aparecem no CRM.

---

## PARTE 2 — A esteira completa (9 degraus)

> Regra de leitura: **ICP** = pra quem é · **Exclusões** = o que NÃO vai junto (é isso que faz o cara subir de degrau)

### Degrau 0 — Simulador público · **Grátis** · já no ar
- **Entrega:** payback, lucro/mês, ROI 10 anos com os números do próprio lead.
- **Função:** captura + educação + âncora. Nunca mostra preço de equipamento ("preço é assunto da reunião" — já está assim no código).
- **Agregar:** versão "salvar meu estudo" que exige e-mail/WhatsApp e gera PDF automático → alimenta o Degrau 1.

### Degrau 1 — Raio-X do Ponto · ⚠️ **R$ 397** · 100% abatido acima
- **ICP:** o curioso com endereço na mão, o `pesquisando`, o "será que meu ponto serve?"
- **Entrega (assíncrono, 48h, sem reunião):** PDF de 6–8 páginas do endereço específico — frota elétrica e concorrência de recarga da região, estimativa de fluxo, leitura preliminar da rede (padrão de entrada aguenta?), semáforo verde/amarelo/vermelho, e um áudio de 10 min do consultor explicando. **Sem promessa de retorno** — a simulação vai rotulada.
- **Exclusões:** não é projeto, não é ART, não é parecer de acesso, não vale para financiamento.
- **Custo de entrega:** ~1h (30 min de pesquisa + template + 10 min de áudio). Escala com template.
- **Por que é o primeiro a lançar:** estanca o sangramento **na semana que entra**. Quem paga R$ 397 e recebe semáforo vermelho te agradece e some — de graça. Quem recebe verde já entrou na esteira pagando.

### Degrau 2 — Sessão Estratégica de 1h · ⚠️ **R$ 1.200** · 100% abatida
- **ICP:** quem quer "saber tudo que é necessário" com um sócio, mas ainda não é cliente de obra. É exatamente a reunião que hoje vocês dão de graça.
- **Entrega:** 1h gravada com Thiago ou Diego + ata escrita + checklist das 8 fases aplicado ao caso dele + lista de fornecedores e faixas de investimento.
- **Exclusões:** não inclui estudo de viabilidade formal, nem acompanhamento posterior.
- **Custo:** 1,5h de sócio. **Não escala** — por isso tem preço, e por isso quente entra de graça (lá o custo é aquisição de um contrato de R$ 145k).

### Degrau 3 — Business Plan do Eletroposto · ⚠️ **R$ 3.900** · 100% abatido no turnkey
- **ICP:** empresa/investidor que precisa de documento para decidir, para sócio, ou **para o banco**.
- **Entrega:** o Estudo de Viabilidade que já existe (PDF de 15/jul), produtizado — faturamento, lucro, margem, payback, VPL, TIR, análise de sensibilidade e risco, dimensionamento elétrico preliminar, mapa regulatório (NBR 17019, ANEEL 1.000/2021, NDU 042, ICMS×ISS), plano de tarifa e cronograma de implantação.
- **Exclusões:** projeto executivo, ART, parecer de acesso.
- **Custo:** o gerador de propostas de vocês já monta documento — **o Business Plan deve ser gerado pelo mesmo motor**. Meta: 2h de trabalho humano por unidade, não 20.
- **Alavanca escondida:** documento bancável abre a porta do **financiamento** (Degrau 8-b), que é o que destrava o cliente que hoje diz "vou pesquisar". **Depois da reprecificação de 02/08 isso deixou de ser opcional:** a configuração de entrada custa R$ 141.673,00, então quem declara até R$ 140 mil não compra nada à vista — ou financia, ou não é cliente de obra.

### Degrau 4 — Mentoria Implantação · ⚠️ **R$ 14.900 (turma) / R$ 29.900 (1:1)** · 30% abatido
- **ICP:** **empresa que quer entrar no mercado** de recarga — integrador solar, elétrica, construtora, rede de postos. **Só fora do raio.**
- **Entrega (10–12 semanas):** trilha gravada das 8 fases + 8 encontros ao vivo em grupo + acesso à lista de fornecedores homologados + revisão de 1 projeto do aluno + apoio na compra de material (Degrau 5) + templates (planilha de viabilidade, contrato de arrendamento, checklist de comissionamento, tabela de tarifa) + grupo permanente.
- **Exclusões (escritas em negrito no contrato):** sem ART da IO, sem representação na concessionária, sem garantia de obra, sem responsabilidade técnica.
- **Custo:** aulas gravadas 1×; ao vivo em turma = 12h de sócio por **turma inteira**, não por aluno. É o único formato que cabe em duas pessoas.
- **Turmas:** 2 a 3 por ano, 8–15 alunos. Não mais que isso — vocês têm obra pra entregar.

### Degrau 5 — Supply / Compra no custo · ⚠️ **custo + 12% de intermediação**
- **ICP:** quem quer **comprar no custo** e montar sozinho, e o aluno de mentoria.
- **Entrega:** acesso ao preço de compra de vocês (carregador CCS2 pronta-entrega, cabos, base, balizadores, medidor), logística e seguro de carga, conferência de recebimento.
- **Exclusões:** obra, projeto, homologação, garantia de instalação. Garantia é a do fabricante, não a de vocês.
- **Regra (sem exceção):** **só fora do Triângulo, ou para aluno formado da Mentoria.** Dentro do raio, "quero só o equipamento" continua sendo recusado — a headline atual da LP já faz esse filtro e ela está certa. *Cuidado:* não estenda esse direito a quem comprou Raio-X ou Business Plan — senão alguém paga R$ 397 dentro do Triângulo e destrava equipamento no custo, reabrindo exatamente o buraco que a Parte 1 fecha.
- **Margem:** baixa e de propósito. O supply não é o produto — é a porta para a plataforma (Degrau 7), que é onde o dinheiro recorre.

### Degrau 6 — Turnkey (carro-chefe) · **R$ 110k a R$ 280k**
- **ICP:** dono de ponto + capital, dentro do raio.
- **Entrega:** as 8 fases inteiras do `entrega-completa-eletroposto.md`. Sem mudança — é o que já vendem e o que sustenta a casa.
- **Configurações — tabela vigente desde 02/08/2026** (estação + instalação, igual à
  apresentação comercial e ao simulador da LP):
  40 kW/R$ 109.685 · **60 kW/R$ 141.673** · **80 kW/R$ 144.595 (recomendada)** ·
  **120 kW/R$ 203.548** · **160 kW/R$ 229.436** · 240 kW/R$ 279.317.
  Os valores são quebrados de propósito (03/08): preço redondo lê como tabela de balcão.
  O simulador da LP carrega só os quatro em negrito; 40 e 240 kW existem na tabela de
  preço, não no simulador. *(Antes: 40/85k · 60/140k · 80/180k · 120/220k · 160/280k.)*
- **O que muda com a esteira:** deixa de ser a única porta. Passa a receber lead **já educado, já pago e já com estudo na mão** — reunião de fechamento em vez de reunião de descoberta.

### Degrau 7 — Plataforma & Operação (a anuidade) · **hoje: revenda com comissão**
**Esta é a peça que interliga tudo — e a que você ainda não tinha na lista.**

O simulador já debita **14% de gateway** do lucro do investidor. Hoje vocês **revendem** essa camada e ficam com uma comissão. Isso muda o desenho de forma importante:

**O que é hoje (revenda):**
- Receita = % sobre o que o fornecedor cobra do ponto. Margem menor, mas **custo de entrega quase zero** e sem risco de produto.
- Vale a pena vender agressivamente **mesmo com comissão baixa**, porque é recorrente, não consome hora de obra e você já faz o cadastro do ponto de qualquer jeito na Fase 5.

**O movimento que vale dinheiro de verdade — em três degraus:**

| Estágio | Quando | O que muda |
|---|---|---|
| **1. Revenda simples** (hoje) | agora | Comissão por ponto ativo. Objetivo: **volume**, para ter poder de negociação. |
| **2. Master/distribuidor regional** | ~20–30 pontos ativos | Renegociar com o fornecedor: comissão maior, preço de atacado, ou faixa fixa por ponto. É a mesma conversa que se tem com fabricante quando o volume aparece. |
| **3. White-label / camada própria** | ~50+ pontos | Marca de vocês na frente, fornecedor atrás. Aí a margem vira cheia e o Degrau 9 (rede) fica possível — sem isso, a bandeira não existe, porque a base de motoristas é do fornecedor, não sua. |

> **Ponto crítico de estratégia:** enquanto a plataforma for de terceiro, **a base de motoristas e os dados de recarga são dele, não seus.** Os pontos são seus clientes, mas o ativo que compõe (rede, roaming, app) fica com quem tem a plataforma. O Degrau 9 depende de chegar ao estágio 3 — e a única forma de chegar lá é acumular pontos ativos agora.

**Entrega ao cliente:** plataforma OCPP (cobrança pelo app, sem funcionário no ponto), gateway e conciliação, monitoramento 24h, cadastro nos apps/mapas de recarga, painel de tarifa, suporte N1 feito por vocês (o N2 é do fornecedor).
**ICP:** todo mundo. Turnkey, mentorado, aluno, integrador de fora, e o dono de eletroposto órfão que comprou errado de outro fornecedor.
**Como vender pra base fria:** "seu carregador está burro? a gente coloca ele pra cobrar." — venda de comissão pura, sem obra, sem hora de sócio.

> ⚠️ **Falta preencher:** qual o % / valor da comissão atual e se o contrato com o fornecedor permite (a) vender para ponto que não foi obra de vocês e (b) white-label no futuro. Se o contrato proibir qualquer um dos dois, o estágio 3 exige trocar de fornecedor — melhor descobrir com 10 pontos do que com 60.

### Degrau 8 — Receitas de encaixe (baixo esforço, alta margem)

| 8-a | **Corretagem de ponto** | Comissão sobre o arrendamento (o simulador já usa 10% de arrendamento). A LP já pergunta "quero ajuda para encontrar o ponto" — hoje isso não é monetizado. |
| 8-b | **Originação de financiamento** | Comissão do banco/fintech. Destrava o lead `financiar` e o `85_140`. **Sem logo de banco sem contrato de uso de marca.** |
| 8-c | **Manutenção e SLA anual** | Contrato após o 1º ano de garantia. Recorrente, previsível. |
| 8-d | **Seguro do ativo** | Comissão de corretora parceira. |
| 8-e | **Marketing local do ponto** | Vocês já fazem tráfego (Fase 7). Vira fee mensal do ponto entregue. |

### Degrau 9 — Rede / Bandeira (o "super ecossistema", 12–24 meses)
Quando houver 20–40 pontos na plataforma: marca única, app do motorista com roaming entre pontos, tarifa de rede, base de motoristas fidelizados. Aí a IO deixa de vender obras e passa a **operar uma rede** — e cada ponto novo aumenta o valor de todos os outros. É o único cenário em que isso vira empresa de R$ 100M, não empresa de projeto.

---

## PARTE 3 — Como tudo se interliga (o mapa que você pediu)

```
                        SIMULADOR (grátis, já no ar)
                                 │
                    ┌────────────┴────────────┐
              tem capital?                  não / "pesquisando"
                    │                            │
        ┌───────────┴──────────┐        ┌────────┴────────┐
    quente/morno            morno-      SESSÃO EM       RAIO-X
    (tem capital /          sem-ponto   GRUPO (grátis)   R$ 397
     com ponto)                │        1×/semana         │
        │                      └──────────┬───────────────┘
   1:1 GRÁTIS                             │
   (Thiago/Diego)                  ┌──────┴──────┐
        │                     dentro do raio   fora do raio
        │                          │                │
        │                    SESSÃO 1h R$1.2k   MENTORIA R$14,9k
        │                    BUSINESS PLAN         + SUPPLY custo+12%
        │                       R$3,9k                  │
        │                          │                    │
        └──────────► TURNKEY R$110k–280k ◄──────────────┘
                           │              (parceiro local + royalty)
                           ▼
              ═══ PLATAFORMA — R$249/mês + % kWh ═══
              (todo mundo termina aqui, para sempre)
                           │
                    manutenção · seguro · marketing local
                           │
                    ═══ REDE / BANDEIRA ═══
```

**As três leis do ecossistema:**

1. **Todo degrau pago vira crédito no degrau de cima.** Ninguém perde dinheiro subindo.
2. **Todo caminho termina na plataforma.** Curioso, aluno, concorrente ou cliente de obra — todos viram assinatura.
3. **Nenhum degrau entrega o gargalo regulatório** (ART, parecer de acesso, garantia de obra), exceto o turnkey. É o que impede a esteira de canibalizar a obra.

---

## PARTE 4 — Economia: por que isso ganha mais que só vender obra

**Cenário conservador de 12 meses** (⚠️ volumes assumidos — ajustar com o histórico real de vocês):

| Linha | Volume/ano | Ticket | Receita bruta | Horas de sócio |
|---|---|---|---|---|
| Raio-X | 120 | R$ 397 | R$ 47.640 | 120h |
| Sessão 1h paga | 40 | R$ 1.200 | R$ 48.000 | 60h |
| Business Plan | 30 | R$ 3.900 | R$ 117.000 | 60h |
| Mentoria (2 turmas × 10) | 20 | R$ 14.900 | R$ 298.000 | 60h |
| Supply (fora do raio) | 15 | ~R$ 12k de fee | R$ 180.000 | 45h |
| **Turnkey** | 12 | R$ 144.595 | **R$ 1.735.140** | 600h |
| Plataforma — comissão (40 pontos, média 8 meses) | — | ⚠️ ~25% de R$ 249/mês | R$ 19.920 | 100h |
| Encaixes (8-a a 8-e) | — | — | R$ 120.000 | 80h |
| | | | **≈ R$ 2,57 mi** | **≈ 1.125h** |

> **Não leia esse total como projeção.** Os volumes são premissas minhas (vocês ainda não me passaram reuniões/mês nem taxa de fechamento — perguntas 1 e 2 da Parte 7), e a linha da plataforma usa uma comissão de 25% que também é chute. É um **modelo de capacidade**, feito pra mostrar onde a operação estoura e qual linha compõe — não uma previsão de faturamento.

**O que essa tabela mostra:**

- Os degraus de baixo somam **~R$ 830 mil** — e não são o ponto. O ponto é que eles **pagam a operação de vendas e a aquisição** enquanto o turnkey fecha.
- **A plataforma em regime de revenda é quase irrelevante no ano 1 (R$ 20 mil) — e ainda assim é a linha mais estratégica do plano.** Ela não vale pelo dinheiro de agora, vale pelo **número de pontos ativos**, que é a moeda para renegociar comissão (estágio 2) e, depois, para ter camada própria (estágio 3). No estágio 3, com 120 pontos e margem cheia, a mesma linha vira ~R$ 360k/ano recorrente sem obra nenhuma. **Meça pontos ativos, não faturamento da plataforma, durante os primeiros 18 meses.**
- **A mentoria é a linha com mais espaço para crescer.** Com o raio limitado ao Triângulo, o mercado dela é o Brasil inteiro e não canibaliza nada. Duas turmas/ano é o piso conservador — quatro turmas é factível se as aulas forem gravadas e o ao vivo for só Q&A.
- **1.125h ÷ 2 sócios ÷ 11 meses ≈ 51h/mês cada um** só nessa operação. É apertado, mas cabe — desde que Raio-X e Business Plan sejam **templados** e a mentoria seja **em turma**. Se qualquer um dos dois virar trabalho artesanal, o plano estoura na capacidade, não na demanda.

**O gargalo real do plano não é lead. É hora de sócio.** Toda decisão de produto aqui deve ser respondida com: *"isso me custa hora de Thiago/Diego por unidade vendida, ou uma vez só?"*

---

## PARTE 5 — Sequência de execução (o que fazer, em ordem)

### Fase 1 — Parar o sangramento · semanas 1–2
1. Implementar a régua de roteamento da Parte 1 na LP (`agendar()` ramifica por `temperatura`).
2. Criar a **sessão em grupo semanal** (1 horário fixo, link único, roteiro das 8 fases).
3. Colocar o **Raio-X R$ 397** no ar — checkout já existente no ecossistema (Kiwify/Stripe), entrega manual com template.
4. Marcar cada lead com etiqueta de produto (reaproveita o sistema de etiquetas dinâmicas do admin).

**Resultado esperado:** agenda 1:1 só com quem tem capital, e o curioso passa a pagar ou a ser atendido em grupo.

### Fase 2 — Produtizar o meio · semanas 3–8
5. Business Plan gerado pelo motor do gerador de propostas (input: endereço + config + tarifa → PDF completo).
6. Sessão Estratégica paga no ar, com agenda separada da agenda de fechamento.
7. Página de vendas de cada SKU (podem ser seções da LP atual + checkout, não precisa de site novo).

### Fase 3 — Escalar o que não consome obra · meses 3–5
8. Turma 1 da Mentoria (fora do raio) — vender para a base de leads frios que já existe no CRM.
9. Estruturar o Supply (tabela de custo, fee, contrato de exclusão de responsabilidade).

### Fase 4 — Ligar a anuidade · meses 4–8
10. Definir a camada de plataforma (própria vs. revenda) e empacotar como assinatura.
11. Ofertar plataforma para **eletropostos órfãos** — quem já tem carregador e não fatura direito.

### Fase 5 — Rede · mês 12+
12. Bandeira, roaming, app do motorista.

---

## PARTE 6 — Guardrails (não negociáveis)

1. **Nenhuma promessa de rendimento.** Vale para anúncio, LP, Raio-X, Business Plan e mentoria. Todo número de retorno vai rotulado como **simulação**, com premissas visíveis. Um documento **pago** com payback/VPL/TIR tem exposição maior que uma calculadora grátis — a rotulagem tem que estar **dentro do PDF**, não só na LP.
2. **Contábil é "orientação"**, nunca "fazemos sua contabilidade". Mantém a redação já aprovada.
3. **Sem logo de banco** sem contrato de uso de marca (vale para o Degrau 8-b).
4. **Zero automação nova de WhatsApp.** Avisos de agenda estão desligados por decisão sua (25 e 28/jul) e o monitor de criativos foi apagado — a esteira não pode reintroduzir ping automático. O CRM é o lugar.
5. **Dado de mercado só com fonte.** Os números da ABVE (181 mil plug-in em 2025, +26%; pontos de recarga +42%) já estão validados no repo. Qualquer número novo entra marcado como estimativa.
6. **A headline de filtro fica.** "Não vendemos carregador avulso" continua na LP do turnkey. O supply e a mentoria vivem em **página separada**, com público separado. Misturar as duas mensagens na mesma página destrói as duas.

---

## PARTE 7 — O que preciso de vocês para fechar os números

✔️ **Respondido em 30/jul:** raio = Triângulo Mineiro · plataforma = revenda com comissão.

| # | Pergunta | Trava o quê |
|---|---|---|
| 1 | **Qual a margem real do turnkey de 80 kW (R$ 144.595)?** | Sem isso não dá pra dizer quanto crédito de upgrade cabe |
| 2 | **Quantas reuniões/mês vocês fazem hoje e quantas fecham?** | Quantifica o vazamento e prova o ganho do roteamento |
| 3 | **Qual o % da comissão da plataforma, e o contrato permite vender para ponto de terceiro / white-label?** | Decide se o estágio 3 (camada própria) é evolução ou troca de fornecedor |
| 4 | **Preço de compra do carregador CCS2 (custo real)** | Define o fee do supply |
| 5 | **Quantos eletropostos já entregues e rodando?** | Prova social — e base inicial da plataforma |
| 6 | **Cidades do "Triângulo e região" que contam como dentro do raio** | Vira a regra de roteamento automático dentro/fora na LP |

---

*Documento vivo. Fonte técnica/regulatória herdada de `entrega-completa-eletroposto.md` (NBR 17019, ANEEL 1.000/2021, NDU 042, ICMS×ISS). Números de configuração e premissas financeiras extraídos do simulador da LP `/io/eletroposto` (gateway 14%, arrendamento 10%, manutenção 0,1%, imposto 6% Simples, rampa 50%→100% em 24 meses).*
