import express from "express";
import http from "http";
import { Server as SocketServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import "dotenv/config";

import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import agentsRoutes from "./routes/agents.js";
import callsRoutes from "./routes/calls.js";
import alertsRoutes from "./routes/alerts.js";
import pbxRoutes from "./routes/pbx.js";
import cdrRoutes from "./routes/cdr.js";
import { verifyToken } from "./middleware/auth.js";
import { startSimulator } from "./realtime/simulator.js";
import { query } from "./db/pool.js";
import { PATHS } from "./middleware/upload.js";

const app = express();
const server = http.createServer(app);

const ORIGINS = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ORIGINS.includes(origin) || ORIGINS.includes("*")) return cb(null, true);
    cb(new Error("CORS blocked: " + origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// خدمة ملفات الرفع (الصور الشخصية) — متاحة عامّة عبر URL
app.use("/uploads", express.static(PATHS.UPLOADS_ROOT, {
  maxAge: "7d",
  fallthrough: true,
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
    res.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, db: "down", error: e.message });
  }
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/calls", callsRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/pbx", pbxRoutes);
app.use("/api/cdr", cdrRoutes);

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

  // ابعث snapshot أولي
  try {
    const { rows } = await query(
      `SELECT id, name, ext, avatar, status,
              EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
              answered, missed, avg_duration AS "avgDuration", supervisor
       FROM agents ORDER BY name`
    );
    socket.emit("agent:list", rows);
  } catch (e) {
    console.error("[socket] snapshot fail:", e.message);
  }

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.data.user.identifier}`);
  });
});

// شغّل المحاكي فقط إذا فُعِّل صراحةً
if (process.env.ENABLE_SIMULATOR === "true") {
  startSimulator(io);
  console.log("🎲 Simulator: ON");
} else {
  console.log("🎲 Simulator: OFF (set ENABLE_SIMULATOR=true to enable)");
}

const PORT = parseInt(process.env.PORT || "4000", 10);
server.listen(PORT, () => {
  console.log(`✅ API يعمل على :${PORT}`);
  console.log(`   CORS origins: ${ORIGINS.join(", ") || "(none)"}`);
});
