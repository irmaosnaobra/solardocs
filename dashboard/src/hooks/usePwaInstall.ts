'use client';

import { useCallback, useEffect, useState } from 'react';

// Instalação do app (PWA) num lugar só.
//
// A mesma lógica vivia copiada no LoginForm e na /baixe-app, e as duas cópias
// perdiam o evento quando ele chegava antes da tela montar. Aqui o evento vem
// de window.__pwaInstallPrompt, que o layout raiz captura já no carregamento.
//
// iPhone não tem prompt nativo: no Safari a instalação é manual (Compartilhar →
// Adicionar à Tela de Início) e o Chrome do iOS nem isso — precisa abrir no
// Safari antes. Por isso `plataforma` existe: a instrução muda por aparelho.

export type PlataformaPwa = 'ios-safari' | 'ios-chrome' | 'android' | 'desktop';

type PromptPwa = {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type JanelaComPrompt = Window & { __pwaInstallPrompt?: PromptPwa | null };

export type EstadoPwa = {
  /** Já está rodando instalado (standalone) — não faz sentido oferecer nada. */
  instalado: boolean;
  /** O navegador topa instalar por botão (Android/Chrome/Edge). */
  podeInstalarDireto: boolean;
  plataforma: PlataformaPwa | null;
  /** Dispara o prompt nativo. Devolve true se a pessoa aceitou. */
  instalar: () => Promise<boolean>;
};

export function usePwaInstall(): EstadoPwa {
  const [prompt, setPrompt] = useState<PromptPwa | null>(null);
  const [instalado, setInstalado] = useState(false);
  const [plataforma, setPlataforma] = useState<PlataformaPwa | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    const iosChrome = ios && /CriOS|FxiOS|EdgiOS/i.test(ua);
    const android = /android/i.test(ua);

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (standalone) {
      setInstalado(true);
      return;
    }

    setPlataforma(ios ? (iosChrome ? 'ios-chrome' : 'ios-safari') : android ? 'android' : 'desktop');

    const w = window as JanelaComPrompt;
    if (w.__pwaInstallPrompt) setPrompt(w.__pwaInstallPrompt);

    const aoPoder = (e: Event) => {
      e.preventDefault();
      const p = e as unknown as PromptPwa;
      setPrompt(p);
      w.__pwaInstallPrompt = p;
    };
    const aoInstalar = () => {
      setInstalado(true);
      setPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', aoPoder);
    window.addEventListener('appinstalled', aoInstalar);
    // Os dois listeners saem juntos — a versão antiga esquecia o 'appinstalled'
    // e ele vazava a cada remontagem da tela.
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPoder);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);

  const instalar = useCallback(async () => {
    if (!prompt) return false;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    const w = window as JanelaComPrompt;
    w.__pwaInstallPrompt = null;
    setPrompt(null);
    if (outcome === 'accepted') setInstalado(true);
    return outcome === 'accepted';
  }, [prompt]);

  return { instalado, podeInstalarDireto: !!prompt, plataforma, instalar };
}

/** Instrução escrita para quem não tem botão nativo (iPhone e afins). */
export function comoInstalarManual(p: PlataformaPwa | null): string {
  switch (p) {
    case 'ios-safari':
      return 'Toque em Compartilhar (o quadrado com a seta pra cima) e depois em "Adicionar à Tela de Início".';
    case 'ios-chrome':
      return 'No iPhone só dá pelo Safari: abra solardoc.app no Safari, toque em Compartilhar e em "Adicionar à Tela de Início".';
    case 'android':
      return 'Toque no menu do navegador (⋮) e escolha "Instalar app" ou "Adicionar à tela inicial".';
    default:
      return 'No Chrome ou Edge, clique no ícone de instalar na barra de endereço (à direita).';
  }
}
