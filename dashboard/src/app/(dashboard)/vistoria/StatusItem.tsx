'use client';

import { STATUS_BOTOES, TEXTOS, type MapaStatus, type StatusKey } from './tipos';

// Linha de 4 botões de status do item técnico. Tocar no botão ligado de novo limpa o status.
export default function StatusItem({
  itemKey, valor, onMudar,
}: {
  itemKey: string;
  valor: MapaStatus[string];
  onMudar: (key: string, v: StatusKey) => void;
}) {
  return (
    <div className="vst-status" role="group" aria-label={TEXTOS.statusTitulo}>
      <p className="vst-statusTit">{TEXTOS.statusTitulo}</p>
      <div className="vst-statusGrade">
        {STATUS_BOTOES.map((b) => (
          <button
            key={b.valor}
            type="button"
            aria-pressed={valor === b.valor}
            className={`vst-sbtn vst-sbtn-${b.valor} ${valor === b.valor ? 'vst-sbtnOn' : ''}`}
            onClick={() => onMudar(itemKey, b.valor)}
          >
            {b.texto}
          </button>
        ))}
      </div>
    </div>
  );
}
