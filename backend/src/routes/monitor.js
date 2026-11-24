// ระบบตรวจอัตโนมัติ: สถานะ / สั่งตรวจทั้งหมดตอนนี้ / ความคืบหน้า (log วิ่งในหน้า Settings)
const express = require('express');
const { monitorState, monitorProgress, monitorConfig, runMonitorCycle } = require('../services/monitor');

module.exports = ({ requireEditor }) => {
  const router = express.Router();

  router.get('/api/monitor/status', async (req, res) => {
    try {
      const cfg = await monitorConfig();
      res.json({ ...cfg, types: cfg.types ? [...cfg.types] : null, running: monitorState.running, lastRunAt: monitorState.lastRunAt,
        lastDurationMs: monitorState.lastDurationMs, checked: monitorState.checked });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // เริ่ม ping ทั้งหมดแบบเบื้องหลัง แล้วตอบทันที — หน้าเว็บติดตามผลจาก /api/monitor/progress
  // ถ้ามีรอบอัตโนมัติกำลังวิ่งอยู่ จะไม่เริ่มซ้ำ (alreadyRunning) ให้ติดตามรอบนั้นแทน
  router.post('/api/monitor/run', requireEditor, (req, res) => {
    const alreadyRunning = monitorState.running;
    if (!alreadyRunning) runMonitorCycle('manual').catch(() => {});
    // runMonitorCycle ตั้ง runId แบบ async — รอให้เริ่มก่อนตอบ (สูงสุด ~2 วินาที)
    const before = monitorProgress.runId;
    const startedAt = Date.now();
    const wait = () => {
      if (alreadyRunning || monitorProgress.runId !== before || !monitorState.running || Date.now() - startedAt > 2000) {
        return res.json({ ok: true, alreadyRunning, runId: monitorProgress.runId });
      }
      setTimeout(wait, 20);
    };
    wait();
  });

  // ความคืบหน้า + log ใหม่ตั้งแต่ seq ที่ส่งมา (since)
  router.get('/api/monitor/progress', requireEditor, (req, res) => {
    const p = monitorProgress;
    const since = Number(req.query.since) || 0;
    const runId = Number(req.query.runId) || 0;
    // ถ้าเป็นรอบใหม่ (runId ไม่ตรง) ส่ง log ทั้งหมดของรอบนี้
    const entries = runId === p.runId ? p.entries.filter((e) => e.seq > since) : p.entries;
    res.json({
      runId: p.runId, source: p.source, running: p.running, startedAt: p.startedAt, finishedAt: p.finishedAt,
      total: p.total, done: p.done, counts: p.counts, changed: p.changed, note: p.note, entries,
    });
  });

  return router;
};
