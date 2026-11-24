// ระบบ login + บัญชีผู้ใช้ + สิทธิ์ (Admin / Editor)
//
// - ทุกคนดูข้อมูลได้โดยไม่ต้อง login; การแก้ไขต้อง login
//     editor = เพิ่ม/ย้าย/แก้/ลบอุปกรณ์, ping
//     admin  = ทุกอย่าง + ตั้งค่า, รายการประเภท/สถานะ/โซน, แผนผัง, นำเข้า, จัดการผู้ใช้
// - ยังไม่มีผู้ใช้เลย = หน้าเว็บให้สร้างบัญชี Admin คนแรก (ถ้าตั้ง ADMIN_SECRET ไว้ต้องกรอกรหัสนั้นด้วย)
// - ยังไม่มีผู้ใช้ และไม่ตั้ง ADMIN_SECRET = โหมดเปิด (ทุกคนแก้ได้ — เหมือนก่อนมีระบบ login)
// - header x-admin-secret ที่ตรงกับ ADMIN_SECRET = สิทธิ์ admin (ให้สคริปต์ import ใช้ต่อได้)
// - รหัสผ่านเก็บแบบ scrypt + salt, token ลงลายเซ็น HMAC (ไม่ต้องเก็บ session) — เปลี่ยนรหัส/ปิดบัญชีแล้ว token เก่าใช้ไม่ได้

const crypto = require('crypto');

const ROLES = ['admin', 'editor'];
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 7 วัน
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const MIN_PASSWORD = 6;

