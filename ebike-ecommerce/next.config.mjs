/** @type {import('next').NextConfig} */
const nextConfig = {
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
