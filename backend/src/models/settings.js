// ค่าตั้งระบบ (ตาราง settings / mem.settings) — key/value เป็น string ทั้งหมด
// เพิ่มค่าตั้งใหม่: ใส่ค่าเริ่มต้นใน SETTING_DEFAULTS
//   ถ้าให้หน้าเว็บอ่าน/แก้ได้ ใส่ใน PUBLIC_SETTINGS ของ src/routes/settings.js ด้วย
const { USE_DB } = require('../config');
const { mem } = require('../db/memory');
const { query } = require('../db/mariadb');

const SETTING_DEFAULTS = {
  MONITOR_ENABLED: 'TRUE',
  MONITOR_INTERVAL_SEC: '60',   // ping ทุกกี่วินาที
  MONITOR_TIMEOUT_MS: '1000',   // รอ reply นานสุดต่อครั้ง
  MONITOR_FAIL_THRESHOLD: '2',  // ping ไม่ผ่านติดกันกี่รอบถึงนับว่า offline
  MONITOR_WARN_MS: '200',       // latency เกินนี้ = warning
  MONITOR_TYPES: '',            // ประเภทอุปกรณ์ที่ ping (key คั่นด้วย , ) — ว่าง = ทุกประเภท
  XLSX_AUTO_SYNC: 'TRUE',       // เฝ้าไฟล์ Excel ในโปรเจกต์ เปลี่ยนเมื่อไหร่นำเข้าใหม่
  XLSX_LAST_HASH: '',           // (ภายใน) hash ของไฟล์ที่ซิงก์ล่าสุด
  TELEGRAM_ENABLED: 'FALSE',    // แจ้งเตือน Telegram เมื่ออุปกรณ์ offline
  TELEGRAM_BOT_TOKEN: '',       // token จาก @BotFather (ลับ — ไม่ส่งกลับไปที่หน้าเว็บ)
  TELEGRAM_CHAT_ID: '',         // chat id ของกลุ่ม/คน ที่จะส่งข้อความไป
  TELEGRAM_NOTIFY_RECOVERY: 'TRUE' // แจ้งด้วยเมื่อกลับมา online
  // (ภายใน, ไม่มีค่าเริ่มต้น) CATALOG_TYPES / CATALOG_STATUSES / CATALOG_ZONES — ดู models/catalog.js
  // (ภายใน) AUTH_SIGN_KEY — ดู src/auth.js, MIGRATED_CCTV — ดู db/schema.js
};

async function getSetting(key) {
  if (!USE_DB) return mem.settings[key] !== undefined ? mem.settings[key] : (SETTING_DEFAULTS[key] || '');
  const rows = await query('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  if (rows[0]) return rows[0].value || '';
  return SETTING_DEFAULTS[key] || '';
}

async function setSetting(key, value) {
  if (!USE_DB) {
    mem.settings[key] = value;
    return;
  }
  await query('INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [key, value]);
}

// อ่านเป็นตัวเลข บีบให้อยู่ในช่วง [min, max] — ค่าเสียใช้ค่าเริ่มต้น
async function getIntSetting(key, min, max) {
  const n = parseInt(await getSetting(key), 10);
  const fallback = parseInt(SETTING_DEFAULTS[key], 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max);
}

module.exports = { SETTING_DEFAULTS, getSetting, setSetting, getIntSetting };