module.exports = function createAuth({ app, USE_DB, query, getSetting, setSetting, addLog, memUsers, ADMIN_SECRET }) {
  // ---------- รหัสผ่าน ----------
  const scrypt = (pw, salt) =>
    new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

  async function hashPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${(await scrypt(pw, salt)).toString('hex')}`;
  }

  async function verifyPassword(pw, stored) {
    const [kind, salt, hex] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hex) return false;
    const key = await scrypt(pw, salt);
    const want = Buffer.from(hex, 'hex');
    return want.length === key.length && crypto.timingSafeEqual(want, key);
  }

  // ---------- เก็บผู้ใช้ ----------
  async function initDB() {
    if (!USE_DB) return;
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id            VARCHAR(36)  NOT NULL PRIMARY KEY,
        username      VARCHAR(40)  NOT NULL UNIQUE,
        display_name  VARCHAR(200) NOT NULL,
        employee_id   VARCHAR(50),
        role          VARCHAR(20)  NOT NULL DEFAULT 'editor',
        password_hash VARCHAR(300) NOT NULL,
        token_version INT          NOT NULL DEFAULT 0,
        disabled      TINYINT(1)   NOT NULL DEFAULT 0,
        last_login    DATETIME,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  const normalize = (u) =>
    u && { ...u, disabled: !!Number(u.disabled), token_version: Number(u.token_version) || 0 };

  async function listUsers() {
    if (!USE_DB) return memUsers.map(normalize);
    return (await query('SELECT * FROM users ORDER BY created_at')).map(normalize);
  }
  async function getUser(id) {
    if (!USE_DB) return normalize(memUsers.find((u) => u.id === id));
    return normalize((await query('SELECT * FROM users WHERE id = ?', [id]))[0]);
  }
  async function getUserByName(username) {
    const name = String(username || '').toLowerCase();
    if (!USE_DB) return normalize(memUsers.find((u) => u.username.toLowerCase() === name));
    return normalize((await query('SELECT * FROM users WHERE LOWER(username) = ?', [name]))[0]);
  }
  async function insertUser(u) {
    const row = { id: crypto.randomUUID(), token_version: 0, disabled: 0, last_login: null, created_at: new Date().toISOString(), ...u };
    if (!USE_DB) memUsers.push(row);
    else {
      const cols = Object.keys(row).filter((c) => c !== 'created_at');
      await query(`INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
    }
    return getUser(row.id);
  }
  async function patchUser(id, patch) {
    if (!USE_DB) {
      const u = memUsers.find((x) => x.id === id);
      if (u) Object.assign(u, patch);
    } else if (Object.keys(patch).length) {
      const cols = Object.keys(patch);
      await query(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => patch[c]), id]);
    }
    return getUser(id);
  }
  async function removeUser(id) {
    if (!USE_DB) {
      const i = memUsers.findIndex((u) => u.id === id);
      if (i >= 0) memUsers.splice(i, 1);
    } else await query('DELETE FROM users WHERE id = ?', [id]);
  }
  const userCount = async () => (await listUsers()).length;

  /** ข้อมูลผู้ใช้ที่ส่งให้หน้าเว็บ (ไม่มี hash) */
  const publicUser = (u) =>
    u && {
      id: u.id, username: u.username, display_name: u.display_name, employee_id: u.employee_id || null,
      role: u.role, disabled: !!u.disabled, last_login: u.last_login || null, created_at: u.created_at || null,
    };

  // ---------- token ----------
  let signKey = null;
  async function key() {
    if (signKey) return signKey;
    let k = await getSetting('AUTH_SIGN_KEY');
    if (!k) {
      k = crypto.randomBytes(32).toString('hex');
      await setSetting('AUTH_SIGN_KEY', k);
    }
    signKey = k;
    return k;
  }
  const b64 = (s) => Buffer.from(s).toString('base64url');

  async function issueToken(u) {
    const body = b64(JSON.stringify({ u: u.id, v: u.token_version || 0, exp: Date.now() + TOKEN_TTL_MS }));
    const sig = crypto.createHmac('sha256', await key()).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  async function userFromToken(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', await key()).update(body).digest('base64url');
    if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
    let p;
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      return null;
    }
    if (!p || p.exp < Date.now()) return null;
    const u = await getUser(p.u);
    if (!u || u.disabled || (u.token_version || 0) !== p.v) return null;
    return u;
  }

  // ---------- middleware ----------
  /** อ่านตัวตนจาก header ทุก request; ใส่ชื่อผู้แก้ลง body ให้ Log/อุปกรณ์บันทึกคนทำ (ทับค่าที่ส่งมาเอง กันปลอมชื่อ) */
  async function identify(req, res, next) {
    try {
      req.user = null;
      req.viaSecret = false;
      const auth = req.headers.authorization || '';
      if (auth.startsWith('Bearer ')) req.user = await userFromToken(auth.slice(7));
      if (!req.user && ADMIN_SECRET && req.headers['x-admin-secret'] === ADMIN_SECRET) req.viaSecret = true;
      if (req.user && req.method !== 'GET') {
        if (req.body == null) req.body = {};
        if (typeof req.body === 'object' && !Array.isArray(req.body)) {
          req.body.employee_id = req.user.employee_id || req.user.username;
          req.body.employee_name = req.user.display_name;
          req.body.updated_by = req.user.display_name;
          req.body.updated_by_id = req.user.employee_id || req.user.username;
          req.body.updated_by_name = req.user.display_name;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  /** โหมดเปิด = ยังไม่มีผู้ใช้และไม่ตั้ง ADMIN_SECRET (ทุกคนแก้ได้) */
  const openMode = async () => !ADMIN_SECRET && (await userCount()) === 0;

  const requireRole = (role) => async (req, res, next) => {
    try {
      if (req.viaSecret) return next();
      if (req.user) {
        if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'ต้องเป็น Admin' });
        return next();
      }
      if (await openMode()) return next();
      return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    } catch (err) {
      res.status(500).json({ error: 'Auth error' });
    }
  };
  const requireEditor = requireRole('editor');
  const requireAdminRole = requireRole('admin');

  // ---------- กันเดารหัส: ผิด 5 ครั้งติด = รอ 5 นาที (ต่อ username + IP) ----------
  const fails = new Map();
  const failKey = (req, username) => `${String(username || '').toLowerCase()}|${req.ip}`;
  const locked = (k) => {
    const f = fails.get(k);
    return f && f.count >= 5 && Date.now() - f.at < 5 * 60 * 1000;
  };

  // ---------- routes ----------
  // อ่านตัวตนก่อนทุก route (ทั้งของไฟล์นี้และ src/routes/) — create ต้องถูกเรียกหลัง express.json และก่อน route อื่น (ดู src/app.js)
  app.use(identify);

  /** ผู้ทำรายการ (ใส่ใน Log) */
  const by = (req) => (req.user ? { employee_id: req.user.employee_id || req.user.username, employee_name: req.user.display_name } : { employee_name: req.viaSecret ? 'admin-secret' : null });
  const validPassword = (pw) => typeof pw === 'string' && pw.length >= MIN_PASSWORD && pw.length <= 200;

  async function countActiveAdmins(exceptId) {
    return (await listUsers()).filter((u) => u.role === 'admin' && !u.disabled && u.id !== exceptId).length;
  }

  app.get('/api/auth/me', async (req, res) => {
    const count = await userCount();
    res.json({
      user: publicUser(req.user),
      needsSetup: count === 0,
      setupNeedsSecret: count === 0 && !!ADMIN_SECRET,
      open: !ADMIN_SECRET && count === 0,
    });
  });

  // สร้าง Admin คนแรก — ใช้ได้เฉพาะตอนยังไม่มีผู้ใช้
  app.post('/api/auth/setup', async (req, res) => {
    try {
      if ((await userCount()) > 0) return res.status(409).json({ error: 'มีผู้ใช้อยู่แล้ว' });
      const b = req.body || {};
      if (ADMIN_SECRET && b.admin_secret !== ADMIN_SECRET) return res.status(401).json({ error: 'รหัสผู้ดูแล (ADMIN_SECRET) ไม่ถูกต้อง' });
      if (!USERNAME_RE.test(b.username || '')) return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ยาว 3-40 ตัว' });
      if (!validPassword(b.password)) return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว` });
      const u = await insertUser({
        username: b.username, display_name: String(b.display_name || b.username).trim().slice(0, 200),
        employee_id: b.employee_id ? String(b.employee_id).trim().slice(0, 50) : null,
        role: 'admin', password_hash: await hashPassword(b.password),
      });
      await addLog({ action: 'updated', employee_id: u.employee_id || u.username, employee_name: u.display_name, details: `สร้างบัญชี Admin คนแรก: ${u.username}` });
      res.status(201).json({ token: await issueToken(u), user: publicUser(u) });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const k = failKey(req, username);
      if (locked(k)) return res.status(429).json({ error: 'ใส่รหัสผิดหลายครั้ง — รอ 5 นาทีแล้วลองใหม่' });
      const u = await getUserByName(username);
      const ok = u && !u.disabled && (await verifyPassword(String(password || ''), u.password_hash));
      if (!ok) {
        const f = fails.get(k) || { count: 0, at: 0 };
        fails.set(k, { count: f.count + 1, at: Date.now() });
        return res.status(401).json({ error: u && u.disabled ? 'บัญชีนี้ถูกปิดใช้งาน' : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      }
      fails.delete(k);
      const fresh = await patchUser(u.id, { last_login: USE_DB ? new Date() : new Date().toISOString() });
      res.json({ token: await issueToken(fresh), user: publicUser(fresh) });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // เปลี่ยนรหัสผ่านตัวเอง — token เก่าทุกเครื่องใช้ไม่ได้ ได้ token ใหม่กลับไป
  app.post('/api/auth/password', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
      const { old_password, new_password } = req.body || {};
      if (!(await verifyPassword(String(old_password || ''), req.user.password_hash))) return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
      if (!validPassword(new_password)) return res.status(400).json({ error: `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว` });
      const u = await patchUser(req.user.id, { password_hash: await hashPassword(new_password), token_version: (req.user.token_version || 0) + 1 });
      res.json({ token: await issueToken(u), user: publicUser(u) });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ---------- จัดการผู้ใช้ (Admin) ----------
  app.get('/api/users', requireAdminRole, async (req, res) => {
    res.json((await listUsers()).map(publicUser));
  });

  app.post('/api/users', requireAdminRole, async (req, res) => {
    try {
      const b = req.body || {};
      if (!USERNAME_RE.test(b.username || '')) return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ยาว 3-40 ตัว' });
      if (await getUserByName(b.username)) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
      if (!validPassword(b.password)) return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว` });
      const u = await insertUser({
        username: b.username, display_name: String(b.display_name || b.username).trim().slice(0, 200),
        employee_id: b.employee_id ? String(b.employee_id).trim().slice(0, 50) : null,
        role: ROLES.includes(b.role) ? b.role : 'editor', password_hash: await hashPassword(b.password),
      });
      await addLog({ ...by(req), action: 'updated', details: `เพิ่มผู้ใช้ ${u.username} (${u.role})` });
      res.status(201).json(publicUser(u));
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.put('/api/users/:id', requireAdminRole, async (req, res) => {
    try {
      const u = await getUser(req.params.id);
      if (!u) return res.status(404).json({ error: 'Not found' });
      const b = req.body || {};
      const patch = {};
      if (b.display_name !== undefined) patch.display_name = String(b.display_name).trim().slice(0, 200) || u.username;
      if (b.employee_id !== undefined) patch.employee_id = b.employee_id ? String(b.employee_id).trim().slice(0, 50) : null;
      if (b.role !== undefined && ROLES.includes(b.role)) patch.role = b.role;
      if (b.disabled !== undefined) patch.disabled = b.disabled ? 1 : 0;
      // กัน Admin คนสุดท้ายหายไป (ลดสิทธิ์ / ปิดบัญชี)
      const losesAdmin = u.role === 'admin' && !u.disabled && ((patch.role && patch.role !== 'admin') || patch.disabled);
      if (losesAdmin && (await countActiveAdmins(u.id)) === 0) return res.status(400).json({ error: 'ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน' });
      if (b.password !== undefined) {
        if (!validPassword(b.password)) return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว` });
        patch.password_hash = await hashPassword(b.password);
      }
      // เปลี่ยนรหัส / สิทธิ์ / ปิดบัญชี → บังคับ login ใหม่
      if (patch.password_hash || patch.role || patch.disabled) patch.token_version = (u.token_version || 0) + 1;
      const saved = await patchUser(u.id, patch);
      const what = [patch.password_hash && 'ตั้งรหัสผ่านใหม่', patch.role && `สิทธิ์ ${patch.role}`, b.disabled !== undefined && (patch.disabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน')].filter(Boolean).join(', ');
      await addLog({ ...by(req), action: 'updated', details: `แก้ผู้ใช้ ${u.username}${what ? `: ${what}` : ''}` });
      res.json(publicUser(saved));
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.delete('/api/users/:id', requireAdminRole, async (req, res) => {
    try {
      const u = await getUser(req.params.id);
      if (!u) return res.status(404).json({ error: 'Not found' });
      if (req.user && req.user.id === u.id) return res.status(400).json({ error: 'ลบบัญชีตัวเองไม่ได้' });
      if (u.role === 'admin' && (await countActiveAdmins(u.id)) === 0) return res.status(400).json({ error: 'ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน' });
      await removeUser(u.id);
      await addLog({ ...by(req), action: 'deleted', details: `ลบผู้ใช้ ${u.username}` });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  return { initDB, identify, requireEditor, requireAdminRole, userCount };
};
