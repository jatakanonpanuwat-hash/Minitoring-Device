// สถานะเครือข่ายของเครื่อง server (อินเทอร์เน็ต / WiFi / IP) + IP ของผู้เปิดเว็บ — แสดงที่แถบล่างของหน้าเว็บ
const os = require('os');
const { execFile } = require('child_process');
const { IS_WIN, tcpCheck } = require('./checks');

// IPv4 ของการ์ดเครือข่ายที่ใช้งานอยู่ (ไม่รวม loopback / ไม่รวม IP 169.254.x ที่ได้ตอนไม่มี DHCP)
function serverIPv4s() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ iface: name, address: a.address });
    }
  }
  return out;
}

// WiFi: Windows ใช้ netsh (ไม่ต้องสิทธิ์ admin) — เครื่องที่ไม่มีการ์ด WiFi / ต่อสายแลน / ไม่ใช่ Windows จะได้ null
function wifiInfo() {
  return new Promise((resolve) => {
    if (!IS_WIN) return resolve(null);
    execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      const out = String(stdout || '');
      if (err || !out.trim()) return resolve(null);
      const field = (re) => (out.match(re) || [])[1]?.trim() || null;
      const ssid = field(/^\s*SSID\s*:\s*(.+)$/im);
      const signal = field(/:\s*(\d{1,3})\s*%/);
      // label "State" อาจเป็นภาษาอื่นตามภาษาของ Windows — ถ้ามี SSID ถือว่าเชื่อมต่ออยู่
      const state = field(/^\s*State\s*:\s*(.+)$/im);
      const connected = state ? /^connected$/i.test(state) : !!ssid;
      resolve({ connected, ssid, signal: signal ? Number(signal) : null });
    });
  });
}

// อินเทอร์เน็ต: เปิด TCP ไป DNS สาธารณะ (ไม่พึ่ง ICMP ที่บางเครือข่ายบล็อก) — ตัวใดตัวหนึ่งตอบ = ออนไลน์
async function internetCheck() {
  const results = await Promise.all([tcpCheck('1.1.1.1', 53, 2500), tcpCheck('8.8.8.8', 53, 2500)]);
  const ok = results.filter((r) => r.alive);
  return { online: ok.length > 0, latencyMs: ok.length ? Math.min(...ok.map((r) => r.latency)) : null };
}

// แคชไว้สั้น ๆ — หลายคนเปิดเว็บพร้อมกันจะได้ไม่เรียก netsh / ต่อ TCP ซ้ำทุก request
const NETWORK_CACHE_MS = 10000;
let networkCache = { at: 0, data: null, pending: null };
async function serverNetwork() {
  if (networkCache.data && Date.now() - networkCache.at < NETWORK_CACHE_MS) return networkCache.data;
  if (!networkCache.pending) {
    networkCache.pending = Promise.all([wifiInfo(), internetCheck()])
      .then(([wifi, internet]) => {
        networkCache = { at: Date.now(), data: { hostname: os.hostname(), ips: serverIPv4s(), wifi, internet }, pending: null };
        return networkCache.data;
      })
      .catch((e) => {
        networkCache.pending = null;
        throw e;
      });
  }
  return networkCache.pending;
}

function normalizeIp(ip) {
  ip = String(ip || '').trim();
  if (ip === '::1') return '127.0.0.1';
  return ip.replace(/^::ffff:/, '');
}

// เชื่อ X-Forwarded-For เฉพาะเมื่อคำขอมาจาก proxy บนเครื่องเดียวกัน (vite dev / reverse proxy local)
// — คนภายนอกส่ง header นี้มาเองจะไม่มีผล
function clientIp(req) {
  const peer = normalizeIp(req.socket?.remoteAddress);
  const xff = req.headers['x-forwarded-for'];
  if (peer.startsWith('127.') && xff) {
    const first = normalizeIp(String(xff).split(',')[0]);
    if (first) return first;
  }
  return peer;
}

// คำตอบของ GET /api/network
async function networkInfo(req) {
  const server = await serverNetwork();
  return { server, client: { ip: clientIp(req) }, checkedAt: new Date(networkCache.at || Date.now()).toISOString() };
}

module.exports = { networkInfo };
