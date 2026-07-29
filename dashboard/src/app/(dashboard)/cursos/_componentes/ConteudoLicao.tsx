'use client';

// Renderiza o conteúdo de UMA lição a partir do id ('modulo:licao').
// O texto vem dos arquivos de _conteudo — este componente só decide o formato.

import Link from 'next/link';
import { ArrowRight, Building2, Calculator } from 'lucide-react';
import styles from '../curso.module.css';
import { OBJECOES } from '../_conteudo/objecoes';
import { ROTEIRO, CINCO_PERGUNTAS } from '../_conteudo/roteiro';
import { ESTRUTURA_CUSTO, REGRAS_DE_MARGEM, CHECKLIST_ORCAMENTO } from '../_conteudo/precificacao';
import { PROSPECCAO } from '../_conteudo/prospeccao';
import { POS_VENDA, GARANTIAS } from '../_conteudo/posvenda';

export default function ConteudoLicao({ id }: { id: string }) {
  const [modulo, parte] = id.split(':');

  if (modulo === 'objecoes') {
    const grupo = OBJECOES.find((g) => g.slug === parte);
    if (!grupo) return null;
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>{grupo.descricao}</p>
        {grupo.itens.map((o, i) => (
          <article key={o.id} className={styles.cardConteudo}>
            <span className={styles.contador}>{i + 1} de {grupo.itens.length}</span>
            <p className={styles.gatilho}>&ldquo;{o.gatilho}&rdquo;</p>
            <Bloco rotulo="O que ele quer dizer" texto={o.traducao} />
            <Bloco rotulo="Erro comum" texto={o.erro} tom="erro" />
            <Destaque rotulo="Fala pronta" texto={o.script} />
            <Destaque rotulo="No WhatsApp" texto={o.whatsapp} tom="zap" />
          </article>
        ))}
      </div>
    );
  }

  if (id === 'roteiro:etapas') {
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>
          Seis etapas, na ordem. Em cada uma: o objetivo, o que fazer, a fala pronta e a armadilha que
          mata a venda naquele ponto.
        </p>
        {ROTEIRO.map((p, i) => (
          <article key={p.id} className={styles.cardConteudo}>
            <div className={styles.etapaHead}>
              <span className={styles.etapaNum}>{String(i + 1).padStart(2, '0')}</span>
              <div>
                <span className={styles.etapaFase}>{p.fase}</span>
                <h3 className={styles.etapaTitulo}>{p.titulo}</h3>
              </div>
            </div>
            <p className={styles.texto}>{p.objetivo}</p>
            <ul className={styles.lista}>
              {p.acoes.map((a, j) => <li key={j}>{a}</li>)}
            </ul>
            {p.fala && <Destaque rotulo="Fala pronta" texto={p.fala} />}
            <Bloco rotulo="Armadilha" texto={p.armadilha} tom="erro" />
          </article>
        ))}
      </div>
    );
  }

  if (id === 'roteiro:perguntas') {
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>{CINCO_PERGUNTAS.intro}</p>
        <div className={styles.cardConteudo}>
          <h3 className={styles.etapaTitulo} style={{ marginBottom: 16 }}>{CINCO_PERGUNTAS.titulo}</h3>
          <ol className={styles.listaNum}>
            {CINCO_PERGUNTAS.perguntas.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </div>
      </div>
    );
  }

  if (id === 'preco:custo') {
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>
          Faixas de referência sobre o preço final de venda. Use como conferência do seu orçamento: se uma
          linha estiver muito fora, é ali que a margem está sumindo.
        </p>
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr><th>Item</th><th>O que é</th><th className={styles.num}>Faixa</th></tr>
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
      </div>
    );
  }

  if (id === 'preco:regras') {
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>
          Quatro decisões que separam quem termina o mês com margem de quem termina com cliente satisfeito
          e caixa no vermelho.
        </p>
        {REGRAS_DE_MARGEM.map((r) => (
          <article key={r.titulo} className={styles.cardConteudo}>
            <h3 className={styles.etapaTitulo}>{r.titulo}</h3>
            <p className={styles.texto} style={{ marginTop: 8 }}>{r.texto}</p>
          </article>
        ))}
      </div>
    );
  }

  if (id === 'preco:calculadora') {
    return (
      <div className={styles.leitura}>
        <div className={styles.missao}>
          <span className={styles.missaoTag}>Missão prática</span>
          <h3 className={styles.missaoTitulo}>Refaça o seu último orçamento na calculadora</h3>
          <p className={styles.texto}>
            Pegue o orçamento que você mandou por último e lance os custos na calculadora da plataforma.
            Ela devolve o preço de venda já com imposto, taxa de pagamento, comissão e a sua margem — e
            mostra quanto sobrou de verdade naquele projeto.
          </p>
          <Link href="/precificacao" className={styles.missaoCta}>
            <Calculator size={16} /> Abrir a calculadora
          </Link>
        </div>
        <div className={styles.cardConteudo}>
          <h3 className={styles.etapaTitulo} style={{ marginBottom: 14 }}>Confira antes de mandar a proposta</h3>
          <ul className={styles.checklist}>
            {CHECKLIST_ORCAMENTO.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      </div>
    );
  }

  if (id === 'documentos:gerar') {
    const docs = [
      {
        href: '/documentos?tipo=contrato-solar',
        titulo: 'Contrato de instalação',
        texto: 'Escopo, prazo, pagamento e a cláusula de garantia de instalação — a que responde "e se sua empresa fechar".',
      },
      {
        href: '/documentos?tipo=procuracao',
        titulo: 'Procuração para a distribuidora',
        texto: 'Autoriza você a protocolar o pedido de acesso no nome do cliente. Sem ela, a homologação não anda.',
      },
      {
        href: '/vistoria',
        titulo: 'Termo de vistoria',
        texto: 'Registra o estado do telhado antes da obra — é o que te protege quando aparece goteira depois.',
      },
    ];
    return (
      <div className={styles.leitura}>
        <div className={styles.missao}>
          <span className={styles.missaoTag}>Missão prática</span>
          <h3 className={styles.missaoTitulo}>Emita um documento com a sua marca hoje</h3>
          <p className={styles.texto}>
            Esta é a única lição que você não termina lendo. Cadastre o CNPJ e a logo da sua empresa e gere
            um dos três documentos abaixo — em 10 minutos você tem na mão o que o cliente assina.
          </p>
          <Link href="/empresa" className={styles.missaoCta}>
            <Building2 size={16} /> Cadastrar minha empresa
          </Link>
        </div>
        {docs.map((d) => (
          <Link key={d.href} href={d.href} className={styles.docCard}>
            <div>
              <h3 className={styles.etapaTitulo}>{d.titulo}</h3>
              <p className={styles.texto} style={{ marginTop: 6 }}>{d.texto}</p>
            </div>
            <span className={styles.docCta}>Gerar <ArrowRight size={15} /></span>
          </Link>
        ))}
      </div>
    );
  }

  if (modulo === 'prospeccao') {
    const bloco = PROSPECCAO.find((b) => b.slug === parte);
    if (!bloco) return null;
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>{bloco.descricao}</p>
        {bloco.mensagens.map((m, i) => (
          <article key={m.id} className={styles.cardConteudo}>
            <span className={styles.contador}>{i + 1} de {bloco.mensagens.length}</span>
            <h3 className={styles.etapaTitulo}>{m.situacao}</h3>
            <Bloco rotulo="Quando usar" texto={m.quando} />
            <Destaque rotulo="Mensagem" texto={m.texto} copiar />
            <Bloco rotulo="Por que funciona" texto={m.porque} />
          </article>
        ))}
      </div>
    );
  }

  if (id === 'posvenda:janelas') {
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>
          O que acontece depois do sim define se você vendeu uma vez ou três. Cinco janelas, cada uma com
          o que fazer, a mensagem pronta e o risco de pular.
        </p>
        {POS_VENDA.map((e, i) => (
          <article key={e.id} className={styles.cardConteudo}>
            <div className={styles.etapaHead}>
              <span className={styles.etapaNum}>{String(i + 1).padStart(2, '0')}</span>
              <div>
                <span className={styles.etapaFase}>{e.janela}</span>
                <h3 className={styles.etapaTitulo}>{e.titulo}</h3>
              </div>
            </div>
            <ul className={styles.lista}>
              {e.oQueFazer.map((a, j) => <li key={j}>{a}</li>)}
            </ul>
            {e.mensagem && <Destaque rotulo="Mensagem pronta" texto={e.mensagem} copiar />}
            <Bloco rotulo="Risco de pular esta etapa" texto={e.risco} tom="erro" />
          </article>
        ))}
      </div>
    );
  }

  if (id === 'posvenda:garantias') {
    return (
      <div className={styles.leitura}>
        <p className={styles.intro}>{GARANTIAS.intro}</p>
        {GARANTIAS.itens.map((g) => (
          <article key={g.tipo} className={styles.cardConteudo}>
            <h3 className={styles.etapaTitulo}>{g.tipo}</h3>
            <span className={styles.dono}>Responsável: {g.dono}</span>
            <p className={styles.texto} style={{ marginTop: 10 }}>{g.texto}</p>
          </article>
        ))}
        <div className={styles.remate}>{GARANTIAS.fechamento}</div>
      </div>
    );
  }

  return null;
}

function Bloco({ rotulo, texto, tom }: { rotulo: string; texto: string; tom?: 'erro' }) {
  return (
    <div className={styles.linha}>
      <span className={tom === 'erro' ? styles.rotuloErro : styles.rotulo}>{rotulo}</span>
      <p className={styles.texto}>{texto}</p>
    </div>
  );
}

function Destaque({
  rotulo, texto, tom, copiar,
}: { rotulo: string; texto: string; tom?: 'zap'; copiar?: boolean }) {
  function copiarTexto() {
    navigator.clipboard?.writeText(texto).catch(() => {});
  }
  return (
    <div className={tom === 'zap' ? styles.zap : styles.script}>
      <div className={styles.destaqueTopo}>
        <span className={tom === 'zap' ? styles.rotuloZap : styles.rotuloScript}>{rotulo}</span>
        {copiar && (
          <button className={styles.btnCopiar} onClick={copiarTexto} type="button">copiar</button>
        )}
      </div>
      <p className={styles.destaqueTexto}>{texto}</p>
    </div>
  );
}
