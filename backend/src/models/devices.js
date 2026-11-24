// อุปกรณ์ (ตาราง devices / mem.devices) — ทุกฟังก์ชันทำงานเหมือนกันทั้งโหมด MariaDB และโหมดไฟล์
// คอลัมน์ของตารางอยู่ใน src/db/schema.js (DEVICE_COLUMNS)
const crypto = require('crypto');
const { USE_DB } = require('../config');
const { mem } = require('../db/memory');
const { query, bulkInsert } = require('../db/mariadb');
const { getCatalog, ensureZone, ensureRelocatedStatus, KEY_RE } = require('./catalog');
const { deleteDeviceHistory } = require('./history');

// ฟิลด์ที่ client แก้ได้ (สถานะ ping/last_seen ระบบเป็นคนเขียน)
// เพิ่มฟิลด์ใหม่: เพิ่มที่นี่ + DEVICE_COLUMNS (db/schema.js) + type Device (frontend/src/app/types/monitor.ts)
const DEVICE_FIELDS = ['name', 'device_type', 'zone', 'floor', 'x_percent', 'y_percent', 'ip_address',
  'mac_address', 'brand', 'model', 'serial_no', 'status', 'monitor_enabled', 'remark', 'map_id',
  'direction', 'fov_angle', 'lan', 'cabinet', 'install_area', 'install_detail', 'requested_by', 'updated_by',
  'hide_on_map', 'check_method', 'check_port', 'snmp_community'];

// ฟิลด์อุปกรณ์ที่รับจากสคริปต์ import — ตรงกับคอลัมน์ตาราง devices (ไม่มี rtsp_url แบบ migrateFromCctv)
const DEVICE_IMPORT_FIELDS = ['id', 'name', 'device_type', 'zone', 'floor', 'x_percent', 'y_percent',
  'ip_address', 'model', 'status', 'remark', 'map_id', 'direction', 'fov_angle', 'lan', 'cabinet',
  'install_area', 'install_detail', 'requested_by', 'updated_by'];

// id ที่รับจาก client ตอนกู้คืน (UUID หรือ id จากไฟล์นำเข้า) — อนุญาตเฉพาะตัวอักษรปลอดภัย
const DEVICE_ID_RE = /^[A-Za-z0-9_.:-]{1,36}$/;

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
  if (out.check_method !== undefined && !['ping', 'tcp', 'snmp'].includes(out.check_method)) out.check_method = 'ping';
  if (out.check_port !== undefined) {
    const p = Number(out.check_port);
    out.check_port = Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
  }
  if (out.snmp_community !== undefined) {
    const c = String(out.snmp_community ?? '').trim().slice(0, 100);
    out.snmp_community = c === '' ? null : c;
  }
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
    hide_on_map: !!Number(d.hide_on_map || 0),
    check_method: d.check_method || 'ping',
    check_port: num(d.check_port)
  };
}

async function listDevices(mapId) {
  if (!USE_DB) {
    const rows = mapId ? mem.devices.filter((d) => d.map_id === mapId) : mem.devices;
    return rows.map(normalizeDevice).sort((a, b) => a.name.localeCompare(b.name));
  }
  const rows = mapId
    ? await query('SELECT * FROM devices WHERE map_id = ? ORDER BY name', [mapId])
    : await query('SELECT * FROM devices ORDER BY name');
  return (Array.isArray(rows) ? rows : []).map(normalizeDevice);
}

async function getDevice(id) {
  if (!USE_DB) {
    const d = mem.devices.find((x) => x.id === id);
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
    mem.devices.push({
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
    const d = mem.devices.find((x) => x.id === id);
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
    const d = mem.devices.find((x) => x.id === id);
    if (d) Object.assign(d, data);
    return;
  }
  const keys = Object.keys(data);
  await query(
    `UPDATE devices SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = updated_at WHERE id = ?`,
    [...Object.values(data), id]
  );
}

// ลบอุปกรณ์ + ประวัติผลตรวจของเครื่องนั้น (log ไม่ลบ)
async function deleteDeviceRow(id) {
  if (!USE_DB) {
    const i = mem.devices.findIndex((d) => d.id === id);
    if (i !== -1) mem.devices.splice(i, 1);
  } else {
    await query('DELETE FROM devices WHERE id = ?', [id]);
  }
  await deleteDeviceHistory(id);
}

// ---------- นำเข้าทั้งชุด (POST /api/devices/import, ซิงก์ Excel) ----------
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

// แทนที่อุปกรณ์ทั้งหมดของประเภท `type` ด้วย rows (ประเภทอื่นไม่โดนลบ)
async function replaceDevicesByType(type, rows) {
  await ensureRelocatedStatus();
  const catalog = await getCatalog();
  const validStatuses = new Set(catalog.statuses.map((s) => s.key));
  const clean = rows.map((r) => cleanDeviceRow(r, validStatuses, type)).filter(Boolean);
  for (const z of new Set(clean.map((d) => d.zone).filter(Boolean))) await ensureZone(z);
  // วิธีตรวจเป็นค่าตั้งรายเครื่อง ไม่อยู่ในไฟล์นำเข้า — จำของ id เดิมไว้แล้วใส่คืนหลังแทนที่
  const keepCheck = new Map();
  for (const d of await listDevices()) {
    if (d.device_type === type && (d.check_method !== 'ping' || d.check_port != null || d.snmp_community)) {
      keepCheck.set(d.id, { check_method: d.check_method, check_port: d.check_port, snmp_community: d.snmp_community });
    }
  }
  const restoreCheck = async () => {
    for (const [id, cfg] of keepCheck) await writeMonitorResult(id, cfg);
  };
  if (!USE_DB) {
    for (let i = mem.devices.length - 1; i >= 0; i--) {
      if (mem.devices[i].device_type === type) mem.devices.splice(i, 1);
    }
    const now = new Date().toISOString();
    mem.devices.push(...clean.map((d) => ({
      status: 'unknown', monitor_enabled: 1, fail_count: 0,
      last_seen: null, last_checked: null, last_latency_ms: null,
      created_at: now, updated_at: now, ...d
    })));
    await restoreCheck();
    return { imported: clean.length, skipped: rows.length - clean.length };
  }
  await query('DELETE FROM devices WHERE device_type = ?', [type]);
  if (clean.length > 0) await bulkInsert('devices', DEVICE_IMPORT_FIELDS, clean);
  await restoreCheck();
  return { imported: clean.length, skipped: rows.length - clean.length };
}

module.exports = {
  DEVICE_ID_RE,
  pickDeviceFields, normalizeDevice,
  listDevices, getDevice, createDevice, updateDevice, writeMonitorResult, deleteDeviceRow,
  replaceDevicesByType,
};
