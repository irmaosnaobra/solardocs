/**
 * CRIA OS LINKS DE PAGAMENTO DO ASAAS PARA UM CURSO DO PLUGCASH.
 *
 *   npx ts-node --transpile-only scripts/criar-links-asaas.ts fundamentos
 *   npx ts-node --transpile-only scripts/criar-links-asaas.ts fundamentos --gravar
 *
 * Sem `--gravar` ele só MOSTRA o que faria (nenhum link criado, banco intocado).
 * Com `--gravar`, cria um link por degrau da escada e escreve `checkout_url` e
 * `asaas_link_id` em `pc_cursos.copy.ofertas` — que é o que troca o gateway
 * daquele degrau, sem deploy.
 *
 * TRAVA DE AMBIENTE: com `ASAAS_ENV` diferente de `prod`, o `--gravar` é
 * recusado. Link de sandbox não cobra ninguém, e a resolução do checkout faz o
 * link do degrau ganhar do Stripe — gravar um link de teste aqui trocaria, em
 * silêncio, um checkout que vende por um que não cobra nada.
 */

import 'dotenv/config';
import { asaasApiKey, asaasBaseUrl } from '../src/services/asaas/asaasClient';
import { criarLinkDaOferta, gravarLinksNoCurso, LinkCriado } from '../src/services/asaas/asaasPlugcashLink';
import { supabase } from '../src/utils/supabase';

const money = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

async function main(): Promise<void> {
  const slug = (process.argv[2] || '').trim();
  const gravar = process.argv.includes('--gravar');
  const prod = (process.env.ASAAS_ENV || '').trim().toLowerCase() === 'prod';

  if (!slug) throw new Error('uso: criar-links-asaas.ts <slug-do-curso> [--gravar]');
  if (!asaasApiKey()) throw new Error('ASAAS_API_KEY ausente — nada a fazer');
  if (gravar && !prod) {
    throw new Error(
      'ASAAS_ENV não é "prod": link de sandbox não cobra ninguém e não pode ir pro banco.\n' +
      'Rode sem --gravar pra conferir, ou vire a env quando a conta de produção estiver de pé.',
    );
  }

  const { data: curso } = await supabase
    .from('pc_cursos').select('slug,titulo,status,copy').eq('slug', slug).maybeSingle();
  if (!curso) throw new Error(`curso ${slug} não existe`);
  const c = curso as { titulo: string; status: string; copy?: { ofertas?: Array<Record<string, unknown>> } };
  if (c.status !== 'publicado') throw new Error(`curso ${slug} está em ${c.status} — não vende`);

  const ofertas = (c.copy?.ofertas || []).filter((o) => o && o.id && Number(o.centavos) >= 100);
  if (!ofertas.length) throw new Error(`curso ${slug} não tem copy.ofertas`);

  console.log(`\nAmbiente: ${asaasBaseUrl()}  ${prod ? '(PRODUÇÃO — cobra de verdade)' : '(sandbox — não cobra)'}`);
  console.log(`Curso: ${c.titulo} (${slug})\n`);

  const criados: LinkCriado[] = [];
  for (const o of ofertas) {
    const centavos = Math.round(Number(o.centavos));
    const rotulo = String(o.rotulo || c.titulo);
    if (!gravar) {
      console.log(`  · ${String(o.id).padEnd(9)} ${money(centavos).padStart(10)}  →  criaria link "${rotulo}"`);
      continue;
    }
    const link = await criarLinkDaOferta({
      slug, titulo: c.titulo, ofertaId: String(o.id), centavos, rotulo,
    });
    criados.push(link);
    console.log(`  · ${link.ofertaId.padEnd(9)} ${money(centavos).padStart(10)}  →  ${link.url}  (${link.linkId})`);
  }

  if (!gravar) {
    console.log('\nEnsaio. Nenhum link criado, banco intocado. Rode com --gravar pra valer.\n');
    return;
  }

  const tocadas = await gravarLinksNoCurso(slug, criados);
  console.log(`\n${tocadas} degrau(s) apontando pro Asaas. O Stripe continua atendendo quem não tem link.\n`);
}

main().catch((err) => {
  console.error('\nFALHOU:', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});
