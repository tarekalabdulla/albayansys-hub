#!/usr/bin/env bash
# ============================================================
# نسخة احتياطية يومية تلقائية لقاعدة البيانات
# يحفظ pg_dump في /var/www/hulul/backups مع الاحتفاظ بآخر 7 أيام
# الاستخدام عبر cron (انظر README):
#   0 3 * * * /var/www/hulul/backend/backup-cron.sh
# ============================================================
set -euo pipefail

BACKUP_DIR="/var/www/hulul/backups"
RETENTION_DAYS=7
ENV_FILE="/var/www/hulul/backend/.env"

mkdir -p "$BACKUP_DIR"

# اقرأ DATABASE_URL من .env
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[backup] ❌ $ENV_FILE غير موجود" >&2
  exit 1
fi
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [[ -z "$DATABASE_URL" ]]; then
  echo "[backup] ❌ DATABASE_URL غير مضبوط في $ENV_FILE" >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/hulul-$TS.dump"

echo "[backup] $(date -Iseconds) — بدء النسخ → $OUT"
pg_dump --dbname="$DATABASE_URL" \
  --no-owner --no-privileges --clean --if-exists \
  --format=custom \
  --file="$OUT"

# حذف النسخ القديمة
find "$BACKUP_DIR" -name "hulul-*.dump" -type f -mtime +$RETENTION_DAYS -delete

SIZE="$(du -h "$OUT" | cut -f1)"
COUNT="$(find "$BACKUP_DIR" -name "hulul-*.dump" -type f | wc -l)"
echo "[backup] ✅ تم — الحجم: $SIZE — إجمالي النسخ المحفوظة: $COUNT"
