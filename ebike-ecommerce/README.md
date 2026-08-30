# Loja de bikes da Irmãos na Obra

Vitrine das bicicletas e scooters elétricas do nosso fornecedor, com a nossa
margem embutida. O cliente escolhe o modelo, diz como quer pagar e cai no
WhatsApp do Thiago ou do Diego com tudo escrito.

## Onde está

| | |
| --- | --- |
| Loja | https://solardoc.app/bike |
| Painel | https://solardoc.app/bike/painel |
| Projeto Vercel | `bikes-irmaos-na-obra` (root `ebike-ecommerce`) |

O domínio é do SolarDoc: o projeto `solardocs-dashboard` só empresta o caminho,
por um rewrite em `dashboard/next.config.ts`, e `/bike` está no PUBLIC_PATHS do
proxy dele. A loja roda com `basePath: /bike` e é um projeto Vercel separado,
com cron próprio.

## Como funciona

```
portal do fornecedor  ──(1x por dia)──>  loja  ──>  WhatsApp do vendedor
   nome, foto, ficha                  + R$ 2.000
   técnica, preço, estoque              por unidade
```

- **Catálogo**: lido direto do portal do fornecedor (seção Ebike do CD de
  Uberlândia). Nada é digitado à mão: nome, foto, ficha técnica e preço vêm
  de lá.
- **Preço**: `custo do fornecedor + R$ 2.000`. A conta mora em um lugar só,
  `src/lib/preco.ts`, e o valor da margem sai de `MARGEM_REAIS`.
- **Atualização**: a loja se regenera a cada 24 h, e o cron da Vercel
  (`vercel.json`, 09:00 UTC ≈ 06:00 BRT) chama `/api/sync` para forçar.
- **Privacidade do custo**: `src/lib/preco.ts` e `src/lib/catalogo.ts` são
  `server-only`. Custo e margem existem só no servidor e no `/painel`, nunca
  no JavaScript que vai para o navegador.

## O que ainda depende de você

O portal do fornecedor mostra **preço de tabela** para quem não está logado, e
**não** mostra a quantidade em estoque. Com `SOOLLAR_EMAIL` e `SOOLLAR_SENHA`
preenchidos, a loja passa a usar o **preço negociado** da nossa conta e a
**quantidade real** de cada modelo. Sem eles, tudo funciona, mas o custo é o
de tabela e cada card diz "consultar disponibilidade". O `/painel` avisa isso
no topo, em amarelo.

## Variáveis de ambiente

Copie `.env.local.example` para `.env.local`. As que importam:

| Variável | Para que serve |
| --- | --- |
| `SOOLLAR_EMAIL` / `SOOLLAR_SENHA` | Login no fornecedor: destrava preço negociado e estoque |
| `MARGEM_REAIS` | Margem somada a cada item (padrão `2000`) |
| `PAINEL_SENHA` | Senha do `/painel`. **Sem ela ninguém entra no painel** |
| `SITE_PRIVADO` | `1` = a loja inteira pede a senha (só você vê) |
| `CRON_SECRET` | Segredo do agendamento diário |
| `ALERTA_WEBHOOK` | Recebe um POST quando a leitura ao vivo falha |

## Comandos

```bash
npm run dev      # desenvolvimento
npm run build    # build de produção
npm run sync     # regera a cópia de reserva (src/data/snapshot.json)
npm run probe    # mostra o que o fornecedor está devolvendo agora
npm run acoes    # redescobre os IDs das Server Actions do portal deles
```

## Cópia de reserva

`src/data/snapshot.json` é a última leitura boa do fornecedor. Se o portal cair,
mudar de endereço ou recusar o login, a loja continua no ar com esses dados e o
`/painel` mostra o aviso "servindo a cópia de reserva" com o motivo da falha.
Rode `npm run sync` de vez em quando (e sempre que o catálogo mudar bastante)
para a reserva não envelhecer.

## Detalhes que valem lembrar

- **O fornecedor não tem API.** O portal dele é Next.js e conversa por Server
  Actions; `src/lib/soollar.ts` fala esse mesmo protocolo. Se eles fizerem
  deploy, os IDs das ações mudam e a leitura ao vivo para. A reserva segura a
  loja, o painel denuncia e `npm run acoes` imprime os IDs novos.
- **Sem o cookie `distribution-center` a listagem volta vazia**, com status 200
  e sem erro. Já custou horas.
- **`fetch` do Node leva 403 do Cloudflare deles; HTTP/2 passa.** Por isso o
  transporte é `node:http2` na unha. Mandar `referer`/`origin` também dispara o
  bloqueio.
- **As fotos passam por `/foto/...`**, não pelo CDN do fornecedor: o endereço
  original entregaria de quem compramos em qualquer "inspecionar elemento".
- **Ficha técnica é copiada, nunca reescrita.** O que o fabricante não informou
  fica de fora do card em vez de virar número inventado.
