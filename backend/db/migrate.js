// تشغيل: node db/migrate.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log("→ تطبيق المخطط...");
  await pool.query(sql);
  console.log("✓ تم إنشاء الجداول بنجاح");
  await pool.end();
}

run().catch((e) => {
  console.error("✗ فشل migration:", e);
  process.exit(1);
});
