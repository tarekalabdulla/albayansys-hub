#!/usr/bin/env bash
# ============================================================================
# update-site.sh — تحديث شامل وآمن للمشروع على السيرفر
# ----------------------------------------------------------------------------
# يقوم بـ:
#   1) أخذ نسخة احتياطية من backend/.env
#   2) git pull (إن وُجد ريموت)
#   3) تثبيت/تحديث npm packages للـ backend والـ frontend
#   4) تشغيل migrations DB إن وُجدت
#   5) بناء الفرونت (Vite)
#   6) نسخ build إلى /var/www/hulul-frontend/dist
#   7) إعادة تشغيل pm2 لـ hulul-api
#   8) إعادة تحميل nginx
#   9) فحص /api/health
#
# الاستخدام:
#   sudo bash /opt/hulul-api-full/deploy/update-site.sh
#
# يمكن تخصيص المسارات بمتغيرات البيئة:
#   PROJECT_DIR=/opt/hulul-api-full
#   FRONTEND_DEPLOY_DIR=/var/www/hulul-frontend/dist
#   PM2_APP_NAME=hulul-api
#   HEALTH_URL=http://127.0.0.1:4000/api/health
# ============================================================================

set -Eeuo pipefail

# ----- إعدادات قابلة للتعديل -----
PROJECT_DIR="${PROJECT_DIR:-/opt/hulul-api-full}"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_DIR/backend}"
FRONTEND_DEPLOY_DIR="${FRONTEND_DEPLOY_DIR:-/var/www/hulul-frontend/dist}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
PM2_APP_NAME="${PM2_APP_NAME:-hulul-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/health}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://api.hulul-albayan.com/api/health}"

# ----- ألوان للـ logs -----
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; NC=$'\033[0m'

log()   { echo "${BLUE}▸${NC} $*"; }
ok()    { echo "${GREEN}✓${NC} $*"; }
warn()  { echo "${YELLOW}⚠${NC} $*"; }
fail()  { echo "${RED}✗${NC} $*" >&2; }
section(){ echo; echo "${BOLD}${BLUE}=== $* ===${NC}"; }

trap 'fail "حدث خطأ غير متوقع في السطر $LINENO. تم إيقاف السكربت."' ERR

# ----- التحقق من المتطلبات -----
section "0) التحقق من المتطلبات"
[ -d "$PROJECT_DIR" ] || { fail "PROJECT_DIR=$PROJECT_DIR غير موجود"; exit 1; }
[ -d "$BACKEND_DIR" ] || { fail "BACKEND_DIR=$BACKEND_DIR غير موجود"; exit 1; }
command -v node >/dev/null  || { fail "node غير مثبَّت"; exit 1; }
command -v npm  >/dev/null  || { fail "npm غير مثبَّت"; exit 1; }
command -v pm2  >/dev/null  || { warn "pm2 غير موجود — سأتجاوز خطوة restart"; PM2_OK=0; }
PM2_OK="${PM2_OK:-1}"
ok "PROJECT_DIR=$PROJECT_DIR"
ok "BACKEND_DIR=$BACKEND_DIR"
ok "FRONTEND_DEPLOY_DIR=$FRONTEND_DEPLOY_DIR"

# ----- 1) نسخة احتياطية من .env -----
section "1) نسخة احتياطية من backend/.env"
mkdir -p "$BACKUP_DIR"
if [ -f "$BACKEND_DIR/.env" ]; then
  TS=$(date +%Y%m%d-%H%M%S)
  BACKUP_FILE="$BACKUP_DIR/.env.backup-$TS"
  cp "$BACKEND_DIR/.env" "$BACKUP_FILE"
  ok "تم النسخ: $BACKUP_FILE"
  # نحتفظ بآخر 10 نسخ فقط
  ls -1t "$BACKUP_DIR"/.env.backup-* 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  warn "$BACKEND_DIR/.env غير موجود — تخطّي النسخة الاحتياطية"
fi

# ----- 2) git pull -----
section "2) git pull"
if [ -d "$PROJECT_DIR/.git" ]; then
  cd "$PROJECT_DIR"
  if git remote get-url origin >/dev/null 2>&1; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    log "السحب من origin/$BRANCH ..."
    git pull --ff-only origin "$BRANCH" || { warn "git pull فشل (تعارضات؟) — تابعت بالكود الحالي"; }
    ok "git pull تم"
  else
    warn "لا يوجد remote 'origin' مضبوط — تخطّي"
  fi
