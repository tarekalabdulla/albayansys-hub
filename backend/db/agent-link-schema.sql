-- ============================================
-- ربط agents ↔ users (user واحد = agent record واحد)
-- ============================================

-- العمود user_id موجود مسبقاً في schema.sql، نضيف فهرس فريد
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_user_id_unique
  ON agents(user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
