# SolarDoc Pro — TASKS.md
# Tarefas Executáveis por Agente

> Cada tarefa é autônoma: um agente consegue executá-la do início ao fim sem depender de outro rodando em paralelo.
> As dependências indicam apenas que outro módulo deve estar **concluído** antes de começar.

---

## LEGENDA

- `[BLOQUEANTE]` → Esta tarefa bloqueia outras. Faça primeiro.
- `[DEPENDE DE: X]` → Só pode começar após a tarefa X estar concluída.
- `[PARALELA]` → Pode rodar simultaneamente com outras tarefas do mesmo nível.

---

## MÓDULO 1: SERVIDOR E API

---

### TAREFA 1.1 — Setup do Projeto da API
**Status:** `[BLOQUEANTE]` para todas as tarefas da API  
**Depende de:** Nada  
**Pode rodar em paralelo com:** TAREFA 4.1 (Landing setup), TAREFA 5.1 (Widget setup)

**O que fazer:**

1. Criar a pasta `api/` na raiz do projeto
2. Inicializar projeto Node.js com `npm init -y`
3. Instalar dependências de produção:
   ```
   npm install express pg bcryptjs jsonwebtoken cors helmet dotenv zod openai @anthropic-ai/sdk express-rate-limit
   ```
4. Instalar dependências de desenvolvimento:
   ```
   npm install -D typescript ts-node-dev @types/express @types/pg @types/bcryptjs @types/jsonwebtoken @types/cors @types/node
   ```
5. Criar `tsconfig.json` com configurações para Node.js:
   - `target: ES2020`
   - `module: CommonJS`
   - `rootDir: ./src`
   - `outDir: ./dist`
   - `strict: true`
6. Criar `package.json` com scripts:
   - `dev`: `ts-node-dev --respawn src/app.ts`
   - `build`: `tsc`
   - `start`: `node dist/app.js`
7. Criar `src/app.ts` com:
   - Inicialização do Express
   - Middlewares: helmet, cors, express.json()
   - Placeholder de rotas (comentados)
   - Servidor escutando na porta `process.env.PORT || 3001`
8. Criar `.env.example` com todas as variáveis:
   ```
   DATABASE_URL=
   JWT_SECRET=
   OPENAI_API_KEY=
   ANTHROPIC_API_KEY=
   PORT=3001
   CORS_ORIGIN=http://localhost:3000
   ```
9. Criar `src/utils/db.ts` com pool de conexão PostgreSQL usando `pg.Pool`
10. Testar que o servidor sobe com `npm run dev` sem erros

**Resultado esperado:** Servidor Express respondendo em `http://localhost:3001` com status 200 na rota raiz.

---

### TAREFA 1.2 — Banco de Dados (Schema Completo)
**Status:** `[BLOQUEANTE]` para TAREFA 1.3, 1.4, 1.5, 1.6  
**Depende de:** Supabase/PostgreSQL configurado com URL de conexão  
**Pode rodar em paralelo com:** TAREFA 1.1 (se banco já estiver disponível)

**O que fazer:**

1. Criar arquivo `database/schema.sql` com:

**Tabela `users`:**
```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  plano             VARCHAR(20) NOT NULL DEFAULT 'free',
  documentos_usados INTEGER NOT NULL DEFAULT 0,
  limite_documentos INTEGER NOT NULL DEFAULT 1,
  data_reset        TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);
```

**Tabela `company`:**
```sql
CREATE TABLE company (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  nome     VARCHAR(255) NOT NULL,
  cnpj     VARCHAR(18) UNIQUE NOT NULL,
  endereco TEXT
);
```

**Tabela `clients`:**
```sql
CREATE TABLE clients (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  nome      VARCHAR(255) NOT NULL,
  cpf_cnpj  VARCHAR(18),
  endereco  TEXT,
  cep       VARCHAR(9)
);
```

