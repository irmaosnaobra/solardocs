-- Usuário de teste (senha: 123456, hash bcrypt 12 rounds)
-- Para gerar o hash: node -e "const b=require('bcryptjs'); b.hash('123456',12).then(h=>console.log(h))"
-- Substitua o hash abaixo pelo gerado
INSERT INTO users (email, password_hash, plano, limite_documentos)
VALUES ('admin@teste.com', '$2a$12$PLACEHOLDER_HASH_RUN_SEED_SCRIPT', 'free', 1)
ON CONFLICT (email) DO NOTHING;
