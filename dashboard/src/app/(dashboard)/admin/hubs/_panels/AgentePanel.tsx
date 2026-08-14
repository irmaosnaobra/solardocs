'use client';

// ─────────────────────────────────────────────────────────────────────────────
// AGENTE (leitura) — a "cabeça" do agente de cada produto: quem é, o que faz, as
// regras duras e os kill-switches. SÓ EXIBE (não altera o agente). Conteúdo aterrado
// no código real dos serviços (whatsappAgentService / biaInboundService / SDR /
// pixRecoveryAgentService). Sem backend — é uma leitura curada. Um endpoint que leia
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
    produto: 'SolarDoc (SaaS)',
    linha: "'solardoc'",
    modelo: 'claude-sonnet-4-6',
    missao:
      'Consultora da SolarDoc — humana, consultiva, vende de verdade. Cobre TODOS os estágios: onboarding, conversão do free em assinante, dunning (cartão falhou), recuperação de abandono e renovação por Pix. Reativa acesso pausado oferecendo Pix na hora.',
    regras: [
      'Fala como gente no WhatsApp: máx. 2 bolhas separadas por ||, curtas, 0-1 emoji.',
      'Nunca soa como cobrança formal ("prezado/regularize") — acolhe e resolve.',
      'Marcador [[ENVIAR_PIX]] → o sistema anexa o copia-e-cola R$67 (ela NÃO escreve o código).',
      'Marcador [HUMANO] → abre chamado real pro time (1 por sessão, anti-spam).',
      'Comprovante de Pix → validado por IA-visão e auto-liberado (recebedor+valor+data+dedup).',
    ],
    killSwitches: [
      { flag: 'PIX_AUTO_LIBERAR=false', efeito: 'volta pro 1-clique manual do admin (só sinaliza)' },
      { flag: 'PIX_MENSAL_OFF=true', efeito: 'pausa a cobrança mensal por Pix' },
    ],
    fontes: ['whatsappAgentService.ts', 'pixRecoveryAgentService.ts', 'dunningService.ts', 'followupService.ts'],
  },
  bia: {
    nome: 'Bia',
    produto: 'LimpaPro (curso)',
    linha: "'io'",
    modelo: 'claude-sonnet-4-6',
    missao:
      'Recuperação de checkout abandonado do curso Limpa Solar Pro (Kiwify). Puxa quem clicou e não comprou, conversa e conduz de volta ao checkout. Cadência validada: opener → cupom → fechamento, com stop-on-reply.',
    regras: [
      'Sessão própria por telefone (tipo "recuperacao"); teto anti-ban COMPARTILHADO da linha IO.',
      'Para na hora que o cliente responde (stop-on-reply) — nunca manda o próximo passo por cima.',
      'Respeita opt-out / supressão; não reaborda quem pediu pra parar.',
      'Não inventa preço/condição fora da oferta vigente (hoje R$47, pagamento único).',
    ],
    killSwitches: [{ flag: '(cadência via config)', efeito: 'toques/intervalos ajustáveis sem deploy' }],
    fontes: ['biaInboundService.ts', 'limpaproRecoveryService.ts', 'lineThrottle.ts'],
  },
  luma: {
    nome: 'Luma',
    produto: 'Solar / Irmãos na Obra (leads B2C)',
    linha: "'io'",
    modelo: 'claude-sonnet-4-6',
    missao:
      'SDR B2C de energia solar: recebe o lead (Meta / LP /io/*), qualifica, agenda a conversa com o consultor e nutre o pipeline (sdr_leads). Quando o lead esquenta, entrega quente pro consultor dono.',
    regras: [
      'Estágios do pipeline: reativacao → novo → frio → morno → quente → fechamento / perdido.',
      'Rodízio: 1 telefone = 1 consultor (gruda no dono; nunca duplica).',
      'Não cota preço final nem promete instalação — faz a ponte pro consultor humano.',
      'Follow-up de reengajamento é "puxador": ao responder, avisa o consultor e cala (handoff).',
    ],
    killSwitches: [{ flag: 'GERADOR_FOLLOWUP_ENABLED=true', efeito: 'liga o follow-up de leads solar (hoje DARK)' }],
    fontes: ['sdrAgentService.ts', 'sdrIoPolling.ts', 'geradorInboundService.ts', 'geradorFollowupService.ts'],
  },
  none: {
    nome: '—',
    produto: 'Eletroposto',
    linha: '—',
    modelo: '—',
    missao: 'Ainda não há agente dedicado ao Eletroposto. Hoje a LP só grava o lead e avisa a equipe por WhatsApp. Um agente próprio entra quando o funil deste produto for construído (Fase 3).',
    regras: [],
    killSwitches: [],
    fontes: ['ioEletroposto.ts (só alerta de equipe)'],
  },
};

const CHIP: React.CSSProperties = {
  display: 'inline-block', fontSize: 12, fontWeight: 600, padding: '3px 10px',
  borderRadius: 999, background: 'var(--color-surface-2, rgba(127,127,127,.1))', marginRight: 6, marginBottom: 6,
};

export default function AgentePanel({ agent }: { agent: keyof typeof AGENTES }) {
  const a = AGENTES[agent] ?? AGENTES.none;
  const semAgente = agent === 'none';

  return (
    <div>
      <div className={styles.card} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>{a.nome}</h2>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{a.produto}</span>
        </div>
        {!semAgente && (
          <div style={{ marginTop: 8 }}>
            <span style={CHIP}>linha {a.linha}</span>
            <span style={CHIP}>modelo {a.modelo}</span>
            <span style={{ ...CHIP, color: '#2C9C67' }}>somente leitura</span>
          </div>
        )}
        <p style={{ margin: '12px 0 0', color: 'var(--color-text)', lineHeight: 1.6 }}>{a.missao}</p>
      </div>

      {!semAgente && (
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
                    <span style={{ color: 'var(--color-text-muted)' }}> — {k.efeito}</span>
                  </li>
                ))}
              </ul>
            ) : <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>—</p>}
            <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Onde mora (código)</div>
            <div>{a.fontes.map((f, i) => <span key={i} style={CHIP}><code>{f}</code></span>)}</div>
          </div>
        </div>
      )}

      <p style={{ marginTop: 14, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Leitura curada do comportamento do agente (aterrada no código). Não altera o agente — o Thiago ajusta os serviços diretamente.
      </p>
    </div>
  );
}
