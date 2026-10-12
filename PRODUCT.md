# Product

<!-- impeccable:product-schema 1 -->

Este registro cobre o `/gerador` (`dashboard/public/gerador/`). As landings, o painel do SolarDoc e os outros
produtos deste repositório têm verdades próprias e não estão descritos aqui. Os fatos abaixo foram inferidos do
código e do pedido do dono em 12/10/2026, sem entrevista. O que não foi confirmado por ele está marcado como inferido.

## Platform

web

## Users

Consultores de venda da Irmãos na Obra (energia solar e eletropostos) e os sócios. Usam no computador do
escritório e no celular, muitas vezes durante uma ligação ou na rua. O trabalho é atender o lead do dia, gerar
proposta e orçamento, tocar a agenda de reuniões e acompanhar a negociação até o fechamento e a obra.

O cliente final abre no celular dele os documentos que o consultor envia: proposta, orçamento e apresentação.

## Product Purpose

Ferramenta interna de vendas. Junta num lugar só o que o consultor precisa para vender: quem ligar hoje, a agenda,
o simulador e os documentos de cada etapa. Sucesso é o consultor resolver a tarefa do momento sem procurar, no
aparelho que estiver na mão (inferido).

## Operating Context

- App de página única (`index.html`) com seções Início, Solar, Eletroposto, CRM e Automação, mais páginas
  separadas para Agenda, Prospecção, Cobranças e Agentes. É um PWA com service worker.
- Dois produtos vendidos com marcas diferentes diante do cliente: solar sai como Irmãos na Obra, eletroposto sai
  como NEXUS. As telas internas são Irmãos na Obra.
- O app gera papel: orçamento, proposta, contrato, recibo, termos e apresentação. Esses documentos têm desenho
  próprio e viram PDF.
- Há dois papéis de acesso: sócio vê dinheiro e o time inteiro, consultor vê o que é dele. Quem decide é a API.

## Capabilities and Constraints

- Um banco de produção só, sem ambiente de teste.
- O arquivo principal é grande e editado com frequência. Mudança visual não pode alterar id, função de navegação,
  parâmetro de URL nem link que já circula.
- As cores dos cartões da Agenda codificam status e são regra do dono: não mudam.
- O formulário de documento é uma grade empilhada. O Simulador segue formato de planilha.
- Texto de tela: frase com maiúscula no começo, sem travessão, sem emoji colorido.

## Brand Commitments

- Azul-marinho e amarelo da Irmãos na Obra, tirados do logo (pedido explícito do dono em 12/10/2026).
- Logo em selo redondo, só em imagem (`dashboard/public/gerador/logo.png`).
- A marca NEXUS e os documentos do cliente não são tocados por mudança de visual das telas internas.

## Product Principles

1. A tarefa do momento vem antes de tudo: o que precisa de atenção hoje aparece primeiro.
2. Celular é uso de primeira classe, não o computador encolhido.
3. Uma coisa tem um jeito só: mesmo campo, mesmo botão e mesma navegação em todas as telas.
4. Número desconhecido nunca aparece como zero.
5. O que o cliente recebe em papel não muda por efeito colateral.

## Accessibility & Inclusion

Contraste de texto de 4,5 para 1, zoom liberado, foco visível por teclado, alvo de toque de 44 px e campos que não
disparam zoom automático no celular.
