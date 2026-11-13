'use client';

import { Check } from 'lucide-react';
import { IDS_ADICIONAIS, type IdAdicional, type ItemAdicional, type OfertaAdicionais } from '@/lib/loja/adicionais';
import styles from './assinar.module.css';

/**
 * O ORDER BUMP DO CHECKOUT DO PLANO MENSAL: as 4 ferramentas como adicional por mês, uma a uma ou no pacote.
 *
 * Só aparece com a oferta ligada (quem decide é a tela). Pacote e avulsas não convivem: marcar o pacote cobre as 4
 * (elas aparecem marcadas e travadas), e marcar a quarta avulsa vira o pacote, que sai mais barato. A api faz a mesma
 * troca, então a tela nunca mostra um total que não vai ser cobrado.
 *
 * Texto: redator, 13/11/2026.
 */

const CAIXAS: Record<IdAdicional, { nome: string; linha: string }> = {
  offgrid: { nome: 'Venda Off-Grid', linha: 'Dimensiona placas, inversor e baterias e monta a proposta completa com a sua marca.' },
  inventario: { nome: 'Estoque em Dia', linha: 'Controle de ferramentas, EPI e material por local, com aviso de repor e PDF para o contador.' },
  'curso-fechamento': { nome: 'Fecha Vendas', linha: 'Curso em texto com 32 respostas de objeção e 15 mensagens prontas de WhatsApp.' },
  'curso-limpapro': { nome: 'LimpaPro', linha: 'Curso para montar um serviço de limpeza de placas solares: técnica, segurança em altura e preço.' },
};

/** O que vai para a api: `['pacote']` ou as avulsas marcadas. */
export type Marcados = ItemAdicional[];

/** O valor mensal dos adicionais marcados, pelo preço do checkout. */
export function valorAdicionais(marcados: Marcados, oferta: OfertaAdicionais): number {
  if (marcados.includes('pacote')) return oferta.precos.pacoteCheckout;
  return marcados.length * oferta.precos.avulso;
}

export default function BumpAdicionais({ oferta, marcados, onMudar }: {
  oferta: OfertaAdicionais;
  marcados: Marcados;
  onMudar: (m: Marcados) => void;
}) {
  const { avulso, pacoteCheckout } = oferta.precos;
  const comPacote = marcados.includes('pacote');
  const avulsas = marcados.filter((m): m is IdAdicional => m !== 'pacote');
  const separadas = avulso * IDS_ADICIONAIS.length;

  const alternarPacote = () => onMudar(comPacote ? [] : ['pacote']);
  const alternar = (id: IdAdicional) => {
    const proximas = avulsas.includes(id) ? avulsas.filter((a) => a !== id) : [...avulsas, id];
    // As 4 uma a uma custam mais que o pacote: vira o pacote, como a api faria.
    onMudar(proximas.length >= IDS_ADICIONAIS.length ? ['pacote'] : proximas);
  };

  return (
    <fieldset className={styles.bump}>
      <legend className={styles.bumpTitulo}>Quer levar mais ferramentas?</legend>
      <p className={styles.bumpSub}>Opcional. Você usa enquanto pagar e cancela quando quiser.</p>

      <label className={`${styles.opcao} ${styles.opcaoPacote} ${comPacote ? styles.opcaoMarcada : ''}`}>
        <input type="checkbox" className={styles.opcaoInput} checked={comPacote} onChange={alternarPacote} />
        <span className={styles.opcaoCaixa} aria-hidden="true"><Check size={15} strokeWidth={3.2} /></span>
        <span className={styles.opcaoCorpo}>
          <span className={styles.opcaoTopo}>
            <span className={styles.opcaoSelo}>Pacote</span>
            <span className={styles.opcaoPreco}>+R$ {pacoteCheckout}/mês</span>
          </span>
          <span className={styles.opcaoNome}>As 4 ferramentas</span>
          <span className={styles.opcaoLinha}>Venda Off-Grid, Estoque em Dia, Fecha Vendas e LimpaPro.</span>
          <span className={styles.opcaoEconomia}>
            Separadas, seriam R$ {separadas}. Você economiza R$ {separadas - pacoteCheckout} por mês.
          </span>
        </span>
      </label>

      <div className={styles.opcoes}>
        {IDS_ADICIONAIS.map((id) => {
          const marcada = comPacote || avulsas.includes(id);
          return (
            <label key={id} className={`${styles.opcao} ${marcada ? styles.opcaoMarcada : ''} ${comPacote ? styles.opcaoNoPacote : ''}`}>
              <input
                type="checkbox"
                className={styles.opcaoInput}
                checked={marcada}
                disabled={comPacote}
                onChange={() => alternar(id)}
              />
              <span className={styles.opcaoCaixa} aria-hidden="true"><Check size={15} strokeWidth={3.2} /></span>
              <span className={styles.opcaoCorpo}>
                <span className={styles.opcaoTopo}>
                  <span className={styles.opcaoNome}>{CAIXAS[id].nome}</span>
                  <span className={styles.opcaoPreco}>+R$ {avulso}/mês</span>
                </span>
                <span className={styles.opcaoLinha}>{CAIXAS[id].linha}</span>
              </span>
            </label>
          );
        })}
      </div>

      {!comPacote && avulsas.length >= 2 && (
        <div className={styles.bumpAviso} role="status">
          <p>
            Você marcou {avulsas.length} ferramentas, R$ {avulsas.length * avulso} por mês. As 4 juntas saem por
            R$ {pacoteCheckout} por mês.
          </p>
          <button type="button" className={styles.bumpTrocar} onClick={() => onMudar(['pacote'])}>
            Trocar pelo pacote
          </button>
        </div>
      )}
    </fieldset>
  );
}
