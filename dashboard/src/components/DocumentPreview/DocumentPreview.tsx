'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Pencil, Save, Check, X, FilePlus } from 'lucide-react';
import styles from './DocumentPreview.module.css';
import api from '@/services/api';
import { prewarmPdf, sharePrewarmedPdf, type PdfAsset } from '@/services/downloadPdf';
interface Company {
  nome: string;
  cnpj: string;
  endereco?: string;
  logo_base64?: string;
}

interface DocumentPreviewProps {
  content: string;
  tipo: string;
  clienteId?: string;
  terceiroId?: string;
  clienteNome: string;
  dadosJson: Record<string, unknown>;
  modeloUsado?: string;
  docId?: string | null;
  userPlano?: string;
  onNewGeneration: () => void;
}

// ── Content parser ────────────────────────────────────────────
type Block =
  | { type: 'title'; text: string }
  | { type: 'sectionHeader'; text: string }
  | { type: 'separator' }
  | { type: 'pageBreak' }
  | { type: 'listItem'; text: string }
  | { type: 'signatureLine'; text: string }
  | { type: 'body'; text: string }
  | { type: 'empty' };

function parseContent(raw: string): Block[] {
  const lines = raw.split('\n');
  const blocks: Block[] = [];
  let titleFound = false;
  let inSignatureZone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Linha em branco encerra um bloco de assinatura (nome/cpf vêm logo abaixo
    // da régua, sem linha vazia entre eles). Assim a zona não "vaza" pro resto.
    if (trimmed === '') { inSignatureZone = false; blocks.push({ type: 'empty' }); continue; }
    // Sentinela de quebra de página (só a proposta de banco M1 usa).
    if (trimmed === '[[PAGEBREAK]]') { inSignatureZone = false; blocks.push({ type: 'pageBreak' }); continue; }
    if (/^[═─]{6,}$/.test(trimmed)) { inSignatureZone = false; blocks.push({ type: 'separator' }); continue; }
    // Régua de assinatura = linha SÓ de underscores (com possíveis espaços, p/
    // duas assinaturas lado a lado). Inicia a zona. Campos de preenchimento
    // inline ("Consumo: ___ kWh") têm texto junto e NÃO contam — viram body.
    if (/^_{3,}[\s_]*$/.test(trimmed)) { inSignatureZone = true; blocks.push({ type: 'signatureLine', text: trimmed }); continue; }
    if (inSignatureZone) { blocks.push({ type: 'signatureLine', text: trimmed }); continue; }
    if (/^[a-z]\)\s/.test(trimmed) || /^—\s/.test(trimmed) || /^-\s/.test(trimmed)) { blocks.push({ type: 'listItem', text: trimmed }); continue; }
    if (!titleFound && trimmed === trimmed.toUpperCase() && trimmed.length > 10 && /[A-Z]/.test(trimmed)) { titleFound = true; blocks.push({ type: 'title', text: trimmed }); continue; }
    if (/^CLÁUSULA\s/i.test(trimmed) || /^\d+\.\s+[A-ZÁÉÍÓÚÂÊÎÔÛÀÇ]{3,}/.test(trimmed)) { blocks.push({ type: 'sectionHeader', text: trimmed }); continue; }
    blocks.push({ type: 'body', text: trimmed });
  }
  return blocks;
}

// ── Block renderer ────────────────────────────────────────────
function RenderBlock({ block, idx }: { block: Block; idx: number }) {
  switch (block.type) {
    case 'title': return <h1 className={styles.docTitle}>{block.text}</h1>;
    case 'sectionHeader': return <h2 className={styles.sectionHeader}>{block.text}</h2>;
    case 'separator': return <hr className={styles.separator} />;
    case 'pageBreak': return <div className={styles.pageBreak} aria-hidden="true" />;
    case 'listItem': return <p className={styles.listItem}>{block.text}</p>;
    case 'signatureLine': return <p className={styles.signatureLine}>{block.text}</p>;
    case 'body': return <p className={styles.bodyText}>{block.text}</p>;
    case 'empty': return <div className={styles.spacer} key={idx} />;
    default: return null;
  }
}

