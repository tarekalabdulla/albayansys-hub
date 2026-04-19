#!/usr/bin/env bash
# ============================================================
# 01-server-setup.sh
# تجهيز VPS Ubuntu 22.04/24.04 لاستضافة تطبيق "حلول البيان"
# يثبّت: Node 20, PostgreSQL 16, Nginx, PM2, Certbot, ufw
# ينشئ: مستخدم hulul، قاعدة بيانات hulul، المجلدات اللازمة
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "❌ يجب تشغيل السكربت كـ root (استخدم sudo)" >&2
  exit 1
fi

if ! command -v lsb_release >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y lsb-release
fi

UBUNTU_CODENAME="$(lsb_release -cs)"
echo "📦 Ubuntu: $UBUNTU_CODENAME"

# ============== متغيرات ==============
APP_USER="hulul"
APP_ROOT="/var/www/hulul"
DB_NAME="hulul"
DB_USER="hulul_app"
DB_PASS="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 48)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
CREDS_FILE="/root/hulul-credentials.txt"

echo ""
echo "============================================"
echo " 1/8  تحديث النظام وتثبيت الأدوات الأساسية"
echo "============================================"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl wget gnupg ca-certificates lsb-release software-properties-common \
  ufw git unzip build-essential openssl

echo ""
echo "============================================"
echo " 2/8  تثبيت Node.js 20 LTS"
echo "============================================"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1)" != "v20" && "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

echo ""
echo "============================================"
echo " 3/8  تثبيت PostgreSQL 16"
echo "============================================"
if ! command -v psql >/dev/null 2>&1; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $UBUNTU_CODENAME-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16 postgresql-client-16
fi
systemctl enable --now postgresql
psql --version

echo ""
echo "============================================"
echo " 4/8  إنشاء قاعدة البيانات والمستخدم"
echo "============================================"
sudo -u postgres psql <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$DB_USER') THEN
    CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
  ELSE
    ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';
  END IF;
END \$\$;
EOF

if ! sudo -u postgres psql -lqt | cut -d\| -f1 | grep -qw "$DB_NAME"; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

echo ""
echo "============================================"
echo " 5/8  تثبيت Nginx + Certbot"
echo "============================================"
apt-get install -y nginx
systemctl enable --now nginx

if ! command -v certbot >/dev/null 2>&1; then
  apt-get install -y certbot python3-certbot-nginx
fi

echo ""
echo "============================================"
echo " 6/8  تثبيت PM2 (مدير العمليات)"
echo "============================================"
npm install -g pm2

echo ""
echo "============================================"
echo " 7/8  إنشاء مستخدم النظام والمجلدات"
echo "============================================"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -d "/home/$APP_USER" -s /bin/bash "$APP_USER"
fi
mkdir -p "$APP_ROOT"/{public,backend,uploads,backups}
chown -R "$APP_USER:$APP_USER" "$APP_ROOT/backend" "$APP_ROOT/uploads" "$APP_ROOT/backups"
chown -R www-data:www-data "$APP_ROOT/public"
chmod 755 "$APP_ROOT"

echo ""
echo "============================================"
echo " 8/8  تفعيل الجدار الناري (ufw)"
echo "============================================"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status

# ============== حفظ بيانات الاعتماد ==============
cat > "$CREDS_FILE" <<EOF
# ============================================
# بيانات اعتماد التطبيق — احتفظ بها بأمان
# تم إنشاؤها في: $(date -Iseconds)
# ============================================

# قاعدة البيانات
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME

# أسرار التطبيق (انسخها إلى /var/www/hulul/backend/.env)
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

# مسارات
APP_ROOT=$APP_ROOT
APP_USER=$APP_USER
EOF
chmod 600 "$CREDS_FILE"

echo ""
echo "============================================"
echo "✅ تم تجهيز السيرفر بنجاح!"
echo "============================================"
echo ""
echo "📄 بيانات الاعتماد محفوظة في: $CREDS_FILE"
echo ""
echo "📋 الخطوات التالية:"
echo "  1. ارفع كود backend إلى $APP_ROOT/backend"
echo "  2. أنشئ $APP_ROOT/backend/.env من .env.example مع القيم أعلاه"
echo "  3. cd $APP_ROOT/backend && sudo -u $APP_USER npm ci --omit=dev"
echo "  4. sudo -u $APP_USER node db/migrate.js"
echo "  5. sudo -u $APP_USER pm2 start ecosystem.config.cjs --env production"
echo ""
echo "📖 راجع deploy/README.md للتفاصيل."
