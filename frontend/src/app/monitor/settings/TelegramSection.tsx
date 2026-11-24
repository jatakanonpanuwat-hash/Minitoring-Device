import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Send, Trash2, TriangleAlert } from 'lucide-react';
import { confirmDialog } from '../../components/ui/confirm';
import { formatAgo } from '../../types/monitor';
import { getTelegramConfig, saveTelegramConfig, testTelegram, type TelegramConfig } from '../../utils/monitorClient';

/** ตั้งค่าแจ้งเตือน Telegram (หน้า Settings — เฉพาะ Admin) */
export function TelegramSection() {
  const [cfg, setCfg] = useState<TelegramConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [notifyRecovery, setNotifyRecovery] = useState(true);
  const [chatId, setChatId] = useState('');
  // ช่อง token ว่าง = คงค่าเดิมที่บันทึกไว้
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    getTelegramConfig()
      .then((c) => {
        setCfg(c);
        setEnabled(c.enabled);
        setNotifyRecovery(c.notifyRecovery);
        setChatId(c.chatId);
        setToken('');
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));

  useEffect(() => {
    load();
  }, []);

  const hasToken = !!token.trim() || !!cfg?.tokenSet;
  const canEnable = hasToken && !!chatId.trim();

  const save = async () => {
    if (enabled && !canEnable) {
      setMsg({ ok: false, text: 'ต้องใส่ Bot Token และ Chat ID ก่อนเปิดแจ้งเตือน' });
      return;
    }
    setBusy('save');
    setMsg(null);
    try {
      await saveTelegramConfig({ enabled, notifyRecovery, chatId: chatId.trim(), ...(token.trim() ? { token: token.trim() } : {}) });
      await load();
      setMsg({ ok: true, text: 'บันทึกแล้ว' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    try {
      await testTelegram({ token: token.trim() || undefined, chatId: chatId.trim() || undefined });
      setMsg({ ok: true, text: 'ส่งข้อความทดสอบแล้ว — ตรวจดูใน Telegram' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const removeToken = async () => {
    if (!(await confirmDialog({ title: 'ลบ Bot Token', message: 'ลบ Bot Token ที่บันทึกไว้? การแจ้งเตือนจะถูกปิดด้วย', confirmLabel: 'ลบ', danger: true }))) return;
    setBusy('save');
    try {
      await saveTelegramConfig({ token: '', enabled: false });
      await load();
      setMsg({ ok: true, text: 'ลบ Bot Token แล้ว' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  if (!cfg) return msg ? <div className="notice error">{msg.text}</div> : <p className="hint">กำลังโหลด...</p>;

  return (
    <>
      <div className="form-group">
        <label className="settings-check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          แจ้งเตือนเมื่ออุปกรณ์ Offline
        </label>
      </div>
      <div className="form-group">
        <label className="settings-check">
          <input type="checkbox" checked={notifyRecovery} onChange={(e) => setNotifyRecovery(e.target.checked)} />
          แจ้งด้วยเมื่ออุปกรณ์กลับมา Online
        </label>
      </div>

      <div className="tg-fields">
        <div className="form-group">
          <label>Bot Token</label>
          <div className="tg-token">
            <input
              type={showToken ? 'text' : 'password'}
              className="mono"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={cfg.tokenSet ? `บันทึกไว้แล้ว (${cfg.tokenHint}) — เว้นว่างเพื่อใช้ค่าเดิม` : '123456789:AA...'}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="tg-icon-btn" onClick={() => setShowToken(!showToken)} title={showToken ? 'ซ่อน' : 'แสดง'}>
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            {cfg.tokenSet && (
              <button type="button" className="tg-icon-btn danger" onClick={removeToken} title="ลบ token ที่บันทึกไว้" disabled={!!busy}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="form-group">
          <label>Chat ID</label>
          <input className="mono" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" spellCheck={false} />
        </div>
      </div>

      <div className="btn-row settings-actions">
        <button className="btn btn-green" onClick={save} disabled={!!busy}>
          {busy === 'save' ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
        <button className="btn btn-dark" onClick={test} disabled={!!busy || !hasToken || !chatId.trim()}>
          <Send size={14} /> {busy === 'test' ? 'กำลังส่ง...' : 'ส่งข้อความทดสอบ'}
        </button>
      </div>

      {msg && <div className={msg.ok ? 'notice ok' : 'notice error'} style={{ marginTop: 10 }}>{msg.text}</div>}

      {(cfg.lastSentAt || cfg.lastError) && (
        <div className="tg-status">
          {cfg.lastError ? (
            <span className="bad">
              <TriangleAlert size={13} /> ส่งล่าสุดไม่สำเร็จ: {cfg.lastError}
            </span>
          ) : (
            <span className="good">
              <CheckCircle2 size={13} /> ส่งแจ้งเตือนล่าสุด {formatAgo(cfg.lastSentAt)}
            </span>
          )}
        </div>
      )}

      <details className="tg-help">
        <summary>วิธีหา Bot Token และ Chat ID</summary>
        <ol>
          <li>
            ใน Telegram ทักบอท <b>@BotFather</b> → พิมพ์ <code>/newbot</code> → ตั้งชื่อ → จะได้ <b>Bot Token</b>
          </li>
          <li>เพิ่มบอทเข้ากลุ่มที่ต้องการรับแจ้งเตือน (หรือทักบอทโดยตรงถ้าจะรับคนเดียว) แล้วพิมพ์ข้อความอะไรก็ได้ 1 ข้อความ</li>
          <li>
            เปิด <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> ในเบราว์เซอร์ → หา <code>"chat":{'{'}"id": …{'}'}</code> นั่นคือ{' '}
            <b>Chat ID</b> (ของกลุ่มจะติดลบ เช่น <code>-1001234567890</code>)
          </li>
          <li>ใส่ทั้งสองค่า → กด "ส่งข้อความทดสอบ" → ถ้าได้รับข้อความ กด "บันทึก"</li>
        </ol>
        <p className="hint">
          ระบบส่งรวมเป็นข้อความเดียวต่อรอบ ping (เช่นสวิตช์ล่มพร้อมกันหลายกล้อง จะได้ 1 ข้อความ) · อุปกรณ์สถานะ Maintenance ไม่ถูก ping จึงไม่แจ้ง ·
          เครื่อง server ต้องออกอินเทอร์เน็ตไปที่ api.telegram.org ได้
        </p>
      </details>
    </>
  );
}
