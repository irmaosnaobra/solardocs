import api from '@/services/api';

/** Cliques do menu contados em feature_events (feature "menu"), para decidir em 30 dias o que fica. */
export type EventoMenu = 'trafego_pago' | 'baixe_app' | 'outros_documentos';

/**
 * Registra o clique sem esperar: a navegação nunca depende da resposta, e erro some calado.
 * Não abate crédito de documento. `origem` diz de onde veio: barra do topo, gaveta do celular
 * ou o próprio menu lateral.
 */
export function logMenu(event_type: EventoMenu, origem: 'topbar' | 'gaveta' | 'menu'): void {
  try {
    api.post('/feature-events', { feature: 'menu', event_type, event_data: { origem } }).catch(() => {});
  } catch { /* contar clique nunca quebra o menu */ }
}
