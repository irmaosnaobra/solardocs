'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './DocumentPreview.module.css';
import api from '@/services/api';

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
  let inSignatureZone = false; // after the first ___ line, treat CAPS as signature labels

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (trimmed === '') {
      blocks.push({ type: 'empty' });
      continue;
    }

    // Separator line (═══ or ───)
    if (/^[═─]{6,}$/.test(trimmed)) {
      blocks.push({ type: 'separator' });
      continue;
    }

    // Signature line (contains ___)
    if (trimmed.includes('___')) {
      inSignatureZone = true;
      blocks.push({ type: 'signatureLine', text: trimmed });
      continue;
    }

    // In signature zone: render everything as signatureLine (labels, names, CPF/CNPJ)
    if (inSignatureZone) {
      blocks.push({ type: 'signatureLine', text: trimmed });
      continue;
    }

    // List item (starts with a) b) c) — or -)
    if (/^[a-z]\)\s/.test(trimmed) || /^—\s/.test(trimmed) || /^-\s/.test(trimmed)) {
      blocks.push({ type: 'listItem', text: trimmed });
      continue;
    }

    // Title: first ALL-CAPS non-empty line (min 10 chars, has letters)
    if (
      !titleFound &&
      trimmed === trimmed.toUpperCase() &&
      trimmed.length > 10 &&
      /[A-Z]/.test(trimmed)
    ) {
      titleFound = true;
      blocks.push({ type: 'title', text: trimmed });
      continue;
    }

    // Section header: explicit numbered clause or CLÁUSULA keyword only
    // (avoid marking arbitrary ALL-CAPS text like names/labels as headers)
    if (
      /^CLÁUSULA\s/i.test(trimmed) ||
      /^\d+\.\s+[A-ZÁÉÍÓÚÂÊÎÔÛÀÇ]{3,}/.test(trimmed)
    ) {
      blocks.push({ type: 'sectionHeader', text: trimmed });
      continue;
    }

    // Body
    blocks.push({ type: 'body', text: trimmed });
  }

  return blocks;
}

