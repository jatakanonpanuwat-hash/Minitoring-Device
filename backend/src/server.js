// จุดเริ่มต้นของ backend: เตรียมที่เก็บข้อมูล → เปิด port → เริ่มตรวจอุปกรณ์อัตโนมัติ + ซิงก์ Excel
const { PORT, USE_DB, ADMIN_SECRET, XLSX_WATCH } = require('./config');
const { initMemoryStore } = require('./db/memory');
const { connect } = require('./db/mariadb');
const { initSchema } = require('./db/schema');

if (!ADMIN_SECRET) {
  console.warn('[config] ไม่ได้ตั้ง ADMIN_SECRET — ปิดการใส่รหัสผู้ดูแล (ทุกคนแก้ข้อมูลได้)');
}
if (!USE_DB) initMemoryStore();

const { app, auth } = require('./app');
const { runMonitorCycle, scheduleMonitor } = require('./services/monitor');
const { startXlsxWatch } = require('./services/xlsx-sync');

async function initDB() {
  if (!USE_DB) return;
  connect();
  await initSchema();
  await auth.initDB();
}

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Monitoring Device backend listening on port ${PORT} (mode: ${USE_DB ? 'mariadb' : 'memory'})`));
    runMonitorCycle().finally(scheduleMonitor);
    if (XLSX_WATCH) startXlsxWatch();
  })
  .catch((err) => {
    console.error('Failed to init DB:', err);
    process.exit(1);
  });
