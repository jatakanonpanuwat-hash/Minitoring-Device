// ตรวจอุปกรณ์อัตโนมัติเป็นรอบ ๆ (ค่าเริ่มต้นทุก 60 วินาที ครั้งละ 20 เครื่องพร้อมกัน)
//
// ลำดับการทำงาน: scheduleMonitor → runMonitorCycle → checkDevice (ทุกเครื่อง) → applyCheckResult
//   applyCheckResult ตัดสินสถานะใหม่ เขียนผล + ประวัติรายชั่วโมง + log down/up + คิวแจ้งเตือน Telegram
//
// สถานะ: online = ตอบปกติ, warning = ตอบช้ากว่าเกณฑ์ หรือหลุดครั้งแรก,
//         offline = หลุดติดกันครบเกณฑ์ (MONITOR_FAIL_THRESHOLD)
const { USE_DB } = require('../config');
const { getSetting, getIntSetting } = require('../models/settings');
const { pausedStatusKeys } = require('../models/catalog');
const { listDevices, writeMonitorResult } = require('../models/devices');
const { recordHistory, pruneHistory } = require('../models/history');
const { addLog } = require('../models/logs');
const { checkMethodOf, checkMethodLabel, runCheck } = require('./checks');
const { queueAlert, flushAlerts } = require('./telegram');

const CONCURRENCY = 20;            // ตรวจพร้อมกันกี่เครื่อง
const PROGRESS_MAX_ENTRIES = 3000; // log วิ่งของรอบล่าสุดเก็บไม่เกินเท่านี้

const monitorState = { running: false, lastRunAt: null, lastDurationMs: null, checked: 0, timer: null };

// ความคืบหน้าของรอบ ping ล่าสุด — หน้า Settings ดึงไปแสดงเป็น log วิ่ง (GET /api/monitor/progress)
const monitorProgress = {
  runId: 0, source: null, running: false, startedAt: null, finishedAt: null,
  total: 0, done: 0, counts: { online: 0, warning: 0, offline: 0, error: 0 }, changed: 0,
  seq: 0, entries: [], note: null,
};

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

// ตัดสินสถานะจากผลตรวจ 1 ครั้ง + จำนวนครั้งที่ไม่ผ่านติดกัน แล้วบันทึก — คืนข้อมูลอุปกรณ์หลังอัปเดต
async function applyCheckResult(device, result, cfg, method = 'ping') {
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
  recordHistory(device.id, result.alive, result.latency).catch((err) => console.error('[history]', err.message));

  const label = checkMethodLabel(method, device);
  const wasDown = device.status === 'offline';
  if (next === 'offline' && !wasDown) {
    const details = `${label} ไม่ตอบ ${patch.fail_count} ครั้งติดกัน`;
    await addLog({ action: 'down', device_id: device.id, device_name: device.name, zone: device.zone, floor: device.floor, details, employee_name: 'system' });
    queueAlert('down', device, { failCount: patch.fail_count });
  } else if (wasDown && (next === 'online' || next === 'warning')) {
    const details = `${label} ตอบกลับ ${result.latency != null ? `${result.latency} ms` : ''}`.trim();
    await addLog({ action: 'up', device_id: device.id, device_name: device.name, zone: device.zone, floor: device.floor, details, employee_name: 'system' });
    queueAlert('up', device, { latency: result.latency });
  }
  return { ...device, ...patch, status: next };
}

async function checkDevice(device, cfg) {
  const method = checkMethodOf(device);
  const result = await runCheck(device, method, cfg.timeoutMs);
  return applyCheckResult(device, result, cfg, method);
}

// ตรวจทันทีเบื้องหลังถ้าเครื่องนี้อยู่ในเงื่อนไข monitor (หลังเพิ่ม/กู้คืนอุปกรณ์ — ไม่ต้องรอรอบถัดไป)
function checkSoonIfMonitored(device) {
  monitorConfig().then(async (cfg) => {
    if (shouldMonitor(device, await pausedStatusKeys(), cfg)) await checkDevice(device, cfg);
  }).catch(() => {});
}

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

// ping ทุกเครื่องที่เปิด monitor + มี IP + ไม่อยู่ในสถานะ maintenance + ประเภทที่เลือก (ทำพร้อมกันทีละ CONCURRENCY เครื่อง)
// source: 'auto' = ตามรอบเวลา (ข้ามถ้าปิด monitor), 'manual' = กด "Ping ทั้งหมดตอนนี้" (ping แม้ปิด monitor อัตโนมัติ)
// คืน false ถ้าไม่ได้รัน (มีรอบอื่นวิ่งอยู่ / ปิด monitor / error)
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
    pruneHistory().catch((err) => console.error('[history]', err.message));
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

// ตั้งเวลารอบถัดไป (เรียกซ้ำได้ — ยกเลิกตัวเก่าก่อน เช่นตอนเปลี่ยน interval ในหน้า Settings)
async function scheduleMonitor() {
  if (monitorState.timer) clearTimeout(monitorState.timer);
  const { intervalSec } = await monitorConfig().catch(() => ({ intervalSec: 60 }));
  monitorState.timer = setTimeout(async () => {
    await runMonitorCycle();
    scheduleMonitor();
  }, intervalSec * 1000);
}

module.exports = {
  monitorState, monitorProgress,
  monitorConfig, shouldMonitor, applyCheckResult, checkDevice, checkSoonIfMonitored,
  runMonitorCycle, scheduleMonitor,
};