**Tabela `documents`:**
```sql
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  tipo         VARCHAR(50) NOT NULL,
  cliente_id   UUID REFERENCES clients(id),
  cliente_nome VARCHAR(255),
  dados_json   JSONB,
  content      TEXT,
  modelo_usado VARCHAR(50),
  status       VARCHAR(20) DEFAULT 'draft',
  created_at   TIMESTAMP DEFAULT NOW()
);
```

2. Criar índices:
```sql
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_company_user_id ON company(user_id);
```

3. Criar função + trigger de reset mensal PRO:
```sql
CREATE OR REPLACE FUNCTION reset_documentos_pro()
RETURNS void AS $$
BEGIN
  UPDATE users
  SET documentos_usados = 0, data_reset = NOW() + INTERVAL '1 month'
  WHERE plano = 'pro' AND data_reset <= NOW();
END;
$$ LANGUAGE plpgsql;
```

4. Criar script `database/seed.sql` com usuário de teste:
   - email: `admin@teste.com`, senha: `123456` (hash bcrypt rodado manualmente)
   - plano: `free`

5. Documentar no README como executar o schema no Supabase

**Resultado esperado:** Banco com 4 tabelas criadas, índices e trigger configurados.

---

### TAREFA 1.3 — Sistema de Autenticação (Login e Registro)
**Status:** `[BLOQUEANTE]` para TAREFA 1.4, 1.5, 1.6  
**Depende de:** TAREFA 1.1 (API setup), TAREFA 1.2 (Banco criado)

**O que fazer:**

1. Criar `src/utils/jwt.ts`:
   - Função `signToken(userId: string): string` — gera JWT com 7d de validade
   - Função `verifyToken(token: string): { userId: string }` — verifica e decodifica

2. Criar `src/middleware/auth.ts`:
   - Extrai o token do header `Authorization: Bearer <token>`
   - Verifica com `verifyToken`
   - Injeta `req.userId` na request
   - Retorna 401 se token inválido ou ausente

3. Criar `src/controllers/authController.ts`:

**POST /auth/register:**
- Validar body com Zod: `{ email: string, password: string }`
- Verificar se email já existe no banco
- Hash da senha com bcrypt (12 rounds)
- Inserir usuário com plano `free`, limite `1`
- Retornar JWT + dados do usuário (sem password_hash)

**POST /auth/login:**
- Validar body com Zod: `{ email: string, password: string }`
- Buscar usuário por email
- Comparar senha com bcrypt
- Retornar JWT + dados do usuário (sem password_hash)
- Retornar 401 se credenciais inválidas

4. Criar `src/routes/auth.ts` e registrar no `app.ts`

5. Testar com curl:
```bash
# Registro
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@email.com","password":"123456"}'

# Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@email.com","password":"123456"}'
```

**Resultado esperado:** Endpoints retornando JWT válido. Middleware bloqueando rotas sem token.

---

### TAREFA 1.4 — CRUD de Empresa e Clientes
**Status:** `[PARALELA]` com TAREFA 1.5 após dependências resolverem  
**Depende de:** TAREFA 1.1, TAREFA 1.2, TAREFA 1.3

**O que fazer:**

#### Empresa (`/company`):

1. Criar `src/controllers/companyController.ts`:

**GET /company:**
- Buscar empresa pelo `user_id` do token
- Retornar dados ou `null` se não cadastrada

**POST /company:**
- Validar body com Zod: `{ nome, cnpj, endereco }`
- Verificar se usuário já tem empresa (1 por conta)
- Validar formato CNPJ (14 dígitos, aceitar com/sem máscara)
- Inserir e retornar empresa criada

**PUT /company:**
- Validar body com Zod (campos opcionais)
- Atualizar apenas campos enviados
- Retornar empresa atualizada

2. Criar `src/routes/company.ts` com middleware de auth em todas as rotas

#### Clientes (`/clients`):

3. Criar `src/controllers/clientsController.ts`:

**GET /clients:**
- Listar todos os clientes do `user_id`
- Suportar query param `?search=nome` para filtro por nome

**POST /clients:**
- Validar body com Zod: `{ nome, cpf_cnpj?, endereco?, cep? }`
- Inserir cliente vinculado ao `user_id`

