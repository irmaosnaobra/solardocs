# Playbook — Setup Técnico (Fase 2, dias 4–7)

> Pré-requisito: questionário respondido em `Geradores/Gerador-XXXX/01-briefing/questionario-respondido.md`.

## Checklist de 7 dias

### Dia 4 — Provisionamento

- [ ] Criar projeto Vercel a partir do template SolarDoc (fork do `solardocs-dashboard`)
  - Nome: `gerador-{slug-cliente}` (ex: `gerador-solarsenergias`)
  - Time: `team_putrnf5PllrMR72Ayk8y88JP` (Aioros)
- [ ] Criar registro do tenant no Supabase:
  ```sql
  INSERT INTO tenants (slug, nome, dominio, plano, limites)
  VALUES ('solarsenergias', 'Solars Energias', 'propostas.solarsenergias.com.br',
          'enterprise', '{"vendedores": 96, "propostas_mes": 3000}');
  ```
- [ ] Capturar `tenant_id` gerado pra usar nas env vars
- [ ] Configurar env vars no Vercel:
  ```
  NEXT_PUBLIC_TENANT_ID=<uuid>
  NEXT_PUBLIC_TENANT_SLUG=solarsenergias
  NEXT_PUBLIC_SUPABASE_URL=https://qdpfwncyzuztibpujlbq.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<chave>
  SUPABASE_SERVICE_ROLE=<chave admin>
  RESEND_API_KEY=<chave>
  RESEND_FROM=propostas@solarsenergias.com.br
  ```

### Dia 5 — Domínio e DNS

- [ ] Adicionar domínio no projeto Vercel
- [ ] Mandar pro cliente os registros DNS pra aplicar:
  ```
  Tipo: CNAME
  Nome: propostas
  Valor: cname.vercel-dns.com
  TTL: 3600
  ```
- [ ] Verificar propagação (`dig propostas.empresa.com.br`)
- [ ] Confirmar SSL emitido (Vercel faz automático após DNS validar)
- [ ] Adicionar domínio no Resend e verificar (DKIM + SPF + DMARC)
  - Mandar registros DNS adicionais (3 TXT + 1 MX) pro cliente aplicar
- [ ] Testar envio de email do domínio pro Gmail (cair em Primary, não Promotions)

### Dia 6 — Branding inicial

- [ ] Receber assets do cliente (logos, paleta, fonte)
- [ ] Upload de logos no Supabase Storage (bucket público `tenant-assets/{tenant_id}/`)
- [ ] Inserir `tenant_settings.branding` com URLs e cores
- [ ] Build de teste do Vercel — verificar que branding aparece
- [ ] Validar que favicon, OG image, manifest.json também usam branding

### Dia 7 — Catálogo e cálculo

- [ ] Receber planilha de equipamentos do cliente
- [ ] Converter pro formato CSV padrão (`templates/seed-equipamentos.csv`)
- [ ] Importar via SQL (usar `COPY` ou seed script)
- [ ] Validar count: módulos, inversores, kits, mão de obra
- [ ] Receber parâmetros de cálculo (tarifa, inflação, degradação)
- [ ] Inserir em `tenant_settings.calculo`
- [ ] Importar irradiação se ainda não tiver pro estado/cidade dele
- [ ] Smoke test: criar 1 proposta de teste via API → verificar cálculo bate com o esperado

## Saída esperada da fase

Ao final do dia 7:

✅ URL do gerador acessível em `propostas.{cliente}.com.br`
✅ Branding completo aplicado (logo, cores, fonte)
✅ Catálogo de equipamentos importado
✅ Fórmulas de cálculo configuradas
✅ Email saindo do domínio do cliente
✅ Banco com `tenant`, `tenant_settings`, `equipamentos` populados
✅ Smoke test: 1 proposta gerada e visualizada com sucesso

## Riscos comuns nesta fase

- **DNS demora** — cliente esquece de aplicar, ou propagação fora do esperado. Mitigação: mandar registros logo no dia 4, usar TTL baixo.
- **Logo em qualidade ruim** — exigir PNG transparente ≥ 1000px e SVG. Recusar JPG.
- **Planilha de equipamentos bagunçada** — devolver pro cliente pra normalizar antes de importar.
- **Resend DKIM falha** — geralmente é registro errado, copiar/colar exato.
- **Supabase RLS bloqueia operação** — testar com usuário real, não só com service role.

## Comandos úteis

```bash
# Verificar DNS
dig +short propostas.empresa.com.br CNAME

# Testar conexão Supabase
psql "$DATABASE_URL" -c "SELECT 1"

# Deploy Vercel
vercel --prod

# Logs em tempo real
vercel logs --follow

# Listar env vars
vercel env ls
```
