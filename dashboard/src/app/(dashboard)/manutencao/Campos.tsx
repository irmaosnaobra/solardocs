'use client';

import { useState } from 'react';

// Número digitado com a vírgula do teclado brasileiro.
// type="number" zera o campo quando a pessoa digita "8," e corta o ponto de milhar
// ("1.200" vira 1,2), então o campo é texto e a conversão é feita aqui.
export function parseNumero(txt: string, milhar: boolean): number | null {
  let t = txt.trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (milhar && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function comoTexto(n: number | null): string {
  return n == null ? '' : String(n).replace('.', ',');
}

export function CampoNumero({
  valor, onChange, milhar = false, placeholder, id, sufixo,
}: {
  valor: number | null;
  onChange: (n: number | null) => void;
  /** Aceita "1.200" como mil e duzentos (quantidades e kWh). Não use em kWp. */
  milhar?: boolean;
  placeholder?: string;
  id?: string;
  sufixo?: string;
}) {
  const [txt, setTxt] = useState(comoTexto(valor));
  return (
    <div className="mnt-inputWrap">
      <input
        id={id}
        className="mnt-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={txt}
        onChange={(e) => { setTxt(e.target.value); onChange(parseNumero(e.target.value, milhar)); }}
        onBlur={() => setTxt(comoTexto(parseNumero(txt, milhar)))}
      />
      {sufixo && <span className="mnt-sufixo">{sufixo}</span>}
    </div>
  );
}