// ── Main component ────────────────────────────────────────────
export default function DocumentPreview({
  content,
  tipo,
  clienteId,
  terceiroId,
  clienteNome,
  dadosJson,
  modeloUsado,
  docId,
  userPlano,
  onNewGeneration,
}: DocumentPreviewProps) {
  const [company, setCompany] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [displayContent, setDisplayContent] = useState(content);
  const docRef = useRef<HTMLDivElement>(null);
  const uploadedRef = useRef(false);

  // PDF pré-aquecido pro compartilhamento nativo do iOS. Precisa estar PRONTO
  // antes do clique — navigator.share só roda no gesto, sem await antes (senão
  // o iOS derruba a "transient activation"). Ver downloadPdf.ts.
  const [pdfAsset, setPdfAsset] = useState<PdfAsset | null>(null);
  const [pdfState, setPdfState] = useState<'idle' | 'warming' | 'ready' | 'error'>('idle');
  const [shareMsg, setShareMsg] = useState('');

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company) setCompany(data.company);
    });
  }, []);

  // Upload HTML quando empresa carrega (necessário para download via servidor em todos os planos)
  useEffect(() => {
    if (!company || !docId || uploadedRef.current) return;
    uploadedRef.current = true;
    uploadHtml(docId, displayContent);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, docId]);

  // Pré-aquece o PDF assim que o doc está arquivado (HTML no Storage). O File
  // fica pronto pro navigator.share disparar no clique sem await. Re-aquece a
  // cada novo docId / após re-salvar (uploadedRef reseta e saved volta a true).
  const warmPdf = useCallback((id: string) => {
    setPdfState('warming');
    prewarmPdf(id)
      .then(asset => { setPdfAsset(asset); setPdfState('ready'); })
      .catch(() => { setPdfAsset(null); setPdfState('error'); });
  }, []);

  useEffect(() => {
    if (!docId || !saved) return;
    warmPdf(docId);
  }, [docId, saved, warmPdf]);

  const blocks = parseContent(displayContent);
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  function buildHtml(pageEl: HTMLElement): string {
    const s = styles;
    const css = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; orphans: 3; widows: 3; }
