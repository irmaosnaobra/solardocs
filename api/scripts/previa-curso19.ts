// Prévia da campanha de reconquista com a entrada de R$19 — MODO SECO.
//
// Roda contra o banco REAL mas NÃO envia nada, NÃO grava estado e NÃO consome o
// teto anti-ban: só mostra quem entraria e o texto que sairia. É como se revisa
// a campanha antes de ela tocar em alguém.
//
// Uso:
//   cd api && npx ts-node --transpile-only scripts/previa-curso19.ts
//   cd api && npx ts-node --transpile-only scripts/previa-curso19.ts 10   (mostra 10 mensagens)
import 'dotenv/config';
import { runCursoEntradaBroadcast } from '../src/services/agents/whatsapp/cursoEntradaBroadcast';

const mostrar = Number(process.argv[2]) || 3;

/** Esconde o miolo do telefone — a prévia é pra conferir a campanha, não a lista. */
function mascara(tel: string): string {
  const d = (tel || '').replace(/\D/g, '');
  return d.length < 8 ? d : `${d.slice(0, 4)}****${d.slice(-4)}`;
}

(async () => {
  const r = await runCursoEntradaBroadcast({ seco: true, limite: 500 });

  if (r.motivo) {
    console.log(`\n⚠️  Campanha não rodaria agora: ${r.motivo}\n`);
    return;
  }

  console.log('\n═══ PRÉVIA — CAMPANHA CURSO R$19 (nada foi enviado) ═══\n');
  console.log(`  Entrariam agora ....... ${r.enviados}`);
  console.log(`  Elegíveis no total .... ${r.elegiveis}`);
  console.log(`  Pulados ............... ${r.pulados}`);

  const previa = r.previa ?? [];
  const porSituacao: Record<string, number> = {};
  const porToque: Record<number, number> = {};
  for (const p of previa) {
    porSituacao[p.situacao] = (porSituacao[p.situacao] ?? 0) + 1;
    porToque[p.toque] = (porToque[p.toque] ?? 0) + 1;
  }
  console.log(`\n  Por situação .......... ${JSON.stringify(porSituacao)}`);
  console.log(`  Por toque ............. ${JSON.stringify(porToque)}`);

  console.log(`\n─── ${Math.min(mostrar, previa.length)} mensagens de exemplo ───`);
  for (const [i, p] of previa.slice(0, mostrar).entries()) {
    console.log(`\n[${i + 1}] ${p.nome} · ${p.situacao} · toque ${p.toque} · ${mascara(p.telefone)}`);
    console.log(p.mensagem.split('||').map((b) => `    ${b.trim()}`).join('\n'));
  }

  console.log('\n─── ritmo real de saída ───');
  console.log('  O teto anti-ban da linha é COMPARTILHADO com a Carla (4/hora).');
  console.log(`  ${r.enviados} pessoas levam ~${Math.ceil(r.enviados / 4)}h de drip, competindo com os follow-ups dela.\n`);
})().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
