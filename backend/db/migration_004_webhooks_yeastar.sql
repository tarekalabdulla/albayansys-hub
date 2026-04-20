-- ================================================================
-- Migration 004 — دعم استقبال أحداث Yeastar P-Series عبر Webhook
-- يضيف:
--   * call_uuid     — معرّف Yeastar لربط ring/answer/hangup لنفس المكالمة
--   * direction     — inbound / outbound / internal
--   * ended_at      — وقت إنهاء المكالمة (لحساب المدّة الدقيقة)
--   * raw           — JSON خام للحدث الأصلي (للتدقيق)
--   * webhook_events— سجل تدقيق لكل حدث وارد (idempotency + debug)
-- ================================================================

DO $$ BEGIN
  CREATE TYPE call_direction AS ENUM ('inbound', 'outbound', 'internal');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS call_uuid  VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS direction  call_direction NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS ended_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw        JSONB;

CREATE INDEX IF NOT EXISTS idx_calls_call_uuid ON calls(call_uuid);

-- جدول تدقيق لكل webhook وارد (يساعد في idempotency والتشخيص)
CREATE TABLE IF NOT EXISTS webhook_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      VARCHAR(32) NOT NULL,            -- 'yeastar'
  event_type  VARCHAR(64) NOT NULL,            -- ring/answer/hangup/...
  call_uuid   VARCHAR(64),
  payload     JSONB NOT NULL,
  ip          VARCHAR(64),
  signature_ok BOOLEAN NOT NULL DEFAULT FALSE,
  processed   BOOLEAN NOT NULL DEFAULT FALSE,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_call ON webhook_events(call_uuid);
