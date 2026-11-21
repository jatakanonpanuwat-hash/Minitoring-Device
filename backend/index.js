require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
const BASE = '/monitoring-device';

// รหัสผู้ดูแล: ไม่ได้ตั้ง ADMIN_SECRET ใน .env = ไม่ต้องใส่รหัส (ทุกคนที่เปิดเว็บได้แก้ข้อมูลได้)
// ตั้ง ADMIN_SECRET เมื่อไหร่ งานที่แก้ข้อมูลต้องส่ง header x-admin-secret ให้ตรง
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
if (!ADMIN_SECRET) {
  console.warn('[config] ไม่ได้ตั้ง ADMIN_SECRET — ปิดการใส่รหัสผู้ดูแล (ทุกคนแก้ข้อมูลได้)');
}

// Fix BigInt JSON serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

// ========== MIDDLEWARE ==========
// เปิดตรง port 5000 (ไม่มี reverse proxy) frontend จะเรียก /monitoring-device/api/... — ตัด base ออกแบบเดียวกับ vite proxy
app.use((req, res, next) => {
  if (req.url.startsWith(`${BASE}/api/`)) req.url = req.url.slice(BASE.length);
  next();
});
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// เสิร์ฟไฟล์ในโฟลเดอร์ uploads (อ้างจากที่อยู่ของไฟล์นี้ ไม่ขึ้นกับ working directory)
// CSP sandbox: ไฟล์ที่อัปโหลด (รวม .svg ของไอคอน) ห้ามรันสคริปต์แม้เปิด URL ตรง ๆ
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
}));

// สิทธิ์: ดู auth.js — requireAdmin = Admin, requireEditor = Editor ขึ้นไป (login หรือ x-admin-secret)
function requireAdmin(req, res, next) {
  return auth.requireAdminRole(req, res, next);
}
function requireEditor(req, res, next) {
  return auth.requireEditor(req, res, next);
}

// ========== Multer config ==========
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const IMAGE_MAX_MB = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (IMAGE_TYPES[ext]) {
      cb(null, true);
    } else {
      cb(new Error('รองรับเฉพาะไฟล์รูปภาพ .jpg .jpeg .png .gif .webp เท่านั้น'));
    }
  }
});

// error ของ multer (ไฟล์ผิดชนิด/ใหญ่เกิน) ตอบเป็น JSON 400 ให้ frontend แสดงข้อความได้
function uploadImageField(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${IMAGE_MAX_MB}MB` : err.message;
    res.status(400).json({ error: message });
  });
}

// ไอคอน/โลโก้ของรายการ (ประเภท/สถานะ/โซน) — ไฟล์เล็ก รองรับ .svg ด้วย
const ICON_TYPES = { ...IMAGE_TYPES, '.svg': 'image/svg+xml' };
const ICON_MAX_KB = 512;
const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ICON_MAX_KB * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ICON_TYPES[ext]) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ .png .jpg .jpeg .gif .webp .svg เท่านั้น'));
  }
});

function uploadIconField(req, res, next) {
  iconUpload.single('image')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ไอคอนใหญ่เกิน ${ICON_MAX_KB}KB` : err.message;
    res.status(400).json({ error: message });
  });
}

// ========== STATIC FILE SERVING + SPA FALLBACK ==========
// ใช้ตอนรันโดยไม่มี reverse proxy (เปิดตรง port 5000) — frontend build ไปที่ backend/build (ดู vite.config.ts)
const BUILD_PATH = path.join(__dirname, 'build');
if (fs.existsSync(BUILD_PATH)) {
  app.use(BASE, express.static(BUILD_PATH));

  app.get(BASE, (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
  app.get(`${BASE}/*`, (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
}

// ========== STORAGE: MariaDB หรือ in-memory + ไฟล์ ==========
// ถ้าไม่ได้ตั้งค่า DB (ไม่มี .env หรือไม่มี DB_USER/DB_NAME) จะเก็บข้อมูลใน RAM
// และบันทึกลงไฟล์ data/store.json อัตโนมัติ — restart แล้วข้อมูลยังอยู่ (ตั้ง STORE_FILE=off เพื่อปิด)
const USE_DB = !!(process.env.DB_USER && process.env.DB_NAME);
let pool = null;
const memDevices = [];
const memMaps = [];
const memLogs = [];
const memSettings = {};
const memIpRows = [];     // TABLE_IP (iptable.js)
const memIpUpdates = [];  // TABLE_IP_UPDATES (iptable.js)
const memUsers = [];      // บัญชีผู้ใช้ (auth.js)
const memDeviceSnapshots = []; // สแนปช็อตรายการอุปกรณ์รายปี { year, created_at, created_by, device_count, devices }

const STORE_FILE = process.env.STORE_FILE === 'off'
  ? null
  : path.resolve(__dirname, process.env.STORE_FILE || path.join('data', 'store.json'));
let lastSaved = '';

function storeSnapshot() {
  return JSON.stringify({
    devices: memDevices, maps: memMaps, logs: memLogs, settings: memSettings,
    ip_rows: memIpRows, ip_updates: memIpUpdates, users: memUsers, device_snapshots: memDeviceSnapshots
  });
}

function loadStore() {
  if (!STORE_FILE || !fs.existsSync(STORE_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    memDevices.push(...(data.devices || []));
    memMaps.push(...(data.maps || []));
    memLogs.push(...(data.logs || []));
    Object.assign(memSettings, data.settings || {});
    memIpRows.push(...(data.ip_rows || []));
    memIpUpdates.push(...(data.ip_updates || []));
    memUsers.push(...(data.users || []));
    memDeviceSnapshots.push(...(data.device_snapshots || []));
    lastSaved = storeSnapshot();
    console.log(`[store] โหลดข้อมูลจาก ${STORE_FILE}: อุปกรณ์ ${memDevices.length}, แผนผัง ${memMaps.length}, ประวัติ ${memLogs.length}, TABLE_IP ${memIpRows.length}`);
  } catch (err) {
    // ไฟล์เสีย — เก็บสำรองไว้ ไม่เขียนทับ แล้วเริ่มจากว่าง
    const backup = `${STORE_FILE}.broken-${Date.now()}`;
    fs.copyFileSync(STORE_FILE, backup);
    console.error(`[store] อ่าน ${STORE_FILE} ไม่ได้ (${err.message}) — สำรองไว้ที่ ${backup}`);
  }
}

// เขียนเมื่อข้อมูลเปลี่ยนเท่านั้น — เขียนไฟล์ชั่วคราวแล้ว rename กันไฟล์เสียถ้าปิดกลางคัน
function saveStore() {
  if (!STORE_FILE) return;
  const text = storeSnapshot();
  if (text === lastSaved) return;
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, STORE_FILE);
    lastSaved = text;
  } catch (err) {
    console.error('[store] บันทึกไม่สำเร็จ:', err.message);
  }
}

if (!USE_DB) {
  if (STORE_FILE) {
    console.warn(`[config] ไม่พบค่า DB (.env) — เก็บข้อมูลในไฟล์ ${STORE_FILE}`);
    loadStore();
    setInterval(saveStore, 3000).unref();
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGUSR2']) {
      process.once(sig, () => {
        saveStore();
        process.kill(process.pid, sig);
      });
    }
  } else {
    console.warn('[config] ไม่พบค่า DB (.env) และปิด STORE_FILE — ข้อมูลจะหายเมื่อ restart');
  }
}

async function query(sql, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(sql, params);
    return result;
  } catch (err) {
    console.error('Database query error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// ========== LOGIN / ผู้ใช้ ==========
const auth = require('./auth')({
  app, USE_DB, ADMIN_SECRET, memUsers,
  query: (...a) => query(...a),
  getSetting: (...a) => getSetting(...a),
  setSetting: (...a) => setSetting(...a),
  addLog: (...a) => addLog(...a),
});
// (auth.js ติดตั้ง middleware อ่านตัวตนให้เองก่อน route ทั้งหมด)

// ========== TABLE_IP / NVR ==========
const ipTable = require('./iptable')({
  app, requireAdmin: requireEditor, USE_DB,
  query: (...a) => query(...a),
  getSetting: (...a) => getSetting(...a),
  addLog: (...a) => addLog(...a),
  memIpRows, memIpUpdates
});

// ========== DEVICE SCHEMA ==========
// ประเภท / สถานะ / โซน ผู้ดูแลกำหนดเองได้ — ดู "CATALOG" ด้านล่าง

// คอลัมน์ที่ตาราง devices ต้องมี — ใช้ทั้งสร้างตารางใหม่และเติมคอลัมน์ให้ตาราง devices รุ่นเก่า
const DEVICE_COLUMNS = {
  device_type:     "VARCHAR(30) NOT NULL DEFAULT 'other'",
  zone:            'VARCHAR(100)',
  floor:           'VARCHAR(50)',
  x_percent:       'DECIMAL(6,3)',
  y_percent:       'DECIMAL(6,3)',
  ip_address:      'VARCHAR(100)',
  mac_address:     'VARCHAR(50)',
  brand:           'VARCHAR(100)',
  model:           'VARCHAR(100)',
  serial_no:       'VARCHAR(100)',
  monitor_enabled: 'TINYINT(1) NOT NULL DEFAULT 1',
  last_latency_ms: 'DECIMAL(10,2)',
  last_checked:    'DATETIME',
  fail_count:      'INT NOT NULL DEFAULT 0',
  remark:          'TEXT',
  map_id:          'VARCHAR(100)',
  direction:       'DECIMAL(6,2)',
  fov_angle:       'DECIMAL(6,2)',
  lan:             'VARCHAR(50)',
  cabinet:         'VARCHAR(50)',
  install_area:    'VARCHAR(200)',
  install_detail:  'TEXT',
  requested_by:    'VARCHAR(200)',
  updated_at:      'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  updated_by:      'VARCHAR(200)',
  hide_on_map:     'TINYINT(1) NOT NULL DEFAULT 0'  // 1 = ตั้งใจไม่วางบนแผนผัง (ไม่นับเป็น "ยังไม่วาง")
};

// ฟิลด์ที่ client แก้ได้ (สถานะ ping/last_seen ระบบเป็นคนเขียน)
const DEVICE_FIELDS = ['name', 'device_type', 'zone', 'floor', 'x_percent', 'y_percent', 'ip_address',
  'mac_address', 'brand', 'model', 'serial_no', 'status', 'monitor_enabled', 'remark', 'map_id',
  'direction', 'fov_angle', 'lan', 'cabinet', 'install_area', 'install_detail', 'requested_by', 'updated_by',
  'hide_on_map'];

// ========== DB INIT ==========
async function initDB() {
  if (!USE_DB) return;
  pool = mariadb.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    acquireTimeout: 30000,
    timezone: '+07:00'
  });
  await query(`
    CREATE TABLE IF NOT EXISTS devices (
      id         VARCHAR(36)  NOT NULL PRIMARY KEY,
      name       VARCHAR(200) NOT NULL,
      location   VARCHAR(200),
      status     VARCHAR(20)  NOT NULL DEFAULT 'unknown',
      last_seen  DATETIME,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // ตาราง devices รุ่นแรกมีแค่ name/location/status — เติมคอลัมน์ที่ขาด
  for (const [col, def] of Object.entries(DEVICE_COLUMNS)) {
    await query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS ${col} ${def}`);
  }
  await query(`
    CREATE TABLE IF NOT EXISTS maps (
      map_id    VARCHAR(100) NOT NULL PRIMARY KEY,
      map_name  VARCHAR(200) NOT NULL,
      image_url VARCHAR(500) NOT NULL,
      floor     VARCHAR(50)
    )
  `);
  await query('ALTER TABLE maps ADD COLUMN IF NOT EXISTS floor VARCHAR(50)');
  await query(`
    CREATE TABLE IF NOT EXISTS logs (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      timestamp     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      employee_id   VARCHAR(50),
      employee_name VARCHAR(200),
      action        VARCHAR(50)  NOT NULL,
      device_id     VARCHAR(36),
      device_name   VARCHAR(200),
      zone          VARCHAR(100),
      floor         VARCHAR(50),
      details       TEXT,
      old_values    TEXT,
      new_values    TEXT
    )
  `);
  await query('ALTER TABLE logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(36)');
  await query('ALTER TABLE logs ADD COLUMN IF NOT EXISTS device_name VARCHAR(200)');
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\`   VARCHAR(100) NOT NULL PRIMARY KEY,
      \`value\` TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS device_snapshots (
      year         INT          NOT NULL PRIMARY KEY,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by   VARCHAR(200),
      device_count INT          NOT NULL DEFAULT 0,
      data         LONGTEXT
    )
  `);
  await migrateFromCctv();
  await ipTable.initDB();
  await auth.initDB();
}