**PUT /clients/:id:**
- Verificar que o cliente pertence ao `user_id`
- Atualizar campos enviados
- Retornar 404 se não encontrado ou não pertencer ao usuário

**DELETE /clients/:id:**
- Verificar propriedade do cliente
- Soft delete OU exclusão real (escolher e manter consistente)
- Retornar 204

4. Criar `src/routes/clients.ts` com middleware de auth

**Resultado esperado:** CRUD completo funcionando com autenticação. Usuário não vê dados de outros usuários.

---

### TAREFA 1.5 — Prompts de IA e Geração de Documentos
**Status:** `[BLOQUEANTE]` para TAREFA 1.6  
**Depende de:** TAREFA 1.1, TAREFA 1.2, TAREFA 1.3

**O que fazer:**

1. Criar `src/prompts/documentPrompts.ts` com a função:
```typescript
export function getPrompt(type: string, company: Company, client: Client, fields: Record<string, any>): string
```

Cada prompt deve:
- Usar linguagem jurídica formal e profissional
- Gerar documento completo, sem abreviações ou resumos
- Incluir TODAS as cláusulas especificadas no PROJECT.md para aquele tipo
- Injetar dados de empresa, cliente e campos no texto do prompt

**Prompt: `contratoSolar`**
- Sistema: kit solar fotovoltaico completo, instalação e comissionamento
- Incluir: potência, módulos (qtd + marca), inversor (tipo + marca)
- Garantias separadas: módulos, inversor, instalação
- Prazos: projeto, aprovação da concessionária, instalação
- Cláusula de variação de geração (até 10% aceitável)
- Cláusula de dependência da concessionária (prazo não inclui burocracia)
- Obrigações do cliente: acesso, estrutura do telhado, padrão elétrico
- Rescisão com multa de 20% sobre valor total
- Foro da comarca informada

**Prompt: `prestacaoServico`**
- Objeto: serviço específico descrito pelo campo
- Valor e parcelamento
- Responsável técnico (ART/RRT)
- Normas ABNT e NR-10/NR-35
- Cláusula de ausência de vínculo trabalhista

**Prompt: `procuracao`**
- Outorgante com dados completos (nome, CPF, endereço, CEP)
- UC e concessionária
- Poderes: assinar solicitações, retirar documentos, assinar contrato de financiamento
- Lista os procuradores pelo nome
- Fecho formal com local, data e espaço para assinatura

**Prompt: `contratoPJ`**
- Comissão percentual sobre valor do contrato fechado
- Pagamento após recebimento da empresa
- Cancelamento: sem comissão se cliente cancelar
- Bônus: valor em R$ ao atingir meta
- Ausência absoluta de vínculo empregatício

**Prompt: `propostaBanco`**
- Cabeçalho: "PROPOSTA TÉCNICA E COMERCIAL PARA FINANCIAMENTO BANCÁRIO"
- Dados completos do cliente (CPF, RG se houver, endereço, CEP)
- Dados do banco (nome, agência, conta)
- Concessionária de energia
- Descrição técnica completa do sistema
- Tabela de equipamentos com quantidade e valor unitário
- Valor dos equipamentos = 70% do total
- Mão de obra = 30% do total
- Validade da proposta em dias
- Rodapé: "Este documento é destinado exclusivamente à análise de crédito junto à instituição financeira acima identificada."

2. Criar `src/services/aiService.ts`:
```typescript
async function generateDocumentWithAI(
  type: string,
  company: Company,
  client: Client,
  fields: Record<string, any>
): Promise<string>
```
- Montar o prompt com `getPrompt()`
- Tentar OpenAI primeiro (se `OPENAI_API_KEY` definida)
- Fallback para Anthropic (se `ANTHROPIC_API_KEY` definida)
- Lançar erro descritivo se nenhuma chave configurada
- Temperatura: 0.3 (documentos consistentes)
- Max tokens: 4000

3. Criar `src/controllers/documentsController.ts`:

