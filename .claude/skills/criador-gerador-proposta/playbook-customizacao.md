# Playbook — Customização (Fase 3, dias 8–21)

> Cliente já tem URL no ar (mesmo que com dados de exemplo). Hora de fazer ficar exatamente do jeito dele.

## Checklist

### Semana 1 (dias 8–14)

- [ ] **Importar vendedores** (4–5 dias antes de treinamento)
  - Receber CSV padronizado (`templates/seed-vendedores.csv`)
  - Validar emails únicos e válidos
  - Rodar script de bulk-invite (cria user Supabase + manda welcome email)
  - Verificar entrega: cada vendedor recebeu o email?
- [ ] **Customizar textos da proposta** (modelo)
  - Saudação inicial
  - Texto de fechamento
  - Termos e garantias
  - Texto do botão CTA (WhatsApp/Email)
- [ ] **Configurar condições de financiamento**
  - Inserir parceiros de financiamento (BV, Solfácil, etc) em `tenant_settings.financiamento`
  - Cada um com taxa, prazo mínimo/máximo, condições
- [ ] **Layout da proposta web (`proposta.html`)**
  - Hero com logo + nome do cliente
  - Cores aplicadas via CSS vars
  - Seções na ordem que o cliente quer (varia)
- [ ] **Painel admin do cliente**
  - Tela "Equipamentos" — CRUD funcionando
  - Tela "Vendedores" — listar, ativar/desativar
  - Tela "Propostas" — filtros, exportar CSV
  - Tela "Métricas" — total propostas, ranking, taxa de visualização

### Semana 2 (dias 15–21)

- [ ] **Painel do vendedor**
  - Lista de propostas próprias
  - Status de cada uma (rascunho, enviada, visualizada, fechada)
  - Botão "Nova proposta" que abre o gerador
  - Notificação quando cliente abriu proposta
- [ ] **Gerador de proposta** (adaptado do `/gerador` público)
  - Form puxa equipamentos do tenant (não hardcoded)
  - Cálculo usa parâmetros do `tenant_settings.calculo`
  - Salva no banco vinculado ao vendedor logado
  - Gera link compartilhável + PDF
- [ ] **Tracking de visualização**
  - Pixel/evento JS no `proposta.html`
  - Webhook → `INSERT INTO proposta_views` + `proposta_events`
  - Notificação realtime pro vendedor (Supabase Realtime)
- [ ] **Geração de PDF**
  - Endpoint `/api/proposta/[id]/pdf`
  - Puppeteer ou `@vercel/og` renderiza proposta
  - Upload em Vercel Blob
  - URL temporária retornada
- [ ] **Integração WhatsApp (link, não API)**
  - Botão "Enviar via WhatsApp" → abre `wa.me/?text={mensagem com link da proposta}`
  - Mensagem padrão configurável em `tenant_settings.mensagens.whatsapp`

## Refatorações esperadas no gerador estrela

Tirar do `/gerador` (público) pra versão multi-tenant:

| Hardcoded original | Substituir por |
|---|---|
| `solar-data.js` (irradiação) | Query `irradiacao_cidades` no Supabase |
| `tabelas.js` (equipamentos) | Query `equipamentos WHERE tenant_id = X` |
| Logo no CSS | CSS var injetada via middleware |
| Cores no CSS | CSS vars dinâmicas |
| Texto fixo de saudação | `tenant_settings.textos.saudacao` |
| Botão "Contratar" WhatsApp fixo | `tenant_settings.whatsapp_contato` |
| Inflação/degradação no JS | `tenant_settings.calculo.*` |

## Saída esperada da fase

✅ Painel admin funcional, cliente consegue mexer em catálogo sozinho
✅ Painel do vendedor funcional, cada vendedor vê só as suas
✅ Gerador adaptado puxa todo dado do banco
✅ Proposta web 100% no branding do cliente
✅ Tracking de visualização funcionando
✅ PDF gerável
✅ 96 vendedores cadastrados, todos receberam email de boas-vindas
✅ Bug list zerada antes de mandar pra homologação

## Riscos comuns nesta fase

- **Vendedor não recebe email de boas-vindas** — checar spam, reenviar via Admin API
- **Tracking dispara false positive** — bot do WhatsApp/Gmail abre o link sozinho. Filtrar User-Agent ou IP de datacenter.
- **PDF gera errado** — Puppeteer em Vercel function precisa de configs específicas. Considera `@sparticuz/chromium`.
- **Cálculo de proposta diverge do sistema antigo do cliente** — exigir 5 propostas conhecidas dele pra validar fórmula antes do go-live.
