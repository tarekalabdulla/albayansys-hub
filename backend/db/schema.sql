-- ============================================
-- Hulul Abayan Call Center — Database Schema
-- ============================================

-- enum للأدوار
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('admin', 'supervisor', 'agent');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE agent_status AS ENUM ('online', 'in_call', 'idle', 'break', 'offline');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE call_status AS ENUM ('answered', 'missed', 'transferred');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE alert_level AS ENUM ('info', 'warning', 'danger');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================
-- المستخدمون (مصادقة)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier    VARCHAR(64) UNIQUE NOT NULL,        -- اسم الدخول أو رقم التحويلة
  password_hash TEXT NOT NULL,
  display_name  VARCHAR(128),
  role          app_role NOT NULL DEFAULT 'agent',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- أعمدة الملف الشخصي الإضافية (إضافة آمنة لو الجدول موجود سابقاً)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email      VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ext        VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone      VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title  VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_users_identifier ON users(identifier);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================
-- الموظفون (data table — منفصل عن users)
-- ============================================
CREATE TABLE IF NOT EXISTS agents (
  id              VARCHAR(32) PRIMARY KEY,           -- مثل AG-1000
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  name            VARCHAR(128) NOT NULL,
  ext             VARCHAR(16) NOT NULL,
  avatar          VARCHAR(8),
  status          agent_status NOT NULL DEFAULT 'offline',
  status_since    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered        INT NOT NULL DEFAULT 0,
  missed          INT NOT NULL DEFAULT 0,
  avg_duration    INT NOT NULL DEFAULT 0,            -- بالثواني
  supervisor      VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_supervisor ON agents(supervisor);

-- ============================================
-- سجلات المكالمات
-- ============================================
CREATE TABLE IF NOT EXISTS calls (
  id          VARCHAR(32) PRIMARY KEY,
  agent_id    VARCHAR(32) REFERENCES agents(id) ON DELETE CASCADE,
  number      VARCHAR(32) NOT NULL,
  duration    INT NOT NULL DEFAULT 0,
  status      call_status NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_agent ON calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);

-- ============================================
-- التنبيهات
-- ============================================
CREATE TABLE IF NOT EXISTS alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level      alert_level NOT NULL DEFAULT 'info',
  title      VARCHAR(255) NOT NULL,
  message    TEXT,
  agent_id   VARCHAR(32) REFERENCES agents(id) ON DELETE CASCADE,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read) WHERE is_read = FALSE;

-- ============================================
-- trigger لتحديث updated_at تلقائياً
-- ============================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS agents_updated_at ON agents;
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
