// นำเข้ากล้องจากไฟล์ Excel + ซิงก์อัตโนมัติ (เฝ้าไฟล์ในโปรเจกต์ บันทึกใน Excel แล้วนำเข้าใหม่เอง)
// Excel เป็นต้นฉบับของกล้อง — การแก้กล้องในเว็บจะถูกทับเมื่อไฟล์เปลี่ยน
// เทียบ hash ของไฟล์กับครั้งล่าสุด (ค่าตั้ง XLSX_LAST_HASH) จึงไม่นำเข้าซ้ำตอนรีสตาร์ตถ้าไฟล์ไม่เปลี่ยน
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('../lib/xlsx');
const { saveUpload } = require('../lib/uploads');
const { getSetting, setSetting } = require('../models/settings');
const { pausedStatusKeys } = require('../models/catalog');
const { listDevices, writeMonitorResult, replaceDevicesByType } = require('../models/devices');
const { listMaps, saveMap } = require('../models/maps');
const { addLog } = require('../models/logs');

// importing = กำลังนำเข้าอยู่ (ทั้งจากหน้าเว็บและซิงก์อัตโนมัติ) — ห้ามทำซ้อนกัน
const xlsxSync = { importing: false, lastSync: null, lastError: null, lastResult: null, timer: null, retries: 0 };

const xlsxHash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// เขียนข้อมูลจาก workbook ที่อ่านแล้ว — ใช้ทั้งปุ่มนำเข้าในหน้าเว็บและซิงก์อัตโนมัติ
// only: ['cameras'] = นำเข้ากล้อง (แผนผังที่ยังไม่มีจะถูกเพิ่มเสมอ)
// keepRuntime: เก็บสถานะ ping เดิม (online/offline, last_seen …) ของกล้อง id เดิม ไม่ให้รีเซ็ตทุกครั้งที่บันทึก Excel
async function applyWorkbook(wb, { only, fileName, keepRuntime = false }) {
  const result = { maps: [], cameras: null };
  // แผนผัง: ที่มีอยู่แล้วไม่แตะรูป, ที่ยังไม่มีลองโหลดรูปจาก Google Drive
  const mapIds = new Set((await listMaps()).map((m) => m.map_id));
  for (const r of wb.mapRows) {
    const mapId = xlsx.str(r.map_id);
    const mapName = xlsx.str(r.map_name) || mapId;
    if (mapIds.has(mapId)) { result.maps.push({ map_id: mapId, map_name: mapName, status: 'exists' }); continue; }
    const img = await xlsx.loadMapImage(mapId, r);
    if (!img) { result.maps.push({ map_id: mapId, map_name: mapName, status: 'no_image' }); continue; }
    const { url } = saveUpload('map', path.extname(img.name) || '.jpg', img.buf);
    await saveMap({ map_id: mapId, map_name: mapName, image_url: url });
    result.maps.push({ map_id: mapId, map_name: mapName, status: 'downloaded' });
  }
  if (only.includes('cameras') && wb.devices.length > 0) {
    const old = new Map((await listDevices()).filter((d) => d.device_type === 'camera').map((d) => [d.id, d]));
    result.cameras = await replaceDevicesByType('camera', wb.devices);
    if (old.size) {
      const paused = await pausedStatusKeys();
      for (const d of await listDevices()) {
        const o = old.get(d.id);
        if (!o || d.device_type !== 'camera') continue;
        // "ไม่แสดงบนแผนผัง" ไม่มีใน Excel — คงค่าเดิมไว้ (ถ้าใน Excel ไม่ได้ใส่ตำแหน่งให้)
        if (o.hide_on_map && d.x_percent == null) await writeMonitorResult(d.id, { hide_on_map: 1 });
        if (!keepRuntime || o.ip_address !== d.ip_address) continue;
        const keep = { fail_count: o.fail_count, last_seen: o.last_seen, last_checked: o.last_checked, last_latency_ms: o.last_latency_ms };
        // สถานะที่หยุด ping (เช่น maintenance) ใน Excel ชนะ, นอกนั้นใช้ผล ping ล่าสุด
        if (!paused.has(d.status) && !paused.has(o.status)) keep.status = o.status;
        await writeMonitorResult(d.id, keep);
      }
    }
    await addLog({ action: 'imported', details: `นำเข้ากล้องจาก ${fileName}: ${result.cameras.imported} ตัว (skipped ${result.cameras.skipped})` });
  }
  return result;
}

