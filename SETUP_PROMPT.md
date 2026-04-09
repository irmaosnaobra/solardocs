# SETUP_PROMPT — SolarDoc Pro
# Cole esse prompt no Claude Code para configurar e subir o projeto

---

## PROMPT PARA O CLAUDE CODE

```
Você vai configurar e iniciar o projeto SolarDoc Pro que já está montado em C:\Users\55349\Desktop\CLAUDE.

Execute as etapas abaixo em ordem. Não pule nenhuma. Confirme o resultado de cada etapa antes de continuar.

---

ETAPA 1 — Criar o arquivo .env na pasta api/

Crie o arquivo C:\Users\55349\Desktop\CLAUDE\api\.env com o seguinte conteúdo:

DATABASE_URL=SUBSTITUIR_PELA_CONNECTION_STRING_DO_SUPABASE
JWT_SECRET=solardoc_jwt_secret_2024_producao
OPENAI_API_KEY=SUBSTITUIR_PELA_CHAVE_OPENAI
ANTHROPIC_API_KEY=SUBSTITUIR_PELA_CHAVE_ANTHROPIC
PORT=3001
CORS_ORIGIN=http://localhost:3000

Atenção: substitua os valores acima pelas credenciais reais antes de continuar.

---

ETAPA 2 — Verificar se o .env foi criado corretamente

Execute: cat C:\Users\55349\Desktop\CLAUDE\api\.env
Confirme que o arquivo existe e tem as 6 variáveis.

---

ETAPA 3 — Exibir o conteúdo do schema.sql para o usuário copiar no Supabase

Execute: cat C:\Users\55349\Desktop\CLAUDE\api\database\schema.sql
Exiba o SQL completo e instrua o usuário a:
1. Acessar https://supabase.com/dashboard
2. Abrir o projeto
3. Ir em "SQL Editor"
4. Colar e executar o SQL exibido
5. Confirmar que as 4 tabelas foram criadas: users, company, clients, documents

Aguarde confirmação do usuário antes de continuar.

---

ETAPA 4 — Verificar dependências da API

Entre na pasta: cd C:\Users\55349\Desktop\CLAUDE\api
Verifique se node_modules existe. Se não existir, execute: npm install
Se existir, pule esse passo.

---

ETAPA 5 — Verificar dependências do Dashboard

Entre na pasta: cd C:\Users\55349\Desktop\CLAUDE\dashboard
Verifique se node_modules existe. Se não existir, execute: npm install
Se existir, pule esse passo.

---

ETAPA 6 — Iniciar a API

Abra um terminal e execute:
cd C:\Users\55349\Desktop\CLAUDE\api && npm run dev

Aguarde a mensagem: "Server running on port 3001"
Confirme que a API está respondendo: curl http://localhost:3001/health

---

ETAPA 7 — Iniciar o Dashboard

Abra outro terminal e execute:
cd C:\Users\55349\Desktop\CLAUDE\dashboard && npm run dev

Aguarde a mensagem: "Ready on http://localhost:3000"

---

ETAPA 8 — Confirmar que tudo está funcionando

Verifique:
- API: http://localhost:3001 está respondendo
- Dashboard: http://localhost:3000 está abrindo no navegador

Se algum erro aparecer, mostre o log completo do erro para diagnóstico.

---

RESULTADO ESPERADO:
- API rodando em http://localhost:3001
- Dashboard rodando em http://localhost:3000
- Banco com 4 tabelas criadas no Supabase
- Sistema pronto para uso
```

---

## SCHEMA SQL (para colar no Supabase)

Acesse: https://supabase.com/dashboard → seu projeto → SQL Editor → New Query

Cole e execute o SQL abaixo:

```sql
-- Tabela users
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  plano             VARCHAR(20) NOT NULL DEFAULT 'free',
  documentos_usados INTEGER NOT NULL DEFAULT 0,
  limite_documentos INTEGER NOT NULL DEFAULT 1,
  data_reset        TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Tabela company
CREATE TABLE IF NOT EXISTS company (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  nome     VARCHAR(255) NOT NULL,
  cnpj     VARCHAR(18) UNIQUE NOT NULL,
  endereco TEXT
);

-- Tabela clients
CREATE TABLE IF NOT EXISTS clients (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  nome      VARCHAR(255) NOT NULL,
  cpf_cnpj  VARCHAR(18),
  endereco  TEXT,
  cep       VARCHAR(9)
);

-- Tabela documents
CREATE TABLE IF NOT EXISTS documents (
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

-- Índices
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_company_user_id ON company(user_id);

-- Função de reset mensal PRO
CREATE OR REPLACE FUNCTION reset_documentos_pro()
RETURNS void AS $$
BEGIN
  UPDATE users
  SET documentos_usados = 0, data_reset = NOW() + INTERVAL '1 month'
  WHERE plano = 'pro' AND data_reset <= NOW();
END;
$$ LANGUAGE plpgsql;
```

---

## CHECKLIST FINAL

- [ ] Arquivo `api/.env` criado com DATABASE_URL real
- [ ] Schema SQL executado no Supabase (4 tabelas criadas)
- [ ] API rodando em `http://localhost:3001`
- [ ] Dashboard rodando em `http://localhost:3000`
- [ ] Login/cadastro funcionando
- [ ] Widget: `widget/dist/widget.min.js` disponível para embed
