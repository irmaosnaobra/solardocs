# Questionário de Onboarding — Gerador de Propostas

> **Objetivo:** coletar **todas** as informações necessárias pra entregar o projeto sem precisar voltar ao cliente perguntando coisas.
> Aplicar em **uma única call de 60–90 minutos** com o decisor + responsável operacional.
> Versão preenchida fica em `Geradores/Gerador-XXXX/01-briefing/questionario-respondido.md`.

---

## A. Empresa cliente

1. **Razão social:**
2. **Nome fantasia:**
3. **CNPJ:**
4. **Endereço completo (sede):**
5. **Site oficial:**
6. **Tempo de mercado:**
7. **Quantos clientes finais já atenderam:**
8. **Faturamento mensal aproximado** (faixa, não precisa exato):

## B. Decisor e operação

9. **Nome do decisor (quem assina o contrato):**
10. **Cargo do decisor:**
11. **Email + WhatsApp do decisor:**
12. **Quem vai ser o admin operacional da plataforma** (pode ser o mesmo)?
13. **Quem é o responsável técnico do lado deles** (TI, marketing, comercial)?
14. **Existe alguém que vai gerenciar o catálogo de equipamentos** (atualizar preços, incluir produto novo)?

## C. Time de vendas

15. **Quantos vendedores ativos hoje:**
16. **Modelo de contratação** (CLT, PJ, autônomo, misto):
17. **Existe hierarquia** (gerente regional, líder de equipe)? Se sim, qual a estrutura?
18. **Vendedor pode ver propostas de outros vendedores** (geralmente não, mas perguntar)?
19. **Vendedores são geograficamente distribuídos** ou centralizados em um local?
20. **Como é o treinamento atual de novos vendedores:**
21. **Os vendedores usam celular ou computador pra fazer proposta hoje?**

## D. Sistema atual (CRÍTICO — diferencia o "porquê trocar")

22. **Qual sistema usam hoje pra gerar proposta?** (Word, Excel, Canva, calculo.solar, outro SaaS)
23. **Há quanto tempo usam o atual:**
24. **Quanto custa o sistema atual** (mensalidade ou licença):
25. **Por que estão considerando trocar?** (preço, recurso faltante, atendimento, marca, outro)
26. **O que o sistema atual faz BEM** que vocês querem manter:
27. **O que o sistema atual NÃO faz** ou faz mal:
28. **Querem migrar propostas históricas do sistema atual?** Volume aproximado:
29. **Existe contrato/multa pra rescindir o atual?** Em quanto tempo conseguem sair?

## E. Marca e identidade visual

30. **Têm manual de marca / brand book?** Anexar se sim.
31. **Logo em alta resolução** (PNG transparente + SVG):
32. **Versão monocromática do logo** (pra fundo escuro):
33. **Versão quadrada / favicon:**
34. **Paleta de cores** (mínimo: principal, secundária, sucesso, alerta) — em hex:
35. **Tipografia preferida** (Google Fonts ou fonte específica):
36. **Tom de comunicação** (formal, informal, técnico, descontraído):
37. **Materiais de referência** (site, brochura, propostas anteriores em PDF):
38. **Tem assinatura/slogan/tagline:**

## F. Domínio e email

39. **Domínio desejado pra plataforma** (ex: `propostas.empresa.com.br`):
40. **Quem administra o DNS** (registro.br, GoDaddy, Cloudflare)?
41. **Vocês podem dar acesso ao DNS** ou preferem que mandemos os registros pra vocês aplicarem?
42. **Email remetente desejado** (ex: `propostas@empresa.com.br`):
43. **Esse domínio já está verificado no Resend?** (provavelmente não, vamos configurar)
44. **Quem recebe respostas dos emails** (Reply-To)?

## G. Catálogo de equipamentos

> Preencher em CSV separado se for grande. Modelo em `templates/seed-equipamentos.csv`.

45. **Marcas de módulo trabalhadas** (Canadian, Trina, JA Solar, etc):
46. **Faixa de potência dos módulos** (mín–máx Wp):
47. **Marcas de inversor trabalhadas:**
48. **Tipos de inversor** (string, microinversor, híbrido):
49. **Kits pré-montados oferecidos?** (lista)
50. **Estrutura de fixação** — preço por kWp, por painel, ou variável (telhado cerâmico, fibrocimento, solo, laje)?
51. **Outros componentes** (string box, cabos, conectores, dispositivo proteção surto):
52. **Mão de obra** — preço por kWp instalado? Varia por região?
53. **Markup/margem padrão** aplicado:
54. **Tem preço diferente por estado/cidade?**
55. **Quem mantém os preços atualizados** e com qual frequência?