**POST /documents/generate:**
- Verificar limite de plano com `planService.checkLimit(userId)`
- Buscar dados da empresa do usuário
- Buscar dados do cliente pelo `cliente_id`
- Chamar `generateDocumentWithAI()`
- Retornar o texto gerado (não salva ainda)
- Incrementar `documentos_usados` após sucesso

**POST /documents/save:**
- Receber content + metadados
- Inserir na tabela `documents`
- Retornar documento salvo

**GET /documents/list:**
- Listar documentos do `user_id`
- Ordenar por `created_at DESC`
- Suportar filtro por tipo: `?tipo=contratoSolar`

4. Criar `src/services/planService.ts`:
```typescript
async function checkLimit(userId: string): Promise<void>
// lança erro 403 se limite atingido

async function incrementUsed(userId: string): Promise<void>
// incrementa documentos_usados

async function runMonthlyReset(): Promise<void>
// reseta usuários PRO com data_reset vencida
```

5. Criar `src/routes/documents.ts` e `src/routes/ai.ts`

6. Registrar todas as rotas no `app.ts`

**Resultado esperado:** Endpoint `/documents/generate` retornando documento completo em texto.

---

### TAREFA 1.6 — Segurança e Rate Limiting
**Status:** `[PARALELA]`  
**Depende de:** TAREFA 1.1, TAREFA 1.3

**O que fazer:**

1. Criar `src/middleware/rateLimiter.ts` usando `express-rate-limit`:
   - Limite global: 100 req/15min por IP
   - Limite específico IA: 10 req/min por IP

2. Aplicar no `app.ts`:
   - Rate limit global em todas as rotas
   - Rate limit de IA apenas nas rotas `/documents/generate` e `/ai/generate`

3. Configurar CORS no `app.ts`:
   - Aceitar apenas a origem definida em `CORS_ORIGIN`
   - Em produção: domínio do dashboard

4. Adicionar validação Zod em todos os controllers que ainda não têm

5. Garantir que nenhum endpoint retorna `password_hash` ou dados sensíveis

6. Criar helper `src/utils/apiError.ts`:
```typescript
class ApiError extends Error {
  constructor(public statusCode: number, message: string) { ... }
}
```

7. Criar middleware global de tratamento de erros em `app.ts`:
   - Captura `ApiError` e retorna o status correto
   - Captura erros genéricos e retorna 500
   - Nunca expõe stack trace em produção

**Resultado esperado:** API com rate limiting, CORS correto, erros tratados uniformemente.

---

## MÓDULO 2: DASHBOARD

---

### TAREFA 2.1 — Setup do Projeto Next.js (Dashboard)
**Status:** `[BLOQUEANTE]` para todas as tarefas do Dashboard  
**Depende de:** Nada (pode rodar em paralelo com módulo API)  
**Pode rodar em paralelo com:** TAREFA 1.1

**O que fazer:**

1. Criar pasta `dashboard/` na raiz
2. Inicializar Next.js 14 com App Router:
   ```
   npx create-next-app@latest dashboard --typescript --tailwind false --eslint --app --src-dir --import-alias "@/*" --no-git
   ```
   > IMPORTANTE: NÃO usar Tailwind. Usar CSS Modules.

3. Instalar dependências adicionais:
   ```
   npm install axios js-cookie
   npm install -D @types/js-cookie
   ```

4. Criar sistema de design em `src/styles/`:
   - `globals.css`: variáveis CSS, reset, tipografia (importar Inter do Google Fonts)
   - Paleta de cores:
     - Primary: `#F59E0B` (âmbar solar)
     - Background dark: `#0F172A`
     - Surface: `#1E293B`
     - Border: `#334155`
     - Text primary: `#F1F5F9`
     - Text muted: `#94A3B8`
     - Success: `#10B981`
     - Error: `#EF4444`

5. Criar `src/services/api.ts`:
   - Instância do axios com `baseURL: process.env.NEXT_PUBLIC_API_URL`
   - Interceptor de request: adiciona `Authorization: Bearer <token>` automaticamente
   - Interceptor de response: redireciona para `/login` se 401

