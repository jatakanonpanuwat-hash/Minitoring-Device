// ประวัติ (Log) + สถิติเหตุการณ์สำหรับหน้า Dashboard
const express = require('express');
const { listLogs, replaceAllLogs, addLog, eventStats } = require('../models/logs');

module.exports = ({ requireAdmin }) => {
  const router = express.Router();

  // ?limit= (1–1000, ค่าเริ่มต้น 200), ?device_id=
  router.get('/api/logs', async (req, res) => {
    try {
      res.json(await listLogs({ limit: req.query.limit, deviceId: req.query.device_id || null }));
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // สถิติเหตุการณ์ online/offline รายวัน — นับตามวันเวลาไทย (?days= 1–90, ค่าเริ่มต้น 14)
  router.get('/api/stats/events', async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);
      res.json(await eventStats(days));
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // นำเข้าประวัติทั้งชุด (สคริปต์ import-from-sheet.js) — แทนที่ทั้งหมด
  router.post('/api/logs/import', requireAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body && req.body.logs) ? req.body.logs : [];
      const result = await replaceAllLogs(rows);
      await addLog({ action: 'imported', details: `นำเข้าประวัติ ${result.imported} รายการ (skipped ${result.skipped})` });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('Import logs error:', err);
      res.status(500).json({ error: 'Import failed' });
    }
  });

  return router;
};
