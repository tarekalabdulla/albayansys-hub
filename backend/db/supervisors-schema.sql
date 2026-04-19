-- ============================================
-- جدول المشرفين + الربط مع الموظفين
-- ============================================

CREATE TABLE IF NOT EXISTS supervisors (
  id          VARCHAR(32) PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  ext         VARCHAR(16) NOT NULL,
  role        VARCHAR(32) NOT NULL DEFAULT 'مشرف',
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supervisors_email ON supervisors(email);

-- جدول الربط مشرف ↔ موظفين (many-to-many)
CREATE TABLE IF NOT EXISTS supervisor_agents (
  supervisor_id VARCHAR(32) REFERENCES supervisors(id) ON DELETE CASCADE,
  agent_id      VARCHAR(32) REFERENCES agents(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (supervisor_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_agents_agent ON supervisor_agents(agent_id);

DROP TRIGGER IF EXISTS supervisors_updated_at ON supervisors;
CREATE TRIGGER supervisors_updated_at BEFORE UPDATE ON supervisors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
