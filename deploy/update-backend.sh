#!/usr/bin/env bash
# ============================================================
# تحديث سريع للـ backend من GitHub
# الاستخدام (على السيرفر كـ root):
#   bash /var/www/hulul/backend/update-backend.sh https://github.com/USER/REPO.git
# ============================================================
set -euo pipefail

REPO_URL="${1:-}"
if [[ -z "$REPO_URL" ]]; then
  echo "❌ مرّر رابط الـ repo: bash update-backend.sh https://github.com/USER/REPO.git" >&2
  exit 1
fi

APP_USER="hulul"
APP_ROOT="/var/www/hulul"
SRC_DIR="/tmp/hulul-source"

echo "📥 سحب آخر تحديث من GitHub..."
if [[ -d "$SRC_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$SRC_DIR" pull --ff-only
else
  rm -rf "$SRC_DIR"
  sudo -u "$APP_USER" git clone "$REPO_URL" "$SRC_DIR"
fi

echo "📦 نسخ ملفات backend..."
rsync -a --delete \
  --exclude='node_modules' --exclude='.env' --exclude='uploads' \
  "$SRC_DIR/backend/" "$APP_ROOT/backend/"
chown -R "$APP_USER:$APP_USER" "$APP_ROOT/backend"

echo "📚 تثبيت الحزم..."
cd "$APP_ROOT/backend"
sudo -u "$APP_USER" npm ci --omit=dev

echo "🗄️  تشغيل migrations..."
sudo -u "$APP_USER" node db/migrate.js || echo "⚠️  migrate.js فشل أو غير ضروري — تابع"

echo "🔄 إعادة تشغيل PM2..."
sudo -u "$APP_USER" pm2 restart all
sudo -u "$APP_USER" pm2 save

echo ""
echo "✅ تم تحديث backend بنجاح!"
sudo -u "$APP_USER" pm2 status
