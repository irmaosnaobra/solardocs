import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { COOKIE_PAINEL, crachaDaSenha, iguais, senhaConfigurada } from '../../../lib/portaria.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entrar' };

async function entrar(formData: FormData) {
  'use server';

  const senha = senhaConfigurada();
  const digitada = String(formData.get('senha') ?? '');
  const destino = String(formData.get('de') ?? '/painel') || '/painel';

  if (!senha || !iguais(await crachaDaSenha(digitada), await crachaDaSenha(senha))) {
    redirect(`/painel/entrar?erro=1&de=${encodeURIComponent(destino)}`);
  }

  (await cookies()).set(COOKIE_PAINEL, await crachaDaSenha(senha), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(destino);
}

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; erro?: string; semSenha?: string }>;
}) {
  const { de = '/painel', erro, semSenha } = await searchParams;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Área restrita</h1>
      <p className="mb-6 text-sm text-suave">
        Aqui ficam o custo do fornecedor e a margem. Só passa quem tem a senha.
      </p>

      {semSenha ? (
        <p className="mb-4 rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          A variável <code>PAINEL_SENHA</code> não está definida neste ambiente. Enquanto ela não
          existir, ninguém entra.
        </p>
      ) : null}

      {erro ? (
        <p className="mb-4 rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          Senha incorreta.
        </p>
      ) : null}

      <form action={entrar} className="flex flex-col gap-3">
        <input type="hidden" name="de" value={de} />
        <label className="flex flex-col gap-2 text-sm">
          Senha
          <input
            name="senha"
            type="password"
            autoComplete="current-password"
            required
            className="h-12 rounded-xl border border-borda bg-superficie px-4 text-texto focus:border-acento focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="toque rounded-xl bg-acento px-6 font-semibold text-black transition hover:bg-acento-escuro"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
