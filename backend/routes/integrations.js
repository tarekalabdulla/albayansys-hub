// ============================================================================
// /api/integrations/status — حالة Webhook + Yeastar OpenAPI + AMI
// تُستخدم في صفحة "حالة الاتصالات" بالواجهة (auto-refresh كل 5s)
// ============================================================================
import { Router } from "express";
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

export default router;