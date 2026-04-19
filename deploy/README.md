# 🚀 دليل النشر على VPS — حلول البيان

دليل عملي خطوة بخطوة لنشر التطبيق على VPS بنظام **Ubuntu 22.04 / 24.04**
عبر سيناريو هجين: **FileZilla للـ frontend + SSH للـ backend**.

---

## 📋 المتطلبات

- **VPS** Ubuntu 22.04 أو 24.04 (مع صلاحيات root أو sudo)
- **دومين** موجّه (A record) إلى IP السيرفر — مثلاً `app.yourdomain.com` و `api.yourdomain.com`
- **FileZilla** مثبّت على جهازك للرفع
- **PuTTY** (ويندوز) أو Terminal (Mac/Linux) للوصول SSH
- **Node.js 20+** على جهازك المحلي لبناء الـ frontend

---

## 🗺️ الخطة العامة

```
[جهازك المحلي]                    [VPS — Ubuntu]
   ├─ npm run build               ├─ /var/www/hulul/public      ← frontend (FileZilla)
   │      ↓                       ├─ /var/www/hulul/backend     ← backend  (git/SSH)
   │   dist/                      ├─ /var/www/hulul/uploads     ← ملفات المستخدمين
   │      ↓                       ├─ /var/www/hulul/backups     ← نسخ احتياطية
   │   FileZilla → /var/www/hulul/public
   │
   └─ git push origin main → GitHub → git pull على VPS
```

---

## 1️⃣ تجهيز السيرفر (مرة واحدة فقط)

### (أ) ادخل بـ SSH
```bash
ssh root@YOUR_VPS_IP
```

### (ب) ارفع سكربت `01-server-setup.sh` إلى السيرفر
عبر FileZilla أو SCP:
```bash
scp deploy/01-server-setup.sh root@YOUR_VPS_IP:/tmp/
```

### (ج) شغّل السكربت على السيرفر
```bash
ssh root@YOUR_VPS_IP
bash /tmp/01-server-setup.sh
```

السكربت سيقوم بـ:
- تحديث النظام
- تثبيت Node.js 20 LTS، PostgreSQL 16، Nginx، PM2، Certbot، unzip، git، ufw
- إنشاء مستخدم نظام `hulul` (بدون root)
- إنشاء قاعدة بيانات `hulul` ومستخدم `hulul_app` بكلمة مرور عشوائية
- إنشاء المجلدات: `/var/www/hulul/{public,backend,uploads,backups}`
- ضبط ufw firewall (22, 80, 443)
- حفظ بيانات الاعتماد في `/root/hulul-credentials.txt`

📌 **مهم**: بعد انتهاء السكربت، شوف المخرجات — راح تطبع لك:
- `DATABASE_URL` — تحتاجها لـ backend `.env`
- مسار `JWT_SECRET` — مولّد عشوائياً
- بيانات قاعدة البيانات

---

## 2️⃣ نشر الـ backend (عبر SSH + git)

### (أ) على السيرفر، استنسخ المشروع
```bash
sudo -u hulul git clone https://github.com/YOUR_USER/YOUR_REPO.git /tmp/hulul-source
sudo cp -r /tmp/hulul-source/backend/* /var/www/hulul/backend/
sudo chown -R hulul:hulul /var/www/hulul/backend
```

### (ب) أنشئ ملف `.env` للـ backend
```bash
sudo nano /var/www/hulul/backend/.env
```

الصق المحتوى من `deploy/.env.example` بعد تعبئة القيم الفعلية (انظر `/root/hulul-credentials.txt`).

ثم:
```bash
sudo chown hulul:hulul /var/www/hulul/backend/.env
sudo chmod 600 /var/www/hulul/backend/.env
```

### (ج) ثبّت الحزم وشغّل migrations
```bash
cd /var/www/hulul/backend
sudo -u hulul npm ci --omit=dev
sudo -u hulul node db/migrate.js
```

### (د) شغّل backend بـ PM2
```bash
sudo -u hulul pm2 start ecosystem.config.cjs --env production
sudo -u hulul pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u hulul --hp /home/hulul
```

تحقق:
```bash
sudo -u hulul pm2 status
sudo -u hulul pm2 logs --lines 30
curl http://localhost:4000/api/health
```

---

## 3️⃣ بناء ورفع الـ frontend (من جهازك المحلي + FileZilla)

### (أ) أنشئ ملف `.env` على جهازك المحلي
في جذر المشروع:
```env
VITE_API_URL=https://api.yourdomain.com
```

### (ب) ابنِ الـ frontend
```bash
npm ci
npm run build
```

سيتولّد مجلد `dist/` بكل الملفات الجاهزة للرفع.

### (ج) افتح FileZilla واتصل بسيرفرك
- Host: `sftp://YOUR_VPS_IP`
- Username: `root` (أو user مع sudo)
- Port: `22`