6. Criar `src/services/auth.ts`:
   - `getToken()`: lê cookie `solardoc_token`
   - `setToken(token)`: salva no cookie com 7 dias
   - `removeToken()`: remove cookie
   - `isAuthenticated()`: verifica se token existe

7. Criar `.env.local.example`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

**Resultado esperado:** Projeto Next.js rodando em `http://localhost:3000` com design system configurado.

---

### TAREFA 2.2 — Telas de Login e Cadastro
**Status:** `[PARALELA]`  
**Depende de:** TAREFA 2.1  
**Pode rodar em paralelo com:** TAREFA 2.3, 2.4 (se 2.1 concluída)

**O que fazer:**

1. Criar `src/app/(auth)/layout.tsx`:
   - Layout centralizado, fundo gradiente escuro
   - Logo "SolarDoc Pro" com ícone solar
   - Sem sidebar

2. Criar `src/app/(auth)/login/page.tsx`:
   - Campos: email, senha
   - Botão "Entrar" com loading spinner durante requisição
   - Link "Criar conta"
   - Ao sucesso: salvar token + redirecionar para `/empresa`
   - Mensagem de erro em vermelho se credenciais inválidas

3. Criar `src/app/(auth)/register/page.tsx`:
   - Campos: email, senha, confirmar senha
   - Validação client-side (senhas iguais, email válido)
   - Botão "Criar conta" com loading
   - Link "Já tenho conta"
   - Ao sucesso: salvar token + redirecionar para `/empresa`

4. Criar CSS Module para cada tela:
   - Card centralizado com sombra
   - Inputs com estilo dark
   - Botão primário âmbar com hover effect
   - Animação de fade-in do card

5. Criar `src/middleware.ts` do Next.js:
   - Redirecionar `/` para `/login` se não autenticado
   - Redirecionar `/login` para `/empresa` se já autenticado

**Resultado esperado:** Fluxo de login e cadastro funcionando com chamadas reais à API.

---

### TAREFA 2.3 — Layout do Dashboard com Sidebar
**Status:** `[BLOQUEANTE]` para TAREFA 2.4, 2.5, 2.6  
**Depende de:** TAREFA 2.1

**O que fazer:**

1. Criar `src/app/(dashboard)/layout.tsx`:
   - Layout com sidebar fixa à esquerda (260px)
   - Área de conteúdo à direita com scroll
   - Verificar autenticação: se sem token, redirecionar para `/login`
   - Buscar dados do usuário (plano, documentos_usados, limite)

2. Criar `src/components/Sidebar/Sidebar.tsx` + `Sidebar.module.css`:

   **Seções:**
   - Logo "SolarDoc Pro" no topo
   - Navegação principal:
     - 🏢 Empresa
     - 👥 Clientes
   - Seção "Documentos":
     - ☀️ Contrato Solar
     - 🔧 Prestação de Serviço
     - 📜 Procuração
     - 🤝 Contrato PJ
     - 🏦 Proposta Bancária
   - Rodapé:
     - Badge do plano atual (FREE / PRO / ILIMITADO)
     - Barra de progresso: documentos usados / limite
     - Botão "Upgrade" (se não for ilimitado)
     - Botão "Sair"

3. Criar `src/components/PlanBadge/PlanBadge.tsx`:
   - Cores: FREE = cinza, PRO = âmbar, ILIMITADO = verde
   - Exibir limite restante

4. Criar `src/components/UpgradeModal/UpgradeModal.tsx`:
   - Modal disparado quando limite atingido
   - Exibir planos PRO (R$27) e ILIMITADO (R$97)
   - Botão "Falar no WhatsApp" como CTA provisório

**Resultado esperado:** Sidebar funcionando com navegação entre rotas e informações de plano corretas.

---

### TAREFA 2.4 — Tela de Feedbacks / Clientes
**Status:** `[PARALELA]`  
**Depende de:** TAREFA 2.1, TAREFA 2.3

**O que fazer:**

> Esta tarefa cobre as telas de Clientes e Empresa.

#### Tela de Empresa (`/empresa`):

