# 🗺️ Roadmap de Melhorias — SolarDoc (rumo ao 10/10)

Estado atual: **~8,5/10**. Lista do que falta, priorizada por ROI (impacto × esforço).
Tudo aqui é OPCIONAL — o 8,5 já é um produto saudável, seguro e honesto.
Atacar uma de cada vez. As de "🟢 horas" rendem mais por esforço; as de "🔴 dias"
são trabalho de fôlego que o cliente quase não vê (melhora manutenção/dev).

> Como usar: peça pro Claude "faz o item X do roadmap" e ele investiga + executa
> com o mesmo padrão (verifica, valida, testa, deploya).

---

## 🔒 SEGURANÇA — fechar o que sobrou (pendências suas nos painéis)

| Item | Esforço | Quem faz |
|------|---------|----------|
| **Confirmar CRON_SECRET no GitHub** (ver se os crons voltaram na aba Actions) | 1 min | você |
| Rotacionar **Stripe webhook secret** (o menos crítico; só valida origem) | 5 min | você gera, Claude seta |
| Rotacionar **JWT_SECRET** (desloga os 127 usuários — só quando topar) | Claude faz | você autoriza |
| Validar assinatura nos **webhooks Z-API / Kiwify** (hoje aceitam sem validar) | ~1h código | Claude |

→ Detalhes completos em `SECURITY-RUNBOOK.md`.

---

## 🎯 UX DO CARRO-CHEFE (Gerador de Proposta) — maior impacto no uso diário

| # | Melhoria | Por quê | Esforço |
|---|----------|---------|---------|
| 1 | **Autosave do formulário** (localStorage, debounce) | Um erro de rede/timeout apaga ~40 campos preenchidos. Idem cadastro de empresa (40+ campos). | 🟢 ~2h |
| 2 | **Datalist de marcas** (módulo/inversor) | Integrador redigita "Canadian Solar"/"Growatt" em TODA proposta. Autocompletar com as últimas usadas. | 🟢 ~2h |
| 3 | **Validação inline** (marcar campo faltante + scroll até ele) | Hoje o botão parece pronto, o cara clica e o erro aparece em texto no rodapé, longe do campo culpado. | 🟢 ~2h |
| 4 | **"Nova proposta" zerar o form** | Hoje só esconde o preview; os campos do cliente anterior continuam → risco de mandar proposta com nome/valor errado. | 🟢 ~30min |
| 5 | **21 parcelas de cartão colapsadas** | Sobrecarga visual; começar mostrando só as marcadas (6/12/18/21x) com "ver todas". Grid estoura no mobile. | 🟢 ~1h |
| 6 | **Autofill de cliente salvo** na proposta | Hoje ignora os clientes cadastrados (input de texto puro). Oferecer seletor opcional. | 🟢 ~1h |

---

## 🧩 UX GERAL — fricções e feedback

| # | Melhoria | Por quê | Esforço |
|---|----------|---------|---------|
| 7 | **Trocar `alert()` nativo por toast** (checkout, billing, PDF) | `alert()` é bloqueante, feio, sem retry. Erro cego no checkout = venda perdida. Já existe um bom modelo (`copyMsg`). | 🟢 ~2h |
| 8 | **Botões de share (copiar link/WhatsApp) nos OUTROS docs** | A Proposta Solar tem share de 1 clique (ótimo); os 6 outros tipos só baixam/imprimem. Inconsistente. | 🟢 ~2h |
| 9 | **Itens travados da sidebar viram clicáveis** → levam pra /empresa | Sem CNPJ, 8 itens viram texto cinza morto. Cliente novo vê menu inerte e não sabe o que fazer. | 🟢 ~1h |
| 10 | **Toast de sucesso** ao salvar cliente/terceiro (hoje o modal fecha em silêncio) | Confirmação visual. Empresa já tem; clientes/terceiros não. | 🟢 ~1h |
| 11 | **Colapsar técnicos 2º/3º no cadastro de empresa** | Onboarding pesado (CNPJ + engenheiro + 3 técnicos abertos), sendo todos opcionais. | 🟢 ~1h |
| 12 | **Spinner com timeout + retry** (se /auth/me ou /company travam, gira pra sempre) | Fallback após ~8s. | 🟢 ~1h |
| 13 | **PlanBadge mostrar "quanto resta"** ("58 restantes") em vez de "32/90" | Free confere o limite o tempo todo; comunica melhor. | 🟢 ~30min |

