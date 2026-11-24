// สถานะระบบ: health check, โหมดรหัสผู้ดูแล, เครือข่ายของเครื่อง server
const express = require('express');
const { USE_DB, ADMIN_SECRET } = require('../config');
const { query } = require('../db/mariadb');
const { networkInfo } = require('../services/network');

module.exports = ({ requireAdmin, auth }) => {
  const router = express.Router();

  router.get('/api/health', async (req, res) => {
    try {
      if (USE_DB) await query('SELECT 1');
      res.json({ ok: true, db: USE_DB, mode: USE_DB ? 'mariadb' : 'memory' });
    } catch (err) {
      res.status(500).json({ ok: false, db: false });
    }
  });

  // สถานะเครือข่ายของเครื่อง server + IP ของผู้เปิดเว็บ (แถบล่างของหน้าเว็บ)
  router.get('/api/network', async (req, res) => {
    try {
      res.json(await networkInfo(req));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/admin/check', requireAdmin, (req, res) => {
    res.json({ ok: true });
  });

  // หน้าเว็บใช้ตัดสินว่าจะแสดงช่องรหัสผู้ดูแลไหม
  router.get('/api/admin/mode', async (req, res) => {
    res.json({ required: !!ADMIN_SECRET || (await auth.userCount()) > 0 });
  });

  return router;
};
