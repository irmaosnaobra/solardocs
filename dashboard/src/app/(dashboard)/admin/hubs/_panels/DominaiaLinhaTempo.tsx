'use client';

// A linha do tempo da Domina IA: a jornada de uma sessão do quiz, tela por tela.
// Quem chama monta os itens na ordem que quer mostrar. A linha separa por dia
// (horário de Brasília) e marca cada item com um ponto no trilho: ícone ou número.
import type { ReactNode } from 'react';
import g from './DominaiaJornadas.module.css';

export type TomLinha = 'neutro' | 'marca' | 'compra' | 'alerta';

export type ItemLinha = {
  chave: string;
  /** ISO. */
  quando: string;
  titulo: ReactNode;
  detalhe?: ReactNode;
  /** À direita do título: tempo na tela, por exemplo. */
  lado?: ReactNode;
  /** Dentro do ponto: ícone de 14 px ou o número da tela. */
  marca?: ReactNode;
  tom?: TomLinha;
};

const TZ = 'America/Sao_Paulo';
const diaDe = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const semana = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long' });
const horaDe = (d: Date, segundos: boolean) =>
  d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', ...(segundos ? { second: '2-digit' } : {}) });

const TOM: Record<TomLinha, string> = { neutro: '', marca: g.pontoMarca, compra: g.pontoCompra, alerta: g.pontoAlerta };

export default function DominaiaLinhaTempo({ itens, rotulo, segundos, vazio }: {
  itens: ItemLinha[];
  /** Nome da lista para o leitor de tela. */
  rotulo: string;
  /** Hora com segundos (jornada do quiz). */
  segundos?: boolean;
  vazio?: ReactNode;
}) {
  if (!itens.length) return <p className={g.linhaVazia}>{vazio ?? 'Nada registrado ainda.'}</p>;

  // Agrupa por dia mantendo a ordem de quem chamou.
  const grupos: { dia: string; rotuloDia: string; itens: { item: ItemLinha; hora: string; iso: string }[] }[] = [];
  for (const item of itens) {
    const d = new Date(item.quando);
    const ok = !Number.isNaN(d.getTime());
    const dia = ok ? diaDe(d) : 'Sem data';
    let grupo = grupos[grupos.length - 1];
    if (!grupo || grupo.dia !== dia) {
      grupo = { dia, rotuloDia: ok ? `${dia.slice(0, 5)}, ${semana(d)}` : dia, itens: [] };
      grupos.push(grupo);
    }
    grupo.itens.push({ item, hora: ok ? horaDe(d, !!segundos) : '', iso: ok ? d.toISOString() : '' });
  }

  return (
    <section className={g.linha} aria-label={rotulo}>
      {grupos.map((grupo) => (
        <div key={grupo.dia}>
          <h4 className={g.linhaDia}>{grupo.rotuloDia}</h4>
          <ol className={g.linhaLista}>
            {grupo.itens.map(({ item, hora, iso }) => (
              <li key={item.chave} className={g.linhaItem}>
                <time className={g.linhaHora} dateTime={iso || undefined}>{hora}</time>
                <span className={`${g.ponto} ${TOM[item.tom ?? 'neutro']}`} aria-hidden="true">{item.marca}</span>
                <div className={g.linhaTexto}>
                  <div className={g.linhaTitulo}>
                    <span>{item.titulo}</span>
                    {item.lado && <span className={g.linhaLado}>{item.lado}</span>}
                  </div>
                  {item.detalhe && <div className={g.linhaDetalhe}>{item.detalhe}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
