import { redirect } from 'next/navigation';

// Documentos salvos são de todos os planos desde 28/10/2026. A página de venda que
// ficava aqui (conta/data.ts, slug "documentos") não tem mais quem mostrar: o endereço
// antigo continua valendo em favoritos e links e leva direto aos documentos.
export default function ContaDocumentosPage() {
  redirect('/historico');
}
