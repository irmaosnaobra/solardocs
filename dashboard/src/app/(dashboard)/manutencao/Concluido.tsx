'use client';

import { useState } from 'react';
import { ArrowLeft, Copy, Download, ExternalLink, Pencil, Send, Trash2 } from 'lucide-react';
import { SeloChip } from './Comum';
import {
  SELOS, codigoVisivel, dataCurta, dataLonga, logUso, mensagemWhatsApp,
  type Linha, type Resumo,
} from './tipos';

export default function Concluido({
  linha, resumo, empresa, ocupado, erro, onReabrir, onExcluir, onSair,
}: {
  linha: Linha;
  resumo: Resumo | null;
  empresa: string;
  ocupado: boolean;
  erro: string;
  onReabrir: () => void;
  onExcluir: () => void;
  onSair: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const link = `${window.location.origin}/m/${linha.id}`;
  const selo = linha.selo || resumo?.selo || null;
  const proxima = linha.proxima_visita || resumo?.proxima_visita || null;
  const pendencias = resumo?.pendencias.length ?? null;

  function copiar() {
    logUso('link');
    navigator.clipboard?.writeText(link)
      .then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2200); })
      .catch(() => {});
  }

  const texto = mensagemWhatsApp(
    linha.cliente_nome || 'tudo bem',
    empresa || 'nossa equipe',
    proxima ? dataLonga(proxima) : 'a combinar',
    link,
  );

  return (
    <div className="mnt-page">
      <button type="button" className="mnt-voltar" onClick={onSair}><ArrowLeft size={18} /> Relatórios</button>

      <section className="mnt-card mnt-concluido">
        <p className="mnt-codigo">{codigoVisivel(linha.codigo)}</p>
        <h1 className="mnt-titulo">{linha.cliente_nome || 'Cliente sem nome'}</h1>
        <SeloChip selo={selo} grande />
        {selo && <p className="mnt-seloFrase">{SELOS[selo].frase}</p>}

        <dl className="mnt-fatos">
          <div><dt>Inspeção</dt><dd>{dataCurta(linha.data_inspecao)}</dd></div>
          <div><dt>Próxima visita</dt><dd>{proxima ? dataLonga(proxima) : 'A combinar'}</dd></div>
          {pendencias != null && <div><dt>Pendências</dt><dd>{pendencias}</dd></div>}
        </dl>

        <div className="mnt-acoes">
          <button type="button" className="mnt-btn mnt-btnPrimary" onClick={copiar}>
            <Copy size={18} /> {copiado ? 'Link copiado.' : 'Copiar link'}
          </button>
          <a className="mnt-btn mnt-btnWa" target="_blank" rel="noopener noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(texto)}`} onClick={() => logUso('whatsapp')}>
            <Send size={18} /> Enviar pelo WhatsApp
          </a>
          <a className="mnt-btn mnt-btnGhost" target="_blank" rel="noopener noreferrer"
            href={`/m/${linha.id}/pdf`} onClick={() => logUso('pdf')}>
            <Download size={18} /> Baixar PDF
          </a>
          <a className="mnt-btn mnt-btnGhost" target="_blank" rel="noopener noreferrer" href={`/m/${linha.id}`}>
            <ExternalLink size={18} /> Abrir relatório
          </a>
        </div>

        {erro && <p className="mnt-erro" role="alert">{erro}</p>}

        <div className="mnt-acoes mnt-acoesFim">
          <button type="button" className="mnt-btn mnt-btnGhost" disabled={ocupado} onClick={onReabrir}>
            <Pencil size={18} /> Reabrir para editar
          </button>
          <button type="button" className="mnt-btn mnt-btnPerigo" disabled={ocupado} onClick={onExcluir}>
            <Trash2 size={18} /> Excluir relatório
          </button>
        </div>
      </section>
    </div>
  );
}
