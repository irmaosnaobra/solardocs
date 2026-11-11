'use client';

// ─────────────────────────────────────────────────────────────────────────────
// AGENTE (leitura) — a "cabeça" do agente de cada produto: quem é, o que faz, as
// regras duras e os kill-switches. SÓ EXIBE (não altera o agente). Conteúdo aterrado
// no código real dos serviços (whatsappAgentService / biaInboundService /
// recuperacaoCarla / retomadaUsuarios / pixVipReminderService). Sem backend — é uma leitura curada. Um endpoint que leia
// o system prompt ao vivo pode substituir isto numa fase futura.
// ─────────────────────────────────────────────────────────────────────────────
import styles from '../../admin.module.css';

interface AgenteInfo {
  nome: string;
  produto: string;
  linha: string;
  modelo: string;
  missao: string;
  regras: string[];
  killSwitches: { flag: string; efeito: string }[];
  fontes: string[];
}

const AGENTES: Record<string, AgenteInfo> = {
  giovanna: {
    nome: 'Giovanna',
    produto: 'SolarDoc, suporte da plataforma',
    linha: "'solardoc'",
    modelo: 'claude-sonnet-4-6',
    missao:
      'Atende pelo WhatsApp quem já tem conta na SolarDoc. Tira dúvida, resolve o suporte na hora com 5 ferramentas e acolhe quem teve o acesso pausado por falha de pagamento, levando de volta pelo cupom ou pelo Pix automático. Com o usuário do plano grátis, conduz até a assinatura de R$ 67 por mês.',
    regras: [
      'Fala como gente no WhatsApp: máximo de 2 bolhas separadas por ||, curtas.',
      'Ferramentas: ver_minha_conta, ver_erros_recentes, alterar_dados_empresa, abrir_chamado e reenviar_acesso.',
      'Altera só cinco campos da empresa (razão social, fantasia, endereço, cidade e CNPJ), com prévia e um sim claro. E-mail, WhatsApp e plano ela não altera.',
      'Marcador [[ENVIAR_PIX]]: o sistema anexa o link do Pix automático. Ela nunca escreve link, código nem valor.',
      'Marcador [HUMANO]: abre chamado real para o time, uma vez por sessão.',
      'Comprovante de Pix de quem pagou por outro caminho é validado por IA e liberado na hora.',
    ],
    killSwitches: [
      { flag: 'PIX_AUTO_LIBERAR=false', efeito: 'volta para a liberação manual do admin, que só sinaliza' },
    ],
    fontes: ['whatsappAgentService.ts', 'giovannaFerramentas.ts', 'pixComprovanteService.ts', 'dunningService.ts'],
  },
  carla: {
    nome: 'Carla',
    produto: 'SolarDoc, vendas pela linha 5040',
    linha: "'5040'",
    modelo: 'claude-opus-5-5 (reserva claude-sonnet-5-5)',
    missao:
      'Vendedora da SolarDoc na linha 5040, sem reunião. Fala com quem ainda não paga e conduz até a assinatura pelo Pix automático ou pelo cartão. Tem quatro frentes: recuperar quem deixou o WhatsApp no quiz e não comprou, retomar os usuários da SolarDoc que não pagam, lembrar a renovação de quem paga por Pix e atender os anúncios da linha 5040 junto com a Duda.',
    regras: [
      'Recuperação do quiz e do checkout (desde 24/10 e 03/11): uma bolha, sem link, de segunda a sábado, das 9h às 20h. Quem a Carla segura não recebe o toque da Giovanna.',
      'Retomada dos usuários (ligada em 05/11): uma vez por pessoa, só para conta com WhatsApp que não paga hoje. Fica fora assinante, quem está em cobrança, quem pediu para parar e conversa com humano. No máximo 25 por 24 horas.',
      'Anúncios da linha 5040 (desde 22/10): o texto do anúncio decide quem atende. SolarDoc é da Carla e energia solar é da Duda. Ela passa o caso para a Duda ou a Helena quando o assunto é outro.',
      'Lembrete de renovação: avisa quem tem o acesso perto de vencer e manda o Pix automático.',
      'Só Pix automático, que cobra na conta da pessoa. Nunca Pix avulso e nunca código escrito pelo modelo.',
    ],
    killSwitches: [
      { flag: 'chave usu_rec_pausa (banco) ou CARLA_RETOMADA_USUARIOS_OFF=1', efeito: 'pausa a retomada dos usuários' },
      { flag: 'chave quiz_rec_pausa (banco) ou QUIZ_RECUPERACAO_LIGADA=0', efeito: 'pausa a recuperação do quiz' },
      { flag: 'interruptor carla_vivo', efeito: 'desliga a conversa viva da Carla' },
      { flag: 'ag5040_linha_pausa', efeito: 'pausa a linha 5040 inteira' },
      { flag: 'PIX_MENSAL_OFF=true', efeito: 'pausa o lembrete de renovação por Pix' },
    ],
    fontes: [
      'recuperacaoCarla.ts', 'retomadaUsuarios.ts', 'recuperacaoCheckoutPortao.ts',
      'pixVipReminderService.ts', 'personas/carla.ts', 'carlaVivo.ts', 'porteiro.ts',
    ],
  },
  bia: {
    nome: 'Bia',
    produto: 'LimpaPro (curso)',
    linha: "'io'",
    modelo: 'claude-sonnet-4-6',
    missao:
      'Recuperação de checkout abandonado do curso Limpa Solar Pro (Kiwify). Puxa quem clicou e não comprou, conversa e conduz de volta ao checkout. Cadência validada: opener, cupom e fechamento, com stop-on-reply.',
    regras: [
      'Sessão própria por telefone (tipo "recuperacao"); teto anti-ban COMPARTILHADO da linha IO.',
      'Para na hora que o cliente responde (stop-on-reply) e nunca manda o próximo passo por cima.',
      'Respeita opt-out e supressão; não reaborda quem pediu para parar.',
      'Não inventa preço nem condição fora da oferta vigente (hoje R$47, pagamento único).',
    ],
    killSwitches: [{ flag: '(cadência via config)', efeito: 'toques e intervalos ajustáveis sem deploy' }],
    fontes: ['biaInboundService.ts', 'limpaproRecoveryService.ts', 'lineThrottle.ts'],
  },
};

