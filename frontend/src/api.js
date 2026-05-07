import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const stored = JSON.parse(localStorage.getItem('synapse-store') || '{}');
  const token = stored?.state?.token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('synapse-store');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
