import axios from "axios";
import { API_URL } from "./config";

const TOKEN_KEY = "callcenter:token";

// ⚠️  Default timeout = 20s. الاختبارات الطويلة (Webhook self-test, OpenAPI test)
// يجب أن تمرّر `timeout` خاصاً عند الاستدعاء، لأن backend قد يحتاج 30s+ ليُحدّد
// no_callback_received vs endpoint_unreachable.
export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 20_000,
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // 401 → نظّف الجلسة (لكن لا تعيد التوجيه هنا — يتم في ProtectedRoute)
    if (err?.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
    }
    return Promise.reject(err);
  }
);

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};
