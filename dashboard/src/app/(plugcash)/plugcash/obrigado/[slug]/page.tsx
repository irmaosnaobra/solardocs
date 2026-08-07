'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { plugcashApi, type Curso } from '@/services/plugcash';
import { Marca } from '../../Marca';
import styles from '../../pc.module.css';

// Tela pós-compra. A pessoa acabou de sair do gateway e ainda não está logada —
// a conta é criada pelo webhook, que é assíncrono. Então esta página NÃO tenta
// carregar o app: ela explica o que vai acontecer e onde procurar.
//
// O erro clássico aqui é mandar direto pro login: o comprador tenta entrar,
// ainda não tem senha, acha que a compra falhou e pede reembolso em cinco
// minutos. Dizer "o e-mail está a caminho" evita isso.
export default function Obrigado() {
  const { slug } = useParams<{ slug: string }>();
  const [curso, setCurso] = useState<Curso | null>(null);

  useEffect(() => {
    plugcashApi.obrigado(slug).then(({ data }) => setCurso(data.curso)).catch(() => {});
    plugcashApi.evento('obrigado_view', { slug });
  }, [slug]);

  return (
    <div className={`${styles.pc} ${styles.pcDark}`}>
      <div className={styles.wrap}>
        <header className={styles.topo}><Marca escuro /></header>
      </div>

      <section className={styles.hero}>
        <div className={styles.wrap}>
          <h1 className={styles.heroTitulo}>
            {curso ? `${curso.titulo} é seu.` : 'Compra confirmada.'}
          </h1>
          <p className={styles.heroSub}>
            Em alguns instantes chega um e-mail com o link de acesso. Se você ainda não
            tem conta no SolarDoc, esse e-mail traz o link para definir a sua senha —
            é o mesmo login das duas plataformas.
          </p>

          <ol style={{ color: '#cfcfcf', fontSize: 16, lineHeight: 1.9, paddingLeft: 20, margin: '0 0 28px' }}>
            <li>Abra o e-mail que acabamos de enviar.</li>
            <li>Defina a sua senha (ou entre com a que você já usa).</li>
            <li>O curso já está liberado no seu painel.</li>
          </ol>

          <div className={styles.heroAcoes}>
            <Link href="/plugcash/app" className={`${styles.btn} ${styles.btnPrimario}`}>
              Ir para o meu painel
            </Link>
            <a
              href="https://wa.me/5534991360223?text=Comprei%20no%20PlugCash%20e%20n%C3%A3o%20recebi%20o%20e-mail%20de%20acesso"
              className={`${styles.btn} ${styles.btnFantasma}`}
            >
              Não recebi o e-mail
            </a>
          </div>

          <p style={{ color: '#6B6B6B', fontSize: 14, marginTop: 26, maxWidth: '58ch', lineHeight: 1.7 }}>
            Confira o spam antes de nos chamar — o primeiro e-mail costuma cair lá. Se
            em 15 minutos nada chegou, fale com a gente que resolvemos na hora.
          </p>
        </div>
      </section>
    </div>
  );
}
