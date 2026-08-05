# Playbook — Go-live + Onboarding (Fase 5, dias 29–45)

> Plataforma aprovada. Hora de virar a chave e treinar os 96 vendedores.

## Sequência do go-live

### Dia 29 (D-1 do go-live)

- [ ] Backup completo do staging (caso precise restaurar algo)
- [ ] Verificar todos os 96 vendedores criados (não só os 3 de teste)
- [ ] Email de "Amanhã é o dia!" pros 96 com:
  - Quando vão receber o login
  - Onde vai ser a primeira sessão de treinamento
  - O que precisam preparar (nada — só estar online)
- [ ] Última checagem de saúde:
  - DNS resolvendo
  - SSL válido
  - Email saindo
  - Logs sem erro

### Dia 30 (D-day)

- [ ] **08:00** — Trigger do envio em massa do welcome email (96 vendedores)
- [ ] **08:00–10:00** — Monitorar logs, ver se alguém teve problema de login
- [ ] **10:00** — Primeira sessão de treinamento online (2h, gravada)
- [ ] **10:00–18:00** — Standby de suporte: você + alguém de plantão se possível
- [ ] **18:00** — Resumo do dia pro decisor:
  - Quantos logaram
  - Quantas propostas já foram geradas
  - Bugs encontrados (se houver)
  - Top 3 dúvidas

### Dias 31–37 (semana 1)

- [ ] Suporte intensivo — responder em até 1h útil
- [ ] **Segunda sessão de treinamento** (dia 33 ou 34): "Truques e melhores práticas"
- [ ] Reunião com decisor no fim da semana — feedback geral

### Dias 38–45 (semana 2)

- [ ] Suporte normal (4h úteis pra bug, 48h pra dúvida)
- [ ] Sessão extra com admin do cliente: como mexer no catálogo, como ler relatórios
- [ ] Material de apoio escrito entregue (FAQ, manual em PDF)

## Roteiro da sessão 1 — Treinamento básico (2h)

**1. Boas-vindas (5min)**
- Quem é a Aioros, quem é o Thiago
- Por que essa plataforma existe (substituir o sistema antigo)
- Como vai ser o treinamento de hoje
- Onde pedir ajuda depois

**2. Tour pela plataforma (15min)**
- Tela de login
- Painel inicial do vendedor
- Onde fica cada coisa

**3. Criando sua primeira proposta (30min)**
- Demonstração ao vivo
- Passo a passo na tela
- Cada campo explicado
- Dicas (quando usar kit vs montar configuração)

**4. Cliente recebeu a proposta. E agora? (20min)**
- Como ver quando cliente abriu
- Como fazer follow-up no momento certo
- O que cada métrica significa
- Quando ligar, quando esperar

**5. Casos especiais (15min)**
- Cliente quer 3 cenários (econômico, padrão, premium)
- Cliente bifásico/trifásico
- Cliente com sistema híbrido (bateria)

**6. Dúvidas (30min)**
- Q&A aberto
- Anotar perguntas mais comuns pra FAQ

**7. Próximos passos (5min)**
- Próxima sessão (data, tema)
- Onde acessar a gravação
- Canal de suporte

## Roteiro da sessão 2 — Avançado (2h, dia 33–34)

**1. Truques de proposta vencedora (30min)**
- Como personalizar texto pra cada cliente
- Quando usar gráfico de qual jeito
- Como argumentar com cliente que "achou caro"

**2. Análise de performance (30min)**
- Como ver suas próprias métricas
- Onde você está em comparação com o time
- O que melhorar baseado nos dados

**3. Truques operacionais (30min)**
- Duplicar uma proposta existente
- Atalhos pra preencher mais rápido
- Como usar no celular vs computador

**4. Q&A com perguntas reais (30min)**
- Tirar as 10 dúvidas mais frequentes da semana 1
- Espaço pra novas perguntas

## Material de apoio escrito

Entregar em PDF + link online:

1. **Manual do vendedor (10–15 páginas)** — passo a passo com prints
2. **FAQ (5 páginas)** — top 30 dúvidas
3. **Cheat sheet (1 página)** — atalhos rápidos
4. **Manual do admin (5–8 páginas)** — pra quem gerencia catálogo/vendedores

## Métricas de sucesso (primeira semana)

Acompanhar e mandar relatório pro decisor:

| Métrica | Alvo |
|---|---|
| % vendedores que logaram | >90% |
| % vendedores que geraram 1+ proposta | >70% |
| Propostas geradas no total | >100 |
| Bugs críticos reportados | 0 |
| Tempo médio de criação de proposta | <8 min |
| Taxa de abertura pelo cliente final | >40% |

Se algum estiver abaixo, **causa raiz + plano de ação na semana 2**.

## Encerramento da fase

Quando finalizar dia 45:

- [ ] Reunião de fechamento com decisor (status geral, próximos 90 dias)
- [ ] Transferir relacionamento pra "modo suporte" (não mais "modo entrega")
- [ ] Atualizar `Geradores/Gerador-XXXX/README.md` com data oficial de go-live
- [ ] Criar `10-suporte/sla.md` ativo
- [ ] Adicionar tenant ao monitoramento contínuo (uptime, erros, métricas)
- [ ] Comemorar 🎉
