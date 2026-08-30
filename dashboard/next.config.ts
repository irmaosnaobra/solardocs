import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    removeConsole: false,
  },
  async rewrites() {
    return [
      // A loja de bikes é um projeto Vercel separado (bikes-irmaos-na-obra):
      // tem cron próprio, lê o catálogo do fornecedor e guarda custo e margem,
      // então não entra no build deste app. Aqui só emprestamos o caminho
      // /bike do domínio. O app de lá roda com basePath /bike, por isso o
      // destino repete o prefixo em vez de removê-lo.
      { source: '/bike', destination: 'https://bikes-irmaos-na-obra.vercel.app/bike' },
      {
        source: '/bike/:caminho*',
        destination: 'https://bikes-irmaos-na-obra.vercel.app/bike/:caminho*',
      },
    ];
  },
  async redirects() {
    return [
      { source: '/login', destination: '/auth', permanent: false },
      { source: '/register', destination: '/auth?mode=register', permanent: false },
      { source: '/esqueci-senha', destination: '/auth?mode=esqueci', permanent: false },
      { source: '/redefinir-senha', destination: '/auth?mode=redefinir', permanent: false },
      // /planos foi removida como página, mas vários CTAs de upgrade (banner,
      // minha-conta, historico, layout) E os emails de conversão já enviados
      // ainda apontam pra ela → 404. A seção de planos vive na home (#planos).
      // Redirect resgata TODOS de uma vez, inclusive emails já disparados.
      { source: '/planos', destination: '/#planos', permanent: false },
      // Mesma história da /planos: a campanha "o curso entra junto no VIP" foi
      // desligada em 30/07/2026 (curso virou produto à parte) e a página de
      // oferta saiu. Só que os e-mails já disparados continuam na caixa de
      // entrada apontando pra cá. Manda pra LP do curso, que é onde a pessoa
      // consegue comprar o que o e-mail prometeu — em vez de bater num 404.
      { source: '/oferta/vip-curso', destination: '/kit', permanent: false },
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
