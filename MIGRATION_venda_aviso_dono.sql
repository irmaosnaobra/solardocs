-- Aviso de venda no WhatsApp do dono — trava contra reentrega da Stripe.
-- Aplicada em 06/08/2026 no projeto solardoc-pro.
--
-- A Stripe reentrega checkout.session.completed por até 3 dias. Sem esta coluna
-- o dono receberia a mesma venda várias vezes e aprenderia a ignorar o aviso.
-- O claim é um UPDATE condicional (... WHERE id = ? AND aviso_dono_em IS NULL),
-- então dois webhooks simultâneos não avisam em dobro.

alter table sales add column if not exists aviso_dono_em timestamptz;

comment on column sales.aviso_dono_em is
  'Quando o aviso de venda foi entregue (ou tentado) no WhatsApp do dono. Serve de trava: o webhook da Stripe pode ser reentregue e o aviso nao pode sair duas vezes.';
