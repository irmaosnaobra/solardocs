-- ─────────────────────────────────────────────────────────────────────────────
-- Instagram — PORTEIRO DO LINK (04/08/2026). Complementa
-- MIGRATION_instagram_automacao.sql / _roteamento.sql / _fixar_por_post.sql.
--
-- POR QUE: a DM entregava o link no primeiro toque. O fluxo que o Thiago mandou
-- copiar (print do @allinmurilo) faz o contrário e é o que gera engajamento:
--   1) "clica no botão abaixo que eu te mando o link"   → a pessoa responde
--   2) "esse link é especial pra quem me segue"         → a pessoa responde
--   3) link.
-- Resposta da pessoa não é enfeite: é ela que ABRE a janela de 24h da Meta (todo
-- followup depende dela) e conta como interação pro alcance do post.
--
-- O motor liga isso sozinho em TODA automação que tenha `link_url` — não precisa
-- editar linha nenhuma pra valer. As colunas abaixo são só pra sobrescrever a
-- copy ou pular o porteiro em uma automação específica.
-- Kill-switch geral: IG_GATE_OFF='true' no ambiente da API.
--
-- SÃO DOIS PROJETOS SUPABASE — rode cada bloco no lugar certo.
-- ═════════════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCO A — projeto MAIN (SUPABASE_URL / SUPABASE_SERVICE_KEY)              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Estado do fluxo por pessoa. gate_etapa: pedido → seguir → entregue.
-- gate_liberado_em: já seguiu UMA vez → nas próximas recebe o link direto
-- (pedir pra seguir duas vezes é a versão chata disso).
alter table ig_contacts add column if not exists gate_etapa          text;
alter table ig_contacts add column if not exists gate_automation_id  text;
alter table ig_contacts add column if not exists gate_em             timestamptz;
alter table ig_contacts add column if not exists gate_liberado_em    timestamptz;

-- A troca de etapa é um UPDATE com `.eq('gate_etapa', <etapa esperada>)`: dois
-- toques no mesmo botão chegam como duas mensagens e as duas leem a mesma etapa.
-- Sem essa trava a pessoa recebe o mesmo texto duas vezes — foi exatamente o que
-- apareceu no print do ManyChat ("Seguindo" clicado, mesma mensagem de volta).
create index if not exists idx_ig_contacts_gate on ig_contacts (gate_etapa) where gate_etapa is not null;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCO B — projeto GERADOR (ancecdfqfwlaujknizof)                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Tudo opcional: nulo = usa a copy padrão do código (igGate.ts).
-- gate_off = true → esta automação entrega no primeiro toque, como antes.
alter table ig_automations add column if not exists gate_off          boolean not null default false;
alter table ig_automations add column if not exists gate_pedir_texto  text;
alter table ig_automations add column if not exists gate_pedir_botao  text;
alter table ig_automations add column if not exists gate_seguir_texto text;
alter table ig_automations add column if not exists gate_seguir_botao text;

-- Menu e rede de segurança não têm link_url → já ficam fora do porteiro sozinhos
-- (a resposta deles, "SOLAR"/"ELETROPOSTO", precisa continuar caindo no
-- roteamento por palavra-chave). Esta linha é só cinto de segurança explícito.
update ig_automations set gate_off = true where fallback = true or link_url is null;

-- Lembrete NÃO precisa ser editado: os textos atuais trazem a URL crua
-- ("dá uma olhada: solardoc.app/io/eletroposto") e a drenagem troca por um nudge
-- ("faltou só me seguir") quando a pessoa ainda não passou pelo porteiro.

-- ── Como reverter ────────────────────────────────────────────────────────────
-- IG_GATE_OFF='true' no ambiente (desliga na hora, sem tocar em dados), ou:
-- update ig_automations set gate_off = true;
