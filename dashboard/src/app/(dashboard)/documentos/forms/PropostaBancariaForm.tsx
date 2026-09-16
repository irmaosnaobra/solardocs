'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface Equipamento { item: string; quantidade: number; }
interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

// Limiar MEDIDO na folha 2 do modelo 1, varrendo de 1 a 17 itens e contando as
// páginas do PDF de verdade. A tabela encolhe sozinha em três níveis; a partir
// de 14 itens não tem mais o que encolher e nasce uma 3ª folha.
const ITENS_MAX = 13;

const initialFields = {
  banco: '',
  agencia: '',
  conta: '',
  cpf_cnpj: '',
  concessionaria: '',
  descricao_sistema: '',
  potencia_kwp: '',
  geracao_kwh: '',
  origem_mercadoria: 'Origem da mercadoria: nacional, mercadoria ou bem com conteúdo de importação superior a 40% e inferior ou igual a 70%.',
  valor_total: '',
  valor_equipamentos: '',
  valor_mao_de_obra: '',
  valor_entrada: '',
  nota_entrada: '',
  validade_dias: '30',
  prazo_entrega: '',
  prazo_instalacao_dias: '30',
};

const initialEquipamentos: Equipamento[] = [
  { item: 'Módulos Fotovoltaicos', quantidade: 1 },
  { item: 'Micro Inversores', quantidade: 1 },
  { item: 'Kit cabo fotovoltaico', quantidade: 1 },
  { item: 'Kit estrutura telhado', quantidade: 1 },
  { item: 'Kit material elétrico A.C', quantidade: 1 },
  { item: 'Homologação do projeto de engenharia', quantidade: 1 },
  { item: 'Montagem especializada', quantidade: 1 },
];

