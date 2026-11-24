// ค่าตั้งทั้งหมดที่อ่านจาก environment (.env) — ที่เดียวที่อ่าน process.env ของ server
// ดูตัวอย่างค่าได้ที่ backend/.env.example
require('dotenv').config();
const path = require('path');

// โฟลเดอร์ backend/ (ไฟล์นี้อยู่ใน backend/src/) — ทุก path อ้างจากที่นี่ ไม่ขึ้นกับ working directory
const BACKEND_DIR = path.resolve(__dirname, '..');

module.exports = {
  BACKEND_DIR,
  PORT: process.env.PORT || 5000,

  // base path ของเว็บ — ต้องตรงกับ frontend/vite.config.ts (base) และ frontend/src/app/routes.tsx
  BASE: '/monitoring-device',

  // รหัสผู้ดูแล: ไม่ได้ตั้ง = ไม่ต้องใส่รหัส (ทุกคนที่เปิดเว็บได้แก้ข้อมูลได้ จนกว่าจะสร้างผู้ใช้คนแรก)
  // ตั้งเมื่อไหร่ งานที่แก้ข้อมูลต้องส่ง header x-admin-secret ให้ตรง (ดู src/auth.js)
  ADMIN_SECRET: process.env.ADMIN_SECRET || '',

  // มี DB_USER + DB_NAME = ใช้ MariaDB, ไม่มี = เก็บใน RAM + ไฟล์ STORE_FILE (ดู src/db/memory.js)
  USE_DB: !!(process.env.DB_USER && process.env.DB_NAME),
  DB: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  },
  // STORE_FILE=off = ไม่บันทึกลงไฟล์ (ข้อมูลหายเมื่อ restart)
  STORE_FILE: process.env.STORE_FILE === 'off'
    ? null
    : path.resolve(BACKEND_DIR, process.env.STORE_FILE || path.join('data', 'store.json')),

  // frontend ที่ build แล้ว (npm run build ใน frontend/ เขียนมาที่นี่) และไฟล์ที่อัปโหลด
  BUILD_PATH: path.join(BACKEND_DIR, 'build'),
  UPLOADS_DIR: path.join(BACKEND_DIR, 'uploads'),

  // ไฟล์ Excel ประจำโปรเจกต์ (ซิงก์อัตโนมัติ / ปุ่ม "ใช้ไฟล์ในโปรเจกต์") — XLSX_WATCH=off ปิดการเฝ้าไฟล์
  XLSX_FILE: path.resolve(BACKEND_DIR, process.env.XLSX_FILE || 'data/CCTV-MECHA-PART.xlsx'),
  XLSX_WATCH: process.env.XLSX_WATCH !== 'off',
};