else
  warn "$PROJECT_DIR ليس مستودع git — تخطّي"
fi

# ----- 3) تثبيت npm packages -----
section "3) تثبيت npm packages"

log "Backend dependencies..."
cd "$BACKEND_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi
ok "Backend deps OK"

log "Frontend dependencies..."
cd "$PROJECT_DIR"
if command -v bun >/dev/null && [ -f bun.lockb ]; then
  bun install --frozen-lockfile || bun install
elif [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
ok "Frontend deps OK"

# ----- 4) Migrations -----
section "4) تشغيل migrations (إن وُجدت)"
cd "$BACKEND_DIR"
if [ -f db/migrate.js ]; then
  log "تشغيل node db/migrate.js ..."
  node db/migrate.js && ok "migrations تمت" || warn "migrations انتهت بأخطاء — راجع الـ logs"
else
  warn "db/migrate.js غير موجود — تخطّي"
fi

# ----- 5) بناء الفرونت -----
section "5) بناء الفرونت (vite build)"
cd "$PROJECT_DIR"
if command -v bun >/dev/null && [ -f bun.lockb ]; then
  bun run build
else
  npm run build
fi
[ -d "$PROJECT_DIR/dist" ] || { fail "dist غير موجود بعد البناء"; exit 1; }
ok "build OK"

# ----- 6) نشر الفرونت -----
section "6) نشر الفرونت إلى $FRONTEND_DEPLOY_DIR"
mkdir -p "$FRONTEND_DEPLOY_DIR"
# نُفرّغ المحتوى القديم (دون حذف المجلد ذاته كي لا نكسر صلاحيات nginx)
find "$FRONTEND_DEPLOY_DIR" -mindepth 1 -delete
cp -r "$PROJECT_DIR/dist/." "$FRONTEND_DEPLOY_DIR/"
chown -R www-data:www-data "$FRONTEND_DEPLOY_DIR" 2>/dev/null || warn "تعذّر تعديل المالك (شغّل بـ sudo)"
ok "تم النشر: $(ls -1 "$FRONTEND_DEPLOY_DIR" | wc -l) عنصر"

# ----- 7) إعادة تشغيل pm2 -----
section "7) إعادة تشغيل pm2 ($PM2_APP_NAME)"
if [ "$PM2_OK" = "1" ]; then
  if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_APP_NAME" --update-env
    ok "pm2 restart تم"
  else
    log "$PM2_APP_NAME غير موجود — سأبدأه من ecosystem.config.cjs"
    cd "$BACKEND_DIR"
    if [ -f ecosystem.config.cjs ]; then
      pm2 start ecosystem.config.cjs --update-env
      ok "pm2 start تم"
    else
      warn "ecosystem.config.cjs غير موجود — تخطّي"
    fi
  fi
  pm2 save >/dev/null 2>&1 || true
fi

# ----- 8) إعادة تحميل nginx -----
section "8) إعادة تحميل nginx"
if command -v nginx >/dev/null && command -v systemctl >/dev/null; then
  if nginx -t 2>/dev/null; then
    systemctl reload nginx && ok "nginx reload تم" || warn "تعذّر reload — راجع الـ logs"
  else
    fail "nginx config فيه خطأ — لم أعد التحميل. شغّل: nginx -t"
  fi
else
  warn "nginx/systemctl غير متاح — تخطّي"
fi

# ----- 9) فحص health -----
section "9) فحص /api/health"
sleep 2
if command -v curl >/dev/null; then
  log "محلياً: $HEALTH_URL"
  if curl -sf --max-time 10 "$HEALTH_URL" >/dev/null; then
    ok "Health محلي OK"
    curl -s --max-time 10 "$HEALTH_URL" | head -c 300; echo
  else
    fail "Health محلي فشل — راجع: pm2 logs $PM2_APP_NAME"
  fi

  log "علني: $PUBLIC_HEALTH_URL"
  if curl -sf --max-time 10 "$PUBLIC_HEALTH_URL" >/dev/null; then
    ok "Health علني OK"
  else
    warn "Health علني لم يستجب — تحقق من DNS/SSL/nginx"
  fi
else
  warn "curl غير مثبَّت — تخطّي"
fi

echo
echo "${BOLD}${GREEN}✅ التحديث اكتمل بنجاح${NC}"
echo "   Backup: ${BACKUP_FILE:-لا يوجد}"
echo "   Frontend: $FRONTEND_DEPLOY_DIR"
echo "   API health: $HEALTH_URL"
