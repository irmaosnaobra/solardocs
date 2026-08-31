import { updateTag } from 'next/cache';
import Link from 'next/link';

import { TAG_CATALOGO, catalogoInterno, marcasDe } from '../../lib/catalogo.ts';
import { MARGEM_EM_REAIS } from '../../lib/preco.ts';
import { emReais } from '../../config/loja.ts';
import { sitePrivado } from '../../lib/portaria.ts';

/**
 * Painel interno. Renderiza no servidor e nada aqui vira componente de cliente,
 * então custo e margem não entram no JS da página, só no HTML que já passou
 * pela portaria.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Painel' };

async function atualizarAgora() {
  'use server';
  // updateTag expira na hora: quem clicou quer ver o número novo, não o antigo.
  updateTag(TAG_CATALOGO);
}

function Cartao({
  titulo,
  valor,
  detalhe,
  tom = 'neutro',
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  tom?: 'neutro' | 'bom' | 'atencao';
}) {
  const cor =
    tom === 'bom'
      ? 'border-acao/40 bg-acao-clara'
      : tom === 'atencao'
        ? 'border-alerta/40 bg-alerta/5'
        : 'border-borda bg-white';
  return (
    <div className={`rounded-2xl border p-5 ${cor}`}>
      <p className="text-xs text-suave">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{valor}</p>
      {detalhe ? <p className="mt-1 text-xs text-suave">{detalhe}</p> : null}
    </div>
  );
}

export default async function Painel() {
  const { bikes, meta } = await catalogoInterno();
  const marcas = marcasDe(bikes);

  const custoTotal = bikes.reduce((s, b) => s + b.custo, 0);
  const semEstoque = bikes.filter((b) => b.estoque === null).length;
  const porTabela = bikes.filter((b) => b.origemDoCusto === 'tabela-publica').length;

  const atualizado = new Date(meta.atualizadoEm).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel do catálogo</h1>
          <p className="text-sm text-suave">
            {meta.cd} · seção {meta.secao} · leitura de {atualizado}
          </p>
        </div>
        <div className="flex gap-2">
          <form action={atualizarAgora}>
            <button
              type="submit"
              className="toque rounded-xl border border-borda px-5 text-sm font-semibold transition hover:border-acao/60"
            >
              Atualizar agora
            </button>
          </form>
          <Link
            href="/"
            className="toque rounded-xl bg-acao px-5 text-sm font-semibold text-white transition hover:bg-acao-escura"
          >
            Ver a loja
          </Link>
        </div>
      </header>

      {meta.origem === 'reserva' ? (
        <p className="mb-6 rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          <strong>A loja está servindo a cópia de reserva.</strong> A leitura ao vivo falhou:{' '}
          {meta.erro ?? 'motivo não informado'}. Os preços continuam corretos até a data da leitura
          acima, mas o estoque pode ter mudado.
        </p>
      ) : null}

      {!meta.logado ? (
        <p className="mb-6 rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          <strong>Sem login no fornecedor.</strong> O custo abaixo é o preço de TABELA que o portal
          mostra a quem não está logado, e a quantidade em estoque não vem. Preencha{' '}
          <code>SOOLLAR_EMAIL</code> e <code>SOOLLAR_SENHA</code> para a loja passar a usar o preço
          negociado e o estoque real.
        </p>
      ) : null}

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          titulo="Modelos no ar"
          valor={String(bikes.length)}
          detalhe={`${marcas.length} marcas`}
        />
        <Cartao
          titulo="Margem por unidade"
          valor={emReais(MARGEM_EM_REAIS)}
          detalhe="soma fixa sobre o custo"
          tom="bom"
        />
        <Cartao
          titulo="Custo somado do catálogo"
          valor={emReais(custoTotal)}
          detalhe="1 unidade de cada modelo"
        />
        <Cartao
          titulo="Origem do catálogo"
          valor={meta.origem === 'ao-vivo' ? 'Ao vivo' : 'Reserva'}
          detalhe={meta.logado ? 'com login no fornecedor' : 'sem login'}
          tom={meta.origem === 'ao-vivo' && meta.logado ? 'bom' : 'atencao'}
        />
      </section>

      {(semEstoque || porTabela) && (
        <ul className="mb-8 flex flex-col gap-2 text-sm text-suave">
          {porTabela ? (
            <li>
              {porTabela} de {bikes.length} itens estão com custo vindo da tabela pública, não do
              preço negociado.
            </li>
          ) : null}
          {semEstoque ? (
            <li>
              {semEstoque} de {bikes.length} itens estão sem quantidade, então a loja mostra
              “consultar disponibilidade” neles.
            </li>
          ) : null}
          {sitePrivado() ? (
            <li className="text-alerta">
              <code>SITE_PRIVADO</code> está ligado: a loja inteira pede senha. Para abrir ao
              público, remova a variável.
            </li>
          ) : null}
        </ul>
      )}

      <div className="overflow-x-auto cartao border border-borda">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-white text-left text-xs text-suave">
            <tr>
              <th className="px-4 py-3 font-medium">Modelo</th>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 font-medium">Marca</th>
              <th className="px-4 py-3 text-right font-medium">Custo</th>
              <th className="px-4 py-3 text-right font-medium">Margem</th>
              <th className="px-4 py-3 text-right font-medium">Preço na loja</th>
              <th className="px-4 py-3 text-right font-medium">Estoque</th>
            </tr>
          </thead>
          <tbody>
            {bikes.map((b) => (
              <tr key={b.id} className="border-t border-borda align-middle">
                <td className="px-4 py-3">
                  <Link href={`/modelo/${b.slug}`} className="hover:text-acao">
                    {b.titulo}
                  </Link>
                  {b.previsao ? (
                    <span className="ml-2 text-xs text-alerta">encomenda {b.previsao}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-suave">{b.codigo}</td>
                <td className="px-4 py-3 text-suave">{b.marca}</td>
                <td className="px-4 py-3 text-right">
                  {emReais(b.custo)}
                  {b.origemDoCusto === 'tabela-publica' ? (
                    <span className="block text-[11px] text-alerta">tabela</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right text-suave">{emReais(b.margem)}</td>
                <td className="px-4 py-3 text-right font-semibold">{emReais(b.preco)}</td>
                <td className="px-4 py-3 text-right text-suave">
                  {b.estoque === null ? 'não informado' : b.estoque}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