// ย้ายข้อมูลจากระบบ CCTV เดิม (ตาราง cameras + logs.camera_*) มาเป็นอุปกรณ์ประเภท camera — ทำครั้งเดียว
// ตาราง cameras เดิมไม่ถูกลบ เก็บไว้เป็นสำรอง
async function migrateFromCctv() {
  if ((await getSetting('MIGRATED_CCTV')) === 'TRUE') return;
  const tables = await query("SHOW TABLES LIKE 'cameras'");
  if (tables.length > 0) {
    const cols = ['id', 'name', 'zone', 'floor', 'x_percent', 'y_percent', 'ip_address', 'model', 'status',
      'remark', 'map_id', 'direction', 'fov_angle', 'lan', 'cabinet', 'install_area', 'install_detail',
      'requested_by', 'updated_by'];
    const res = await query(
      `INSERT IGNORE INTO devices (${cols.join(', ')}, device_type)
       SELECT ${cols.join(', ')}, 'camera' FROM cameras`
    );
    console.log(`[migrate] ย้ายกล้องจาก CCTV เดิมเป็นอุปกรณ์ ${res.affectedRows} รายการ`);
  }
  const logCols = await query("SHOW COLUMNS FROM logs LIKE 'camera_id'");
  if (logCols.length > 0) {
    await query('UPDATE logs SET device_id = camera_id, device_name = camera_name WHERE device_id IS NULL AND camera_id IS NOT NULL');
  }
  await setSetting('MIGRATED_CCTV', 'TRUE');
}

async function pingStore() {
  if (!USE_DB) return true;
  await query('SELECT 1');
  return true;
}

// ---------- bulk replace (ใช้โดย import endpoints) ----------
// ฟิลด์อุปกรณ์ที่รับจากสคริปต์ import — ตรงกับคอลัมน์ตาราง devices (ไม่มี rtsp_url แบบ migrateFromCctv)
const DEVICE_IMPORT_FIELDS = ['id', 'name', 'device_type', 'zone', 'floor', 'x_percent', 'y_percent',
  'ip_address', 'model', 'status', 'remark', 'map_id', 'direction', 'fov_angle', 'lan', 'cabinet',
  'install_area', 'install_detail', 'requested_by', 'updated_by'];

function cleanDeviceRow(row, validStatuses, type) {
  if (!row || !row.id) return null;
  const out = { id: String(row.id), device_type: type };
  for (const f of DEVICE_IMPORT_FIELDS) {
    if (f === 'id' || f === 'device_type') continue;
    let v = row[f];
    if (v === undefined || v === '') v = null;
    out[f] = v;
  }
  if (!out.name) out.name = out.id;
  if (!out.status || !validStatuses.has(out.status)) out.status = 'unknown';
  return out;
}

async function bulkInsert(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const placeholders = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
    const values = chunk.flatMap((r) => cols.map((c) => r[c] !== undefined ? r[c] : null));
    await query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${placeholders}`, values);
  }
}

// สถานะ relocated จาก Sheet เดิม — เพิ่มเข้ารายการสถานะถ้ายังไม่มี (ยังถูก ping ตามปกติ)
async function ensureRelocatedStatus() {
  const saved = parseJson(await getSetting('CATALOG_STATUSES')) || [];
  if (saved.some((s) => s.key === 'relocated')) return;
  saved.push({ key: 'relocated', label: 'Relocated', color: '#6b7280', icon: '', pause_monitor: false });
  await setSetting('CATALOG_STATUSES', JSON.stringify(saved));
}

async function replaceDevicesByType(type, rows) {
  await ensureRelocatedStatus();
  const catalog = await getCatalog();
  const validStatuses = new Set(catalog.statuses.map((s) => s.key));
  const clean = rows.map((r) => cleanDeviceRow(r, validStatuses, type)).filter(Boolean);
  for (const z of new Set(clean.map((d) => d.zone).filter(Boolean))) await ensureZone(z);
  if (!USE_DB) {
    for (let i = memDevices.length - 1; i >= 0; i--) {
      if (memDevices[i].device_type === type) memDevices.splice(i, 1);
    }
    const now = new Date().toISOString();
    memDevices.push(...clean.map((d) => ({
      status: 'unknown', monitor_enabled: 1, fail_count: 0,
      last_seen: null, last_checked: null, last_latency_ms: null,
      created_at: now, updated_at: now, ...d
    })));
    return { imported: clean.length, skipped: rows.length - clean.length };
  }
  await query('DELETE FROM devices WHERE device_type = ?', [type]);
  if (clean.length > 0) await bulkInsert('devices', DEVICE_IMPORT_FIELDS, clean);
  return { imported: clean.length, skipped: rows.length - clean.length };
}

async function replaceAllMaps(rows) {
  const clean = rows
    .filter((r) => r && r.map_id && r.image_url)
    .map((r) => ({
      map_id: String(r.map_id), map_name: String(r.map_name || r.map_id), image_url: String(r.image_url),
      floor: r.floor ? String(r.floor).trim().slice(0, 50) || null : null,
    }));
  if (!USE_DB) {
    memMaps.length = 0;
    memMaps.push(...clean);
    return { imported: clean.length, skipped: rows.length - clean.length };
  }
  await query('DELETE FROM maps');
  if (clean.length > 0) await bulkInsert('maps', ['map_id', 'map_name', 'image_url', 'floor'], clean);
  return { imported: clean.length, skipped: rows.length - clean.length };
}

const LOG_IMPORT_FIELDS = ['timestamp', 'employee_id', 'employee_name', 'action', 'device_id',
  'device_name', 'zone', 'floor', 'details', 'old_values', 'new_values'];

async function replaceAllLogs(rows) {
  const clean = rows
    .filter((r) => r && r.action)
    .map((r) => {
      const out = {};
      for (const f of LOG_IMPORT_FIELDS) {
        let v = r[f];
        if (v === undefined || v === '') v = null;
        if ((f === 'old_values' || f === 'new_values') && v && typeof v !== 'string') v = JSON.stringify(v);
        out[f] = v;
      }
      return out;
    });
  if (!USE_DB) {
    memLogs.length = 0;
    clean.forEach((r, i) => memLogs.push({ id: i + 1, ...r }));
    return { imported: clean.length, skipped: rows.length - clean.length };
  }
  await query('DELETE FROM logs');
  await query('ALTER TABLE logs AUTO_INCREMENT = 1');
  if (clean.length > 0) await bulkInsert('logs', LOG_IMPORT_FIELDS, clean);
  return { imported: clean.length, skipped: rows.length - clean.length };
}

// ---------- device store (API เดียวกันทั้ง 2 โหมด) ----------
// เลือกเฉพาะฟิลด์ที่แก้ได้ + เช็คประเภท/สถานะกับรายการที่ผู้ดูแลกำหนด
async function pickDeviceFields(body) {
  const out = {};
  for (const f of DEVICE_FIELDS) {
    if (body[f] !== undefined) out[f] = body[f] === '' ? null : body[f];
  }
  const catalog = await getCatalog();
  if (out.device_type !== undefined) {
    const types = catalog.types.map((t) => t.key);
    if (!types.includes(out.device_type)) out.device_type = types.includes('other') ? 'other' : types[types.length - 1];
  }
  if (out.status !== undefined && !catalog.statuses.some((s) => s.key === out.status)) delete out.status;
  if (out.zone) {
    out.zone = String(out.zone).trim().slice(0, 60);
    if (!KEY_RE.test(out.zone)) out.zone = null;
    else await ensureZone(out.zone);
  }
  if (out.monitor_enabled !== undefined) out.monitor_enabled = out.monitor_enabled ? 1 : 0;
  if (out.ip_address) out.ip_address = String(out.ip_address).trim();
  if (out.hide_on_map !== undefined) out.hide_on_map = out.hide_on_map && out.hide_on_map !== 'false' && out.hide_on_map !== '0' ? 1 : 0;
  if (out.hide_on_map === 1) {
    // ไม่แสดงบนแผนผัง = ไม่มีตำแหน่ง
    out.x_percent = null;
    out.y_percent = null;
    out.map_id = null;
  } else if (out.hide_on_map === undefined && out.x_percent != null && out.y_percent != null) {
    // วางลงแผนผัง → ยกเลิก "ไม่แสดงบนแผนผัง" อัตโนมัติ
    out.hide_on_map = 0;
  }
  return out;
}

// DB คืน DECIMAL/TINYINT เป็น string/number — แปลงให้ frontend ใช้ตรง ๆ
function normalizeDevice(d) {
  if (!d) return d;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    ...d,
    x_percent: num(d.x_percent),
    y_percent: num(d.y_percent),
    direction: num(d.direction),
    fov_angle: num(d.fov_angle),
    last_latency_ms: num(d.last_latency_ms),
    fail_count: Number(d.fail_count || 0),
    monitor_enabled: !!Number(d.monitor_enabled),
    hide_on_map: !!Number(d.hide_on_map || 0)
  };
}

async function listDevices(mapId) {
  if (!USE_DB) {
    const rows = mapId ? memDevices.filter((d) => d.map_id === mapId) : memDevices;
    return rows.map(normalizeDevice).sort((a, b) => a.name.localeCompare(b.name));
  }
  const rows = mapId
    ? await query('SELECT * FROM devices WHERE map_id = ? ORDER BY name', [mapId])
    : await query('SELECT * FROM devices ORDER BY name');
  return (Array.isArray(rows) ? rows : []).map(normalizeDevice);
}

// ---------- device snapshots (สแนปช็อตรายการอุปกรณ์รายปี) ----------
const snapYearOf = (v) => {
  const y = parseInt(v, 10);
  return y >= 2000 && y <= 2100 ? y : null;
};

async function listSnapshotYears() {
  if (!USE_DB) {
    return memDeviceSnapshots
      .map((s) => ({
        year: s.year,
        count: Array.isArray(s.devices) ? s.devices.length : (s.device_count || 0),
        created_at: s.created_at,
        created_by: s.created_by || null,
      }))
      .sort((a, b) => b.year - a.year);
  }
  const rows = await query('SELECT year, device_count, created_at, created_by FROM device_snapshots ORDER BY year DESC');
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    year: Number(r.year), count: Number(r.device_count || 0), created_at: r.created_at, created_by: r.created_by || null,
  }));
}

async function getSnapshot(year) {
  if (!USE_DB) {
    const s = memDeviceSnapshots.find((x) => x.year === year);
    if (!s) return null;
    const devices = Array.isArray(s.devices) ? s.devices : [];
    return { year: s.year, created_at: s.created_at, created_by: s.created_by || null, devices: devices.map(normalizeDevice) };
  }
  const rows = await query('SELECT year, created_at, created_by, data FROM device_snapshots WHERE year = ?', [year]);
  if (!rows[0]) return null;
  let devices = [];
  try {
    const parsed = JSON.parse(rows[0].data || '[]');
    devices = Array.isArray(parsed) ? parsed : [];
  } catch { devices = []; }
  return { year: Number(rows[0].year), created_at: rows[0].created_at, created_by: rows[0].created_by || null, devices: devices.map(normalizeDevice) };
}

async function saveSnapshot(year, devices, by) {
  const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (!USE_DB) {
    const rec = { year, created_at, created_by: by || null, device_count: devices.length, devices };
    const i = memDeviceSnapshots.findIndex((x) => x.year === year);
    if (i >= 0) memDeviceSnapshots[i] = rec;
    else memDeviceSnapshots.push(rec);
    return rec;
  }
  await query(
    `INSERT INTO device_snapshots (year, created_at, created_by, device_count, data) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE created_at = VALUES(created_at), created_by = VALUES(created_by),
     device_count = VALUES(device_count), data = VALUES(data)`,
    [year, created_at, by || null, devices.length, JSON.stringify(devices)]
  );
  return { year, created_at, created_by: by || null, device_count: devices.length };
}

async function getDevice(id) {
  if (!USE_DB) {
    const d = memDevices.find((x) => x.id === id);
    return d ? normalizeDevice({ ...d }) : null;
  }
  const rows = await query('SELECT * FROM devices WHERE id = ?', [id]);
  return normalizeDevice(rows[0]) || null;
}

async function createDevice(data, forcedId = null) {
  // forcedId: กู้คืนอุปกรณ์ที่ถูกลบด้วย id เดิม (เลิกทำการลบ) — ประวัติใน logs ยังผูกกับตัวเดิม
  const id = forcedId || crypto.randomUUID();
  if (!USE_DB) {
    const now = new Date().toISOString();
    memDevices.push({
      id, device_type: 'other', status: 'unknown', monitor_enabled: 1, fail_count: 0,
      last_seen: null, last_checked: null, last_latency_ms: null,
      created_at: now, updated_at: now, ...data
    });
    return getDevice(id);
  }
  const cols = ['id', ...Object.keys(data)];
  await query(`INSERT INTO devices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, [id, ...Object.values(data)]);
  return getDevice(id);
}

