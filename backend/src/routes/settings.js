// ค่าตั้งระบบที่หน้าเว็บอ่าน/แก้ได้ + การแจ้งเตือน Telegram
const express = require('express');
const { getSetting, setSetting } = require('../models/settings');
const { scheduleMonitor } = require('../services/monitor');
const { scheduleXlsxSync } = require('../services/xlsx-sync');
const { TOKEN_RE, CHAT_ID_RE, telegramState, telegramConfig, sendTestMessage } = require('../services/telegram');

// ค่าตั้งที่ส่งให้หน้าเว็บ และที่หน้าเว็บแก้ได้ (ค่าลับ เช่น token ห้ามใส่ที่นี่)
const PUBLIC_SETTINGS = ['MONITOR_ENABLED', 'MONITOR_INTERVAL_SEC',
  'MONITOR_TIMEOUT_MS', 'MONITOR_FAIL_THRESHOLD', 'MONITOR_WARN_MS', 'MONITOR_TYPES', 'XLSX_AUTO_SYNC'];
const WRITABLE_SETTINGS = PUBLIC_SETTINGS;

module.exports = ({ requireAdmin }) => {
  const router = express.Router();

  router.get('/api/settings', async (req, res) => {
    try {
      const out = {};
      for (const key of PUBLIC_SETTINGS) out[key] = await getSetting(key);
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.post('/api/settings', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      for (const key of WRITABLE_SETTINGS) {
        if (body[key] !== undefined) await setSetting(key, String(body[key]));
      }
      scheduleMonitor(); // interval อาจเปลี่ยน
      if (body.XLSX_AUTO_SYNC === 'TRUE') scheduleXlsxSync('เปิดซิงก์อัตโนมัติ', 500);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ---------- Telegram ----------
  // token เป็นความลับ: ไม่ส่งกลับ — บอกแค่ว่าตั้งไว้แล้วหรือยัง + 4 ตัวท้าย
  router.get('/api/telegram', requireAdmin, async (req, res) => {
    try {
      const cfg = await telegramConfig();
      res.json({
        enabled: cfg.enabled,
        chatId: cfg.chatId,
        notifyRecovery: cfg.notifyRecovery,
        tokenSet: !!cfg.token,
        tokenHint: cfg.token ? `…${cfg.token.slice(-4)}` : '',
        lastSentAt: telegramState.lastSentAt,
        lastError: telegramState.lastError,
      });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  router.put('/api/telegram', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const chatId = b.chatId !== undefined ? String(b.chatId).trim() : undefined;
      const token = b.token !== undefined ? String(b.token).trim() : undefined;
      if (chatId && !CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: 'Chat ID ต้องเป็นตัวเลข (เช่น -1001234567890) หรือ @ชื่อช่อง' });
      if (token && !TOKEN_RE.test(token)) return res.status(400).json({ error: 'รูปแบบ Bot Token ไม่ถูกต้อง (เช่น 123456789:AA...)' });
      if (b.enabled !== undefined) await setSetting('TELEGRAM_ENABLED', b.enabled ? 'TRUE' : 'FALSE');
      if (b.notifyRecovery !== undefined) await setSetting('TELEGRAM_NOTIFY_RECOVERY', b.notifyRecovery ? 'TRUE' : 'FALSE');
      if (chatId !== undefined) await setSetting('TELEGRAM_CHAT_ID', chatId);
      if (token !== undefined) await setSetting('TELEGRAM_BOT_TOKEN', token); // ส่งมาเฉพาะตอนเปลี่ยน ('' = ลบ)
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ส่งข้อความทดสอบ — ใช้ token/chatId ที่ส่งมา (ทดสอบก่อนบันทึก) หรือค่าที่บันทึกไว้
  router.post('/api/telegram/test', requireAdmin, async (req, res) => {
    try {
      const saved = await telegramConfig();
      const token = String(req.body?.token || '').trim() || saved.token;
      const chatId = String(req.body?.chatId || '').trim() || saved.chatId;
      await sendTestMessage({ token, chatId });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
