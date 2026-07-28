'use client';

import { useState, useEffect } from 'react';
import {
  MessageSquareQuote, Map, Calculator, FileSignature, Send, Repeat,
  Check, ChevronLeft, Lock, Sparkles, ArrowRight, Download, FileSpreadsheet,
} from 'lucide-react';
import Link from 'next/link';
import api from '@/services/api';
import styles from './materiais.module.css';
import { OBJECOES, TOTAL_OBJECOES } from './_conteudo/objecoes';
import { ROTEIRO, CINCO_PERGUNTAS } from './_conteudo/roteiro';
import { ESTRUTURA_CUSTO, REGRAS_DE_MARGEM, CHECKLIST_ORCAMENTO } from './_conteudo/precificacao';
import { PROSPECCAO, TOTAL_MENSAGENS } from './_conteudo/prospeccao';
import { POS_VENDA, GARANTIAS } from './_conteudo/posvenda';

// Kit de Fechamento do Integrador — área de consumo DENTRO da plataforma.
// É de propósito que o material more aqui e não num PDF por e-mail: o comprador
// da isca volta todo dia pra ler, e a cada visita vê o gerador de documentos
// funcionando ao lado. É a etapa que transforma comprador de R$27 em assinante.
// (O PDF existe também — mas como download DAQUI, não como a entrega inteira.)

const LP_KIT = 'https://solardoc.app/kit';

interface Acesso {
  temKit: boolean;
  itens: string[];
  trialVipAte: string | null;
  plano: string;
  packTrialUntil: string | null;
  progresso: string[];
}

type ModuloSlug = 'objecoes' | 'roteiro' | 'precificacao' | 'prospeccao' | 'posvenda' | 'documentos';

const MODULOS: {
  slug: ModuloSlug;
  n: number;
  titulo: string;
  resumo: string;
  meta: string;
  icon: typeof MessageSquareQuote;
  pdf?: string;
}[] = [
  {
    slug: 'objecoes',
    n: 1,
    titulo: 'As objeções que travam a venda',
    resumo: 'O que responder quando o cliente diz que achou mais barato, que vai pensar ou que tem medo de a empresa fechar.',
    meta: `${TOTAL_OBJECOES} respostas prontas`,
    icon: MessageSquareQuote,
    pdf: 'modulo-1-objecoes.pdf',
  },
  {
    slug: 'roteiro',
    n: 2,
    titulo: 'Da primeira ligação à assinatura',
    resumo: 'O caminho inteiro da visita técnica, com o que falar em cada etapa e o erro que mata a venda em cada uma.',
    meta: `${ROTEIRO.length} etapas + as 5 perguntas`,
    icon: Map,
    pdf: 'modulo-2-roteiro-da-visita.pdf',
  },
  {
    slug: 'precificacao',
    n: 3,
    titulo: 'Preço e margem sem chute',
    resumo: 'Para onde vai cada real do orçamento, quanto sobra de verdade e o checklist antes de mandar a proposta.',
    meta: `${ESTRUTURA_CUSTO.length} linhas de custo + planilha`,
    icon: Calculator,
    pdf: 'modulo-3-preco-e-margem.pdf',
  },
  {
    slug: 'documentos',
    n: 4,
    titulo: 'Contrato, procuração e vistoria',
    resumo: 'Os três documentos que todo integrador precisa — gerados com o CNPJ e a logo da sua empresa, prontos para assinar.',
    meta: 'gerar na plataforma',
    icon: FileSignature,
  },
  {
    slug: 'prospeccao',
    n: 5,
    titulo: 'Prospecção e follow-up',
    resumo: 'Mensagens prontas para o primeiro contato, para o follow-up depois da proposta e para reativar orçamento antigo.',
    meta: `${TOTAL_MENSAGENS} mensagens prontas`,
    icon: Send,
    pdf: 'modulo-5-prospeccao.pdf',
  },
  {
    slug: 'posvenda',
    n: 6,
    titulo: 'Pós-venda, garantia e recorrência',
    resumo: 'As cinco janelas depois do sim, o que dizer em cada uma e como separar as três garantias que o cliente pergunta.',
    meta: `${POS_VENDA.length} janelas + garantias`,
    icon: Repeat,
    pdf: 'modulo-6-pos-venda.pdf',
  },
];

function abrirUpgrade() {
  window.dispatchEvent(new CustomEvent('limit-reached'));
}

