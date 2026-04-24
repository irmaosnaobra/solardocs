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
};

export default nextConfig;
