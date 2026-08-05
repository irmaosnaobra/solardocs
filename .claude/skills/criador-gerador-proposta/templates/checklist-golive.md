# Checklist de Go-Live

> Copiar pra `Geradores/Gerador-XXXX/07-entregaveis/checklist-golive.md` e marcar item por item antes de virar a chave.

## Pré-go-live (D-7 a D-1)

### Infraestrutura
- [ ] Vercel projeto criado, em plano Pro
- [ ] Supabase com tenant criado, RLS ativo e auditado
- [ ] Resend domínio verificado (DKIM + SPF + DMARC validados)
- [ ] DNS apontando, SSL emitido
- [ ] Backups configurados e testados (PITR no Supabase Pro)

### Dados
- [ ] 100% dos vendedores cadastrados (não os 3 de teste — todos os 96)
- [ ] Catálogo completo de equipamentos
- [ ] Parâmetros de cálculo aplicados e validados em 5 propostas conhecidas
- [ ] Branding aplicado em todas as páginas (login, painel, proposta, PDF, email)

### Operacional
- [ ] Cliente assinou aceite formal da homologação
- [ ] 2ª parcela do setup paga
- [ ] Data e hora de go-live confirmadas
- [ ] Material de treinamento pronto (slides + roteiro + gravação preparada)
- [ ] Canais de suporte abertos (WhatsApp dedicado, email)

### Comunicação
- [ ] Email "Amanhã é o dia" enviado pros 96 vendedores
- [ ] Decisor avisado dos horários da semana
- [ ] Reunião de fechamento agendada (dia 45)

## Dia do go-live (D-day)

### Manhã (08:00–10:00)
- [ ] Verificação final de saúde da plataforma (DNS, SSL, login)
- [ ] Disparo do welcome email em lote pros 96 vendedores
- [ ] Monitoramento ativo dos primeiros logins
- [ ] Atender suporte em <1h

### Sessão de treinamento (10:00–12:00)
- [ ] Sessão 1 ao vivo, gravada
- [ ] Material gravado disponibilizado em até 4h depois
- [ ] Lista de presença registrada

### Tarde (12:00–18:00)
- [ ] Monitorar criação das primeiras propostas reais
- [ ] Suporte intensivo (responder em <1h)
- [ ] Triagem de bugs reportados
- [ ] Resumo do dia pro decisor às 18:00

## Pós-go-live (D+1 a D+15)

### Semana 1
- [ ] Suporte intensivo (1h útil pra resposta)
- [ ] Segunda sessão de treinamento (D+3 ou D+4)
- [ ] Relatório de saúde diário pro decisor
- [ ] Bug list em ordem de prioridade
- [ ] Métricas: % vendedores ativos, propostas geradas, taxa de abertura

### Semana 2
- [ ] Suporte normal (4h pra bug, 48h pra dúvida)
- [ ] Sessão extra com admin sobre catálogo e relatórios
- [ ] Material escrito entregue (manual, FAQ, cheat sheet)
- [ ] Reunião de fechamento

### Métricas de sucesso (relatório dia 45)
- [ ] >90% vendedores logaram alguma vez
- [ ] >70% vendedores geraram pelo menos 1 proposta
- [ ] >100 propostas geradas no total
- [ ] 0 bugs críticos pendentes
- [ ] Tempo médio de criação <8 min
- [ ] Taxa de visualização pelo cliente final >40%

## Encerramento da fase de entrega

- [ ] Transferir relacionamento pra "modo suporte"
- [ ] Atualizar `README.md` do projeto com data oficial de go-live
- [ ] Criar SLA ativo em `10-suporte/sla.md`
- [ ] Adicionar tenant ao monitoramento contínuo
- [ ] Arquivar projeto na pasta principal (não deletar — manter histórico)
