'use client';

import { useEffect, useRef, useState } from 'react';
import { lerQuantidade } from '@/lib/estoque/numero';

/**
 * Campo de número em texto (inputMode decimal). Guarda o que a pessoa digitou e converte ao sair do campo.
 * Vazio ou inválido não vira 0: o campo volta ao valor anterior e avisa por `onInvalido`.
 * Se a janela fechar (Esc, X, trocar de tela) com um valor digitado e ainda não gravado, grava ao desmontar;
 * se esse valor for inválido, não grava e avisa.
 */
export default function CampoNumero({
  valor,
  formatar,
  onConfirmar,
  onInvalido,
  rotulo,
  id,
  placeholder,
  disabled,
}: {
  valor: number;
  formatar: (n: number) => string;
  onConfirmar: (n: number) => void;
  onInvalido?: () => void;
  rotulo: string;
  id: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [texto, setTexto] = useState(formatar(valor));
  useEffect(() => { setTexto(formatar(valor)); }, [valor, formatar]);

  // O que vale na hora de desmontar: sempre a versão mais recente, sem refazer o efeito a cada tecla.
  const vivo = useRef({ texto, valor, formatar, onConfirmar, onInvalido });
  useEffect(() => { vivo.current = { texto, valor, formatar, onConfirmar, onInvalido }; });
  // Último número já enviado por este campo: evita gravar duas vezes (sair do campo e depois fechar a janela).
  const gravado = useRef<number | null>(null);

  const sair = () => {
    const n = lerQuantidade(texto);
    if (n == null) {
      setTexto(formatar(valor));
      onInvalido?.();
      return;
    }
    setTexto(formatar(n));
    if (n !== valor) { gravado.current = n; onConfirmar(n); }
  };

  useEffect(() => () => {
    const v = vivo.current;
    if (v.texto === v.formatar(v.valor)) return; // nada pendente
    const n = lerQuantidade(v.texto);
    if (n == null) { v.onInvalido?.(); return; }
    if (n !== v.valor && n !== gravado.current) v.onConfirmar(n);
  }, []);

  return (
    <input
      id={id}
      className="est-in"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={rotulo}
      placeholder={placeholder}
      value={texto}
      disabled={disabled}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={sair}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