## H. Parâmetros técnicos de cálculo

56. **Regiões de atuação** (estados/cidades):
57. **Tarifa de energia média** por região (kWh/R$):
58. **Inflação energética anual considerada** (padrão de mercado: 8%):
59. **Degradação anual do painel** (padrão: 0,5%):
60. **Performance ratio do sistema** (padrão: 80%):
61. **Tempo de simulação financeira** (padrão: 25 anos):
62. **Considerações especiais** (taxa de disponibilidade bifásica, Fio B, ICMS):
63. **Vocês têm fórmula proprietária** que difere do padrão de mercado?

## I. Condições comerciais nas propostas

64. **Formas de pagamento aceitas:** (à vista, cartão, financiamento)
65. **Parceiros de financiamento** (BV, Solfácil, Sicredi, Santander, outros):
66. **Taxas e prazos típicos** de cada parceiro:
67. **Prazo de entrega/instalação padrão:**
68. **Garantias** (módulo, inversor, instalação, performance):
69. **Validade padrão da proposta** (sugestão: 15 dias):
70. **Tem condições especiais** (desconto à vista, brinde, etc)?

## J. Integrações desejadas

71. **CRM em uso** (RD Station, HubSpot, Pipedrive, outro)?
72. **Querem integração com o CRM** (envio de proposta sincroniza lead)?
73. **WhatsApp Business** — quem manda mensagem hoje? Tem API?
74. **ERP / sistema de gestão** em uso?
75. **Outros sistemas** que precisariam conversar com o gerador?

## K. Operação e SLA

76. **Volume esperado de propostas/mês:**
77. **Picos sazonais** (ex: dezembro, antes da bandeira tarifária):
78. **SLA esperado de disponibilidade** (99% mensal é o padrão da nossa proposta):
79. **Horário de pico de uso** (manhã, tarde, noite):
80. **Vão usar em dia útil só ou fim de semana também:**
81. **Quem da equipe vai ser o "ponto focal"** pra reportar bug e pedir ajuste?

## L. Aspectos legais

82. **Vocês têm política de privacidade publicada?** Link:
83. **Vocês têm termos de uso da plataforma?** Link:
84. **CNPJ pra emissão de nota fiscal nossa:**
85. **Contato do financeiro pra cobranças:**
86. **Forma de pagamento preferencial** (boleto, cartão, PIX):
87. **Dia preferencial de vencimento da mensalidade:**
88. **Quem assina o contrato** (mesmo decisor)?
89. **Há cláusulas especiais** que precisam estar no contrato?

## M. Treinamento e onboarding

90. **Vocês preferem treinamento ao vivo, gravado ou misto:**
91. **Quem vai participar das sessões** (todos os 96 ou só multiplicadores)?
92. **Têm sala/equipamento pra treinamento presencial** (se aplicável)?
93. **Vão querer material escrito de apoio** (manual em PDF)?
94. **Têm horário preferencial** pras sessões de treinamento online?

## N. Critérios de sucesso (definir desde já)

95. **Em 90 dias, o que vai indicar que o projeto deu certo:**
96. **Métricas que vocês vão acompanhar:**
97. **Existe alguma meta numérica** (X propostas/mês, Y% conversão)?
98. **O que pode dar errado e nos surpreender:**

## O. Funcionalidades fora do escopo (alinhar expectativa AGORA)

> Confirmar que o cliente entende que essas coisas não estão inclusas. Cada item NÃO incluso é orçado à parte.

99. **App mobile nativo** (a plataforma é responsiva): de acordo? `[ ] sim [ ] precisa discutir`
100. **Integração com CRM**: de acordo que é orçamento à parte? `[ ] sim [ ] precisa discutir`
101. **Funcionalidade customizada** que não está descrita nesta proposta: alguma em mente?
102. **Migração de propostas históricas**: confirma volume e formato pra orçar:

---

## Pós-questionário

Ao final da call:
- Resumir em 5 bullets o que foi alinhado
- Mandar ata resumida por email/WhatsApp no mesmo dia
- Solicitar formalmente (email) o envio dos artefatos:
  - Logo em PNG + SVG
  - Planilha de equipamentos (modelo fornecido)
  - Planilha de vendedores (modelo fornecido)
  - Acesso ao DNS (ou comprometimento de aplicar os registros que mandarmos)
- Marcar próxima reunião (kick-off técnico, semana seguinte)
