// นำเข้ากล้องจากไฟล์ Excel (export จาก Google Sheet CCTV เดิม) ผ่าน API — ใช้ได้ทั้งโหมด in-memory และ MariaDB
// (backend ต้องรันอยู่ — สคริปต์นี้เรียก API ไม่ได้เขียนข้อมูลเอง)
//
//   npm run import:xlsx -- --file "C:\...\CCTV-MECHA-PART.xlsx" --dry-run
//   npm run import:xlsx -- --file "C:\...\CCTV-MECHA-PART.xlsx" \
//        --map-image "MAP-17889417978541=C:\...\Layout-MECHA-1-2-1FL.png"
//   npm run import:xlsx -- --file ... --clear      ลบกล้องที่นำเข้า (ประเภท camera ทั้งหมด)
//
// - แท็บ `cctv` → อุปกรณ์ประเภท camera (แทนที่เฉพาะประเภท camera — ประเภทอื่นไม่โดนลบ)
// - แท็บ `Maps` → แผนผังทีละแผ่นตาม map_id เดิม (ไม่ลบแผนผังอื่นที่มีอยู่)
//     รูปมาจาก --map-image MAP_ID=path (ใส่ซ้ำได้หลายแผ่น) ถ้าไม่ระบุจะลองโหลดรูปจาก Google Drive (ไฟล์ต้องแชร์แบบลิงก์)
// - ไม่นำเข้า Logs / settings / inventory
// - ตัวอ่านไฟล์ .xlsx อยู่ที่ src/lib/xlsx.js (ใช้ร่วมกับปุ่มนำเข้าในหน้าเว็บ)

require('dotenv').config();
const fs = require('fs');
const { DEFAULT_XLSX, readSheet, loadMapImage, toDevice, str } = require('../src/lib/xlsx');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const optAll = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const BASE = `${opt('url', `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '')}/api`;
const SECRET = opt('secret', process.env.ADMIN_SECRET || 'admin');
// ไฟล์ในโปรเจกต์ (เปิดเห็นใน VS Code) — ใช้เมื่อไม่ระบุ --file, เปลี่ยนได้ด้วย XLSX_FILE ใน .env
const FILE = opt('file', DEFAULT_XLSX);
const DRY_RUN = args.includes('--dry-run');
const CLEAR = args.includes('--clear');
const SHEET = opt('sheet', 'cctv');

async function api(method, p, body) {
  const headers = { 'x-admin-secret': SECRET };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${data.error || ''}`);
  return data;
}

async function main() {
  if (!FILE) throw new Error('ต้องระบุ --file "path\\to\\file.xlsx"');
  if (!fs.existsSync(FILE)) throw new Error(`ไม่พบไฟล์ ${FILE}`);

  const localImages = {};
  for (const spec of optAll('map-image')) {
    const i = spec.indexOf('=');
    if (i < 1) throw new Error(`--map-image ต้องเป็น MAP_ID=path (ได้ "${spec}")`);
    const file = spec.slice(i + 1).replace(/^"|"$/g, '');
    if (!fs.existsSync(file)) throw new Error(`ไม่พบรูป ${file}`);
    localImages[spec.slice(0, i).trim()] = file;
  }

  const rows = readSheet(FILE, SHEET);
  const devices = rows.map(toDevice).filter((d) => d.id);
  const statuses = {};
  const perMap = {};
  devices.forEach((d) => {
    statuses[d.status || '(ว่าง)'] = (statuses[d.status || '(ว่าง)'] || 0) + 1;
    perMap[d.map_id || '(ไม่มีแผนผัง)'] = (perMap[d.map_id || '(ไม่มีแผนผัง)'] || 0) + 1;
  });
  console.log(`แท็บ ${SHEET}: ${devices.length} กล้อง (ข้าม ${rows.length - devices.length} แถวไม่มี id)`);
  console.log(`  สถานะ: ${Object.entries(statuses).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  แผนผัง: ${Object.entries(perMap).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  let mapRows = [];
  try {
    mapRows = readSheet(FILE, 'Maps').filter((r) => str(r.map_id));
  } catch (err) {
    console.log(`  (ข้ามแผนผัง: ${err.message})`);
  }

  if (DRY_RUN) {
    mapRows.forEach((r) => console.log(`  map ${r.map_id} "${str(r.map_name)}" → ${localImages[r.map_id] ? `รูป ${localImages[r.map_id]}` : 'จะลองโหลดจาก Google Drive'}`));
    console.log('dry-run — ยังไม่เขียนข้อมูล');
    return;
  }

  await api('GET', '/admin/check');

  if (CLEAR) {
    const res = await api('POST', '/devices/import', { type: 'camera', devices: [] });
    console.log(`ลบกล้องประเภท camera แล้ว (เหลือ ${res.imported})`);
    return;
  }

  for (const r of mapRows) {
    const mapId = str(r.map_id);
    const mapName = str(r.map_name) || mapId;
    const img = await loadMapImage(mapId, r, localImages);
    if (!img) {
      console.log(`  map ${mapId} "${mapName}": ไม่มีรูป (ใส่ --map-image ${mapId}=path) — ข้าม`);
      continue;
    }
    const form = new FormData();
    form.append('image', new Blob([img.buf]), img.name);
    form.append('map_id', mapId);
    form.append('map_name', mapName);
    await api('POST', '/maps', form);
    console.log(`  map ${mapId} "${mapName}": อัปโหลดรูปแล้ว (${(img.buf.length / 1024 / 1024).toFixed(1)}MB)`);
  }

  const res = await api('POST', '/devices/import', { type: 'camera', devices });
  console.log(`นำเข้ากล้อง ${res.imported} ตัว (skipped ${res.skipped}) — backend จะเริ่ม ping ในรอบถัดไป`);
}

main().catch((err) => {
  console.error('Import ล้มเหลว:', err.message, err.cause ? `(${err.cause.code || err.cause.message})` : '');
  process.exit(1);
});
