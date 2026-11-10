import axios from 'axios';
import { getToken, removeToken } from './auth';

// Em produção: usa proxy interno /_api (mesma origem → sem CORS).
// Em dev: usa a env var ou cai pra localhost:3001.
const api = axios.create({
  baseURL:
    typeof window !== 'undefined' && window.location.hostname !== 'localhost'
      ? '/_api'
      : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      removeToken();
      // ROTA PÚBLICA NÃO É EXPULSA.
      //
      // Este redirect existe pra sessão que expirou DENTRO do app. Numa página
      // pública (a LP de um produto, o orçamento que o consultor manda pro
      // cliente, a página de assinar) o 401 é o estado NORMAL — ninguém ali tem
      // conta ainda. Mandar pro login nesses casos mata a venda na porta: foi o
      // que aconteceu com as cinco LPs, todas caindo no /auth antes de mostrar
      // a oferta.
      //
      // A lista espelha o PUBLIC_PATHS do proxy.ts pelo mesmo motivo: onde o
      // servidor deixa entrar sem sessão, o cliente não pode chutar pra fora.
      const PUBLICAS = ['/lp/', '/p/', '/v/', '/m/', '/orc/', '/assinar', '/quase-la', '/plugcash', '/kit', '/oferta', '/pesquisa', '/limpar-cache'];
      const naPublica = typeof window !== 'undefined'
        && (window.location.pathname === '/'
            || PUBLICAS.some((r) => window.location.pathname.startsWith(r)));
      if (typeof window !== 'undefined' && !naPublica) {
        window.location.href = '/auth?mode=login';
      }
    }
    if (error.response?.status === 403 && error.response?.data?.error === 'LIMIT_REACHED') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('limit-reached'));
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  register: (email: string, password: string) =>
    api.post('/auth/register', { email, password }),
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
};

// Company
export const companyApi = {
  get: () => api.get('/company'),
  create: (data: { nome: string; cnpj: string; endereco?: string }) =>
    api.post('/company', data),
  update: (data: { nome?: string; cnpj?: string; endereco?: string }) =>
    api.put('/company', data),
};

// Clients
export const clientsApi = {
  list: (search?: string) =>
    api.get('/clients', { params: search ? { search } : {} }),
  create: (data: { nome: string; cpf_cnpj?: string; endereco?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cep?: string }) =>
    api.post('/clients', data),
  update: (id: string, data: { nome?: string; cpf_cnpj?: string; endereco?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cep?: string }) =>
    api.put(`/clients/${id}`, data),
  delete: (id: string) => api.delete(`/clients/${id}`),
  // Escanear Conta: manda a conta de luz (foto/PDF em base64) e recebe os
  // campos do cliente já normalizados + os dados detectados (consumo etc).
  scan: (file_base64: string, media_type: string) =>
    api.post('/clients/scan', { file_base64, media_type }),
};

// Imagens do modelo Completo da proposta solar (fotos de obras, empresas atendidas, logos de bancos).
// Responde { path, url }; o `path` é o que fica guardado e a `url` é só a miniatura.
export const portfolioApi = {
  enviarImagem: (tipo: 'obra' | 'empresa' | 'banco', dataUrl: string) =>
    api.post<{ path: string; url: string }>('/documents/portfolio-imagem', { tipo, dataUrl }),
};

// Documents
export const documentsApi = {
  generate: (tipo: string, clienteId: string, fields: Record<string, unknown>) =>
    api.post('/documents/generate', { tipo, cliente_id: clienteId, fields }),
  save: (data: {
    tipo: string;
    cliente_id?: string;
    cliente_nome?: string;
    dados_json?: Record<string, unknown>;
    content: string;
    modelo_usado?: string;
  }) => api.post('/documents/save', data),
  list: (tipo?: string) =>
    api.get('/documents/list', { params: tipo ? { tipo } : {} }),
  // Link rastreado da proposta: resumo de aberturas de todos os documentos e a lista de um só.
  aberturas: () => api.get<Record<string, ResumoAberturas>>('/documents/aberturas'),
  aberturasDoc: (id: string) => api.get<Abertura[]>(`/documents/${id}/aberturas`),
};

export interface Abertura {
  em: string;
  cidade: string | null;
  uf: string | null;
  pais?: string | null;
  dispositivo: string | null;
  vencida: boolean;
  /** Tipo do evento do link ('pdf_baixado'). Ausente ou vazio é abertura comum. */
  evento?: string | null;
}

export interface ResumoAberturas {
  total: number;
  ultima: Abertura | null;
}

// Avisos no celular (web push). O DELETE leva o corpo em `data`: o 2º argumento do axios.delete é config.
export const pushApi = {
  chave: () => api.get<{ publicKey: string }>('/push/chave'),
  inscrever: (subscription: unknown) => api.post('/push/inscricao', { subscription }),
  cancelar: (endpoint: string) => api.delete('/push/inscricao', { data: { endpoint } }),
};

// Quadro "Primeiros passos" (recepção do usuário novo). `proximo` e `feitos` contam só os 4 passos principais;
// o passo `whatsapp` só aparece na tela quando `feito` é falso.
export type PassoId = 'empresa' | 'logo' | 'fotos' | 'proposta' | 'whatsapp';

export interface PassoEstado {
  id: PassoId;
  feito: boolean;
  /** Só no passo `fotos`. */
  qtd?: number;
  minimo?: number;
}

export interface PrimeirosPassosEstado {
  passos: PassoEstado[];
  proximo: 'empresa' | 'logo' | 'fotos' | 'proposta' | null;
  feitos: number;
  total: number;
  tudoPronto: boolean;
  pago: boolean;
}

export const primeirosPassosApi = {
  get: () => api.get<PrimeirosPassosEstado>('/primeiros-passos', { timeout: 12000 }),
  salvarWhatsapp: (whatsapp: string) =>
    api.put<{ ok: boolean; whatsapp: string }>('/primeiros-passos/whatsapp', { whatsapp }),
};

export default api;
