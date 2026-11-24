// แผนผัง (ตาราง maps / mem.maps) — ตัวไฟล์รูปอยู่ใน backend/uploads/ (ดู src/lib/uploads.js)
const { USE_DB } = require('../config');
const { mem } = require('../db/memory');
const { query, bulkInsert } = require('../db/mariadb');

async function listMaps() {
  // เรียงตามชื่อเหมือนโหมด MariaDB (ORDER BY map_name)
  if (!USE_DB) return [...mem.maps].sort((a, b) => String(a.map_name).localeCompare(String(b.map_name)));
  const rows = await query('SELECT * FROM maps ORDER BY map_name');
  return Array.isArray(rows) ? rows : [];
}

async function getMap(mapId) {
  return (await listMaps()).find((m) => m.map_id === mapId) || null;
}

// เพิ่มหรือแก้ (map_id ซ้ำ = แก้)
// หมายเหตุ: โหมดไฟล์แก้ object เดิมในที่ — ถ้าต้องใช้ค่าเก่า ให้จำไว้ก่อนเรียก
async function saveMap({ map_id, map_name, image_url, floor }) {
  if (!USE_DB) {
    const existing = mem.maps.find((m) => m.map_id === map_id);
    if (existing) {
      if (map_name) existing.map_name = map_name;
      if (image_url) existing.image_url = image_url;
      if (floor !== undefined) existing.floor = floor;
      return existing;
    }
    const map = { map_id, map_name, image_url, floor: floor ?? null };
    mem.maps.push(map);
    return map;
  }
  await query(
    `INSERT INTO maps (map_id, map_name, image_url, floor) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE map_name = VALUES(map_name), image_url = VALUES(image_url), floor = VALUES(floor)`,
    [map_id, map_name, image_url, floor ?? null]
  );
  const rows = await query('SELECT * FROM maps WHERE map_id = ?', [map_id]);
  return rows[0];
}

async function deleteMapRow(map_id) {
  if (!USE_DB) {
    const i = mem.maps.findIndex((m) => m.map_id === map_id);
    if (i !== -1) mem.maps.splice(i, 1);
    return;
  }
  await query('DELETE FROM maps WHERE map_id = ?', [map_id]);
}

// แทนที่แผนผังทั้งหมด (สคริปต์ import-from-sheet.js)
async function replaceAllMaps(rows) {
  const clean = rows
    .filter((r) => r && r.map_id && r.image_url)
    .map((r) => ({
      map_id: String(r.map_id), map_name: String(r.map_name || r.map_id), image_url: String(r.image_url),
      floor: r.floor ? String(r.floor).trim().slice(0, 50) || null : null,
    }));
  if (!USE_DB) {
    mem.maps.length = 0;
    mem.maps.push(...clean);
    return { imported: clean.length, skipped: rows.length - clean.length };
  }
  await query('DELETE FROM maps');
  if (clean.length > 0) await bulkInsert('maps', ['map_id', 'map_name', 'image_url', 'floor'], clean);
  return { imported: clean.length, skipped: rows.length - clean.length };
}

module.exports = { listMaps, getMap, saveMap, deleteMapRow, replaceAllMaps };