1. Criar `src/app/(dashboard)/empresa/page.tsx`:
   - Buscar empresa existente via GET `/company`
   - Se não existir: mostrar formulário de cadastro
   - Se existir: mostrar dados + botão "Editar"
   - Campos: Nome da empresa, CNPJ (com máscara), Endereço
   - Salvar via POST ou PUT dependendo do estado
   - Feedback visual de sucesso

2. Criar CSS Module com card de formulário estilizado

#### Tela de Clientes (`/clientes`):

3. Criar `src/app/(dashboard)/clientes/page.tsx`:
   - Listar todos os clientes em tabela (nome, CPF/CNPJ, endereço)
   - Campo de busca por nome (filtra na API via `?search=`)
   - Botão "Novo Cliente" abre modal/drawer lateral
   - Botão de editar e excluir em cada linha
   - Confirmação antes de excluir

4. Criar `src/components/ClientModal/ClientModal.tsx`:
   - Formulário: nome, CPF/CNPJ, endereço, CEP (com máscara)
   - Modo criação e edição (reaproveitar componente)
   - Botões: Salvar / Cancelar

**Resultado esperado:** Gestão completa de empresa e clientes funcionando com persistência real.

---

### TAREFA 2.5 — Telas de Geração de Documentos
**Status:** `[PARALELA]`  
**Depende de:** TAREFA 2.1, TAREFA 2.3

**O que fazer:**

1. Criar componente compartilhado `src/components/DocumentForm/DocumentForm.tsx`:
   - Props: `tipo`, campos específicos, `onGenerate`, `onClientSelect`
   - Renderiza seletor de cliente + campos dinâmicos por tipo
   - Botão "Gerar com IA" com estado de loading
   - Desabilitar se empresa ainda não cadastrada (com aviso)

2. Criar `src/components/ClientSelector/ClientSelector.tsx`:
   - Dropdown com busca em tempo real
   - Lista os clientes do usuário
   - Ao selecionar: exibir nome e dados do cliente

3. Criar 5 páginas de documento (uma por tipo):

   **`/documentos/contrato-solar`** — campos:
   - potência (kWp), qtd módulos, marca módulos
   - tipo inversor, marca inversor, valor total
   - prazo projeto, prazo aprovação, prazo instalação
   - garantia módulos, garantia inversor, garantia instalação
   - endereço instalação, foro (cidade)

   **`/documentos/prestacao-servico`** — campos:
   - descrição do serviço, valor
   - prazo execução (dias), responsável técnico
   - endereço instalação, foro

   **`/documentos/procuracao`** — campos:
   - UC, concessionária, nomes dos procuradores
   - banco (opcional), agência, finalidade

   **`/documentos/contrato-pj`** — campos:
   - objeto do contrato, comissão (%)
   - meta de bônus (R$), valor do bônus (R$), foro

   **`/documentos/proposta-bancaria`** — campos:
   - banco, agência, conta, concessionária
   - descrição do sistema
   - equipamentos (lista dinâmica: item + qtd + valor)
   - valor total, validade (dias)

4. Criar `src/components/DocumentPreview/DocumentPreview.tsx`:
   - Recebe o `content` (texto do documento)
   - Renderização com fundo branco, fonte serif profissional
   - Margem de 3cm (simulando papel A4)
   - Título do documento centralizado em negrito
   - Parágrafo com espaçamento adequado (line-height 1.8)
   - `@media print`: ocultar sidebar e botões, mostrar apenas o documento
   - Botões no rodapé: **Salvar** | **Imprimir** | **Nova geração**

5. Implementar o fluxo completo em cada página:
   ```
   idle → (clicar gerar) → generando → (API retorna) → preview → (salvar) → saved
   ```
   - Estado de erro exibido em modal vermelho
   - Verificar limite ANTES de chamar API (buscar dados do usuário)
   - Exibir UpgradeModal se limite atingido

**Resultado esperado:** Todas as 5 telas de documentos funcionando com geração real via IA e preview imprimível.

---

