import express from "express";
import http from "http";
import { Server as SocketServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import authRoutes from "./routes/auth.js";
import agentsRoutes from "./routes/agents.js";
import callsRoutes from "./routes/calls.js";
import alertsRoutes from "./routes/alerts.js";
import usersRoutes from "./routes/users.js";
import supervisorsRoutes from "./routes/supervisors.js";
import settingsRoutes from "./routes/settings.js";
import mailsRoutes from "./routes/mails.js";
import recordingsRoutes from "./routes/recordings.js";
import aiAnalyticsRoutes from "./routes/ai-analytics.js";
import yeastarWebhookV2Routes from "./routes/yeastar-webhook.js";
import pbxRoutes from "./routes/pbx.js";
import adminRoutes from "./routes/admin.js";
import integrationsRoutes from "./routes/integrations.js";
import yeastarConfigRoutes from "./routes/yeastar.js";
import { verifyToken } from "./middleware/auth.js";
import { startSimulator } from "./realtime/simulator.js";
import { startYeastarOpenApi, getYeastarApiStatus } from "./realtime/yeastar-openapi.js";
import { startAmiService } from "./services/amiService.js";
import { bootstrapConfig } from "./services/runtimeConfig.js";
import { query } from "./db/pool.js";

const app = express();
const server = http.createServer(app);

// نحن خلف Nginx reverse proxy → نثق بأول hop فقط
app.set("trust proxy", 1);

// ============== CORS ==============
const RAW_ORIGINS =
  process.env.CORS_ORIGIN ||
  process.env.APP_BASE_URL ||
  process.env.SOCKET_CORS_ORIGIN ||
  "https://hulul-albayan.com,https://www.hulul-albayan.com";

const ORIGINS = RAW_ORIGINS
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (!process.env.CORS_ORIGIN) {
  console.warn("⚠️  CORS_ORIGIN غير مضبوط في .env — استخدام fallback:", ORIGINS.join(", "));
}

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const normalized = origin.replace(/\/+$/, "");
    if (ORIGINS.includes(normalized) || ORIGINS.includes("*")) return cb(null, true);
    console.warn(`[cors] blocked origin: ${origin} (allowed: ${ORIGINS.join(", ")})`);
    cb(new Error("CORS blocked: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Yeastar-Signature"],
  exposedHeaders: ["Content-Disposition"],
  maxAge: 86400,
};

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ⚠️ مهم جدًا:
// نسجل webhook قبل express.json حتى يبقى raw body صالحًا للتحقق من HMAC
app.use("/api/yeastar", yeastarWebhookV2Routes);

app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// خدمة ملفات التسجيلات الصوتية المرفوعة
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(path.join(UPLOADS_DIR, "recordings"), { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR, {
  maxAge: "7d",
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
}));

// rate limit على المصادقة فقط
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({
      ok: true,
      db: "up",
      cors: ORIGINS,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, db: "down", error: e.message });
  }
});

// endpoint تشخيصي للتحقق من قراءة .env بعد كل restart
app.get("/api/_debug/cors", (_req, res) => {
  res.json({
    rawEnv: process.env.CORS_ORIGIN || null,
    parsed: ORIGINS,
    fallbackUsed: !process.env.CORS_ORIGIN,
  });
});

// حالة تكامل Yeastar Open API
app.get("/api/yeastar/status", (_req, res) => {
  res.json(getYeastarApiStatus());
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/supervisors", supervisorsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/calls", callsRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/mails", mailsRoutes);
app.use("/api/recordings", recordingsRoutes);
app.use("/api/ai-analytics", aiAnalyticsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pbx", pbxRoutes);
app.use("/api/integrations", integrationsRoutes);
app.use("/api/yeastar", yeastarConfigRoutes);

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "server_error" });
});

// ============== Socket.io ==============
const io = new SocketServer(server, {
  cors: { origin: ORIGINS, credentials: true },
  path: "/socket.io",
});
app.set("io", io);

// مصادقة handshake
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("unauthorized"));
  const payload = verifyToken(token);
  if (!payload) return next(new Error("invalid_token"));
  socket.data.user = payload;
  next();
});

io.on("connection", async (socket) => {
  console.log(`[socket] connected: ${socket.data.user.identifier}`);

  try {
    const { rows } = await query(
      `SELECT a.id, a.name, a.ext, a.avatar, a.status,
              EXTRACT(EPOCH FROM a.status_since) * 1000 AS "statusSince",
              a.answered, a.missed, a.avg_duration AS "avgDuration", a.supervisor,
              COALESCE(u.role::text, 'agent') AS role
       FROM agents a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.name`
    );
    socket.emit("agent:list", rows);
  } catch (e) {
    console.error("[socket] snapshot fail:", e.message);
  }

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.data.user.identifier}`);
  });
});

// المحاكي
if (String(process.env.SIMULATOR_ENABLED || "").toLowerCase() === "true") {
  console.log("⚙️  المحاكي مُفعَّل (SIMULATOR_ENABLED=true)");
  startSimulator(io);
} else {
  console.log("🛑 المحاكي معطّل — البيانات الحيّة تأتي من PBX/webhooks فقط");
}

// Yeastar Open API
if (String(process.env.YEASTAR_OPENAPI_DISABLED || "").toLowerCase() === "true") {
  console.log("⏭️  Yeastar Open API مُعطَّل يدوياً (YEASTAR_OPENAPI_DISABLED=true) — webhook فقط");
} else {
  startYeastarOpenApi(io).catch((e) => console.error("[yeastar-api] start failed:", e.message));
}

// AMI service بعد runtimeConfig
bootstrapConfig()
  .then(() => {
    try {
      startAmiService(io);
    } catch (e) {
      console.error("[ami] start failed:", e.message);
    }
  })
  .catch((e) => {
    console.warn("[runtimeConfig] bootstrap error:", e.message);
    try {
      startAmiService(io);
    } catch (e2) {
      console.error("[ami] start failed:", e2.message);
    }
  });

const PORT = parseInt(process.env.PORT || "4000", 10);
server.listen(PORT, () => {
  console.log(`✅ API يعمل على :${PORT}`);
  console.log(`   CORS origins: ${ORIGINS.join(", ") || "(none)"}`);
});