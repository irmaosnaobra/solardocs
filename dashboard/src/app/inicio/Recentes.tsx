'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Banknote, Briefcase, ChevronRight, ClipboardCheck, FileSignature, FileText, Receipt, ScrollText, Wrench,
  type LucideIcon,
} from 'lucide-react';
import api from '@/services/api';
import { prewarmPdf, shareOrDownloadPdf } from '@/services/downloadPdf';
import { toBrasilia } from '@/utils/brasilia';

// Recentes da tela de atalhos (/inicio): os 3 últimos documentos da conta.
// Lê da MESMA rota que a tela Arquivos (/documents/list), sem filtro, pedindo só 3. O toque abre o
// documento do mesmo jeito que o "Abrir" de Arquivos. A seção só existe quando há o que mostrar: durante a
// carga, com a lista vazia ou se a chamada falhar, nada é desenhado e a tela segue sem ela.

/** Os mesmos nomes que a tela Arquivos usa (TIPO_LABEL em (dashboard)/historico/page.tsx). */
const TIPO_LABEL: Record<string, string> = {
  contratoSolar: 'Contrato Solar',
  proposta: 'Proposta',
  procuracao: 'Procuração',
  recibo: 'Recibo',
  prestacaoServico: 'Prestação de Serviço',
  contratoPJ: 'Contrato Vendedor',
  propostaBanco: 'Proposta Bancária',
  vistoria: 'Vistoria CheckList',
  propostaSolar: 'Proposta Solar',
  propostaOffGrid: 'Proposta Off-Grid',
};

/** O ícone de cada tipo é o do item de menu que cria aquele documento (itensMenu.ts); o resto é uma folha. */
const ICONE_DO_TIPO: Record<string, LucideIcon> = {
  contratoSolar: FileSignature,
  procuracao: ScrollText,
  recibo: Receipt,
  propostaBanco: Banknote,
  prestacaoServico: Wrench,
  contratoPJ: Briefcase,
  vistoria: ClipboardCheck,
};

interface DocumentoDaLista {
  id: string;
  tipo: string;
  cliente_nome: string | null;
  created_at: string;
  pdf_disponivel: boolean;
}

export interface Recente {
  id: string;
  /** O nome do cliente; sem cliente, o próprio tipo do documento. */
  titulo: string;
  /** "Proposta Solar · hoje, 9:40". */
  apoio: string;
  /** Falso enquanto o PDF ainda está sendo arquivado: Arquivos também não oferece "Abrir" nesse caso. */
  pdf: boolean;
  icone: LucideIcon;
}

/**
 * "hoje, 9:40", "ontem" ou "31/10" (com o ano de dois dígitos quando não é o ano de agora). O dia e a hora
 * são os de Brasília pelo mesmo ajuste que a tela Arquivos faz (toBrasilia), para as duas telas concordarem
 * sobre o dia do documento. Recebe o "agora" pronto: quem chama pega o relógio fora do render.
 */
