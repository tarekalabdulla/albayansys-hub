# 📁 دليل FileZilla — حذف القديم ورفع الجديد

دليل سريع لاستبدال ملفات النظام القديم على VPS عبر FileZilla.

---

## ⚠️ قبل ما تبدأ — لا تحذف هذه الملفات أبداً

| الملف/المجلد | السبب |
|---|---|
| `.env` | كلمات السر وروابط قاعدة البيانات |
| `uploads/` | ملفات المستخدمين (صور، تسجيلات) |
| `backups/` | النسخ الاحتياطية لقاعدة البيانات |
| `node_modules/` | لو حذفته لازم `npm ci` ثاني عبر SSH |

> 💡 **نصيحة**: قبل أي حذف، خذ نسخة احتياطية:
> ```bash
> ssh root@VPS_IP "tar -czf /root/backup-$(date +%F).tar.gz /var/www/hulul"
> ```

---

## 1️⃣ اتصال FileZilla بالسيرفر

| الحقل | القيمة |
|---|---|
| Host | `sftp://YOUR_VPS_IP` |
| Username | `root` |
| Password | كلمة سر السيرفر |
| Port | `22` |

> استخدم **SFTP** وليس FTP — أكثر أماناً.

---

## 2️⃣ تحديد مكان النظام القديم

في الجانب الأيمن (Remote)، جرّب هذه المسارات الشائعة:

- `/var/www/html/` — موقع Nginx/Apache افتراضي
- `/var/www/hulul/public/` — لو ركّبت سكربت `01-server-setup.sh`
- `/home/USERNAME/public_html/` — استضافة cPanel
- `/usr/share/nginx/html/` — Nginx بديل

> 📌 افتح كل مسار وشوف وين موجود `index.html` أو `index.php` — هذا مكان الـ frontend.

---

## 3️⃣ حذف ملفات الـ Frontend القديمة فقط

داخل مجلد الـ frontend (مثلاً `/var/www/hulul/public/`):

1. اضغط **Ctrl+A** لاختيار كل الملفات
2. Right-click → **Delete**
3. أكّد الحذف

> 🗑️ احذف أيضاً `.htaccess` لو موجود — النظام الجديد ما يحتاجه.

> ⚠️ **لا تحذف**: مجلد `backend/`, `uploads/`, `backups/`, ولا الملف `.env`.

---

## 4️⃣ ابنِ النظام الجديد على جهازك المحلي

في جذر المشروع على جهازك:

```bash
# (مرة واحدة) أنشئ ملف البيئة
echo "VITE_API_URL=https://api.yourdomain.com" > .env

# ثبّت الحزم وابنِ
npm ci
npm run build
```

سيتولّد مجلد `dist/` فيه ملفات جاهزة للرفع.

---

## 5️⃣ رفع `dist/` عبر FileZilla

1. **الجانب الأيسر (Local)**: افتح مجلد `dist/` داخل مشروعك
2. **الجانب الأيمن (Remote)**: تأكد أنك داخل `/var/www/hulul/public/` (المجلد الفارغ)
3. اختر **محتوى** `dist/` بـ Ctrl+A — **ليس المجلد نفسه**
4. اسحب الملفات للجانب الأيمن
5. انتظر اكتمال الرفع (تابع شريط الحالة في الأسفل)

---

## 6️⃣ ضبط الصلاحيات (عبر SSH — ضروري)

```bash
ssh root@VPS_IP
sudo chown -R www-data:www-data /var/www/hulul/public
sudo find /var/www/hulul/public -type d -exec chmod 755 {} \;
sudo find /var/www/hulul/public -type f -exec chmod 644 {} \;
sudo systemctl reload nginx
```

---

## 7️⃣ تحديث Backend (يحتاج SSH — مش FileZilla)

```bash
ssh root@VPS_IP
cd /var/www/hulul/backend
git pull   # لو الكود من GitHub
sudo -u hulul npm ci --omit=dev
sudo -u hulul node db/migrate.js   # لو في migrations جديدة
sudo -u hulul pm2 restart all
```

---

## ✅ التحقق النهائي

افتح في المتصفح:
- 🌐 `https://app.yourdomain.com` → يجب يفتح صفحة تسجيل الدخول الجديدة
- 🔌 `https://api.yourdomain.com/api/health` → `{"ok":true,...}`

> لو ظهرت الصفحة القديمة، اضغط **Ctrl+Shift+R** لمسح الكاش.

---

## 🆘 مشاكل شائعة

| المشكلة | الحل |
|---|---|
| FileZilla يطلب كلمة سر بعد كل ملف | File → Site Manager → Logon Type: **Normal** واحفظ كلمة السر |
| الرفع بطيء جداً | Edit → Settings → Transfers → Maximum simultaneous transfers: **5** |
| ملفات لم تُحذف | لو ملك `www-data` وأنت `root`، احذفها عبر SSH: `sudo rm -rf /var/www/hulul/public/*` |
| الصفحة بيضاء بعد الرفع | افتح Console (F12) — تحقق من `VITE_API_URL` في build وصلاحيات الملفات |
| 403 Forbidden | أعد ضبط الصلاحيات (الخطوة 6) |
