// محاكي تحديثات حية — يمكن استبداله بـ webhooks من PBX حقيقي لاحقاً
import { query } from "../db/pool.js";

const STATUSES = ["online", "in_call", "idle", "break"];

export function startSimulator(io) {
  setInterval(async () => {
    try {
      // اختر موظفاً عشوائياً
      const { rows } = await query("SELECT id, name, status FROM agents ORDER BY random() LIMIT 1");
      const a = rows[0];
      if (!a) return;

      // 35% احتمال تغيير الحالة
      if (Math.random() < 0.35) {
        const next = STATUSES[Math.floor(Math.random() * STATUSES.length)];
        if (next !== a.status) {
          const upd = await query(
            `UPDATE agents SET status = $1, status_since = NOW(),
              answered = answered + CASE WHEN $1 = 'in_call' THEN 1 ELSE 0 END
             WHERE id = $2
             RETURNING id, name, status, EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
                       answered, missed, avg_duration AS "avgDuration"`,
            [next, a.id]
          );
          io.emit("agent:update", upd.rows[0]);
        }
      }

      // 8% احتمال تنبيه
      if (Math.random() < 0.08) {
        const alert = {
          level: "warning",
          title: "خمول مطوّل",
          message: `الموظف ${a.name} خامل لفترة طويلة`,
          agent_id: a.id,
        };
        const ins = await query(
          `INSERT INTO alerts (level, title, message, agent_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, level, title, message, EXTRACT(EPOCH FROM created_at) * 1000 AS time`,
          [alert.level, alert.title, alert.message, alert.agent_id]
        );
        io.emit("alert", ins.rows[0]);
      }
    } catch (e) {
      console.error("[simulator]", e.message);
    }
  }, 3500);
}