export function dataCurta(iso: string | null | undefined, agora: number): string {
  if (!iso) return '';
  const d = toBrasilia(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date(agora - 3 * 3600 * 1000);
  const diaDe = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const dias = Math.round((diaDe(hoje) - diaDe(d)) / 86_400_000);
  // Zero ou menos é "hoje": o relógio do documento pode estar um pouco adiantado.
  if (dias <= 0) return `hoje, ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  if (dias === 1) return 'ontem';
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const ano = d.getUTCFullYear();
  return ano === hoje.getUTCFullYear() ? `${dia}/${mes}` : `${dia}/${mes}/${String(ano).slice(-2)}`;
}

function paraRecente(doc: DocumentoDaLista, agora: number): Recente {
  const tipo = TIPO_LABEL[doc.tipo] ?? doc.tipo;
  const cliente = (doc.cliente_nome ?? '').trim();
  const quando = dataCurta(doc.created_at, agora);
  return {
    id: doc.id,
    titulo: cliente || tipo,
    apoio: [cliente ? tipo : '', quando].filter(Boolean).join(' · '),
    pdf: !!doc.pdf_disponivel,
    icone: ICONE_DO_TIPO[doc.tipo] ?? FileText,
  };
}

/**
 * Os recentes e a função que os busca. A página chama `buscar` no mesmo efeito das outras chamadas (empresa e
 * conta), depois das checagens de PC e de login: assim a lista viaja junto e, na maioria das vezes, já chegou
 * quando a tela desenha. Estado só dentro do retorno da chamada.
 */
export function useRecentes() {
  const [itens, setItens] = useState<Recente[]>([]);
  const buscar = useCallback(() => {
    api.get('/documents/list', { params: { limit: 3, page: 1 }, timeout: 12000 })
      .then(({ data }) => {
        const agora = Date.now();
        const lista: DocumentoDaLista[] = Array.isArray(data?.documents) ? data.documents : [];
        setItens(lista.slice(0, 3).map((doc) => paraRecente(doc, agora)));
      })
      .catch(() => { /* sem a lista a tela segue normal: a seção só entra quando há o que mostrar */ });
  }, []);
  return { itens, buscar };
}

// Mesma regra de Arquivos: no iOS o PDF vai pela folha de compartilhar, porque abrir outra aba prende o app.
function ehIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iP(hone|od|ad)/.test(navigator.userAgent || '')) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export default function Recentes({ itens }: { itens: Recente[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);

  if (itens.length === 0) return null;

  // Sem texto de erro nesta tela: se o PDF não abrir, a pessoa cai em Arquivos, onde o documento tem as ações
  // completas e os avisos.
  const paraArquivos = () => router.push('/historico');

  async function baixar(id: string) {
    setOcupado(id);
    try {
      const r = await shareOrDownloadPdf(id);
      if (r === 'error') paraArquivos();
    } finally {
      setOcupado(null);
    }
  }

  // Igual ao "abrir" de Arquivos. O window.open vem antes de qualquer await: depois dele o navegador deixa de
  // contar o toque e bloqueia a aba.
  async function abrir(id: string) {
    if (ocupado) return;
    if (ehIOS()) { await baixar(id); return; }
    const aba = window.open('', '_blank');
    if (!aba) { await baixar(id); return; }
    setOcupado(id);
    try {
      const asset = await prewarmPdf(id);
      aba.location.href = URL.createObjectURL(new Blob([asset.blob], { type: 'application/pdf' }));
    } catch {
      aba.close();
      paraArquivos();
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="ini-secao ini-secaoRecentes" aria-labelledby="ini-recentes-titulo">
      <div className="ini-secaoTopo">
        <h2 id="ini-recentes-titulo" className="ini-titulo">Recentes</h2>
        <Link
          id="ini-recentes-ver"
          href="/historico"
          className="ini-verTodos"
          aria-labelledby="ini-recentes-ver ini-recentes-titulo"
        >
          Ver todos
        </Link>
      </div>
      <div className="ini-cartaoLista">
        <ul className="ini-lista ini-linhas" role="list">
          {itens.map((item) => {
            const conteudo = (
              <>
                <span className="ini-chip"><item.icone size={20} strokeWidth={2} aria-hidden="true" /></span>
                <span className="ini-linhaTextos">
                  <span className="ini-linhaNome">{item.titulo}</span>
                  {item.apoio && <span className="ini-linhaApoio">{item.apoio}</span>}
                </span>
                {ocupado === item.id
                  ? <span className="ini-giro" aria-hidden="true" />
                  : <ChevronRight className="ini-chevron" size={18} strokeWidth={2} aria-hidden="true" />}
              </>
            );
            return (
              <li key={item.id}>
                {item.pdf ? (
                  <button
                    type="button"
                    className="ini-linha ini-recente"
                    aria-busy={ocupado === item.id}
                    onClick={() => { void abrir(item.id); }}
                  >
                    {conteudo}
                  </button>
                ) : (
                  <Link href="/historico" className="ini-linha ini-recente">{conteudo}</Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
