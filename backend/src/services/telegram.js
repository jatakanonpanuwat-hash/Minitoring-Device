// แจ้งเตือน Telegram เมื่ออุปกรณ์ offline / กลับมา online
// เก็บเหตุการณ์ของรอบ ping นี้ไว้ (queueAlert) แล้วส่งรวมเป็นข้อความเดียวตอนจบรอบ (flushAlerts)
// — สวิตช์ล่มทีเดียว 50 กล้อง จะได้ 1 ข้อความ ไม่ใช่ 50 ข้อความ
const { getSetting } = require('../models/settings');
const { getCatalog } = require('../models/catalog');

const TELEGRAM_MAX_LIST = 30;      // แสดงรายชื่อสูงสุดต่อหัวข้อ เกินนี้สรุปเป็น "และอีก N เครื่อง"
const TELEGRAM_MAX_CHARS = 3900;   // Telegram จำกัด 4096 ตัวอักษรต่อข้อความ
const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
const CHAT_ID_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;

const alertQueue = { down: [], up: [] };
// แสดงในหน้า Settings
const telegramState = { lastSentAt: null, lastError: null };

// kind: 'down' | 'up'
function queueAlert(kind, device, extra = {}) {
  alertQueue[kind].push({
    name: device.name, ip: device.ip_address, zone: device.zone, floor: device.floor, lan: device.lan, ...extra,
  });
}

const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const thaiTime = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' });

async function telegramConfig() {
  return {
    enabled: String(await getSetting('TELEGRAM_ENABLED')).toUpperCase() === 'TRUE',
    token: String(await getSetting('TELEGRAM_BOT_TOKEN')).trim(),
    chatId: String(await getSetting('TELEGRAM_CHAT_ID')).trim(),
    notifyRecovery: String(await getSetting('TELEGRAM_NOTIFY_RECOVERY')).toUpperCase() !== 'FALSE',
  };
}

// ส่งข้อความผ่าน Bot API (fetch ในตัวของ Node 18+) — throw ข้อความภาษาไทยถ้าส่งไม่ได้
async function sendTelegram(text, { token, chatId }) {
  if (!token || !chatId) throw new Error('ยังไม่ได้ตั้งค่า Bot Token / Chat ID');
  if (!TOKEN_RE.test(token)) throw new Error('รูปแบบ Bot Token ไม่ถูกต้อง');
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(`เชื่อมต่อ Telegram ไม่ได้ (${err.name === 'TimeoutError' ? 'หมดเวลา' : err.message}) — เครื่อง server ออกอินเทอร์เน็ตได้หรือไม่?`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    const desc = body.description || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Bot Token ไม่ถูกต้อง');
    if (/chat not found/i.test(desc)) throw new Error('ไม่พบ Chat ID นี้ — ต้องทักบอท / เพิ่มบอทเข้ากลุ่มก่อน');
    throw new Error(`Telegram ตอบกลับ: ${desc}`);
  }
}

async function formatAlertLines(items, kind) {
  const catalog = await getCatalog().catch(() => null);
  const zoneLabel = (k) => (k && catalog?.zones?.find((z) => z.key === k)?.label) || k || '';
  const lines = items.slice(0, TELEGRAM_MAX_LIST).map((d) => {
    const where = [d.floor && `ชั้น ${d.floor}`, zoneLabel(d.zone), d.lan && `LAN ${d.lan}`].filter(Boolean).join(' · ');
    const tail = kind === 'up' && d.latency != null ? ` — ${d.latency} ms` : '';
    return `• <b>${escHtml(d.name)}</b> <code>${escHtml(d.ip)}</code>${tail}${where ? `\n   ${escHtml(where)}` : ''}`;
  });
  if (items.length > TELEGRAM_MAX_LIST) lines.push(`… และอีก ${items.length - TELEGRAM_MAX_LIST} เครื่อง`);
  return lines;
}

async function buildAlertMessage(down, up) {
  const parts = [];
  if (down.length) parts.push(`🔴 <b>อุปกรณ์ Offline ${down.length} เครื่อง</b>`, ...(await formatAlertLines(down, 'down')));
  if (up.length) {
    if (parts.length) parts.push('');
    parts.push(`🟢 <b>กลับมา Online ${up.length} เครื่อง</b>`, ...(await formatAlertLines(up, 'up')));
  }
  parts.push('', `🕒 ${escHtml(thaiTime())}`);
  let text = parts.join('\n');
  // ตัดที่ขึ้นบรรทัดใหม่ (ไม่ตัดกลางแท็ก HTML)
  if (text.length > TELEGRAM_MAX_CHARS) text = `${text.slice(0, text.lastIndexOf('\n', TELEGRAM_MAX_CHARS))}\n…`;
  return text;
}

// ส่งเหตุการณ์ที่ค้างอยู่ (เรียกตอนจบรอบ ping และหลัง ping ทีละเครื่อง) — ไม่ throw
async function flushAlerts() {
  const down = alertQueue.down.splice(0);
  const up = alertQueue.up.splice(0);
  if (!down.length && !up.length) return;
  try {
    const cfg = await telegramConfig();
    if (!cfg.enabled || !cfg.token || !cfg.chatId) return;
    const upList = cfg.notifyRecovery ? up : [];
    if (!down.length && !upList.length) return;
    await sendTelegram(await buildAlertMessage(down, upList), cfg);
    telegramState.lastSentAt = new Date().toISOString();
    telegramState.lastError = null;
  } catch (err) {
    telegramState.lastError = err.message;
    console.error('[telegram]', err.message);
  }
}

// ปุ่ม "ส่งข้อความทดสอบ" ในหน้า Settings
async function sendTestMessage(cfg) {
  await sendTelegram(`✅ <b>ทดสอบการแจ้งเตือน</b>\nระบบ Monitoring Device เชื่อมต่อ Telegram สำเร็จ\n🕒 ${escHtml(thaiTime())}`, cfg);
}

module.exports = { TOKEN_RE, CHAT_ID_RE, telegramState, queueAlert, flushAlerts, telegramConfig, sendTestMessage };
