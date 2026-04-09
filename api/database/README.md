# Database Setup

## Supabase
1. Acesse o SQL Editor no painel do Supabase
2. Cole e execute o conteúdo de `schema.sql`
3. Para dados de teste, execute `seed.sql` (atualize o hash da senha primeiro)

## Gerar hash da senha de teste
```bash
cd api
node -e "const b=require('bcryptjs'); b.hash('123456',12).then(h=>console.log(h))"
```
Cole o hash gerado no seed.sql antes de executar.
