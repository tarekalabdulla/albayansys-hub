-- ============================================================================
-- Migration 007 — تكامل Yeastar P-Series الكامل (Production-Grade)
-- ----------------------------------------------------------------------------
-- يضيف:
--   1) pbx_events       — سجل تدقيق موسّع لكل حدث وارد (webhook/ami/api)
--   2) pbx_call_logs    — جدول CDR موازٍ منفصل (لا يكسر calls الحالي)
--   3) customers        — العملاء (للربط التلقائي بالمكالمات)
--   4) claims           — المطالبات المرتبطة بالعملاء
--
-- جميع الجداول والأعمدة مُنشأة بـ IF NOT EXISTS — آمن لإعادة التشغيل.
-- لا يُلمَس جدول calls الحالي ولا webhook_events ولا أي شيء من migration_004.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) ENUMs
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE pbx_event_source AS ENUM ('webhook', 'ami', 'api', 'openapi-ws');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pbx_event_status AS ENUM ('pending', 'processed', 'ignored', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pbx_call_direction AS ENUM ('incoming', 'outgoing', 'internal', 'transferred', 'forwarded', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pbx_call_status AS ENUM ('ringing', 'answered', 'busy', 'no_answer', 'failed', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 1) pbx_events — سجل تدقيق موسّع لكل حدث (idempotency + debug)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pbx_events (
  id                BIGSERIAL PRIMARY KEY,
  event_id          INT,                                  -- 30011/30012/30013/...
  event_name        VARCHAR(64),                          -- "CallStateChanged", ...
  unique_key        VARCHAR(128) UNIQUE,                  -- idempotency: source+event+linkedid+ts
  linked_id         VARCHAR(64),
  call_id           VARCHAR(64),
  extension         VARCHAR(32),
  remote_number     VARCHAR(64),
  direction         pbx_call_direction DEFAULT 'unknown',
  payload_json      JSONB NOT NULL,
  source            pbx_event_source NOT NULL DEFAULT 'webhook',
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  processing_status pbx_event_status NOT NULL DEFAULT 'pending',
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_pbx_events_received   ON pbx_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_pbx_events_call       ON pbx_events(call_id);
CREATE INDEX IF NOT EXISTS idx_pbx_events_linked     ON pbx_events(linked_id);
CREATE INDEX IF NOT EXISTS idx_pbx_events_status     ON pbx_events(processing_status) WHERE processing_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pbx_events_event_id   ON pbx_events(event_id);

-- ----------------------------------------------------------------------------
-- 2) customers — قاعدة العملاء (للربط التلقائي بالمكالمات)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  phone           VARCHAR(64),                            -- النسخة الأصلية
  phone_normalized VARCHAR(64),                           -- بعد normalization (للبحث السريع)
  alt_phone       VARCHAR(64),
  email           VARCHAR(255),
  customer_type   VARCHAR(32),                            -- individual / company / vip
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone_norm ON customers(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_email      ON customers(email);

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) claims — المطالبات
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number  VARCHAR(64) UNIQUE NOT NULL,
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  status        VARCHAR(32) NOT NULL DEFAULT 'open',     -- open/closed/pending
  title         VARCHAR(255),
  description   TEXT,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_customer ON claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_claims_status   ON claims(status) WHERE status = 'open';

DROP TRIGGER IF EXISTS claims_updated_at ON claims;
CREATE TRIGGER claims_updated_at BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) pbx_call_logs — جدول CDR رسمي موسّع (موازٍ لـ calls، لا يكسره)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pbx_call_logs (
  id                  BIGSERIAL PRIMARY KEY,
  -- مفاتيح ربط فريدة (تأتي من Yeastar / AMI)
  call_unique_key     VARCHAR(128) UNIQUE NOT NULL,       -- linkedid أو call_id الأقوى
  linkedid            VARCHAR(64),
  uniqueid            VARCHAR(64),

  -- أطراف المكالمة
  ext                 VARCHAR(32),
  agent_id            VARCHAR(32) REFERENCES agents(id) ON DELETE SET NULL,
  remote_number       VARCHAR(64),
  remote_number_norm  VARCHAR(64),                        -- normalized للبحث

  -- اتجاه + حالة
  direction           pbx_call_direction NOT NULL DEFAULT 'unknown',
  direction_locked    BOOLEAN NOT NULL DEFAULT FALSE,     -- بعد التثبيت لا يتغيّر
  status_last         pbx_call_status NOT NULL DEFAULT 'ringing',
  answered            BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason      VARCHAR(64),

  -- تواريخ
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at         TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  duration_seconds    INT NOT NULL DEFAULT 0,             -- من الرنين للإنهاء
  talk_seconds        INT NOT NULL DEFAULT 0,             -- من الرد للإنهاء

  -- تحويل/توجيه
  transfer_from       VARCHAR(32),
  transfer_to         VARCHAR(32),
  forwarded_to        VARCHAR(32),

  -- بنية تحتية
  trunk_name          VARCHAR(64),
  queue_name          VARCHAR(64),

  -- تسجيل
  recording_file      VARCHAR(255),
  recording_url       TEXT,

  -- ربط CRM
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  claim_id            UUID REFERENCES claims(id) ON DELETE SET NULL,
  claim_number        VARCHAR(64),
  customer_name       VARCHAR(255),
  customer_type       VARCHAR(32),

  -- مصدر الحقيقة (webhook نهائي > ami live)
  source_of_truth     pbx_event_source NOT NULL DEFAULT 'ami',
  raw_final_payload   JSONB,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbxlogs_ext         ON pbx_call_logs(ext);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_linkedid    ON pbx_call_logs(linkedid);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_uniqueid    ON pbx_call_logs(uniqueid);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_started     ON pbx_call_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_ended       ON pbx_call_logs(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_direction   ON pbx_call_logs(direction);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_remote_norm ON pbx_call_logs(remote_number_norm);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_customer    ON pbx_call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_pbxlogs_claim       ON pbx_call_logs(claim_id);
-- مكالمات جارية (للبث الحي)
CREATE INDEX IF NOT EXISTS idx_pbxlogs_live        ON pbx_call_logs(ended_at) WHERE ended_at IS NULL;

DROP TRIGGER IF EXISTS pbx_call_logs_updated_at ON pbx_call_logs;
CREATE TRIGGER pbx_call_logs_updated_at BEFORE UPDATE ON pbx_call_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
