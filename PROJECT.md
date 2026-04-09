# SolarDoc Pro — Arquitetura do Projeto

## Visão Geral

SolarDoc Pro é um SaaS B2B voltado para empresas de energia solar. A plataforma permite cadastrar empresa, gerenciar clientes e gerar documentos profissionais (contratos, procurações, propostas) com inteligência artificial.

---

## Stack Tecnológico

| Camada        | Tecnologia                          |
|---------------|-------------------------------------|
| Backend API   | Node.js + Express + TypeScript      |
| Frontend      | Next.js 14 (App Router)             |
| Banco de Dados| PostgreSQL via Supabase             |
| Autenticação  | JWT (JSON Web Tokens)               |
| IA            | OpenAI GPT-4o ou Anthropic Claude   |
| Estilização   | CSS Modules + design system próprio |

---

## Arquitetura (4 Partes Independentes)

```
solardoc-pro/
├── api/          → Backend Express (porta 3001)
├── dashboard/    → Painel do usuário Next.js (porta 3000)
├── landing/      → Site público Next.js (porta 3002)
└── widget/       → Script JS embed (CDN)
```

Cada parte funciona de forma **independente** e se comunica via HTTP/REST.

---

## Comunicação entre Partes

```
Dashboard  ──REST──►  API  ──SQL──►  Supabase/PostgreSQL
Widget     ──REST──►  API  ──AI──►   OpenAI / Claude
Landing    (estático, sem API direta)
```

---

## Banco de Dados

### Tabela: users
```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
email          VARCHAR(255) UNIQUE NOT NULL
password_hash  TEXT NOT NULL
plano          VARCHAR(20) DEFAULT 'free'  -- free | pro | ilimitado
documentos_usados  INTEGER DEFAULT 0
limite_documentos  INTEGER DEFAULT 1
data_reset     TIMESTAMP
created_at     TIMESTAMP DEFAULT NOW()
```

### Tabela: company
```sql
id        UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id   UUID REFERENCES users(id) ON DELETE CASCADE
nome      VARCHAR(255) NOT NULL
cnpj      VARCHAR(18) UNIQUE NOT NULL
endereco  TEXT
```

### Tabela: clients
```sql
id         UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id    UUID REFERENCES users(id) ON DELETE CASCADE
nome       VARCHAR(255) NOT NULL
cpf_cnpj   VARCHAR(18)
endereco   TEXT
cep        VARCHAR(9)
```

### Tabela: documents
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id       UUID REFERENCES users(id) ON DELETE CASCADE
tipo          VARCHAR(50) NOT NULL
cliente_id    UUID REFERENCES clients(id)
cliente_nome  VARCHAR(255)
dados_json    JSONB
content       TEXT
modelo_usado  VARCHAR(50)
status        VARCHAR(20) DEFAULT 'draft'
created_at    TIMESTAMP DEFAULT NOW()
```

---

## Sistema de Planos

| Plano       | Preço  | Documentos        | Reset       |
|-------------|--------|-------------------|-------------|
| FREE        | R$0    | 1 total           | Nunca       |
| PRO         | R$27   | 30 por mês        | Mensal      |
| ILIMITADO   | R$97   | Sem limite        | —           |

### Regras de negócio:
- Bloquear geração quando atingir o limite
- Exibir modal de upgrade ao bloquear
- Reset automático mensal para o plano PRO (cron job ou trigger)

---

## Rotas da API

### Autenticação
```
POST /auth/register   → Cadastro de novo usuário
POST /auth/login      → Login, retorna JWT
```

### Empresa
```
GET  /company         → Dados da empresa do usuário autenticado
POST /company         → Cadastrar empresa (1 por usuário)
PUT  /company         → Atualizar dados da empresa
```

### Clientes
```
GET    /clients             → Listar clientes do usuário
POST   /clients             → Cadastrar cliente
PUT    /clients/:id         → Atualizar cliente
DELETE /clients/:id         → Remover cliente
```

### Documentos
```
POST /documents/generate    → Gerar documento via IA
POST /documents/save        → Salvar documento gerado
GET  /documents/list        → Listar documentos do usuário
```

### IA
```
POST /ai/generate           → Endpoint direto para geração com IA
```

---

## Tipos de Documento e Campos

### 1. Contrato Solar (`contratoSolar`)
Campos:
- potencia_kwp (potência do sistema em kWp)
- quantidade_modulos
- marca_modulos
- tipo_inversor
- marca_inversor
- valor_total
- prazo_projeto_dias
- prazo_aprovacao_dias
- prazo_instalacao_dias
- garantia_modulos_anos
- garantia_inversor_anos
- garantia_instalacao_anos
- endereco_instalacao
- foro_cidade

Cláusulas obrigatórias:
- Identificação completa das partes
- Objeto detalhado com especificações técnicas
- Garantias separadas por componente
- Prazo por etapa (projeto / aprovação / instalação)
- Variação de geração de até 10%
- Dependência da concessionária
- Obrigações do cliente
- Rescisão e multa
- Foro

### 2. Prestação de Serviço (`prestacaoServico`)
Campos:
- descricao_servico
- valor
- prazo_execucao_dias
- responsavel_tecnico
- endereco_instalacao
- foro_cidade

Cláusulas obrigatórias:
- Contratante e contratado
- Objeto
- Valor e forma de pagamento
- Responsabilidade técnica
- Normas de segurança
- Sem vínculo trabalhista
- Foro

### 3. Procuração (`procuracao`)
Campos:
- uc (unidade consumidora)
- concessionaria
- nomes_procuradores (lista)
- banco (opcional)
- agencia (opcional)
- finalidade (homologação / banco / ambos)

Cláusulas obrigatórias:
- Outorgante completo (nome, CPF, endereço, CEP)
- Poderes para concessionária
- Poderes para banco (se aplicável)
- Homologação e assinatura de contratos
- Linguagem formal e jurídica

### 4. Contrato PJ (`contratoPJ`)
Campos:
- objeto_contrato
- comissao_percentual
- meta_bonus
- valor_bonus
- foro_cidade

Cláusulas obrigatórias:
- Contratante e contratado (PJ)
- Objeto detalhado
- Comissão percentual
- Pagamento após recebimento
- Cancelamento não gera comissão
- Bônus por meta
- Sem vínculo empregatício
- Foro

### 5. Proposta Bancária (`propostaBanco`)
Campos:
- banco
- agencia
- conta
- concessionaria
- descricao_sistema
- lista_equipamentos (array: item + quantidade + valor)
- valor_total
- validade_dias

Cláusulas obrigatórias:
- Cliente completo (CPF/CNPJ, endereço, CEP)
- Dados bancários
- Descrição técnica do sistema
- Lista de equipamentos com valores
- Divisão obrigatória: equipamentos 70% / mão de obra 30%
- Validade da proposta
- Texto: "Documento destinado à análise de crédito junto à instituição financeira"

---

## Estrutura da API (Pastas)

```
api/
├── src/
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── company.ts
│   │   ├── clients.ts
│   │   ├── documents.ts
│   │   └── ai.ts
│   ├── controllers/
│   │   ├── authController.ts
│   │   ├── companyController.ts
│   │   ├── clientsController.ts
│   │   ├── documentsController.ts
│   │   └── aiController.ts
│   ├── services/
│   │   ├── aiService.ts
│   │   ├── documentService.ts
│   │   └── planService.ts
│   ├── prompts/
│   │   └── documentPrompts.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── rateLimiter.ts
│   ├── utils/
│   │   ├── db.ts
│   │   └── jwt.ts
│   └── app.ts
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Estrutura do Dashboard (Pastas)

