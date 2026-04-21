-- ================================================================
-- Migration 006: مزامنة جميع المستخدمين (admin/supervisor/agent) إلى agents
-- ----------------------------------------------------------------
-- الهدف: إظهار الإداريين والمشرفين والموظفين جميعاً في شاشة المراقبة.
-- البيانات تأتي من users، وجدول agents يحتفظ بـ status/answered/missed...
-- ================================================================

-- function: مزامنة users -> agents
CREATE OR REPLACE FUNCTION public.sync_user_agent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_id          VARCHAR(32);
  v_avatar      VARCHAR(8);
  v_supervisor  VARCHAR(64);
  v_role_label  VARCHAR(32);
BEGIN
  -- DELETE: احذف صف الموظف المرتبط
  IF TG_OP = 'DELETE' THEN
    DELETE FROM agents WHERE user_id = OLD.id;
    RETURN OLD;
  END IF;

  -- المستخدم غير المُفعَّل: اضبط حالته إلى offline لكن لا تحذف
  IF NEW.is_active = FALSE THEN
    UPDATE agents SET status = 'offline' WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  -- نحتاج ext على الأقل لإنشاء صف agent (لأنه NOT NULL في الجدول)
  IF NEW.ext IS NULL OR length(trim(NEW.ext)) = 0 THEN
    -- لا يمكن إنشاء agent بدون ext — نتجاهل
    RETURN NEW;
  END IF;

  -- avatar: أوّل حرف من الاسم
  v_avatar := upper(substr(COALESCE(NEW.display_name, NEW.identifier, '?'), 1, 1));

  -- supervisor label يُشتقّ من الدور (للعرض فقط)
  v_role_label := CASE NEW.role
    WHEN 'admin'      THEN 'إدارة'
    WHEN 'supervisor' THEN 'مشرف'
    ELSE COALESCE(NEW.department, 'موظف')
  END;

  -- هل هناك صف agent مرتبط بالفعل؟
  IF EXISTS (SELECT 1 FROM agents WHERE user_id = NEW.id) THEN
    UPDATE agents
       SET name       = COALESCE(NEW.display_name, name),
           ext        = NEW.ext,
           avatar     = v_avatar,
           supervisor = v_role_label
     WHERE user_id = NEW.id;
  ELSE
    -- أنشئ صفاً جديداً
    v_id := 'AG-' || substr(replace(NEW.id::text, '-', ''), 1, 10);
    BEGIN
      INSERT INTO agents (id, user_id, name, ext, avatar, status, supervisor)
      VALUES (v_id, NEW.id, COALESCE(NEW.display_name, NEW.identifier),
              NEW.ext, v_avatar, 'offline', v_role_label);
    EXCEPTION WHEN unique_violation THEN
      -- تعارض id نادر — استخدم timestamp
      INSERT INTO agents (id, user_id, name, ext, avatar, status, supervisor)
      VALUES ('AG-' || extract(epoch from now())::bigint::text, NEW.id,
              COALESCE(NEW.display_name, NEW.identifier),
              NEW.ext, v_avatar, 'offline', v_role_label)
      ON CONFLICT DO NOTHING;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_agent ON users;
CREATE TRIGGER users_sync_agent
  AFTER INSERT OR UPDATE OF role, display_name, ext, is_active, department OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_agent();

-- ================================================================
-- مزامنة فورية للمستخدمين الموجودين الذين ليس لهم صف في agents
-- (يشمل admin / supervisor / agent — كل من لديه ext)
-- ================================================================
INSERT INTO agents (id, user_id, name, ext, avatar, status, supervisor)
SELECT
  'AG-' || substr(replace(u.id::text, '-', ''), 1, 10),
  u.id,
  COALESCE(u.display_name, u.identifier),
  u.ext,
  upper(substr(COALESCE(u.display_name, u.identifier, '?'), 1, 1)),
  'offline',
  CASE u.role
    WHEN 'admin'      THEN 'إدارة'
    WHEN 'supervisor' THEN 'مشرف'
    ELSE COALESCE(u.department, 'موظف')
  END
FROM users u
WHERE u.ext IS NOT NULL
  AND length(trim(u.ext)) > 0
  AND u.is_active = TRUE
  AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.user_id = u.id)
ON CONFLICT DO NOTHING;
