// ============================================================================
// /api/integrations/status — حالة Webhook + Yeastar OpenAPI + AMI
// تُستخدم في صفحة "حالة الاتصالات" بالواجهة (auto-refresh كل 5s)
// ============================================================================
import { Router } from "express";
import crypto from "crypto";
import net from "net";
import { verifyToken } from "../middleware/auth.js";
import { getYeastarApiStatus } from "../realtime/yeastar-openapi.js";
import { getAmiStatus } from "../services/amiService.js";
import { getWebhookStatus } from "./webhooks-yeastar.js";
import { getEffectiveConfigSync } from "../services/runtimeConfig.js";

function maskSecret(s) {
  if (!s || typeof s !== "string") return "(empty)";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)} (len=${s.length})`;
}

const router = Router();

// auth خفيف — admin/supervisor فقط
router.use((req, res, next) => {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = tok ? verifyToken(tok) : null;
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  req.user = payload;
  next();
});

router.get("/status", (_req, res) => {
  const webhook = getWebhookStatus();
  const openapi = getYeastarApiStatus();
  const ami     = getAmiStatus();

  // وضع موحّد لكل خدمة:
  //   "connected" | "failed" | "disabled" | "idle"
  const webhookStatus = !webhook.tokenConfigured && !webhook.secretConfigured
    ? "disabled"
    : webhook.lastEventAt
      ? (Date.now() - webhook.lastEventAt < 30 * 60_000 ? "connected" : "idle")
      : "idle";

  const openapiStatus = openapi.disabled
    ? "disabled"
    : !openapi.configured
      ? "disabled"
      : openapi.wsState === 1
        ? "connected"
        : "failed";

  const amiStatus = !ami.configured
    ? "disabled"
    : ami.connected && ami.loggedIn
      ? "connected"
      : "failed";

  res.json({
    serverTime: Date.now(),
    webhook: { ...webhook, status: webhookStatus },
    openapi: { ...openapi, status: openapiStatus },
    ami:     { ...ami,     status: amiStatus },
  });
});

// ============================================================================
// اختبارات يدوية — كل اختبار يعيد { ok, message, durationMs, ... }
// ============================================================================

// ============================================================================
// Webhook test — نستدعي endpoint الذاتي للتأكد أن
//   Nginx + token + HMAC + DB تعمل سويةً.
//
// نُميّز بين النتائج التالية:
//   "endpoint_reachable"   → استجاب 2xx (Webhook كامل وسليم)
//   "invalid_signature"    → استجاب 401 (HMAC غير صحيح — السر مختلف)
//   "rejected_request"     → استجاب 4xx آخر (مثل 403 ip_not_allowed)
//   "endpoint_unreachable" → خطأ شبكة قبل استجابة الخادم
//   "no_callback_received" → انتهت المهلة دون استجابة (timeout)
//   "disabled"             → لا توجد إعدادات (token غير مضبوط)
// ============================================================================
const WEBHOOK_TEST_TIMEOUT_MS = 30_000;   // كان 8s — الآن 30s لمنع AbortError سريع

router.post("/test/webhook", async (req, res) => {
  const t0 = Date.now();
  const live = getEffectiveConfigSync() || {};
  const token  = process.env.YEASTAR_WEBHOOK_TOKEN || "";
  const secret = live.webhookSecret || process.env.YEASTAR_WEBHOOK_SECRET || "";

  console.log("[integrations/test/webhook] starting",
    "token=" + maskSecret(token),
    "secret=" + (secret ? maskSecret(secret) : "(none)"),
    `timeout=${WEBHOOK_TEST_TIMEOUT_MS}ms`,
  );

  if (!token) {
    return res.json({
      ok: false,
      status: "disabled",
      durationMs: Date.now() - t0,
      message: "YEASTAR_WEBHOOK_TOKEN غير مضبوط في .env — Webhook معطّل",
    });
  }

  const host = req.get("host") || `127.0.0.1:${process.env.PORT || 4000}`;
  const proto = req.protocol || "http";
  const url = `${proto}://${host}/api/yeastar/webhook/call-event/${encodeURIComponent(token)}`;

  const body = JSON.stringify({
    type: 30012,
    msg: {
      call_id: `TEST-${Date.now()}`,
      caller_num: "0000000000",
      callee_num: "100",
      call_status: "test",
      duration: 0,
      _self_test: true,
    },
  });
  const headers = { "Content-Type": "application/json" };
  if (secret) {
    headers["X-Yeastar-Signature"] =
      "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TEST_TIMEOUT_MS);

  try {
    const r = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    const txt = await r.text().catch(() => "");

    console.log(`[integrations/test/webhook] response status=${r.status} from ${url}`);

    if (r.ok) {
      return res.json({
        ok: true,
        status: "endpoint_reachable",
        httpStatus: r.status,
        url,
        durationMs: Date.now() - t0,
        message: `Webhook استقبل الاختبار بنجاح (HTTP ${r.status}).`,
      });
    }
    if (r.status === 401) {
      return res.json({
        ok: false,
        status: "invalid_signature",
        httpStatus: 401,
        url,
        durationMs: Date.now() - t0,
        message: secret
          ? `Webhook رفض التوقيع (HTTP 401). السرّ المُرسَل لا يطابق YEASTAR_WEBHOOK_SECRET في الخادم.`
          : `Webhook يتطلّب توقيعاً ولم نُرسل أي سرّ (HTTP 401). اضبط webhookSecret.`,
      });
    }
    if (r.status === 403) {
      return res.json({
        ok: false,
        status: "rejected_request",
        httpStatus: 403,
        url,
        durationMs: Date.now() - t0,
        message: `Webhook رفض الـ IP (HTTP 403). تحقق من allowedIps في الإعدادات.`,
      });
    }
    if (r.status === 503) {
      return res.json({
        ok: false,
        status: "rejected_request",
        httpStatus: 503,
        url,
        durationMs: Date.now() - t0,
        message: `Webhook معطّل من لوحة التحكم (HTTP 503). فعّل enableWebhook.`,
      });
    }
    return res.json({
      ok: false,
      status: "rejected_request",
      httpStatus: r.status,
      url,
      durationMs: Date.now() - t0,
      message: `استجاب الخادم بـ HTTP ${r.status}: ${txt.slice(0, 200)}`,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      return res.json({
        ok: false,
        status: "no_callback_received",
        url,
        durationMs: Date.now() - t0,
        message: `انتهت المهلة بعد ${WEBHOOK_TEST_TIMEOUT_MS}ms دون استجابة من ${url}. تأكد من أن Nginx يُمرّر /api/ إلى المنفذ ${process.env.PORT || 4000}.`,
      });
    }
    return res.json({
      ok: false,
      status: "endpoint_unreachable",
      url,
      durationMs: Date.now() - t0,
      message: `تعذّر الوصول للـ endpoint: ${e.message}`,
    });
  }
});

