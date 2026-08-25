'use client';

// ─────────────────────────────────────────────────────────────────────────────
// ATENDENTE DE ANÚNCIO — o system prompt do atendimento de WhatsApp que nasce do
// anúncio (clique-pro-WhatsApp e formulário do Meta). Aqui ele é EDITÁVEL: o
// texto vive no banco (system_state), o padrão de fábrica vive no código, e
// mudar uma frase não pede deploy.
//
// A aba faz uma coisa que um arquivo .md não faz: resolve os números da seção 3
// contra o banco na hora. O prompt guarda {{empresas_cnpj}}, {{docs_total}} e
// {{docs_30d}} justamente porque número digitado dentro de prompt envelhece
// calado — os do texto original já estavam 14% abaixo do real em duas semanas.
//
// ESTADO DE LIGAÇÃO: o texto está guardado e versionado, mas NENHUM agente lê
// ele ainda (a Giovanna, que atende a linha do SolarDoc, tem prompt próprio no
// whatsappAgentService). O card de estado diz isso na cara — prompt sem aviso de
// que está fora do ar é lido como se estivesse no ar.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw, Copy, Check } from 'lucide-react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Dados {
  texto: string;
  padrao: string;
  editado: boolean;
  atualizado_em: string | null;
  atualizado_por: string | null;
  placeholders: { chave: string; descricao: string }[];
  numeros: Record<string, string>;
  resolvido: string;
}

const CHIP: React.CSSProperties = {
  display: 'inline-block', fontSize: 12, fontWeight: 600, padding: '3px 10px',
  borderRadius: 999, background: 'var(--color-surface-2, rgba(127,127,127,.1))', marginRight: 6, marginBottom: 6,
};

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600,
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border, rgba(127,127,127,.25))',
  background: 'transparent', color: 'var(--color-text)', cursor: 'pointer',
};

