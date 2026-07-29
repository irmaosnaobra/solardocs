'use client';

// Página da campanha "o curso entra junto no VIP".
//
// Vive FORA do grupo (dashboard) de propósito: o e-mail chega pra base inteira e
// muita gente abre no celular, deslogada. Se a página exigisse sessão, o proxy
// mandaria todo mundo pro login e a oferta sumia no caminho.
//
// Quem está logado assina em um clique (checkout vip_curso: mesmo preço do VIP,
// cobrança imediata). Quem não está, entra primeiro — o link continua no e-mail.

import { useEffect, useState } from 'react';
import { isAuthenticated } from '@/services/auth';
import api from '@/services/api';

const BENEFICIOS = [
  'Curso Kit de Fechamento completo — 6 módulos e o módulo bônus',
  '26 objeções respondidas, começando pela "achei mais barato"',
  'O roteiro da visita técnica até a assinatura',
  '15 mensagens prontas de prospecção e follow-up',
  'Documentos ilimitados — sem teto mensal',
  'Contrato, procuração, recibo e proposta com seu CNPJ e sua logo',
  'Histórico permanente e suporte direto no WhatsApp',
];

export default function OfertaVipCurso() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => { setLogado(isAuthenticated()); }, []);

  async function assinar() {
    setErro('');
    setCarregando(true);
    try {
      const { data } = await api.post('/payments/create-checkout', { plan: 'vip_curso' });
      if (data?.upgraded) {
        // Já tinha cartão salvo: o Stripe cobrou a diferença na hora.
        window.location.href = '/cursos/kit-fechamento?welcome=1';
        return;
      }
      if (data?.url) { window.location.href = data.url; return; }
      setErro('Não consegui abrir o pagamento. Tente de novo em instantes.');
    } catch (e) {
      const resp = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setErro(resp === 'Você já está nesse plano'
        ? 'Você já é VIP — o curso está em Cursos, no menu.'
        : 'Não consegui abrir o pagamento. Se persistir, chame no WhatsApp (34) 99816-5040.');
      setCarregando(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: 'radial-gradient(900px 460px at 50% -100px, rgba(245,158,11,.14), transparent 65%), #0b1120',
      color: '#f8fafc',
      fontFamily: "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif",
      padding: '0 20px 80px',
    }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', padding: '58px 0 30px' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: '#fbbf24' }}>
            SolarDoc VIP
          </p>
          <h1 style={{ fontSize: 'clamp(27px, 5.6vw, 38px)', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em', margin: '12px 0 10px' }}>
            O curso que vendemos por R$ 27 já vem no seu plano
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 16.5, lineHeight: 1.6, margin: 0 }}>
            Documentos ilimitados e o Kit de Fechamento liberado na mesma conta, por R$ 67 por mês.
          </p>
        </header>

        <ul style={{ listStyle: 'none', display: 'grid', gap: 11, padding: 0, margin: '0 0 28px' }}>
          {BENEFICIOS.map((b) => (
            <li key={b} style={{ position: 'relative', paddingLeft: 28, fontSize: 15, lineHeight: 1.6, color: '#cbd5e1' }}>
              <span aria-hidden style={{
                position: 'absolute', left: 2, top: 8, width: 7, height: 7,
                borderRadius: '50%', background: '#f59e0b',
              }} />
              {b}
            </li>
          ))}
        </ul>

        {logado === false ? (
          <a
            href="/auth?mode=login"
            style={{
              display: 'block', textAlign: 'center', textDecoration: 'none',
              background: 'linear-gradient(180deg,#f59e0b,#d9860a)', color: '#0b1120',
              fontWeight: 800, fontSize: 16.5, padding: '18px 26px', borderRadius: 13,
              boxShadow: '0 10px 30px -10px rgba(245,158,11,.6)',
            }}
          >
            Entrar na minha conta para assinar →
          </a>
        ) : (
          <button
            type="button"
            onClick={assinar}
            disabled={carregando || logado === null}
            style={{
              width: '100%', border: 'none', cursor: carregando ? 'wait' : 'pointer',
              background: 'linear-gradient(180deg,#f59e0b,#d9860a)', color: '#0b1120',
              fontWeight: 800, fontSize: 16.5, padding: '18px 26px', borderRadius: 13,
              fontFamily: 'inherit', opacity: logado === null ? 0.6 : 1,
              boxShadow: '0 10px 30px -10px rgba(245,158,11,.6)',
            }}
          >
            {carregando ? 'Abrindo o pagamento…' : 'Assinar o VIP e abrir o curso →'}
          </button>
        )}

        {erro && (
          <p style={{ color: '#fca5a5', fontSize: 14, textAlign: 'center', margin: '14px 0 0' }}>{erro}</p>
        )}

        <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.65, textAlign: 'center', margin: '18px 0 0' }}>
          A cobrança começa na assinatura, sem os 7 dias de teste — é a contrapartida de o curso ir
          junto. Cancela quando quiser, direto no painel.
        </p>

        <p style={{ color: '#475569', fontSize: 12.5, textAlign: 'center', margin: '28px 0 0' }}>
          Dúvida? WhatsApp <a href="https://wa.me/5534998165040" style={{ color: '#64748b' }}>(34) 99816-5040</a>
        </p>
      </div>
    </main>
  );
}
