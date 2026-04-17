import axios from 'axios';
import { getToken, removeToken } from './auth';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
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
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
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
  create: (data: { nome: string; cpf_cnpj?: string; endereco?: string; cep?: string }) =>
    api.post('/clients', data),
  update: (id: string, data: { nome?: string; cpf_cnpj?: string; endereco?: string; cep?: string }) =>
    api.put(`/clients/${id}`, data),
  delete: (id: string) => api.delete(`/clients/${id}`),
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
};

export default api;
