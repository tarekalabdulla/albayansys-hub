// تشغيل: node db/migrate.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runSqlFile(filePath, label) {
  const sql = fs.readFileSync(filePath, "utf8");
  console.log(`→ تطبيق ${label}...`);
  await pool.query(sql);
  console.log(`✓ تم ${label}`);
}

async function run() {
  await runSqlFile(path.join(__dirname, "schema.sql"), "المخطط الأساسي");

  const migrationFiles = fs
    .readdirSync(__dirname)
    .filter((file) => /^migration_\d+.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "en"));

  for (const file of migrationFiles) {
    await runSqlFile(path.join(__dirname, file), file);
  }

  await pool.end();
}

run().catch(async (e) => {
  console.error("✗ فشل migration:", e);
  await pool.end();
  process.exit(1);
});
