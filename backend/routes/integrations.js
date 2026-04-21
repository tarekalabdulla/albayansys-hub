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
// اختبارات يدوية — كل اختبار يعيد { ok, message, durationMs }
// ============================================================================

// ----- Webhook: يستدعي endpoint الذاتي للتأكد أن Nginx + token + HMAC + DB يعملون
router.post("/test/webhook", async (req, res) => {
  const t0 = Date.now();
  try {
    const token  = process.env.YEASTAR_WEBHOOK_TOKEN || "";
    const secret = process.env.YEASTAR_WEBHOOK_SECRET || "";
    if (!token) {
      return res.json({ ok: false, durationMs: Date.now() - t0,
        message: "YEASTAR_WEBHOOK_TOKEN غير مضبوط في .env" });
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
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    clearTimeout(timer);

    const txt = await r.text();
    if (r.ok) {
      return res.json({ ok: true, durationMs: Date.now() - t0,
        message: `استجابة ${r.status} من ${url} — Webhook يعمل ويستقبل بنجاح.` });
    }
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: `فشل HTTP ${r.status}: ${txt.slice(0, 200)}` });
  } catch (e) {
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: `استثناء: ${e.message}` });
  }
});

// ----- OpenAPI: يجرّب get_token مباشرة على PBX
router.post("/test/openapi", async (_req, res) => {
  const t0 = Date.now();
  const base = (process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "").replace(/\/+$/, "");
  if (!base) {
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: "YEASTAR_BASE_URL غير مضبوط في .env" });
  }
  const clientId     = process.env.YEASTAR_CLIENT_ID || "";
  const clientSecret = process.env.YEASTAR_CLIENT_SECRET || "";
  const user = process.env.YEASTAR_API_USER || "";
  const pass = process.env.YEASTAR_API_PASS || "";
  const body = clientId && clientSecret
    ? { client_id: clientId, client_secret: clientSecret }
    : (user && pass ? { username: user, password: pass } : null);
  if (!body) {
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: "لا توجد بيانات اعتماد (CLIENT_ID/SECRET أو API_USER/PASS)" });
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${base}/openapi/v1.0/get_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await r.json().catch(() => ({}));
    if (r.ok && (data.errcode === 0 || data.access_token || data.data?.access_token)) {
      return res.json({ ok: true, durationMs: Date.now() - t0,
        message: `حصلنا على access_token من ${base} بنجاح.` });
    }
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: `رفض PBX المصادقة: errcode=${data.errcode ?? r.status} ${data.errmsg || ""}`.trim() });
  } catch (e) {
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: `تعذّر الوصول لـ ${base}: ${e.message}` });
  }
});

// ----- AMI: يفتح TCP connect فقط (login بدون مزامنة)
router.post("/test/ami", async (_req, res) => {
  const t0 = Date.now();
  const host = process.env.YEASTAR_AMI_HOST || "";
  const port = parseInt(process.env.YEASTAR_AMI_PORT || "5038", 10);
  if (!host) {
    return res.json({ ok: false, durationMs: Date.now() - t0,
      message: "YEASTAR_AMI_HOST غير مضبوط (AMI معطّل)" });
  }
  const result = await new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => { if (!done) { done = true; try { sock.destroy(); } catch {} resolve({ ok, msg }); } };
    sock.setTimeout(8000);
    sock.once("connect", () => finish(true, `TCP متصل بـ ${host}:${port}`));
    sock.once("timeout", () => finish(false, `انتهت المهلة عند الاتصال بـ ${host}:${port} (الـ VPS لا يصل للسنترال)`));
    sock.once("error",   (e) => finish(false, `${e.code || "ERR"}: ${e.message}`));
    sock.connect(port, host);
  });
  res.json({ ok: result.ok, durationMs: Date.now() - t0, message: result.msg });
});

export default router;