# Plano de ação — linha IO (34998165040) parar de cair

07/ago/2026. Telefone da EMPRESA: a regra aqui é "melhor mandar de menos".

---

## 0. Antes de tudo: separar QUEDA de BLOQUEIO

São coisas diferentes e o remédio é diferente. Em 7 dias a linha teve as duas.

| Sintoma | O que é | Onde olhar |
|---|---|---|
| Para de **receber** mensagem (ninguém entra) | **Queda** — instância Z-API desconectada (celular offline, bateria, QR expirado) | `webhook_debug` com ~zero eventos no dia; `wa_mensagens` sem nada recebido; `error_logs` com `connected=false` |
| Recebe normal, mas **envio** falha / número marcado | **Bloqueio** — denúncia/ban do WhatsApp | envios falhando com a instância conectada |

Checagem rápida, sem SQL: `GET https://api.solardoc.app/gerador/agentes` → `linhas[]` diz `caida`/`ok`.
O monitor já manda **e-mail** (não WhatsApp) na queda e na volta — `OPS_ALERT_EMAIL`, fallback `aiorosgroup@gmail.com`.

**Se for queda (o caso de 04–06/ago):** nenhum ajuste de cadência resolve. O que resolve é do lado do aparelho:
1. Celular da linha em tomada, **sem** otimização de bateria pro WhatsApp (Android: Configurações → Apps → WhatsApp → Bateria → **Sem restrição**).
2. Wi-Fi estável + dados móveis ligados como reserva.
3. Não usar o WhatsApp Web desse número em outro lugar — sessão multi-device brigando é a causa clássica de desconexão diária.
4. Não deixar o app "atualizando sozinho" durante a madrugada num aparelho sem rede.

---

## 1. O que já foi CONSTRUÍDO hoje (no ar no próximo deploy)

### 1.1 Um toque = UMA mensagem (o pedido "não envie seguidas")
Todo toque frio passava por `sendHuman`, que fatiava em até **5 mensagens** com **0,3s** entre elas. Ou seja: o teto anti-ban contava 1, e a pessoa recebia 5 na cara, quase no mesmo segundo. É o gesto que faz bloquear e denunciar.

- Novo `sendFrio()` (`api/src/services/agents/zapiClient.ts`): **1 mensagem só, sempre**, sem truncar nada (link/Pix saem inteiros).
- Migrados pra ele: os 4 toques da Bia (LimpaPro), followup do Gerador, repescagem e convite de grupo do eletroposto, grupo frio, semente solar.
- Conversa VIVA (inbound: Giovanna, Carla, atendimento) **continua frase por frase** — ali a pessoa está esperando a resposta. O que mudou pra ela: gap entre bolhas de 0,3s → **2–5s sorteados**.

### 1.2 Tetos da linha
| | Antes | Agora |
|---|---|---|
| Por hora | 12 | **6** (`LINHA_MAX_HORA`) |
| Por dia | não existia | **40** (`LINHA_MAX_DIA`) |
| Espaçamento mínimo | 5 min fixo | **10 min + até 5 min sorteados** (`ESPACAMENTO_MIN_MS`) |
| Janela | 08h–21h | **09h–20h**, **domingo desligado** (`JANELA_DOMINGO_ON=1` libera) |

O jitter importa: um envio a cada 5:00 min cravado, hora após hora, é assinatura de robô tão clara quanto a rajada.

### 1.3 Agentes que gastavam a linha sem aparecer na conta
`semente:` e `ep_grupo_frio:` entraram em `BOT_SENT_PREFIXES`. Estavam fora do orçamento desde sempre.

### 1.4 Rampa de aquecimento pós-reconexão — **usar amanhã ao reconectar**
Linha que acabou de voltar é a mais frágil que existe. Ao reconectar, defina na Vercel:

```
LINHA_RECONECTADA_EM=2026-08-08     # a data do dia em que você reconectar
```

Por 72h os tetos sobem em rampa e depois **somem sozinhos** (não precisa lembrar de tirar a env):

| Desde a reconexão | Por hora | Por dia |
|---|---|---|
| 0–24h | 2 | 10 |
| 24–48h | 3 | 20 |
| 48–72h | 4 | 30 |
| depois | 6 | 40 |

### 1.5 Followup mais espaçado
| Toque da Bia | Antes | Agora |
|---|---|---|
| 2º (cupom) | 2h após o opener | **24h** (`RECUP_CUPOM_DELAY_H`) |
| 3º (fechamento) | 20h | **72h** (`RECUP_FECHAMENTO_DELAY_H`) |
| 4º (grupo pago) | 2 dias | **7 dias** (`RECUP_GRUPO_DELAY_H`) |

Gerador: seed de 6 → **15 min** entre leads, e **1 envio por tick** (era 2).

Nada é perdido: todos os gates são pré-claim — quem não passa espera o próximo tick.

---

## 2. O que fica na sua mão

1. **`LINHA_RECONECTADA_EM`** na Vercel no dia da reconexão (item 1.4). É o único passo obrigatório.
2. **Celular da linha**: bateria sem restrição, tomada, sem WhatsApp Web paralelo (item 0).
3. **Uma semana quieto.** Se em 7 dias não cair nem bloquear, aí sim sobe `LINHA_MAX_HORA` pra 8 e o dia pra 60 — nunca os dois de uma vez.

## 3. O que NÃO foi feito e por quê

- **Teto de "números novos por dia"** (o preditor mais forte de ban): os marcadores atuais são por e-mail/chave, não guardam se o número já respondeu alguma vez. Dá pra fazer, mas exige tabela nova — o teto diário de 40 cobre 90% do risco por enquanto.
- **Blast do admin** (`runIoBroadcastTick`) continua **isento** dos tetos por decisão antiga: é operador-iniciado, você aperta o botão. Se a linha cair de novo com o blast rodando, esse é o primeiro suspeito e o próximo a entrar no orçamento.

## 4. Kill-switches (afrouxar sem redeploy)

`JANELA_DIURNA_OFF=1` · `ESPACAMENTO_OFF=1` · `JANELA_DOMINGO_ON=1` · `LINHA_MAX_HORA` · `LINHA_MAX_DIA` · `ESPACAMENTO_MIN_MS` · `JANELA_INICIO_H` / `JANELA_FIM_H`