const CHIP: React.CSSProperties = {
  display: 'inline-block', fontSize: 12, fontWeight: 600, padding: '3px 10px',
  borderRadius: 999, background: 'var(--color-surface-2, rgba(127,127,127,.1))', marginRight: 6, marginBottom: 6,
};

type AgenteId = keyof typeof AGENTES;

function CartaoAgente({ agent }: { agent: AgenteId }) {
  const a = AGENTES[agent];
  return (
    <div style={{ marginBottom: 22 }}>
      <div className={styles.card} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>{a.nome}</h2>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{a.produto}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <span style={CHIP}>linha {a.linha}</span>
          <span style={CHIP}>modelo {a.modelo}</span>
          <span style={{ ...CHIP, color: '#2C9C67' }}>somente leitura</span>
        </div>
        <p style={{ margin: '12px 0 0', color: 'var(--color-text)', lineHeight: 1.6 }}>{a.missao}</p>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Regras duras</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 7, color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            {a.regras.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
        <div className={styles.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Kill-switches</div>
          {a.killSwitches.length ? (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {a.killSwitches.map((k, i) => (
                <li key={i} style={{ fontSize: 13.5 }}>
                  <code style={{ fontWeight: 700 }}>{k.flag}</code>
                  <span style={{ color: 'var(--color-text-muted)' }}>: {k.efeito}</span>
                </li>
              ))}
            </ul>
          ) : <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>Nenhum.</p>}
          <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Onde mora (código)</div>
          <div>{a.fontes.map((f, i) => <span key={i} style={CHIP}><code>{f}</code></span>)}</div>
        </div>
      </div>
    </div>
  );
}

// `agent` aceita um id ou uma lista: o hub da SolarDoc mostra as duas agentes, uma embaixo da outra.
export default function AgentePanel({ agent }: { agent: AgenteId | AgenteId[] }) {
  const lista = Array.isArray(agent) ? agent : [agent];
  return (
    <div>
      {lista.map((id) => <CartaoAgente key={id} agent={id} />)}
      <p style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Leitura curada do comportamento do agente, aterrada no código. Não altera o agente: o Thiago ajusta os serviços diretamente.
      </p>
    </div>
  );
}
