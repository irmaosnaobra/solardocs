'use client';

// ════════════════════════════════════════════════════════════
// useLpTracking — rastreia visitas + cliques na Landing
// ════════════════════════════════════════════════════════════
// 1. No mount: gera session_id (sessionStorage), captura UTMs e
//    referrer, manda POST /tracking/visit (uma única vez por sessão).
// 2. trackEvent(type, data): registra evento (cta_click, scroll, etc).
// 3. trackScroll: amarrado num scroll listener interno — registra
//    milestones 25/50/75/100.

import { useEffect, useRef, useCallback } from 'react';
import api from '@/services/api';

const SK_SESSION = 'sd_lp_session';
const SK_VISIT_SENT = 'sd_lp_visit_sent';
const SK_SCROLL_REACHED = 'sd_lp_scroll_max';
const SK_UTMS = 'sd_lp_utms';   // UTMs persistidos no 1º acesso (sobrevivem à navegação interna)

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getOrCreateSession(): string {
  try {
    let id = sessionStorage.getItem(SK_SESSION);
    if (!id) {
      id = uuid();
      sessionStorage.setItem(SK_SESSION, id);
    }
    return id;
  } catch {
    return uuid();
  }
}

function extractUtms(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(k => {
    const v = params.get(k);
    if (v) out[k] = v;
  });
  // Persiste no 1º acesso (com UTMs na URL); recupera depois mesmo se o user
  // navegou pra outra rota interna e a query sumiu da URL.
  try {
    if (Object.keys(out).length) {
      sessionStorage.setItem(SK_UTMS, JSON.stringify(out));
      return out;
    }
    const stored = sessionStorage.getItem(SK_UTMS);
    if (stored) return JSON.parse(stored) as Record<string, string>;
  } catch {}
  return out;
}

// Lê session_id + UTMs pra mandar no checkout público (atribuição UTM→Stripe).
// Mesma origem/aba do tracking → sessionStorage está disponível aqui.
export function getCheckoutAttribution(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const out: Record<string, string> = {};
  try {
    const sid = sessionStorage.getItem(SK_SESSION);
    if (sid) out.lp_session = sid;
  } catch {}
  Object.assign(out, extractUtms());
  return out;
}

export function useLpTracking() {
  const sessionId = useRef<string>('');

  // Mount: track visit
  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionId.current = getOrCreateSession();

    // Evita re-envio quando o user recarrega a página (já é a mesma session)
    try {
      if (sessionStorage.getItem(SK_VISIT_SENT)) return;
    } catch {}

    const utms = extractUtms();
    api.post('/_t/v', {
      session_id: sessionId.current,
      ...utms,
      referrer: document.referrer || null,
      landing_url: window.location.href,
    })
      .then(() => {
        try { sessionStorage.setItem(SK_VISIT_SENT, '1'); } catch {}
      })
      .catch(() => { /* silent fail — tracking não deve quebrar UX */ });
  }, []);

  // trackEvent — usado pra CTAs e seções
  const trackEvent = useCallback((event_type: string, event_data?: Record<string, unknown>) => {
    if (!sessionId.current) sessionId.current = getOrCreateSession();
    api.post('/_t/e', {
      session_id: sessionId.current,
      event_type,
      event_data: event_data ?? null,
    }).catch(() => {});
  }, []);

  // Scroll milestones (25/50/75/100) + time_on_page no unload
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let maxReached = 0;
    try {
      const stored = parseInt(sessionStorage.getItem(SK_SCROLL_REACHED) || '0', 10);
      if (!isNaN(stored)) maxReached = stored;
    } catch {}

    const startTime = Date.now();
    const sendScroll = (depth: number) => {
      trackEvent('scroll', { depth });
    };

    function onScroll() {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const winH = window.innerHeight;
      const docH = document.documentElement.scrollHeight - winH;
      if (docH <= 0) return;
      const pct = Math.round((scrollTop / docH) * 100);
      const milestones = [25, 50, 75, 100];
      for (const m of milestones) {
        if (pct >= m && maxReached < m) {
          maxReached = m;
          try { sessionStorage.setItem(SK_SCROLL_REACHED, String(m)); } catch {}
          sendScroll(m);
        }
      }
    }

    function onBeforeUnload() {
      const seconds = Math.round((Date.now() - startTime) / 1000);
      if (seconds < 3) return;
      // sendBeacon: garante envio mesmo no unload (axios não funciona aqui)
      const payload = JSON.stringify({
        session_id: sessionId.current,
        event_type: 'time_on_page',
        event_data: { seconds },
      });
      try {
        const url = (window.location.hostname !== 'localhost')
          ? '/_api/_t/e'
          : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001') + '/_t/e';
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } catch {}
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [trackEvent]);

  return { trackEvent };
}
