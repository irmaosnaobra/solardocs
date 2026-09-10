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

### Ritmo

Padrão: **90 a 240 segundos** entre mensagens, janela **09h–20h**. Esses são os
números do `PROMPT.md` do buscandomilhao, que é a referência que originou este
worker — o autor dele escolheu 30/dia e 09h–20h depois de queimar conta.

Dá pra abrir:

```powershell
$env:MIN_SEG=45; $env:MAX_SEG=120; $env:HORA_INI=7; $env:HORA_FIM=23
```

O que isso custa: quanto mais perto de "muitas mensagens em pouco tempo, o dia
todo", mais o padrão parece robô pro WhatsApp e pro Instagram. A linha IO caiu
três vezes em agosto exatamente assim — 98 disparos a 18/h, e a régua depois do
bloqueio virou 4/h. O teto da rampa continua valendo mesmo com o intervalo
aberto: pra passar de 20/dia é preciso mexer em `prospeccao_rampa`, de propósito.

---

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
