import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  compiler: {
    removeConsole: false,
  },
  async redirects() {
    return [
      { source: '/login', destination: '/auth', permanent: false },
      { source: '/register', destination: '/auth?mode=register', permanent: false },
      { source: '/esqueci-senha', destination: '/auth?mode=esqueci', permanent: false },
      { source: '/redefinir-senha', destination: '/auth?mode=redefinir', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // O sw.js NUNCA pode ficar preso em cache HTTP — senão um kill-switch
        // (voltar o self-destruct) demoraria a chegar nos usuários. Sempre revalida.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
