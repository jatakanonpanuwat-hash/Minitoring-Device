// แผนผัง: รายการ / อัปโหลด / แก้ชื่อ-ชั้น / เปลี่ยนรูป / ลบ / นำเข้าทั้งชุด
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { listMaps, getMap, saveMap, deleteMapRow, replaceAllMaps } = require('../models/maps');
const { addLog } = require('../models/logs');
const { uploadImageField, saveUpload, removeUpload } = require('../lib/uploads');

module.exports = ({ requireAdmin }) => {
  const router = express.Router();

  router.get('/api/maps', async (req, res) => {
    try {
      res.json(await listMaps());
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // อัปโหลดรูปแผนผัง (multipart field "image" + ฟิลด์ map_name / map_id / floor)
  router.post('/api/maps', requireAdmin, uploadImageField, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์รูป (field "image")' });
      const { url } = saveUpload('map', path.extname(req.file.originalname).toLowerCase(), req.file.buffer);
      const map = await saveMap({
        map_id: (req.body.map_id || crypto.randomUUID()).toString().trim(),
        map_name: (req.body.map_name || req.file.originalname).toString().trim(),
        image_url: url,
        floor: (req.body.floor || '').toString().trim().slice(0, 50) || null
      });
      res.status(201).json(map);
    } catch (err) {
      console.error('Map upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // แก้ไขแผนผัง (ชื่อ / ชั้น)
  router.put('/api/maps/:id', requireAdmin, async (req, res) => {
    try {
      const existing = await getMap(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const body = req.body || {};
      const map = await saveMap({
        map_id: existing.map_id,
        map_name: String(body.map_name || existing.map_name).trim(),
        image_url: existing.image_url,
        floor: body.floor === undefined ? (existing.floor ?? null) : (String(body.floor).trim().slice(0, 50) || null)
      });
      res.json(map);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.delete('/api/maps/:id', requireAdmin, async (req, res) => {
    try {
      await deleteMapRow(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // เปลี่ยนรูปแผนผังเดิม (multipart field "image") — map_id/ชื่อ/ชั้นคงเดิม อุปกรณ์และตำแหน่งอยู่ครบ
  router.post('/api/maps/:id/image', requireAdmin, uploadImageField, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์รูป (field "image")' });
      const existing = await getMap(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { filename, url } = saveUpload('map', path.extname(req.file.originalname).toLowerCase(), req.file.buffer);
      // จำ URL เก่าก่อน saveMap (โหมด memory แก้ object เดิมในที่)
      const oldUrl = existing.image_url;
      const map = await saveMap({
        map_id: existing.map_id,
        map_name: existing.map_name,
        image_url: url,
        floor: existing.floor ?? null
      });
      // ลบรูปเก่าที่อยู่ใน uploads ของเรา (ไม่แตะ URL ภายนอก)
      removeUpload(oldUrl, filename);
      res.json(map);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // นำเข้าแผนผังทั้งชุด (สคริปต์ import-from-sheet.js) — แทนที่ทั้งหมด
  router.post('/api/maps/import', requireAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body && req.body.maps) ? req.body.maps : [];
      const result = await replaceAllMaps(rows);
      await addLog({ action: 'imported', details: `นำเข้าแผนผัง ${result.imported} รายการ (skipped ${result.skipped})` });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('Import maps error:', err);
      res.status(500).json({ error: 'Import failed' });
    }
  });

  return router;
};