async function updateDevice(id, data) {
  if (!USE_DB) {
    const d = memDevices.find((x) => x.id === id);
    if (!d) return null;
    Object.assign(d, data, { updated_at: new Date().toISOString() });
    return getDevice(id);
  }
  const keys = Object.keys(data);
  if (keys.length === 0) return getDevice(id);
  await query(`UPDATE devices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(data), id]);
  return getDevice(id);
}

// เขียนผล ping — ไม่แตะ updated_at (ไม่ใช่การแก้ไขโดยคน)
async function writeMonitorResult(id, data) {
  if (!USE_DB) {
    const d = memDevices.find((x) => x.id === id);
    if (d) Object.assign(d, data);
    return;
  }
  const keys = Object.keys(data);
  await query(
    `UPDATE devices SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = updated_at WHERE id = ?`,
    [...Object.values(data), id]
  );
}

async function deleteDeviceRow(id) {
  if (!USE_DB) {
    const i = memDevices.findIndex((d) => d.id === id);
    if (i !== -1) memDevices.splice(i, 1);
    return;
  }
  await query('DELETE FROM devices WHERE id = ?', [id]);
}

// ---------- map store ----------
async function listMaps() {
  // เรียงตามชื่อเหมือนโหมด MariaDB (ORDER BY map_name)
  if (!USE_DB) return [...memMaps].sort((a, b) => String(a.map_name).localeCompare(String(b.map_name)));
  const rows = await query('SELECT * FROM maps ORDER BY map_name');
  return Array.isArray(rows) ? rows : [];
}

async function saveMap({ map_id, map_name, image_url, floor }) {
  if (!USE_DB) {
    const existing = memMaps.find((m) => m.map_id === map_id);
    if (existing) {
      if (map_name) existing.map_name = map_name;
      if (image_url) existing.image_url = image_url;
      if (floor !== undefined) existing.floor = floor;
      return existing;
    }
    const map = { map_id, map_name, image_url, floor: floor ?? null };
    memMaps.push(map);
    return map;
  }
  await query(
    `INSERT INTO maps (map_id, map_name, image_url, floor) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE map_name = VALUES(map_name), image_url = VALUES(image_url), floor = VALUES(floor)`,
    [map_id, map_name, image_url, floor ?? null]
  );
  const rows = await query('SELECT * FROM maps WHERE map_id = ?', [map_id]);
  return rows[0];
}

async function deleteMapRow(map_id) {
  if (!USE_DB) {
    const i = memMaps.findIndex((m) => m.map_id === map_id);
    if (i !== -1) memMaps.splice(i, 1);
    return;
  }
  await query('DELETE FROM maps WHERE map_id = ?', [map_id]);
}

// ---------- log store ----------
const LOG_COLUMNS = 'id, timestamp, employee_id, employee_name, action, device_id, device_name, zone, floor, details, old_values, new_values';

async function listLogs({ limit = 200, deviceId = null } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  if (!USE_DB) {
    const rows = deviceId ? memLogs.filter((l) => l.device_id === deviceId) : memLogs;
    return [...rows].reverse().slice(0, n);
  }
  const rows = deviceId
    ? await query(`SELECT ${LOG_COLUMNS} FROM logs WHERE device_id = ? ORDER BY id DESC LIMIT ?`, [deviceId, n])
    : await query(`SELECT ${LOG_COLUMNS} FROM logs ORDER BY id DESC LIMIT ?`, [n]);
  return Array.isArray(rows) ? rows : [];
}

async function addLog(entry) {
  let zoneLabel = entry.zone || null;
  if (zoneLabel) {
    const z = (await getCatalog()).zones.find((x) => x.key === zoneLabel);
    if (z) zoneLabel = z.label;
  }
  const row = {
    employee_id: entry.employee_id || null,
    employee_name: entry.employee_name || null,
    action: entry.action,
    device_id: entry.device_id || null,
    device_name: entry.device_name || null,
    zone: zoneLabel,
    floor: entry.floor || null,
    details: entry.details || null,
    old_values: entry.old_values ? JSON.stringify(entry.old_values) : null,
    new_values: entry.new_values ? JSON.stringify(entry.new_values) : null
  };
  if (!USE_DB) {
    memLogs.push({ id: memLogs.length + 1, timestamp: new Date().toISOString(), ...row });
    if (memLogs.length > 5000) memLogs.splice(0, memLogs.length - 5000);
    return;
  }
  const cols = Object.keys(row);
  await query(`INSERT INTO logs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(row));
}

// ---------- settings store ----------
const SETTING_DEFAULTS = {
  MONITOR_ENABLED: 'TRUE',
  MONITOR_INTERVAL_SEC: '60',   // ping ทุกกี่วินาที
  MONITOR_TIMEOUT_MS: '1000',   // รอ reply นานสุดต่อครั้ง
  MONITOR_FAIL_THRESHOLD: '2',  // ping ไม่ผ่านติดกันกี่รอบถึงนับว่า offline
  MONITOR_WARN_MS: '200',       // latency เกินนี้ = warning
  MONITOR_TYPES: '',            // ประเภทอุปกรณ์ที่ ping (key คั่นด้วย , ) — ว่าง = ทุกประเภท
  IPTABLE_AUTO_ADD: 'TRUE',     // เพิ่ม/แก้กล้อง → ซิงก์ IP เข้า TABLE_IP ปีปัจจุบัน
  IPTABLE_AUTO_REMOVE: 'soft',  // ลบกล้อง → soft (ใส่สถานะ DELETED) / hard (ลบแถว) / off
  XLSX_AUTO_SYNC: 'TRUE',       // เฝ้าไฟล์ Excel ในโปรเจกต์ เปลี่ยนเมื่อไหร่นำเข้าใหม่
  XLSX_LAST_HASH: '',           // (ภายใน) hash ของไฟล์ที่ซิงก์ล่าสุด
  TELEGRAM_ENABLED: 'FALSE',    // แจ้งเตือน Telegram เมื่ออุปกรณ์ offline
  TELEGRAM_BOT_TOKEN: '',       // token จาก @BotFather (ลับ — ไม่ส่งกลับไปที่หน้าเว็บ)
  TELEGRAM_CHAT_ID: '',         // chat id ของกลุ่ม/คน ที่จะส่งข้อความไป
  TELEGRAM_NOTIFY_RECOVERY: 'TRUE' // แจ้งด้วยเมื่อกลับมา online
};