const quando = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function AtendentePanel() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [aba, setAba] = useState<'editar' | 'previa'>('editar');
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/atendente-prompt')
      .then((r) => { const d = r.data as Dados; setDados(d); setTexto(d.texto); })
      .catch((e) => setErro(String(e?.response?.data?.error || e?.message || e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const sujo = !!dados && texto !== dados.texto;

  // Prévia = o que o modelo veria de verdade: placeholder já trocado pelo número
  // vivo. Roda sobre o texto do editor (e não sobre o salvo) pra a conferência
  // valer ANTES de salvar.
  const previa = useMemo(() => {
    if (!dados) return '';
    let out = texto;
    for (const [chave, valor] of Object.entries(dados.numeros)) out = out.split(chave).join(valor);
    return out;
  }, [texto, dados]);

  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      await api.put('/admin/atendente-prompt', { texto });
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setErro(String(err?.response?.data?.error || err?.message || e));
    } finally { setSalvando(false); }
  }

  async function restaurarPadrao() {
    if (!confirm('Voltar o prompt pro padrão de fábrica? A versão editada é apagada.')) return;
    setSalvando(true); setErro(null);
    try {
      await api.delete('/admin/atendente-prompt');
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setErro(String(err?.response?.data?.error || err?.message || e));
    } finally { setSalvando(false); }
  }

  function copiar() {
    navigator.clipboard.writeText(previa || texto).then(() => {
      setCopiado(true); setTimeout(() => setCopiado(false), 1800);
    }).catch(() => {});
  }

  if (loading && !dados) return <p className={styles.loading}>carregando…</p>;

  return (
    <div>
      <div className={styles.card} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Atendente de anúncio</h2>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>WhatsApp · lead que vem do Meta</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <span style={CHIP}>editável sem deploy</span>
          <span style={CHIP}>{dados?.editado ? 'versão editada' : 'padrão de fábrica'}</span>
          <span style={{ ...CHIP, color: '#B4801E' }}>ainda não está no ar</span>
          <span style={CHIP}>{(texto.length / 1000).toFixed(1)}k caracteres</span>
        </div>
        <p style={{ margin: '12px 0 0', color: 'var(--color-text)', lineHeight: 1.6 }}>
          Este é o texto que o atendimento do anúncio vai usar: as duas portas de entrada
          (clique-pro-WhatsApp e formulário do Meta), o preço, as objeções e o que ele nunca
          pode prometer. Última gravação: <b>{quando(dados?.atualizado_em ?? null)}</b>
          {dados?.atualizado_por ? <> por {dados.atualizado_por}</> : null}.
        </p>
      </div>

      <div className={styles.cards} style={{ marginBottom: 14 }}>
        <div className={styles.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Números vivos (seção 3 do prompt)</div>
          <p style={{ margin: '0 0 10px', color: 'var(--color-text-muted)', fontSize: 13.5, lineHeight: 1.5 }}>
            O texto guarda o marcador; o valor entra na hora da conversa. É o que impede o
            agente de citar número velho — o texto que chegou dizia 152 empresas quando já
            eram 154, e 1.714 documentos quando já eram mais de 2 mil.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {(dados?.placeholders ?? []).map((p) => (
              <li key={p.chave} style={{ fontSize: 13.5 }}>
                <code style={{ fontWeight: 700 }}>{p.chave}</code>
                <span style={{ fontWeight: 700 }}> = {dados?.numeros?.[p.chave] ?? '—'}</span>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12.5 }}>{p.descricao}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>O que já existe e o que falta</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 7, color: 'var(--color-text-muted)', fontSize: 13.5, lineHeight: 1.5 }}>
            <li>O texto está guardado e é editável aqui. <b>Nenhum agente lê ele ainda.</b></li>
            <li>Quem atende a linha do SolarDoc hoje é a Giovanna, com prompt próprio no código
              (onboarding, cartão recusado, Pix). Este aqui é outro papel: o desconhecido que
              acabou de clicar no anúncio.</li>
            <li>A biblioteca de imagens da seção 10 (orcamento_1pagina, doc_contrato…) está
              descrita, mas as tags ainda não existem em lugar nenhum.</li>
            <li>Ligar isso na linha significa: responder número desconhecido, guardar a
              referral do Meta e respeitar o teto anti-ban — decisão do Thiago, não é
              consequência de salvar o texto.</li>
          </ul>
        </div>
      </div>

      <div className={styles.card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button
            type="button" onClick={() => setAba('editar')}
            style={{ ...BTN, background: aba === 'editar' ? 'var(--color-surface-2, rgba(127,127,127,.12))' : 'transparent' }}
          >Editar</button>
          <button
            type="button" onClick={() => setAba('previa')}
            style={{ ...BTN, background: aba === 'previa' ? 'var(--color-surface-2, rgba(127,127,127,.12))' : 'transparent' }}
          >Prévia com os números</button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={copiar} style={BTN}>
            {copiado ? <Check size={15} /> : <Copy size={15} />} {copiado ? 'copiado' : 'copiar'}
          </button>
          <button type="button" onClick={restaurarPadrao} disabled={salvando || !dados?.editado} style={{ ...BTN, opacity: dados?.editado ? 1 : .45 }}>
            <RotateCcw size={15} /> restaurar padrão
          </button>
          <button
            type="button" onClick={salvar} disabled={!sujo || salvando}
            style={{ ...BTN, background: sujo ? '#B4801E' : 'transparent', color: sujo ? '#fff' : 'var(--color-text)', borderColor: sujo ? '#B4801E' : undefined, opacity: sujo ? 1 : .45 }}
          >
            <Save size={15} /> {salvando ? 'salvando…' : 'salvar'}
          </button>
        </div>

        {erro && (
          <p style={{ margin: '0 0 10px', color: '#C0392B', fontSize: 13.5 }}>
            não deu pra {salvando ? 'salvar' : 'carregar'}: {erro}
          </p>
        )}

        {aba === 'editar' ? (
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', minHeight: 560, resize: 'vertical', padding: 14, borderRadius: 8,
              border: '1px solid var(--color-border, rgba(127,127,127,.25))', background: 'var(--color-surface, transparent)',
              color: 'var(--color-text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}
          />
        ) : (
          <pre style={{
            margin: 0, padding: 14, borderRadius: 8, maxHeight: 620, overflow: 'auto',
            border: '1px solid var(--color-border, rgba(127,127,127,.25))',
            background: 'var(--color-surface-2, rgba(127,127,127,.06))', color: 'var(--color-text)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{previa}</pre>
        )}

        <p style={{ margin: '10px 0 0', color: 'var(--color-text-muted)', fontSize: 12.5 }}>
          {sujo ? 'há mudança não salva.' : 'sem mudança pendente.'} O padrão de fábrica fica no
          código (atendenteAnuncioPrompt.ts) — restaurar não perde nada.
        </p>
      </div>
    </div>
  );
}
