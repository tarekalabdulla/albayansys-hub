// رفع الملفات (الصور الشخصية) باستخدام multer — تخزين على القرص داخل /uploads/avatars
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const AVATARS_DIR = path.join(UPLOADS_ROOT, "avatars");

// تأكد من وجود المجلدات
fs.mkdirSync(AVATARS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".png").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext) ? ext : ".png";
    const uid = req.user?.sub || "anon";
    const rand = crypto.randomBytes(6).toString("hex");
    cb(null, `${uid}-${Date.now()}-${rand}${safeExt}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
    return cb(new Error("invalid_file_type"));
  }
  cb(null, true);
}

export const uploadAvatar = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

export const PATHS = { UPLOADS_ROOT, AVATARS_DIR };

// حذف ملف من القرص بأمان (لو URL يبدأ بـ /uploads/...)
export function deleteUploadedFile(publicUrl) {
  if (!publicUrl || typeof publicUrl !== "string") return;
  if (!publicUrl.startsWith("/uploads/")) return;
  const rel = publicUrl.replace(/^\/uploads\//, "");
  const full = path.join(UPLOADS_ROOT, rel);
  // تأكد ضمن المجلد
  if (!full.startsWith(UPLOADS_ROOT)) return;
  fs.promises.unlink(full).catch(() => { /* ignore */ });
}
