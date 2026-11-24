// วิธีตรวจอุปกรณ์ 1 ครั้ง: ping / TCP port / SNMP — ทุกตัวคืน { alive, latency (ms | null) }
// เพิ่มวิธีตรวจใหม่: เขียนฟังก์ชันที่นี่ แล้วเพิ่มใน CHECK_METHODS, runCheck, checkMethodLabel
//   + ตัวเลือกใน frontend/src/app/monitor/devices/CheckMethodFields.tsx
const os = require('os');
const net = require('net');
const snmp = require('net-snmp');
const { execFile } = require('child_process');

const IS_WIN = os.platform() === 'win32';
// IP / hostname ที่ยอมให้ส่งเข้าคำสั่ง ping — กันการแทรกคำสั่ง
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.\-:]{0,99}$/;
const CHECK_METHODS = ['ping', 'tcp', 'snmp'];

// ใช้คำสั่ง ping ของระบบ (ไม่ต้องลง package / ไม่ต้องสิทธิ์ admin) ผ่าน execFile — ไม่ผ่าน shell
function pingHost(host, timeoutMs) {
  return new Promise((resolve) => {
    if (!HOST_RE.test(host)) return resolve({ alive: false, latency: null, error: 'invalid host' });
    const args = IS_WIN
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
    const started = Date.now();
    execFile('ping', args, { timeout: timeoutMs + 3000, windowsHide: true }, (err, stdout) => {
      const out = String(stdout || '');
      // Windows ตอบ exit 0 ได้แม้ "Destination host unreachable" — ต้องมี TTL= ถึงนับว่าได้ reply จริง
      const alive = /ttl[=:]/i.test(out) && (!err || IS_WIN);
      if (!alive) return resolve({ alive: false, latency: null });
      const m = out.match(/[=<]\s*([\d.]+)\s*ms/i);
      resolve({ alive: true, latency: m ? Number(m[1]) : Date.now() - started });
    });
  });
}

// ตรวจด้วยการเปิด TCP ไปยังพอร์ตปลายทาง — สำหรับอุปกรณ์ที่ปิด ICMP (ping ไม่ตอบทั้งที่ใช้งานได้)
function tcpCheck(host, port, timeoutMs) {
  return new Promise((resolve) => {
    if (!HOST_RE.test(host)) return resolve({ alive: false, latency: null, error: 'invalid host' });
    const started = Date.now();
    const sock = new net.Socket();
    let settled = false;
    const done = (alive) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve({ alive, latency: alive ? Date.now() - started : null });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    try {
      sock.connect(port, host);
    } catch {
      done(false);
    }
  });
}

// ตรวจด้วย SNMP v2c (ถาม sysUpTime.0) — สำหรับสวิตช์/อุปกรณ์เครือข่ายที่เปิด SNMP ไว้
const SNMP_SYS_UPTIME_OID = '1.3.6.1.2.1.1.3.0';
const SNMP_DEFAULT_PORT = 161;
const SNMP_DEFAULT_COMMUNITY = 'public';

function snmpCheck(host, port, community, timeoutMs) {
  return new Promise((resolve) => {
    if (!HOST_RE.test(host)) return resolve({ alive: false, latency: null, error: 'invalid host' });
    const started = Date.now();
    let session;
    let settled = false;
    const done = (alive) => {
      if (settled) return;
      settled = true;
      try { session.close(); } catch { /* ignore */ }
      resolve({ alive, latency: alive ? Date.now() - started : null });
    };
    try {
      session = snmp.createSession(host, community || SNMP_DEFAULT_COMMUNITY, {
        port: port || SNMP_DEFAULT_PORT,
        version: snmp.Version2c,
        timeout: timeoutMs,
        retries: 0,
      });
    } catch {
      return resolve({ alive: false, latency: null });
    }
    // ตอบกลับเพี้ยน/ถอดรหัสไม่ได้ — net-snmp ส่ง 'error' แทน callback (ไม่ดัก = backend ล้มทั้ง process)
    session.on('error', () => done(false));
    session.get([SNMP_SYS_UPTIME_OID], (err, varbinds) => {
      if (err) return done(false);
      done(Array.isArray(varbinds) && varbinds.length > 0 && !snmp.isVarbindError(varbinds[0]));
    });
  });
}

// วิธีตรวจของเครื่องนี้ — TCP แต่ไม่ใส่พอร์ต = ถอยไป ping (กันตั้งค่าค้างแล้วหยุดตรวจ)
function checkMethodOf(device) {
  const m = device.check_method || 'ping';
  if (m === 'tcp' && !(device.check_port >= 1 && device.check_port <= 65535)) return 'ping';
  return CHECK_METHODS.includes(m) ? m : 'ping';
}

// ชื่อวิธีตรวจที่ใส่ใน log / ข้อความแจ้งเตือน
function checkMethodLabel(method, device) {
  if (method === 'tcp') return `TCP :${device.check_port}`;
  if (method === 'snmp') return 'SNMP';
  return 'ping';
}

async function runCheck(device, method, timeoutMs) {
  if (method === 'tcp') return tcpCheck(device.ip_address, device.check_port, timeoutMs);
  if (method === 'snmp') return snmpCheck(device.ip_address, device.check_port, device.snmp_community, timeoutMs);
  return pingHost(device.ip_address, timeoutMs);
}

module.exports = { IS_WIN, HOST_RE, CHECK_METHODS, pingHost, tcpCheck, snmpCheck, checkMethodOf, checkMethodLabel, runCheck };
