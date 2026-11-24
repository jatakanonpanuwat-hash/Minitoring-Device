// สร้าง/อัปเดตตารางใน MariaDB ตอนเริ่ม server (ปลอดภัยที่จะรันซ้ำทุกครั้ง)
// เพิ่มคอลัมน์ใหม่ให้ devices: เพิ่มใน DEVICE_COLUMNS แล้ว restart — ระบบ ALTER TABLE ให้เอง
const { query } = require('./mariadb');
const { getSetting, setSetting } = require('../models/settings');

// คอลัมน์ที่ตาราง devices ต้องมี — ใช้ทั้งสร้างตารางใหม่และเติมคอลัมน์ให้ตาราง devices รุ่นเก่า
const DEVICE_COLUMNS = {
  device_type:     "VARCHAR(30) NOT NULL DEFAULT 'other'",
  zone:            'VARCHAR(100)',
  floor:           'VARCHAR(50)',
  x_percent:       'DECIMAL(6,3)',
  y_percent:       'DECIMAL(6,3)',
  ip_address:      'VARCHAR(100)',
  mac_address:     'VARCHAR(50)',
  brand:           'VARCHAR(100)',
  model:           'VARCHAR(100)',
  serial_no:       'VARCHAR(100)',
  monitor_enabled: 'TINYINT(1) NOT NULL DEFAULT 1',
  last_latency_ms: 'DECIMAL(10,2)',
  last_checked:    'DATETIME',
  fail_count:      'INT NOT NULL DEFAULT 0',
  remark:          'TEXT',
  map_id:          'VARCHAR(100)',
  direction:       'DECIMAL(6,2)',
  fov_angle:       'DECIMAL(6,2)',
  lan:             'VARCHAR(50)',
  cabinet:         'VARCHAR(50)',
  install_area:    'VARCHAR(200)',
  install_detail:  'TEXT',
  requested_by:    'VARCHAR(200)',
  updated_at:      'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  updated_by:      'VARCHAR(200)',
  hide_on_map:     'TINYINT(1) NOT NULL DEFAULT 0', // 1 = ตั้งใจไม่วางบนแผนผัง (ไม่นับเป็น "ยังไม่วาง")
  check_method:   "VARCHAR(10) NOT NULL DEFAULT 'ping'", // วิธีตรวจ: ping / tcp / snmp
  check_port:     'INT',                          // TCP: พอร์ตปลายทาง / SNMP: พอร์ต (ว่าง = 161)
  snmp_community: 'VARCHAR(100)',                  // SNMP v2c community (ว่าง = public)
};

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS devices (
      id         VARCHAR(36)  NOT NULL PRIMARY KEY,
      name       VARCHAR(200) NOT NULL,
      location   VARCHAR(200),
      status     VARCHAR(20)  NOT NULL DEFAULT 'unknown',
      last_seen  DATETIME,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // ตาราง devices รุ่นแรกมีแค่ name/location/status — เติมคอลัมน์ที่ขาด
  for (const [col, def] of Object.entries(DEVICE_COLUMNS)) {
    await query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS ${col} ${def}`);
  }
  await query(`
    CREATE TABLE IF NOT EXISTS maps (
      map_id    VARCHAR(100) NOT NULL PRIMARY KEY,
      map_name  VARCHAR(200) NOT NULL,
      image_url VARCHAR(500) NOT NULL,
      floor     VARCHAR(50)
    )
  `);
  await query('ALTER TABLE maps ADD COLUMN IF NOT EXISTS floor VARCHAR(50)');
  await query(`
    CREATE TABLE IF NOT EXISTS logs (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      timestamp     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      employee_id   VARCHAR(50),
      employee_name VARCHAR(200),
      action        VARCHAR(50)  NOT NULL,
      device_id     VARCHAR(36),
      device_name   VARCHAR(200),
      zone          VARCHAR(100),
      floor         VARCHAR(50),
      details       TEXT,
      old_values    TEXT,
      new_values    TEXT
    )
  `);
  await query('ALTER TABLE logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(36)');
  await query('ALTER TABLE logs ADD COLUMN IF NOT EXISTS device_name VARCHAR(200)');
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\`   VARCHAR(100) NOT NULL PRIMARY KEY,
      \`value\` TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS device_snapshots (
      year         INT          NOT NULL PRIMARY KEY,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by   VARCHAR(200),
      device_count INT          NOT NULL DEFAULT 0,
      data         LONGTEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS check_history (
      device_id   VARCHAR(36) NOT NULL,
      hour        VARCHAR(13) NOT NULL,
      checks      INT         NOT NULL DEFAULT 0,
      alive       INT         NOT NULL DEFAULT 0,
      latency_sum DECIMAL(12,2) NOT NULL DEFAULT 0,
      latency_n   INT         NOT NULL DEFAULT 0,
      PRIMARY KEY (device_id, hour)
    )
  `);
  await migrateFromCctv();
  // ตาราง users สร้างใน src/auth.js (auth.initDB)
}

// ย้ายข้อมูลจากระบบ CCTV เดิม (ตาราง cameras + logs.camera_*) มาเป็นอุปกรณ์ประเภท camera — ทำครั้งเดียว
// ตาราง cameras เดิมไม่ถูกลบ เก็บไว้เป็นสำรอง
async function migrateFromCctv() {
  if ((await getSetting('MIGRATED_CCTV')) === 'TRUE') return;
  const tables = await query("SHOW TABLES LIKE 'cameras'");
  if (tables.length > 0) {
    const cols = ['id', 'name', 'zone', 'floor', 'x_percent', 'y_percent', 'ip_address', 'model', 'status',
      'remark', 'map_id', 'direction', 'fov_angle', 'lan', 'cabinet', 'install_area', 'install_detail',
      'requested_by', 'updated_by'];
    const res = await query(
      `INSERT IGNORE INTO devices (${cols.join(', ')}, device_type)
       SELECT ${cols.join(', ')}, 'camera' FROM cameras`
    );
    console.log(`[migrate] ย้ายกล้องจาก CCTV เดิมเป็นอุปกรณ์ ${res.affectedRows} รายการ`);
  }
  const logCols = await query("SHOW COLUMNS FROM logs LIKE 'camera_id'");
  if (logCols.length > 0) {
    await query('UPDATE logs SET device_id = camera_id, device_name = camera_name WHERE device_id IS NULL AND camera_id IS NOT NULL');
  }
  await setSetting('MIGRATED_CCTV', 'TRUE');
}

module.exports = { initSchema, DEVICE_COLUMNS };