async function getSetting(key) {
  if (!USE_DB) return memSettings[key] !== undefined ? memSettings[key] : (SETTING_DEFAULTS[key] || '');
  const rows = await query('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  if (rows[0]) return rows[0].value || '';
  return SETTING_DEFAULTS[key] || '';
}

async function setSetting(key, value) {
  if (!USE_DB) {
    memSettings[key] = value;
    return;
  }
  await query('INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [key, value]);
}

async function getIntSetting(key, min, max) {
  const n = parseInt(await getSetting(key), 10);
  const fallback = parseInt(SETTING_DEFAULTS[key], 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max);
}

// ---------- CATALOG: ประเภท / สถานะ / โซน (เก็บเป็น JSON ในตาราง settings) ----------
// icon: "lucide:<ชื่อไอคอน>" (ชุดไอคอนใน frontend) หรือ "/api/uploads/icon-....png" (โลโก้ที่อัปโหลด)
const DEFAULT_TYPES = [
  { key: 'camera', label: 'กล้อง CCTV', icon: 'lucide:Cctv' },
  { key: 'nvr', label: 'NVR / DVR', icon: 'lucide:HardDrive' },
  { key: 'switch', label: 'Switch', icon: 'lucide:Network' },
  { key: 'router', label: 'Router / Firewall', icon: 'lucide:Router' },
  { key: 'ap', label: 'Access Point', icon: 'lucide:Wifi' },
  { key: 'server', label: 'Server', icon: 'lucide:Server' },
  { key: 'pc', label: 'PC / Notebook', icon: 'lucide:Monitor' },
  { key: 'printer', label: 'Printer', icon: 'lucide:Printer' },
  { key: 'ups', label: 'UPS', icon: 'lucide:Zap' },
  { key: 'other', label: 'อื่น ๆ', icon: 'lucide:Box' }
];

// สถานะที่ระบบ ping ใช้ — ลบ/เปลี่ยน key ไม่ได้ แก้ได้แค่ชื่อ สี ไอคอน
// pause_monitor: อุปกรณ์ในสถานะนี้ไม่ถูก ping (ตั้งเอง เช่น ซ่อมบำรุง)
const BUILTIN_STATUSES = [
  { key: 'online', label: 'Online', color: '#16a34a', icon: 'lucide:CircleCheck', pause_monitor: false },
  { key: 'offline', label: 'Offline', color: '#ef4444', icon: 'lucide:CircleX', pause_monitor: false },
  { key: 'warning', label: 'Warning', color: '#f59e0b', icon: 'lucide:TriangleAlert', pause_monitor: false },
  { key: 'maintenance', label: 'Maintenance', color: '#7c3aed', icon: 'lucide:Wrench', pause_monitor: true },
  { key: 'unknown', label: 'Unknown', color: '#94a3b8', icon: 'lucide:CircleHelp', pause_monitor: false }
];
const BUILTIN_KEYS = BUILTIN_STATUSES.map((s) => s.key);

const CATALOG_KINDS = { types: 'CATALOG_TYPES', statuses: 'CATALOG_STATUSES', zones: 'CATALOG_ZONES' };
// โซนเดิมใช้ชื่อเป็น key (ภาษาไทย/ช่องว่างได้) — กันแค่อักขระควบคุมและเครื่องหมายที่ใช้แทรก HTML
const KEY_RE = /^[^<>"'`\\\u0000-\u001f]{1,60}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_RE = /^(lucide:[A-Za-z0-9]{1,40}|\/api\/uploads\/icon-[A-Za-z0-9-]+\.(png|jpe?g|gif|webp|svg))$/;

function parseJson(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function getCatalog() {
  const types = parseJson(await getSetting('CATALOG_TYPES')) || DEFAULT_TYPES;
  const savedStatuses = parseJson(await getSetting('CATALOG_STATUSES')) || [];
  // สถานะหลักต้องมีครบเสมอ (เรียงตามที่บันทึกไว้ ถ้าไม่มีเติมท้าย)
  const statuses = [...savedStatuses];
  for (const b of BUILTIN_STATUSES) {
    const i = statuses.findIndex((s) => s.key === b.key);
    if (i === -1) statuses.push({ ...b });
  }
  for (const s of statuses) {
    s.builtin = BUILTIN_KEYS.includes(s.key);
    if (s.builtin) s.pause_monitor = s.key === 'maintenance';
  }
  let zones = parseJson(await getSetting('CATALOG_ZONES'));
  if (!zones) {
    // ครั้งแรก: ดึงโซนที่อุปกรณ์ใช้อยู่ (เดิมพิมพ์อิสระ) มาเป็นรายการ — ใช้ชื่อเดิมเป็น key ข้อมูลอุปกรณ์จึงไม่ต้องแก้
    const names = [...new Set((await listDevices()).map((d) => d.zone).filter(Boolean))].sort();
    zones = names.map((n, i) => ({ key: n, label: n, color: ZONE_COLORS[i % ZONE_COLORS.length], icon: '' }));
    await setSetting('CATALOG_ZONES', JSON.stringify(zones));
  }
  return { types, statuses, zones };
}

const ZONE_COLORS = ['#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#db2777', '#7c3aed', '#475569'];

// เช็ค + ทำความสะอาดรายการที่ส่งมาจากหน้า Settings — คืน { items } หรือ { error }
function validateCatalog(kind, items) {
  if (!Array.isArray(items)) return { error: 'ต้องส่งเป็น array' };
  if (items.length > 300) return { error: 'รายการเยอะเกินไป (สูงสุด 300)' };
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const key = String(raw && raw.key || '').trim();
    const label = String(raw && raw.label || '').trim();
    if (!KEY_RE.test(key)) return { error: `key ไม่ถูกต้อง: "${key}"` };
    if (seen.has(key)) return { error: `key ซ้ำ: "${key}"` };
    if (!label || label.length > 60) return { error: `ชื่อของ "${key}" ต้องมี 1–60 ตัวอักษร` };
    seen.add(key);
    const icon = String(raw.icon || '');
    if (icon && !ICON_RE.test(icon)) return { error: `ไอคอนของ "${label}" ไม่ถูกต้อง` };
    const item = { key, label, icon };
    if (kind !== 'types') {
      const color = String(raw.color || '');
      if (!COLOR_RE.test(color)) return { error: `สีของ "${label}" ต้องเป็นรูปแบบ #RRGGBB` };
      item.color = color;
    }
    if (kind === 'statuses') {
      item.pause_monitor = BUILTIN_KEYS.includes(key) ? key === 'maintenance' : raw.pause_monitor !== false;
    }
    out.push(item);
  }
  if (kind === 'types' && out.length === 0) return { error: 'ต้องมีประเภทอย่างน้อย 1 รายการ' };
  if (kind === 'statuses') {
    const missing = BUILTIN_KEYS.filter((k) => !seen.has(k));
    if (missing.length) return { error: `ลบสถานะหลักไม่ได้: ${missing.join(', ')}` };
  }
  return { items: out };
}

const DEVICE_FIELD_OF = { types: 'device_type', statuses: 'status', zones: 'zone' };

// เพิ่มโซนที่ยังไม่มีในรายการ (เช่นมาจากสคริปต์ seed หรือ API) — ไม่ให้ข้อมูลหลุดรายการ
async function ensureZone(zone) {
  if (!zone) return;
  const { zones } = await getCatalog();
  if (zones.some((z) => z.key === zone)) return;
  zones.push({ key: zone, label: zone, color: ZONE_COLORS[zones.length % ZONE_COLORS.length], icon: '' });
  await setSetting('CATALOG_ZONES', JSON.stringify(zones));
}

async function pausedStatusKeys() {
  return new Set((await getCatalog()).statuses.filter((s) => s.pause_monitor).map((s) => s.key));
}

// ========== MONITOR (ping อัตโนมัติ) ==========
// ใช้คำสั่ง ping ของระบบ (ไม่ต้องลง package / ไม่ต้องสิทธิ์ admin) ผ่าน execFile — ไม่ผ่าน shell
const IS_WIN = os.platform() === 'win32';
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.\-:]{0,99}$/;

function pingHost(host, timeoutMs) {
  return new Promise((resolve) => {
    if (!HOST_RE.test(host)) return resolve({ alive: false, latency: null, error: 'invalid host' });
    const args = IS_WIN
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
    const started = Date.now();
    execFile('ping', args, { timeout: timeoutMs + 3000, windowsHide: true }, (err, stdout) => {
      const out = String(stdout || '');
      // Windows ตอบ exit 0 ได้แม้ "Destination host unreachable" — ต้องมี TTL= ถึงนับว่าได้ reply จริง
      const alive = /ttl[=:]/i.test(out) && (!err || IS_WIN);
      if (!alive) return resolve({ alive: false, latency: null });
      const m = out.match(/[=<]\s*([\d.]+)\s*ms/i);
      resolve({ alive: true, latency: m ? Number(m[1]) : Date.now() - started });
    });
  });
}

const monitorState = { running: false, lastRunAt: null, lastDurationMs: null, checked: 0, timer: null };

// ตัดสินสถานะจากผล ping 1 ครั้ง + จำนวนครั้งที่ไม่ผ่านติดกัน
async function applyPingResult(device, result, cfg) {
  const now = new Date();
  const patch = { last_checked: USE_DB ? now : now.toISOString() };
  let next = device.status;
  if (result.alive) {
    patch.fail_count = 0;
    patch.last_seen = patch.last_checked;
    patch.last_latency_ms = result.latency;
    next = result.latency != null && result.latency > cfg.warnMs ? 'warning' : 'online';
  } else {
    patch.fail_count = (device.fail_count || 0) + 1;
    patch.last_latency_ms = null;
    if (patch.fail_count >= cfg.failThreshold) next = 'offline';
    else if (device.status === 'online') next = 'warning'; // หลุดครั้งแรก — เตือนก่อน
  }
  if (next !== device.status) patch.status = next;
  await writeMonitorResult(device.id, patch);

  const wasDown = device.status === 'offline';
  if (next === 'offline' && !wasDown) {
    const details = `ping ไม่ตอบ ${patch.fail_count} ครั้งติดกัน`;
    await addLog({ action: 'down', device_id: device.id, device_name: device.name, zone: device.zone, floor: device.floor, details, employee_name: 'system' });
    queueAlert('down', device, { failCount: patch.fail_count });
  } else if (wasDown && (next === 'online' || next === 'warning')) {
    const details = `ping ตอบกลับ ${result.latency != null ? `${result.latency} ms` : ''}`.trim();
    await addLog({ action: 'up', device_id: device.id, device_name: device.name, zone: device.zone, floor: device.floor, details, employee_name: 'system' });
    queueAlert('up', device, { latency: result.latency });
  }
  return { ...device, ...patch, status: next };
}

// ========== TELEGRAM (แจ้งเตือนเมื่อ offline / กลับมา online) ==========
// เก็บเหตุการณ์ของรอบ ping นี้ไว้ แล้วส่งรวมเป็นข้อความเดียวตอนจบรอบ
// — สวิตช์ล่มทีเดียว 50 กล้อง จะได้ 1 ข้อความ ไม่ใช่ 50 ข้อความ
const TELEGRAM_MAX_LIST = 30;      // แสดงรายชื่อสูงสุดต่อหัวข้อ เกินนี้สรุปเป็น "และอีก N เครื่อง"
const TELEGRAM_MAX_CHARS = 3900;   // Telegram จำกัด 4096 ตัวอักษรต่อข้อความ
const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
const alertQueue = { down: [], up: [] };

function queueAlert(kind, device, extra = {}) {
  alertQueue[kind].push({
    name: device.name, ip: device.ip_address, zone: device.zone, floor: device.floor, lan: device.lan, ...extra,
  });
}

const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function telegramConfig() {
  return {
    enabled: String(await getSetting('TELEGRAM_ENABLED')).toUpperCase() === 'TRUE',
    token: String(await getSetting('TELEGRAM_BOT_TOKEN')).trim(),
    chatId: String(await getSetting('TELEGRAM_CHAT_ID')).trim(),
    notifyRecovery: String(await getSetting('TELEGRAM_NOTIFY_RECOVERY')).toUpperCase() !== 'FALSE',
  };
}

// ส่งข้อความผ่าน Bot API (fetch ในตัวของ Node 18+) — throw ข้อความภาษาไทยถ้าส่งไม่ได้
async function sendTelegram(text, { token, chatId }) {
  if (!token || !chatId) throw new Error('ยังไม่ได้ตั้งค่า Bot Token / Chat ID');
  if (!TOKEN_RE.test(token)) throw new Error('รูปแบบ Bot Token ไม่ถูกต้อง');
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(`เชื่อมต่อ Telegram ไม่ได้ (${err.name === 'TimeoutError' ? 'หมดเวลา' : err.message}) — เครื่อง server ออกอินเทอร์เน็ตได้หรือไม่?`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    const desc = body.description || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Bot Token ไม่ถูกต้อง');
    if (/chat not found/i.test(desc)) throw new Error('ไม่พบ Chat ID นี้ — ต้องทักบอท / เพิ่มบอทเข้ากลุ่มก่อน');
    throw new Error(`Telegram ตอบกลับ: ${desc}`);
  }
}

async function formatAlertLines(items, kind) {
  const catalog = await getCatalog().catch(() => null);
  const zoneLabel = (k) => (k && catalog?.zones?.find((z) => z.key === k)?.label) || k || '';
  const lines = items.slice(0, TELEGRAM_MAX_LIST).map((d) => {
    const where = [d.floor && `ชั้น ${d.floor}`, zoneLabel(d.zone), d.lan && `LAN ${d.lan}`].filter(Boolean).join(' · ');
    const tail = kind === 'up' && d.latency != null ? ` — ${d.latency} ms` : '';
    return `• <b>${escHtml(d.name)}</b> <code>${escHtml(d.ip)}</code>${tail}${where ? `\n   ${escHtml(where)}` : ''}`;
  });
  if (items.length > TELEGRAM_MAX_LIST) lines.push(`… และอีก ${items.length - TELEGRAM_MAX_LIST} เครื่อง`);
  return lines;
}

const thaiTime = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' });

async function buildAlertMessage(down, up) {
  const parts = [];
  if (down.length) parts.push(`🔴 <b>อุปกรณ์ Offline ${down.length} เครื่อง</b>`, ...(await formatAlertLines(down, 'down')));
  if (up.length) {
    if (parts.length) parts.push('');
    parts.push(`🟢 <b>กลับมา Online ${up.length} เครื่อง</b>`, ...(await formatAlertLines(up, 'up')));
  }
  parts.push('', `🕒 ${escHtml(thaiTime())}`);
  let text = parts.join('\n');
  // ตัดที่ขึ้นบรรทัดใหม่ (ไม่ตัดกลางแท็ก HTML)
  if (text.length > TELEGRAM_MAX_CHARS) text = `${text.slice(0, text.lastIndexOf('\n', TELEGRAM_MAX_CHARS))}\n…`;
  return text;
}

const telegramState = { lastSentAt: null, lastError: null };

// ส่งเหตุการณ์ที่ค้างอยู่ (เรียกตอนจบรอบ ping และหลัง ping ทีละเครื่อง)
async function flushAlerts() {
  const down = alertQueue.down.splice(0);
  const up = alertQueue.up.splice(0);
  if (!down.length && !up.length) return;
  try {
    const cfg = await telegramConfig();
    if (!cfg.enabled || !cfg.token || !cfg.chatId) return;
    const upList = cfg.notifyRecovery ? up : [];
    if (!down.length && !upList.length) return;
    await sendTelegram(await buildAlertMessage(down, upList), cfg);
    telegramState.lastSentAt = new Date().toISOString();
    telegramState.lastError = null;
  } catch (err) {
    telegramState.lastError = err.message;
    console.error('[telegram]', err.message);
  }
}

async function monitorConfig() {
  return {
    enabled: String(await getSetting('MONITOR_ENABLED')).toUpperCase() === 'TRUE',
    intervalSec: await getIntSetting('MONITOR_INTERVAL_SEC', 10, 3600),
    timeoutMs: await getIntSetting('MONITOR_TIMEOUT_MS', 200, 10000),
    failThreshold: await getIntSetting('MONITOR_FAIL_THRESHOLD', 1, 20),
    warnMs: await getIntSetting('MONITOR_WARN_MS', 1, 10000),
    types: parseMonitorTypes(await getSetting('MONITOR_TYPES'))
  };
}

// '' = ทุกประเภท (คืน null), นอกนั้นเป็น Set ของ key ประเภทที่ให้ ping
function parseMonitorTypes(raw) {
  const keys = String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
  return keys.length ? new Set(keys) : null;
}

// อุปกรณ์นี้ควรถูก ping อัตโนมัติไหม: เปิด monitor + มี IP + ไม่อยู่ในสถานะหยุด ping + ประเภทอยู่ในรายการที่เลือก
function shouldMonitor(device, paused, cfg) {
  return !!(device.monitor_enabled && device.ip_address && !paused.has(device.status) &&
    (!cfg.types || cfg.types.has(device.device_type)));
}

async function checkDevice(device, cfg) {
  const result = await pingHost(device.ip_address, cfg.timeoutMs);
  return applyPingResult(device, result, cfg);
}

// ความคืบหน้าของรอบ ping ล่าสุด — หน้า Settings ดึงไปแสดงเป็น log วิ่ง (GET /api/monitor/progress)
const PROGRESS_MAX_ENTRIES = 3000;
const monitorProgress = {
  runId: 0, source: null, running: false, startedAt: null, finishedAt: null,
  total: 0, done: 0, counts: { online: 0, warning: 0, offline: 0, error: 0 }, changed: 0,
  seq: 0, entries: [], note: null,
};

function recordProgress(device, after, err) {
  const p = monitorProgress;
  p.done++;
  const status = err ? 'error' : after.status;
  if (p.counts[status] !== undefined) p.counts[status]++;
  const changed = !err && after.status !== device.status;
  if (changed) p.changed++;
  p.entries.push({
    seq: ++p.seq, at: new Date().toISOString(), id: device.id, name: device.name, ip: device.ip_address,
    status, prev: device.status, changed, latency: err ? null : after.last_latency_ms ?? null,
    error: err ? err.message : null,
  });
  if (p.entries.length > PROGRESS_MAX_ENTRIES) p.entries.splice(0, p.entries.length - PROGRESS_MAX_ENTRIES);
}

// ping ทุกเครื่องที่เปิด monitor + มี IP + ไม่อยู่ในสถานะ maintenance + ประเภทที่เลือก (ทำพร้อมกันทีละ 20 เครื่อง)
// source: 'auto' = ตามรอบเวลา (ข้ามถ้าปิด monitor), 'manual' = กด "Ping ทั้งหมดตอนนี้" (ping แม้ปิด monitor อัตโนมัติ)
async function runMonitorCycle(source = 'auto') {
  if (monitorState.running) return false;
  monitorState.running = true;
  const started = Date.now();
  const p = monitorProgress;
  try {
    const cfg = await monitorConfig();
    if (!cfg.enabled && source !== 'manual') return false;
    const paused = await pausedStatusKeys();
    const targets = (await listDevices()).filter((d) => shouldMonitor(d, paused, cfg));
    Object.assign(p, {
      runId: p.runId + 1, source, running: true, startedAt: new Date().toISOString(), finishedAt: null,
      total: targets.length, done: 0, counts: { online: 0, warning: 0, offline: 0, error: 0 }, changed: 0,
      entries: [], note: null,
    });
    const CONCURRENCY = 20;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      await Promise.all(targets.slice(i, i + CONCURRENCY).map((d) =>
        checkDevice(d, cfg)
          .then((after) => recordProgress(d, after, null))
          .catch((err) => {
            console.error(`[monitor] ${d.name}:`, err.message);
            recordProgress(d, d, err);
          })
      ));
    }
    monitorState.checked = targets.length;
    flushAlerts(); // ไม่ต้องรอ — ส่ง Telegram ช้าไม่ควรถ่วงรอบ ping
    monitorState.lastRunAt = new Date().toISOString();
    monitorState.lastDurationMs = Date.now() - started;
    return true;
  } catch (err) {
    console.error('[monitor] cycle error:', err.message);
    p.note = `เกิดข้อผิดพลาด: ${err.message}`;
    return false;
  } finally {
    monitorState.running = false;
    if (p.running) {
      p.running = false;
      p.finishedAt = new Date().toISOString();
    }
  }
}

async function scheduleMonitor() {
  if (monitorState.timer) clearTimeout(monitorState.timer);
  const { intervalSec } = await monitorConfig().catch(() => ({ intervalSec: 60 }));
  monitorState.timer = setTimeout(async () => {
    await runMonitorCycle();
    scheduleMonitor();
  }, intervalSec * 1000);
}

// ========== ROUTES ==========
app.get('/api/health', async (req, res) => {
  try {
    await pingStore();
    res.json({ ok: true, db: USE_DB, mode: USE_DB ? 'mariadb' : 'memory' });
  } catch (err) {
    res.status(500).json({ ok: false, db: false });
  }
});

app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// หน้าเว็บใช้ตัดสินว่าจะแสดงช่องรหัสผู้ดูแลไหม
app.get('/api/admin/mode', async (req, res) => {
  res.json({ required: !!ADMIN_SECRET || (await auth.userCount()) > 0 });
});

// ---------- device snapshots (สแนปช็อตรายการอุปกรณ์รายปี) ----------
// (ต้องอยู่ก่อน /api/devices/:id ไม่งั้น 'snapshots' จะถูกจับเป็น id)
app.get('/api/devices/snapshots/years', async (req, res) => {
  try {
    res.json({ years: await listSnapshotYears(), current: new Date().getFullYear() });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/devices/snapshots', async (req, res) => {
  try {
    const year = snapYearOf(req.query.year);
    if (!year) return res.status(400).json({ error: 'ต้องระบุปี (2000–2100)' });
    const snap = await getSnapshot(year);
    if (!snap) return res.status(404).json({ error: `ยังไม่มีสแนปช็อตปี ${year}` });
    res.json(snap);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// บันทึกสแนปช็อตจากรายการอุปกรณ์ปัจจุบัน (มีของปีนั้นแล้ว = เขียนทับ)
app.post('/api/devices/snapshots', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const year = snapYearOf(body.year) || new Date().getFullYear();
    const devices = await listDevices(null);
    const rec = await saveSnapshot(year, devices, body.employee_name || null);
    await addLog({
      employee_id: body.employee_id, employee_name: body.employee_name,
      action: 'snapshot', details: `บันทึกสแนปช็อตรายการอุปกรณ์ปี ${year} (${devices.length} เครื่อง)`,
    });
    res.json({ year: rec.year, count: devices.length, created_at: rec.created_at });
  } catch (err) {
    console.error('Save snapshot error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- devices ----------
app.get('/api/devices', async (req, res) => {
  try {
    res.json(await listDevices(req.query.map_id || null));
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/devices/:id', async (req, res) => {
  try {
    const d = await getDevice(req.params.id);
    if (!d) return res.status(404).json({ error: 'Not found' });
    res.json(d);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/devices', requireEditor, async (req, res) => {
  try {
    const data = await pickDeviceFields(req.body || {});
    if (!data.name || !String(data.name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (data.ip_address && !HOST_RE.test(data.ip_address)) {
      return res.status(400).json({ error: 'IP / hostname ไม่ถูกต้อง' });
    }
    data.name = String(data.name).trim();
    if (!data.device_type) data.device_type = (await pickDeviceFields({ device_type: 'other' })).device_type;
    const device = await createDevice(data);
    await addLog({
      employee_id: req.body.employee_id, employee_name: req.body.employee_name,
      action: 'added', device_id: device.id, device_name: device.name,
      zone: device.zone, floor: device.floor, details: `เพิ่มอุปกรณ์ ${device.name}`, new_values: device
    });
    await ipTable.onDeviceAdded(device, { name: req.body && req.body.employee_name });
    res.status(201).json(device);
    // ping ทันทีให้เห็นสถานะโดยไม่ต้องรอรอบถัดไป
    monitorConfig().then(async (cfg) => {
      if (shouldMonitor(device, await pausedStatusKeys(), cfg)) await checkDevice(device, cfg);
    }).catch(() => {});
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/devices/:id', requireEditor, async (req, res) => {
  try {
    const old = await getDevice(req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    const data = await pickDeviceFields(req.body || {});
    if (data.name) data.name = String(data.name).trim();
    if (data.ip_address && !HOST_RE.test(data.ip_address)) {
      return res.status(400).json({ error: 'IP / hostname ไม่ถูกต้อง' });
    }
    // เปลี่ยน IP หรือออกจาก maintenance — เริ่มนับ ping ใหม่
    if ((data.ip_address !== undefined && data.ip_address !== old.ip_address) ||
        (data.status && data.status !== old.status && (await pausedStatusKeys()).has(old.status))) {
      data.fail_count = 0;
    }
    const device = await updateDevice(req.params.id, data);
    const removed = old.x_percent != null && device.x_percent == null;
    const moved = !removed && ((data.x_percent !== undefined && Number(data.x_percent) !== old.x_percent) ||
                  (data.y_percent !== undefined && Number(data.y_percent) !== old.y_percent));
    const action = moved ? 'moved' : 'updated';
    await addLog({
      employee_id: req.body.employee_id, employee_name: req.body.employee_name,
      action, device_id: device.id, device_name: device.name,
      zone: device.zone, floor: device.floor,
      details: removed ? `เอาออกจากแผนผัง ${device.name}` : moved ? `ย้ายตำแหน่ง ${device.name}` : `แก้ไข ${device.name}`,
      old_values: old, new_values: device
    });
    await ipTable.onDeviceUpdated(old, device, { name: req.body && req.body.employee_name });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/devices/:id', requireEditor, async (req, res) => {
  try {
    const old = await getDevice(req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    await deleteDeviceRow(req.params.id);
    await addLog({
      employee_id: req.body && req.body.employee_id, employee_name: req.body && req.body.employee_name,
      action: 'deleted', device_id: old.id, device_name: old.name,
      zone: old.zone, floor: old.floor, details: `ลบอุปกรณ์ ${old.name}`, old_values: old
    });
    await ipTable.onDeviceDeleted(old, { name: req.body && req.body.employee_name });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// กู้คืนอุปกรณ์ที่เพิ่งลบ (ปุ่ม "เลิกทำ" บนหน้าเว็บ) — body = ข้อมูลอุปกรณ์ก่อนลบ
// id เดิม (UUID หรือ id จากไฟล์นำเข้า) — อนุญาตเฉพาะตัวอักษรปลอดภัย
const DEVICE_ID_RE = /^[A-Za-z0-9_.:-]{1,36}$/;
app.post('/api/devices/:id/restore', requireEditor, async (req, res) => {
  try {
    const id = req.params.id;
    if (!DEVICE_ID_RE.test(id)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
    if (await getDevice(id)) return res.status(409).json({ error: 'อุปกรณ์นี้มีอยู่แล้ว' });
    const data = await pickDeviceFields(req.body || {});
    if (!data.name || !String(data.name).trim()) return res.status(400).json({ error: 'name is required' });
    if (data.ip_address && !HOST_RE.test(data.ip_address)) return res.status(400).json({ error: 'IP / hostname ไม่ถูกต้อง' });
    const device = await createDevice(data, id);
    await addLog({
      employee_id: req.body.employee_id, employee_name: req.body.employee_name,
      action: 'added', device_id: device.id, device_name: device.name,
      zone: device.zone, floor: device.floor, details: `กู้คืนอุปกรณ์ ${device.name} (เลิกทำการลบ)`, new_values: device
    });
    // แถว TABLE_IP ที่ถูก soft-delete จะกลับมาใช้แถวเดิม
    await ipTable.onDeviceAdded(device, { name: req.body && req.body.employee_name });
    res.status(201).json(device);
    monitorConfig().then(async (cfg) => {
      if (shouldMonitor(device, await pausedStatusKeys(), cfg)) await checkDevice(device, cfg);
    }).catch(() => {});
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ========== นำเข้าจากไฟล์ Excel ที่อัปโหลดผ่านหน้าเว็บ ==========
// ใช้ตัวอ่าน .xlsx เดียวกับสคริปต์ import-from-xlsx.js — dry_run=1 คืนสรุปให้ยืนยันก่อน ยังไม่เขียนอะไร
const xlsxImport = require('./import-from-xlsx');
const XLSX_MAX_MB = 30;
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: XLSX_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.xlsx') cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ .xlsx (Excel) เท่านั้น'));
  }
});
let xlsxImporting = false;
const xlsxHash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// เขียนข้อมูลจาก workbook ที่อ่านแล้ว — ใช้ทั้งปุ่มนำเข้าในหน้าเว็บและซิงก์อัตโนมัติ
// keepRuntime: เก็บสถานะ ping เดิม (online/offline, last_seen …) ของกล้อง id เดิม ไม่ให้รีเซ็ตทุกครั้งที่บันทึก Excel
async function applyWorkbook(wb, { only, fileName, keepRuntime = false }) {
  const result = { iptable: [], maps: [], cameras: null };
  for (const y of wb.ipYears) result.iptable.push(await ipTable.importYear(y.year, y.rows, y.updates));
  // แผนผัง: ที่มีอยู่แล้วไม่แตะรูป, ที่ยังไม่มีลองโหลดรูปจาก Google Drive
  const mapIds = new Set((await listMaps()).map((m) => m.map_id));
  for (const r of wb.mapRows) {
    const mapId = xlsxImport.str(r.map_id);
    const mapName = xlsxImport.str(r.map_name) || mapId;
    if (mapIds.has(mapId)) { result.maps.push({ map_id: mapId, map_name: mapName, status: 'exists' }); continue; }
    const img = await xlsxImport.loadMapImage(mapId, r);
    if (!img) { result.maps.push({ map_id: mapId, map_name: mapName, status: 'no_image' }); continue; }
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const filename = `map-${crypto.randomUUID()}${path.extname(img.name) || '.jpg'}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), img.buf);
    await saveMap({ map_id: mapId, map_name: mapName, image_url: `/api/uploads/${filename}` });
    result.maps.push({ map_id: mapId, map_name: mapName, status: 'downloaded' });
  }
  if (only.includes('cameras') && wb.devices.length > 0) {
    const old = new Map((await listDevices()).filter((d) => d.device_type === 'camera').map((d) => [d.id, d]));
    result.cameras = await replaceDevicesByType('camera', wb.devices);
    if (old.size) {
      const paused = await pausedStatusKeys();
      for (const d of await listDevices()) {
        const o = old.get(d.id);
        if (!o || d.device_type !== 'camera') continue;
        // "ไม่แสดงบนแผนผัง" ไม่มีใน Excel — คงค่าเดิมไว้ (ถ้าใน Excel ไม่ได้ใส่ตำแหน่งให้)
        if (o.hide_on_map && d.x_percent == null) await writeMonitorResult(d.id, { hide_on_map: 1 });
        if (!keepRuntime || o.ip_address !== d.ip_address) continue;
        const keep = { fail_count: o.fail_count, last_seen: o.last_seen, last_checked: o.last_checked, last_latency_ms: o.last_latency_ms };
        // สถานะที่หยุด ping (เช่น maintenance) ใน Excel ชนะ, นอกนั้นใช้ผล ping ล่าสุด
        if (!paused.has(d.status) && !paused.has(o.status)) keep.status = o.status;
        await writeMonitorResult(d.id, keep);
      }
    }
    await addLog({ action: 'imported', details: `นำเข้ากล้องจาก ${fileName}: ${result.cameras.imported} ตัว (skipped ${result.cameras.skipped})` });
  }
  return result;
}

app.post('/api/import/xlsx', requireAdmin, (req, res, next) => {
  xlsxUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${XLSX_MAX_MB}MB` : err.message });
  });
}, async (req, res) => {
  // ไม่แนบไฟล์ + source=project → อ่านไฟล์ในโปรเจกต์ (backend/data/CCTV-MECHA-PART.xlsx หรือ XLSX_FILE)
  if (!req.file && req.body.source === 'project') {
    const p = xlsxImport.DEFAULT_XLSX;
    if (!fs.existsSync(p)) return res.status(404).json({ error: `ไม่พบไฟล์ ${path.relative(__dirname, p)} ในโปรเจกต์` });
    req.file = { buffer: fs.readFileSync(p), originalname: path.basename(p) };
  }
  if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์ .xlsx (field "file")' });
  const only = String(req.body.only || 'cameras,iptable').split(',').map((x) => x.trim());
  const dryRun = ['1', 'true'].includes(String(req.body.dry_run || '').toLowerCase());
  let wb;
  try {
    wb = xlsxImport.parseWorkbook(req.file.buffer, { cameras: only.includes('cameras'), iptable: only.includes('iptable') });
  } catch (err) {
    return res.status(400).json({ error: `อ่านไฟล์ไม่ได้: ${err.message}` });
  }
  const existingMaps = await listMaps();
  const mapIds = new Set(existingMaps.map((m) => m.map_id));
  const currentCameras = (await listDevices()).filter((d) => d.device_type === 'camera').length;
  const summary = {
    file: req.file.originalname,
    sheets: wb.sheets,
    warnings: wb.warnings,
    cameras: only.includes('cameras') ? { count: wb.devices.length, skipped: wb.skippedDevices, current: currentCameras } : null,
    maps: wb.mapRows.map((r) => ({ map_id: xlsxImport.str(r.map_id), map_name: xlsxImport.str(r.map_name) || xlsxImport.str(r.map_id), exists: mapIds.has(xlsxImport.str(r.map_id)) })),
    iptable: wb.ipYears.map((y) => ({ year: y.year, rows: y.rows.length, updates: y.updates ? y.updates.length : null })),
  };
  if (dryRun) return res.json({ ok: true, dry_run: true, ...summary });
  if (only.includes('cameras') && wb.devices.length === 0) {
    return res.status(400).json({ error: 'ไม่พบกล้องในแท็บ cctv — ยกเลิกเพื่อไม่ให้กล้องเดิมถูกลบหมด' });
  }

  if (xlsxImporting) return res.status(409).json({ error: 'กำลังนำเข้าไฟล์อื่นอยู่ — รอสักครู่' });
  xlsxImporting = true;
  try {
    const result = await applyWorkbook(wb, { only, fileName: req.file.originalname });
    // นำเข้าไฟล์ในโปรเจกต์ครบทั้งสองส่วน = ซิงก์แล้ว ไม่ต้องให้ตัวเฝ้าไฟล์นำเข้าซ้ำ
    if (req.body.source === 'project' && only.includes('cameras') && only.includes('iptable')) {
      await setSetting('XLSX_LAST_HASH', xlsxHash(req.file.buffer));
      xlsxSync.lastSync = new Date().toISOString();
      xlsxSync.lastError = null;
    }
    res.json({ ok: true, ...summary, result });
  } catch (err) {
    console.error('Import xlsx error:', err);
    res.status(500).json({ error: `นำเข้าล้มเหลว: ${err.message}` });
  } finally {
    xlsxImporting = false;
  }
});

// ---------- ซิงก์อัตโนมัติ: เฝ้าไฟล์ Excel ในโปรเจกต์ บันทึกใน Excel แล้วนำเข้าใหม่เอง ----------
// Excel เป็นต้นฉบับของกล้อง + TABLE_IP — การแก้กล้อง/TABLE_IP ในเว็บจะถูกทับเมื่อไฟล์เปลี่ยน
// เทียบ hash ของไฟล์กับครั้งล่าสุด (เก็บใน settings) จึงไม่นำเข้าซ้ำตอนรีสตาร์ตถ้าไฟล์ไม่เปลี่ยน
const xlsxSync = { lastSync: null, lastError: null, lastResult: null, timer: null, retries: 0 };

async function syncXlsxIfChanged(reason) {
  const file = xlsxImport.DEFAULT_XLSX;
  if ((await getSetting('XLSX_AUTO_SYNC')) !== 'TRUE' || !fs.existsSync(file)) return;
  if (xlsxImporting) return scheduleXlsxSync(reason, 3000);
  let buf;
  let wb;
  try {
    buf = fs.readFileSync(file);
    if (xlsxHash(buf) === (await getSetting('XLSX_LAST_HASH'))) { xlsxSync.retries = 0; return; }
    wb = xlsxImport.parseWorkbook(buf);
  } catch (err) {
    // Excel กำลังเขียนไฟล์อยู่ (ไฟล์ยังไม่ครบ/ถูกล็อก) → ลองใหม่
    if (xlsxSync.retries++ < 5) return scheduleXlsxSync(reason, 3000);
    xlsxSync.lastError = `อ่านไฟล์ไม่ได้: ${err.message}`;
    xlsxSync.retries = 0;
    return;
  }
  xlsxSync.retries = 0;
  if (wb.devices.length === 0) {
    xlsxSync.lastError = 'ไม่พบกล้องในแท็บ cctv — ไม่ซิงก์ (กันกล้องถูกลบหมด)';
    return;
  }
  xlsxImporting = true;
  try {
    const result = await applyWorkbook(wb, { only: ['cameras', 'iptable'], fileName: path.basename(file), keepRuntime: true });
    await setSetting('XLSX_LAST_HASH', xlsxHash(buf));
    xlsxSync.lastSync = new Date().toISOString();
    xlsxSync.lastError = null;
    xlsxSync.lastResult = `กล้อง ${result.cameras ? result.cameras.imported : 0} ตัว, ${result.iptable.map((y) => `TABLE_IP_${y.year} ${y.imported} แถว`).join(', ')}`;
    console.log(`[xlsx-sync] ${reason}: ${xlsxSync.lastResult}`);
  } catch (err) {
    xlsxSync.lastError = `ซิงก์ล้มเหลว: ${err.message}`;
    console.error('[xlsx-sync]', err);
  } finally {
    xlsxImporting = false;
  }
}

function scheduleXlsxSync(reason, delay = 2500) {
  clearTimeout(xlsxSync.timer); // Excel บันทึกหลายจังหวะ — รอให้นิ่งก่อน
  xlsxSync.timer = setTimeout(() => syncXlsxIfChanged(reason).catch((e) => console.error('[xlsx-sync]', e)), delay);
}

function startXlsxWatch() {
  // watchFile (poll) ทนกว่า fs.watch กับการบันทึกแบบ "เขียนไฟล์ชั่วคราวแล้วเปลี่ยนชื่อ" ของ Excel บน Windows
  fs.watchFile(xlsxImport.DEFAULT_XLSX, { interval: 2000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) scheduleXlsxSync('ไฟล์เปลี่ยน');
  });
  scheduleXlsxSync('เริ่ม backend', 500);
}

app.get('/api/import/xlsx/status', async (req, res) => {
  const file = xlsxImport.DEFAULT_XLSX;
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  res.json({
    enabled: (await getSetting('XLSX_AUTO_SYNC')) === 'TRUE',
    file: path.relative(__dirname, file).split(path.sep).join('/'),
    exists: !!st,
    modified: st ? st.mtime.toISOString() : null,
    last_sync: xlsxSync.lastSync,
    last_result: xlsxSync.lastResult,
    last_error: xlsxSync.lastError,
    syncing: xlsxImporting,
  });
});

// นำเข้าอุปกรณ์ทั้งชุด (สคริปต์ import-from-sheet.js) — แทนที่เฉพาะ device_type ที่ระบุ ไม่ลบประเภทอื่น
// เขียน log แค่ 1 ครั้ง ไม่ใช่รายตัว
app.post('/api/devices/import', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const rows = Array.isArray(body.devices) ? body.devices : [];
    const type = String(body.type || 'camera');
    const result = await replaceDevicesByType(type, rows);
    await addLog({ action: 'imported', details: `นำเข้าอุปกรณ์ ${result.imported} รายการ (skipped ${result.skipped})` });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Import devices error:', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// ping อุปกรณ์ตัวเดียวทันที (ปุ่ม "Ping ตอนนี้")
app.post('/api/devices/:id/ping', async (req, res) => {
  try {
    const device = await getDevice(req.params.id);
    if (!device) return res.status(404).json({ error: 'Not found' });
    if (!device.ip_address) return res.status(400).json({ error: 'อุปกรณ์นี้ยังไม่มี IP' });
    const cfg = await monitorConfig();
    const result = await pingHost(device.ip_address, cfg.timeoutMs);
    // อยู่ในสถานะที่หยุด ping (เช่น maintenance), ปิด monitor หรือประเภทไม่ได้เลือกไว้ — แสดงผลอย่างเดียว ไม่เปลี่ยนสถานะ
    if (shouldMonitor(device, await pausedStatusKeys(), cfg)) {
      await applyPingResult(device, result, cfg);
      flushAlerts();
    }
    res.json({ ...result, device: await getDevice(device.id) });
  } catch (err) {
    res.status(500).json({ error: 'Ping failed' });
  }
});

// ---------- monitor ----------
app.get('/api/monitor/status', async (req, res) => {
  try {
    const cfg = await monitorConfig();
    res.json({ ...cfg, types: cfg.types ? [...cfg.types] : null, running: monitorState.running, lastRunAt: monitorState.lastRunAt,
      lastDurationMs: monitorState.lastDurationMs, checked: monitorState.checked });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// เริ่ม ping ทั้งหมดแบบเบื้องหลัง แล้วตอบทันที — หน้าเว็บติดตามผลจาก /api/monitor/progress
// ถ้ามีรอบอัตโนมัติกำลังวิ่งอยู่ จะไม่เริ่มซ้ำ (alreadyRunning) ให้ติดตามรอบนั้นแทน
app.post('/api/monitor/run', requireEditor, (req, res) => {
  const alreadyRunning = monitorState.running;
  if (!alreadyRunning) runMonitorCycle('manual').catch(() => {});
  // runMonitorCycle ตั้ง runId แบบ async — รอให้เริ่มก่อนตอบ (สูงสุด ~2 วินาที)
  const before = monitorProgress.runId;
  const startedAt = Date.now();
  const wait = () => {
    if (alreadyRunning || monitorProgress.runId !== before || !monitorState.running || Date.now() - startedAt > 2000) {
      return res.json({ ok: true, alreadyRunning, runId: monitorProgress.runId });
    }
    setTimeout(wait, 20);
  };
  wait();
});

// ความคืบหน้า + log ใหม่ตั้งแต่ seq ที่ส่งมา (since)
app.get('/api/monitor/progress', requireEditor, (req, res) => {
  const p = monitorProgress;
  const since = Number(req.query.since) || 0;
  const runId = Number(req.query.runId) || 0;
  // ถ้าเป็นรอบใหม่ (runId ไม่ตรง) ส่ง log ทั้งหมดของรอบนี้
  const entries = runId === p.runId ? p.entries.filter((e) => e.seq > since) : p.entries;
  res.json({
    runId: p.runId, source: p.source, running: p.running, startedAt: p.startedAt, finishedAt: p.finishedAt,
    total: p.total, done: p.done, counts: p.counts, changed: p.changed, note: p.note, entries,
  });
});

// ---------- catalog: ประเภท / สถานะ / โซน ----------
app.get('/api/catalog', async (req, res) => {
  try {
    res.json(await getCatalog());
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/catalog/:kind', requireAdmin, async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!CATALOG_KINDS[kind]) return res.status(404).json({ error: 'Not found' });
    const result = validateCatalog(kind, (req.body || {}).items);
    if (result.error) return res.status(400).json({ error: result.error });
    // ห้ามลบรายการที่อุปกรณ์ยังใช้อยู่
    const keep = new Set(result.items.map((i) => i.key));
    const field = DEVICE_FIELD_OF[kind];
    const inUse = {};
    for (const d of await listDevices()) {
      const v = d[field];
      if (v && !keep.has(v)) inUse[v] = (inUse[v] || 0) + 1;
    }
    const blocked = Object.entries(inUse);
    if (blocked.length) {
      const old = (await getCatalog())[kind];
      const names = blocked.map(([k, n]) => `${(old.find((i) => i.key === k) || { label: k }).label} (${n} เครื่อง)`);
      return res.status(409).json({ error: `ลบไม่ได้ ยังมีอุปกรณ์ใช้อยู่: ${names.join(', ')}` });
    }
    await setSetting(CATALOG_KINDS[kind], JSON.stringify(result.items));
    res.json(await getCatalog());
  } catch (err) {
    console.error('catalog save error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// อัปโหลดไอคอน/โลโก้ (multipart field "image") → คืน { icon: "/api/uploads/icon-....png" }
app.post('/api/catalog/icon', requireAdmin, uploadIconField, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์รูป (field "image")' });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `icon-${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    res.status(201).json({ icon: `/api/uploads/${filename}` });
  } catch (err) {
    console.error('Icon upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ---------- maps ----------
const UPLOADS_DIR = path.join(__dirname, 'uploads');

app.get('/api/maps', async (req, res) => {
  try {
    res.json(await listMaps());
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// อัปโหลดรูปแผนผัง (multipart field "image" + ฟิลด์ map_name / map_id)
app.post('/api/maps', requireAdmin, uploadImageField, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์รูป (field "image")' });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `map-${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    const map = await saveMap({
      map_id: (req.body.map_id || crypto.randomUUID()).toString().trim(),
      map_name: (req.body.map_name || req.file.originalname).toString().trim(),
      image_url: `/api/uploads/${filename}`,
      floor: (req.body.floor || '').toString().trim().slice(0, 50) || null
    });
    res.status(201).json(map);
  } catch (err) {
    console.error('Map upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// แก้ไขแผนผัง (ชื่อ / ชั้น)
app.put('/api/maps/:id', requireAdmin, async (req, res) => {
  try {
    const maps = await listMaps();
    const existing = maps.find((m) => m.map_id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const map = await saveMap({
      map_id: existing.map_id,
      map_name: String(body.map_name || existing.map_name).trim(),
      image_url: existing.image_url,
      floor: body.floor === undefined ? (existing.floor ?? null) : (String(body.floor).trim().slice(0, 50) || null)
    });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/maps/:id', requireAdmin, async (req, res) => {
  try {
    await deleteMapRow(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// เปลี่ยนรูปแผนผังเดิม (multipart field "image") — map_id/ชื่อ/ชั้นคงเดิม อุปกรณ์และตำแหน่งอยู่ครบ
app.post('/api/maps/:id/image', requireAdmin, uploadImageField, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์รูป (field "image")' });
    const existing = (await listMaps()).find((m) => m.map_id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `map-${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    // จำ URL เก่าก่อน saveMap (โหมด memory แก้ object เดิมในที่)
    const oldUrl = existing.image_url;
    const map = await saveMap({
      map_id: existing.map_id,
      map_name: existing.map_name,
      image_url: `/api/uploads/${filename}`,
      floor: existing.floor ?? null
    });
    // ลบรูปเก่าที่อยู่ใน uploads ของเรา (ไม่แตะ URL ภายนอก)
    if (oldUrl && oldUrl.startsWith('/api/uploads/')) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(oldUrl));
      if (oldPath !== path.join(UPLOADS_DIR, filename)) {
        try {
          fs.rmSync(oldPath, { force: true });
        } catch {
          /* ลบไม่ได้ก็ข้ามไป */
        }
      }
    }
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// นำเข้าแผนผังทั้งชุด (สคริปต์ import-from-sheet.js)
app.post('/api/maps/import', requireAdmin, async (req, res) => {
  try {
    const rows = Array.isArray(req.body && req.body.maps) ? req.body.maps : [];
    const result = await replaceAllMaps(rows);
    await addLog({ action: 'imported', details: `นำเข้าแผนผัง ${result.imported} รายการ (skipped ${result.skipped})` });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Import maps error:', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// ---------- logs ----------
app.get('/api/logs', async (req, res) => {
  try {
    res.json(await listLogs({ limit: req.query.limit, deviceId: req.query.device_id || null }));
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// สถิติเหตุการณ์ online/offline รายวัน (หน้า Dashboard) — นับตามวันเวลาไทย
const bkkDate = (ts) => new Date(new Date(ts).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

app.get('/api/stats/events', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);
    const since = new Date(Date.now() - days * 86400 * 1000);
    let rows;
    if (USE_DB) {
      rows = await query(
        "SELECT timestamp, action, device_id, device_name FROM logs WHERE action IN ('down','up') AND timestamp >= ?",
        [since]
      );
    } else {
      rows = memLogs.filter((l) => (l.action === 'down' || l.action === 'up') && new Date(l.timestamp) >= since);
    }
    const perDay = new Map();
    const perDevice = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      const d = bkkDate(r.timestamp);
      const b = perDay.get(d) || { date: d, down: 0, up: 0 };
      b[r.action === 'down' ? 'down' : 'up']++;
      perDay.set(d, b);
      if (r.action === 'down') {
        const k = r.device_id || r.device_name || '?';
        const x = perDevice.get(k) || { device_id: r.device_id || null, device_name: r.device_name || '—', down: 0 };
        x.down++;
        perDevice.set(k, x);
      }
    }
    res.json({
      days,
      today: bkkDate(Date.now()),
      daily: [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      top: [...perDevice.values()].sort((a, b) => b.down - a.down).slice(0, 8),
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// นำเข้าประวัติทั้งชุด (สคริปต์ import-from-sheet.js)
app.post('/api/logs/import', requireAdmin, async (req, res) => {
  try {
    const rows = Array.isArray(req.body && req.body.logs) ? req.body.logs : [];
    const result = await replaceAllLogs(rows);
    await addLog({ action: 'imported', details: `นำเข้าประวัติ ${result.imported} รายการ (skipped ${result.skipped})` });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Import logs error:', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// ---------- settings ----------
const PUBLIC_SETTINGS = ['MONITOR_ENABLED', 'MONITOR_INTERVAL_SEC',
  'MONITOR_TIMEOUT_MS', 'MONITOR_FAIL_THRESHOLD', 'MONITOR_WARN_MS', 'MONITOR_TYPES', 'IPTABLE_AUTO_ADD', 'IPTABLE_AUTO_REMOVE', 'XLSX_AUTO_SYNC'];
const WRITABLE_SETTINGS = PUBLIC_SETTINGS;

app.get('/api/settings', async (req, res) => {
  try {
    const out = {};
    for (const key of PUBLIC_SETTINGS) out[key] = await getSetting(key);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/settings', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    for (const key of WRITABLE_SETTINGS) {
      if (body[key] !== undefined) await setSetting(key, String(body[key]));
    }
    scheduleMonitor(); // interval อาจเปลี่ยน
    if (body.XLSX_AUTO_SYNC === 'TRUE') scheduleXlsxSync('เปิดซิงก์อัตโนมัติ', 500);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- telegram ----------
// token เป็นความลับ: ไม่ส่งกลับ — บอกแค่ว่าตั้งไว้แล้วหรือยัง + 4 ตัวท้าย
app.get('/api/telegram', requireAdmin, async (req, res) => {
  try {
    const cfg = await telegramConfig();
    res.json({
      enabled: cfg.enabled,
      chatId: cfg.chatId,
      notifyRecovery: cfg.notifyRecovery,
      tokenSet: !!cfg.token,
      tokenHint: cfg.token ? `…${cfg.token.slice(-4)}` : '',
      lastSentAt: telegramState.lastSentAt,
      lastError: telegramState.lastError,
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/telegram', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const chatId = b.chatId !== undefined ? String(b.chatId).trim() : undefined;
    const token = b.token !== undefined ? String(b.token).trim() : undefined;
    if (chatId && !/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(chatId)) return res.status(400).json({ error: 'Chat ID ต้องเป็นตัวเลข (เช่น -1001234567890) หรือ @ชื่อช่อง' });
    if (token && !TOKEN_RE.test(token)) return res.status(400).json({ error: 'รูปแบบ Bot Token ไม่ถูกต้อง (เช่น 123456789:AA...)' });
    if (b.enabled !== undefined) await setSetting('TELEGRAM_ENABLED', b.enabled ? 'TRUE' : 'FALSE');
    if (b.notifyRecovery !== undefined) await setSetting('TELEGRAM_NOTIFY_RECOVERY', b.notifyRecovery ? 'TRUE' : 'FALSE');
    if (chatId !== undefined) await setSetting('TELEGRAM_CHAT_ID', chatId);
    if (token !== undefined) await setSetting('TELEGRAM_BOT_TOKEN', token); // ส่งมาเฉพาะตอนเปลี่ยน ('' = ลบ)
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ส่งข้อความทดสอบ — ใช้ token/chatId ที่ส่งมา (ทดสอบก่อนบันทึก) หรือค่าที่บันทึกไว้
app.post('/api/telegram/test', requireAdmin, async (req, res) => {
  try {
    const saved = await telegramConfig();
    const token = String(req.body?.token || '').trim() || saved.token;
    const chatId = String(req.body?.chatId || '').trim() || saved.chatId;
    await sendTelegram(`✅ <b>ทดสอบการแจ้งเตือน</b>\nระบบ Monitoring Device เชื่อมต่อ Telegram สำเร็จ\n🕒 ${escHtml(thaiTime())}`, { token, chatId });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== START ==========
const PORT = process.env.PORT || 5000;
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Monitoring Device backend listening on port ${PORT} (mode: ${USE_DB ? 'mariadb' : 'memory'})`));
    runMonitorCycle().finally(scheduleMonitor);
    if (process.env.XLSX_WATCH !== 'off') startXlsxWatch();
  })
  .catch((err) => {
    console.error('Failed to init DB:', err);
    process.exit(1);
  });
