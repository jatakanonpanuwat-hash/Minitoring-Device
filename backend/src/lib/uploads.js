// รับไฟล์อัปโหลด (multer) + บันทึกลง backend/uploads/ — ไฟล์ถูกเสิร์ฟที่ /api/uploads/<ชื่อไฟล์> (ดู src/app.js)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOADS_DIR } = require('../config');

// สร้าง middleware รับไฟล์ 1 ไฟล์ — error (ไฟล์ผิดชนิด/ใหญ่เกิน) ตอบเป็น JSON 400 ให้หน้าเว็บแสดงข้อความได้
function singleFileField({ field, exts, maxBytes, typeError, sizeError }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => {
      if (exts.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
      else cb(new Error(typeError));
    }
  });
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? sizeError : err.message });
    });
  };
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const IMAGE_MAX_MB = 10;
const ICON_MAX_KB = 512;
const XLSX_MAX_MB = 30;

// รูปแผนผัง (field "image")
const uploadImageField = singleFileField({
  field: 'image', exts: IMAGE_EXTS, maxBytes: IMAGE_MAX_MB * 1024 * 1024,
  typeError: 'รองรับเฉพาะไฟล์รูปภาพ .jpg .jpeg .png .gif .webp เท่านั้น',
  sizeError: `ไฟล์ใหญ่เกิน ${IMAGE_MAX_MB}MB`,
});

// ไอคอน/โลโก้ของรายการ (ประเภท/สถานะ/โซน) — ไฟล์เล็ก รองรับ .svg ด้วย (field "image")
const uploadIconField = singleFileField({
  field: 'image', exts: [...IMAGE_EXTS, '.svg'], maxBytes: ICON_MAX_KB * 1024,
  typeError: 'รองรับเฉพาะไฟล์ .png .jpg .jpeg .gif .webp .svg เท่านั้น',
  sizeError: `ไฟล์ไอคอนใหญ่เกิน ${ICON_MAX_KB}KB`,
});

// ไฟล์ Excel (field "file")
const uploadXlsxField = singleFileField({
  field: 'file', exts: ['.xlsx'], maxBytes: XLSX_MAX_MB * 1024 * 1024,
  typeError: 'รองรับเฉพาะไฟล์ .xlsx (Excel) เท่านั้น',
  sizeError: `ไฟล์ใหญ่เกิน ${XLSX_MAX_MB}MB`,
});

// คู่มือการใช้งาน (field "file") — ไฟล์ใหญ่ได้ (วิดีโอ) จึงเขียนลงดิสก์ตรง ๆ ไม่พักในหน่วยความจำ
const TUTORIAL_EXTS = ['.pdf', ...IMAGE_EXTS, '.mp4', '.webm', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt'];
const TUTORIAL_MAX_MB = 300;
const tutorialUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => cb(null, `tutorial-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: TUTORIAL_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (TUTORIAL_EXTS.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error(`รองรับเฉพาะไฟล์ ${TUTORIAL_EXTS.join(' ')}`));
  },
});
function uploadTutorialField(req, res, next) {
  tutorialUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    // ไฟล์ที่เขียนไปครึ่งทาง (เกินขนาด / ตัดการเชื่อมต่อ) multer ลบให้เอง
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${TUTORIAL_MAX_MB}MB` : err.message });
  });
}

// บันทึกไฟล์เป็น <prefix>-<uuid><ext> — คืน { filename, url }
function saveUpload(prefix, ext, buffer) {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${prefix}-${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return { filename, url: `/api/uploads/${filename}` };
}

// ลบไฟล์ที่อยู่ใน uploads ของเรา (url ขึ้นต้น /api/uploads/) — URL ภายนอก/ลบไม่ได้ ข้ามไป
function removeUpload(url, keepFilename) {
  if (!url || !url.startsWith('/api/uploads/')) return;
  const p = path.join(UPLOADS_DIR, path.basename(url));
  if (keepFilename && p === path.join(UPLOADS_DIR, keepFilename)) return;
  try {
    fs.rmSync(p, { force: true });
  } catch {
    /* ลบไม่ได้ก็ข้ามไป */
  }
}

module.exports = {
  uploadImageField, uploadIconField, uploadXlsxField, uploadTutorialField, TUTORIAL_EXTS, TUTORIAL_MAX_MB,
  saveUpload, removeUpload,
};
