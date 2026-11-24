// สแนปช็อตรายการอุปกรณ์รายปี (ตาราง device_snapshots / mem.deviceSnapshots) — ปีละ 1 ชุด อ่านอย่างเดียว
const { USE_DB } = require('../config');
const { mem } = require('../db/memory');
const { query } = require('../db/mariadb');
const { normalizeDevice } = require('./devices');

// ปีที่รับได้ 2000–2100 — นอกนั้นคืน null
const snapYearOf = (v) => {
  const y = parseInt(v, 10);
  return y >= 2000 && y <= 2100 ? y : null;
};

async function listSnapshotYears() {
  if (!USE_DB) {
    return mem.deviceSnapshots
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
    const s = mem.deviceSnapshots.find((x) => x.year === year);
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

// มีของปีนั้นแล้ว = เขียนทับ
async function saveSnapshot(year, devices, by) {
  const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (!USE_DB) {
    const rec = { year, created_at, created_by: by || null, device_count: devices.length, devices };
    const i = mem.deviceSnapshots.findIndex((x) => x.year === year);
    if (i >= 0) mem.deviceSnapshots[i] = rec;
    else mem.deviceSnapshots.push(rec);
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

module.exports = { snapYearOf, listSnapshotYears, getSnapshot, saveSnapshot };
