import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SolarDoc Pro',
    short_name: 'SolarDoc',
    description: 'Documentação solar com IA',
    // Abre na tela de atalho (launcher). No celular mostra os atalhos; no PC ela
    // redireciona pra plataforma normal. Instalações NOVAS pegam na hora; as já
    // instaladas migram quando o manifest é relido.
    start_url: '/inicio',
    // Explícito porque a página de obrigado da Kiwify (/kit/obrigado) também
    // oferece a instalação. Sem `scope`, o padrão é derivado do start_url e fica
    // na interpretação de cada navegador — com '/' toda a plataforma entra.
    scope: '/',
    display: 'standalone',
    // Splash alinhado à tela de atalho (branca) pra não piscar no cold open.
    // theme_color = laranja da marca SolarDoc.
    background_color: '#ffffff',
    theme_color: '#F26513',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
