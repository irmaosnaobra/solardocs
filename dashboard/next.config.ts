import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Melhor compatibilidade com browsers/Android antigos
  swcMinify: true,
  compiler: {
    removeConsole: false,
  },
};

export default nextConfig;
