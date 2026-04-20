-- ================================================================
-- Migration 002: users CRUD + supervisors + system_settings
-- ----------------------------------------------------------------
-- شغّل على VPS كمستخدم postgres:
--   sudo -u postgres psql -d hulul_db -f migration_002_users_supervisors_settings.sql
-- أو ألصق المحتوى داخل psql مباشرة.
-- ================================================================

-- ---- 1) أعمدة إضافية في users (email + phone) ----
ALTER TABLE users ADD COLUMN IF NOT EXISTS email      VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone      VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ext        VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(LOWER(email)) WHERE email IS NOT NULL;

-- ---- 2) جدول المشرفين ----
CREATE TABLE IF NOT EXISTS supervisors (
  id          VARCHAR(32) PRIMARY KEY,        -- مثل S-001
  name        VARCHAR(128) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  ext         VARCHAR(16)  NOT NULL,
  role        VARCHAR(32)  NOT NULL DEFAULT 'مشرف',  -- مشرف | مشرف أول | مدير قسم
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisors_email
  ON supervisors(LOWER(email));

DROP TRIGGER IF EXISTS supervisors_updated_at ON supervisors;
CREATE TRIGGER supervisors_updated_at BEFORE UPDATE ON supervisors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 3) ربط مشرف ↔ موظفين (Many-to-Many) ----
CREATE TABLE IF NOT EXISTS supervisor_agents (
  supervisor_id VARCHAR(32) NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  agent_id      VARCHAR(32) NOT NULL REFERENCES agents(id)      ON DELETE CASCADE,
  PRIMARY KEY (supervisor_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_sa_agent ON supervisor_agents(agent_id);

-- ---- 4) إعدادات النظام (key/value JSON) ----
CREATE TABLE IF NOT EXISTS system_settings (
  key         VARCHAR(64) PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS settings_updated_at ON system_settings;
CREATE TRIGGER settings_updated_at BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- مفاتيح افتراضية
INSERT INTO system_settings (key, value) VALUES
  ('pbx_p_series', '{"enabled":true,"host":"192.168.1.50","port":"8088","apiUser":"apiuser","useTLS":true}'::jsonb),
  ('pbx_s_series', '{"enabled":false,"host":"192.168.1.60","amiPort":"5038","amiUser":"admin","cdrUrl":"https://cdr.hb.sa/s20"}'::jsonb),
  ('google_ai',    '{"enabled":false,"model":"gemini-1.5-pro"}'::jsonb),
  ('webhook',      '{"url":"https://hooks.hb.sa/calls"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---- 5) seed مشرفون افتراضيون (آمن للتشغيل المتكرر) ----
INSERT INTO supervisors (id, name, email, ext, role) VALUES
  ('S-001','أ. سلمان العامر','salman@bayan.sa','1001','مدير قسم'),
  ('S-002','أ. منى الشمري','mona@bayan.sa','1002','مشرف أول'),
  ('S-003','أ. بدر الزهراني','badr@bayan.sa','1003','مشرف')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- ✅ تم. تحقق:
--   \dt
--   SELECT key FROM system_settings;
--   SELECT count(*) FROM supervisors;
-- ============================================
