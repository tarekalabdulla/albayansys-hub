# 🚀 دليل نشر Backend على VPS Namecheap

> **VPS:** Ubuntu 24.04 — `184.94.215.64` — `hulul-albayan.com`
> **API Subdomain:** `api.hulul-albayan.com`

---

## 📋 قبل البدء — DNS

أضف A record عند مزود الدومين:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | `api` | `184.94.215.64` | Automatic |

تحقق بعد ~10 دقائق:
```bash
dig +short api.hulul-albayan.com
# يجب أن يُرجع: 184.94.215.64
```

---

## 1️⃣ الاتصال بالسيرفر

من جهازك:
```bash
ssh root@184.94.215.64
```

---

## 2️⃣ تنصيب البيئة (Node + Postgres + Nginx)

ارفع مجلد `deploy/` للسيرفر، ثم:
```bash
cd /root/deploy
chmod +x 01-server-setup.sh 03-ssl.sh
bash 01-server-setup.sh
```

السكربت رح يثبّت:
- Node.js 20 LTS + PM2
- PostgreSQL 16 + ينشئ DB اسمها `hulul_db`
- Nginx + UFW (firewall) + fail2ban
- Certbot لـ SSL

✅ **مهم:** بيانات قاعدة البيانات تُحفظ في `/root/db_credentials.txt`

---

## 3️⃣ نشر كود الـ Backend

من جهازك (نسخ مجلد `backend/`):
```bash
scp -r backend/ root@184.94.215.64:/opt/hulul-api
```

أو من السيرفر مع git:
```bash
cd /opt && git clone <repo-url> hulul-api && cd hulul-api/backend
```

ثم على السيرفر:
```bash
cd /opt/hulul-api
cp .env.example .env
nano .env
```

في `.env` ضع:
- `DATABASE_URL` من `/root/db_credentials.txt`
- `JWT_SECRET` — أنشئه بـ:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- `CORS_ORIGIN` — دومين الفرونت (مثلاً Lovable preview URL + الدومين النهائي)

ثم:
```bash
npm install --production
npm run migrate    # إنشاء الجداول
npm run seed       # إدخال admin/supervisor/agent + 12 موظف
```

اختبار محلي:
```bash
node server.js
# في terminal آخر:
curl http://localhost:4000/api/health
```

---

## 4️⃣ تشغيل دائم بـ PM2

```bash
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd     # نفّذ الأمر الذي يطبعه
pm2 status
pm2 logs hulul-api
```

---

## 5️⃣ ربط Nginx

```bash
cp /root/deploy/02-nginx.conf /etc/nginx/sites-available/hulul-api
ln -s /etc/nginx/sites-available/hulul-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

اختبار HTTP (قبل SSL):
```bash
curl http://api.hulul-albayan.com/api/health
```

---

## 6️⃣ تركيب SSL

```bash
bash /root/deploy/03-ssl.sh
```

اختبار HTTPS:
```bash
curl https://api.hulul-albayan.com/api/health
# {"ok":true,"db":"up",...}
```

اختبار تسجيل الدخول:
```bash
curl -X POST https://api.hulul-albayan.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin","password":"admin123"}'
```

يجب أن يُرجع `{ "token": "...", "user": {...} }`.

---

## 7️⃣ بناء ونشر Frontend من GitHub إلى VPS

### 7.1 تحديث npm scripts (مرة واحدة)

في `package.json` بالمشروع، تأكد من وجود:
```json
"scripts": {
  "build": "tsc && vite build",
  "preview": "vite preview"
}
```

### 7.2 نسخ ملفات config للـ VPS

```bash
scp deploy/04-nginx-frontend.conf root@184.94.215.64:/root/deploy/
```

### 7.3 على السيرفر — إعداد Nginx للـ Frontend

```bash
# إنشاء مجلد الفرونت
mkdir -p /var/www/hulul-frontend

# نسخ config
ln -sf /root/deploy/04-nginx-frontend.conf /etc/nginx/sites-enabled/hulul-frontend
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### 7.4 بناء Frontend محلياً أو من GitHub

#### خيار أ: بناء محلي ورفع dist/
من جهازك:
```bash
cd /path/to/project
# تأكد من env variables
export VITE_USE_REAL_API=true
export VITE_API_URL=https://api.hulul-albayan.com
npm install
npm run build
# ارفع dist/
scp -r dist/ root@184.94.215.64:/var/www/hulul-frontend/
```

#### خيار ب: CI/CD من GitHub (مُستحسن)
في السيرفر:
```bash
mkdir -p /opt/hulul-frontend
cd /opt/hulul-frontend

# استنساخ المشروع
git clone https://github.com/<user>/<repo>.git .

# بناء مباشرة على السيرفر
npm install
VITE_USE_REAL_API=true VITE_API_URL=https://api.hulul-albayan.com npm run build

# نسخ dist للـ Nginx
cp -r dist/* /var/www/hulul-frontend/
```

### 7.5 SSL للـ Frontend

```bash
certbot --nginx -d hulul-albayan.com -d www.hulul-albayan.com
```

### 7.6 اختبار النشر

```bash
curl -I https://hulul-albayan.com
# يجب أن يُرجع: HTTP/2 200
```

---

## 🔄 تحديث Frontend (بعد التعديلات)

### تحديث يدوي:
```bash
# من جهازك — بناء ورفع
npm run build
scp -r dist/* root@184.94.215.64:/var/www/hulul-frontend/
```

### أو تحديث عبر Git على السيرفر:
```bash
ssh root@184.94.215.64 "cd /opt/hulul-frontend && git pull && npm install && VITE_USE_REAL_API=true VITE_API_URL=https://api.hulul-albayan.com npm run build && cp -r dist/* /var/www/hulul-frontend/"
```

---

## 🔗 ربط Frontend (Lovable Preview)

للتطوير السريع بدون نشر:
1. أنشئ `.env` في Lovable:
   ```
   VITE_USE_REAL_API=true
   VITE_API_URL=https://api.hulul-albayan.com
   ```
2. أعد بناء — رح يستخدم API الحقيقي تلقائياً.

---

## 🛠️ صيانة

| المهمة | الأمر |
|---|---|
| سجلات PM2 | `pm2 logs hulul-api` |
| إعادة تشغيل API | `pm2 restart hulul-api` |
| تحديث الكود | `cd /opt/hulul-api && git pull && npm install && pm2 restart hulul-api` |
| تجديد SSL تلقائي | يعمل وحده عبر cron من Certbot |
| نسخة احتياطية DB | `pg_dump -U hulul_user hulul_db > /root/backup-$(date +%F).sql` |

---

## 🔐 ملاحظات أمان

- ✅ غيّر كلمات السر التجريبية فور أول دخول (admin123 → كلمة قوية)
- ✅ افتح أداة Postgres على localhost فقط (الافتراضي — لا تغيّر `pg_hba.conf` لقبول الخارج)
- ✅ JWT_SECRET لازم يكون عشوائي وطويل (64+ حرف)
- ✅ راقب `fail2ban` لمحاولات SSH الفاشلة
