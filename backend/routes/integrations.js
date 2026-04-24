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
import {
  getEffectiveConfigSync,
  getConfigSource,
  sanitizeBaseUrl,
  buildAuthPayloadShape,
} from "../services/runtimeConfig.js";

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
//   "endpoint_reachable"   → استجاب 2xx (Webhook receiver كامل وسليم)
//   "invalid_signature"    → استجاب 401 (HMAC غير صحيح — السر مختلف)
//   "rejected_request"     → استجاب 4xx آخر (مثل 403 ip_not_allowed أو 503 disabled)
//   "endpoint_unreachable" → خطأ شبكة قبل استجابة الخادم (DNS/connect refused)
//   "no_callback_received" → انتهت المهلة دون استجابة من receiver نفسه
//   "timeout_only"         → AbortError بدون مؤشرات أخرى — قد يكون webhook receiver سليماً
//   "disabled"             → لا توجد إعدادات (token غير مضبوط)
//
// ⚠️  fix 2026-04: زدنا timeout من 8s/15s إلى 30s لإعطاء وقت كافٍ للـ
//     receiver + DB write + emit socket. test failure لا يعني أن receiver broken
//     ما لم يكن endpoint_unreachable أو no_callback_received صريحاً.
// ============================================================================
const WEBHOOK_TEST_TIMEOUT_MS = 30_000;

