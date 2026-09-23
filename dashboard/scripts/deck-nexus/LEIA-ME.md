# Modelo de apresentação NEXUS

O deck comercial que vai para o cliente do eletroposto: **13 páginas**, três PDFs,
um deles em pé para ler no celular.

## Gerar

```bash
cd dashboard/scripts/deck-nexus
node render.js
```

Saem três arquivos na pasta de cima:

| arquivo | para quê |
|---|---|
| `<Pasta>.pdf` | alta resolução, para projetar ou imprimir |
| `<Pasta>-leve.pdf` | WhatsApp e e-mail |
| `<Pasta>-celular.pdf` | 1080×1920, em pé, uma ideia por tela |

O nome dos PDFs sai do nome da **pasta de cima**, não de dentro do código. Para um
cliente novo, copie esta pasta para `Desktop/Clientes/<Nome>/Apresentacao-<Nome>/_fonte`
e troque o bloco `DADOS` no topo do `index.html`.

## As decisões que estão dentro

**13 páginas, não 32.** Ordem do Thiago em 23/09/2026: mais direta e com confiança
extraordinária. Cada página ou prova um número ou prova a empresa.

**A página 2 é a aposta.** Ela diz que o endereço do cliente foi estudado ANTES da
reunião, e lista as fontes. Nenhum concorrente faz isso sem ter o sistema que faz o
estudo sozinho.

**Entra o que é bom do ponto, não entra o que é ruim.** Omitir é permitido, inventar
não é. Sinal fraco, como padrão de entrada baixo, fica no estudo interno, que é de
quem atende, e não neste PDF.

**Bloco sem dado apaga a página inteira.** É por isso que a página do estoque não
aparece enquanto não houver número real de unidades em Uberlândia. Página com "—"
destrói a confiança que as outras constroem.

**Começa pelo piso, não pelo melhor caso.** A página de cenários abre no conservador.

**A última página não tem próximo passo.** Ela tem três números e a palavra
assinatura. Nada entre o deck e a decisão, regra de 03/09/2026.

## De onde vem cada dado

| bloco do `DADOS` | fonte |
|---|---|
| `ponto`, `mercado` | estudo do local, que nasce sozinho quando a reunião é marcada |
| `estacao`, `conta` | Simulador do `/gerador`, que é a fonte da verdade do preço |
| `estoque` | só o que está em Uberlândia de verdade. Foto de fábrica não é estoque no Brasil |
