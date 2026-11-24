// รายการ ประเภท / สถานะ / โซน (หน้า Settings → จัดการรายการ)
const express = require('express');
const path = require('path');
const { CATALOG_KINDS, DEVICE_FIELD_OF, getCatalog, saveCatalogKind, validateCatalog } = require('../models/catalog');
const { listDevices } = require('../models/devices');
const { uploadIconField, saveUpload } = require('../lib/uploads');

module.exports = ({ requireAdmin }) => {
  const router = express.Router();

  router.get('/api/catalog', async (req, res) => {
    try {
      res.json(await getCatalog());
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // บันทึกทั้งรายการของ kind (types / statuses / zones) — body { items }
  router.put('/api/catalog/:kind', requireAdmin, async (req, res) => {
    try {
      const kind = req.params.kind;
      if (!CATALOG_KINDS[kind]) return res.status(404).json({ error: 'Not found' });
      const result = validateCatalog(kind, (req.body || {}).items);
      if (result.error) return res.status(400).json({ error: result.error });
      // ห้ามลบรายการที่อุปกรณ์ยังใช้อยู่
      const keep = new Set(result.items.map((i) => i.key));
      const field = DEVICE_FIELD_OF[kind];
      const inUse = {};
      for (const d of await listDevices()) {
        const v = d[field];
        if (v && !keep.has(v)) inUse[v] = (inUse[v] || 0) + 1;
      }
      const blocked = Object.entries(inUse);
      if (blocked.length) {
        const old = (await getCatalog())[kind];
        const names = blocked.map(([k, n]) => `${(old.find((i) => i.key === k) || { label: k }).label} (${n} เครื่อง)`);
        return res.status(409).json({ error: `ลบไม่ได้ ยังมีอุปกรณ์ใช้อยู่: ${names.join(', ')}` });
      }
      await saveCatalogKind(kind, result.items);
      res.json(await getCatalog());
    } catch (err) {
      console.error('catalog save error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // อัปโหลดไอคอน/โลโก้ (multipart field "image") → คืน { icon: "/api/uploads/icon-....png" }
  router.post('/api/catalog/icon', requireAdmin, uploadIconField, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์รูป (field "image")' });
      const { url } = saveUpload('icon', path.extname(req.file.originalname).toLowerCase(), req.file.buffer);
      res.status(201).json({ icon: url });
    } catch (err) {
      console.error('Icon upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  return router;
};