.${s.page} { width: 100%; padding: 1.5cm 2cm; min-height: 297mm; display: flex; flex-direction: column; }
.${s.companyHeader} { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
.${s.logo} { height: 48px; width: auto; object-fit: contain; flex-shrink: 0; }
.${s.companyInfo} { display: flex; flex-direction: column; gap: 1px; }
.${s.companyName} { font-size: 12pt; font-weight: 700; color: #1a1a1a; font-family: Arial, sans-serif; }
.${s.companyDetail} { font-size: 8pt; color: #555; font-family: Arial, sans-serif; }
.${s.headerDivider} { border: none; border-top: 2px solid #1a1a2e; margin: 8px 0 16px 0; }
.${s.docBody} { flex: 1; }
.${s.docTitle} { font-size: 12pt; font-weight: 700; text-align: center; text-transform: uppercase; color: #1a1a2e; margin: 0 0 16px 0; page-break-after: avoid; break-after: avoid; }
.${s.sectionHeader} { font-size: 9.5pt; font-weight: 700; text-transform: uppercase; color: #1a1a2e; margin: 12px 0 6px 0; padding-bottom: 2px; border-bottom: 1px solid #ccc; page-break-after: avoid; break-after: avoid; page-break-inside: avoid; break-inside: avoid; }
.${s.separator} { border: none; border-top: 1px solid #ccc; margin: 10px 0; }
.${s.bodyText} { margin: 0 0 5px 0; text-align: justify; color: #222; }
.${s.listItem} { margin: 3px 0 3px 18px; text-align: justify; color: #222; }
.${s.signatureLine} { font-family: Arial, sans-serif; font-size: 9pt; color: #333; margin: 3px 0; }
.${s.signatureBlock} { page-break-inside: avoid; break-inside: avoid; margin-top: 12px; }
.${s.pageBreak} { break-after: page; page-break-after: always; height: 0; }
.${s.spacer} { height: 6px; }
.${s.footer} { margin-top: 20px; padding-top: 6px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-family: Arial, sans-serif; font-size: 8pt; color: #999; }
@page { size: A4 portrait; margin: 1.5cm 1.5cm 2cm 1.5cm; }
@media print {
  html, body { background: #fff !important; }
  .${s.page} { padding: 0 !important; min-height: auto !important; display: block !important; }
  .${s.footer} { display: none !important; }
  .${s.pageBreak} { break-after: page !important; page-break-after: always !important; }
  .${s.signatureBlock} { page-break-inside: avoid !important; break-inside: avoid !important; }
  .${s.sectionHeader} { page-break-after: avoid !important; break-after: avoid !important; page-break-inside: avoid !important; break-inside: avoid !important; }
  .${s.bodyText}, .${s.listItem}, .${s.signatureLine} { page-break-inside: avoid; break-inside: avoid; }
}`.trim();
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>${clienteNome}</title><style>${css}</style></head><body>${pageEl.outerHTML}</body></html>`;
  }

  async function uploadHtml(id: string, currentContent: string): Promise<boolean> {
    const pageEl = docRef.current?.querySelector(`.${styles.page}`) as HTMLElement | null;
    if (!pageEl) return false;
    setSaving(true);
    try {
      await api.patch(`/documents/${id}/file`, {
        html_content: buildHtml(pageEl),
        content: currentContent,
      });
      setSaved(true);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }

  function handleConfirmEdit() {
    setDisplayContent(editedContent);
    setEditMode(false);
    setSaved(false);
    if (docId) {
      uploadedRef.current = false;
      setTimeout(() => uploadHtml(docId, editedContent), 100);
    }
  }

  function handleCancelEdit() {
    setEditedContent(displayContent);
    setEditMode(false);
  }


  async function handleDownloadPDF() {
    if (saving) {
      alert('Aguarde alguns segundos — o documento ainda está sendo arquivado.');
      return;
    }
    if (!docId) {
      alert('Documento ainda não foi salvo. Tente novamente em instantes.');
      return;
    }

    // CAMINHO FELIZ (iOS incluso): PDF já pré-aquecido → dispara a folha de
    // compartilhamento nativa SÍNCRONO no gesto (sem await antes), preservando a
    // transient activation. A folha nativa ("Salvar em Arquivos"/WhatsApp) abre
    // POR CIMA do app e devolve o controle ao fechar — impossível prender o PWA.
    if (pdfState === 'ready' && pdfAsset) {
      const r = await sharePrewarmedPdf(pdfAsset);
      if (r === 'shared' || r === 'downloaded') { setShareMsg(''); }
      return;
    }

    // PDF ainda aquecendo ou falhou: busca agora (no iOS o await pode derrubar a
    // ativação e o share cair no download — ainda funciona, sem prender). Mostra
    // "Preparando" pra dar feedback.
    setShareMsg('Preparando PDF...');
    try {
      const asset = await prewarmPdf(docId);
      setPdfAsset(asset); setPdfState('ready');
      await sharePrewarmedPdf(asset);
      setShareMsg('');
    } catch (err) {
      const e = err as { response?: { status?: number } };
      setShareMsg(e?.response?.status === 401 ? 'Sessão expirou. Faça login novamente.' : 'Não foi possível gerar o PDF. Tente de novo.');
      setTimeout(() => setShareMsg(''), 5000);
    }
  }

  return (
    <div className={styles.wrapper}>

      {/* ── Toolbar ─────────────────────────────────── */}
      <div className={styles.toolbar} id="no-print">
        <span className={styles.clientLabel}>
          Cliente: <strong>{clienteNome}</strong>
          {editMode && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
              Modo edição ativo
            </span>
          )}
        </span>
        <div className={styles.actions}>
          {editMode ? (
            <>
              <button
                className="btn-secondary"
                onClick={handleCancelEdit}
                style={{ borderColor: '#ef4444', color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <X size={15} /> Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmEdit}
                style={{ background: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Check size={15} /> Confirmar Edição
              </button>
            </>
          ) : (
            <>
              {saving ? (
                <span className={styles.savedBadge} style={{color:'#f59e0b'}}>Salvando...</span>
              ) : saved ? (
                <span className={styles.savedBadge}>Arquivado</span>
              ) : docId && userPlano !== 'free' ? (
                <button className="btn-secondary" onClick={() => uploadHtml(docId, displayContent)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Save size={15} /> Salvar
                </button>
              ) : null}
              <button
                className="btn-secondary"
                onClick={() => { setEditedContent(displayContent); setEditMode(true); }}
                title="Revisar e ajustar o documento antes de imprimir"
                style={{ borderColor: '#f59e0b', color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Pencil size={15} /> Editar
              </button>
              {/* Desabilitado enquanto aquece o PDF: força o iOS ao caminho
                  pré-aquecido (share síncrono no gesto) em vez do fallback com
                  await, que derrubaria a transient activation → download frágil. */}
              <button className={styles.pdfBtn} onClick={handleDownloadPDF} disabled={saving || pdfState === 'warming'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: (saving || pdfState === 'warming') ? 0.7 : 1 }}>
                <Download size={15} /> {saving ? 'Arquivando...' : pdfState === 'warming' ? 'Preparando...' : 'Baixar / Enviar'}
              </button>
              <button className="btn-secondary" onClick={onNewGeneration} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FilePlus size={15} /> Novo documento
              </button>
            </>
          )}
        </div>
        {shareMsg && (
          <div style={{ width: '100%', fontSize: 13, color: shareMsg.includes('Sessão') || shareMsg.includes('Não foi') ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
            {shareMsg}
          </div>
        )}
      </div>

      {/* ── Edit mode banner ──────────────────────────── */}
      {editMode && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 16,
          fontSize: 13,
          color: '#f59e0b',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span>
            <strong>Revisão antes da impressão.</strong> Edite o texto abaixo se necessário.
            Clique em <strong>Confirmar Edição</strong> para aplicar e depois imprima normalmente.
          </span>
        </div>
      )}

      {/* ── Document / Edit area ─────────────────────── */}
      {editMode ? (
        <div style={{ background: 'var(--surface, #0f172a)', borderRadius: 12, padding: 24 }}>
          <textarea
            value={editedContent}
            onChange={e => setEditedContent(e.target.value)}
            style={{
              width: '100%',
              minHeight: '75vh',
              background: '#fff',
              color: '#1a1a1a',
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 12,
              lineHeight: 1.8,
              padding: '2cm',
              border: '2px solid #f59e0b',
              borderRadius: 8,
              resize: 'vertical',
              outline: 'none',
              whiteSpace: 'pre-wrap',
            }}
          />
        </div>
      ) : (
        <div className={styles.pageWrapper} ref={docRef}>
          <div className={styles.page}>

            {/* Company header */}
            <header className={styles.companyHeader}>
              {company?.logo_base64 && (
                <img
                  src={company.logo_base64}
                  alt="Logo"
                  className={styles.logo}
                />
              )}
              <div className={styles.companyInfo}>
                <span className={styles.companyName}>{company?.nome || ''}</span>
                {company?.cnpj && (
                  <span className={styles.companyDetail}>CNPJ: {company.cnpj}</span>
                )}
                {company?.endereco && (
                  <span className={styles.companyDetail}>{company.endereco}</span>
                )}
              </div>
            </header>

            <div className={styles.headerDivider} />

            {/* Document body */}
            <div className={styles.docBody}>
              {(() => {
                // Agrupa CADA cluster contíguo de assinatura (régua + nome/cpf que
                // vêm logo abaixo) num signatureBlock próprio, com page-break-inside:
                // avoid — assim cada assinatura não racha entre páginas, sem engolir
                // o documento inteiro. Um doc pode ter vários clusters (a proposta de
                // banco tem 2 partes × 2 assinaturas); cada um vira um bloco isolado.
                const out: React.ReactNode[] = [];
                let i = 0;
                while (i < blocks.length) {
                  if (blocks[i].type === 'signatureLine') {
                    const start = i;
                    while (i < blocks.length && blocks[i].type === 'signatureLine') i++;
                    out.push(
                      <div className={styles.signatureBlock} key={`sig-${start}`}>
                        {blocks.slice(start, i).map((block, j) => (
                          <RenderBlock key={`s-${start}-${j}`} block={block} idx={start + j} />
                        ))}
                      </div>
                    );
                  } else {
                    out.push(<RenderBlock key={`b-${i}`} block={blocks[i]} idx={i} />);
                    i++;
                  }
                }
                return <>{out}</>;
              })()}
            </div>

            {/* Footer */}
            <footer className={styles.footer}>
              <span>Emitido em {today} · {company?.nome || ''}</span>
              <span>Pág. 1</span>
            </footer>
          </div>
        </div>
      )}

    </div>
  );
}
