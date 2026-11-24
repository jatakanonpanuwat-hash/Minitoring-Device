// อุปกรณ์: รายการ / เพิ่ม / แก้ / ลบ / กู้คืน / ตรวจทันที / ประวัติ uptime / สแนปช็อตรายปี / นำเข้าทั้งชุด
const express = require('express');
const {
  DEVICE_ID_RE, pickDeviceFields, listDevices, getDevice, createDevice, updateDevice, deleteDeviceRow,
  replaceDevicesByType,
} = require('../models/devices');
const { pausedStatusKeys } = require('../models/catalog');
const { snapYearOf, listSnapshotYears, getSnapshot, saveSnapshot } = require('../models/snapshots');
const { getDeviceHistory } = require('../models/history');
const { addLog } = require('../models/logs');
const { HOST_RE, checkMethodOf, runCheck } = require('../services/checks');
const { monitorConfig, shouldMonitor, applyCheckResult, checkSoonIfMonitored } = require('../services/monitor');
const { flushAlerts } = require('../services/telegram');

module.exports = ({ requireAdmin, requireEditor }) => {
  const router = express.Router();

  // ---------- สแนปช็อตรายการอุปกรณ์รายปี ----------
  // (ต้องอยู่ก่อน /api/devices/:id ไม่งั้น 'snapshots' จะถูกจับเป็น id)
  router.get('/api/devices/snapshots/years', async (req, res) => {
    try {
      res.json({ years: await listSnapshotYears(), current: new Date().getFullYear() });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.get('/api/devices/snapshots', async (req, res) => {
    try {
      const year = snapYearOf(req.query.year);
      if (!year) return res.status(400).json({ error: 'ต้องระบุปี (2000–2100)' });
      const snap = await getSnapshot(year);
      if (!snap) return res.status(404).json({ error: `ยังไม่มีสแนปช็อตปี ${year}` });
      res.json(snap);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // บันทึกสแนปช็อตจากรายการอุปกรณ์ปัจจุบัน (มีของปีนั้นแล้ว = เขียนทับ)
  router.post('/api/devices/snapshots', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const year = snapYearOf(body.year) || new Date().getFullYear();
      const devices = await listDevices(null);
      const rec = await saveSnapshot(year, devices, body.employee_name || null);
      await addLog({
        employee_id: body.employee_id, employee_name: body.employee_name,
        action: 'snapshot', details: `บันทึกสแนปช็อตรายการอุปกรณ์ปี ${year} (${devices.length} เครื่อง)`,
      });
      res.json({ year: rec.year, count: devices.length, created_at: rec.created_at });
    } catch (err) {
      console.error('Save snapshot error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ---------- อุปกรณ์ ----------
  router.get('/api/devices', async (req, res) => {
    try {
      res.json(await listDevices(req.query.map_id || null));
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.get('/api/devices/:id', async (req, res) => {
    try {
      const d = await getDevice(req.params.id);
      if (!d) return res.status(404).json({ error: 'Not found' });
      res.json(d);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.post('/api/devices', requireEditor, async (req, res) => {
    try {
      const data = await pickDeviceFields(req.body || {});
      if (!data.name || !String(data.name).trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (data.ip_address && !HOST_RE.test(data.ip_address)) {
        return res.status(400).json({ error: 'IP / hostname ไม่ถูกต้อง' });
      }
      data.name = String(data.name).trim();
      if (!data.device_type) data.device_type = (await pickDeviceFields({ device_type: 'other' })).device_type;
      const device = await createDevice(data);
      await addLog({
        employee_id: req.body.employee_id, employee_name: req.body.employee_name,
        action: 'added', device_id: device.id, device_name: device.name,
        zone: device.zone, floor: device.floor, details: `เพิ่มอุปกรณ์ ${device.name}`, new_values: device
      });
      res.status(201).json(device);
      // ping ทันทีให้เห็นสถานะโดยไม่ต้องรอรอบถัดไป
      checkSoonIfMonitored(device);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.put('/api/devices/:id', requireEditor, async (req, res) => {
    try {
      const old = await getDevice(req.params.id);
      if (!old) return res.status(404).json({ error: 'Not found' });
      const data = await pickDeviceFields(req.body || {});
      if (data.name) data.name = String(data.name).trim();
      if (data.ip_address && !HOST_RE.test(data.ip_address)) {
        return res.status(400).json({ error: 'IP / hostname ไม่ถูกต้อง' });
      }
      // เปลี่ยน IP หรือออกจาก maintenance — เริ่มนับ ping ใหม่
      if ((data.ip_address !== undefined && data.ip_address !== old.ip_address) ||
          (data.status && data.status !== old.status && (await pausedStatusKeys()).has(old.status))) {
        data.fail_count = 0;
      }
      const device = await updateDevice(req.params.id, data);
      const removed = old.x_percent != null && device.x_percent == null;
      const moved = !removed && ((data.x_percent !== undefined && Number(data.x_percent) !== old.x_percent) ||
                    (data.y_percent !== undefined && Number(data.y_percent) !== old.y_percent));
      const action = moved ? 'moved' : 'updated';
      await addLog({
        employee_id: req.body.employee_id, employee_name: req.body.employee_name,
        action, device_id: device.id, device_name: device.name,
        zone: device.zone, floor: device.floor,
        details: removed ? `เอาออกจากแผนผัง ${device.name}` : moved ? `ย้ายตำแหน่ง ${device.name}` : `แก้ไข ${device.name}`,
        old_values: old, new_values: device
      });
      res.json(device);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.delete('/api/devices/:id', requireEditor, async (req, res) => {
    try {
      const old = await getDevice(req.params.id);
      if (!old) return res.status(404).json({ error: 'Not found' });
      await deleteDeviceRow(req.params.id);
      await addLog({
        employee_id: req.body && req.body.employee_id, employee_name: req.body && req.body.employee_name,
        action: 'deleted', device_id: old.id, device_name: old.name,
        zone: old.zone, floor: old.floor, details: `ลบอุปกรณ์ ${old.name}`, old_values: old
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // กู้คืนอุปกรณ์ที่เพิ่งลบ (ปุ่ม "เลิกทำ" บนหน้าเว็บ) — body = ข้อมูลอุปกรณ์ก่อนลบ, ใช้ id เดิม
  router.post('/api/devices/:id/restore', requireEditor, async (req, res) => {
    try {
      const id = req.params.id;
      if (!DEVICE_ID_RE.test(id)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
      if (await getDevice(id)) return res.status(409).json({ error: 'อุปกรณ์นี้มีอยู่แล้ว' });
      const data = await pickDeviceFields(req.body || {});
      if (!data.name || !String(data.name).trim()) return res.status(400).json({ error: 'name is required' });
      if (data.ip_address && !HOST_RE.test(data.ip_address)) return res.status(400).json({ error: 'IP / hostname ไม่ถูกต้อง' });
      const device = await createDevice(data, id);
      await addLog({
        employee_id: req.body.employee_id, employee_name: req.body.employee_name,
        action: 'added', device_id: device.id, device_name: device.name,
        zone: device.zone, floor: device.floor, details: `กู้คืนอุปกรณ์ ${device.name} (เลิกทำการลบ)`, new_values: device
      });
      res.status(201).json(device);
      checkSoonIfMonitored(device);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // นำเข้าอุปกรณ์ทั้งชุด (สคริปต์ import-from-sheet.js / import-from-xlsx.js) — แทนที่เฉพาะ device_type ที่ระบุ ไม่ลบประเภทอื่น
  // เขียน log แค่ 1 ครั้ง ไม่ใช่รายตัว
  router.post('/api/devices/import', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const rows = Array.isArray(body.devices) ? body.devices : [];
      const type = String(body.type || 'camera');
      const result = await replaceDevicesByType(type, rows);
      await addLog({ action: 'imported', details: `นำเข้าอุปกรณ์ ${result.imported} รายการ (skipped ${result.skipped})` });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('Import devices error:', err);
      res.status(500).json({ error: 'Import failed' });
    }
  });

  // ตรวจอุปกรณ์ตัวเดียวทันทีด้วยวิธีของเครื่องนั้น (ปุ่ม "ตรวจตอนนี้")
  router.post('/api/devices/:id/ping', async (req, res) => {
    try {
      const device = await getDevice(req.params.id);
      if (!device) return res.status(404).json({ error: 'Not found' });
      if (!device.ip_address) return res.status(400).json({ error: 'อุปกรณ์นี้ยังไม่มี IP' });
      const cfg = await monitorConfig();
      const method = checkMethodOf(device);
      const result = await runCheck(device, method, cfg.timeoutMs);
      // อยู่ในสถานะที่หยุดตรวจ (เช่น maintenance), ปิด monitor หรือประเภทไม่ได้เลือกไว้ — แสดงผลอย่างเดียว ไม่เปลี่ยนสถานะ
      if (shouldMonitor(device, await pausedStatusKeys(), cfg)) {
        await applyCheckResult(device, result, cfg, method);
        flushAlerts();
      }
      res.json({ ...result, method, device: await getDevice(device.id) });
    } catch (err) {
      res.status(500).json({ error: 'Ping failed' });
    }
  });

  // ประวัติผลตรวจรายเครื่อง — กราฟ uptime ย้อนหลัง (?range=24h|7d|30d)
  router.get('/api/devices/:id/history', async (req, res) => {
    try {
      const device = await getDevice(req.params.id);
      if (!device) return res.status(404).json({ error: 'Not found' });
      const range = ['24h', '7d', '30d'].includes(req.query.range) ? req.query.range : '24h';
      res.json({ device_id: device.id, range, buckets: await getDeviceHistory(device.id, range) });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
};