```
dashboard/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx          ← Sidebar + proteção de rota
│   │   │   ├── empresa/page.tsx
│   │   │   ├── clientes/page.tsx
│   │   │   └── documentos/
│   │   │       ├── contrato-solar/page.tsx
│   │   │       ├── prestacao-servico/page.tsx
│   │   │       ├── procuracao/page.tsx
│   │   │       ├── contrato-pj/page.tsx
│   │   │       └── proposta-bancaria/page.tsx
│   │   └── layout.tsx
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── DocumentPreview.tsx
│   │   ├── DocumentForm.tsx
│   │   ├── ClientSelector.tsx
│   │   └── PlanBadge.tsx
│   └── services/
│       ├── api.ts
│       └── auth.ts
├── .env.local.example
└── package.json
```

---

## Estrutura da Landing Page

```
landing/
├── src/
│   └── app/
│       ├── page.tsx          ← Hero + Features + Pricing + Footer
│       └── layout.tsx
└── package.json
```

---

## Estrutura do Widget Embed

```
widget/
├── src/
│   └── widget.js             ← Script autônomo, sem dependências
└── package.json
```

---

## Fluxo do Usuário no Dashboard

```
1. Login / Cadastro
        ↓
2. Cadastro da empresa (CNPJ)
        ↓
3. Cadastrar clientes
        ↓
4. Selecionar tipo de documento
        ↓
5. Selecionar cliente da lista
        ↓
6. Preencher campos específicos
        ↓
7. Clicar "Gerar com IA"
        ↓
8. Ver preview profissional
        ↓
9. Salvar / Imprimir
```

---

## Segurança

- Senhas com bcrypt (salt rounds: 12)
- JWT com expiração de 7 dias
- Todas as rotas (exceto /auth) protegidas por middleware
- Variáveis sensíveis somente em .env (nunca no código)
- Rate limiting nos endpoints de IA (máx. 10 req/min por IP)
- Validação de input com Zod em todos os endpoints
- CORS configurado para aceitar apenas domínios conhecidos

---

## Variáveis de Ambiente

### API (.env)
```
DATABASE_URL=postgresql://...
JWT_SECRET=seu_segredo_jwt
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
CORS_ORIGIN=http://localhost:3000
```

### Dashboard (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Requisitos Não-Funcionais

- Documentos gerados devem ser completos e utilizáveis sem edição
- Preview deve ser fiel ao documento impresso
- Sistema deve funcionar com OpenAI OU Anthropic (configurável)
- Código deve ser TypeScript em toda a API
- Nenhuma chave de API deve aparecer no frontend
- Limite de plano deve ser verificado no servidor (nunca só no frontend)
