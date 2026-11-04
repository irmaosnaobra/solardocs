'use client';

import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import styles from './pesquisa.module.css';

// Pesquisa SEM login: o link com token chega por mensagem (ex-cliente que saiu,
// ou quem mais usa a SolarDoc). Quem decide se o link vale é a API; aqui só
// mostramos o formulário. Esta tela não dispara pixel nem evento de LP.

export type TipoPesquisa = 'saida' | 'depoimento';

const LIMITE = 1000;
const LIMITE_CURTO = 120;
const LINK_INVALIDO = 'Este link não está mais valendo.';

interface Conteudo {
  titulo: string;
  abertura: string;
  campos: { chave: string; rotulo: string }[];
  obrigado: string;
}

const CONTEUDO: Record<TipoPesquisa, Conteudo> = {
  saida: {
    titulo: 'Conta pra gente por que você saiu',
    abertura: 'Leva 1 minuto, e a sua resposta vai direto para o dono da SolarDoc.',
    campos: [
      { chave: 'porque', rotulo: 'Por que você saiu da SolarDoc?' },
      { chave: 'critica', rotulo: 'Qual é a sua crítica sincera?' },
      { chave: 'voltaria', rotulo: 'O que faria você voltar?' },
    ],
    obrigado: 'Recebemos a sua resposta. Obrigado pelo seu tempo e pela sinceridade.',
  },
  depoimento: {
    titulo: 'Seu depoimento sobre a SolarDoc',
    abertura: 'Conte em 2 frases o que a SolarDoc mudou no seu trabalho.',
    campos: [
      { chave: 'mudou', rotulo: 'O que a SolarDoc mudou no seu dia a dia?' },
      { chave: 'frase', rotulo: 'Uma frase que você diria para outro integrador.' },
    ],
    obrigado: 'Recebemos o seu depoimento. Obrigado pelo seu tempo e pela confiança.',
  },
};

type Fase = 'carregando' | 'invalido' | 'falhou' | 'form' | 'enviado';

export default function PesquisaForm({ tipo }: { tipo: TipoPesquisa }) {
  const conteudo = CONTEUDO[tipo];
  const token = (useSearchParams().get('t') || '').trim();
  const uid = useId();

  const [fase, setFase] = useState<Fase>(token ? 'carregando' : 'invalido');
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [nome, setNome] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [cidade, setCidade] = useState('');
  const [autorizo, setAutorizo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    api.get(`/pesquisa/${tipo}/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (!vivo) return;
        setNome(String(data?.nome ?? ''));
        setEmpresa(String(data?.empresa ?? ''));
        setCidade(String(data?.cidade ?? ''));
        setFase('form');
      })
      .catch((e) => {
        if (!vivo) return;
        const status = e?.response?.status;
        // Sem resposta ou 5xx não é link vencido: deixa a pessoa tentar de novo.
        setFase(!status || status >= 500 ? 'falhou' : 'invalido');
      });
    return () => { vivo = false; };
  }, [tipo, token]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const limpos: Record<string, string> = {};
    for (const c of conteudo.campos) limpos[c.chave] = (textos[c.chave] || '').trim();
    if (!Object.values(limpos).some(Boolean)) {
      setErro('Preencha pelo menos um campo antes de enviar.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const corpo = tipo === 'depoimento'
        ? { ...limpos, nome: nome.trim(), empresa: empresa.trim(), cidade: cidade.trim(), autorizo }
        : limpos;
      await api.post(`/pesquisa/${tipo}/${encodeURIComponent(token)}`, corpo);
      setFase('enviado');
    } catch (err) {
      const e2 = err as { response?: { status?: number; data?: { error?: unknown } } };
      if (e2.response?.status === 404) { setFase('invalido'); return; }
      const msg = e2.response?.data?.error;
      setErro(typeof msg === 'string' && msg ? msg : 'Não foi possível enviar agora. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  }

  if (fase === 'carregando') return <main className={styles.pagina} aria-busy="true" />;

  if (fase === 'invalido') {
    return <main className={styles.pagina}><p className={styles.aviso}>{LINK_INVALIDO}</p></main>;
  }

  if (fase === 'falhou') {
    return (
      <main className={styles.pagina}>
        <p className={styles.aviso}>Não foi possível abrir agora. Atualize a página em instantes.</p>
      </main>
    );
  }

  if (fase === 'enviado') {
    return (
      <main className={styles.pagina}>
        <div className={styles.card}>
          <p className={styles.obrigado} role="status">{conteudo.obrigado}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.pagina}>
      <form className={styles.card} onSubmit={enviar} noValidate>
        <h1 className={styles.titulo}>{conteudo.titulo}</h1>
        <p className={styles.abertura}>{conteudo.abertura}</p>

        {tipo === 'depoimento' && (
          <>
            <label className={styles.rotulo} htmlFor={`${uid}-nome`}>Nome</label>
            <input id={`${uid}-nome`} className={styles.campo} type="text" autoComplete="name"
              maxLength={LIMITE_CURTO} value={nome} onChange={(e) => setNome(e.target.value)} />
            <label className={styles.rotulo} htmlFor={`${uid}-empresa`}>Empresa</label>
            <input id={`${uid}-empresa`} className={styles.campo} type="text" autoComplete="organization"
              maxLength={LIMITE_CURTO} value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
            <label className={styles.rotulo} htmlFor={`${uid}-cidade`}>Cidade</label>
            <input id={`${uid}-cidade`} className={styles.campo} type="text" autoComplete="address-level2"
              maxLength={LIMITE_CURTO} value={cidade} onChange={(e) => setCidade(e.target.value)} />
          </>
        )}

        {conteudo.campos.map((c) => {
          const valor = textos[c.chave] || '';
          return (
            <div key={c.chave}>
              <label className={styles.rotulo} htmlFor={`${uid}-${c.chave}`}>{c.rotulo}</label>
              <textarea id={`${uid}-${c.chave}`} className={`${styles.campo} ${styles.area}`} rows={4}
                maxLength={LIMITE} value={valor}
                onChange={(e) => setTextos((t) => ({ ...t, [c.chave]: e.target.value }))} />
              <div className={styles.contador} aria-hidden="true">{valor.length}/{LIMITE}</div>
            </div>
          );
        })}

        {tipo === 'depoimento' && (
          <div className={styles.autorizo}>
            <input id={`${uid}-autorizo`} type="checkbox" checked={autorizo}
              onChange={(e) => setAutorizo(e.target.checked)} />
            <label htmlFor={`${uid}-autorizo`}>
              Autorizo a SolarDoc a publicar este depoimento com meu nome, empresa e cidade no site.
            </label>
          </div>
        )}

        {erro && <p className={styles.erro} role="alert">{erro}</p>}

        <button type="submit" className={styles.botao} disabled={enviando}>Enviar</button>
      </form>
    </main>
  );
}