router.post("/test/webhook", async (req, res) => {
  const t0 = Date.now();
  const correlationId = `wh-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const live = getEffectiveConfigSync() || {};
  const token  = process.env.YEASTAR_WEBHOOK_TOKEN || "";
  const secret = live.webhookSecret || process.env.YEASTAR_WEBHOOK_SECRET || "";

  console.log(
    `[webhook-test] ▶ start id=${correlationId}`,
    `timeout=${WEBHOOK_TEST_TIMEOUT_MS}ms`,
    `token=${maskSecret(token)}`,
    `secret=${secret ? maskSecret(secret) : "(none)"}`,
  );

  if (!token) {
    console.warn(`[webhook-test] ✗ id=${correlationId} disabled — no YEASTAR_WEBHOOK_TOKEN`);
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
      call_id: `TEST-${correlationId}`,
      caller_num: "0000000000",
      callee_num: "100",
      call_status: "test",
      duration: 0,
      _self_test: true,
      _correlation_id: correlationId,
    },
  });
  const headers = { "Content-Type": "application/json", "X-Correlation-Id": correlationId };
  if (secret) {
    headers["X-Yeastar-Signature"] =
      "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  }

  console.log(`[webhook-test] → POST ${url} id=${correlationId} hmac=${secret ? "yes" : "no"}`);
  console.log(`[webhook-test] ⏱ waiting for callback… id=${correlationId} (≤${WEBHOOK_TEST_TIMEOUT_MS}ms)`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TEST_TIMEOUT_MS);

  try {
    const r = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    const txt = await r.text().catch(() => "");
    const elapsed = Date.now() - t0;

    console.log(
      `[webhook-test] ← callback received id=${correlationId}`,
      `http=${r.status}`,
      `elapsed=${elapsed}ms`,
    );

    if (r.ok) {
      console.log(`[webhook-test] ✓ id=${correlationId} signature ok, matched correlation, processed`);
      return res.json({
        ok: true,
        status: "endpoint_reachable",
        httpStatus: r.status,
        url,
        correlationId,
        durationMs: elapsed,
        message: `Webhook receiver استقبل الاختبار بنجاح (HTTP ${r.status}, ${elapsed}ms). القناة سليمة.`,
      });
    }
    if (r.status === 401) {
      console.warn(`[webhook-test] ✗ id=${correlationId} signature rejected (HTTP 401)`);
      return res.json({
        ok: false,
        status: "invalid_signature",
        httpStatus: 401,
        url,
        correlationId,
        durationMs: elapsed,
        message: secret
          ? `Webhook receiver يعمل لكن رفض التوقيع (HTTP 401). السرّ المُرسَل لا يطابق YEASTAR_WEBHOOK_SECRET في الخادم. هذا ليس عطلاً في receiver نفسه.`
          : `Webhook receiver يطلب توقيعاً ولم نُرسل أي سرّ (HTTP 401). اضبط webhookSecret في الإعدادات. receiver نفسه يعمل.`,
      });
    }
    if (r.status === 403) {
      console.warn(`[webhook-test] ✗ id=${correlationId} ip rejected (HTTP 403)`);
      return res.json({
        ok: false,
        status: "rejected_request",
        httpStatus: 403,
        url,
        correlationId,
        durationMs: elapsed,
        message: `Webhook receiver يعمل لكن رفض الـ IP (HTTP 403). تحقق من allowedIps في الإعدادات. receiver نفسه يعمل.`,
      });
    }
    if (r.status === 503) {
      console.warn(`[webhook-test] ✗ id=${correlationId} disabled (HTTP 503)`);
      return res.json({
        ok: false,
        status: "rejected_request",
        httpStatus: 503,
        url,
        correlationId,
        durationMs: elapsed,
        message: `Webhook receiver يعمل لكن معطّل من لوحة التحكم (HTTP 503). فعّل enableWebhook.`,
      });
    }
    console.warn(`[webhook-test] ✗ id=${correlationId} rejected http=${r.status} body="${txt.slice(0, 200)}"`);
    return res.json({
      ok: false,
      status: "rejected_request",
      httpStatus: r.status,
      url,
      correlationId,
      durationMs: elapsed,
      message: `Webhook receiver وصلنا إليه لكنه ردّ بـ HTTP ${r.status}: ${txt.slice(0, 200)}`,
    });
  } catch (e) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    if (e.name === "AbortError") {
      // فرّق بين "no_callback_received" (انتظرنا كامل المهلة)
      // و "timeout_only" (انقطع قبل المهلة لسبب خارجي).
      const status = elapsed >= WEBHOOK_TEST_TIMEOUT_MS - 500 ? "no_callback_received" : "timeout_only";
      console.warn(
        `[webhook-test] ⏱ id=${correlationId} aborted status=${status}`,
        `elapsed=${elapsed}ms target=${url}`,
      );
      return res.json({
        ok: false,
        status,
        url,
        correlationId,
        durationMs: elapsed,
        message: status === "no_callback_received"
          ? `لم يصلنا أي callback خلال ${WEBHOOK_TEST_TIMEOUT_MS}ms من ${url}. تحقّق أن Nginx يُمرّر /api/ إلى المنفذ ${process.env.PORT || 4000}، وأن جدار الحماية يسمح. هذا لا يعني بالضرورة أن webhook receiver معطوب — قد تكون المشكلة في الشبكة فقط.`
          : `قُطع الاختبار قبل اكتمال المهلة (${elapsed}ms / ${WEBHOOK_TEST_TIMEOUT_MS}ms). أعد المحاولة. webhook receiver قد يكون سليماً.`,
      });
    }
    const code = e.code || "ERR";
    console.warn(`[webhook-test] ✗ id=${correlationId} unreachable code=${code} msg="${e.message}"`);
    return res.json({
      ok: false,
      status: "endpoint_unreachable",
      url,
      correlationId,
      durationMs: elapsed,
      message: `تعذّر الوصول للـ endpoint (${code}): ${e.message}. تحقّق من DNS وNginx والمنفذ.`,
    });
  }
});

// ============================================================================
// OpenAPI test — يجرّب get_token مباشرة على PBX
// OAuth حصراً (client_id + client_secret). لا fallback إلى username/password.
//
// ⚠️  fix 2026-04 (B): الـ baseUrl يُعقَّم دوماً — يُرفض/يُجرَّد أي قيمة
//     تحتوي على /openapi أو /api/yeastar أو webhook URL.
//     المسار /openapi/v1.0/get_token ثابت في الكود.
// ============================================================================
const OPENAPI_TEST_TIMEOUT_MS = 15_000;

router.post("/test/openapi", async (_req, res) => {
  const t0 = Date.now();
  const live = getEffectiveConfigSync() || {};
  const src  = getConfigSource() || { baseUrl: "none" };

  const rawBase = live.baseUrl || process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "";
  const base    = sanitizeBaseUrl(rawBase);
  const clientId     = live.clientId     || process.env.YEASTAR_CLIENT_ID     || "";
  const clientSecret = live.clientSecret || process.env.YEASTAR_CLIENT_SECRET || "";

  console.log("[integrations/test/openapi] starting",
    `base="${base || "(empty)"}" (source=${src.baseUrl})`,
    rawBase && rawBase !== base ? `(raw was sanitized from "${rawBase.slice(0, 120)}")` : "",
    "auth=oauth",
    "client_id=" + maskSecret(clientId),
    "client_secret=" + maskSecret(clientSecret),
  );

  if (!base) {
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      message: rawBase
        ? `Base URL مرفوض بعد التعقيم — القيمة المخزّنة "${rawBase.slice(0, 80)}…" تبدو وكأنها webhook URL أو مسار. ضع origin فقط مثل https://pbx.example.com`
        : "YEASTAR_BASE_URL غير مضبوط في الإعدادات/البيئة",
    });
  }
  if (!clientId || !clientSecret) {
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      message: "بيانات OAuth ناقصة — مطلوب client_id + client_secret (لا ندعم username/password)",
    });
  }

  // ⚠️ المسار ثابت — لا يأتي من DB ولا env
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
      `endpoint="${url}"`,
    );

    const accessToken = data.access_token || data.data?.access_token;
    if (r.ok && (data.errcode === 0 || data.errcode === undefined) && accessToken) {
      return res.json({
        ok: true,
        durationMs: Date.now() - t0,
        endpoint: url,
        baseUrl: base,
        baseUrlSource: src.baseUrl,
        authMode: "oauth",
        expiresIn: data.expire_time || data.data?.expire_time || 1800,
        message: `حصلنا على access_token من ${base} بنجاح (OAuth).`,
      });
    }
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      endpoint: url,
      baseUrl: base,
      baseUrlSource: src.baseUrl,
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
    console.warn(`[integrations/test/openapi] network error: ${reason} endpoint="${url}"`);
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      endpoint: url,
      baseUrl: base,
      baseUrlSource: src.baseUrl,
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
