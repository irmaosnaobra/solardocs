'use client';

// Estrelas + comentário. Aparece ao concluir um módulo e ao concluir o curso.
// Tudo vai para o banco com aprovado=false — o que vira depoimento na página de
// venda é escolhido no /admin, e só com o "pode publicar" marcado aqui.

import { useState } from 'react';
import { Star, Check, Send } from 'lucide-react';
import api from '@/services/api';
import styles from '../curso.module.css';

export type MinhaAvaliacao = {
  curso_slug: string;
  modulo_slug: string;
  estrelas: number;
  comentario: string | null;
  nome_exibicao: string | null;
  empresa: string | null;
  cidade: string | null;
  autoriza_publicar: boolean;
};

export default function Avaliacao({
  cursoSlug,
  moduloSlug = '',
  titulo,
  subtitulo,
  atual,
  pedirAutorizacao = false,
  onSalvo,
}: {
  cursoSlug: string;
  moduloSlug?: string;
  titulo: string;
  subtitulo: string;
  atual?: MinhaAvaliacao | null;
  /** Só na avaliação do curso: pergunta se pode usar como depoimento */
  pedirAutorizacao?: boolean;
  onSalvo?: (a: MinhaAvaliacao) => void;
}) {
  const [estrelas, setEstrelas] = useState(atual?.estrelas ?? 0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState(atual?.comentario ?? '');
  const [nome, setNome] = useState(atual?.nome_exibicao ?? '');
  const [empresa, setEmpresa] = useState(atual?.empresa ?? '');
  const [cidade, setCidade] = useState(atual?.cidade ?? '');
  const [autoriza, setAutoriza] = useState(atual?.autoriza_publicar ?? false);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  const marcadas = hover || estrelas;

  async function enviar() {
    if (!estrelas || enviando) return;
    setEnviando(true);
    const corpo = {
      cursoSlug,
      moduloSlug,
      estrelas,
      comentario: comentario.trim() || undefined,
      nomeExibicao: nome.trim() || undefined,
      empresa: empresa.trim() || undefined,
      cidade: cidade.trim() || undefined,
      autorizaPublicar: autoriza,
    };
    try {
      await api.post('/kit/avaliacao', corpo);
      setPronto(true);
      onSalvo?.({
        curso_slug: cursoSlug,
        modulo_slug: moduloSlug,
        estrelas,
        comentario: comentario.trim() || null,
        nome_exibicao: nome.trim() || null,
        empresa: empresa.trim() || null,
        cidade: cidade.trim() || null,
        autoriza_publicar: autoriza,
      });
    } catch {
      // silencioso: avaliação é bônus, não pode travar o curso
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <div className={styles.avaliacaoOk}>
        <Check size={18} strokeWidth={2.5} />
        <div>
          <strong>Obrigado pela avaliação!</strong>
          <span>
            {autoriza
              ? 'Seu comentário pode aparecer na nossa página — a gente revisa antes de publicar.'
              : 'Sua nota fica só com a gente e ajuda a melhorar o material.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.avaliacao}>
      <h3 className={styles.avaliacaoTitulo}>{titulo}</h3>
      <p className={styles.avaliacaoSub}>{subtitulo}</p>

      <div className={styles.estrelas} role="radiogroup" aria-label="Nota de 1 a 5 estrelas">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={estrelas === n}
            aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
            className={`${styles.estrela} ${n <= marcadas ? styles.estrelaAtiva : ''}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setEstrelas(n)}
          >
            <Star size={30} strokeWidth={1.8} fill={n <= marcadas ? 'currentColor' : 'none'} />
          </button>
        ))}
        {estrelas > 0 && (
          <span className={styles.estrelaLabel}>
            {['', 'não gostei', 'dá pra melhorar', 'bom', 'muito bom', 'excelente'][estrelas]}
          </span>
        )}
      </div>

      {estrelas > 0 && (
        <div className={styles.avaliacaoForm}>
          <textarea
            className={styles.avaliacaoTexto}
            rows={pedirAutorizacao ? 4 : 3}
            maxLength={1200}
            placeholder={
              pedirAutorizacao
                ? 'O que mudou no seu jeito de vender depois do curso? (o que você escrever aqui pode virar depoimento)'
                : 'Quer contar o que achou deste módulo? (opcional)'
            }
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />

          {pedirAutorizacao && (
            <>
              <div className={styles.avaliacaoCampos}>
                <input
                  className={styles.avaliacaoInput}
                  placeholder="Seu nome"
                  maxLength={80}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
                <input
                  className={styles.avaliacaoInput}
                  placeholder="Sua empresa (opcional)"
                  maxLength={80}
                  value={empresa}
                  onChange={(e) => setEmpresa(e.target.value)}
                />
                <input
                  className={styles.avaliacaoInput}
                  placeholder="Cidade (opcional)"
                  maxLength={80}
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                />
              </div>

              <label className={styles.avaliacaoAutoriza}>
                <input
                  type="checkbox"
                  checked={autoriza}
                  onChange={(e) => setAutoriza(e.target.checked)}
                />
                <span>
                  Autorizo o SolarDoc a usar meu comentário, nome e empresa na divulgação do curso.
                  Sem isso, sua avaliação fica só interna.
                </span>
              </label>
            </>
          )}

          <button className={styles.btnPrimario} onClick={enviar} disabled={enviando}>
            <Send size={16} /> {enviando ? 'Enviando…' : 'Enviar avaliação'}
          </button>
        </div>
      )}
    </section>
  );
}
