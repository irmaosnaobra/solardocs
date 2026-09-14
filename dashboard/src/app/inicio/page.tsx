'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, Users, ClipboardCheck, FileSignature, ScrollText, Banknote,
  Receipt, Calculator, Briefcase, Wrench, Handshake, Boxes, ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { isAuthenticated } from '@/services/auth';
import api from '@/services/api';
import Logo from '@/components/Logo/Logo';
import './inicio.css';

// ── Tela de atalho (launcher) — SÓ no celular ──────────────────────────────────
// Abre quando o app abre (start_url do PWA). No PC redireciona pra plataforma
// normal (comportamento inalterado). Só pra quem já tem empresa cadastrada.
// Dá pra intercalar: "Plataforma" entra no app; o botão de grade no topo do app
// (mobileHeader) volta pra cá.

interface Tile { href: string; label: string; icon: LucideIcon }

// Rotas reais da plataforma (mesmas do menu), com um ícone pequeno por botão.
const TILES: Tile[] = [
  { href: '/documentos?tipo=proposta',          label: 'Gerador de Proposta',  icon: Sparkles },
  { href: '/clientes',                          label: 'Cadastro Cliente',     icon: Users },
  { href: '/vistoria',                          label: 'Vistoria',             icon: ClipboardCheck },
  { href: '/documentos?tipo=contrato-solar',    label: 'Contrato Solar',       icon: FileSignature },
  { href: '/documentos?tipo=procuracao',        label: 'Procuração',           icon: ScrollText },
  { href: '/documentos?tipo=proposta-bancaria', label: 'Proposta de Banco',    icon: Banknote },
  { href: '/documentos?tipo=recibo',            label: 'Recibo',               icon: Receipt },
  { href: '/precificacao',                      label: 'Precificação',         icon: Calculator },
  { href: '/documentos?tipo=contrato-pj',       label: 'Contrato Vendedor',    icon: Briefcase },
  { href: '/documentos?tipo=prestacao-servico', label: 'Prestação de Serviço', icon: Wrench },
  { href: '/terceiros',                         label: 'Cadastro Terceiro',    icon: Handshake },
  { href: '/inventario',                        label: 'Inventário',           icon: Boxes },
];

// Entrada padrão da plataforma (o Gerador é o carro-chefe).
const PLATAFORMA = '/documentos?tipo=proposta';

export default function InicioPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [empresa, setEmpresa] = useState('');
  const [logo, setLogo] = useState<string | null>(null);

  // Só vale pra quem tem empresa cadastrada; sem CNPJ → finalizar cadastro.
  // Falha de servidor ou de rede NÃO é "sem CNPJ": antes qualquer erro mandava pra
  // /empresa, e quem tem empresa caía na tela de cadastrar durante uma instabilidade.
  // Só mexe em estado dentro do retorno da chamada: o efeito da montagem chama isto, e
  // setState síncrono dentro de efeito renderiza em cascata.
  const carregar = useCallback(() => {
    api.get('/company', { timeout: 12000 }).then(({ data }) => {
      const c = data?.company;
      if (!c?.cnpj) { router.replace('/empresa'); return; }
      setEmpresa(c.nome_fantasia || c.nome || 'Minha Empresa');
      setLogo(c.logo_base64 || null);
      setReady(true);
    }).catch((err) => {
      // 401: o interceptor do api.ts já apagou a sessão e mandou pro login.
      if ((err as { response?: { status?: number } }).response?.status === 401) return;
      setFalhou(true);
    });
  }, [router]);

  useEffect(() => {
    // No PC, nada muda: cai direto na plataforma (o atalho é só de celular).
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      router.replace('/empresa');
      return;
    }
    if (!isAuthenticated()) { router.replace('/auth?mode=login'); return; }
    carregar();
  }, [router, carregar]);

  if (falhou) {
    return (
      <div role="alert" style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, padding: '0 24px', textAlign: 'center', background: 'var(--color-bg)',
      }}>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
          O SolarDoc não respondeu agora.
        </p>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--color-text-muted)', maxWidth: 340 }}>
          Sua conta está normal. É uma instabilidade momentânea, tente de novo em instantes.
        </p>
        <button type="button" onClick={() => { setFalhou(false); carregar(); }} style={{
          marginTop: 8, minHeight: 44, padding: '0 24px', border: 'none', borderRadius: 10,
          background: 'var(--color-primary)', color: '#0f172a', fontSize: 15, fontWeight: 700,
          fontFamily: 'inherit', cursor: 'pointer',
        }}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!ready) {
    return <div className="ini-loading"><div className="ini-spin" /></div>;
  }

  return (
    <div className="ini-page">
      <header className="ini-top">
        <span className="ini-brand"><span className="ini-solar">Solar</span><span className="ini-doc">Doc</span> App</span>
        <Link href={PLATAFORMA} className="ini-plataforma">Plataforma <ArrowRight size={15} strokeWidth={2.4} /></Link>
      </header>

      <div className="ini-hero">
        <div className="ini-avatar">
          {logo ? <img src={logo} alt={empresa} /> : <Logo className="ini-logoSvg" />}
        </div>
        <h1 className="ini-empresa">{empresa}</h1>
      </div>

      <main className="ini-grid">
        {TILES.map((t) => (
          <Link key={t.label} href={t.href} className="ini-tile">
            <span className="ini-tileIcon"><t.icon size={22} strokeWidth={2} /></span>
            <span className="ini-tileLabel">{t.label}</span>
          </Link>
        ))}
      </main>
    </div>
  );
}
