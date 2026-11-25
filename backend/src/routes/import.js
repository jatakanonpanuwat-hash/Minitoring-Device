// นำเข้าจากไฟล์ Excel ที่อัปโหลดผ่านหน้าเว็บ (Settings → นำเข้าจาก Excel) + สถานะซิงก์อัตโนมัติ
// dry_run=1 คืนสรุปให้ยืนยันก่อน ยังไม่เขียนอะไร
const express = require('express');
const fs = require('fs');
const path = require('path');
const { BACKEND_DIR } = require('../config');
const xlsx = require('../lib/xlsx');
const { uploadXlsxField } = require('../lib/uploads');
const { getSetting } = require('../models/settings');
const { listDevices } = require('../models/devices');
const { listMaps } = require('../models/maps');
const { xlsxSync, applyWorkbook, markSynced } = require('../services/xlsx-sync');
const { buildCameraTemplate } = require('../services/xlsx-template');

module.exports = ({ requireAdmin }) => {
  const router = express.Router();

  router.post('/api/import/xlsx', requireAdmin, uploadXlsxField, async (req, res) => {
    // ไม่แนบไฟล์ + source=project → อ่านไฟล์ในโปรเจกต์ (backend/data/CCTV-MECHA-PART.xlsx หรือ XLSX_FILE)
    if (!req.file && req.body.source === 'project') {
      const p = xlsx.DEFAULT_XLSX;
      if (!fs.existsSync(p)) return res.status(404).json({ error: `ไม่พบไฟล์ ${path.relative(BACKEND_DIR, p)} ในโปรเจกต์` });
      req.file = { buffer: fs.readFileSync(p), originalname: path.basename(p) };
    }
    if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์ .xlsx (field "file")' });
    const only = String(req.body.only || 'cameras').split(',').map((x) => x.trim());
    const dryRun = ['1', 'true'].includes(String(req.body.dry_run || '').toLowerCase());
    let wb;
    try {
      wb = xlsx.parseWorkbook(req.file.buffer, { cameras: only.includes('cameras') });
    } catch (err) {
      return res.status(400).json({ error: `อ่านไฟล์ไม่ได้: ${err.message}` });
    }
    const existingMaps = await listMaps();
    const mapIds = new Set(existingMaps.map((m) => m.map_id));
    const currentCameras = (await listDevices()).filter((d) => d.device_type === 'camera').length;
    const summary = {
      file: req.file.originalname,
      sheets: wb.sheets,
      warnings: wb.warnings,
      cameras: only.includes('cameras') ? { count: wb.devices.length, skipped: wb.skippedDevices, current: currentCameras } : null,
      maps: wb.mapRows.map((r) => ({ map_id: xlsx.str(r.map_id), map_name: xlsx.str(r.map_name) || xlsx.str(r.map_id), exists: mapIds.has(xlsx.str(r.map_id)) })),
    };
    if (dryRun) return res.json({ ok: true, dry_run: true, ...summary });
    if (only.includes('cameras') && wb.devices.length === 0) {
      return res.status(400).json({ error: 'ไม่พบกล้องในแท็บ cctv — ยกเลิกเพื่อไม่ให้กล้องเดิมถูกลบหมด' });
    }

    if (xlsxSync.importing) return res.status(409).json({ error: 'กำลังนำเข้าไฟล์อื่นอยู่ — รอสักครู่' });
    xlsxSync.importing = true;
    try {
      const result = await applyWorkbook(wb, { only, fileName: req.file.originalname });
      // นำเข้าไฟล์ในโปรเจกต์ครบ = ซิงก์แล้ว ไม่ต้องให้ตัวเฝ้าไฟล์นำเข้าซ้ำ
      if (req.body.source === 'project' && only.includes('cameras')) await markSynced(req.file.buffer);
      res.json({ ok: true, ...summary, result });
    } catch (err) {
      console.error('Import xlsx error:', err);
      res.status(500).json({ error: `นำเข้าล้มเหลว: ${err.message}` });
    } finally {
      xlsxSync.importing = false;
    }
  });

  // ดาวน์โหลดเทมเพลตกรอกข้อมูลกล้อง — data=1 ใส่กล้อง/แผนผังปัจจุบันไว้ด้วย (สิทธิ์เท่ากับ GET /api/devices)
  router.get('/api/import/xlsx/template', async (req, res) => {
    const withData = ['1', 'true'].includes(String(req.query.data || '').toLowerCase());
    try {
      const buf = await buildCameraTemplate({ withData });
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="camera-${withData ? 'data' : 'template'}-${day}.xlsx"`,
        'Cache-Control': 'no-store',
      });
      res.send(buf);
    } catch (err) {
      console.error('Build xlsx template error:', err);
      res.status(500).json({ error: `สร้างเทมเพลตไม่ได้: ${err.message}` });
    }
  });

  router.get('/api/import/xlsx/status', async (req, res) => {
    const file = xlsx.DEFAULT_XLSX;
    const st = fs.existsSync(file) ? fs.statSync(file) : null;
    res.json({
      enabled: (await getSetting('XLSX_AUTO_SYNC')) === 'TRUE',
      file: path.relative(BACKEND_DIR, file).split(path.sep).join('/'),
      exists: !!st,
      modified: st ? st.mtime.toISOString() : null,
      last_sync: xlsxSync.lastSync,
      last_result: xlsxSync.lastResult,
      last_error: xlsxSync.lastError,
      syncing: xlsxSync.importing,
    });
  });

  return router;
};
