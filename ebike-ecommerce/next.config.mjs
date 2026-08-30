/** @type {import('next').NextConfig} */
const nextConfig = {
  // A loja é servida em solardoc.app/bike, por rewrite do projeto do SolarDoc.
  // Sem basePath o HTML pediria /_next/... na raiz do domínio, que é do outro
  // app, e a página viria sem estilo nenhum.
  basePath: '/bike',
  experimental: {
    // Com o rewrite, o navegador manda Origin: solardoc.app e o servidor vê o
    // host da Vercel. Sem esta lista o Next recusa a Server Action do login do
    // painel como se fosse ataque de outro site.
    serverActions: { allowedOrigins: ['solardoc.app', 'www.solardoc.app'] },
  },
  // O repositório tem outro package-lock acima; sem isto o Turbopack elege a
  // pasta errada como raiz do projeto.
  turbopack: { root: import.meta.dirname },
  images: {
    // Fotos dos produtos ficam no CDN do fornecedor. Os PNGs originais passam
    // de 1 MB cada, e o otimizador do Next reduz e serve em AVIF/WebP.
    remotePatterns: [
      { protocol: 'https', hostname: 'd242jwkdtnhx89.cloudfront.net' },
      { protocol: 'https', hostname: 'd8vlg9z1oftyc.cloudfront.net' },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
  },
};

export default nextConfig;