// หลังนำเข้าไฟล์ในโปรเจกต์ครบ (จากหน้าเว็บ) — จำ hash ไว้ ตัวเฝ้าไฟล์จะไม่นำเข้าซ้ำ
async function markSynced(buf) {
  await setSetting('XLSX_LAST_HASH', xlsxHash(buf));
  xlsxSync.lastSync = new Date().toISOString();
  xlsxSync.lastError = null;
}

async function syncXlsxIfChanged(reason) {
  const file = xlsx.DEFAULT_XLSX;
  if ((await getSetting('XLSX_AUTO_SYNC')) !== 'TRUE' || !fs.existsSync(file)) return;
  if (xlsxSync.importing) return scheduleXlsxSync(reason, 3000);
  let buf;
  let wb;
  try {
    buf = fs.readFileSync(file);
    if (xlsxHash(buf) === (await getSetting('XLSX_LAST_HASH'))) { xlsxSync.retries = 0; return; }
    wb = xlsx.parseWorkbook(buf);
  } catch (err) {
    // Excel กำลังเขียนไฟล์อยู่ (ไฟล์ยังไม่ครบ/ถูกล็อก) → ลองใหม่
    if (xlsxSync.retries++ < 5) return scheduleXlsxSync(reason, 3000);
    xlsxSync.lastError = `อ่านไฟล์ไม่ได้: ${err.message}`;
    xlsxSync.retries = 0;
    return;
  }
  xlsxSync.retries = 0;
  if (wb.devices.length === 0) {
    xlsxSync.lastError = 'ไม่พบกล้องในแท็บ cctv — ไม่ซิงก์ (กันกล้องถูกลบหมด)';
    return;
  }
  xlsxSync.importing = true;
  try {
    const result = await applyWorkbook(wb, { only: ['cameras'], fileName: path.basename(file), keepRuntime: true });
    await setSetting('XLSX_LAST_HASH', xlsxHash(buf));
    xlsxSync.lastSync = new Date().toISOString();
    xlsxSync.lastError = null;
    xlsxSync.lastResult = `กล้อง ${result.cameras ? result.cameras.imported : 0} ตัว`;
    console.log(`[xlsx-sync] ${reason}: ${xlsxSync.lastResult}`);
  } catch (err) {
    xlsxSync.lastError = `ซิงก์ล้มเหลว: ${err.message}`;
    console.error('[xlsx-sync]', err);
  } finally {
    xlsxSync.importing = false;
  }
}

function scheduleXlsxSync(reason, delay = 2500) {
  clearTimeout(xlsxSync.timer); // Excel บันทึกหลายจังหวะ — รอให้นิ่งก่อน
  xlsxSync.timer = setTimeout(() => syncXlsxIfChanged(reason).catch((e) => console.error('[xlsx-sync]', e)), delay);
}

function startXlsxWatch() {
  // watchFile (poll) ทนกว่า fs.watch กับการบันทึกแบบ "เขียนไฟล์ชั่วคราวแล้วเปลี่ยนชื่อ" ของ Excel บน Windows
  fs.watchFile(xlsx.DEFAULT_XLSX, { interval: 2000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) scheduleXlsxSync('ไฟล์เปลี่ยน');
  });
  scheduleXlsxSync('เริ่ม backend', 500);
}

module.exports = { xlsxSync, applyWorkbook, markSynced, scheduleXlsxSync, startXlsxWatch };
