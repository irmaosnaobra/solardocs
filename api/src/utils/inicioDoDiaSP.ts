// Início do dia de calendário em America/Sao_Paulo (UTC-3 fixo, o Brasil não tem mais horário de verão).
// Usado pelos seletores "Hoje" do admin: Hoje é o dia de calendário, não as últimas 24 horas.
const fmtSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function inicioDoDiaSP(agora: number = Date.now()): Date {
  return new Date(`${fmtSP.format(new Date(agora))}T00:00:00-03:00`);
}

/** Início da janela: dias <= 1 é "Hoje" (dia de calendário de São Paulo); acima disso, "agora menos N dias". */
export function inicioDaJanelaSP(dias: number, agora: number = Date.now()): Date {
  return dias <= 1 ? inicioDoDiaSP(agora) : new Date(agora - dias * 86_400_000);
}
