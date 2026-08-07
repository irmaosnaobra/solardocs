'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/services/auth';
import { plugcashApi, money, MOTIVO_LABEL, type ContaResposta } from '@/services/plugcash';
import { Marca, Check } from '../../Marca';
import styles from '../../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Conta do aluno.
//
// Aqui mora o movimento que fecha o modelo de negócio: o botão "já resolvi".
//
// A pessoa entrou no PlugCash porque foi REPROVADA numa régua — faltava o ponto,
// o capital ou o aval do sócio. No dia em que ela resolve essa falta, ela deixa
// de ser aluno de R$ 197 e vira candidata a um eletroposto de R$ 160 mil. Se
// esse botão não existir, ninguém avisa a equipe e o ciclo nunca fecha: o cara
// resolve o problema, não conta pra ninguém, e compra de outro.
// ─────────────────────────────────────────────────────────────────────────────

const NIVEL_LABEL: Record<string, string> = {
  base: 'Base', integrador: 'Integrador', investidor: 'Investidor', projeto: 'Projeto',
};

// O que ele declara ter resolvido. O texto é a NEGAÇÃO do bloqueio — a pessoa
// reconhece a própria resposta, não um jargão do sistema.
const RESOLVEU_LABEL: Record<string, string> = {
  sem_ponto:   'Já defini o ponto onde vou instalar',
  sem_capital: 'Já viabilizei o capital',
  nao_decisor: 'Já tenho o aval de quem decide comigo',
  fluxo_baixo: 'Já tenho um local com movimento',
};

export default function Conta() {
  const router = useRouter();
  const [dados, setDados] = useState<ContaResposta | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const { data } = await plugcashApi.conta();
      setDados(data);
      setMarcados(data.membro.resolveu_o_que || []);
    } catch {
      setErro('Não consegui carregar a sua conta. Recarregue a página.');
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/plugcash/entrar?proximo=/plugcash/app/conta'); return; }
    carregar();
  }, [router, carregar]);

  async function declarar() {
    if (!marcados.length) return;
    setSalvando(true);
    try {
      await plugcashApi.resolvi(marcados);
      plugcashApi.evento('resolveu_bloqueio', { motivos: marcados });
      await carregar();
    } catch {
      setErro('Não consegui salvar. Tente de novo.');
    }
    setSalvando(false);
  }

  if (erro && !dados) {
    return (
      <div className={styles.pc}><div className={styles.wrap}>
        <header className={styles.topo}><Marca /></header>
        <div className={styles.secao}><div className={styles.aviso}>{erro}</div></div>
      </div></div>
    );
  }
  if (!dados) return <div className={styles.pc} />;

  const { usuario, membro, compras, credito_centavos } = dados;
  // Só oferece marcar o que de fato o desqualificou. Sem o snapshot da régua
  // (usuário que entrou pelo SolarDoc), oferece os quatro — melhor perguntar
  // que esconder o caminho de volta.
  const bloqueios = membro.motivo_descarte?.length
    ? membro.motivo_descarte
    : Object.keys(RESOLVEU_LABEL);

  return (
    <div className={styles.pc}>
      <div className={styles.wrap}>
        <header className={styles.topo}>
          <Marca />
          <div className={styles.topoAcoes}>
            <span className={styles.nivel}>{NIVEL_LABEL[membro.nivel] || membro.nivel}</span>
            <Link href="/plugcash/app" className={`${styles.btn} ${styles.btnFantasma}`}>Meu painel</Link>
          </div>
        </header>

        <section className={styles.secao}>
          <h1 className={styles.secaoTitulo}>Minha conta</h1>
          <p className={styles.secaoSub}>{usuario?.email}</p>
        </section>

        {/* O ciclo de volta pra agenda */}
        <section className={styles.secao} style={{ paddingTop: 0 }}>
          <div className={styles.passo} style={{ display: 'block' }}>
            <p className={styles.passoRotulo}>Voltar para a agenda</p>
            {membro.resolveu_em ? (
              <>
                <h2 className={styles.passoTitulo}>Você já sinalizou. A equipe vai te chamar.</h2>
                <p className={styles.passoPorque}>
                  Marcado em {new Date(membro.resolveu_em).toLocaleDateString('pt-BR')}. Sua
                  pontuação é recalculada com essa informação e a agenda do especialista
                  abre de novo — o contato vem pelo WhatsApp que você cadastrou.
                </p>
              </>
            ) : (
              <>
                <h2 className={styles.passoTitulo}>Já resolveu o que estava faltando?</h2>
                <p className={styles.passoPorque}>
                  A reunião não abriu na primeira vez por um critério objetivo, não por
                  julgamento. Quando o critério muda, a nota é recalculada e a agenda abre.
                  Marque o que mudou:
                </p>

                <div className={styles.opcoes} style={{ marginTop: 16 }}>
                  {bloqueios.map((m) => {
                    const ativo = marcados.includes(m);
                    return (
                      <button
                        key={m}
                        className={styles.opcao}
                        style={ativo ? { borderColor: '#00C853', color: '#009B40' } : undefined}
                        onClick={() => setMarcados((cur) =>
                          cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m])}
                      >
                        {ativo && <span style={{ marginRight: 8 }}><Check /></span>}
                        {RESOLVEU_LABEL[m] || m}
                      </button>
                    );
                  })}
                </div>

                <button
                  className={`${styles.btn} ${styles.btnPrimario}`}
                  style={{ marginTop: 16 }}
                  disabled={!marcados.length || salvando}
                  onClick={declarar}
                >
                  {salvando ? 'Enviando…' : 'Quero voltar para a agenda'}
                </button>
              </>
            )}
          </div>
        </section>

        {credito_centavos > 0 && (
          <section className={styles.secao} style={{ paddingTop: 0 }}>
            <div className={styles.card}>
              <h2 className={styles.secaoTitulo} style={{ fontSize: 18 }}>
                Crédito de {money(credito_centavos)}
              </h2>
              <p className={styles.secaoSub} style={{ marginBottom: 0 }}>
                É o que você já pagou em cursos. Esse valor abate no upgrade para
                Credenciamento Integrador ou Mentoria Investidor — fale com a equipe
                na hora de fechar para que ele seja aplicado.
              </p>
            </div>
          </section>
        )}

        <section className={styles.secao} style={{ paddingTop: 0 }}>
          <h2 className={styles.secaoTitulo}>Compras</h2>
          {compras.length === 0 ? (
            <div className={styles.vazio}>Nenhuma compra registrada nesta conta.</div>
          ) : (
            <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
              <table className={styles.tabela}>
                <thead>
                  <tr><th>Item</th><th>Valor</th><th>Situação</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {compras.map((c) => (
                    <tr key={c.id}>
                      <td>{c.item_slug}</td>
                      <td>{money(c.valor_centavos)}</td>
                      <td>
                        <span className={`${styles.selo} ${c.status === 'aprovada' ? styles.seloPublicado : styles.seloRascunho}`}>
                          {c.status}
                        </span>
                      </td>
                      <td>{new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {membro.motivo_descarte?.length > 0 && (
          <section className={styles.secao} style={{ paddingTop: 0 }}>
            <p className={styles.secaoSub}>
              No formulário do eletroposto você respondeu que{' '}
              {membro.motivo_descarte.map((m) => MOTIVO_LABEL[m] || m).join(', ')}. É por isso
              que o seu painel prioriza o que prioriza.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
