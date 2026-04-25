# Hulul Frontend — دليل النشر على سيرفر VPS عبر GitHub

تطبيق React + Vite + TypeScript. يُبنى محلياً على السيرفر إلى ملفات ثابتة داخل `dist/`، ثم يُقدَّم بواسطة Nginx.

> **لماذا الأزرار لا تعمل بعد النشر بينما تعمل في البريفيو؟**
> لأن الفرونت يتصل بالباك إند عبر متغير `VITE_API_URL` الذي يُحقن **وقت البناء** (build time)، وليس وقت التشغيل. إن لم تضبطه قبل `npm run build`، سيستخدم الفرونت رابطاً افتراضياً غير صحيح، فتفشل كل طلبات API صامتة وتبدو الأزرار "ميتة".

---

## 1) المتطلبات على السيرفر

- Node.js 20 LTS و npm
- Nginx
- Git
- نطاق يشير إلى السيرفر (مثلاً `example.com` و `api.example.com`)
- الباك إند يعمل بالفعل على `127.0.0.1:4000` (راجع `deploy/01-server-setup.sh`)

---

## 2) Clone المشروع على السيرفر

```bash
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/<your-account>/<your-repo>.git hulul-frontend
sudo chown -R $USER:$USER /var/www/hulul-frontend
cd /var/www/hulul-frontend
```

---

## 3) ضبط متغيرات البناء (مهم جداً)

أنشئ ملف `.env.production` في جذر المشروع قبل البناء:

```bash
cat > .env.production <<'EOF'
VITE_USE_REAL_API=true
VITE_API_URL=https://api.<your-domain>
EOF
```

استبدل `<your-domain>` بنطاقك الفعلي. هذا الملف **لن يُرفع إلى Git** (موجود في `.gitignore`)، وهو ضروري ليحفر Vite الرابط الصحيح داخل ملفات JS النهائية.

---

## 4) البناء

```bash
npm ci
npm run build
```

ستجد الناتج في `dist/`. هذا هو ما يقدّمه Nginx.

---

## 5) إعداد Nginx

استخدم القالب الجاهز في `deploy/04-nginx-frontend.conf`:

```bash
sudo cp deploy/04-nginx-frontend.conf /etc/nginx/sites-available/hulul-frontend
# عدّل اسم النطاق داخل الملف ليطابق نطاقك
sudo nano /etc/nginx/sites-available/hulul-frontend
sudo ln -sf /etc/nginx/sites-available/hulul-frontend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

ثم فعّل HTTPS:

```bash
sudo certbot --nginx -d <your-domain> -d www.<your-domain>
```

---

## 6) دورة التحديث من GitHub

في كل مرة تدفع فيها تغييرات إلى GitHub:

```bash
cd /var/www/hulul-frontend
git pull
npm ci
npm run build
sudo systemctl reload nginx
```

> ملاحظة: لا حاجة لـ `reload` إلا لو غيّرت إعدادات Nginx. تحديث محتوى `dist/` يكفي وحده، فالمتصفح سيلتقط الملفات الجديدة (Vite يضيف hash لكل ملف).

اختصار سكربت تحديث:

```bash
cat > /var/www/hulul-frontend/redeploy.sh <<'EOF'
#!/usr/bin/env bash
set -e
cd /var/www/hulul-frontend
git pull
npm ci
npm run build
echo "✅ frontend redeployed"
EOF
chmod +x /var/www/hulul-frontend/redeploy.sh
```

ثم استدعِه: `bash /var/www/hulul-frontend/redeploy.sh`

---

## 7) التحقق من أن المشكلة كانت متغيرات البيئة

افتح صفحة الموقع المنشور، ثم افتح Console المتصفح. أول سطر سترى:

```
[config] mode=REAL api=https://api.<your-domain> host=<your-domain>
```

- إن كان `mode=MOCK` → لم تَضبط `VITE_USE_REAL_API=true`.
- إن كان `api=` لا يطابق نطاقك → لم تَضبط `VITE_API_URL` قبل `npm run build`.

في كلا الحالتين أعد البناء بعد تصحيح `.env.production`.

---

## 8) أخطاء شائعة

| العَرَض | السبب | الحل |
|---------|-------|------|
| الأزرار لا تستجيب، Console يظهر `Network Error` على `/api/...` | `VITE_API_URL` غير مضبوط | اضبطه ثم أعد `npm run build` |
| `404` عند تحديث صفحة داخلية | SPA fallback مفقود في Nginx | تأكد من وجود `try_files $uri $uri/ /index.html` (موجود في `04-nginx-frontend.conf`) |
| `CORS` أو `Mixed Content` | الباك إند على HTTP والفرونت HTTPS | فعّل HTTPS على `api.<your-domain>` عبر certbot |
| تسجيل الدخول يفشل بعد النشر فقط | الباك إند لا يعرف نطاقك في `CORS_ORIGINS` | حدّث `CORS_ORIGINS` في `backend/.env` ثم `pm2 restart all` |

---

## التطوير المحلي

```bash
npm install
npm run dev
```

افتراضياً يعمل على `http://localhost:8080` ويتصل بـ Mock data داخلياً (لا يحتاج backend).
