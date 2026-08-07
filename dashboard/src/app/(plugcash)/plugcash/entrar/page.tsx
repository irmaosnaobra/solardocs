'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { authApi } from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import { Marca } from '../Marca';
import styles from '../pc.module.css';

// Porta do PlugCash. É o MESMO login do solardoc.app — mesma tabela `users`,
// mesmo endpoint, mesmo cookie. Quem já tem conta lá entra aqui sem cadastro
// novo; o que define se ele é membro do PlugCash é a linha em `pc_membros`,
// criada na primeira vez que ele abre /plugcash/app.
function EntrarForm() {
  const router = useRouter();
  const params = useSearchParams();
  const destino = params.get('proximo') || '/plugcash/app';

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const { data } = await authApi.login(email.trim(), senha);
      setToken(data.token);
      if (data.user) setUser(data.user);
      router.push(destino);
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: string } } }).response;
      setErro(resp?.data?.error || 'E-mail ou senha incorretos.');
      setCarregando(false);
    }
  }

  return (
    <div className={styles.loginTela}>
      <div className={styles.loginCard}>
        <div className={styles.loginTopo}>
          <Marca />
        </div>

        {erro && <div className={styles.erro}>{erro}</div>}

        <form onSubmit={enviar}>
          <label className={styles.campo}>
            <span className={styles.campoRotulo}>E-mail</span>
            <input
              className={styles.campoInput}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className={styles.campo}>
            <span className={styles.campoRotulo}>Senha</span>
            <input
              className={styles.campoInput}
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button
            type="submit"
            className={`${styles.btn} ${styles.btnPrimario} ${styles.btnBloco}`}
            disabled={carregando}
          >
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {/* Recuperação de senha e cadastro seguem no fluxo do SolarDoc: é a mesma
            conta, e duplicar as telas duplicaria dois e-mails transacionais. */}
        <p className={styles.ajuda}>
          Esqueceu a senha? <Link href="/auth?mode=esqueci">Recuperar acesso</Link>
        </p>
        <p className={styles.ajuda}>
          Comprou agora e ainda não tem senha? Ela chega no e-mail da compra.
        </p>
      </div>
    </div>
  );
}

export default function EntrarPage() {
  return (
    <Suspense fallback={<div className={styles.loginTela} />}>
      <EntrarForm />
    </Suspense>
  );
}