### TAREFA 2.6 — Integração Final com a API
**Status:** Refinamento final  
**Depende de:** TAREFA 2.2, 2.3, 2.4, 2.5 + Módulo 1 completo

**O que fazer:**

1. Completar `src/services/api.ts` com todas as funções:
```typescript
// Auth
auth.register(email, password)
auth.login(email, password)

// Company
company.get()
company.create(data)
company.update(data)

// Clients
clients.list(search?)
clients.create(data)
clients.update(id, data)
clients.delete(id)

// Documents
documents.generate(tipo, clienteId, fields)
documents.save(data)
documents.list(tipo?)
```

2. Garantir que o interceptor de 401 está redirecionando para login

3. Testar fluxo completo de ponta a ponta:
   - Criar conta → cadastrar empresa → cadastrar cliente → gerar documento → visualizar preview → salvar → listar documentos

4. Verificar que o preview de impressão está correto no browser (Ctrl+P)

5. Validações client-side em todos os formulários antes de enviar para API

**Resultado esperado:** SaaS completamente funcional de ponta a ponta.

---

## MÓDULO 3: LANDING PAGE

---

### TAREFA 3.1 — Landing Page Completa
**Status:** `[PARALELA]`  
**Depende de:** Nada (conteúdo estático)  
**Pode rodar em paralelo com:** Qualquer outra tarefa

**O que fazer:**

1. Criar pasta `landing/` e inicializar Next.js:
   ```
   npx create-next-app@latest landing --typescript --tailwind false --eslint --app --src-dir --import-alias "@/*" --no-git
   ```

2. Criar `src/app/layout.tsx`:
   - Meta title: "SolarDoc Pro — Documentação Solar com IA"
   - Meta description: descrição do produto
   - Importar Inter e fonte serif para contraste

3. Criar `src/app/page.tsx` com as seguintes seções:

   **Hero Section:**
   - Headline forte: "Gere contratos solares profissionais em segundos com IA"
   - Subheadline: benefícios em 1 frase
   - CTA principal: "Começar Grátis" → `/register` do dashboard
   - Badge: "Sem cartão de crédito"
   - Mockup do dashboard ao lado direito

   **Features Section:**
   - 6 cards de benefícios:
     - ☀️ Contrato Solar Completo
     - 📜 Procuração Automática
     - 🏦 Proposta Bancária
     - 🤝 Contrato PJ
     - 🔧 Prestação de Serviço
     - ⚡ Geração em segundos

   **Pricing Section:**
   - 3 cards lado a lado:
     - FREE: R$0, 1 documento, CTA "Começar Grátis"
     - PRO: R$27/mês, 30 docs/mês, CTA "Assinar PRO" (destaque)
     - ILIMITADO: R$97/mês, sem limite, CTA "Assinar Ilimitado"
   - Destaque visual no plano PRO

   **Footer:**
   - Logo + tagline
   - Links: Sobre, Contato, Privacidade, Termos

4. Estilização:
   - Fundo escuro `#0F172A`, hero com gradiente âmbar
   - Animações de entrada com CSS (fade-up nos cards)
   - Responsivo (mobile-first)

**Resultado esperado:** Landing page publicável com design profissional.

---

## MÓDULO 4: WIDGET EMBED

---

### TAREFA 4.1 — Widget JavaScript Embeddable
**Status:** `[PARALELA]`  
**Depende de:** TAREFA 1.3 (endpoint de auth da API em funcionamento)  
**Pode rodar em paralelo com:** Módulo 2 e 3

**O que fazer:**

1. Criar pasta `widget/` com estrutura:
   ```
   widget/
   ├── src/widget.js
   ├── package.json
   └── README.md
   ```

2. Criar `src/widget.js` — script autônomo sem dependências externas:

   **Comportamento:**
   - Quando incluído em qualquer site, injeta um botão flutuante no canto inferior direito
   - Ao clicar, abre um popup estilizado com formulário de captura de lead
   - Campos: Nome, Telefone, Interesse (selecionar tipo de documento)
   - Botão "Solicitar documento"

   **Comunicação:**
   - POST para `SOLARDOC_API_URL/leads` (endpoint público)
   - Exibir mensagem de sucesso após envio

   **Configuração via atributo data:**
   ```html
   <script
     src="https://cdn.solardoc.pro/widget.js"
     data-api-url="https://api.solardoc.pro"
     data-empresa-id="SEU_ID"
   ></script>
   ```

