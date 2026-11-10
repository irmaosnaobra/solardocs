'use client';

import { useMemo, useState } from 'react';
import { Copy, Check, MessageCircle } from 'lucide-react';
import { formatarQuantidade } from '@/lib/estoque/numero';
import { faltaAteMinimo, LIMITE_WHATSAPP, linkWhatsapp, textoListaCompra } from '@/lib/estoque/regras';
import type { Item } from '../tipos';
import Folha from './Folha';

/** Copia com a API moderna e, se o navegador recusar, com o jeito antigo (campo escondido). */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Lista de compra: o que está no mínimo ou abaixo, com quanto falta até o mínimo. */
export default function ListaCompra({
  itens,
  empresa,
  onFechar,
}: {
  itens: Item[];
  empresa?: string | null;
  onFechar: () => void;
}) {
  const [estado, setEstado] = useState<'' | 'copiado' | 'falhou'>('');
  // Copiar lista leva tudo; o link do WhatsApp leva só os primeiros itens.
  const texto = useMemo(() => textoListaCompra(itens, empresa), [itens, empresa]);
  const textoWhats = useMemo(() => textoListaCompra(itens, empresa, new Date(), LIMITE_WHATSAPP), [itens, empresa]);
  const passouDoLimite = itens.length > LIMITE_WHATSAPP;

  const copiarLista = async () => {
    setEstado((await copiar(texto)) ? 'copiado' : 'falhou');
    setTimeout(() => setEstado(''), 2500);
  };

  return (
    <Folha
      titulo="Lista de compra"
      subtitulo={itens.length === 1 ? '1 item no mínimo ou abaixo' : `${itens.length} itens no mínimo ou abaixo`}
      onFechar={onFechar}
    >
      {itens.length === 0 ? (
        <p className="est-dica">Nada para repor agora. Quando um item chegar ao mínimo, ele entra aqui.</p>
      ) : (
        <>
          <ul className="est-compra">
            {itens.map((i) => {
              const falta = faltaAteMinimo(i);
              return (
                <li key={i.id}>
                  <div>
                    <strong>{i.nome}</strong>
                    <span>{i.local}. Tem {formatarQuantidade(Number(i.quantidade) || 0)}, mínimo {formatarQuantidade(Number(i.estoque_minimo) || 0)}.</span>
                  </div>
                  <b>{falta > 0 ? `Faltam ${formatarQuantidade(falta)} ${i.unidade}` : 'No mínimo'}</b>
                </li>
              );
            })}
          </ul>
          <div className="est-dois">
            <button type="button" className="est-btn-sec" onClick={copiarLista}>
              {estado === 'copiado' ? <Check size={17} /> : <Copy size={17} />}
              {estado === 'copiado' ? 'Copiada' : 'Copiar lista'}
            </button>
            <a className="est-btn" href={linkWhatsapp(textoWhats)} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={17} /> Mandar no WhatsApp
            </a>
          </div>
          {passouDoLimite && (
            <p className="est-dica">A lista tem {itens.length} itens. Use Copiar lista para mandar todos.</p>
          )}
          {estado === 'falhou' && (
            <p className="est-erro-linha" role="alert">Não deu para copiar. Use o botão do WhatsApp ou selecione o texto.</p>
          )}
        </>
      )}
    </Folha>
  );
}
