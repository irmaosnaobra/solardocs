# Worker de Prospecção

Dois programas. Zero dependência — não roda `npm install`, não baixa navegador.
Node 22+ (você tem 24).

---

## 1. Subir o Chrome dedicado

Feche o Chrome normal. Abra um separado, só pra automação:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.chrome-prospeccao"
```

**Nessa janela**, faça login no WhatsApp Web (ou no Instagram). Uma vez só — a
sessão fica salva nesse perfil e sobrevive a reinício.

Perfil separado resolve três coisas de uma vez: o worker nunca vê suas abas, seu
Chrome de sempre continua livre, e o Chrome 136+ recusa porta de debug no perfil
padrão de qualquer jeito.

Confira que subiu:

```powershell
curl http://127.0.0.1:9222/json/version
```

> A porta 9222 dá controle total sobre a sessão logada nesse perfil. Mantenha em
> `127.0.0.1`, nunca `0.0.0.0`, e não rode em máquina compartilhada.

---

## 2. Ensaio primeiro. Sempre.

```powershell
cd $env:USERPROFILE\Desktop\CLAUDE\worker-prospeccao
node worker.mjs --dry
```

Percorre a fila inteira e imprime a mensagem exata que sairia pra cada empresa —
**sem tocar em ninguém**. É aqui que você lê 10 mensagens e decide se a abertura
está boa antes de mandar pra 200 pessoas.

Fora da janela de horário ele para e avisa. Pra ensaiar de madrugada:

```powershell
$env:HORA_INI=0; $env:HORA_FIM=24; node worker.mjs --dry
```

## 3. Enviar de verdade

```powershell
$env:CONSULTOR="Thiago"
node worker.mjs --canal=whatsapp
```

O `--canal=instagram` existe e funciona, mas veja a seção do @ abaixo.

---

## As três travas

O worker **não decide nada sozinho**. Ele relê as travas do banco a cada envio:

| Trava | Onde mora | O que faz |
|---|---|---|
| Quem receber | view `prospeccao_fila_worker` | já aplica bloqueado, lista ativa, não-tocado-hoje |
| Quantos por dia | view `prospeccao_teto_hoje` | rampa: 5/dia na semana 1, +5 por semana, teto 20 |
| Quando parar | view `prospeccao_saude` | opt-out acima de 8% trava a fila inteira |

Se você registrar "não perturbar" na tela enquanto o worker roda, ele para na
próxima mensagem. Mexer nos números aqui no arquivo não adianta — a fonte é o
banco.

### Cadência

O teto **não é um número escolhido** — ele sobe com a saúde medida. Por consultor:

| Situação | Fator | Teto (semana 4+) |
|---|---|---|
| Menos de 30 contatos tocados em 14 dias | 25% | **25/dia** |
| Opt-out abaixo de 2% | 100% | **100/dia** |
| Opt-out entre 2% e 4% | 50% | 50/dia |
| Opt-out entre 4% e 8% | 25% | 25/dia |
| Opt-out 8% ou mais | 0 | **fila travada** |

A base cresce 25 por semana até 100. Com os 4 consultores da casa, saudável e na
semana 4, isso é **400 mensagens/dia** — e varre a fila de 1.141 em 3 dias.

Ninguém precisa lembrar de subir: quem prova que não incomoda ganha volume
sozinho, e quem incomoda perde sozinho.

### Espaçamento — por que a janela longa é mais segura

Janela padrão: **07:00 às 23:59**.

O worker **não usa intervalo fixo**. Ele divide o tempo que sobra da janela pelo
que sobra do teto:

```
espera = (segundos restantes na janela) ÷ (mensagens restantes)  ± 25%
```

100 mensagens em 17 horas viram uma a cada ~10 minutos, sozinhas. As mesmas 100
das 9h às 18h seriam uma a cada 5 minutos — o dobro da densidade.

**O que derruba linha é densidade, não total.** Por isso a janela longa ajuda em
vez de atrapalhar: ela é o denominador da conta. Mandou cedo, o worker anda
devagar; entrou tarde, ele acelera até o piso de 60s.

Piso e teto do espaçamento (`MIN_SEG=60`, `MAX_SEG=900`) existem só pra evitar
rajada de um lado e worker dormindo do outro.

### O que a sua base diz sobre horário

Dos 305 toques registrados:

| Hora | Toques | Positivos | Pediram pra parar |
|---|---|---|---|
| **10h** | 79 | **21 (27%)** | 5 (6%) |
| 14h | 49 | 1 (2%) | 6 (12%) |
| 15h | 72 | 4 (6%) | 3 (4%) |
| **17h** | 13 | 0 | **4 (31%)** |
| 21h | 11 | 0 | 0 |

Amostra pequena, mas a direção é clara: **manhã converte, fim de tarde irrita.**
De 22h em diante não há um único toque registrado — nenhuma evidência, nem boa
nem ruim. A janela aberta é segura pela densidade; se o resultado das 22h vier
ruim, o dado vai aparecer no radar antes de virar problema.

## O @ do Instagram

**Não existe @ na base.** O Google Maps devolve telefone e site, nunca o handle.
Por isso o `--canal=instagram` começa sem alvo nenhum.

Pra colher, de graça e sem Apify (a conta está travada por fatura em aberto):

```powershell
node colher-instagram.mjs
```

Abre o site de cada empresa e procura o link do Instagram. Rendeu **32%** no
teste (16 de 50). Guarda três estados: handle encontrado, `''` (site respondeu e
não tem Instagram — não tenta de novo) e `null` (site fora do ar — dá pra tentar
amanhã).

Ele ignora bandeira e fabricante (`@ipiranga`, `@shell`, `@growatt`), e handle
que aparece em mais de uma empresa é limpo automaticamente: é a marca ou a
agência que fez os dois sites, não o negócio.

---

## Acompanhar

**https://solardoc.app/gerador/radar/** — atualiza a cada 20 segundos.

Toques por hora, funil, disjuntor com a marca dos 8%, teto por consultor, feed
ao vivo e a conta de custo por lead. O radar é **somente leitura**: não existe
botão ali que dispare mensagem, de propósito.

---

## Quando der errado

| Sintoma | O que é |
|---|---|
| `NÃO CONSEGUI FALAR COM O CHROME` | o Chrome não subiu com `--remote-debugging-port=9222` |
| `caixa de mensagem não abriu` | número sem WhatsApp, ou a sessão do Web caiu |
| `botão de mensagem não encontrado` | perfil privado, ou o Instagram mudou o layout |
| `5 falhas seguidas — parando` | proteção: algo mudou na página ou a sessão morreu |
| `DISJUNTOR ARMADO` | opt-out passou de 8%. Troque a abertura antes de voltar |
| `todo script está bloqueado` | a trava de alegação. Prove a afirmação ou reescreva |

Falha **nunca** vira toque gravado. Mensagem que não saiu não tira a pessoa da
fila — senão ela sumiria sem nunca ter sido falada.
