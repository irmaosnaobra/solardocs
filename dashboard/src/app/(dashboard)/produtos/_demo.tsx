'use client';

/**
 * DEMONSTRAÇÃO ANIMADA — a "gif" da página de venda
 *
 * NÃO é um .gif. Gravar a tela e exportar em GIF daria alguns MEGABYTES, com
 * cor achatada em 256 tons e texto borrado em qualquer aparelho com tela boa —
 * e essa página abre MUITO no celular, na obra, no 4G. Aqui a mesma coisa é
 * feita com CSS: alguns kB, nítida em qualquer tamanho, acompanha o tema e não
 * baixa arquivo nenhum.
 *
 * O que ela mostra é a ORDEM DA VENDA, não a interface: marca os aparelhos →
 * aparece a autonomia (a pergunta que trava o negócio) → o kit se dimensiona →
 * o preço fecha. Quatro cenas, doze segundos, em laço.
 *
 * A animação é só CSS (keyframes com atraso por cena). Sem timer em JS: nada
 * pra vazar quando a pessoa sai da página, e continua rodando em aba parada
 * sem custar processamento à toa.
 *
 * Quem pediu menos movimento no sistema (prefers-reduced-motion) vê a cena
 * final parada — que é a que tem o preço.
 */
import styles from './produtos.module.css';

const APARELHOS = [
  { nome: 'Geladeira', w: '150 W' },
  { nome: 'Luz da casa', w: '12× 9 W' },
  { nome: 'Bomba d’água', w: '750 W' },
  { nome: 'TV e internet', w: '120 W' },
];

export function DemoOffGrid() {
  return (
    <div className={styles.demo} aria-label="Demonstração: do aparelho marcado até o preço do kit">
      <div className={styles.demoTopo}>
        <span className={styles.demoPonto} />
        <span>Kit Off-Grid</span>
      </div>

      <div className={styles.demoPalco}>
        {/* ── Cena 1: marcar o que vai ligar ── */}
        <div className={`${styles.demoCena} ${styles.demoCena1}`}>
          <div className={styles.demoRotulo}>1 · O que vai ligar</div>
          {APARELHOS.map((a, i) => (
            <div key={a.nome} className={styles.demoItem} style={{ animationDelay: `${0.35 + i * 0.45}s` }}>
              <span className={styles.demoCheck} />
              <span className={styles.demoItemNome}>{a.nome}</span>
              <span className={styles.demoItemW}>{a.w}</span>
            </div>
          ))}
          <div className={styles.demoSoma}>
            <span>Consumo</span>
            <strong>3,6 kWh/dia</strong>
          </div>
        </div>

        {/* ── Cena 2: a pergunta que trava a venda ── */}
        <div className={`${styles.demoCena} ${styles.demoCena2}`}>
          <div className={styles.demoRotulo}>2 · Quanto tempo sem sol</div>
          <div className={styles.demoNumerao}>
            <strong>2</strong>
            <span>dias e 11h<br />com o essencial ligado</span>
          </div>
          <div className={styles.demoLinhas}>
            <div><span>Só o essencial</span><strong>2 dias</strong></div>
            <div><span>A casa inteira</span><strong>1 dia e 6h</strong></div>
            <div><span>Chovendo o dia todo</span><strong>2 dias e 11h</strong></div>
          </div>
        </div>

        {/* ── Cena 3: o kit se dimensiona ── */}
        <div className={`${styles.demoCena} ${styles.demoCena3}`}>
          <div className={styles.demoRotulo}>3 · O kit dimensionado</div>
          <div className={styles.demoKit}>
            <div style={{ animationDelay: '0.2s' }}><span>Arranjo</span><strong>1,86 kWp · 3 módulos</strong></div>
            <div style={{ animationDelay: '0.5s' }}><span>Banco</span><strong>10 kWh · 48V</strong></div>
            <div style={{ animationDelay: '0.8s' }}><span>Inversor</span><strong>5 kW · 220V</strong></div>
            <div style={{ animationDelay: '1.1s' }}><span>String</span><strong>3 em série × 1</strong></div>
          </div>
        </div>

        {/* ── Cena 4: o preço fecha ── */}
        <div className={`${styles.demoCena} ${styles.demoCena4}`}>
          <div className={styles.demoRotulo}>4 · A proposta</div>
          <div className={styles.demoPreco}>
            <span>Investimento</span>
            <strong>R$ 25.000</strong>
            <em>fornecimento + frete até a obra, com a sua margem</em>
          </div>
          <div className={styles.demoPdf}>
            <span className={styles.demoPdfIco} />
            <span>Proposta em PDF com a sua marca</span>
          </div>
        </div>
      </div>

      <div className={styles.demoBarra}>
        <i className={styles.demoBarraFill} />
      </div>
    </div>
  );
}
