'use client';

import { useEffect, useState } from 'react';
import './baixe-app.css';

type InstallPrompt = {
  prompt: () => void;
  userChoice: Promise<{ outcome: string }>;
};

export default function BaixeAppPage() {
  const [host, setHost] = useState('solardoc.app');
  const [installed, setInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    setHost(window.location.host);

    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const w = window as unknown as { __pwaInstallPrompt?: InstallPrompt };
    if (w.__pwaInstallPrompt) setInstallPrompt(w.__pwaInstallPrompt);

    const handler = (e: Event) => {
      e.preventDefault();
      const p = e as unknown as InstallPrompt;
      setInstallPrompt(p);
      w.__pwaInstallPrompt = p;
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstalled(true);
      setInstallPrompt(null);
    }
  }

  return (
    <div className="baixe-wrap">
      <header className="baixe-hero">
        <span className="baixe-eyebrow">INSTALAÇÃO</span>
        <h1 className="baixe-headline">Baixe o App</h1>
        <p className="baixe-sub">
          Instale o SolarDoc na tela inicial do seu celular ou desktop. Vira ícone como qualquer outro app,
          abre em janela própria e fica disponível mesmo offline.
        </p>

        {installed ? (
          <div className="baixe-installed-badge">App já instalado neste dispositivo</div>
        ) : installPrompt ? (
          <button className="baixe-install-now" onClick={handleInstall}>
            Instalar agora
          </button>
        ) : null}
      </header>

      <div className="baixe-grid">
        <div className="baixe-card">
          <div className="baixe-card-title">Android</div>
          <div className="baixe-card-sub">Chrome ou Edge</div>
          <ol className="baixe-steps">
            <li>Abre <code>{host}</code> no Chrome</li>
            <li>Toca nos <strong>3 pontinhos</strong> ▸ <strong>Instalar app</strong> (ou aparece um banner &ldquo;Adicionar à tela inicial&rdquo;)</li>
            <li>Confirma — vira ícone na tela inicial igual qualquer app</li>
          </ol>
        </div>

        <div className="baixe-card">
          <div className="baixe-card-title">iPhone</div>
          <div className="baixe-card-sub">Safari (não funciona no Chrome iOS)</div>
          <ol className="baixe-steps">
            <li>Abre o link no <strong>Safari</strong></li>
            <li>Toca no botão <strong>Compartilhar</strong> (quadrado com seta pra cima)</li>
            <li>Rola e toca em <strong>Adicionar à Tela de Início</strong></li>
            <li>Confirma — vira ícone com a logo</li>
          </ol>
        </div>

        <div className="baixe-card">
          <div className="baixe-card-title">Desktop</div>
          <div className="baixe-card-sub">Chrome ou Edge</div>
          <ol className="baixe-steps">
            <li>No site, aparece um ícone <strong>⊕</strong> ao lado da estrela na barra de endereço</li>
            <li>Clica e instala — vira janela própria, sem barras</li>
          </ol>
        </div>
      </div>

      <div className="baixe-tip">
        <strong>Por que instalar?</strong> Abre direto da tela inicial, sem precisar lembrar do link, abre mais rápido, ocupa menos memória que o navegador, e funciona como um app de verdade.
      </div>
    </div>
  );
}
