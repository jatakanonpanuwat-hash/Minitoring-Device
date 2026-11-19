// TABLE_IP / NVR ตามปี — ย้ายตรรกะมาจาก CCTV-MECHA-PART (Code.gs: TABLE_IP_*, TABLE_IP_UPDATES, auto-sync V4)
//
// - ตาราง IP แยกตามปี: NVR IP, Channel, Camera IP, ชื่อกล้อง, Control (ตู้), สถานะ, หมายเหตุ
// - ประวัติอัปเดต (TABLE_IP_UPDATES) แยกตามปี
// - ซิงก์อัตโนมัติกับอุปกรณ์ประเภท camera: เพิ่มกล้อง → เพิ่ม IP (หา NVR + channel ถัดไป), ลบกล้อง → soft/hard delete,
//   เปลี่ยน IP/ชื่อ → แก้แถวในตาราง (ปีปัจจุบัน = ปีล่าสุดที่มีตาราง)
//
// ใช้ได้ทั้งโหมด MariaDB และ in-memory + store.json (ข้อมูลอยู่ใน memIpRows / memIpUpdates ที่ index.js บันทึกให้)

const crypto = require('crypto');

const UPDATE_TYPES = ['ติดตั้งใหม่', 'ย้ายตำแหน่ง', 'ซ่อมบำรุง', 'เปลี่ยน IP', 'เปลี่ยนชื่อ', 'Offline', 'Online แล้ว', 'อื่นๆ'];
const SYNC_DEVICE_TYPE = 'camera';
const ADDR_RE = /^[A-Za-z0-9.:_-]{1,100}$/;
const ROW_FIELDS = ['row_no', 'nvr_ip', 'channel', 'camera_ip', 'camera_name', 'control', 'status', 'remark'];

