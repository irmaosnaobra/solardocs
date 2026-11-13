'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Check, Clock } from 'lucide-react';
import { PRODUTOS_DA_LOJA } from '@/lib/loja/catalogo';
import {
  cancelarAdicional, diaMes, recarregarAdicionais, type AdicionalAtivo,
} from '@/lib/loja/adicionais';
import { recarregarAcessos } from '@/hooks/useAcessos';
import s from './Adicional.module.css';

/**
 * As peças da venda mensal dentro do app (só com a oferta ligada): o cartão do pacote e o estado de quem já paga,
 * com o Cancelar confirmado na própria tela (o visualizador do app não mostra `confirm()`).
 *
 * Texto: redator, 13/11/2026.
 */

/** "As 4 ferramentas por R$ 40 por mês", com o botão de compra. `jaPagaAvulsas` mostra a nota da troca. */
export function CartaoPacote({ preco, avulso, jaPagaAvulsas, onComprar }: {
  preco: number;
  avulso: number;
  jaPagaAvulsas: boolean;
  onComprar: () => void;
}) {
  const separadas = avulso * PRODUTOS_DA_LOJA.length;
  return (
    <section className={s.pacote} aria-labelledby="pacote-titulo">
      <div className={s.pacoteCapas} aria-hidden="true">
        {PRODUTOS_DA_LOJA.map((p) => (
          <span key={p.id}><Image src={p.imagem} alt="" fill sizes="64px" /></span>
        ))}
      </div>
      <div className={s.pacoteTexto}>
        <h3 id="pacote-titulo">As 4 ferramentas por R$ {preco} por mês</h3>
        <p>
          Venda Off-Grid, Estoque em Dia, Fecha Vendas e LimpaPro. Uma a uma, seriam R$ {separadas}. Você economiza
          R$ {separadas - preco} por mês.
        </p>
        {jaPagaAvulsas && <p className={s.pacoteNota}>As ferramentas avulsas que você já paga saem da cobrança e entram no pacote.</p>}
      </div>
      <button type="button" className={s.pacoteBtn} onClick={onComprar}>Quero as 4 por R$ {preco} por mês</button>
    </section>
  );
}

/** O selo e a frase de um adicional que a conta paga. Serve à página de venda e ao cartão da loja. */
export function textoDoAtivo(ativo: AdicionalAtivo, nome: string): { titulo: string; texto: string } {
  const data = diaMes(ativo.renovaEm);
  if (ativo.cancelado) {
    return { titulo: `Cancelado, acesso até ${data}`, texto: 'Você não será cobrado de novo. O acesso fica até essa data.' };
  }
  if (ativo.id === 'pacote') {
    return { titulo: `Pacote ativo, renova em ${data}`, texto: 'As 4 ferramentas estão ativas. Cancele quando quiser e use até o fim do mês pago.' };
  }
  return { titulo: `Ativo, renova em ${data}`, texto: `O ${nome} está ativo. Cancele quando quiser e use até o fim do mês pago.` };
}

export function SeloAtivo({ ativo, nome }: { ativo: AdicionalAtivo; nome: string }) {
  const { titulo } = textoDoAtivo(ativo, nome);
  return (
    <span className={`${s.selo} ${ativo.cancelado ? s.seloCancelado : ''}`}>
      {ativo.cancelado ? <Clock size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
      {titulo}
    </span>
  );
}

type Passo = 'parado' | 'confirmando' | 'enviando' | 'feito' | 'erro';

/**
 * Estado de quem paga o adicional: selo, a ação de abrir (vem de fora), Cancelar e a frase. O Cancelar abre a
 * confirmação logo abaixo, na mesma tela; "Manter" fecha sem mexer em nada.
 */
export function EstadoAdicional({ ativo, nome, abrir, compacto = false }: {
  ativo: AdicionalAtivo;
  /** Nome do produto da página ("Estoque em Dia"). No pacote, as frases são as do pacote. */
  nome: string;
  abrir: ReactNode;
  compacto?: boolean;
}) {
  const [passo, setPasso] = useState<Passo>('parado');
  const [ate, setAte] = useState('');
  const tituloRef = useRef<HTMLParagraphElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const pacote = ativo.id === 'pacote';
  const data = diaMes(ativo.renovaEm);
  const { texto } = textoDoAtivo(ativo, nome);
  const idTitulo = `cancelar-${ativo.id}${compacto ? '-c' : ''}`;

  // Abriu a confirmação: o foco vai para a pergunta, e o leitor de tela lê o que vai acontecer.
  useEffect(() => { if (passo === 'confirmando') tituloRef.current?.focus(); }, [passo]);

  const confirmar = async () => {
    setPasso('enviando');
    try {
      await cancelarAdicional(ativo.id);
      setAte(data);
      setPasso('feito');
      await recarregarAdicionais();
      recarregarAcessos(true);
    } catch {
      setPasso('erro');
    }
  };

  const manter = () => { setPasso('parado'); window.setTimeout(() => cancelarRef.current?.focus(), 0); };

  return (
    <div className={`${s.estado} ${compacto ? s.estadoCompacto : ''}`}>
      <SeloAtivo ativo={ativo} nome={nome} />
      <div className={s.estadoAcoes}>
        {abrir}
        {!ativo.cancelado && passo !== 'feito' && passo !== 'confirmando' && passo !== 'enviando' && (
          <button ref={cancelarRef} type="button" className={s.btnCancelar} onClick={() => setPasso('confirmando')}>
            Cancelar
          </button>
        )}
      </div>

      {(passo === 'confirmando' || passo === 'enviando') && (
        <div className={s.confirma} role="group" aria-labelledby={idTitulo}>
          <p id={idTitulo} ref={tituloRef} tabIndex={-1} className={s.confirmaTitulo}>
            {pacote ? 'Cancelar o pacote?' : `Cancelar o ${nome}?`}
          </p>
          <p className={s.confirmaTexto}>
            {pacote
              ? `Você não será cobrado de novo. As 4 ferramentas continuam até ${data}, o fim do mês que você já pagou.`
              : `Você não será cobrado de novo. O acesso continua até ${data}, o fim do mês que você já pagou.`}
          </p>
          <div className={s.confirmaBotoes}>
            <button type="button" className={s.btnSim} onClick={confirmar} disabled={passo === 'enviando'}>
              {passo === 'enviando' ? <span className={s.giro} aria-hidden="true" /> : null}
              Sim, cancelar
            </button>
            <button type="button" className={s.btnManter} onClick={manter} disabled={passo === 'enviando'}>Manter</button>
          </div>
        </div>
      )}

      {passo === 'feito' && (
        <p className={s.feito} role="status">Cancelado. Você usa o {pacote ? 'pacote' : nome} até {ate}.</p>
      )}
      {passo === 'erro' && (
        <p className={s.erro} role="alert">
          Não consegui cancelar. Tente de novo, ou chame a gente no WhatsApp (34) 99816-5040.
        </p>
      )}

      {passo !== 'feito' && <p className={s.estadoTexto}>{texto}</p>}
    </div>
  );
}
