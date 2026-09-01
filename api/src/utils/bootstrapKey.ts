import { Request } from 'express';

// Chave de bootstrap: a porta de serviço do servidor, para o que precisa rodar
// UMA vez contra produção e não tem tela — cadastrar um catálogo, reconectar a
// linha, apurar um estado que só o servidor enxerga.
//
// Ela existe porque a alternativa é pior: `adminMiddleware` confere `is_admin`
// no banco a cada chamada, e o banco de produção não responde a chave de
// máquina nenhuma desde que o Supabase desligou as legadas. Sem esta porta, o
// único caminho para popular dados é digitar tudo à mão numa tela que não foi
// feita para isso.
//
// A constante literal é herança do `/zapi-admin` e continua valendo para não
// derrubar o que já usa. `BOOTSTRAP_KEY` no ambiente é o caminho novo: assim
// que ela estiver na Vercel, é ela que manda, e a literal pode sair daqui sem
// tocar em nenhuma rota.
const LEGADA = 'ZAPI_IO_2026_BOOTSTRAP';

export const BOOTSTRAP_KEY = LEGADA;

export function temChaveDeBootstrap(req: Request): boolean {
  const enviada = String(req.query.key || req.get('x-bootstrap-key') || '');
  if (!enviada) return false;
  const doAmbiente = (process.env.BOOTSTRAP_KEY || '').trim();
  return enviada === LEGADA || (!!doAmbiente && enviada === doAmbiente);
}
