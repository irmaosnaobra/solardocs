'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Campo de texto que grava ao sair. Quem usa põe `key` no valor do servidor: se o valor muda (ou volta
 * atrás porque o servidor recusou), o campo nasce de novo com o texto certo.
 * `onConfirmar` devolve false quando o texto não vale (vazio): o campo volta ao valor anterior.
 * Se a janela fechar com texto digitado e ainda não gravado (Esc, X), grava ao desmontar.
 */
export default function CampoTexto({
  id,
  valor,
  maxLength,
  lista,
  placeholder,
  onConfirmar,
}: {
  id: string;
  valor: string;
  maxLength: number;
  lista?: string;
  placeholder?: string;
  onConfirmar: (texto: string) => boolean;
}) {
  const [texto, setTexto] = useState(valor);
  const vivo = useRef({ texto, valor, onConfirmar });
  useEffect(() => { vivo.current = { texto, valor, onConfirmar }; });
  // Texto já enviado por este campo. O `key` do pai remonta o campo quando o valor muda, e a remontagem
  // não pode gravar de novo o que o blur acabou de gravar.
  const gravado = useRef<string | null>(null);

  useEffect(() => () => {
    const v = vivo.current;
    const t = v.texto.trim();
    if (t === v.valor || t === gravado.current) return;
    v.onConfirmar(t); // vazio: quem usa avisa e não grava
  }, []);

  return (
    <input
      id={id}
      className="est-in"
      type="text"
      list={lista}
      maxLength={maxLength}
      placeholder={placeholder}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        const t = texto.trim();
        if (t !== valor) gravado.current = t;
        if (!onConfirmar(t)) { gravado.current = null; setTexto(valor); }
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
