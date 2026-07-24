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
    display: 'standalone',
    // Splash alinhado ao app (navy escuro) pra não piscar cinza→escuro no cold open.
    background_color: '#0b1120',
    theme_color: '#0b1120',
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