// ── Block renderer ────────────────────────────────────────────
function RenderBlock({ block, idx }: { block: Block; idx: number }) {
  switch (block.type) {
    case 'title':
      return <h1 className={styles.docTitle}>{block.text}</h1>;
    case 'sectionHeader':
      return <h2 className={styles.sectionHeader}>{block.text}</h2>;
    case 'separator':
      return <hr className={styles.separator} />;
    case 'listItem':
      return <p className={styles.listItem}>{block.text}</p>;
    case 'signatureLine':
      return <p className={styles.signatureLine}>{block.text}</p>;
    case 'body':
      return <p className={styles.bodyText}>{block.text}</p>;
    case 'empty':
      return <div className={styles.spacer} key={idx} />;
    default:
      return null;
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
  onNewGeneration,
}: DocumentPreviewProps) {
  const [company, setCompany] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company) setCompany(data.company);
    });
  }, []);

  const blocks = parseContent(content);
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  async function handleSave() {
    setSaving(true);
    try {
      const pageEl = docRef.current?.querySelector(`.${styles.page}`) as HTMLElement | null;
      let html_content: string | undefined;

      if (pageEl) {
        const s = styles;
        const css = `* { box-sizing: border-box; margin: 0; padding: 0; } html, body { background: #fff; } body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.7; color: #1a1a1a; } .${s.page} { width: 100%; padding: 2cm; min-height: 297mm; display: flex; flex-direction: column; } .${s.companyHeader} { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; } .${s.logo} { height: 52px; width: auto; object-fit: contain; flex-shrink: 0; } .${s.companyInfo} { display: flex; flex-direction: column; gap: 2px; } .${s.companyName} { font-size: 12.5pt; font-weight: 700; color: #1a1a1a; font-family: Arial, sans-serif; } .${s.companyDetail} { font-size: 8.5pt; color: #555; font-family: Arial, sans-serif; } .${s.headerDivider} { border: none; border-top: 2px solid #1a1a2e; margin: 10px 0 24px 0; } .${s.docBody} { flex: 1; } .${s.docTitle} { font-size: 12.5pt; font-weight: 700; text-align: center; text-transform: uppercase; color: #1a1a2e; margin: 0 0 22px 0; } .${s.sectionHeader} { font-size: 10pt; font-weight: 700; text-transform: uppercase; color: #1a1a2e; margin: 18px 0 8px 0; padding-bottom: 3px; border-bottom: 1px solid #ccc; } .${s.separator} { border: none; border-top: 1px solid #ccc; margin: 14px 0; } .${s.bodyText} { margin: 0 0 7px 0; text-align: justify; color: #222; } .${s.listItem} { margin: 4px 0 4px 18px; text-align: justify; color: #222; } .${s.signatureLine} { font-family: Arial, sans-serif; font-size: 9.5pt; color: #333; margin: 4px 0; } .${s.spacer} { height: 8px; } .${s.footer} { margin-top: 28px; padding-top: 8px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-family: Arial, sans-serif; font-size: 8pt; color: #999; }`;
        html_content = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>${clienteNome}</title><style>${css}</style></head><body>${pageEl.outerHTML}</body></html>`;
      }

      await api.post('/documents/save', {
        tipo,
        ...(clienteId ? { cliente_id: clienteId } : {}),
        ...(terceiroId ? { terceiro_id: terceiroId } : {}),
        cliente_nome: clienteNome,
        dados_json: dadosJson,
        content,
        modelo_usado: modeloUsado,
        html_content,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function handleDownloadPDF() {
    const pageEl = docRef.current?.querySelector(`.${styles.page}`) as HTMLElement | null;
    if (!pageEl) return;

    const s = styles;
    const css = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.7; color: #1a1a1a; }
.${s.page} { width: 100%; padding: 2cm; min-height: 297mm; display: flex; flex-direction: column; }
.${s.companyHeader} { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
.${s.logo} { height: 52px; width: auto; object-fit: contain; flex-shrink: 0; }
.${s.companyInfo} { display: flex; flex-direction: column; gap: 2px; }
.${s.companyName} { font-size: 12.5pt; font-weight: 700; color: #1a1a1a; font-family: Arial, sans-serif; letter-spacing: 0.02em; }
.${s.companyDetail} { font-size: 8.5pt; color: #555; font-family: Arial, sans-serif; }
.${s.headerDivider} { border: none; border-top: 2px solid #1a1a2e; margin: 10px 0 24px 0; }
.${s.docBody} { flex: 1; }
.${s.docTitle} { font-size: 12.5pt; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 0.06em; color: #1a1a2e; margin: 0 0 22px 0; line-height: 1.4; }
.${s.sectionHeader} { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #1a1a2e; margin: 18px 0 8px 0; padding-bottom: 3px; border-bottom: 1px solid #ccc; }
.${s.separator} { border: none; border-top: 1px solid #ccc; margin: 14px 0; }
.${s.bodyText} { margin: 0 0 7px 0; text-align: justify; hyphens: auto; color: #222; }
.${s.listItem} { margin: 4px 0 4px 18px; text-align: justify; color: #222; }
.${s.signatureLine} { font-family: Arial, sans-serif; font-size: 9.5pt; color: #333; margin: 4px 0; letter-spacing: 0.02em; }
.${s.spacer} { height: 8px; }
.${s.footer} { margin-top: 28px; padding-top: 8px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; font-family: Arial, sans-serif; font-size: 8pt; color: #999; }
@page { size: A4 portrait; margin: 2cm 2cm 2.5cm 2cm; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .${s.page} { padding: 0 !important; min-height: auto !important; }
  .${s.footer} { display: none !important; }
}`.trim();

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Documento</title>
  <style>${css}</style>
</head>
<body>
  ${pageEl.outerHTML}
  <script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body>
</html>`;

    // Usa blob URL em vez de window.open vazio — evita bloqueio de popup
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      // Fallback: download direto como .html se popup bloqueado
      const a = document.createElement('a');
      a.href = url;
      a.download = `documento-${clienteNome.replace(/\s+/g, '-').toLowerCase()}.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <div className={styles.wrapper}>

      {/* ── Toolbar ─────────────────────────────────── */}
      <div className={styles.toolbar} id="no-print">
        <span className={styles.clientLabel}>
          Cliente: <strong>{clienteNome}</strong>
        </span>
        <div className={styles.actions}>
          {!saved ? (
            <button className="btn-secondary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : '💾 Salvar'}
            </button>
          ) : (
            <span className={styles.savedBadge}>✓ Salvo</span>
          )}
          <button className={styles.pdfBtn} onClick={handleDownloadPDF}>
            ⬇ Baixar PDF
          </button>
          <button className="btn-primary" onClick={onNewGeneration}>
            Novo documento
          </button>
        </div>
      </div>

      {/* ── Document ─────────────────────────────────── */}
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
            {blocks.map((block, i) => (
              <RenderBlock key={i} block={block} idx={i} />
            ))}
          </div>

          {/* Footer — visible on screen preview; replaced by @page margin box on print */}
          <footer className={styles.footer}>
            <span>Emitido em {today} · {company?.nome || ''}</span>
            <span>Pág. 1</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
