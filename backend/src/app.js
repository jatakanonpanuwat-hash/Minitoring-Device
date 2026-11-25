// ประกอบ Express app: middleware → เสิร์ฟไฟล์ → login (auth) → routes
// เพิ่มกลุ่ม API ใหม่: สร้างไฟล์ใน src/routes/ แล้วเพิ่มในรายการ ROUTES ด้านล่าง
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { BASE, USE_DB, ADMIN_SECRET, BUILD_PATH, UPLOADS_DIR } = require('./config');
const { mem } = require('./db/memory');
const { query } = require('./db/mariadb');
const { getSetting, setSetting } = require('./models/settings');
const { addLog } = require('./models/logs');
const createAuth = require('./auth');

const ROUTES = [
  require('./routes/system'),
  require('./routes/devices'),
  require('./routes/import'),
  require('./routes/monitor'),
  require('./routes/catalog'),
  require('./routes/maps'),
  require('./routes/logs'),
  require('./routes/settings'),
  require('./routes/tutorials'),
];

const app = express();

// ---------- middleware ----------
// เปิดตรง port 5000 (ไม่มี reverse proxy) frontend จะเรียก /monitoring-device/api/... — ตัด base ออกแบบเดียวกับ vite proxy
app.use((req, res, next) => {
  if (req.url.startsWith(`${BASE}/api/`)) req.url = req.url.slice(BASE.length);
  next();
});
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ไฟล์ที่อัปโหลด (รูปแผนผัง / ไอคอน)
// CSP sandbox: ไฟล์ที่อัปโหลด (รวม .svg ของไอคอน) ห้ามรันสคริปต์แม้เปิด URL ตรง ๆ
// ยกเว้น PDF ของคู่มือ (tutorial-*.pdf): Chrome ไม่ยอมแสดง PDF ในหน้าที่ติด sandbox — ตัวเปิด PDF ของเบราว์เซอร์ไม่รันสคริปต์ในไฟล์อยู่แล้ว
app.use('/api/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (/^tutorial-[0-9a-f-]+\.pdf$/i.test(path.basename(filePath))) return;
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
}));

// ---------- frontend ที่ build แล้ว + SPA fallback ----------
// ใช้ตอนรันโดยไม่มี reverse proxy (เปิดตรง port 5000) — frontend build ไปที่ backend/build (ดู frontend/vite.config.ts)
if (fs.existsSync(BUILD_PATH)) {
  app.use(BASE, express.static(BUILD_PATH));
  app.get(BASE, (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
  app.get(`${BASE}/*`, (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
}

// ---------- login / ผู้ใช้ ----------
// auth.js ติดตั้ง middleware อ่านตัวตน (identify) + route /api/auth/*, /api/users ให้เอง — ต้องอยู่ก่อน routes อื่น
const auth = createAuth({
  app, USE_DB, ADMIN_SECRET, memUsers: mem.users,
  query, getSetting, setSetting, addLog,
});

// สิทธิ์ที่ส่งให้ทุกไฟล์ใน routes/: requireAdmin = Admin, requireEditor = Editor ขึ้นไป (login หรือ x-admin-secret)
const guards = { requireAdmin: auth.requireAdminRole, requireEditor: auth.requireEditor, auth };
for (const createRoutes of ROUTES) app.use(createRoutes(guards));

module.exports = { app, auth };
