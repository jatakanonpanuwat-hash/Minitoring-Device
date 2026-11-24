// อ่านไฟล์ Excel (.xlsx ที่ export จาก Google Sheet CCTV เดิม) — ไม่ต้องลง package
// อ่าน zip + XML เอง และอ่านค่าดิบ — ช่องที่ Excel แสดงเป็นวันที่ผิด ๆ (เช่น FOV 60 → 1900-02-28) จะได้ตัวเลขเดิม
// ใช้โดย: services/xlsx-sync.js (ซิงก์อัตโนมัติ), routes/import.js (อัปโหลดจากหน้าเว็บ), scripts/import-from-xlsx.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { XLSX_FILE } = require('../config');

// ไฟล์ในโปรเจกต์ (backend/data/CCTV-MECHA-PART.xlsx หรือ XLSX_FILE ใน .env)
const DEFAULT_XLSX = XLSX_FILE;

// ---------- xlsx reader ----------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ไม่ใช่ไฟล์ .xlsx (zip)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip central directory เสีย');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    files[name] = () => (method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

const textOf = (xml) => decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// file = path หรือ Buffer ของไฟล์ .xlsx
const toBuf = (file) => (Buffer.isBuffer(file) ? file : fs.readFileSync(file));

// อ่านแท็บเป็น array ของ object (แถวแรก = หัวตาราง) — ไม่พบแท็บ = throw
function readSheet(file, sheetName) {
  const zip = unzip(toBuf(file));
  const read = (n) => (zip[n] ? zip[n]().toString('utf8') : '');
  const workbook = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)].map((m) => ({ name: decodeXml(m[1]), rid: m[2] }));
  const sheet = sheets.find((s) => s.name.trim().toLowerCase() === sheetName.toLowerCase());
  if (!sheet) throw new Error(`ไม่พบแท็บ "${sheetName}" (มี: ${sheets.map((s) => s.name).join(', ')})`);
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${sheet.rid}"`));
  let target = (rel.match(/Target="([^"]*)"/) || [])[1];
  target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const rows = [];
  for (const rm of read(target).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const t = (attrs.match(/\bt="([^"]*)"/) || [])[1];
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = null;
      if (t === 's') val = v != null ? shared[Number(v)] : null;
      else if (t === 'inlineStr') val = textOf(inner);
      else if (t === 'str' || t === 'e') val = v != null ? decodeXml(v) : null;
      else if (t === 'b') val = v === '1';
      else if (v != null) val = Number(v);
      if (ref) row[colIndex(ref)] = val;
    }
    rows.push(row);
  }
  const header = (rows.shift() || []).map((h) => String(h ?? '').trim());
  return rows
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null]).filter(([h]) => h)))
    .filter((o) => Object.values(o).some((v) => v !== null && v !== ''));
}

// รายชื่อแท็บทั้งหมดในไฟล์
function listSheets(file) {
  const zip = unzip(toBuf(file));
  const workbook = zip['xl/workbook.xml']().toString('utf8');
  return [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]).trim());
}

// ---------- mapping: แถวในแท็บ cctv → อุปกรณ์ ----------
const num = (v) => {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

function toDevice(r) {
  return {
    id: str(r.id),
    name: str(r.name),
    zone: str(r.zone),
    floor: str(r.floor),
    x_percent: num(r.x_percent),
    y_percent: num(r.y_percent),
    ip_address: str(r.ip_address),
    model: str(r.model),
    status: str(r.status),
    remark: str(r.remark),
    map_id: str(r.map_id),
    direction: num(r.direction),
    fov_angle: num(r.fov_angle),
    lan: str(r.lan),
    cabinet: str(r.cabinet),
    install_area: str(r.install_area),
    install_detail: str(r.install_detail),
    requested_by: str(r.requested_by),
    updated_by: str(r.updated_by),
  };
}

// รูปแผนผัง: จากไฟล์ในเครื่อง (localImages[mapId] = path) หรือโหลดจาก Google Drive (ไฟล์ต้องแชร์แบบลิงก์)
// คืน { buf, name } หรือ null
async function loadMapImage(mapId, row, localImages = {}) {
  if (localImages[mapId]) {
    const file = localImages[mapId];
    return { buf: fs.readFileSync(file), name: path.basename(file) };
  }
  const fileId = str(row.drive_file_id) || ((str(row.drive_url) || '').match(/id=([\w-]{10,})|\/d\/([\w-]{10,})/) || []).slice(1).find(Boolean);
  if (!fileId) return null;
  try {
    const res = await fetch(`https://drive.google.com/thumbnail?id=${fileId}&sz=w4000`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
    return { buf: Buffer.from(await res.arrayBuffer()), name: `${mapId}${ext}` };
  } catch {
    return null;
  }
}

// อ่านทั้งไฟล์ในครั้งเดียว — { sheets, devices, skippedDevices, mapRows, warnings }
function parseWorkbook(file, { cameras = true, sheet = 'cctv' } = {}) {
  const buf = toBuf(file);
  const sheets = listSheets(buf);
  const out = { sheets, devices: [], skippedDevices: 0, mapRows: [], warnings: [] };
  if (cameras) {
    if (sheets.some((n) => n.toLowerCase() === sheet.toLowerCase())) {
      const rows = readSheet(buf, sheet);
      out.devices = rows.map(toDevice).filter((d) => d.id);
      out.skippedDevices = rows.length - out.devices.length;
    } else out.warnings.push(`ไม่พบแท็บ "${sheet}" — ข้ามกล้อง`);
    try {
      out.mapRows = readSheet(buf, 'Maps').filter((r) => str(r.map_id));
    } catch (err) {
      out.warnings.push(`ข้ามแผนผัง: ${err.message}`);
    }
  }
  return out;
}

module.exports = { DEFAULT_XLSX, readSheet, parseWorkbook, loadMapImage, toDevice, str };
