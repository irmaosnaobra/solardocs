'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './DocumentPreview.module.css';
import api from '@/services/api';
import { getToken } from '@/services/auth';
import { slugifyDocName } from '@/utils/docFilename';
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

    if (trimmed === '') { blocks.push({ type: 'empty' }); continue; }
    if (/^[═─]{6,}$/.test(trimmed)) { blocks.push({ type: 'separator' }); continue; }
    if (trimmed.includes('___')) { inSignatureZone = true; blocks.push({ type: 'signatureLine', text: trimmed }); continue; }
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
.${s.spacer} { height: 6px; }
.${s.footer} { margin-top: 20px; padding-top: 6px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-family: Arial, sans-serif; font-size: 8pt; color: #999; }
@page { size: A4 portrait; margin: 1.5cm 1.5cm 2cm 1.5cm; }
@media print {
  html, body { background: #fff !important; }
  .${s.page} { padding: 0 !important; min-height: auto !important; display: block !important; }
  .${s.footer} { display: none !important; }
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
    if (!docId || saving) return;

    // Garante que o HTML está no Storage antes de pedir o PDF — evita race
    // condition em que o usuário clica antes do auto-upload completar.
    if (!saved) {
      const ok = await uploadHtml(docId, displayContent);
      if (!ok) {
        alert('Não conseguimos preparar o documento. Verifique sua conexão e tente novamente.');
        return;
      }
    }

    const token = getToken();
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    try {
      const res = await fetch(`${apiBase}/documents/${docId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const downloadName = slugifyDocName(tipo, clienteNome);

      // iOS Safari ignora <a download> em blob URLs — abre o PDF em nova aba
      // pra que o usuário use Compartilhar → Salvar em Arquivos.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (isIOS) {
        const win = window.open(url, '_blank');
        if (!win) {
          // Popup bloqueado: navega na própria aba
          window.location.href = url;
        }
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${downloadName}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('PDF download failed:', err);
      alert('Não foi possível gerar o PDF agora. Tente novamente em alguns segundos.');
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
              ✏️ Modo edição ativo
            </span>
          )}
        </span>
        <div className={styles.actions}>
          {editMode ? (
            <>
              <button
                className="btn-secondary"
                onClick={handleCancelEdit}
                style={{ borderColor: '#ef4444', color: '#ef4444' }}
              >
                ✕ Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmEdit}
                style={{ background: '#16a34a' }}
              >
                ✓ Confirmar Edição
              </button>
            </>
          ) : (
            <>
              {saving ? (
                <span className={styles.savedBadge} style={{color:'#f59e0b'}}>⏳ Salvando...</span>
              ) : saved ? (
                <span className={styles.savedBadge}>✓ Arquivado</span>
              ) : docId && userPlano !== 'free' ? (
                <button className="btn-secondary" onClick={() => uploadHtml(docId, displayContent)}>
                  💾 Salvar
                </button>
              ) : null}
              <button
                className="btn-secondary"
                onClick={() => { setEditedContent(displayContent); setEditMode(true); }}
                title="Revisar e ajustar o documento antes de imprimir"
                style={{ borderColor: '#f59e0b', color: '#f59e0b' }}
              >
                ✏️ Editar
              </button>
              <button className={styles.pdfBtn} onClick={handleDownloadPDF} disabled={saving}>
                {saving ? '⏳ Preparando...' : '⬇ Baixar PDF'}
              </button>
              <button className="btn-secondary" onClick={onNewGeneration}>
                Novo documento
              </button>
            </>
          )}
        </div>
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
          <span>⚠️</span>
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
                const sigStart = blocks.findIndex(b => b.type === 'signatureLine');
                if (sigStart === -1) {
                  return blocks.map((block, i) => (
                    <RenderBlock key={`b-${i}`} block={block} idx={i} />
                  ));
                }
                // Puxa a última cláusula/seção junto da assinatura: busca o último
                // sectionHeader antes da assinatura para que subam juntos se houver quebra.
                let keepStart = sigStart;
                for (let i = sigStart - 1; i >= 0; i--) {
                  if (blocks[i].type === 'sectionHeader') { keepStart = i; break; }
                }
                const before = blocks.slice(0, keepStart);
                const keep = blocks.slice(keepStart);
                return (
                  <>
                    {before.map((block, i) => (
                      <RenderBlock key={`b-${i}`} block={block} idx={i} />
                    ))}
                    <div className={styles.signatureBlock}>
                      {keep.map((block, i) => (
                        <RenderBlock key={`s-${i}`} block={block} idx={i} />
                      ))}
                    </div>
                  </>
                );
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
