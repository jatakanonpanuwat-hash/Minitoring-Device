// คู่มือการใช้งาน (เมนู Tutorial): ทุกคนดูได้, Admin อัปโหลด / แก้ชื่อ / เรียงลำดับ / ลบ
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { uploadTutorialField, TUTORIAL_EXTS, TUTORIAL_MAX_MB, removeUpload } = require('../lib/uploads');
const { listTutorials, addTutorial, updateTutorial, removeTutorial, reorderTutorials } = require('../models/tutorials');

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const byName = (req) => (req.user ? req.user.display_name || req.user.username : req.viaSecret ? 'admin-secret' : null);

module.exports = ({ requireAdmin }) => {
  const router = express.Router();

  router.get('/api/tutorials', async (req, res) => {
    try {
      res.json(await listTutorials());
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ชนิดไฟล์ / ขนาดที่รับ — ให้หน้าเว็บแสดงและตรวจก่อนอัปโหลด
  router.get('/api/tutorials/limits', (req, res) => {
    res.json({ exts: TUTORIAL_EXTS, max_mb: TUTORIAL_MAX_MB });
  });

  // อัปโหลด (multipart field "file" + title / description)
  router.post('/api/tutorials', requireAdmin, uploadTutorialField, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์ (field "file")' });
    try {
      // multer อ่านชื่อไฟล์เป็น latin1 — แปลงกลับเป็น UTF-8 ให้ชื่อภาษาไทยถูก
      const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(original).toLowerCase();
      const title = clean(req.body.title, 150) || path.basename(original, ext);
      const now = new Date().toISOString();
      const item = await addTutorial({
        id: crypto.randomUUID(),
        title,
        description: clean(req.body.description, 1000),
        file_url: `/api/uploads/${req.file.filename}`,
        file_name: original,
        ext: ext.slice(1),
        size: req.file.size,
        created_at: now,
        updated_at: now,
        created_by: byName(req),
      });
      res.status(201).json(item);
    } catch (err) {
      removeUpload(`/api/uploads/${req.file.filename}`);
      console.error('Tutorial upload error:', err);
      res.status(500).json({ error: 'บันทึกคู่มือไม่สำเร็จ' });
    }
  });

  // เรียงลำดับ { ids: [...] } — ต้องอยู่ก่อน /:id
  router.put('/api/tutorials/order', requireAdmin, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    if (!ids) return res.status(400).json({ error: 'ต้องส่ง ids เป็น array' });
    try {
      res.json(await reorderTutorials(ids));
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // แก้ชื่อ / คำอธิบาย
  router.put('/api/tutorials/:id', requireAdmin, async (req, res) => {
    const patch = {};
    if (req.body?.title !== undefined) {
      patch.title = clean(req.body.title, 150);
      if (!patch.title) return res.status(400).json({ error: 'ต้องมีชื่อคู่มือ' });
    }
    if (req.body?.description !== undefined) patch.description = clean(req.body.description, 1000);
    try {
      const t = await updateTutorial(req.params.id, patch);
      if (!t) return res.status(404).json({ error: 'ไม่พบคู่มือ' });
      res.json(t);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.delete('/api/tutorials/:id', requireAdmin, async (req, res) => {
    try {
      const t = await removeTutorial(req.params.id);
      if (!t) return res.status(404).json({ error: 'ไม่พบคู่มือ' });
      removeUpload(t.file_url);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
};