// ============================================================================
// OpenAPI test — يجرّب get_token مباشرة على PBX
// OAuth حصراً (client_id + client_secret). لا fallback إلى username/password.
// ============================================================================
const OPENAPI_TEST_TIMEOUT_MS = 15_000;

router.post("/test/openapi", async (_req, res) => {
  const t0 = Date.now();
  const live = getEffectiveConfigSync() || {};
  const base = (live.baseUrl || process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "")
    .replace(/\/+$/, "");
  const clientId     = live.clientId     || process.env.YEASTAR_CLIENT_ID     || "";
  const clientSecret = live.clientSecret || process.env.YEASTAR_CLIENT_SECRET || "";

  console.log("[integrations/test/openapi] starting",
    "base=" + (base || "(empty)"),
    "auth=oauth",
    "client_id=" + maskSecret(clientId),
    "client_secret=" + maskSecret(clientSecret),
  );

  if (!base) {
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      message: "YEASTAR_BASE_URL غير مضبوط في الإعدادات/البيئة",
    });
  }
  if (!clientId || !clientSecret) {
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      message: "بيانات OAuth ناقصة — مطلوب client_id + client_secret (لا ندعم username/password)",
    });
  }

  const url = `${base}/openapi/v1.0/get_token`;
  const payload = { client_id: clientId, client_secret: clientSecret };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAPI_TEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await r.json().catch(() => ({}));

    console.log(
      `[integrations/test/openapi] response http=${r.status}`,
      `errcode=${data.errcode ?? "-"}`,
      `errmsg="${data.errmsg ?? ""}"`,
    );

    const accessToken = data.access_token || data.data?.access_token;
    if (r.ok && (data.errcode === 0 || data.errcode === undefined) && accessToken) {
      return res.json({
        ok: true,
        durationMs: Date.now() - t0,
        endpoint: url,
        authMode: "oauth",
        expiresIn: data.expire_time || data.data?.expire_time || 1800,
        message: `حصلنا على access_token من ${base} بنجاح (OAuth).`,
      });
    }
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      endpoint: url,
      authMode: "oauth",
      httpStatus: r.status,
      errcode: data.errcode ?? null,
      errmsg: data.errmsg ?? null,
      message: `رفض PBX المصادقة: errcode=${data.errcode ?? r.status} ${data.errmsg || ""}`.trim(),
    });
  } catch (e) {
    clearTimeout(timer);
    const reason = e.name === "AbortError"
      ? `انتهت المهلة بعد ${OPENAPI_TEST_TIMEOUT_MS}ms`
      : e.message;
    console.warn(`[integrations/test/openapi] network error: ${reason}`);
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      endpoint: url,
      authMode: "oauth",
      message: `تعذّر الوصول لـ ${base}: ${reason}`,
    });
  }
});

// ----- AMI: يفتح TCP connect فقط (login بدون مزامنة)
router.post("/test/ami", async (_req, res) => {
  const t0 = Date.now();
  const live = getEffectiveConfigSync() || {};
  const host = live.amiHost || process.env.YEASTAR_AMI_HOST || "";
  const port = (Number.isInteger(live.amiPort) && live.amiPort > 0)
    ? live.amiPort
    : parseInt(process.env.YEASTAR_AMI_PORT || "5038", 10);
  if (!host) {
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: "YEASTAR_AMI_HOST غير مضبوط (AMI معطّل)" });
  }
  const result = await new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => { if (!done) { done = true; try { sock.destroy(); } catch { /* noop */ } resolve({ ok, msg }); } };
    sock.setTimeout(8000);
    sock.once("connect", () => finish(true, `TCP متصل بـ ${host}:${port}`));
    sock.once("timeout", () => finish(false, `انتهت المهلة عند الاتصال بـ ${host}:${port} (الـ VPS لا يصل للسنترال)`));
    sock.once("error",   (e) => finish(false, `${e.code || "ERR"}: ${e.message}`));
    sock.connect(port, host);
  });
  res.json({ ok: result.ok, durationMs: Date.now() - t0, message: result.msg });
});

export default router;
