'use client';

import { useState, useMemo } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import './trafego.css';

// Janela: seg–sex, 13h–19h (início), próximos 7 dias, horário de Brasília (BRT).
const HORAS = [13, 14, 15, 16, 17, 18, 19];

// Gera os próximos N dias ÚTEIS (seg–sex) a partir de amanhã, em BRT.
// Retorna { iso (yyyy-mm-dd), label } — a hora é combinada depois.
function proximosDiasUteis(qtd: number): { ymd: string; label: string }[] {
  const out: { ymd: string; label: string }[] = [];
  const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtWd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
  let cursor = new Date();
  let achados = 0;
  // começa amanhã; varre até achar `qtd` dias úteis dentro de ~10 dias corridos
  for (let i = 1; i <= 10 && achados < qtd; i++) {
    const d = new Date(cursor.getTime() + i * 24 * 60 * 60 * 1000);
    const wd = fmtWd.format(d);
    if (wd === 'Sat' || wd === 'Sun') continue;
    out.push({ ymd: fmtYmd.format(d), label: fmtData.format(d) });
    achados++;
  }
  void cursor;
  return out;
}

// Monta um ISO timestamptz pro slot: dia (BRT) + hora (BRT) → ISO com offset -03:00.
function montarSlotIso(ymd: string, hora: number): string {
  const hh = String(hora).padStart(2, '0');
  return `${ymd}T${hh}:00:00-03:00`;
}

export default function TrafegoPage() {
  const { user } = useDashboard();
  const dias = useMemo(() => proximosDiasUteis(7), []);
  const [diaSel, setDiaSel] = useState<string>('');
  const [horaSel, setHoraSel] = useState<number | null>(null);
  const [whatsapp, setWhatsapp] = useState<string>('');
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState('');

  async function agendar() {
    setErro('');
    if (!diaSel || horaSel === null) { setErro('Escolha o dia e o horário.'); return; }
    const tel = (whatsapp || '').replace(/\D/g, '');
    if (tel.length < 10) { setErro('Informe um WhatsApp válido com DDD.'); return; }
    setEnviando(true);
    try {
      await api.post('/trafego/agendar', {
        slot_at: montarSlotIso(diaSel, horaSel),
        nome: user?.nome ?? null,
        whatsapp: tel,
      });
      setFeito(true);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      if (err.response?.data?.error === 'ja_tem_pedido_pendente') {
        setErro('Você já tem um pedido aguardando confirmação. A gente já vai te responder!');
      } else if (err.response?.data?.error === 'horário_invalido') {
        setErro('Esse horário não está disponível. Escolha outro dentro da janela.');
      } else {
        setErro('Não foi possível agendar agora. Tenta de novo em instantes.');
      }
    } finally {
      setEnviando(false);
    }
  }

  if (feito) {
    return (
      <div className="traf-wrap">
        <div className="traf-sucesso">
          <div className="traf-sucesso-icon">✅</div>
          <h1>Pedido enviado!</h1>
          <p>Assim que confirmarmos seu horário, você recebe a confirmação com o link da reunião <strong>no seu e-mail e no WhatsApp</strong>. 🚀</p>
          <a className="traf-btn-sec" href="/documentos?tipo=proposta">Voltar pra plataforma</a>
        </div>
      </div>
    );
  }

  return (
    <div className="traf-wrap">
      {/* BANNER */}
      <div className="traf-hero">
        <span className="traf-tag">📈 Tráfego Pago · SolarDoc</span>
        <h1>Você tem o melhor tráfego pago da sua região?</h1>
        <p className="traf-sub">
          Quando alguém na sua cidade pesquisa <strong>“energia solar”</strong>, é o <strong>seu</strong> anúncio que aparece — ou o do concorrente?
        </p>
        <div className="traf-bullets">
          <div className="traf-bullet"><span>🎯</span> Os leads caem <strong>direto no seu Gerador</strong>, prontos pra virar proposta</div>
          <div className="traf-bullet"><span>💰</span> Gestão a partir de <strong>R$ 997/mês</strong> + a verba que você escolher</div>
          <div className="traf-bullet"><span>🏆</span> Pacotes do <strong>“testar”</strong> ao <strong>“dominar a cidade”</strong></div>
        </div>
      </div>

      {/* AGENDAMENTO */}
      <div className="traf-card">
        <h2>Marque uma call de 20 minutos</h2>
        <p className="traf-card-sub">
          Escolha um horário que funciona pra você. <strong>Seg a sex, 13h às 20h (horário de Brasília).</strong>
          A gente confirma e te manda o link da reunião.
        </p>

        <label className="traf-label">1. Escolha o dia</label>
        <div className="traf-grid">
          {dias.map(d => (
            <button
              key={d.ymd}
              type="button"
              className={`traf-opt ${diaSel === d.ymd ? 'sel' : ''}`}
              onClick={() => { setDiaSel(d.ymd); }}
            >
              {d.label}
            </button>
          ))}
        </div>

        <label className="traf-label">2. Escolha o horário</label>
        <div className="traf-grid">
          {HORAS.map(h => (
            <button
              key={h}
              type="button"
              className={`traf-opt ${horaSel === h ? 'sel' : ''}`}
              onClick={() => setHoraSel(h)}
              disabled={!diaSel}
            >
              {h}h
            </button>
          ))}
        </div>

        <label className="traf-label">3. Seu WhatsApp (com DDD)</label>
        <input
          className="traf-input"
          type="tel"
          inputMode="numeric"
          placeholder="Ex: 34 99999-9999"
          value={whatsapp}
          onChange={e => setWhatsapp(e.target.value)}
        />

        {erro && <div className="traf-erro">{erro}</div>}

        <button className="traf-btn" onClick={agendar} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Pedir confirmação da reunião →'}
        </button>
        <p className="traf-nota">Sem compromisso. Você só recebe o link depois que a gente confirmar.</p>
      </div>
    </div>
  );
}
