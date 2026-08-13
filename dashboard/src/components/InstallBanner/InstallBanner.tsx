'use client';

import { useEffect, useState } from 'react';
import { usePwaInstall, comoInstalarManual } from '@/hooks/usePwaInstall';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';

/**
 * Convite pra instalar o app.
 *
 * Por que existe: quem usa pelo navegador entra pela senha, no meio de 20 abas.
 * Quem tem o ícone na tela abre o SolarDoc na obra, no cliente, do celular — que
 * é onde a papelada da venda solar acontece de verdade.
 *
 * Quando aparece:
 *  - logo depois de criar a conta (?welcome=1 na URL) — o momento de maior boa
 *    vontade, e o único em que a pessoa acabou de decidir usar isso;
 *  - senão, no terceiro carregamento (contado em localStorage), pra não abordar
 *    alguém que só entrou pra ver o que era.
 *
 * Some pra sempre quando a pessoa instala, dispensa, ou já está em standalone.
 * No iPhone não existe prompt: mostramos a instrução escrita, que é o único
 * caminho real (Safari → Compartilhar → Adicionar à Tela de Início).
 */

const CHAVE_DISPENSOU = 'sd_install_dismiss';
const CHAVE_VISITAS = 'sd_install_visitas';
const VISITAS_ATE_CONVIDAR = 3;

export default function InstallBanner() {
  const { instalado, podeInstalarDireto, plataforma, instalar } = usePwaInstall();
  // O hook só sabe se ESTA aba está em modo app. Quem instalou no celular e
  // abriu no desktop (ou pelo navegador) voltaria a ver o convite todo dia —
  // por isso o servidor também opina.
  const { user } = useDashboard();
  const jaInstalouAntes = !!user?.app_instalado;
  const [aberto, setAberto] = useState(false);
  const [mostrarPasso, setMostrarPasso] = useState(false);

  useEffect(() => {
    if (jaInstalouAntes) return;
    if (instalado) {
      // Rodando instalado: registra uma vez só, pra dar pra medir se o empurrão
      // funcionou sem depender do evento 'appinstalled' (que o iPhone não manda).
      try {
        if (!localStorage.getItem('sd_install_reportado')) {
          localStorage.setItem('sd_install_reportado', '1');
          api.post('/kit/app-instalado').catch(() => {});
        }
      } catch { /* localStorage bloqueado: só não mede */ }
      return;
    }

    let dispensou = false;
    let visitas = 0;
    try {
      dispensou = localStorage.getItem(CHAVE_DISPENSOU) === '1';
      visitas = Number(localStorage.getItem(CHAVE_VISITAS) || '0') + 1;
      localStorage.setItem(CHAVE_VISITAS, String(visitas));
    } catch { /* navegação privada: cai no comportamento de 1ª visita */ }

    if (dispensou) return;

    const recemChegado = new URLSearchParams(window.location.search).get('welcome') === '1';
    if (recemChegado || visitas >= VISITAS_ATE_CONVIDAR) {
      // Espera a tela pintar — banner competindo com o primeiro paint é o tipo
      // de coisa que faz a pessoa fechar sem ler.
      const t = setTimeout(() => setAberto(true), 1200);
      return () => clearTimeout(t);
    }
  }, [instalado, jaInstalouAntes]);

  if (!aberto || instalado || jaInstalouAntes) return null;

  function dispensar() {
    try { localStorage.setItem(CHAVE_DISPENSOU, '1'); } catch { /* segue */ }
    setAberto(false);
  }

  async function aoClicar() {
    if (podeInstalarDireto) {
      const aceitou = await instalar();
      if (aceitou) {
        api.post('/kit/app-instalado').catch(() => {});
        setAberto(false);
      }
      return;
    }
    setMostrarPasso(true);
  }

  const ehIphone = plataforma === 'ios-safari' || plataforma === 'ios-chrome';

  return (
    <div
      role="dialog"
      aria-label="Instalar o app do SolarDoc"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        zIndex: 9998, // abaixo do UpdateBanner (9999): atualizar é mais urgente
        width: 'min(440px, calc(100vw - 24px))',
        padding: '14px 16px',
        borderRadius: 14,
        background: '#0f172a',
        color: '#fff',
        boxShadow: '0 10px 34px rgba(0,0,0,0.32)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          aria-hidden
          style={{
            flex: 'none', width: 38, height: 38, borderRadius: 10,
            background: 'rgba(242,101,19,0.16)', border: '1px solid rgba(242,101,19,0.4)',
            display: 'grid', placeItems: 'center',
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F26513" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 14.5, marginBottom: 3 }}>
            Deixe o SolarDoc na tela do celular
          </strong>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.72)' }}>
            {mostrarPasso
              ? comoInstalarManual(plataforma)
              : ehIphone
                ? 'Abre igual app, sem digitar senha toda vez — dá pra gerar o contrato na casa do cliente.'
                : 'Um toque e ele abre igual app: sem navegador, sem digitar senha toda vez.'}
          </p>

          {/* O "Agora não" tinha 18px de altura (padding zero). Este banner cobre
              TODAS as telas: quem não quer instalar precisa conseguir fechar de
              primeira, senão erra o toque e cai na instalação que recusou. */}
          <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center', marginLeft: -14 }}>
            {!mostrarPasso && (
              <button
                type="button"
                onClick={aoClicar}
                style={{
                  border: 'none', borderRadius: 10, padding: '13px 18px', cursor: 'pointer',
                  background: '#F26513', color: '#fff', fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit',
                  marginLeft: 14,
                }}
              >
                {podeInstalarDireto ? 'Instalar agora' : 'Como instalar'}
              </button>
            )}
            <button
              type="button"
              onClick={dispensar}
              style={{
                border: 'none', background: 'none', cursor: 'pointer', padding: '13px 14px',
                color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'inherit',
              }}
            >
              {mostrarPasso ? 'Fechar' : 'Agora não'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
