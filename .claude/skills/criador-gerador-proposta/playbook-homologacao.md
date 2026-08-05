# Playbook — Homologação (Fase 4, dias 22–28)

> Plataforma "pronta" do nosso lado. Hora do cliente validar antes do go-live oficial.

## Como funciona

Cliente recebe acesso a **ambiente de homologação**:
- URL: `staging-propostas.{cliente}.com.br` ou `gerador-{slug}-staging.vercel.app`
- Banco: mesmo Supabase, schema `homologacao_{slug}` OU tenant_id de staging
- Branding: idêntico à produção
- 3 vendedores reais + 2 admins do cliente cadastrados
- Equipamentos completos
- 10 propostas de exemplo pré-criadas

## Checklist da semana

### Dia 22 — Entrega pra cliente

- [ ] Mandar email ao decisor com:
  - URL de staging
  - Credenciais dos 3 vendedores teste
  - Credenciais do admin
  - **Roteiro de testes** (anexar [roteiro-validacao.md](roteiro-validacao.md))
  - Prazo: 5 dias úteis pra validar
  - Canal de feedback: planilha compartilhada ou ferramenta de bug tracking

### Dias 23–25 — Cliente testa

- Acompanhar via WhatsApp, responder dúvidas em até 4h úteis
- Toda reclamação vira issue em backlog
- Diariamente: triagem + status pro cliente ("hoje resolvi A, B, C")

### Dia 26–27 — Ajustes finais

- [ ] Corrigir bugs reportados
- [ ] Implementar pedidos que estavam no escopo
- [ ] **Rejeitar gentilmente pedidos fora de escopo** — orçar à parte
- [ ] Cliente revalida cada correção

### Dia 28 — Aprovação formal

- [ ] Cliente assina aceite (email com OK explícito basta)
- [ ] Pagar a 2ª parcela do setup (50% restante)
- [ ] Definir data exata do go-live (data + hora)
- [ ] Travar congelamento de novas features até 7 dias pós go-live

## Roteiro de validação (mandar pro cliente)

> Mande este checklist pro cliente. Cada item validado, ele marca. Cada item com problema, ele descreve.

**Como admin:**
- [ ] Consigo logar com email/senha
- [ ] Vejo a lista completa dos 96 vendedores
- [ ] Consigo desativar um vendedor (e ele perde acesso na hora)
- [ ] Consigo cadastrar um vendedor novo
- [ ] Vejo a tela de equipamentos com todos os itens importados
- [ ] Consigo editar preço de um equipamento
- [ ] Consigo cadastrar um equipamento novo
- [ ] Vejo lista de propostas geradas pelos vendedores
- [ ] Filtro por vendedor, período, status funciona
- [ ] Métricas básicas aparecem (total/mês, top 5 vendedores)
- [ ] Exporto relatório em CSV

**Como vendedor:**
- [ ] Consigo logar
- [ ] Vejo só as MINHAS propostas (não as de outros)
- [ ] Crio uma proposta nova preenchendo dados do cliente
- [ ] Seleciono kit/módulo/inversor do catálogo
- [ ] Sistema calcula payback corretamente (comparar com cálculo manual)
- [ ] Geração de link da proposta funciona
- [ ] Geração de PDF funciona
- [ ] Botão "Enviar via WhatsApp" abre WhatsApp Web/App com mensagem
- [ ] Recebo notificação quando cliente abre a proposta

**Como cliente final (visualizar proposta):**
- [ ] Abro o link em celular e em desktop, ambos funcionam
- [ ] Layout fica bonito (logo, cores, textos)
- [ ] Gráficos aparecem corretamente
- [ ] Consigo baixar PDF
- [ ] Botão "Quero contratar" abre WhatsApp com mensagem certa

**Validação de cálculo (CRÍTICA):**
- [ ] Peguei 5 propostas que minha empresa já gerou (sistema antigo) e refiz no novo sistema
- [ ] Os números bateram (margem de erro <2% é aceitável)
- [ ] Onde divergiu, anotei o motivo

## Critério de aceite

Cliente aprova quando:
- 100% dos itens do roteiro estão OK
- Cálculo bate com sistema antigo (ou divergência foi entendida e aceita)
- Branding está fiel à marca dele
- Vendedores teste conseguiram usar sem chamar suporte

## Riscos comuns

- **Cliente "se perde" no teste** — call de 1h pra fazer junto, gravada como material de treinamento
- **Bug que aparece só na visão dele** (browser, rede) — pedir vídeo gravado da tela
- **Cliente quer adicionar feature nova "antes de aprovar"** — separar em "pós go-live" pra não atrasar
- **Cálculo divergente** — sentar com responsável técnico dele, entender qual fórmula está certa
