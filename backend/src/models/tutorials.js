// คู่มือการใช้งาน (เมนู Tutorial) — รายการเก็บเป็น JSON ในค่าตั้ง TUTORIALS (ใช้ได้ทั้งโหมด MariaDB และโหมดไฟล์ ไม่ต้องสร้างตาราง)
// ตัวไฟล์อยู่ใน backend/uploads/tutorial-<uuid>.<ext> (ดู routes/tutorials.js)
const { getSetting, setSetting } = require('./settings');

const KEY = 'TUTORIALS';

async function listTutorials() {
  try {
    const list = JSON.parse((await getSetting(KEY)) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveTutorials(list) {
  await setSetting(KEY, JSON.stringify(list));
}

async function getTutorial(id) {
  return (await listTutorials()).find((t) => t.id === id) || null;
}

async function addTutorial(item) {
  const list = await listTutorials();
  list.push(item);
  await saveTutorials(list);
  return item;
}

// แก้ชื่อ/คำอธิบาย — คืนรายการที่แก้แล้ว หรือ null ถ้าไม่พบ
async function updateTutorial(id, patch) {
  const list = await listTutorials();
  const t = list.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch, { updated_at: new Date().toISOString() });
  await saveTutorials(list);
  return t;
}

// ลบ — คืนรายการที่ถูกลบ (ให้ route ลบไฟล์ต่อ) หรือ null
async function removeTutorial(id) {
  const list = await listTutorials();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [t] = list.splice(i, 1);
  await saveTutorials(list);
  return t;
}

// เรียงใหม่ตาม ids ที่ส่งมา (id ที่ไม่ได้ส่งมาต่อท้ายตามลำดับเดิม)
async function reorderTutorials(ids) {
  const list = await listTutorials();
  const rank = new Map(ids.map((id, i) => [id, i]));
  const sorted = [...list].sort((a, b) => (rank.get(a.id) ?? 1e9 + list.indexOf(a)) - (rank.get(b.id) ?? 1e9 + list.indexOf(b)));
  await saveTutorials(sorted);
  return sorted;
}

module.exports = { listTutorials, getTutorial, addTutorial, updateTutorial, removeTutorial, reorderTutorials };