module.exports = function createIpTable({ app, requireAdmin, USE_DB, query, getSetting, addLog, memIpRows, memIpUpdates }) {
  // ---------- helpers ----------
  const s = (v, max = 200) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
  const int = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const lower = (v) => String(v || '').trim().toLowerCase();
  const isDeleted = (row) => /^deleted/i.test(String(row.status || ''));
  const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // วันที่ไทย

  function cleanRow(raw) {
    const out = {};
    for (const f of ROW_FIELDS) {
      if (raw[f] === undefined) continue;
      if (f === 'row_no' || f === 'channel') out[f] = int(raw[f]);
      else if (f === 'remark') out[f] = s(raw[f], 2000);
      else out[f] = s(raw[f], f === 'camera_name' ? 200 : 100);
    }
    for (const f of ['nvr_ip', 'camera_ip']) {
      if (out[f] && !ADDR_RE.test(out[f])) return { error: `${f === 'nvr_ip' ? 'NVR IP' : 'Camera IP'} ไม่ถูกต้อง: ${out[f]}` };
    }
    if (out.channel != null && (out.channel < 0 || out.channel > 4096)) return { error: 'Channel ต้องเป็น 0–4096' };
    return { row: out };
  }

  function normalize(r) {
    if (!r) return r;
    return { ...r, year: Number(r.year), row_no: r.row_no == null ? null : Number(r.row_no), channel: r.channel == null ? null : Number(r.channel) };
  }

  const byNvrChannel = (a, b) =>
    String(a.nvr_ip || '').localeCompare(String(b.nvr_ip || ''), undefined, { numeric: true }) ||
    (a.channel ?? 1e9) - (b.channel ?? 1e9) || (a.row_no ?? 0) - (b.row_no ?? 0);

  // ---------- store ----------
  async function initDB() {
    if (!USE_DB) return;
    await query(`
      CREATE TABLE IF NOT EXISTS ip_table (
        id          VARCHAR(36)  NOT NULL PRIMARY KEY,
        year        INT          NOT NULL,
        row_no      INT,
        nvr_ip      VARCHAR(100),
        channel     INT,
        camera_ip   VARCHAR(100),
        camera_name VARCHAR(200),
        control     VARCHAR(100),
        status      VARCHAR(100),
        remark      TEXT,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ip_year (year),
        INDEX idx_ip_camera (camera_ip)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS ip_table_updates (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        year            INT          NOT NULL,
        timestamp       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        row_id          VARCHAR(36),
        nvr_ip          VARCHAR(100),
        channel         INT,
        camera_ip       VARCHAR(100),
        camera_name     VARCHAR(200),
        update_type     VARCHAR(50),
        detail          TEXT,
        remark          TEXT,
        updated_by_id   VARCHAR(50),
        updated_by_name VARCHAR(200),
        INDEX idx_ipu_year (year)
      )
    `);
  }

  async function listYears() {
    if (!USE_DB) {
      const m = {};
      for (const r of memIpRows) m[r.year] = (m[r.year] || 0) + 1;
      return Object.entries(m).map(([year, count]) => ({ year: Number(year), count })).sort((a, b) => b.year - a.year);
    }
    const rows = await query('SELECT year, COUNT(*) AS count FROM ip_table GROUP BY year ORDER BY year DESC');
    return rows.map((r) => ({ year: Number(r.year), count: Number(r.count) }));
  }

  async function currentYear() {
    const years = await listYears();
    return years.length ? years[0].year : new Date().getFullYear();
  }

  async function listRows(year) {
    if (!USE_DB) return memIpRows.filter((r) => r.year === year).map(normalize).sort(byNvrChannel);
    const rows = await query('SELECT * FROM ip_table WHERE year = ?', [year]);
    return rows.map(normalize).sort(byNvrChannel);
  }

  async function getRow(id) {
    if (!USE_DB) return normalize(memIpRows.find((r) => r.id === id) && { ...memIpRows.find((r) => r.id === id) });
    const rows = await query('SELECT * FROM ip_table WHERE id = ?', [id]);
    return normalize(rows[0]) || null;
  }

  async function insertRow(year, data) {
    const row = { id: crypto.randomUUID(), year, ...Object.fromEntries(ROW_FIELDS.map((f) => [f, data[f] ?? null])) };
    if (!USE_DB) {
      memIpRows.push({ ...row, updated_at: new Date().toISOString() });
      return getRow(row.id);
    }
    const cols = Object.keys(row);
    await query(`INSERT INTO ip_table (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(row));
    return getRow(row.id);
  }

  async function patchRow(id, patch) {
    const keys = Object.keys(patch);
    if (!USE_DB) {
      const r = memIpRows.find((x) => x.id === id);
      if (r) Object.assign(r, patch, { updated_at: new Date().toISOString() });
      return getRow(id);
    }
    if (keys.length) await query(`UPDATE ip_table SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(patch), id]);
    return getRow(id);
  }

  async function deleteRow(id) {
    if (!USE_DB) {
      const i = memIpRows.findIndex((r) => r.id === id);
      if (i !== -1) memIpRows.splice(i, 1);
      return;
    }
    await query('DELETE FROM ip_table WHERE id = ?', [id]);
  }

  async function replaceYear(year, rows) {
    if (!USE_DB) {
      for (let i = memIpRows.length - 1; i >= 0; i--) if (memIpRows[i].year === year) memIpRows.splice(i, 1);
      const now = new Date().toISOString();
      memIpRows.push(...rows.map((r) => ({ id: crypto.randomUUID(), year, ...r, updated_at: now })));
      return;
    }
    await query('DELETE FROM ip_table WHERE year = ?', [year]);
    const cols = ['id', 'year', ...ROW_FIELDS];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await query(
        `INSERT INTO ip_table (${cols.join(', ')}) VALUES ${chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`,
        chunk.flatMap((r) => [crypto.randomUUID(), year, ...ROW_FIELDS.map((f) => r[f] ?? null)])
      );
    }
  }

  const UPDATE_COLS = ['year', 'timestamp', 'row_id', 'nvr_ip', 'channel', 'camera_ip', 'camera_name', 'update_type',
    'detail', 'remark', 'updated_by_id', 'updated_by_name'];

  async function listUpdates(year, ip) {
    if (!USE_DB) {
      return memIpUpdates
        .filter((u) => u.year === year && (!ip || lower(u.camera_ip) === lower(ip)))
        .slice()
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || b.id - a.id);
    }
    const rows = ip
      ? await query('SELECT * FROM ip_table_updates WHERE year = ? AND camera_ip = ? ORDER BY timestamp DESC, id DESC', [year, ip])
      : await query('SELECT * FROM ip_table_updates WHERE year = ? ORDER BY timestamp DESC, id DESC LIMIT 2000', [year]);
    return rows.map((u) => ({ ...u, year: Number(u.year), channel: u.channel == null ? null : Number(u.channel) }));
  }

  async function insertUpdate(u) {
    const row = {
      year: u.year,
      timestamp: u.timestamp || new Date(),
      row_id: u.row_id || null,
      nvr_ip: s(u.nvr_ip, 100),
      channel: int(u.channel),
      camera_ip: s(u.camera_ip, 100),
      camera_name: s(u.camera_name),
      update_type: s(u.update_type, 50),
      detail: s(u.detail, 2000),
      remark: s(u.remark, 2000),
      updated_by_id: s(u.updated_by_id, 50),
      updated_by_name: s(u.updated_by_name),
    };
    if (!USE_DB) {
      const id = memIpUpdates.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
      memIpUpdates.push({ id, ...row, timestamp: new Date(row.timestamp).toISOString() });
      return;
    }
    await query(`INSERT INTO ip_table_updates (${UPDATE_COLS.join(', ')}) VALUES (${UPDATE_COLS.map(() => '?').join(', ')})`,
      UPDATE_COLS.map((c) => row[c]));
  }

  async function replaceUpdates(year, ups) {
    if (!USE_DB) {
      for (let i = memIpUpdates.length - 1; i >= 0; i--) if (memIpUpdates[i].year === year) memIpUpdates.splice(i, 1);
    } else {
      await query('DELETE FROM ip_table_updates WHERE year = ?', [year]);
    }
    for (const u of ups) await insertUpdate({ ...u, year });
  }

  // ---------- NVR + channel (resolveNvrIp_V4 / getNextChannelForNvr) ----------
  // NVR: ช่อง lan ของกล้อง (ส่วนก่อน "/") → ถ้าไม่มี เดาจาก subnet ของ IP ที่ NVR ไหนมีกล้องใน subnet นั้นมากที่สุด
  function resolveNvr(device, rows) {
    const lan = String(device.lan || '').split('/')[0].trim();
    if (lan && ADDR_RE.test(lan)) return lan;
    const parts = String(device.ip_address || '').split('.');
    if (parts.length !== 4) return null;
    const subnet = parts.slice(0, 3).join('.');
    const count = {};
    for (const r of rows) {
      if (!r.nvr_ip || !r.camera_ip || !String(r.camera_ip).startsWith(`${subnet}.`)) continue;
      count[r.nvr_ip] = (count[r.nvr_ip] || 0) + 1;
    }
    const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }

  const nextChannel = (rows, nvr) =>
    nvr ? rows.filter((r) => lower(r.nvr_ip) === lower(nvr)).reduce((m, r) => Math.max(m, r.channel || 0), 0) + 1 : null;
  const nextRowNo = (rows) => rows.reduce((m, r) => Math.max(m, r.row_no || 0), 0) + 1;

  async function autoSettings() {
    return {
      add: String(await getSetting('IPTABLE_AUTO_ADD')).toUpperCase() !== 'FALSE',
      remove: ['soft', 'hard', 'off'].includes(await getSetting('IPTABLE_AUTO_REMOVE')) ? await getSetting('IPTABLE_AUTO_REMOVE') : 'soft',
    };
  }

  // ---------- auto-sync กับอุปกรณ์ (เรียกจาก index.js — error ไม่ทำให้การแก้อุปกรณ์ล้ม) ----------
  async function onDeviceAdded(device, by = {}) {
    try {
      const cfg = await autoSettings();
      if (!cfg.add || device.device_type !== SYNC_DEVICE_TYPE || !device.ip_address) return;
      const year = await currentYear();
      const rows = await listRows(year);
      const existing = rows.find((r) => lower(r.camera_ip) === lower(device.ip_address));
      if (existing && !isDeleted(existing)) return; // มีอยู่แล้ว
      if (existing) {
        // เคยถูกลบแบบ soft — กลับมาใช้แถวเดิม
        await patchRow(existing.id, { status: null, camera_name: device.name });
        await insertUpdate({ year, row_id: existing.id, ...existing, camera_name: device.name, update_type: 'ติดตั้งใหม่',
          detail: `กลับมาใช้งาน (เพิ่มกล้อง ${device.name})`, remark: 'อัตโนมัติจากการเพิ่มกล้อง', updated_by_name: by.name || 'system' });
        return;
      }
      const nvr = resolveNvr(device, rows);
      const row = await insertRow(year, {
        row_no: nextRowNo(rows), nvr_ip: nvr, channel: nextChannel(rows, nvr), camera_ip: device.ip_address,
        camera_name: device.name, control: device.cabinet || null, status: null, remark: 'เพิ่มอัตโนมัติจากการเพิ่มกล้อง',
      });
      await insertUpdate({ year, row_id: row.id, ...row, update_type: 'ติดตั้งใหม่',
        detail: `เพิ่ม IP อัตโนมัติ${nvr ? ` → NVR ${nvr} CH ${row.channel}` : ' (หา NVR ไม่ได้ — กรอกเอง)'}`, updated_by_name: by.name || 'system' });
    } catch (err) {
      console.error('[iptable] auto add:', err.message);
    }
  }

  async function onDeviceUpdated(old, device, by = {}) {
    try {
      if (device.device_type !== SYNC_DEVICE_TYPE) return;
      if (!old.ip_address && device.ip_address) return onDeviceAdded(device, by);
      const ipChanged = lower(old.ip_address) !== lower(device.ip_address);
      const nameChanged = old.name !== device.name;
      if (!ipChanged && !nameChanged) return;
      const cfg = await autoSettings();
      if (!cfg.add || !old.ip_address || !device.ip_address) return;
      const year = await currentYear();
      const rows = await listRows(year);
      const row = rows.find((r) => lower(r.camera_ip) === lower(old.ip_address) && !isDeleted(r));
      if (!row) return onDeviceAdded(device, by);
      if (ipChanged && rows.some((r) => r.id !== row.id && lower(r.camera_ip) === lower(device.ip_address))) return; // IP ใหม่มีแถวอยู่แล้ว
      const patch = {};
      if (ipChanged) patch.camera_ip = device.ip_address;
      if (nameChanged) patch.camera_name = device.name;
      const updated = await patchRow(row.id, patch);
      await insertUpdate({
        year, row_id: row.id, ...updated,
        update_type: ipChanged ? 'เปลี่ยน IP' : 'เปลี่ยนชื่อ',
        detail: [ipChanged && `IP ${old.ip_address} → ${device.ip_address}`, nameChanged && `ชื่อ ${old.name} → ${device.name}`].filter(Boolean).join(', '),
        remark: 'อัตโนมัติจากการแก้ไขกล้อง', updated_by_name: by.name || 'system',
      });
    } catch (err) {
      console.error('[iptable] auto update:', err.message);
    }
  }

  async function onDeviceDeleted(old, by = {}) {
    try {
      const cfg = await autoSettings();
      if (cfg.remove === 'off' || old.device_type !== SYNC_DEVICE_TYPE || !old.ip_address) return;
      const year = await currentYear();
      const rows = (await listRows(year)).filter((r) => lower(r.camera_ip) === lower(old.ip_address) && !isDeleted(r));
      for (const r of rows) {
        if (cfg.remove === 'hard') await deleteRow(r.id);
        else {
          await patchRow(r.id, {
            status: `DELETED - CCTV Removed ${today()}`,
            remark: [r.remark, `DELETED from CCTV ${today()} (${old.name})`].filter(Boolean).join(' | ').slice(0, 2000),
          });
        }
        await insertUpdate({ year, row_id: cfg.remove === 'hard' ? null : r.id, ...r,
          update_type: cfg.remove === 'hard' ? 'DELETE_HARD' : 'DELETE_SOFT',
          detail: `ลบกล้อง ${old.name} (IP ${old.ip_address})`, remark: 'อัตโนมัติจากการลบกล้อง', updated_by_name: by.name || 'system' });
      }
    } catch (err) {
      console.error('[iptable] auto delete:', err.message);
    }
  }

  // ---------- routes ----------
  const yearOf = (v) => {
    const y = int(v);
    return y && y >= 2000 && y <= 2100 ? y : null;
  };
  const who = (req) => ({ name: s((req.body || {}).employee_name) || 'admin', id: s((req.body || {}).employee_id, 50) });
  const fail = (res, err) => {
    console.error('[iptable]', err);
    res.status(500).json({ error: 'Database error' });
  };

  app.get('/api/iptable/years', async (req, res) => {
    try {
      const years = await listYears();
      res.json({ years, current: years.length ? years[0].year : new Date().getFullYear(), update_types: UPDATE_TYPES, auto: await autoSettings() });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/iptable', async (req, res) => {
    try {
      const year = yearOf(req.query.year) || (await currentYear());
      res.json({ year, rows: await listRows(year) });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/iptable', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const year = yearOf(body.year) || (await currentYear());
      const { row, error } = cleanRow(body);
      if (error) return res.status(400).json({ error });
      if (!row.camera_ip) return res.status(400).json({ error: 'ต้องกรอก Camera IP' });
      const rows = await listRows(year);
      if (rows.some((r) => lower(r.camera_ip) === lower(row.camera_ip) && !isDeleted(r))) {
        return res.status(409).json({ error: `IP ${row.camera_ip} มีอยู่แล้วในปี ${year}` });
      }
      if (row.channel == null) row.channel = nextChannel(rows, row.nvr_ip);
      if (row.row_no == null) row.row_no = nextRowNo(rows);
      const created = await insertRow(year, row);
      await insertUpdate({ year, row_id: created.id, ...created, update_type: 'ติดตั้งใหม่', detail: 'เพิ่มแถวในตาราง IP',
        updated_by_name: who(req).name, updated_by_id: who(req).id });
      await addLog({ action: 'ip_table', details: `TABLE_IP ${year}: เพิ่ม ${created.camera_ip} (${created.camera_name || '-'})`, employee_name: who(req).name });
      res.status(201).json(created);
    } catch (err) { fail(res, err); }
  });

  app.put('/api/iptable/:id', requireAdmin, async (req, res) => {
    try {
      const old = await getRow(req.params.id);
      if (!old) return res.status(404).json({ error: 'Not found' });
      const { row: patch, error } = cleanRow(req.body || {});
      if (error) return res.status(400).json({ error });
      if (patch.camera_ip && lower(patch.camera_ip) !== lower(old.camera_ip)) {
        const rows = await listRows(old.year);
        if (rows.some((r) => r.id !== old.id && lower(r.camera_ip) === lower(patch.camera_ip) && !isDeleted(r))) {
          return res.status(409).json({ error: `IP ${patch.camera_ip} มีอยู่แล้วในปี ${old.year}` });
        }
      }
      const changes = Object.keys(patch).filter((k) => String(patch[k] ?? '') !== String(old[k] ?? ''));
      if (changes.length === 0) return res.json(old);
      const updated = await patchRow(old.id, Object.fromEntries(changes.map((k) => [k, patch[k]])));
      const label = { row_no: 'No.', nvr_ip: 'NVR', channel: 'CH', camera_ip: 'IP', camera_name: 'ชื่อ', control: 'Control', status: 'สถานะ', remark: 'หมายเหตุ' };
      const body = req.body || {};
      await insertUpdate({
        year: old.year, row_id: old.id, ...updated,
        update_type: UPDATE_TYPES.includes(body.update_type) ? body.update_type
          : changes.includes('camera_ip') ? 'เปลี่ยน IP' : changes.includes('camera_name') ? 'เปลี่ยนชื่อ' : 'อื่นๆ',
        detail: changes.map((k) => `${label[k]}: ${old[k] ?? '-'} → ${updated[k] ?? '-'}`).join(', '),
        remark: s(body.update_remark, 2000),
        updated_by_name: who(req).name, updated_by_id: who(req).id,
      });
      await addLog({ action: 'ip_table', details: `TABLE_IP ${old.year}: แก้ ${updated.camera_ip} (${changes.map((k) => label[k]).join(', ')})`, employee_name: who(req).name });
      res.json(updated);
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/iptable/:id', requireAdmin, async (req, res) => {
    try {
      const old = await getRow(req.params.id);
      if (!old) return res.status(404).json({ error: 'Not found' });
      await deleteRow(old.id);
      await insertUpdate({ year: old.year, ...old, row_id: null, update_type: 'DELETE_HARD', detail: 'ลบแถวออกจากตาราง IP',
        updated_by_name: who(req).name, updated_by_id: who(req).id });
      await addLog({ action: 'ip_table', details: `TABLE_IP ${old.year}: ลบ ${old.camera_ip} (${old.camera_name || '-'})`, employee_name: who(req).name });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // สร้างตารางปีใหม่ (คัดลอกจากปีอื่น หรือเริ่มว่าง) — createNewYearTableIp
  app.post('/api/iptable/years', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const year = yearOf(body.year);
      if (!year) return res.status(400).json({ error: 'ปีไม่ถูกต้อง (2000–2100)' });
      if ((await listYears()).some((y) => y.year === year)) return res.status(409).json({ error: `ตารางปี ${year} มีอยู่แล้ว` });
      const from = yearOf(body.copy_from);
      // ไม่คัดลอกแถวที่ถูกลบแล้ว
      const rows = from ? (await listRows(from)).filter((r) => !isDeleted(r)).map((r) => Object.fromEntries(ROW_FIELDS.map((f) => [f, r[f]]))) : [];
      await replaceYear(year, rows);
      await addLog({ action: 'ip_table', details: `TABLE_IP: สร้างตารางปี ${year}${from ? ` (คัดลอกจาก ${from}, ${rows.length} แถว)` : ''}`, employee_name: who(req).name });
      res.status(201).json({ year, count: rows.length });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/iptable/updates', async (req, res) => {
    try {
      const year = yearOf(req.query.year) || (await currentYear());
      res.json(await listUpdates(year, s(req.query.ip, 100)));
    } catch (err) { fail(res, err); }
  });

  // บันทึกอัปเดตด้วยมือ (ปุ่ม "เพิ่มบันทึกอัปเดต") — addTableIpUpdate
  app.post('/api/iptable/updates', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const row = body.row_id ? await getRow(String(body.row_id)) : null;
      if (body.row_id && !row) return res.status(404).json({ error: 'ไม่พบแถว' });
      if (!s(body.update_type, 50)) return res.status(400).json({ error: 'ต้องเลือกประเภทอัปเดต' });
      if (!s(body.detail, 2000)) return res.status(400).json({ error: 'ต้องกรอกรายละเอียด' });
      const year = row ? row.year : yearOf(body.year) || (await currentYear());
      await insertUpdate({
        year, row_id: row ? row.id : null,
        nvr_ip: row ? row.nvr_ip : body.nvr_ip, channel: row ? row.channel : body.channel,
        camera_ip: row ? row.camera_ip : body.camera_ip, camera_name: row ? row.camera_name : body.camera_name,
        update_type: body.update_type, detail: body.detail, remark: body.remark,
        updated_by_name: who(req).name, updated_by_id: who(req).id,
      });
      await addLog({ action: 'ip_table', details: `TABLE_IP ${year}: ${row ? row.camera_ip : body.camera_ip || ''} [${body.update_type}] ${String(body.detail).slice(0, 100)}`, employee_name: who(req).name });
      res.status(201).json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // นำเข้าทั้งปี (สคริปต์ import-from-xlsx.js) — แทนที่แถว (และประวัติถ้าส่งมา) ของปีนั้น
  // แทนที่ทั้งปี (updates = undefined → ไม่แตะประวัติเดิม)
  async function importYear(yearRaw, rawRows, rawUpdates) {
    const year = yearOf(yearRaw);
    if (!year) throw Object.assign(new Error('ปีไม่ถูกต้อง'), { status: 400 });
    const rows = [];
    let skipped = 0;
    for (const raw of Array.isArray(rawRows) ? rawRows : []) {
      const { row, error } = cleanRow(raw);
      if (error || !row.camera_ip) skipped++;
      else rows.push(row);
    }
    await replaceYear(year, rows);
    let updates = 0;
    if (Array.isArray(rawUpdates)) {
      await replaceUpdates(year, rawUpdates);
      updates = rawUpdates.length;
    }
    await addLog({ action: 'imported', details: `นำเข้า TABLE_IP ${year}: ${rows.length} แถว, ประวัติ ${updates} (skipped ${skipped})` });
    return { year, imported: rows.length, skipped, updates };
  }

  app.post('/api/iptable/import', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      res.json({ ok: true, ...(await importYear(body.year, body.rows, body.updates)) });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      fail(res, err);
    }
  });

  return { initDB, onDeviceAdded, onDeviceUpdated, onDeviceDeleted, importYear };
};
