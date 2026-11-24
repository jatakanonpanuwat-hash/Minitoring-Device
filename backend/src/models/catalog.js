// รายการ ประเภท / สถานะ / โซน ที่ผู้ดูแลกำหนดเองได้ (หน้า Settings → จัดการรายการ)
// เก็บเป็น JSON ในค่าตั้ง CATALOG_TYPES / CATALOG_STATUSES / CATALOG_ZONES
// icon: "lucide:<ชื่อไอคอน>" (ชุดไอคอนใน frontend) หรือ "/api/uploads/icon-....png" (โลโก้ที่อัปโหลด)
const { getSetting, setSetting } = require('./settings');

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

// ชนิดรายการ → ชื่อค่าตั้งที่เก็บ / ฟิลด์ของอุปกรณ์ที่อ้างถึง
const CATALOG_KINDS = { types: 'CATALOG_TYPES', statuses: 'CATALOG_STATUSES', zones: 'CATALOG_ZONES' };
const DEVICE_FIELD_OF = { types: 'device_type', statuses: 'status', zones: 'zone' };

// โซนเดิมใช้ชื่อเป็น key (ภาษาไทย/ช่องว่างได้) — กันแค่อักขระควบคุมและเครื่องหมายที่ใช้แทรก HTML
const KEY_RE = /^[^<>"'`\\\u0000-\u001f]{1,60}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_RE = /^(lucide:[A-Za-z0-9]{1,40}|\/api\/uploads\/icon-[A-Za-z0-9-]+\.(png|jpe?g|gif|webp|svg))$/;

const ZONE_COLORS = ['#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#db2777', '#7c3aed', '#475569'];

// JSON array หรือ null (ข้อความเสีย / ไม่ใช่ array)
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
    // require ตอนเรียก (ไม่ใช่ด้านบน) เพราะ devices.js ก็ require ไฟล์นี้ — กัน require วนกัน
    const { listDevices } = require('./devices');
    const names = [...new Set((await listDevices()).map((d) => d.zone).filter(Boolean))].sort();
    zones = names.map((n, i) => ({ key: n, label: n, color: ZONE_COLORS[i % ZONE_COLORS.length], icon: '' }));
    await setSetting('CATALOG_ZONES', JSON.stringify(zones));
  }
  return { types, statuses, zones };
}

async function saveCatalogKind(kind, items) {
  await setSetting(CATALOG_KINDS[kind], JSON.stringify(items));
}

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

// เพิ่มโซนที่ยังไม่มีในรายการ (เช่นมาจากสคริปต์ seed หรือ API) — ไม่ให้ข้อมูลหลุดรายการ
async function ensureZone(zone) {
  if (!zone) return;
  const { zones } = await getCatalog();
  if (zones.some((z) => z.key === zone)) return;
  zones.push({ key: zone, label: zone, color: ZONE_COLORS[zones.length % ZONE_COLORS.length], icon: '' });
  await setSetting('CATALOG_ZONES', JSON.stringify(zones));
}

// สถานะ relocated จาก Sheet เดิม — เพิ่มเข้ารายการสถานะถ้ายังไม่มี (ยังถูก ping ตามปกติ)
async function ensureRelocatedStatus() {
  const saved = parseJson(await getSetting('CATALOG_STATUSES')) || [];
  if (saved.some((s) => s.key === 'relocated')) return;
  saved.push({ key: 'relocated', label: 'Relocated', color: '#6b7280', icon: '', pause_monitor: false });
  await setSetting('CATALOG_STATUSES', JSON.stringify(saved));
}

// key ของสถานะที่ "หยุด ping" (เช่น maintenance)
async function pausedStatusKeys() {
  return new Set((await getCatalog()).statuses.filter((s) => s.pause_monitor).map((s) => s.key));
}

module.exports = {
  CATALOG_KINDS, DEVICE_FIELD_OF, KEY_RE,
  getCatalog, saveCatalogKind, validateCatalog, ensureZone, ensureRelocatedStatus, pausedStatusKeys,
};
