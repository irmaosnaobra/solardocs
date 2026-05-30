'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, HelpCircle, User, Building2, LogOut, Palette, Smartphone } from 'lucide-react';
import { removeToken } from '@/services/auth';
import styles from './TopBar.module.css';

const WA_SUPORTE = 'https://wa.me/5534999437831?text=' + encodeURIComponent('Olá! Preciso de ajuda com o SolarDoc.');

interface TopBarProps {
  userEmail?: string;
}

export default function TopBar({ userEmail }: TopBarProps) {
  const router = useRouter();
  const initials = (userEmail || '?').slice(0, 1).toUpperCase();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  function handleLogout() {
    removeToken();
    router.push('/auth?mode=login');
  }

  return (
    <header className={styles.topbar}>
      <Link href="/documentos?tipo=proposta" className={styles.brand}>
        <span className={styles.brandSolar}>Solar</span><span className={styles.brandDoc}>Doc</span>
      </Link>

      <div className={styles.spacer} />

      <div className={styles.actions}>
        <a href="https://pack.solardoc.app/" target="_blank" rel="noopener noreferrer" className={styles.iconBtn} title="Crie seu Mascote">
          <Palette size={18} />
        </a>
        <Link href="/baixe-app" className={styles.iconBtn} title="Baixe o App">
          <Smartphone size={18} />
        </Link>
        <Link href="/conta/documentos" className={styles.iconBtn} title="Documentos salvos">
          <FileText size={18} />
        </Link>
        <a href={WA_SUPORTE} target="_blank" rel="noopener noreferrer" className={styles.iconBtn} title="Ajuda / Suporte">
          <HelpCircle size={18} />
        </a>

        <div className={styles.avatarWrap} ref={wrapRef}>
          <button className={styles.avatar} title={userEmail} onClick={() => setMenuOpen((v) => !v)}>
            {initials}
          </button>
          {menuOpen && (
            <div className={styles.menu}>
              {userEmail && <div className={styles.menuEmail}>{userEmail}</div>}
              <Link href="/conta/documentos" className={styles.menuItem} onClick={() => setMenuOpen(false)}>
                <User size={15} /> Minha conta
              </Link>
              <Link href="/empresa" className={styles.menuItem} onClick={() => setMenuOpen(false)}>
                <Building2 size={15} /> Empresa
              </Link>
              <button className={styles.menuItem} onClick={handleLogout}>
                <LogOut size={15} /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
