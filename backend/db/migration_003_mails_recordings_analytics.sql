-- ================================================================
-- Migration 003: mails + recordings + ai_recommendations + sentiment_logs
-- ----------------------------------------------------------------
-- شغّل على VPS:
--   sudo -u postgres psql -d hulul_db -f migration_003_mails_recordings_analytics.sql
-- أو من خلال:  node db/migrate.js   (يطبّقه تلقائياً)
-- ================================================================

-- ---- 1) جدول البريد الداخلي ----
DO $$ BEGIN
  CREATE TYPE mail_priority AS ENUM ('high', 'normal', 'low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE mail_folder AS ENUM ('inbox', 'sent', 'trash');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS mails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  to_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  from_name    VARCHAR(128) NOT NULL,
  from_ext     VARCHAR(16),
  to_name      VARCHAR(128) NOT NULL,
  to_ext       VARCHAR(16),
  subject      VARCHAR(255) NOT NULL,
  body         TEXT NOT NULL,
  priority     mail_priority NOT NULL DEFAULT 'normal',
  folder       mail_folder NOT NULL DEFAULT 'inbox',
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred   BOOLEAN NOT NULL DEFAULT FALSE,
  thread_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mails_owner ON mails(owner_id);
CREATE INDEX IF NOT EXISTS idx_mails_folder ON mails(owner_id, folder);
CREATE INDEX IF NOT EXISTS idx_mails_created ON mails(created_at DESC);

DROP TRIGGER IF EXISTS mails_updated_at ON mails;
CREATE TRIGGER mails_updated_at BEFORE UPDATE ON mails
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 2) جدول تسجيلات المكالمات ----
DO $$ BEGIN
  CREATE TYPE recording_sentiment AS ENUM ('positive', 'neutral', 'negative');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS recordings (
  id              VARCHAR(32) PRIMARY KEY,
  call_id         VARCHAR(32) REFERENCES calls(id) ON DELETE SET NULL,
  agent_id        VARCHAR(32) REFERENCES agents(id) ON DELETE SET NULL,
  agent_name      VARCHAR(128) NOT NULL,
  agent_avatar    VARCHAR(8),
  customer_number VARCHAR(32) NOT NULL,
  duration        INT NOT NULL DEFAULT 0,
  audio_url       TEXT,
  quality_score   INT NOT NULL DEFAULT 0,
  sentiment       recording_sentiment NOT NULL DEFAULT 'neutral',
  category        VARCHAR(32),
  tags            TEXT[],
  metrics         JSONB DEFAULT '[]'::jsonb,
  transcript      JSONB DEFAULT '[]'::jsonb,
  summary         TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_agent ON recordings(agent_id);
CREATE INDEX IF NOT EXISTS idx_recordings_recorded ON recordings(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_sentiment ON recordings(sentiment);

-- ---- 3) جدول توصيات الـ AI (لصفحة AI Analytics) ----
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icon        VARCHAR(32) NOT NULL DEFAULT 'lightbulb',
  color       VARCHAR(32) NOT NULL DEFAULT 'primary',
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  impact      VARCHAR(64),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_recs_active ON ai_recommendations(is_active, created_at DESC);

-- ---- 4) جدول سجل المشاعر اليومي (للرسوم البيانية) ----
CREATE TABLE IF NOT EXISTS sentiment_daily (
  day        DATE PRIMARY KEY,
  positive   INT NOT NULL DEFAULT 0,
  neutral    INT NOT NULL DEFAULT 0,
  negative   INT NOT NULL DEFAULT 0
);

-- ============================================
-- ✅ تم. تحقق:
--   \dt
--   SELECT count(*) FROM mails;
--   SELECT count(*) FROM recordings;
-- ============================================
