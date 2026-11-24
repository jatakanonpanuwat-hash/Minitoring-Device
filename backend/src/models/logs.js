// ประวัติการทำงาน (ตาราง logs / mem.logs) — ทุกการแก้ไขและทุกครั้งที่อุปกรณ์ล่ม/กลับมา
// action ที่ใช้: added, updated, moved, deleted, imported, snapshot, down, up
const { USE_DB } = require('../config');
const { mem } = require('../db/memory');
const { query, bulkInsert } = require('../db/mariadb');
const { getCatalog } = require('./catalog');

const LOG_COLUMNS = 'id, timestamp, employee_id, employee_name, action, device_id, device_name, zone, floor, details, old_values, new_values';
const LOG_IMPORT_FIELDS = ['timestamp', 'employee_id', 'employee_name', 'action', 'device_id',
  'device_name', 'zone', 'floor', 'details', 'old_values', 'new_values'];
const MEM_LOG_LIMIT = 5000; // โหมดไฟล์เก็บล่าสุดไม่เกินเท่านี้

async function listLogs({ limit = 200, deviceId = null } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  if (!USE_DB) {
    const rows = deviceId ? mem.logs.filter((l) => l.device_id === deviceId) : mem.logs;
    return [...rows].reverse().slice(0, n);
  }
  const rows = deviceId
    ? await query(`SELECT ${LOG_COLUMNS} FROM logs WHERE device_id = ? ORDER BY id DESC LIMIT ?`, [deviceId, n])
    : await query(`SELECT ${LOG_COLUMNS} FROM logs ORDER BY id DESC LIMIT ?`, [n]);
  return Array.isArray(rows) ? rows : [];
}

// entry: { action, device_id?, device_name?, zone? (key — เก็บเป็นชื่อโซน), floor?, details?,
//          employee_id?, employee_name?, old_values?, new_values? (object — เก็บเป็น JSON) }
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
    mem.logs.push({ id: mem.logs.length + 1, timestamp: new Date().toISOString(), ...row });
    if (mem.logs.length > MEM_LOG_LIMIT) mem.logs.splice(0, mem.logs.length - MEM_LOG_LIMIT);
    return;
  }
  const cols = Object.keys(row);
  await query(`INSERT INTO logs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(row));
}

// แทนที่ประวัติทั้งหมด (สคริปต์ import-from-sheet.js)
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
    mem.logs.length = 0;
    clean.forEach((r, i) => mem.logs.push({ id: i + 1, ...r }));
    return { imported: clean.length, skipped: rows.length - clean.length };
  }
  await query('DELETE FROM logs');
  await query('ALTER TABLE logs AUTO_INCREMENT = 1');
  if (clean.length > 0) await bulkInsert('logs', LOG_IMPORT_FIELDS, clean);
  return { imported: clean.length, skipped: rows.length - clean.length };
}

// วันที่ตามเวลาไทย (UTC+7) 'YYYY-MM-DD'
const bkkDate = (ts) => new Date(new Date(ts).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// สถิติเหตุการณ์ online/offline รายวันย้อนหลัง `days` วัน (หน้า Dashboard)
async function eventStats(days) {
  const since = new Date(Date.now() - days * 86400 * 1000);
  let rows;
  if (USE_DB) {
    rows = await query(
      "SELECT timestamp, action, device_id, device_name FROM logs WHERE action IN ('down','up') AND timestamp >= ?",
      [since]
    );
  } else {
    rows = mem.logs.filter((l) => (l.action === 'down' || l.action === 'up') && new Date(l.timestamp) >= since);
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
  return {
    days,
    today: bkkDate(Date.now()),
    daily: [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    top: [...perDevice.values()].sort((a, b) => b.down - a.down).slice(0, 8),
  };
}

module.exports = { listLogs, addLog, replaceAllLogs, eventStats };
