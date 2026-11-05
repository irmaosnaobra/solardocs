'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { pushApi } from '@/services/api';
import styles from './AvisoNoCelular.module.css';

/**
 * Liga os avisos no celular (web push) para o link rastreado da proposta.
 *
 * Estados: ligado, desligado (mostra o botão), negado, sem suporte, iPhone fora
 * do app instalado e escondido (o servidor respondeu 503 em /push/chave, ou seja,
 * os avisos não estão configurados e não faz sentido oferecer).
 *
 * A ordem das checagens importa:
 *  - iPhone fora do app vem ANTES do "sem suporte": o Safari fora do modo app
 *    não tem PushManager e cairia na mensagem errada.
 *  - o clique pede a permissão como PRIMEIRA coisa, sem await antes: o iOS perde
 *    o gesto da pessoa depois de um await.
 */

type Estado = 'carregando' | 'escondido' | 'ligado' | 'desligado' | 'negado' | 'sem-suporte' | 'iphone';

const TEXTO_NEGADO = 'Os avisos estão bloqueados neste navegador. Libere nas configurações do site.';
const TEXTO_SEM_SUPORTE = 'Este navegador não recebe avisos.';
const TEXTO_IPHONE = 'No iPhone, adicione a SolarDoc à tela de início para receber avisos.';

function ehIos(): boolean {
  const ua = navigator.userAgent;
  // O iPadOS se apresenta como Mac, mas tem tela de toque.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function emModoApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function temSuporte(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// base64url para bytes. O Uint8Array nasce com o próprio ArrayBuffer (o tipo do applicationServerKey exige isso).
function chaveParaBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Registra o sw.js se ainda não estiver (o layout já registra no load; aqui é o cinto de segurança).
async function obterRegistro(): Promise<ServiceWorkerRegistration> {
  const existente = await navigator.serviceWorker.getRegistration();
  if (!existente) await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  return navigator.serviceWorker.ready;
}

export default function AvisoNoCelular({ compacto = false, ajuda }: {
  /** Uma linha só, para a tela da proposta. */
  compacto?: boolean;
  /** Frase de apoio. Some junto com o componente quando os avisos não estão configurados. */
  ajuda?: string;
}) {
  const [estado, setEstado] = useState<Estado>('carregando');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    const definir = (e: Estado) => { if (vivo) setEstado(e); };
    (async () => {
      // Sem chave no servidor, o componente nem aparece. Falha de rede não esconde: o clique tenta de novo.
      try {
        await pushApi.chave();
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 503) return definir('escondido');
      }
      if (ehIos() && !emModoApp()) return definir('iphone');
      if (!temSuporte()) return definir('sem-suporte');
      if (Notification.permission === 'denied') return definir('negado');
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        definir(sub && Notification.permission === 'granted' ? 'ligado' : 'desligado');
      } catch {
        definir('desligado');
      }
    })();
    return () => { vivo = false; };
  }, []);

  const ligar = useCallback(async () => {
    setErro('');
    // Primeira coisa do clique, sem await antes (iOS).
    const permissao = await Notification.requestPermission();
    if (permissao === 'denied') { setEstado('negado'); return; }
    if (permissao !== 'granted') return;
    setOcupado(true);
    try {
      const { data } = await pushApi.chave();
      const reg = await obterRegistro();
      const opcoes = { userVisibleOnly: true, applicationServerKey: chaveParaBytes(data.publicKey) };
      let sub: PushSubscription;
      try {
        sub = await reg.pushManager.subscribe(opcoes);
      } catch (err) {
        // Inscrição antiga feita com outra chave: desfaz e tenta de novo uma vez.
        if ((err as { name?: string })?.name !== 'InvalidStateError') throw err;
        const velha = await reg.pushManager.getSubscription();
        await velha?.unsubscribe();
        sub = await reg.pushManager.subscribe(opcoes);
      }
      try {
        await pushApi.inscrever(sub.toJSON());
      } catch (err) {
        // O servidor não guardou: não deixa o aparelho "ligado" sem estar.
        await sub.unsubscribe().catch(() => {});
        throw err;
      }
      setEstado('ligado');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 503) setEstado('escondido');
      else setErro('Não foi possível ligar os avisos. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }, []);

  const desligar = useCallback(async () => {
    setErro('');
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        // Avisa o servidor primeiro: se ele falhar, a inscrição fica e o link continua valendo.
        await pushApi.cancelar(sub.endpoint);
        await sub.unsubscribe();
      }
      setEstado('desligado');
    } catch {
      setErro('Não foi possível desligar os avisos. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }, []);

  if (estado === 'carregando' || estado === 'escondido') return null;

  const classe = `${styles.aviso} ${compacto ? styles.compacto : styles.normal}`;
  const mensagem =
    estado === 'negado' ? TEXTO_NEGADO
      : estado === 'sem-suporte' ? TEXTO_SEM_SUPORTE
        : estado === 'iphone' ? TEXTO_IPHONE
          : null;

  if (mensagem) {
    return (
      <div className={`${classe} ${styles.mudo}`} role="status">
        <Bell size={16} aria-hidden="true" className={styles.icone} />
        <span>{mensagem}</span>
      </div>
    );
  }

  return (
    <div className={classe}>
      {estado === 'ligado' ? (
        <>
          <BellRing size={16} aria-hidden="true" className={styles.icone} />
          <span className={styles.texto} role="status">Avisos ligados neste aparelho</span>
          <button type="button" className={styles.link} onClick={desligar} disabled={ocupado}>Desligar</button>
        </>
      ) : (
        <>
          <Bell size={16} aria-hidden="true" className={styles.icone} />
          <button type="button" className={styles.botao} onClick={ligar} disabled={ocupado}>
            {ocupado ? 'Ligando...' : 'Ativar avisos no celular'}
          </button>
        </>
      )}
      {ajuda && <span className={styles.ajuda}>{ajuda}</span>}
      {erro && <span className={styles.erro} role="alert">{erro}</span>}
    </div>
  );
}