### (د) ارفع محتوى `dist/`
1. في الجانب الأيمن (Remote)، انتقل إلى `/var/www/hulul/public/`
2. **احذف كل المحتوى القديم هناك** (Right-click → Delete)
3. في الجانب الأيسر (Local)، افتح مجلد `dist/`
4. اختر كل الملفات داخل `dist/` (Ctrl+A) واسحبها للجانب الأيمن

### (هـ) اضبط الصلاحيات (عبر SSH)
```bash
sudo chown -R www-data:www-data /var/www/hulul/public
sudo find /var/www/hulul/public -type d -exec chmod 755 {} \;
sudo find /var/www/hulul/public -type f -exec chmod 644 {} \;
```

---

## 4️⃣ إعداد Nginx + SSL

### (أ) ارفع ملف Nginx config
```bash
scp deploy/03-nginx.conf.template root@YOUR_VPS_IP:/tmp/
```

### (ب) على السيرفر، استبدل الدومين وفعّل
```bash
DOMAIN=app.yourdomain.com
API_DOMAIN=api.yourdomain.com
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__API_DOMAIN__/$API_DOMAIN/g" \
  /tmp/03-nginx.conf.template > /etc/nginx/sites-available/hulul.conf

sudo ln -sf /etc/nginx/sites-available/hulul.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### (ج) فعّل HTTPS عبر Let's Encrypt
```bash
sudo certbot --nginx -d app.yourdomain.com -d api.yourdomain.com \
  --non-interactive --agree-tos -m you@yourdomain.com --redirect
```

certbot يجدّد تلقائياً عبر cron.

---

## 5️⃣ التحقق النهائي

افتح في المتصفح:
- 🌐 https://app.yourdomain.com → يجب أن يفتح تسجيل الدخول
- 🔌 https://api.yourdomain.com/api/health → `{"ok":true,"db":"up",...}`

سجّل دخول كأدمن (أنشئ المستخدم الأول عبر psql):
```bash
sudo -u postgres psql hulul -c "
INSERT INTO users (id, name, email, password_hash, role, active)
VALUES (gen_random_uuid(), 'Admin', 'admin@yourdomain.com',
  crypt('CHANGE_ME_STRONG_PASSWORD', gen_salt('bf')), 'admin', true);"
```

---

## 🔄 التحديثات اللاحقة

### تحديث الـ backend فقط
```bash
ssh root@YOUR_VPS_IP
cd /tmp/hulul-source && sudo -u hulul git pull
sudo cp -r /tmp/hulul-source/backend/* /var/www/hulul/backend/
sudo chown -R hulul:hulul /var/www/hulul/backend
cd /var/www/hulul/backend
sudo -u hulul npm ci --omit=dev
sudo -u hulul node db/migrate.js   # لو في migrations جديدة
sudo -u hulul pm2 restart all
```

### تحديث الـ frontend فقط
على جهازك:
```bash
git pull
npm run build
```
ثم FileZilla → احذف محتوى `/var/www/hulul/public` → ارفع `dist/*`.

---

## 💾 النسخ الاحتياطية

شغّل سكربت `backup-cron.sh` يومياً عبر cron:
```bash
sudo crontab -e
# أضف:
0 3 * * * /var/www/hulul/backend/backup-cron.sh >> /var/log/hulul-backup.log 2>&1
```

السكربت يحفظ `pg_dump` يومي في `/var/www/hulul/backups/` ويحذف ما هو أقدم من 7 أيام.

---

## 🆘 استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| `502 Bad Gateway` | backend ميت — `sudo -u hulul pm2 logs` ثم `pm2 restart all` |
| `CORS blocked` | تأكد من `CORS_ORIGIN` في `.env` يحتوي `https://app.yourdomain.com` |
| WebSocket لا يعمل | تأكد من Nginx config فيه `proxy_set_header Upgrade $http_upgrade` |
| تسجيل الدخول يفشل | `sudo -u postgres psql hulul -c "SELECT email FROM users"` للتحقق من المستخدمين |
| الصور لا تظهر | تأكد `chown -R hulul:hulul /var/www/hulul/uploads` |

تحقق من logs:
```bash
sudo -u hulul pm2 logs                    # backend
sudo tail -f /var/log/nginx/error.log     # nginx
sudo journalctl -u postgresql -n 50       # postgres
```

---

## 📦 ملفات هذا المجلد

| الملف | الوظيفة |
|---|---|
| `01-server-setup.sh` | تجهيز السيرفر (Node, Postgres, Nginx, PM2, ufw) |
| `03-nginx.conf.template` | قالب Nginx — استبدل `__DOMAIN__` و `__API_DOMAIN__` |
| `.env.example` | قالب متغيرات البيئة للـ backend |
| `backup-cron.sh` | نسخة احتياطية يومية تلقائية |
| `update-backend.sh` | اختصار لتحديث backend بأمر واحد |

✅ كل الباقي موجود في `backend/` (الكود) و `dist/` (بعد البناء).
