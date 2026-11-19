import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, UserRound } from 'lucide-react';
import { formatAgo } from '../types/monitor';
import { createUser, deleteUser, listUsers, updateUser, type AuthUser, type Role } from '../utils/monitorClient';
import { roleLabel, useAuth } from './auth';

const EMPTY = { username: '', display_name: '', employee_id: '', role: 'editor' as Role, password: '' };

/** จัดการผู้ใช้ (หน้า Settings — เฉพาะ Admin) */
export function UsersSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');

  const load = () =>
    listUsers()
      .then((u) => {
        setUsers(u);
        setError('');
      })
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(ok);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const done = await run(
      () =>
        createUser({
          username: form.username.trim(), password: form.password, role: form.role,
          display_name: form.display_name.trim() || form.username.trim(), employee_id: form.employee_id.trim() || undefined,
        }),
      `เพิ่มผู้ใช้ ${form.username.trim()} แล้ว`
    );
    if (done) {
      setForm(EMPTY);
      setAdding(false);
    }
  };

  const admins = users.filter((u) => u.role === 'admin' && !u.disabled).length;

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      {msg && <div className="notice ok">{msg}</div>}

      <div className="users-list">
        {users.map((u) => {
          const isMe = me?.id === u.id;
          const lastAdmin = u.role === 'admin' && !u.disabled && admins <= 1;
          return (
            <div key={u.id} className={'user-row' + (u.disabled ? ' disabled' : '')}>
              <span className="user-avatar sm">{u.display_name.trim().slice(0, 2).toUpperCase()}</span>
              <div className="user-row-main">
                <b>
                  {u.display_name}
                  {isMe && <em> (คุณ)</em>}
                </b>
                <small>
                  @{u.username}
                  {u.employee_id ? ` · ${u.employee_id}` : ''} · เข้าล่าสุด {u.last_login ? formatAgo(u.last_login) : '—'}
                </small>
              </div>
              <select
                value={u.role}
                disabled={lastAdmin}
                title={lastAdmin ? 'ต้องมี Admin อย่างน้อย 1 คน' : 'สิทธิ์'}
                onChange={(e) => run(() => updateUser(u.id, { role: e.target.value as Role }), `เปลี่ยนสิทธิ์ ${u.username} แล้ว`)}
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
              </select>
              <label className="user-active" title={lastAdmin || isMe ? 'ปิดบัญชีนี้ไม่ได้' : 'เปิด/ปิดการใช้งาน'}>
                <input
                  type="checkbox"
                  checked={!u.disabled}
                  disabled={lastAdmin || isMe}
                  onChange={(e) =>
                    run(() => updateUser(u.id, { disabled: !e.target.checked }), `${e.target.checked ? 'เปิด' : 'ปิด'}ใช้งาน ${u.username} แล้ว`)
                  }
                />
                ใช้งาน
              </label>
              <button className="mini-btn" title="ตั้งรหัสผ่านใหม่" onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setResetPw(''); }}>
                <KeyRound />
              </button>
              <button
                className="mini-btn danger"
                title={isMe ? 'ลบบัญชีตัวเองไม่ได้' : 'ลบผู้ใช้'}
                disabled={isMe || lastAdmin}
                onClick={() => {
                  if (window.confirm(`ลบผู้ใช้ ${u.display_name} (@${u.username})?`)) run(() => deleteUser(u.id), `ลบ ${u.username} แล้ว`);
                }}
              >
                <Trash2 />
              </button>
              {resetFor === u.id && (
                <form
                  className="user-reset"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run(() => updateUser(u.id, { password: resetPw }), `ตั้งรหัสผ่านใหม่ให้ ${u.username} แล้ว — ต้อง login ใหม่`)) setResetFor(null);
                  }}
                >
                  <input type="password" autoFocus autoComplete="new-password" placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                  <button className="btn btn-green btn-sm" disabled={resetPw.length < 6}>
                    บันทึก
                  </button>
                  <button type="button" className="btn btn-dark btn-sm" onClick={() => setResetFor(null)}>
                    ยกเลิก
                  </button>
                </form>
              )}
            </div>
          );
        })}
        {users.length === 0 && !error && <p className="hint">กำลังโหลด...</p>}
      </div>

      {adding ? (
        <form className="user-add" onSubmit={add}>
          <div className="form-row">
            <div className="form-group">
              <label>ชื่อผู้ใช้ *</label>
              <input autoFocus autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="a-z 0-9 . _ -" />
            </div>
            <div className="form-group">
              <label>ชื่อที่แสดง</label>
              <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="ชื่อ-นามสกุล" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>รหัสพนักงาน</label>
              <input value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="ไม่บังคับ" />
            </div>
            <div className="form-group">
              <label>สิทธิ์</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="editor">Editor — เพิ่ม/ย้าย/แก้อุปกรณ์</option>
                <option value="admin">Admin — ทุกอย่าง + ตั้งค่า + ผู้ใช้</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>รหัสผ่านเริ่มต้น * (อย่างน้อย 6 ตัว)</label>
            <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <span className="hint">แจ้งให้ผู้ใช้เปลี่ยนรหัสเองหลัง login (เมนูชื่อผู้ใช้มุมขวาบน)</span>
          </div>
          <div className="btn-row">
            <button className="btn btn-green" disabled={!form.username.trim() || form.password.length < 6}>
              <UserRound size={14} /> เพิ่มผู้ใช้
            </button>
            <button type="button" className="btn btn-dark" onClick={() => { setAdding(false); setForm(EMPTY); }}>
              ยกเลิก
            </button>
          </div>
        </form>
      ) : (
        <button className="map-add" onClick={() => setAdding(true)}>
          <Plus size={14} /> เพิ่มผู้ใช้
        </button>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        <b>Editor</b>: เพิ่ม / ย้าย / หมุน / แก้ / ลบอุปกรณ์ และแก้ TABLE_IP · <b>Admin</b>: ทุกอย่างของ Editor + ตั้งค่า, แผนผัง, ประเภท/สถานะ/โซน, นำเข้า Excel และจัดการผู้ใช้ ·
        ทุกคนดูแผนผัง / Dashboard / Log ได้โดยไม่ต้อง login
      </p>
    </>
  );
}
