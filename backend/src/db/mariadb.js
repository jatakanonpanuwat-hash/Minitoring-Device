// การเชื่อมต่อ MariaDB (ใช้เมื่อ config.USE_DB = true) — สร้างตาราง/ย้ายข้อมูลอยู่ใน schema.js
const mariadb = require('mariadb');
const { DB } = require('../config');

// MariaDB คืน COUNT/AUTO_INCREMENT เป็น BigInt — ให้ res.json() แปลงเป็น string ได้
BigInt.prototype.toJSON = function () {
  return this.toString();
};

let pool = null;

function connect() {
  pool = mariadb.createPool({
    ...DB,
    connectionLimit: 10,
    acquireTimeout: 30000,
    timezone: '+07:00'
  });
}

async function query(sql, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(sql, params);
    return result;
  } catch (err) {
    console.error('Database query error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// INSERT หลายแถว ทีละ 200 แถว (ใช้ตอนนำเข้าข้อมูลทั้งชุด)
async function bulkInsert(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const placeholders = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
    const values = chunk.flatMap((r) => cols.map((c) => r[c] !== undefined ? r[c] : null));
    await query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${placeholders}`, values);
  }
}

module.exports = { connect, query, bulkInsert };
