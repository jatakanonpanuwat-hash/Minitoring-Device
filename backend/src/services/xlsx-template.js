// สร้างไฟล์เทมเพลต Excel สำหรับกรอกข้อมูลกล้อง (แท็บ cctv + Maps) — รูปแบบเดียวกับที่ปุ่มนำเข้าอ่าน
// แก้คอลัมน์ที่นี่ต้องตรงกับ toDevice() ใน lib/xlsx.js (ชื่อหัวคอลัมน์ = ชื่อฟิลด์)
const { buildWorkbook } = require('../lib/xlsx-writer');
const { getCatalog } = require('../models/catalog');
const { listDevices } = require('../models/devices');
const { listMaps } = require('../models/maps');

const MAX_ROWS = 2000; // dropdown/ตรวจตัวเลข ครอบคลุมถึงแถวนี้

// คอลัมน์แท็บ cctv: key = หัวคอลัมน์, desc = คำอธิบายในแท็บ "วิธีใช้"
const CAMERA_COLUMNS = [
  { key: 'id', width: 22, desc: 'รหัสกล้อง (จำเป็น, ห้ามซ้ำ) เช่น cam_001 — แถวที่ไม่มี id จะถูกข้าม / id เดิม = แก้กล้องตัวเดิม' },
  { key: 'name', width: 22, desc: 'ชื่อกล้องที่แสดงบนแผนผัง' },
  { key: 'zone', width: 14, desc: 'โซน — เลือกจาก dropdown (พิมพ์ชื่อใหม่ได้ ระบบจะเพิ่มโซนให้)' },
  { key: 'floor', width: 8, desc: 'ชั้น' },
  { key: 'map_id', width: 22, desc: 'แผนผังที่กล้องอยู่ — เลือกจาก dropdown (รายการในแท็บ Maps)' },
  { key: 'x_percent', width: 11, desc: 'พิกัดแนวนอนบนรูปแผนผัง เป็น % ของความกว้าง (0 = ซ้ายสุด, 100 = ขวาสุด)' },
  { key: 'y_percent', width: 11, desc: 'พิกัดแนวตั้งบนรูปแผนผัง เป็น % ของความสูง (0 = บนสุด, 100 = ล่างสุด)' },
  { key: 'direction', width: 10, desc: 'ทิศที่กล้องหัน 0–360 องศา (0 = ขึ้นบน, 90 = ขวา, 180 = ลง, 270 = ซ้าย)' },
  { key: 'fov_angle', width: 10, desc: 'มุมมองภาพของกล้อง 1–360 องศา (ทั่วไป 60–110)' },
  { key: 'ip_address', width: 16, desc: 'IP ของกล้อง — ใช้ ping ตรวจสถานะ' },
  { key: 'lan', width: 16, desc: 'สวิตช์/LAN ที่กล้องต่ออยู่' },
  { key: 'model', width: 16, desc: 'รุ่นกล้อง' },
  { key: 'status', width: 12, desc: 'สถานะเริ่มต้น — เลือกจาก dropdown (ว่าง = ให้ระบบ ping หาเอง)' },
  { key: 'cabinet', width: 12, desc: 'ตู้ที่ติดตั้งอุปกรณ์' },
  { key: 'install_area', width: 16, desc: 'พื้นที่ติดตั้ง' },
  { key: 'install_detail', width: 22, desc: 'รายละเอียดการติดตั้ง' },
  { key: 'requested_by', width: 14, desc: 'ผู้ขอติดตั้ง' },
  { key: 'remark', width: 22, desc: 'หมายเหตุ' },
  { key: 'updated_by', width: 14, desc: 'ผู้แก้ไขล่าสุด' },
];

const MAP_COLUMNS = [
  { key: 'map_id', width: 22, desc: 'รหัสแผนผัง (จำเป็น) — แผนผังที่มีในระบบแล้วจะใช้รูปเดิม' },
  { key: 'map_name', width: 26, desc: 'ชื่อแผนผัง' },
  { key: 'drive_file_id', width: 36, desc: 'แผนผังใหม่: id ไฟล์รูปใน Google Drive (ต้องแชร์แบบ "ทุกคนที่มีลิงก์")' },
  { key: 'drive_url', width: 40, desc: 'แผนผังใหม่: หรือใส่ลิงก์ Google Drive ของรูปแทน drive_file_id' },
];

const col = (key) => CAMERA_COLUMNS.findIndex((c) => c.key === key);