---

## 🎨 DESIGN / CONSISTÊNCIA VISUAL

| # | Melhoria | Por quê | Esforço |
|---|----------|---------|---------|
| 14 | **Repaginar a tela de billing/suspensão** (`layout.tsx`) | Está no tema AMBER ANTIGO (off-brand) — e quem vê é cliente pagante suspenso. Usa cinza #334155 que a memória manda evitar. | 🟡 ~1-2h |
| 15 | **Criar `components/ui/{Button, Card, Input}`** compartilhados | `.card` global tem 0 usos; cada tela refaz inline. `btnPrimary`/`cardStyle` idênticos duplicados. Botão primário tem 2 cores de texto conflitantes. | 🔴 ~3h criar + migração contínua |
| 16 | **Migrar telas pros componentes ui** (aos poucos) | Mata os 899 estilos inline e os fallbacks amber #F59E0B stale (9 arquivos). ⚠️ NÃO fazer tudo de uma vez (vira 4º estilo de botão). | 🔴 dias (contínuo) |
| 17 | **Normalizar raio/espaçamento/fonte** com tokens (`var(--radius-*)`, `var(--text-*)`) | Cards iguais com aparências sutilmente diferentes (16 vs 12 de raio, fonte solta). Resolvido junto com o item 15. | 🔴 contínuo |
| 18 | **Mobile do CRM/admin** (kanban rola 1 coluna por vez; tabelas estouram) | Ferramentas internas (desktop), prioridade baixa. Scrollbar do CRM ainda usa amber antigo. | 🟡 ~2h |

---

## 🧹 QUALIDADE DE CÓDIGO (invisível pro cliente — melhora manutenção)

| # | Melhoria | Por quê | Esforço |
|---|----------|---------|---------|
| 19 | **Quebrar god components** (CRM 1.359 linhas/34 hooks; PropostaSolarForm 1.032; admin 1.004) | Arquivos gigantes = onde bug futuro mais provável mora. Maior risco de manutenção. | 🔴 dias |
| 20 | **Eliminar os 305 `any`** (backend) | Tipagem real; o `strict:true` fica cosmético com tanto any. | 🔴 dias |
| 21 | **Cobertura de testes** (hoje ~3% backend; pagamentos/templates/agentes sem teste) | Rede de segurança contra regressão. Já tem 48 testes passando de base. | 🔴 dias |
| 22 | **Unificar logging** (230 logger.* + 133 console.* misturados) | Metade do código não usa o logger oficial estruturado. | 🟡 ~2h |
| 23 | **Adicionar teste pros endpoints novos** (/trafego, /cron/upgrade-nudge) | Cobre o que foi criado recente (gate de admin do /trafego é crítico). | 🟢 ~1h |

---

## 🚀 PRODUTO / ESTRATÉGIA (decisão de negócio, não código)

| # | Tema | Observação |
|---|------|------------|
| 24 | **Consolidar foco** | 12+ verticais no mesmo repo (LimpaPro, Pack, Viral Studio, Uai Green, Gerador B2B...). O core (SolarDoc) não tem roadmap dedicado. Dispersão é risco estratégico. |
| 25 | **Multi-usuário** | Citado como "roadmap" pelos agentes de venda. Hoje VIP compartilha 1 login. |
| 26 | **Medir o funil de conversão** que montamos | Os 13 free quentes receberam email/banner/WhatsApp. Vale medir quantos converteram antes de novas frentes. |

---

## 💡 RECOMENDAÇÃO HONESTA (do Claude)

**Não persiga o 10/10 no código agora.** O salto 5,5→8,5 foi tapar buracos que
sangravam (segurança, promessas falsas, bugs). O salto 8,5→10 é refinamento que
o cliente quase não vê e custa semanas.

**Melhor ROI hoje:** os itens 🟢 do bloco "UX do carro-chefe" (1-4) — eliminam o
atrito diário de quem mais usa a plataforma, em horas cada.

**Mas o maior retorno do seu tempo NÃO está nesta lista** — está em CRESCER
(mais clientes, o funil de conversão, tráfego pago). Um SaaS 8,5 que dobra de
clientes vale muito mais que um 10 com os mesmos 38 pagantes.
