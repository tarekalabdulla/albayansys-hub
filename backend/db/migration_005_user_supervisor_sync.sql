-- ================================================================
-- Migration 005: ربط تلقائي بين users (role=supervisor) و supervisors
-- ----------------------------------------------------------------
-- الهدف: عندما يُنشأ/يُحدَّث مستخدم بدور supervisor يُنشأ تلقائياً
-- صف موازٍ في جدول supervisors حتى يظهر في صفحة إدارة المشرفين.
-- ================================================================

-- ربط جدول supervisors بـ users (اختياري — يبقى قديماً متوافقاً)
ALTER TABLE supervisors ADD COLUMN IF NOT EXISTS user_id UUID
  REFERENCES users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisors_user
  ON supervisors(user_id) WHERE user_id IS NOT NULL;

-- function: يحافظ على مزامنة users ↔ supervisors
CREATE OR REPLACE FUNCTION public.sync_user_supervisor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_id   VARCHAR(32);
  v_role VARCHAR(32);
BEGIN
  -- DELETE: احذف صف المشرف المرتبط
  IF TG_OP = 'DELETE' THEN
    DELETE FROM supervisors WHERE user_id = OLD.id;
    RETURN OLD;
  END IF;

  -- لو الدور ليس supervisor: احذف أي صف مرتبط (لو وُجد)
  IF NEW.role <> 'supervisor' THEN
    DELETE FROM supervisors WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  -- لو الدور supervisor ولا يوجد ext أو email يكفي، نتجاوز (المشرف يحتاج ext+email)
  IF NEW.ext IS NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- خرائط دور users.role -> supervisors.role
  v_role := 'مشرف';

  -- هل هناك صف مشرف مرتبط بالفعل؟
  IF EXISTS (SELECT 1 FROM supervisors WHERE user_id = NEW.id) THEN
    UPDATE supervisors
       SET name  = COALESCE(NEW.display_name, name),
           email = NEW.email,
           ext   = NEW.ext
     WHERE user_id = NEW.id;
  ELSE
    -- أنشئ صفاً جديداً (تجنّب تعارض id)
    v_id := 'S-' || substr(replace(NEW.id::text, '-', ''), 1, 10);
    -- لو تعارض id بطريقة ما، استخدم timestamp
    BEGIN
      INSERT INTO supervisors (id, user_id, name, email, ext, role)
      VALUES (v_id, NEW.id, COALESCE(NEW.display_name, NEW.identifier), NEW.email, NEW.ext, v_role);
    EXCEPTION WHEN unique_violation THEN
      INSERT INTO supervisors (id, user_id, name, email, ext, role)
      VALUES ('S-' || extract(epoch from now())::bigint::text, NEW.id,
              COALESCE(NEW.display_name, NEW.identifier), NEW.email, NEW.ext, v_role)
      ON CONFLICT (user_id) DO NOTHING;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_supervisor ON users;
CREATE TRIGGER users_sync_supervisor
  AFTER INSERT OR UPDATE OF role, display_name, email, ext OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_supervisor();

-- مزامنة فورية للمستخدمين الموجودين بدور supervisor الذين ليس لهم صف
INSERT INTO supervisors (id, user_id, name, email, ext, role)
SELECT
  'S-' || substr(replace(u.id::text, '-', ''), 1, 10),
  u.id,
  COALESCE(u.display_name, u.identifier),
  u.email,
  u.ext,
  'مشرف'
FROM users u
WHERE u.role = 'supervisor'
  AND u.email IS NOT NULL
  AND u.ext   IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM supervisors s WHERE s.user_id = u.id)
ON CONFLICT DO NOTHING;
