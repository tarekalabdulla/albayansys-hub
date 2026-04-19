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
import statsRoutes from "./routes/stats.js";
import mailRoutes from "./routes/mail.js";
import supervisorsRoutes from "./routes/supervisors.js";
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
// JSON parser لكل المسارات ما عدا webhook الـ Yeastar (يحتاج raw body للتحقق من HMAC)
app.use((req, res, next) => {
  if (req.path === "/api/pbx/webhook") return next();
  return express.json({ limit: "1mb" })(req, res, next);
});
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
app.use("/api/stats", statsRoutes);
app.use("/api/mail", mailRoutes);
app.use("/api/supervisors", supervisorsRoutes);

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

// أدوات عزل (مكررة عمداً هنا لتفادي circular import)
async function getAllowedAgentIds(user) {
  if (user.role === "admin") return null;
  if (user.role === "supervisor") {
    const { rows } = await query(
      `SELECT sa.agent_id
       FROM supervisors s JOIN supervisor_agents sa ON sa.supervisor_id = s.id
       WHERE s.user_id = $1`, [user.sub]
    );
    return rows.map((r) => r.agent_id);
  }
  const { rows } = await query(`SELECT id FROM agents WHERE user_id = $1`, [user.sub]);
  return rows.map((r) => r.id);
}

async function getAllowedExtensions(user) {
  if (user.role === "admin") return null;
  if (user.role === "supervisor") {
    const { rows } = await query(
      `SELECT a.ext FROM supervisors s
       JOIN supervisor_agents sa ON sa.supervisor_id = s.id
       JOIN agents a ON a.id = sa.agent_id
       WHERE s.user_id = $1 AND a.ext IS NOT NULL`, [user.sub]
    );
    return rows.map((r) => r.ext);
  }
  const { rows } = await query(
    `SELECT a.ext FROM agents a WHERE a.user_id = $1 AND a.ext IS NOT NULL
     UNION SELECT u.ext FROM users u WHERE u.id = $1 AND u.ext IS NOT NULL`,
    [user.sub]
  );
  return rows.map((r) => r.ext).filter(Boolean);
}

io.on("connection", async (socket) => {
  const user = socket.data.user;
  console.log(`[socket] connected: ${user.identifier} (${user.role})`);

  // قيود العزل
  const allowedAgentIds = await getAllowedAgentIds(user);
  const allowedExts = await getAllowedExtensions(user);
  socket.data.allowedAgentSet = allowedAgentIds ? new Set(allowedAgentIds) : null;
  socket.data.allowedExtSet = allowedExts ? new Set(allowedExts.map(String)) : null;

  // snapshot أولي مفلتر
  try {
    let sql = `SELECT id, name, ext, avatar, status,
                      EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
                      answered, missed, avg_duration AS "avgDuration", supervisor
               FROM agents`;
    const params = [];
    if (allowedAgentIds !== null) {
      if (allowedAgentIds.length === 0) {
        socket.emit("agent:list", []);
      } else {
        sql += ` WHERE id = ANY($1::varchar[])`;
        params.push(allowedAgentIds);
        const { rows } = await query(sql + ` ORDER BY name`, params);
        socket.emit("agent:list", rows);
      }
    } else {
      const { rows } = await query(sql + ` ORDER BY name`, params);
      socket.emit("agent:list", rows);
    }
  } catch (e) {
    console.error("[socket] snapshot fail:", e.message);
  }

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${user.identifier}`);
  });
});

// Helper بث مفلتر — يستخدم في webhook handlers
// getKey(payload) → { agentId?, ext? } للحدث
function broadcastFiltered(event, payload, getKey) {
  const key = getKey ? getKey(payload) || {} : {};
  for (const [, sock] of io.sockets.sockets) {
    const aSet = sock.data.allowedAgentSet;
    const eSet = sock.data.allowedExtSet;
    if (aSet === null && eSet === null) { sock.emit(event, payload); continue; }
    const okA = !aSet || (key.agentId && aSet.has(key.agentId));
    const okE = !eSet || (key.ext && eSet.has(String(key.ext)));
    // يُسمح إذا تجاوز أيّ من الفلترتين (يكفي تطابق ext)
    if ((aSet && okA) || (eSet && okE)) sock.emit(event, payload);
  }
}
app.set("broadcastFiltered", broadcastFiltered);

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
