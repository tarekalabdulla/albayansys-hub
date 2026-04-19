// Yeastar P-Series Open API client (token caching + helpers)
import { query } from "../db/pool.js";
import { decryptSecret } from "./crypto.js";

let _tokenCache = null; // { token, expiresAt, baseUrl }

export async function getPbxConfig() {
  const { rows } = await query(
    `SELECT enabled, host, port, use_tls, api_username, api_secret_enc
     FROM pbx_settings WHERE id = 1`
  );
  const r = rows[0];
  if (!r || !r.enabled) return null;
  if (!r.host || !r.api_username || !r.api_secret_enc) return null;
  const secret = decryptSecret(r.api_secret_enc);
  if (!secret) return null;
  const proto = r.use_tls ? "https" : "http";
  return {
    baseUrl: `${proto}://${r.host}:${r.port || 8088}`,
    username: r.api_username,
    secret,
  };
}

async function fetchToken(cfg) {
  const url = `${cfg.baseUrl}/openapi/v1.0/get_token`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.username, password: cfg.secret }),
  });
  const data = await r.json().catch(() => ({}));
  const token = data?.access_token || data?.data?.access_token;
  const ttl = Number(data?.access_token_expire_time || data?.data?.access_token_expire_time || 1500);
  if (!r.ok || !token) {
    const msg = data?.errmsg || data?.message || `HTTP ${r.status}`;
    throw new Error(`Yeastar auth failed: ${msg}`);
  }
  return { token, expiresAt: Date.now() + Math.max(60, ttl - 30) * 1000 };
}

export async function getYeastarToken() {
  const cfg = await getPbxConfig();
  if (!cfg) throw new Error("PBX not configured or disabled");
  if (_tokenCache && _tokenCache.baseUrl === cfg.baseUrl && _tokenCache.expiresAt > Date.now()) {
    return { token: _tokenCache.token, baseUrl: cfg.baseUrl };
  }
  const t = await fetchToken(cfg);
  _tokenCache = { ...t, baseUrl: cfg.baseUrl };
  return { token: t.token, baseUrl: cfg.baseUrl };
}

export function clearYeastarToken() { _tokenCache = null; }

// طلب موثّق إلى Yeastar مع إعادة محاولة واحدة عند انتهاء التوكن
export async function yeastarFetch(path, { method = "GET", query: qs, body } = {}) {
  let { token, baseUrl } = await getYeastarToken();
  const buildUrl = (tk) => {
    const u = new URL(`${baseUrl}${path}`);
    u.searchParams.set("access_token", tk);
    if (qs) for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  };

  const doFetch = async (tk) => fetch(buildUrl(tk), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let r = await doFetch(token);
  if (r.status === 401) {
    clearYeastarToken();
    ({ token, baseUrl } = await getYeastarToken());
    r = await doFetch(token);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || (data?.errcode && data.errcode !== 0)) {
    const msg = data?.errmsg || data?.message || `HTTP ${r.status}`;
    const err = new Error(`Yeastar API error: ${msg}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}
