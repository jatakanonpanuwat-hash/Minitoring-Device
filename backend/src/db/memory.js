// โหมดไม่มีฐานข้อมูล: เก็บข้อมูลใน RAM แล้วบันทึกลงไฟล์ JSON (config.STORE_FILE) อัตโนมัติ
// restart แล้วข้อมูลยังอยู่ — ทุกไฟล์ใน src/models/ อ่าน/เขียน `mem` เมื่อ config.USE_DB = false
const fs = require('fs');
const path = require('path');
const { STORE_FILE } = require('../config');

const mem = {
  devices: [],
  maps: [],
  logs: [],
  settings: {},
  users: [],            // บัญชีผู้ใช้ (src/auth.js)
  deviceSnapshots: [],  // สแนปช็อตรายการอุปกรณ์รายปี { year, created_at, created_by, device_count, devices }
  checkHistory: [],     // ประวัติผลตรวจรายชั่วโมง { device_id, hour, checks, alive, latency_sum, latency_n }
  historyIndex: new Map(), // `${device_id}|${hour}` -> แถวใน checkHistory (ไม่บันทึกลงไฟล์ สร้างใหม่ตอนโหลด)
};

let lastSaved = '';

// ชื่อ key ในไฟล์คงเดิม (devices, maps, ..., device_snapshots, check_history) — ไฟล์เก่าเปิดได้
function storeSnapshot() {
  return JSON.stringify({
    devices: mem.devices, maps: mem.maps, logs: mem.logs, settings: mem.settings,
    users: mem.users, device_snapshots: mem.deviceSnapshots, check_history: mem.checkHistory
  });
}

function loadStore() {
  if (!STORE_FILE || !fs.existsSync(STORE_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    mem.devices.push(...(data.devices || []));
    mem.maps.push(...(data.maps || []));
    mem.logs.push(...(data.logs || []));
    Object.assign(mem.settings, data.settings || {});
    mem.users.push(...(data.users || []));
    mem.deviceSnapshots.push(...(data.device_snapshots || []));
    mem.checkHistory.push(...(data.check_history || []));
    for (const r of mem.checkHistory) mem.historyIndex.set(`${r.device_id}|${r.hour}`, r);
    lastSaved = storeSnapshot();
    console.log(`[store] โหลดข้อมูลจาก ${STORE_FILE}: อุปกรณ์ ${mem.devices.length}, แผนผัง ${mem.maps.length}, ประวัติ ${mem.logs.length}`);
  } catch (err) {
    // ไฟล์เสีย — เก็บสำรองไว้ ไม่เขียนทับ แล้วเริ่มจากว่าง
    const backup = `${STORE_FILE}.broken-${Date.now()}`;
    fs.copyFileSync(STORE_FILE, backup);
    console.error(`[store] อ่าน ${STORE_FILE} ไม่ได้ (${err.message}) — สำรองไว้ที่ ${backup}`);
  }
}

// เขียนเมื่อข้อมูลเปลี่ยนเท่านั้น — เขียนไฟล์ชั่วคราวแล้ว rename กันไฟล์เสียถ้าปิดกลางคัน
function saveStore() {
  if (!STORE_FILE) return;
  const text = storeSnapshot();
  if (text === lastSaved) return;
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, STORE_FILE);
    lastSaved = text;
  } catch (err) {
    console.error('[store] บันทึกไม่สำเร็จ:', err.message);
  }
}

// เรียกครั้งเดียวตอนเริ่ม server (src/server.js) เมื่อไม่ได้ใช้ MariaDB
function initMemoryStore() {
  if (STORE_FILE) {
    console.warn(`[config] ไม่พบค่า DB (.env) — เก็บข้อมูลในไฟล์ ${STORE_FILE}`);
    loadStore();
    setInterval(saveStore, 3000).unref(); // บันทึกทุก 3 วินาที (เฉพาะเมื่อมีการเปลี่ยน)
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGUSR2']) {
      process.once(sig, () => {
        saveStore();
        process.kill(process.pid, sig);
      });
    }
  } else {
    console.warn('[config] ไม่พบค่า DB (.env) และปิด STORE_FILE — ข้อมูลจะหายเมื่อ restart');
  }
}

module.exports = { mem, initMemoryStore, saveStore };
