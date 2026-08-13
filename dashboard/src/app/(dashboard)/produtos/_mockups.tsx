'use client';

import { useState } from 'react';
import { Lock, Check } from 'lucide-react';
import styles from './produtos.module.css';

/**
 * Mockups da loja — a cara real de cada produto, reproduzida em CSS.
 *
 * São PREVIEWS, não capturas: renderizam os mesmos elementos da tela de verdade
 * e, onde faz sentido, respondem ao toque. Ferramenta de trabalho se vende
 * mexendo, não com foto bonita — quem arrasta a margem e vê o preço mudar já
 * entendeu pra que serve antes de ler qualquer bullet.
 */

const brl = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');

/** Precificação: mexe na margem e vê o preço e o lucro andarem juntos. */
export function MockupPrecificacao() {
  const [margem, setMargem] = useState(28);
  const custo = 18400;
  const servico = 3200;
  const base = custo + servico;
  const preco = Math.round(base * (1 + margem / 100));
  const lucro = preco - base;

  return (
    <div className={styles.mock}>
      <div className={styles.mockTopo}>Precificação · orçamento de 8,2 kWp</div>
      <div className={styles.mockLinhas}>
        <div><span>Kit fotovoltaico</span><b>{brl(custo)}</b></div>
        <div><span>Mão de obra, ART e homologação</span><b>{brl(servico)}</b></div>
        <div className={styles.mockSep} />
        <div><span>Custo total da obra</span><b>{brl(base)}</b></div>
      </div>

      <label className={styles.mockLabel}>
        Sua margem <strong>{margem}%</strong>
      </label>
      <input
        className={styles.mockRange}
        type="range" min={5} max={60} value={margem}
        onChange={(ev) => setMargem(parseInt(ev.target.value, 10))}
      />

      <div className={styles.mockResultado}>
        <div>
          <span>Preço ao cliente</span>
          <strong>{brl(preco)}</strong>
        </div>
        <div className={styles.mockLucro}>
          <span>Sobra pra você</span>
          <strong>{brl(lucro)}</strong>
        </div>
      </div>
      <p className={styles.mockNota}>Arraste a margem — é assim que funciona lá dentro.</p>
    </div>
  );
}

/** Off-grid: os dias de autonomia mudam o que a bateria segura. */
export function MockupOffGrid() {
  const [dias, setDias] = useState(2);
  const bancos: Record<number, { kwh: number; util: number }> = {
    1: { kwh: 10.24, util: 8.19 },
    2: { kwh: 15.36, util: 12.29 },
    3: { kwh: 20.48, util: 16.38 },
  };
  const b = bancos[dias];
  const essencial = 4.5;
  const horas = Math.round((b.util * 0.9 / essencial) * 24);

  return (
    <div className={`${styles.mock} ${styles.mockEscuro}`}>
      <div className={styles.mockTopoEscuro}>Quanto tempo aguenta sem sol</div>
      <div className={styles.mockAut}>
        <strong>{Math.floor(horas / 24)}</strong>
        <span>dias e {horas % 24}h com o essencial ligado</span>
      </div>
      <p className={styles.mockAutSub}>
        Banco de {b.kwh.toLocaleString('pt-BR')} kWh — <b>{b.util.toLocaleString('pt-BR')} kWh utilizáveis</b>.
        O resto é a reserva que faz a bateria durar 10+ anos.
      </p>
      <div className={styles.mockChips}>
        {[1, 2, 3].map((d) => (
          <button key={d} className={dias === d ? styles.mockChipOn : styles.mockChip}
            onClick={() => setDias(d)}>
            {d} {d === 1 ? 'dia' : 'dias'}
          </button>
        ))}
      </div>
      <p className={styles.mockNota}>Escolha os dias sem sol — o banco cresce junto.</p>
    </div>
  );
}

/** Inventário: patrimônio somado, item por item. */
export function MockupInventario() {
  const itens = [
    { nome: 'Furadeira de impacto', local: 'Obra — Sítio Boa Vista', valor: 890 },
    { nome: 'Andaime 1,5 m (4 módulos)', local: 'Galpão', valor: 2400 },
    { nome: 'Cinto paraquedista + talabarte', local: 'Com o Diego', valor: 620 },
    { nome: 'Alicate amperímetro', local: 'Galpão', valor: 480 },
    { nome: 'Escada extensível 7 m', local: 'Obra — Uberlândia', valor: 1350 },
  ];
  const total = itens.reduce((s, i) => s + i.valor, 0);
  return (
    <div className={styles.mock}>
      <div className={styles.mockTopo}>Inventário · patrimônio da empresa</div>
      <div className={styles.mockPatrimonio}>
        <span>Total em equipamento</span>
        <strong>{brl(total)}</strong>
      </div>
      <div className={styles.mockItens}>
        {itens.map((i) => (
          <div key={i.nome}>
            <div>
              <b>{i.nome}</b>
              <em>{i.local}</em>
            </div>
            <span>{brl(i.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Curso: a trilha com o que já foi feito. */
export function MockupCurso({ cor }: { cor: string }) {
  const modulos = [
    { nome: 'O primeiro contato', feito: true },
    { nome: 'A proposta que responde o medo', feito: true },
    { nome: 'Reativar quem sumiu', feito: false },
    { nome: 'Objeção de preço', feito: false },
    { nome: 'Bônus — liberado por missão', feito: false, bloqueado: true },
  ];
  return (
    <div className={styles.mock}>
      <div className={styles.mockTopo}>Sua trilha</div>
      <div className={styles.mockBarra}>
        <div style={{ width: '40%', background: cor }} />
      </div>
      <div className={styles.mockModulos}>
        {modulos.map((m, i) => (
          <div key={m.nome} className={m.feito ? styles.mockModFeito : ''}>
            <span className={styles.mockModNum} style={m.feito ? { background: cor, color: '#fff' } : undefined}>
              {m.bloqueado ? <Lock size={11} /> : m.feito ? <Check size={12} /> : i + 1}
            </span>
            <b>{m.nome}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
