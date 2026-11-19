// ───────────────────────────────────────────────────────────────────────────
// TEXTO EM PORTUGUÊS DE CADA AÇÃO DO APP MONJOUR (19/11/2026), para a linha do
// tempo do membro no admin. O nome da receita e da infusão fica como o app
// escreve (espanhol). Tudo que vem do beacon é limpo e cortado antes de virar frase.
// ───────────────────────────────────────────────────────────────────────────
import type { EventoApp } from './leituraAppMonjour';

const ABAS: Record<string, string> = {
  hoy: 'Hoje', recetas: 'Receitas', compras: 'Compras', progreso: 'Progresso', plus: 'Plus', ayuda: 'Ajuda',
};

/** Texto livre do beacon: sem caracteres de controle, espaços juntados, no máximo 60. */
export function limpar(v: unknown, max = 60): string {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

const ligado = (v: string | null): boolean => v === 'true' || v === '1';

export function textoDaAcao(e: Pick<EventoApp, 'acao' | 'alvo' | 'nome' | 'dia' | 'ligado' | 'cada'>): string {
  const alvo = limpar(e.alvo);
  const nome = limpar(e.nome) || alvo;
  const dia = limpar(e.dia, 4);
  switch (e.acao) {
    case 'abriu': return dia ? `Abriu o app no dia ${dia}` : 'Abriu o app';
    case 'aba': return `Abriu a aba ${ABAS[alvo] ?? (alvo || 'sem nome')}`;
    case 'dia_visto': return dia ? `Viu o dia ${dia} do plano` : 'Viu um dia do plano';
    case 'infusion_hecha': return `Marcou a infusão ${nome}`.trim();
    case 'habito_hecho': return dia ? `Marcou o hábito do dia ${dia}` : 'Marcou o hábito do dia';
    case 'agua': return alvo ? `Registrou ${alvo} vasos de água` : 'Registrou a água do dia';
    case 'receta_vista': return `Viu a receita ${nome}`.trim();
    case 'receta_hecha': return `Fez a receita ${nome}`.trim();
    case 'favorito': return ligado(e.ligado) ? `Favoritou a receita ${nome}`.trim() : `Tirou a receita ${nome} dos favoritos`;
    case 'peso_registrado': return 'Registrou o peso';
    case 'medidas_registradas': return 'Registrou as medidas';
    case 'lista_bloque': return `Montou a lista de mercado do bloco ${alvo || 'sem nome'}${e.cada ? `, a cada ${limpar(e.cada, 3)} dias` : ''}`;
    case 'lo_tengo': return `Marcou que já tem o item ${alvo || 'da lista'}`;
    case 'enviar_lista': return 'Mandou a lista de mercado';
    case 'plus_visto': return alvo ? `Viu a seção ${alvo} do Plus` : 'Viu a aba do Plus';
    case 'upgrade_click': return 'Clicou para fazer o upgrade';
    case 'instalou': return 'Instalou o app';
    default: return 'Fez uma ação que o painel ainda não conhece';
  }
}
