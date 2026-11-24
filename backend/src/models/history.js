// ประวัติผลตรวจรายชั่วโมง (ตาราง check_history / mem.checkHistory) — ใช้วาดกราฟ uptime ย้อนหลัง
// รวมผลตรวจทั้งรอบเป็น 1 แถว/อุปกรณ์/ชั่วโมง (UTC 'YYYY-MM-DDTHH') — ชั่วโมงที่ไม่มีแถว = ไม่มีการตรวจ (backend ปิด / ปิด monitor)
// เก็บ 30 วันย้อนหลัง เกินนี้ลบอัตโนมัติหลังจบรอบตรวจ (อย่างมากชั่วโมงละครั้ง)
const { USE_DB } = require('../config');
const { mem } = require('../db/memory');
const { query } = require('../db/mariadb');

const HISTORY_RETENTION_DAYS = 30;
const hourKey = (d = new Date()) => d.toISOString().slice(0, 13);

async function recordHistory(deviceId, alive, latency) {
  const hour = hourKey();
  const hasLatency = alive && latency != null;
  if (!USE_DB) {
    const key = `${deviceId}|${hour}`;
    let row = mem.historyIndex.get(key);
    if (!row) {
      row = { device_id: deviceId, hour, checks: 0, alive: 0, latency_sum: 0, latency_n: 0 };
      mem.checkHistory.push(row);
      mem.historyIndex.set(key, row);
    }
    row.checks++;
    if (alive) row.alive++;
    if (hasLatency) { row.latency_sum += latency; row.latency_n++; }
    return;
  }
  await query(
    `INSERT INTO check_history (device_id, hour, checks, alive, latency_sum, latency_n) VALUES (?, ?, 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE checks = checks + 1, alive = alive + VALUES(alive),
     latency_sum = latency_sum + VALUES(latency_sum), latency_n = latency_n + VALUES(latency_n)`,
    [deviceId, hour, alive ? 1 : 0, hasLatency ? latency : 0, hasLatency ? 1 : 0]
  );
}

let lastHistoryPrune = 0;
async function pruneHistory() {
  const now = Date.now();
  if (now - lastHistoryPrune < 3600000) return;
  lastHistoryPrune = now;
  const cutoff = new Date(now - HISTORY_RETENTION_DAYS * 86400000).toISOString().slice(0, 13);
  if (!USE_DB) {
    for (let i = mem.checkHistory.length - 1; i >= 0; i--) {
      if (mem.checkHistory[i].hour < cutoff) {
        mem.historyIndex.delete(`${mem.checkHistory[i].device_id}|${mem.checkHistory[i].hour}`);
        mem.checkHistory.splice(i, 1);
      }
    }
    return;
  }
  await query('DELETE FROM check_history WHERE hour < ?', [cutoff]);
}

async function deleteDeviceHistory(deviceId) {
  if (!USE_DB) {
    for (let j = mem.checkHistory.length - 1; j >= 0; j--) {
      if (mem.checkHistory[j].device_id === deviceId) {
        mem.historyIndex.delete(`${deviceId}|${mem.checkHistory[j].hour}`);
        mem.checkHistory.splice(j, 1);
      }
    }
    return;
  }
  await query('DELETE FROM check_history WHERE device_id = ?', [deviceId]);
}

// ประวัติของเครื่องเดียว — range: '24h' | '7d' | '30d' (30 วันยุบเป็นรายวัน)
// t เป็น UTC ISO — ชั่วโมงที่หายไป = ช่วงนั้นไม่มีการตรวจ (หน้าเว็บวาดเป็นช่องว่าง ไม่ใช่ 0%)
async function getDeviceHistory(deviceId, range) {
  const hours = range === '30d' ? 720 : range === '7d' ? 168 : 24;
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString().slice(0, 13);
  let rows;
  if (!USE_DB) {
    rows = mem.checkHistory
      .filter((r) => r.device_id === deviceId && r.hour >= cutoff)
      .sort((a, b) => (a.hour < b.hour ? -1 : 1));
  } else {
    rows = await query(
      'SELECT hour, checks, alive, latency_sum, latency_n FROM check_history WHERE device_id = ? AND hour >= ? ORDER BY hour',
      [deviceId, cutoff]
    );
  }
  let buckets = rows.map((r) => ({
    t: `${r.hour}:00:00Z`,
    checks: Number(r.checks), alive: Number(r.alive),
    latSum: Number(r.latency_sum), latN: Number(r.latency_n),
  }));
  if (range === '30d') {
    const days = new Map();
    for (const b of buckets) {
      const day = b.t.slice(0, 10);
      const d = days.get(day) || { t: `${day}T00:00:00Z`, checks: 0, alive: 0, latSum: 0, latN: 0 };
      d.checks += b.checks; d.alive += b.alive; d.latSum += b.latSum; d.latN += b.latN;
      days.set(day, d);
    }
    buckets = [...days.values()];
  }
  return buckets.map((b) => ({
    t: b.t, checks: b.checks, alive: b.alive,
    uptime: b.checks ? Math.round((b.alive / b.checks) * 1000) / 10 : null,
    latency: b.latN ? Math.round((b.latSum / b.latN) * 10) / 10 : null,
  }));
}

module.exports = { recordHistory, pruneHistory, deleteDeviceHistory, getDeviceHistory };