3. Implementar:
   - Injeção de estilos inline (sem CSS externo)
   - Popup com animação suave de slide-up
   - Botão de fechar o popup
   - Mensagem de sucesso após envio
   - Modo responsivo (mobile e desktop)

4. Criar `package.json` com script de build:
   - `npm run build`: minifica o widget.js com esbuild
   - `npm run dev`: serve o widget local para teste

5. Criar `README.md` com instruções de uso:
   ```html
   <!-- Como usar -->
   <script src="widget.js" data-api-url="http://localhost:3001" data-empresa-id="id-aqui"></script>
   ```

**Resultado esperado:** Script que pode ser colado em qualquer HTML e funciona de forma autônoma.

---

## MAPA DE DEPENDÊNCIAS

```
TAREFA 1.1 (API setup)
    └─► TAREFA 1.3 (Auth)
            └─► TAREFA 1.4 (CRUD)
            └─► TAREFA 1.5 (IA + Docs)
                    └─► TAREFA 1.6 (Segurança)

TAREFA 1.2 (Banco)
    └─► TAREFA 1.3 (Auth)

TAREFA 2.1 (Dashboard setup)
    └─► TAREFA 2.2 (Login/Register)
    └─► TAREFA 2.3 (Sidebar/Layout)
            └─► TAREFA 2.4 (Clientes/Empresa)
            └─► TAREFA 2.5 (Documentos)
                    └─► TAREFA 2.6 (Integração final)

TAREFA 3.1 (Landing) — independente
TAREFA 4.1 (Widget) — depende apenas de TAREFA 1.3
```

---

## ORDEM DE EXECUÇÃO RECOMENDADA

### Fase 1 (Fundação)
| Prioridade | Tarefa                    |
|------------|---------------------------|
| 1ª         | TAREFA 1.2 — Banco        |
| 2ª         | TAREFA 1.1 — API Setup    |
| 3ª         | TAREFA 1.3 — Auth         |

### Fase 2 (Core)
| Prioridade | Tarefa                           |
|------------|----------------------------------|
| 4ª         | TAREFA 1.4 — CRUD                |
| 4ª (par.)  | TAREFA 2.1 — Dashboard Setup     |
| 5ª         | TAREFA 1.5 — IA + Documentos     |
| 5ª (par.)  | TAREFA 2.2 — Login Pages         |

### Fase 3 (Interface)
| Prioridade | Tarefa                           |
|------------|----------------------------------|
| 6ª         | TAREFA 2.3 — Sidebar             |
| 7ª         | TAREFA 2.4 — Clientes/Empresa    |
| 7ª (par.)  | TAREFA 1.6 — Segurança           |
| 8ª         | TAREFA 2.5 — Telas de Documento  |

### Fase 4 (Finalização)
| Prioridade | Tarefa                           |
|------------|----------------------------------|
| 9ª         | TAREFA 2.6 — Integração final    |
| 9ª (par.)  | TAREFA 3.1 — Landing             |
| 9ª (par.)  | TAREFA 4.1 — Widget              |

---

## CRITÉRIOS DE CONCLUSÃO GERAL

- [ ] Usuário consegue se registrar e logar
- [ ] Empresa cadastrada e editável
- [ ] Clientes listados, criados, editados e excluídos
- [ ] Todos os 5 tipos de documento gerando via IA
- [ ] Preview do documento está imprimível (Ctrl+P)
- [ ] Limite FREE (1 doc) bloqueia geração corretamente
- [ ] Plano PRO reseta mensalmente
- [ ] Widget pode ser incorporado em página externa e enviar lead
- [ ] Landing page publicada com pricing correto
- [ ] Nenhuma chave de API exposta no frontend