// คอลัมน์ตัวเลข — MariaDB คืน DECIMAL เป็นข้อความ ต้องแปลงก่อน ไม่งั้น Excel เก็บเป็น text
const NUMERIC = new Set(['x_percent', 'y_percent', 'direction', 'fov_angle']);
function cellValue(key, v) {
  if (v === null || v === undefined || v === '') return null;
  if (NUMERIC.has(key)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return String(v);
}

// withData = ใส่กล้อง/แผนผังที่มีในระบบตอนนี้ไว้ด้วย (แก้แล้วนำเข้ากลับได้เลย)
async function buildCameraTemplate({ withData }) {
  const [catalog, maps, devices] = await Promise.all([getCatalog(), listMaps(), withData ? listDevices() : []]);
  const cameras = devices.filter((d) => d.device_type === 'camera');
  const zones = catalog.zones.map((z) => z.key);
  const statuses = catalog.statuses.map((s) => s.key);
  const mapIds = maps.map((m) => m.map_id);

  // แท็บซ่อนเก็บรายการให้ dropdown (ไม่จำกัด 255 ตัวอักษรเหมือนใส่รายการตรง ๆ)
  const listRows = Math.max(zones.length, statuses.length, 1);
  const lists = {
    name: 'lists',
    hidden: true,
    columns: [{ header: 'zone' }, { header: 'status' }],
    rows: Array.from({ length: listRows }, (_, i) => [zones[i] ?? null, statuses[i] ?? null]),
  };
  const range = (letter, n) => `'lists'!$${letter}$2:$${letter}$${Math.max(2, n + 1)}`;

  const cctv = {
    name: 'cctv',
    columns: CAMERA_COLUMNS.map((c) => ({ header: c.key, width: c.width })),
    rows: cameras.map((d) => CAMERA_COLUMNS.map((c) => cellValue(c.key, d[c.key]))),
    validations: [
      { col: col('zone'), type: 'list', source: range('A', zones.length) },
      { col: col('status'), type: 'list', source: range('B', statuses.length) },
      { col: col('map_id'), type: 'list', source: `Maps!$A$2:$A$${MAX_ROWS}` },
      { col: col('x_percent'), type: 'decimal', min: 0, max: 100, prompt: '% จากซ้าย (0–100)' },
      { col: col('y_percent'), type: 'decimal', min: 0, max: 100, prompt: '% จากบน (0–100)' },
      { col: col('direction'), type: 'decimal', min: 0, max: 360, prompt: 'องศา 0–360 (0 = ขึ้นบน)' },
      { col: col('fov_angle'), type: 'decimal', min: 1, max: 360, prompt: 'มุมมอง (องศา)' },
    ],
  };

  const mapsSheet = {
    name: 'Maps',
    columns: MAP_COLUMNS.map((c) => ({ header: c.key, width: c.width })),
    rows: maps.map((m) => [m.map_id, m.map_name, null, null]),
  };

  const guideRows = [
    ['เทมเพลตข้อมูลกล้อง — Monitoring Device', null],
    [null, null],
    ['วิธีใช้', null],
    ['1.', 'กรอกกล้องในแท็บ cctv แถวละ 1 ตัว (ห้ามแก้ชื่อหัวคอลัมน์ในแถวแรก)'],
    ['2.', 'พิกัด x_percent / y_percent คิดเป็น % ของรูปแผนผัง — ดูตำแหน่งได้จากหน้าแผนผังในเว็บ'],
    ['3.', 'บันทึกไฟล์ แล้วไปที่ Settings → นำเข้าจาก Excel → เลือกไฟล์ → ตรวจสรุป → กดนำเข้า'],
    [null, null],
    ['⚠ สำคัญ', 'การนำเข้าจะ "แทนที่" กล้องทั้งหมดในระบบด้วยรายการในไฟล์ — กล้องที่ไม่มีในไฟล์จะถูกลบ'],
    [null, 'ถ้าจะเพิ่ม/แก้บางตัว ให้ดาวน์โหลดแบบ "พร้อมข้อมูลปัจจุบัน" แล้วแก้ต่อจากนั้น'],
    [null, null],
    ['คอลัมน์แท็บ cctv', null],
    ...CAMERA_COLUMNS.map((c) => [c.key, c.desc]),
    [null, null],
    ['คอลัมน์แท็บ Maps', null],
    ...MAP_COLUMNS.map((c) => [c.key, c.desc]),
    [null, null],
    ['แผนผังในระบบตอนนี้', null],
    ...(maps.length ? maps.map((m) => [m.map_id, m.map_name]) : [['(ยังไม่มี)', 'เพิ่มแผนผังในเว็บก่อน หรือใส่ลิงก์ Google Drive ในแท็บ Maps']]),
  ];
  const titleRows = new Set(['เทมเพลตข้อมูลกล้อง — Monitoring Device']);
  const headRows = new Set(['วิธีใช้', '⚠ สำคัญ', 'คอลัมน์แท็บ cctv', 'คอลัมน์แท็บ Maps', 'แผนผังในระบบตอนนี้']);
  const guide = {
    name: 'วิธีใช้',
    header: false,
    wrap: true,
    columns: [{ width: 22 }, { width: 90 }],
    rows: guideRows,
    rowStyles: Object.fromEntries(guideRows.map((r, i) => [i, titleRows.has(r[0]) ? 'title' : headRows.has(r[0]) ? 'header' : null]).filter(([, s]) => s)),
  };

  // แท็บ cctv ต้องชื่อนี้ (ตัวนำเข้าหาจากชื่อ) — เปิดไฟล์มาเจอแท็บวิธีใช้ก่อน
  return buildWorkbook([guide, cctv, mapsSheet, lists], { maxRows: MAX_ROWS });
}

module.exports = { buildCameraTemplate, CAMERA_COLUMNS, MAP_COLUMNS };
