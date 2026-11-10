'use client';

// Bloco de texto pronto, com "Copiar" e, nas mensagens de WhatsApp, "Mandar no
// WhatsApp". Usado nas lições e nas Respostas rápidas.
//
// O aviso de "Copiado" não é enfeite: o integrador está com o cliente esperando
// resposta. Sem retorno na tela ele clica de novo, não sabe se pegou e cola duas
// vezes no WhatsApp. A região é aria-live para o leitor de tela também avisar.

import { useRef, useState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import styles from '../curso.module.css';

/** Link do WhatsApp sem número: a pessoa escolhe para quem mandar. */
export const linkWhatsapp = (texto: string): string => `https://wa.me/?text=${encodeURIComponent(texto)}`;

type Estado = 'parado' | 'copiado' | 'falhou';

async function copiarParaAreaDeTransferencia(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai no plano B */
  }
  // Plano B: navegador sem a API, ou sem permissão (página sem HTTPS, webview).
  try {
    const campo = document.createElement('textarea');
    campo.value = texto;
    campo.setAttribute('readonly', '');
    campo.style.position = 'fixed';
    campo.style.opacity = '0';
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(campo);
    return ok;
  } catch {
    return false;
  }
}

export default function Destaque({
  rotulo, texto, tom, copiar, zap,
}: {
  rotulo: string;
  texto: string;
  tom?: 'zap';
  copiar?: boolean;
  /** Mostra "Mandar no WhatsApp" (só para mensagem de WhatsApp). */
  zap?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>('parado');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function aoCopiar() {
    const ok = await copiarParaAreaDeTransferencia(texto);
    setEstado(ok ? 'copiado' : 'falhou');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setEstado('parado'), 2200);
  }

  return (
    <div className={tom === 'zap' ? styles.zap : styles.script}>
      <div className={styles.destaqueTopo}>
        <span className={tom === 'zap' ? styles.rotuloZap : styles.rotuloScript}>{rotulo}</span>
      </div>
      <p className={styles.destaqueTexto}>{texto}</p>
      {(copiar || zap) && (
        <div className={styles.destaqueAcoes}>
          {copiar && (
            <button type="button" className={styles.btnCopiar} onClick={aoCopiar}>
              {estado === 'copiado' ? <Check size={16} /> : <Copy size={16} />} Copiar
            </button>
          )}
          {zap && (
            <a className={styles.btnZap} href={linkWhatsapp(texto)} target="_blank" rel="noopener noreferrer">
              <Send size={16} /> Mandar no WhatsApp
            </a>
          )}
          <span
            className={estado === 'falhou' ? `${styles.copiadoMsg} ${styles.copiadoMsgErro}` : styles.copiadoMsg}
            aria-live="polite"
            role="status"
          >
            {estado === 'copiado' ? 'Copiado' : estado === 'falhou' ? 'Não deu para copiar. Selecione o texto.' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
