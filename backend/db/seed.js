// تشغيل: node db/seed.js
// ينشئ المستخدمين الثلاثة + 12 موظف
import bcrypt from "bcrypt";
import { pool } from "./pool.js";
import "dotenv/config";

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);

const USERS = [
  { identifier: "admin",      password: "admin123",      role: "admin",      display_name: "المدير العام" },
  { identifier: "supervisor", password: "supervisor123", role: "supervisor", display_name: "أ. سلمان" },
  { identifier: "agent",      password: "agent123",      role: "agent",      display_name: "موظف تجريبي" },
];

const ARABIC_NAMES = [
  "أحمد العتيبي", "فاطمة الزهراء", "محمد القحطاني", "نورة السبيعي",
  "خالد الدوسري", "سارة المطيري", "عبدالله الشهري", "ريم الحربي",
  "يوسف الغامدي", "هند الرشيد", "ماجد الزهراني", "لمى العنزي",
];
const SUPERVISORS = ["أ. سلمان", "أ. منى", "أ. بدر"];
const STATUSES = ["online", "in_call", "idle", "break", "offline"];

async function run() {
  console.log("→ إدخال المستخدمين...");
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, ROUNDS);
    await pool.query(
      `INSERT INTO users (identifier, password_hash, role, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (identifier) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             display_name = EXCLUDED.display_name`,
      [u.identifier, hash, u.role, u.display_name]
    );
  }
  console.log(`✓ تم إدخال ${USERS.length} مستخدمين`);

  console.log("→ إدخال الموظفين...");
  for (let i = 0; i < ARABIC_NAMES.length; i++) {
    const name = ARABIC_NAMES[i];
    const avatar = name.split(" ").map((p) => p[0]).join("").slice(0, 2);
    const status = STATUSES[i % STATUSES.length];
    await pool.query(
      `INSERT INTO agents (id, name, ext, avatar, status, answered, missed, avg_duration, supervisor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        `AG-${1000 + i}`,
        name,
        `${2100 + i}`,
        avatar,
        status,
        20 + Math.floor(Math.random() * 60),
        Math.floor(Math.random() * 8),
        90 + Math.floor(Math.random() * 240),
        SUPERVISORS[i % SUPERVISORS.length],
      ]
    );
  }
  console.log(`✓ تم إدخال ${ARABIC_NAMES.length} موظف`);

  await pool.end();
  console.log("\n✅ Seed مكتمل. بيانات الدخول:");
  USERS.forEach((u) => console.log(`   ${u.identifier} / ${u.password}  (${u.role})`));
}

run().catch((e) => {
  console.error("✗ فشل seed:", e);
  process.exit(1);
});
