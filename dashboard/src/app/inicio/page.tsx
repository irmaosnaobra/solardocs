'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { isAuthenticated } from '@/services/auth';
import api from '@/services/api';
import Logo from '@/components/Logo/Logo';
import './inicio.css';

// ── Tela de atalho (launcher) — SÓ no celular ──────────────────────────────────
// Abre quando o app abre (start_url do PWA). No PC redireciona pra plataforma
// normal (comportamento inalterado). Só pra quem já tem empresa cadastrada.
// Dá pra intercalar: "Plataforma" entra no app; o botão de grade no topo do app
// (mobileHeader) volta pra cá.

interface Tile { href: string; label: string }

// Rotas reais da plataforma (mesmas do menu). Só os nomes, sem ícone.
const TILES: Tile[] = [
  { href: '/documentos?tipo=proposta',          label: 'Gerador de Proposta' },
  { href: '/clientes',                          label: 'Cadastro Cliente' },
  { href: '/vistoria',                          label: 'Vistoria' },
  { href: '/documentos?tipo=contrato-solar',    label: 'Contrato Solar' },
  { href: '/documentos?tipo=procuracao',        label: 'Procuração' },
  { href: '/documentos?tipo=proposta-bancaria', label: 'Proposta de Banco' },
  { href: '/documentos?tipo=recibo',            label: 'Recibo' },
  { href: '/precificacao',                      label: 'Precificação' },
  { href: '/documentos?tipo=contrato-pj',       label: 'Contrato Vendedor' },
  { href: '/documentos?tipo=prestacao-servico', label: 'Prestação de Serviço' },
  { href: '/terceiros',                         label: 'Cadastro Terceiro' },
  { href: '/inventario',                        label: 'Inventário' },
];

// Entrada padrão da plataforma (o Gerador é o carro-chefe).
const PLATAFORMA = '/documentos?tipo=proposta';

export default function InicioPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [empresa, setEmpresa] = useState('');
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    // No PC, nada muda: cai direto na plataforma (o atalho é só de celular).
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      router.replace('/empresa');
      return;
    }
    if (!isAuthenticated()) { router.replace('/auth?mode=login'); return; }
    // Só vale pra quem tem empresa cadastrada; sem CNPJ → finalizar cadastro.
    api.get('/company').then(({ data }) => {
      const c = data?.company;
      if (!c?.cnpj) { router.replace('/empresa'); return; }
      setEmpresa(c.nome || 'Minha Empresa');
      setLogo(c.logo_base64 || null);
      setReady(true);
    }).catch(() => { router.replace('/empresa'); });
  }, [router]);

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
            <span className="ini-tileLabel">{t.label}</span>
          </Link>
        ))}
      </main>
    </div>
  );
}
