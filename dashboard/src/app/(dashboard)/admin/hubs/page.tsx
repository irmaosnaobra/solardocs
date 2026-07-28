import { redirect } from 'next/navigation';

// Rota consolidada: os Hubs de Produto agora SÃO o /admin (Painel SolarDoc).
// Mantida só pra redirecionar quem tiver o link antigo /admin/hubs salvo.
export default function HubsRedirect() {
  redirect('/admin');
}
