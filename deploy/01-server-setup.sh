#!/usr/bin/env bash
# ============================================
# تثبيت كل المتطلبات على VPS Ubuntu 24.04
# تشغيل: bash 01-server-setup.sh
# ============================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

if [[ $EUID -ne 0 ]]; then
   echo "شغّل بصلاحية root: sudo bash $0"; exit 1
fi

log "تحديث النظام..."
apt-get update -y && apt-get upgrade -y

log "تثبيت الأدوات الأساسية..."
apt-get install -y curl git build-essential ufw fail2ban ca-certificates gnupg lsb-release

# ---------- Node.js 20 LTS ----------
log "تثبيت Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v && npm -v

# ---------- PM2 ----------
log "تثبيت PM2..."
npm install -g pm2

# ---------- PostgreSQL 16 ----------
log "تثبيت PostgreSQL 16..."
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
apt-get update -y
apt-get install -y postgresql-16 postgresql-contrib-16

systemctl enable --now postgresql

# إنشاء DB وuser
DB_NAME="hulul_db"
DB_USER="hulul_user"
DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"

log "إنشاء قاعدة البيانات والمستخدم..."
sudo -u postgres psql <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}" > /root/db_credentials.txt
chmod 600 /root/db_credentials.txt
warn "بيانات DB حُفظت في /root/db_credentials.txt"

# ---------- Nginx ----------
log "تثبيت Nginx..."
apt-get install -y nginx
systemctl enable --now nginx

# ---------- UFW Firewall ----------
log "إعداد جدار الحماية..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ---------- Certbot لـ SSL ----------
log "تثبيت Certbot..."
apt-get install -y certbot python3-certbot-nginx

log "✅ التثبيت الأساسي مكتمل!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  الخطوات التالية:"
echo "  1) نسخ كود backend/ إلى /opt/hulul-api"
echo "  2) cp /root/db_credentials.txt محتواه إلى backend/.env"
echo "  3) cd /opt/hulul-api && npm install"
echo "  4) npm run migrate && npm run seed"
echo "  5) pm2 start ecosystem.config.cjs && pm2 save && pm2 startup"
echo "  6) cp deploy/02-nginx.conf /etc/nginx/sites-available/hulul-api"
echo "  7) ln -s /etc/nginx/sites-available/hulul-api /etc/nginx/sites-enabled/"
echo "  8) nginx -t && systemctl reload nginx"
echo "  9) bash deploy/03-ssl.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
