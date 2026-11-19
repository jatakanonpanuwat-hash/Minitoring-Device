import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, LogIn, LogOut, ShieldCheck, UserRound, X } from 'lucide-react';
import { changeMyPassword, login, setupFirstAdmin, type AuthUser } from '../utils/monitorClient';

// ---------- context ----------
export interface AuthInfo {
  user: AuthUser | null;
  /** แก้ไขข้อมูลได้ (login แล้ว หรือระบบยังเปิดอิสระ) */
  canEdit: boolean;
  /** สิทธิ์ Admin (ตั้งค่า / แผนผัง / ผู้ใช้) */
  isAdmin: boolean;
  /** ยังไม่มีผู้ใช้และไม่ตั้งรหัส — ทุกคนแก้ได้ */
  open: boolean;
  needsSetup: boolean;
  requestLogin: () => void;
}

export const AuthContext = createContext<AuthInfo>({
  user: null, canEdit: false, isAdmin: false, open: false, needsSetup: false, requestLogin: () => {},
});
export const useAuth = () => useContext(AuthContext);

export const roleLabel = (r: string) => (r === 'admin' ? 'Admin' : 'Editor');

// ---------- เข้าสู่ระบบ / สร้าง Admin คนแรก ----------
interface LoginModalProps {
  needsSetup: boolean;
  setupNeedsSecret: boolean;
  /** ข้อความบอกเหตุผล เช่น session หมดอายุ */
  reason?: string;
  onDone: (token: string, user: AuthUser) => void;
  onClose: () => void;
}

export function LoginModal({ needsSetup, setupNeedsSecret, reason, onDone, onClose }: LoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (needsSetup && password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      const r = needsSetup
        ? await setupFirstAdmin({
            username: username.trim(), password, display_name: displayName.trim() || username.trim(),
            employee_id: employeeId.trim() || undefined, admin_secret: adminSecret || undefined,
          })
        : await login(username.trim(), password);
      onDone(r.token, r.user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-box auth-box" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="auth-head">
          <span className="auth-ico">{needsSetup ? <ShieldCheck size={20} /> : <LogIn size={20} />}</span>
          <div>
            <h2>{needsSetup ? 'ตั้งค่าบัญชี Admin คนแรก' : 'เข้าสู่ระบบ'}</h2>
            <p>
              {needsSetup
                ? 'ยังไม่มีผู้ใช้ในระบบ — บัญชีนี้จะเป็นผู้ดูแลที่เพิ่มผู้ใช้คนอื่นได้'
                : 'เข้าสู่ระบบเพื่อเพิ่ม ย้าย หรือแก้ไขอุปกรณ์'}
            </p>
          </div>
          <button type="button" className="panel-close" onClick={onClose} title="ปิด">
            <X />
          </button>
        </div>

        {reason && <div className="notice">{reason}</div>}
        {error && <div className="notice error">{error}</div>}

        <div className="form-group">
          <label>ชื่อผู้ใช้</label>
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="เช่น somchai.k" />
        </div>
        {needsSetup && (
          <div className="form-row">
            <div className="form-group">
              <label>ชื่อที่แสดง</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ชื่อ-นามสกุล" />
            </div>
            <div className="form-group">
              <label>รหัสพนักงาน</label>
              <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="ไม่บังคับ" />
            </div>
          </div>
        )}
        <div className="form-group">
          <label>รหัสผ่าน</label>
          <input
            type="password"
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {needsSetup && (
          <div className="form-group">
            <label>ยืนยันรหัสผ่าน</label>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        )}
        {needsSetup && setupNeedsSecret && (
          <div className="form-group">
            <label>รหัสผู้ดูแลระบบ (ADMIN_SECRET)</label>
            <input type="password" value={adminSecret} onChange={(e) => setAdminSecret(e.target.value)} />
            <span className="hint">ค่าที่ตั้งไว้ในไฟล์ backend\.env — ยืนยันว่าเป็นผู้ดูแลเครื่องนี้</span>
          </div>
        )}

        <button type="submit" className="btn btn-green btn-block auth-submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'กำลังตรวจสอบ...' : needsSetup ? 'สร้างบัญชีและเข้าสู่ระบบ' : 'เข้าสู่ระบบ'}
        </button>
        {!needsSetup && <p className="hint auth-foot">ลืมรหัสผ่าน? ติดต่อ Admin ให้ตั้งรหัสใหม่</p>}
      </form>
    </div>
  );
}

// ---------- เปลี่ยนรหัสผ่านตัวเอง ----------
export function ChangePasswordModal({ onDone, onClose }: { onDone: (token: string, user: AuthUser) => void; onClose: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirm) {
      setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await changeMyPassword(oldPw, newPw);
      onDone(r.token, r.user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-box auth-box" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="auth-head">
          <span className="auth-ico">
            <KeyRound size={20} />
          </span>
          <div>
            <h2>เปลี่ยนรหัสผ่าน</h2>
            <p>เครื่องอื่นที่ login บัญชีนี้ไว้จะต้องเข้าสู่ระบบใหม่</p>
          </div>
          <button type="button" className="panel-close" onClick={onClose} title="ปิด">
            <X />
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="form-group">
          <label>รหัสผ่านเดิม</label>
          <input autoFocus type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        </div>
        <div className="form-group">
          <label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</label>
          <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </div>
        <div className="form-group">
          <label>ยืนยันรหัสผ่านใหม่</label>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-green btn-block auth-submit" disabled={busy || !oldPw || !newPw}>
          {busy ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
        </button>
      </form>
    </div>
  );
}

// ---------- ปุ่มผู้ใช้บน TopBar ----------
export function UserMenu({ onLogout, onChangePassword }: { onLogout: () => void; onChangePassword: () => void }) {
  const { user, open, requestLogin } = useAuth();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  if (!user) {
    return (
      <button
        className="login-btn"
        onClick={requestLogin}
        title={open ? 'ระบบยังไม่มีผู้ใช้ — ตั้งค่าบัญชี Admin คนแรก' : 'เข้าสู่ระบบเพื่อแก้ไข'}
      >
        <LogIn size={15} /> {open ? 'ตั้งค่าผู้ใช้' : 'เข้าสู่ระบบ'}
      </button>
    );
  }

  const initials = user.display_name.trim().slice(0, 2).toUpperCase();
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-chip" onClick={() => setMenu(!menu)} title={`${user.display_name} (${roleLabel(user.role)})`}>
        <span className="user-avatar">{initials}</span>
        <span className="user-chip-text">
          <b>{user.display_name}</b>
          <small>{roleLabel(user.role)}</small>
        </span>
        <ChevronDown size={14} />
      </button>
      {menu && (
        <div className="user-dropdown">
          <div className="user-dropdown-head">
            <UserRound size={16} />
            <div>
              <b>{user.display_name}</b>
              <small>
                @{user.username}
                {user.employee_id ? ` · ${user.employee_id}` : ''}
              </small>
            </div>
            <span className={'role-badge ' + user.role}>{roleLabel(user.role)}</span>
          </div>
          <button
            onClick={() => {
              setMenu(false);
              onChangePassword();
            }}
          >
            <KeyRound size={14} /> เปลี่ยนรหัสผ่าน
          </button>
          <button
            className="danger"
            onClick={() => {
              setMenu(false);
              onLogout();
            }}
          >
            <LogOut size={14} /> ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  );
}
