'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Award, Calculator, Check, ChevronRight, Clock, Lock } from 'lucide-react';
import api from '@/services/api';
import {
  proximaDoCurso, textoBloqueio, textoDias, diasAte,
  type AulaCurso, type CursoResposta, type EstadoCertificado,
} from '@/lib/limpapro/tipos';
import './limpapro.css';

/** Página de venda interna do LimpaPro (catalogo.ts: slug "limpapro"). */
const PAGINA_DE_VENDA = '/produtos/limpapro';

function Anel({ feitos, total }: { feitos: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const p = total > 0 ? Math.min(feitos / total, 1) : 0;
  return (
    <div className="lp-anel" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <circle className="lp-anel-fundo" cx="32" cy="32" r={r} />
        <circle className="lp-anel-valor" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      </svg>
      <b>{feitos}/{total}</b>
    </div>
  );
}

function CartaoAula({ a, numero }: { a: AulaCurso; numero?: string }) {
  const trancada = !!a.bloqueio;
  const conteudo = (
    <>
      <span className="lp-num" aria-hidden="true">
        {a.feita ? <Check size={18} /> : trancada ? <Lock size={16} /> : (numero ?? '')}
      </span>
      <span className="lp-card-corpo">
        <b>{a.titulo}</b>
        <span>{trancada ? textoBloqueio(a) : a.resumo}</span>
        <small>
          1 aula, {a.minutos} min{a.feita ? ', feita' : ''}
        </small>
      </span>
      <span className="lp-card-fim" aria-hidden="true">{trancada ? <Lock size={16} /> : <ChevronRight size={18} />}</span>
    </>
  );
  const classe = `lp-card${a.feita ? ' feita' : ''}${trancada ? ' trancado' : ''}`;
  if (trancada) {
    return <div className={classe} role="group" aria-label={`${a.titulo}. ${textoBloqueio(a)}`}>{conteudo}</div>;
  }
  return <Link href={`/limpapro/${a.slug}`} className={classe}>{conteudo}</Link>;
}

function Certificado({ c, total }: { c: EstadoCertificado; total: number }) {
  if (c.liberado) {
    return (
      <div className="lp-cert pronto">
        <h2>Você concluiu os {total} módulos.</h2>
        <p>Baixe o seu certificado.</p>
        <a className="lp-btn lp-btn-primario" href={c.url} target="_blank" rel="noopener noreferrer">
          <Award size={18} /> Baixar o certificado
        </a>
      </div>
    );
  }
  let texto = '';
  if (c.motivo === 'faltam') texto = `Faltam ${c.faltam} de ${total} módulos para liberar o certificado.`;
  else if (c.motivo === 'plano') texto = 'Você concluiu os módulos. O certificado é do plano Completo.';
  else texto = `Você concluiu os módulos. O certificado abre em ${textoDias(diasAte(c.liberaEm))}.`;
  return (
    <div className="lp-cert">
      <h2>Certificado</h2>
      <p>{texto}</p>
    </div>
  );
}

export default function LimpaProPage() {
  const [curso, setCurso] = useState<CursoResposta | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.get<CursoResposta>('/limpapro/curso')
      .then((r) => { if (vivo) setCurso(r.data); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, []);

  if (erro) {
    return (
      <div className="lp-wrap">
        <div className="lp-erro" role="alert">Não foi possível abrir o curso agora. Atualize a página em instantes.</div>
      </div>
    );
  }
  if (!curso) return <div className="lp-wrap"><div className="lp-carregando">Abrindo o curso...</div></div>;

  if (!curso.acesso) {
    return (
      <div className="lp-wrap">
        <div className="lp-venda">
          <img src="/limpapro/limpapro-curso.webp" alt="" />
          <h1>LimpaPro</h1>
          <p>Aprenda a limpar placa solar e cobrar por isso. Esta conta ainda não tem o curso.</p>
          <Link href={PAGINA_DE_VENDA} className="lp-btn lp-btn-primario">Conhecer o LimpaPro</Link>
        </div>
      </div>
    );
  }

  const aulas = curso.aulas ?? [];
  const modulos = aulas.filter((a) => a.grupo === 'modulo');
  const incluidas = aulas.filter((a) => a.grupo === 'incluso');
  const bonus = aulas.filter((a) => a.grupo === 'bonus');
  const extras = aulas.filter((a) => a.grupo === 'extra');
  const feitos = curso.modulosFeitos ?? 0;
  const total = curso.modulosTotal ?? modulos.length;
  const proxima = proximaDoCurso(aulas);
  const comecou = feitos > 0 || aulas.some((a) => a.feita);

  return (
    <div className="lp-wrap">
      <section className="lp-capa">
        <div>
          <h1>LimpaPro</h1>
          <p>Aprenda a limpar placa solar e cobrar por isso.</p>
          <div className="lp-prog">
            <Anel feitos={feitos} total={total} />
            <div className="lp-prog-txt">
              <strong>{feitos} de {total} módulos</strong>
              {feitos >= total ? 'Curso concluído.' : 'Concluídos até agora.'}
            </div>
          </div>
          {proxima && (
            <Link href={`/limpapro/${proxima.slug}`} className="lp-btn lp-btn-primario">
              {comecou ? 'Continuar de onde parei' : 'Começar o curso'}
            </Link>
          )}
        </div>
        <img src="/limpapro/limpapro-curso.webp" alt="" />
      </section>

      <section className="lp-sec" aria-labelledby="lp-mods">
        <h2 id="lp-mods">Os {total} módulos</h2>
        <div className="lp-lista">
          {modulos.map((a) => <CartaoAula key={a.slug} a={a} numero={String(a.modulo ?? '')} />)}
        </div>
      </section>

      <Link href="/precificacao" className="lp-destaque">
        <Calculator size={26} aria-hidden="true" />
        <span>
          <b>Calcule o preço da limpeza</b>
          <span>Coloque os números do serviço e veja quanto cobrar.</span>
        </span>
      </Link>

      {incluidas.length > 0 && (
        <section className="lp-sec" aria-labelledby="lp-inc">
          <h2 id="lp-inc">Também incluído</h2>
          <div className="lp-lista">
            {incluidas.map((a) => <CartaoAula key={a.slug} a={a} />)}
          </div>
        </section>
      )}

      {bonus.length > 0 && (
        <section className="lp-sec" aria-labelledby="lp-bonus">
          <h2 id="lp-bonus">Bônus do plano Completo</h2>
          <div className="lp-lista">
            {bonus.map((a) => <CartaoAula key={a.slug} a={a} />)}
          </div>
        </section>
      )}

      {extras.length > 0 && (
        <section className="lp-sec" aria-labelledby="lp-extra">
          <h2 id="lp-extra">Seus materiais extras</h2>
          <div className="lp-lista">
            {extras.map((a) => <CartaoAula key={a.slug} a={a} />)}
          </div>
        </section>
      )}

      {curso.certificado && <Certificado c={curso.certificado} total={total} />}
      <p className="lp-sec" style={{ fontSize: 12.5, color: 'var(--color-text-dim)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Clock size={14} aria-hidden="true" /> Algumas aulas abrem alguns dias depois da compra. O progresso fica salvo na sua conta.
      </p>
    </div>
  );
}