export default function MateriaisPage() {
  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState<ModuloSlug | null>(null);
  const [feitos, setFeitos] = useState<string[]>([]);

  useEffect(() => {
    api
      .get('/kit/meu-acesso')
      .then(({ data }) => {
        setAcesso(data);
        setFeitos(data.progresso ?? []);
      })
      .catch(() => setAcesso(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (aberto) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [aberto]);

  // Assinante pagante tem o material incluso — pra ele o kit é conteúdo de
  // retenção, não isca. Só o free que nunca comprou vê a oferta.
  const liberado = !!acesso && (acesso.temKit || acesso.plano === 'pro' || acesso.plano === 'ilimitado');
  const emTrialDoBump = !!acesso?.packTrialUntil && new Date(acesso.packTrialUntil) > new Date();
  const mostrarConviteVip = !!acesso && (acesso.plano === 'free' || emTrialDoBump);

  function alternarConcluido(slug: string) {
    const jaFeito = feitos.includes(slug);
    setFeitos((prev) => (jaFeito ? prev.filter((s) => s !== slug) : [...prev, slug]));
    api.post('/kit/progresso', { modulo: slug, concluido: !jaFeito }).catch(() => {});
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Meus Materiais</h1>
        </div>
        <p className={styles.subtitle}>Carregando…</p>
      </div>
    );
  }

  if (!liberado) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Meus Materiais</h1>
          <p className={styles.subtitle}>Treinamentos e ferramentas comerciais liberados na sua conta.</p>
        </div>
        <div className={styles.locked}>
          <Lock size={40} className={styles.lockedIcon} strokeWidth={1.5} />
          <h2 className={styles.lockedTitle}>Você ainda não tem o Kit de Fechamento</h2>
          <p className={styles.lockedText}>
            São {TOTAL_OBJECOES} respostas prontas para as objeções que mais travam venda de energia solar,
            {' '}{TOTAL_MENSAGENS} mensagens de prospecção e follow-up, o roteiro completo da visita até a
            assinatura e a estrutura de custo que mostra quanto realmente sobra em cada projeto.
          </p>
          <a href={LP_KIT} className={styles.lockedCta} target="_blank" rel="noopener noreferrer">
            Ver o kit <ArrowRight size={16} />
          </a>
          <p className={styles.lockedNota}>
            Já é assinante PRO ou VIP? O material entra junto no seu plano.
          </p>
        </div>
      </div>
    );
  }

  if (aberto) {
    const mod = MODULOS.find((m) => m.slug === aberto)!;
    const concluido = feitos.includes(aberto);
    return (
      <div className={styles.page}>
        <button className={styles.voltar} onClick={() => setAberto(null)}>
          <ChevronLeft size={16} /> Todos os materiais
        </button>

        <div className={styles.moduloHead}>
          <div className={styles.moduloHeadTxt}>
            <span className={styles.moduloTag}>Módulo {mod.n}</span>
            <h1 className={styles.title}>{mod.titulo}</h1>
            <p className={styles.subtitle}>{mod.resumo}</p>
          </div>
          {mod.pdf && (
            <a className={styles.btnBaixar} href={`/kit/downloads/${mod.pdf}`} download>
              <Download size={16} /> Baixar em PDF
            </a>
          )}
        </div>

        {aberto === 'objecoes' && <ConteudoObjecoes />}
        {aberto === 'roteiro' && <ConteudoRoteiro />}
        {aberto === 'precificacao' && <ConteudoPrecificacao />}
        {aberto === 'prospeccao' && <ConteudoProspeccao />}
        {aberto === 'posvenda' && <ConteudoPosVenda />}
        {aberto === 'documentos' && <ConteudoDocumentos />}

        <div className={styles.rodapeModulo}>
          <button
            className={concluido ? styles.btnFeito : styles.btnMarcar}
            onClick={() => alternarConcluido(aberto)}
          >
            <Check size={16} /> {concluido ? 'Concluído' : 'Marcar como concluído'}
          </button>
        </div>

        {mostrarConviteVip && <ConviteVip emTrial={emTrialDoBump} ate={acesso?.packTrialUntil ?? null} />}
      </div>
    );
  }

  const progressoPct = Math.round(
    (feitos.filter((f) => MODULOS.some((m) => m.slug === f)).length / MODULOS.length) * 100,
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Meus Materiais</h1>
        <p className={styles.subtitle}>
          Kit de Fechamento do Integrador — leia direto aqui, na mesma tela em que você gera os documentos,
          ou baixe em PDF para levar para a visita.
        </p>
      </div>

      <div className={styles.progressoWrap}>
        <div className={styles.progressoBar}>
          <div className={styles.progressoFill} style={{ width: `${progressoPct}%` }} />
        </div>
        <span className={styles.progressoLabel}>{progressoPct}% concluído</span>
      </div>

      <div className={styles.grid}>
        {MODULOS.map((m) => {
          const feito = feitos.includes(m.slug);
          return (
            <div key={m.slug} className={styles.card}>
              <button className={styles.cardBtn} onClick={() => setAberto(m.slug)}>
                <div className={styles.cardCapa}>
                  <m.icon size={26} strokeWidth={1.6} className={styles.cardIcon} />
                  <span className={styles.cardNum}>{String(m.n).padStart(2, '0')}</span>
                  {feito && <span className={styles.selo}><Check size={12} /> concluído</span>}
                </div>
                <h2 className={styles.cardTitulo}>{m.titulo}</h2>
                <p className={styles.cardResumo}>{m.resumo}</p>
                <span className={styles.cardMeta}>{m.meta}</span>
              </button>
              {m.pdf && (
                <a className={styles.cardBaixar} href={`/kit/downloads/${m.pdf}`} download>
                  <Download size={14} /> PDF
                </a>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.extras}>
        <h2 className={styles.extrasTitulo}>Para baixar e usar hoje</h2>
        <div className={styles.extrasGrid}>
          <a className={styles.extra} href="/kit/downloads/planilha-precificacao-solar.csv" download>
            <FileSpreadsheet size={20} className={styles.extraIcon} />
            <div>
              <strong>Planilha de precificação</strong>
              <span>Abre no Excel ou no Google Sheets. Preenche o custo, ela devolve o preço com a sua margem.</span>
            </div>
            <Download size={16} className={styles.extraSeta} />
          </a>
          <a className={styles.extra} href="/kit/downloads/modulo-1-objecoes.pdf" download>
            <Download size={20} className={styles.extraIcon} />
            <div>
              <strong>Objeções em PDF</strong>
              <span>Para abrir no celular na porta do cliente, mesmo sem internet.</span>
            </div>
            <Download size={16} className={styles.extraSeta} />
          </a>
        </div>
      </div>

      {mostrarConviteVip && <ConviteVip emTrial={emTrialDoBump} ate={acesso?.packTrialUntil ?? null} />}
    </div>
  );
}

// ── Convite pro VIP ─────────────────────────────────────────────────────────
// Aparece no fim do material, não como banner no topo: quem acabou de ler um
// módulo é quem está mais perto de entender por que a plataforma vale a pena.
function ConviteVip({ emTrial, ate }: { emTrial: boolean; ate: string | null }) {
  const dias = ate ? Math.max(0, Math.ceil((new Date(ate).getTime() - Date.now()) / 86400000)) : 0;
  return (
    <div className={styles.convite}>
      <Sparkles size={20} className={styles.conviteIcon} strokeWidth={1.75} />
      <div>
        <h3 className={styles.conviteTitulo}>
          {emTrial
            ? `Seu acesso VIP termina em ${dias} ${dias === 1 ? 'dia' : 'dias'}`
            : 'O contrato que você acabou de ler, pronto em 30 segundos'}
        </h3>
        <p className={styles.conviteTexto}>
          {emTrial
            ? 'Enquanto ele durar, seus documentos são ilimitados. Assinando o VIP por R$ 67/mês você não perde o acesso nem os documentos que já gerou.'
            : 'No VIP você gera contrato, procuração, recibo e proposta sem limite mensal, todos com a logo e o CNPJ da sua empresa.'}
        </p>
        <button className={styles.conviteCta} onClick={abrirUpgrade}>
          Ver o plano VIP <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Módulo 1 ────────────────────────────────────────────────────────────────
function ConteudoObjecoes() {
  return (
    <div className={styles.conteudo}>
      {OBJECOES.map((grupo) => (
        <section key={grupo.slug} className={styles.secao}>
          <h2 className={styles.secaoTitulo}>{grupo.titulo}</h2>
          <p className={styles.secaoDesc}>{grupo.descricao}</p>

          {grupo.itens.map((o) => (
            <article key={o.id} className={styles.objecao}>
              <p className={styles.gatilho}>&ldquo;{o.gatilho}&rdquo;</p>
              <div className={styles.linha}>
                <span className={styles.rotulo}>O que ele quer dizer</span>
                <p className={styles.texto}>{o.traducao}</p>
              </div>
              <div className={styles.linha}>
                <span className={styles.rotuloErro}>Erro comum</span>
                <p className={styles.texto}>{o.erro}</p>
              </div>
              <div className={styles.script}>
                <span className={styles.rotuloScript}>Fala pronta</span>
                <p className={styles.scriptTexto}>{o.script}</p>
              </div>
              <div className={styles.zap}>
                <span className={styles.rotuloZap}>No WhatsApp</span>
                <p className={styles.zapTexto}>{o.whatsapp}</p>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

// ── Módulo 2 ────────────────────────────────────────────────────────────────
function ConteudoRoteiro() {
  return (
    <div className={styles.conteudo}>
      {ROTEIRO.map((p, i) => (
        <article key={p.id} className={styles.passo}>
          <div className={styles.passoHead}>
            <span className={styles.passoNum}>{String(i + 1).padStart(2, '0')}</span>
            <div>
              <span className={styles.passoFase}>{p.fase}</span>
              <h2 className={styles.passoTitulo}>{p.titulo}</h2>
            </div>
          </div>
          <p className={styles.texto}>{p.objetivo}</p>

          <ul className={styles.lista}>
            {p.acoes.map((a, j) => (
              <li key={j}>{a}</li>
            ))}
          </ul>

          {p.fala && (
            <div className={styles.script}>
              <span className={styles.rotuloScript}>Fala pronta</span>
              <p className={styles.scriptTexto}>{p.fala}</p>
            </div>
          )}

          <div className={styles.linha}>
            <span className={styles.rotuloErro}>Armadilha</span>
            <p className={styles.texto}>{p.armadilha}</p>
          </div>
        </article>
      ))}

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>{CINCO_PERGUNTAS.titulo}</h2>
        <p className={styles.secaoDesc}>{CINCO_PERGUNTAS.intro}</p>
        <ol className={styles.listaNum}>
          {CINCO_PERGUNTAS.perguntas.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ── Módulo 3 ────────────────────────────────────────────────────────────────
function ConteudoPrecificacao() {
  return (
    <div className={styles.conteudo}>
      <a className={styles.planilha} href="/kit/downloads/planilha-precificacao-solar.csv" download>
        <FileSpreadsheet size={22} className={styles.extraIcon} />
        <div>
          <strong>Baixar a planilha com as fórmulas</strong>
          <span>Você preenche os custos, ela devolve o preço de venda já com imposto, taxa, comissão e a sua margem.</span>
        </div>
        <Download size={16} className={styles.extraSeta} />
      </a>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Para onde vai cada real</h2>
        <p className={styles.secaoDesc}>
          Faixas de referência sobre o preço final de venda. Use como sanity check do seu orçamento —
          se uma linha estiver muito fora, é ali que a margem está sumindo.
        </p>
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Item</th>
                <th>O que é</th>
                <th className={styles.num}>Faixa</th>
              </tr>
            </thead>
            <tbody>
              {ESTRUTURA_CUSTO.map((l) => (
                <tr key={l.item}>
                  <td className={styles.tdItem}>{l.item}</td>
                  <td>
                    {l.descricao}
                    {l.atencao && <span className={styles.atencao}>{l.atencao}</span>}
                  </td>
                  <td className={styles.num}>{l.faixa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.nota}>
          Quer calcular no seu caso sem sair daqui? A <Link href="/precificacao" className={styles.linkInline}>calculadora
          de precificação</Link> da plataforma faz essa conta com os seus números.
        </p>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Quatro regras que protegem a margem</h2>
        {REGRAS_DE_MARGEM.map((r) => (
          <article key={r.titulo} className={styles.regra}>
            <h3 className={styles.regraTitulo}>{r.titulo}</h3>
            <p className={styles.texto}>{r.texto}</p>
          </article>
        ))}
      </section>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Checklist antes de mandar a proposta</h2>
        <ul className={styles.checklist}>
          {CHECKLIST_ORCAMENTO.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── Módulo 5 ────────────────────────────────────────────────────────────────
function ConteudoProspeccao() {
  return (
    <div className={styles.conteudo}>
      {PROSPECCAO.map((bloco) => (
        <section key={bloco.slug} className={styles.secao}>
          <h2 className={styles.secaoTitulo}>{bloco.titulo}</h2>
          <p className={styles.secaoDesc}>{bloco.descricao}</p>

          {bloco.mensagens.map((m) => (
            <article key={m.id} className={styles.objecao}>
              <h3 className={styles.regraTitulo}>{m.situacao}</h3>
              <div className={styles.linha}>
                <span className={styles.rotulo}>Quando usar</span>
                <p className={styles.texto}>{m.quando}</p>
              </div>
              <div className={styles.script}>
                <span className={styles.rotuloScript}>Mensagem</span>
                <p className={styles.scriptTexto}>{m.texto}</p>
              </div>
              <div className={styles.linha}>
                <span className={styles.rotulo}>Por que funciona</span>
                <p className={styles.texto}>{m.porque}</p>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

// ── Módulo 6 ────────────────────────────────────────────────────────────────
function ConteudoPosVenda() {
  return (
    <div className={styles.conteudo}>
      {POS_VENDA.map((e) => (
        <article key={e.id} className={styles.passo}>
          <div className={styles.passoHead}>
            <div>
              <span className={styles.passoFase}>{e.janela}</span>
              <h2 className={styles.passoTitulo}>{e.titulo}</h2>
            </div>
          </div>
          <ul className={styles.lista}>
            {e.oQueFazer.map((a, j) => (
              <li key={j}>{a}</li>
            ))}
          </ul>
          {e.mensagem && (
            <div className={styles.script}>
              <span className={styles.rotuloScript}>Mensagem pronta</span>
              <p className={styles.scriptTexto}>{e.mensagem}</p>
            </div>
          )}
          <div className={styles.linha}>
            <span className={styles.rotuloErro}>Risco de pular esta etapa</span>
            <p className={styles.texto}>{e.risco}</p>
          </div>
        </article>
      ))}

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>{GARANTIAS.titulo}</h2>
        <p className={styles.secaoDesc}>{GARANTIAS.intro}</p>
        {GARANTIAS.itens.map((g) => (
          <article key={g.tipo} className={styles.regra}>
            <h3 className={styles.regraTitulo}>
              {g.tipo} <span className={styles.nota}>— responsável: {g.dono}</span>
            </h3>
            <p className={styles.texto}>{g.texto}</p>
          </article>
        ))}
        <p className={styles.texto}><strong>{GARANTIAS.fechamento}</strong></p>
      </section>
    </div>
  );
}

// ── Módulo 4 ────────────────────────────────────────────────────────────────
// Este módulo é conteúdo E conversão: o documento não vem em PDF genérico,
// vem gerado com a empresa do próprio comprador — que é o produto.
function ConteudoDocumentos() {
  const docs = [
    {
      href: '/documentos?tipo=contrato-solar',
      titulo: 'Contrato de instalação',
      texto: 'Escopo, prazo, condição de pagamento e garantia de instalação — a cláusula que o cliente pergunta na objeção "e se sua empresa fechar".',
    },
    {
      href: '/documentos?tipo=procuracao',
      titulo: 'Procuração para a distribuidora',
      texto: 'Autoriza você a protocolar o pedido de acesso no nome do cliente. Sem ela, a homologação não anda.',
    },
    {
      href: '/vistoria',
      titulo: 'Termo de vistoria',
      texto: 'Registra o estado do telhado e da estrutura antes da obra — é o que te protege quando aparece goteira dois meses depois.',
    },
  ];

  return (
    <div className={styles.conteudo}>
      <section className={styles.secao}>
        <p className={styles.secaoDesc}>
          Estes três documentos são a parte prática do kit. Em vez de um modelo em branco para você
          preencher à mão, eles saem prontos com o CNPJ, o endereço e a logo da sua empresa — é só
          escolher o cliente e gerar.
        </p>
        {docs.map((d) => (
          <Link key={d.href} href={d.href} className={styles.docCard}>
            <div>
              <h3 className={styles.docTitulo}>{d.titulo}</h3>
              <p className={styles.texto}>{d.texto}</p>
            </div>
            <span className={styles.docCta}>
              Gerar <ArrowRight size={15} />
            </span>
          </Link>
        ))}
        <p className={styles.nota}>
          Ainda não cadastrou sua empresa? Faça isso primeiro em <Link href="/empresa" className={styles.linkInline}>Empresa</Link> —
          leva dois minutos e é o que coloca a sua marca em todo documento.
        </p>
      </section>
    </div>
  );
}
