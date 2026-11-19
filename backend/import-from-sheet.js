// ย้ายข้อมูลจาก Google Sheet (CCTV เดิม) เข้า database ผ่าน API — ใช้ได้ทั้งโหมด in-memory และ MariaDB
//
//   npm run import:sheet                        นำเข้ากล้อง + แผนผัง + ประวัติ
//   npm run import:sheet -- --dry-run           ดูจำนวนที่จะนำเข้าโดยยังไม่เขียน
//   npm run import:sheet -- --only devices,maps
//   npm run import:sheet -- --url http://localhost:5000 --secret admin --sheet <SPREADSHEET_ID>
//
// ต้องรัน backend ไว้ก่อน (npm run dev) และ Sheet ต้องเปิดแชร์ "ใครก็ตามที่มีลิงก์ดูได้"
// หมายเหตุ: แทนที่อุปกรณ์ประเภท camera / แผนผัง / ประวัติทั้งหมด — อุปกรณ์ประเภทอื่นไม่โดนลบ

require('dotenv').config();

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const BASE = `${opt('url', `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '')}/api`;
const SECRET = opt('secret', process.env.ADMIN_SECRET || 'admin');
const SHEET_ID = opt('sheet', '1t39Imb5HlJm-QJwUxsk8bLM9sWUeUf8doDiLFYGfYoo');
const ONLY = (opt('only', 'devices,maps,logs,settings') || '').split(',').map((s) => s.trim());
const DRY_RUN = args.includes('--dry-run');

async function api(method, path, body) {
  const headers = { 'x-admin-secret': SECRET, 'Content-Type': 'application/json' };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || ''}`);
  return data;
}

// ดึงแท็บด้วย gviz (รองรับชื่อแท็บภาษาไทย/ช่องว่าง) — คืน array ของ object ตามชื่อคอลัมน์
async function fetchSheetTab(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  const text = await (await fetch(url)).text();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`อ่านแท็บ ${tab} ไม่ได้ (เช็คว่าเปิดแชร์ลิงก์หรือยัง)`);
  // gviz ส่งวันที่เป็น Date(y,m,d,h,mi,s) ซึ่งไม่ใช่ JSON — แปลงเป็น string ก่อน parse (เดือนเริ่มจาก 0)
  // บาง response ครอบ Date(...) ด้วย quote อยู่แล้ว ("Date(...)") บางแบบเป็น bare Date(...) — จัดการทั้ง 2 แบบ
  const toDateStr = (_, y, mo, d, h = '0', mi = '0', s = '0') => {
    const p = (n) => String(n).padStart(2, '0');
    return `"${y}-${p(Number(mo) + 1)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}"`;
  };
  const jsonText = m[0]
    .replace(/"Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)"/g, toDateStr)
    .replace(/(?<!")Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)(?!")/g, toDateStr);
  const data = JSON.parse(jsonText);
  if (data.status !== 'ok') throw new Error(`แท็บ ${tab}: ${(data.errors && data.errors[0] && data.errors[0].detailed_message) || data.status}`);
  const cols = (data.table.cols || []).map((c) => (c.label || '').trim());
  const rows = [];
  for (const r of data.table.rows || []) {
    const obj = {};
    let hasValue = false;
    (r.c || []).forEach((cell, i) => {
      const v = cell ? cell.v : null;
      if (v !== null && v !== '') hasValue = true;
      if (cols[i]) obj[cols[i]] = v;
    });
    if (hasValue) rows.push(obj);
  }
  return rows;
}

function extractDriveId(row) {
  const direct = (row.drive_file_id || row.file_id || '').toString().trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(direct)) return direct;
  const fromUrl = ((row.drive_url || '').toString().match(/\/d\/([A-Za-z0-9_-]{10,})/) || [])[1];
  if (fromUrl) return fromUrl;
  const fromId = ((row.map_id || '').toString().match(/[A-Za-z0-9_-]{25,}/) || [])[0];
  return fromId || '';
}

async function main() {
  console.log(`Sheet: ${SHEET_ID}${DRY_RUN ? ' (dry-run — ไม่เขียนข้อมูล)' : ''}`);

  if (ONLY.includes('devices')) {
    const rows = await fetchSheetTab('CCTV');
    const devices = rows.filter((r) => r.id).map((r) => ({ ...r, id: String(r.id) }));
    console.log(`CCTV: ${devices.length} กล้อง (ข้าม ${rows.length - devices.length} แถวไม่มี id)`);
    if (!DRY_RUN) {
      const res = await api('POST', '/devices/import', { type: 'camera', devices });
      console.log(`  → imported=${res.imported} skipped=${res.skipped}`);
    }
  }

  if (ONLY.includes('maps')) {
    const rows = await fetchSheetTab('maps');
    const maps = [];
    let skipped = 0;
    for (const r of rows) {
      const fileId = extractDriveId(r);
      if (!r.map_id || !fileId) { skipped++; continue; }
      maps.push({
        map_id: String(r.map_id),
        map_name: String(r.map_name || r.map_id),
        image_url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`
      });
    }
    console.log(`maps: ${maps.length} แผนผัง (ข้าม ${skipped} แถวไม่มี file id)`);
    if (maps.length > 0 && !DRY_RUN) {
      const res = await api('POST', '/maps/import', { maps });
      console.log(`  → imported=${res.imported} skipped=${res.skipped}`);
    }
  }

  if (ONLY.includes('logs')) {
    const rows = await fetchSheetTab('Logs');
    const logs = rows.filter((r) => r.action).map((r) => ({
      timestamp: r.timestamp || null,
      employee_id: r.employee_id || null,
      employee_name: r.employee_name || null,
      action: String(r.action),
      device_id: r.camera_id || null,
      device_name: r.camera_name || null,
      zone: r.zone || null,
      floor: r.floor || null,
      details: r.details || null,
      old_values: r.old_values_json || null,
      new_values: r.new_values_json || null
    }));
    console.log(`Logs: ${logs.length} รายการ (ข้าม ${rows.length - logs.length} แถวไม่มี action)`);
    if (!DRY_RUN) {
      const res = await api('POST', '/logs/import', { logs });
      console.log(`  → imported=${res.imported} skipped=${res.skipped}`);
    }
  }

  console.log('เสร็จ');
}

main().catch((err) => {
  console.error('Import ล้มเหลว:', err.message);
  process.exit(1);
});