// "21.447,00" / "21447" / "21447.00" → centavos inteiros. Equipamento + mão de
// obra tem que fechar com o total na conta do gerente, e float não fecha.
function paraCentavos(v: string): number {
  const limpo = String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const emBRL = (cent: number) =>
  'R$ ' + (cent / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PropostaBancariaPage() {
  const { user } = useDashboard();
  const [clienteId, setClienteId] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>(initialEquipamentos);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  const set = (k: keyof typeof initialFields, v: string) => setFields(f => ({ ...f, [k]: v }));

  function updateEquipamento(index: number, key: keyof Equipamento, value: string | number) {
    const arr = [...equipamentos];
    arr[index] = { ...arr[index], [key]: value };
    setEquipamentos(arr);
  }

  // Espelha a conta do papel, pra ninguém descobrir o split só depois de gerar.
  const totalC = paraCentavos(fields.valor_total);
  const eqC = paraCentavos(fields.valor_equipamentos) || Math.round(totalC * 0.82);
  const moC = paraCentavos(fields.valor_mao_de_obra) || (totalC - eqC);
  const entradaC = paraCentavos(fields.valor_entrada);
  const saldoC = totalC - entradaC;
  const splitNaoFecha = totalC > 0 && eqC + moC !== totalC;
  const entradaMaiorQueTotal = totalC > 0 && entradaC > totalC;
  const itensPreenchidos = equipamentos.filter(e => e.item.trim() !== '').length;

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) { setError('Selecione um cliente'); return; }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'propostaBanco',
        cliente_id: clienteId,
        fields: { ...fields, lista_equipamentos: equipamentos },
        useTemplate: true,
        modeloNumero: 1,
      });
      setGenerated(data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Erro ao gerar documento');
    } finally {
      setGenerating(false);
    }
  }

  if (generated) return (
    <div className={styles.page}>
      <h1 className={styles.title}>Proposta de Banco — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="propostaBanco"
        clienteId={clienteId}
        clienteNome={generated.cliente_nome}
        dadosJson={{ ...fields, lista_equipamentos: equipamentos }}
        modeloUsado={generated.modelo_usado}
        docId={generated.doc_id}
        userPlano={user?.plano}
        onNewGeneration={() => setGenerated(null)}
      />
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Proposta de Banco</h1>
        <p className={styles.subtitle}>Duas folhas de formalização para o agente financeiro</p>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cliente</h2>
          <ClientSelector value={clienteId} onChange={(id, c) => {
            setClienteId(id);
            if (c) {
              setFields(f => ({
                ...f,
                ...(c.concessionaria && !f.concessionaria ? { concessionaria: c.concessionaria } : {}),
              }));
            }
          }} />
          <div className={styles.field} style={{ marginTop: 12 }}>
            <label className={styles.label}>CPF / CNPJ do comprador</label>
            <input type="text" value={fields.cpf_cnpj} onChange={e => set('cpf_cnpj', e.target.value)} placeholder="Vazio = usa o do cadastro do cliente" className="input-field" />
            <p className={styles.avisoCampo} style={{ marginTop: 6 }}>
              <AlertTriangle size={15} />
              A folha 1 lista o CPF como exigência do banco. Sem ele aqui e sem ele no cadastro, sai uma linha pautada pra preencher à mão.
            </p>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados Bancários</h2>
          <div className={styles.grid3}>
            <div className={styles.field}>
              <label className={styles.label}>Banco *</label>
              <input type="text" value={fields.banco} onChange={e => set('banco', e.target.value)} placeholder="Ex: Sicoob" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Agência *</label>
              <input type="text" value={fields.agencia} onChange={e => set('agencia', e.target.value)} placeholder="Ex: 4033" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Conta Corrente *</label>
              <input type="text" value={fields.conta} onChange={e => set('conta', e.target.value)} placeholder="Ex: 477729" className="input-field" required />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Concessionária</label>
            <input type="text" value={fields.concessionaria} onChange={e => set('concessionaria', e.target.value)} placeholder="Ex: Cemig, CPFL, Enel" className="input-field" />
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Sistema Solar</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Potência do sistema</label>
              <input type="text" value={fields.potencia_kwp} onChange={e => set('potencia_kwp', e.target.value)} placeholder="Ex: 4,6 kWp" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Geração estimada</label>
              <input type="text" value={fields.geracao_kwh} onChange={e => set('geracao_kwh', e.target.value)} placeholder="Ex: 340 kWh/mês" className="input-field" />
            </div>
          </div>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Descrição do sistema</label>
            <textarea
              value={fields.descricao_sistema}
              onChange={e => set('descricao_sistema', e.target.value)}
              placeholder="Usada na faixa do documento só quando potência e geração ficam vazias"
              className={styles.textarea}
            />
          </div>

          <label className={styles.label} style={{ marginBottom: 8, display: 'block' }}>Equipamentos *</label>
          <div className={styles.equipmentList}>
            {equipamentos.map((eq, i) => (
              <div key={i} className={styles.equipmentRow}>
                <input
                  type="text"
                  value={eq.item}
                  onChange={e => updateEquipamento(i, 'item', e.target.value)}
                  placeholder="Descrição do item/serviço"
                  className="input-field"
                />
                <input
                  type="number"
                  value={eq.quantidade}
                  onChange={e => updateEquipamento(i, 'quantidade', Number(e.target.value))}
                  placeholder="Qtd"
                  className="input-field"
                  style={{ width: 70 }}
                  min={1}
                />
                {equipamentos.length > 1 && (
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => setEquipamentos(equipamentos.filter((_, j) => j !== i))}
                  >✕</button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className={styles.addItemBtn}
            style={{ marginTop: 8 }}
            onClick={() => setEquipamentos([...equipamentos, { item: '', quantidade: 1 }])}
          >
            + Adicionar item
          </button>
          {itensPreenchidos > ITENS_MAX && (
            <p className={styles.avisoCampo} style={{ marginTop: 10 }}>
              <AlertTriangle size={15} />
              {itensPreenchidos} itens. A tabela já encolhe sozinha, mas acima de {ITENS_MAX} a folha 2
              vira duas e a proposta sai com 3 páginas. Junte itens ou encurte descrições.
            </p>
          )}
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Valores</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Valor Total (R$) *</label>
              <input type="text" value={fields.valor_total} onChange={e => set('valor_total', e.target.value)} placeholder="Ex: 21447,00 (vírgula = decimal)" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Entrada (R$)</label>
              <input type="text" value={fields.valor_entrada} onChange={e => set('valor_entrada', e.target.value)} placeholder="Vazio = sem entrada, some do documento" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor Equipamentos (R$)</label>
              <input type="text" value={fields.valor_equipamentos} onChange={e => set('valor_equipamentos', e.target.value)} placeholder="Vazio = 82% do total automático" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor Mão de Obra (R$)</label>
              <input type="text" value={fields.valor_mao_de_obra} onChange={e => set('valor_mao_de_obra', e.target.value)} placeholder="Vazio = o que sobra do total" className="input-field" />
            </div>
          </div>

          {fields.valor_entrada.trim() !== '' && (
            <div className={styles.field}>
              <label className={styles.label}>Nota da entrada</label>
              <input type="text" value={fields.nota_entrada} onChange={e => set('nota_entrada', e.target.value)} placeholder="Vazio = “Entrada paga pelo comprador com recursos próprios”" className="input-field" />
            </div>
          )}

          {totalC > 0 && (
            <p className={styles.avisoCampo} style={{ marginTop: 4 }}>
              {(splitNaoFecha || entradaMaiorQueTotal) && <AlertTriangle size={15} />}
              <span>
                Vai sair no papel: total <b>{emBRL(totalC)}</b> = equipamento <b>{emBRL(eqC)}</b> + mão de obra <b>{emBRL(moC)}</b>
                {entradaC > 0 && <> · entrada <b>{emBRL(entradaC)}</b>, saldo a financiar <b>{emBRL(saldoC)}</b></>}
                {splitNaoFecha && <><br /><b>Equipamento + mão de obra não fecha com o total.</b> O gerente confere essa soma.</>}
                {entradaMaiorQueTotal && <><br /><b>A entrada é maior que o total</b> — o saldo a financiar sai negativo.</>}
              </span>
            </p>
          )}
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Prazos e origem</h2>
          <div className={styles.grid3}>
            <div className={styles.field}>
              <label className={styles.label}>Validade (dias) *</label>
              <input type="number" value={fields.validade_dias} onChange={e => set('validade_dias', e.target.value)} placeholder="30" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Prazo de entrega</label>
              <input type="text" value={fields.prazo_entrega} onChange={e => set('prazo_entrega', e.target.value)} placeholder="Ex: 25 dias após aprovação" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Prazo de instalação (dias úteis)</label>
              <input type="number" value={fields.prazo_instalacao_dias} onChange={e => set('prazo_instalacao_dias', e.target.value)} placeholder="30" className="input-field" />
            </div>
          </div>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Origem da mercadoria</label>
            <textarea
              value={fields.origem_mercadoria}
              onChange={e => set('origem_mercadoria', e.target.value)}
              placeholder="Vazio = a linha não aparece no documento"
              className={styles.textarea}
            />
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteId}>
          {generating ? 'Gerando...' : 'Gerar Proposta de Banco'}
        </button>
      </form>
    </div>
  );
}
