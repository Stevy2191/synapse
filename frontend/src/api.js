import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

function storedToken() {
  try {
    return JSON.parse(localStorage.getItem('synapse-store') || '{}')?.state?.token || null;
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = storedToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Endpoints where a 401 means "wrong credentials", not "your session ended".
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/password'];

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const isCredentialCheck = CREDENTIAL_ENDPOINTS.some(p => url.startsWith(p));
    if (err.response?.status === 401 && !isCredentialCheck && storedToken()) {
      localStorage.removeItem('synapse-store');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
