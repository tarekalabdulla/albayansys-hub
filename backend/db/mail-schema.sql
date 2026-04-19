-- ============================================
-- البريد الداخلي بين الموظفين
-- ============================================

DO $$ BEGIN
  CREATE TYPE mail_priority AS ENUM ('high', 'normal', 'low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS mail_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject       VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL,
  priority      mail_priority NOT NULL DEFAULT 'normal',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_to ON mail_messages(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_from ON mail_messages(from_user_id, created_at DESC);

-- ============================================
-- حالة الرسالة لكل مستخدم (read/starred/folder)
-- لأن الرسالة الواحدة لها حالات مختلفة عند المرسل والمستقبل
-- ============================================
CREATE TABLE IF NOT EXISTS mail_states (
  message_id  UUID NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder      VARCHAR(16) NOT NULL DEFAULT 'inbox', -- inbox/sent/trash
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  starred     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_states_user ON mail_states(user_id, folder);
