-- ================================================================
-- 🧹 RESET DATA — يحذف كل البيانات ويبقي حساب admin فقط
-- ----------------------------------------------------------------
-- شغّل على VPS:
--   sudo -u postgres psql -d hulul_db -f reset_data.sql
-- ⚠️  لا يحذف schema. يحذف فقط الصفوف.
-- ================================================================

BEGIN;

-- مكالمات وتسجيلات وتنبيهات
DELETE FROM recordings;
DELETE FROM calls;
DELETE FROM alerts;

-- البريد الداخلي
DELETE FROM mails;

-- توصيات AI وسجلات المشاعر
DELETE FROM ai_recommendations;
DELETE FROM sentiment_daily;

-- ربط مشرف ↔ موظف ثم الموظفين
DELETE FROM supervisor_agents;
DELETE FROM agents;

-- المشرفون (سيتم إعادة إنشاؤهم من الواجهة)
DELETE FROM supervisors;

-- المستخدمون: احذف الجميع عدا admin
DELETE FROM users WHERE role <> 'admin' OR identifier <> 'admin';

-- لا تلمس system_settings (إعدادات PBX/AI/Webhook)

COMMIT;

-- ✅ تحقق
SELECT 'users'         AS tbl, count(*) FROM users
UNION ALL SELECT 'agents',         count(*) FROM agents
UNION ALL SELECT 'supervisors',    count(*) FROM supervisors
UNION ALL SELECT 'calls',          count(*) FROM calls
UNION ALL SELECT 'recordings',     count(*) FROM recordings
UNION ALL SELECT 'alerts',         count(*) FROM alerts
UNION ALL SELECT 'mails',          count(*) FROM mails
UNION ALL SELECT 'ai_recommendations', count(*) FROM ai_recommendations;
