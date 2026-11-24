// สร้างข้อมูลตัวอย่าง (mock) ผ่าน API — ใช้ได้ทั้งโหมด in-memory และ MariaDB
//
//   npm run seed                      สร้างแผนผัง 2 ชั้น + อุปกรณ์ตัวอย่าง
//   npm run seed -- --clear           ลบเฉพาะข้อมูล mock ที่สคริปต์นี้สร้าง
//   npm run seed -- --url http://localhost:5000 --secret admin
//
// ต้องรัน backend ไว้ก่อน (npm run dev)
// ข้อมูล mock มี remark ขึ้นต้นด้วย [MOCK] และ map_id ขึ้นต้นด้วย mock- เพื่อให้ลบทีหลังได้
//
// IP ที่ใช้ตั้งใจให้ได้สถานะต่างกันจริงเมื่อ backend ping:
//   127.0.0.x  → ตอบเสมอ (online)
//   192.0.2.x  → TEST-NET ไม่มีเครื่องจริง (offline หลังหลุดครบเกณฑ์)
//   ไม่มี IP   → unknown,  status: 'maintenance' → หยุด ping

require('dotenv').config();
const zlib = require('zlib');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const BASE = `${opt('url', `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '')}/api`;
const SECRET = opt('secret', process.env.ADMIN_SECRET || 'admin');
const CLEAR = args.includes('--clear');
const MOCK = '[MOCK]';

async function api(method, path, body) {
  const headers = { 'x-admin-secret': SECRET };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || ''}`);
  return data;
}

// ---------- วาดรูปแผนผังเป็น PNG (ไม่ต้องลง package) ----------
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function drawFloorPlan(W, H, rooms) {
  const px = Buffer.alloc(W * H * 3, 255);
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const i = (y * W + x) * 3;
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
    }
  };
  const wall = [71, 85, 105];
  const T = 6;
  fill(0, 0, W, H, [248, 250, 252]);
  for (const r of rooms) {
    const [x0, y0, x1, y1] = [r.x, r.y, r.x + r.w, r.y + r.h].map((v, i) => Math.round(v * (i % 2 ? H : W)));
    fill(x0, y0, x1, y1, r.color);
    fill(x0, y0, x1, y0 + T, wall);
    fill(x0, y1 - T, x1, y1, wall);
    fill(x0, y0, x0 + T, y1, wall);
    fill(x1 - T, y0, x1, y1, wall);
    // ช่องประตูกลางผนังล่าง
    const mid = Math.round((x0 + x1) / 2);
    fill(mid - 22, y1 - T, mid + 22, y1, r.color);
  }
  fill(0, 0, W, T, wall); fill(0, H - T, W, H, wall); fill(0, 0, T, H, wall); fill(W - T, 0, W, H, wall);

  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ข้อมูลตัวอย่าง ----------
const BLUE = [219, 234, 254], GREEN = [220, 252, 231], AMBER = [254, 243, 199], SLATE = [241, 245, 249], ROSE = [255, 228, 230];

const MAPS = [
  {
    map_id: 'mock-floor-1',
    map_name: 'อาคาร A ชั้น 1 (ตัวอย่าง)',
    floor: '1',
    rooms: [
      { x: 0.03, y: 0.05, w: 0.22, h: 0.40, color: ROSE },   // Server room
      { x: 0.27, y: 0.05, w: 0.45, h: 0.40, color: GREEN },  // Office
      { x: 0.74, y: 0.05, w: 0.23, h: 0.40, color: AMBER },  // Meeting
      { x: 0.03, y: 0.52, w: 0.60, h: 0.43, color: BLUE },   // Production
      { x: 0.65, y: 0.52, w: 0.32, h: 0.43, color: SLATE },  // Warehouse
    ],
  },
  {
    map_id: 'mock-floor-2',
    map_name: 'อาคาร A ชั้น 2 (ตัวอย่าง)',
    floor: '2',
    rooms: [
      { x: 0.03, y: 0.05, w: 0.46, h: 0.90, color: GREEN },  // Office 2
      { x: 0.51, y: 0.05, w: 0.46, h: 0.42, color: AMBER },  // Training
      { x: 0.51, y: 0.53, w: 0.46, h: 0.42, color: SLATE },  // Store
    ],
  },
];

let up = 1, down = 1;
const ON = () => `127.0.0.${up++}`;
const OFF = () => `192.0.2.${down++}`;

const DEVICES = [
  // ชั้น 1 — ห้อง Server
  { name: 'CORE-SW-01', device_type: 'switch', ip_address: ON(), brand: 'Cisco', model: 'C9300-48P', zone: 'Server Room', floor: '1', cabinet: 'RACK-A1', map: 0, x: 8, y: 15 },
  { name: 'FW-01', device_type: 'router', ip_address: ON(), brand: 'Fortinet', model: 'FortiGate 100F', zone: 'Server Room', floor: '1', cabinet: 'RACK-A1', map: 0, x: 18, y: 15 },
  { name: 'SRV-FILE-01', device_type: 'server', ip_address: ON(), brand: 'Dell', model: 'PowerEdge R650', zone: 'Server Room', floor: '1', cabinet: 'RACK-A2', map: 0, x: 8, y: 32 },
  { name: 'SRV-ERP-01', device_type: 'server', ip_address: OFF(), brand: 'HPE', model: 'ProLiant DL380', zone: 'Server Room', floor: '1', cabinet: 'RACK-A2', map: 0, x: 18, y: 32 },
  { name: 'NVR-01', device_type: 'nvr', ip_address: ON(), brand: 'Hikvision', model: 'DS-9632NI-I8', zone: 'Server Room', floor: '1', cabinet: 'RACK-A3', map: 0, x: 13, y: 40 },
  { name: 'UPS-01', device_type: 'ups', ip_address: ON(), brand: 'APC', model: 'Smart-UPS 3000', zone: 'Server Room', floor: '1', cabinet: 'RACK-A3', map: 0, x: 22, y: 40 },
  // ชั้น 1 — Office
  { name: 'AP-OFFICE-01', device_type: 'ap', ip_address: ON(), brand: 'Ubiquiti', model: 'U6-Pro', zone: 'Office', floor: '1', map: 0, x: 38, y: 15 },
  { name: 'AP-OFFICE-02', device_type: 'ap', ip_address: OFF(), brand: 'Ubiquiti', model: 'U6-Pro', zone: 'Office', floor: '1', map: 0, x: 60, y: 15 },
  { name: 'PC-ACC-01', device_type: 'pc', ip_address: ON(), brand: 'Lenovo', model: 'ThinkCentre M70q', zone: 'Office', floor: '1', map: 0, x: 34, y: 32 },
  { name: 'PC-ACC-02', device_type: 'pc', ip_address: ON(), brand: 'Lenovo', model: 'ThinkCentre M70q', zone: 'Office', floor: '1', map: 0, x: 44, y: 32 },
  { name: 'PRN-OFFICE-01', device_type: 'printer', ip_address: ON(), brand: 'Brother', model: 'MFC-L8900CDW', zone: 'Office', floor: '1', map: 0, x: 66, y: 34 },
  // ชั้น 1 — Meeting
  { name: 'PC-MEETING', device_type: 'pc', ip_address: null, brand: 'Intel', model: 'NUC 13', zone: 'Meeting', floor: '1', map: 0, x: 85, y: 25, remark: 'ยังไม่ได้ตั้ง IP' },
  // ชั้น 1 — Production
  { name: 'SW-PROD-01', device_type: 'switch', ip_address: ON(), brand: 'TP-Link', model: 'TL-SG3428', zone: 'Production', floor: '1', cabinet: 'CTRL-01', map: 0, x: 8, y: 62 },
  { name: 'CAM-PROD-01', device_type: 'camera', ip_address: ON(), brand: 'Hikvision', model: 'DS-2CD2143G2', zone: 'Production', floor: '1', map: 0, x: 15, y: 75, direction: 90, fov_angle: 80 },
  { name: 'CAM-PROD-02', device_type: 'camera', ip_address: ON(), brand: 'Hikvision', model: 'DS-2CD2143G2', zone: 'Production', floor: '1', map: 0, x: 40, y: 75, direction: 270, fov_angle: 80 },
  { name: 'CAM-PROD-03', device_type: 'camera', ip_address: OFF(), brand: 'Dahua', model: 'IPC-HFW2431S', zone: 'Production', floor: '1', map: 0, x: 58, y: 88, direction: 0, fov_angle: 90 },
  { name: 'AP-PROD-01', device_type: 'ap', ip_address: ON(), brand: 'Aruba', model: 'AP-515', zone: 'Production', floor: '1', map: 0, x: 30, y: 62, status: 'maintenance', remark: 'รอเปลี่ยนเสา' },
  // ชั้น 1 — Warehouse
  { name: 'CAM-WH-01', device_type: 'camera', ip_address: ON(), brand: 'Hikvision', model: 'DS-2CD2T47G2', zone: 'Warehouse', floor: '1', map: 0, x: 70, y: 60, direction: 135, fov_angle: 100 },
  { name: 'CAM-WH-02', device_type: 'camera', ip_address: ON(), brand: 'Hikvision', model: 'DS-2CD2T47G2', zone: 'Warehouse', floor: '1', map: 0, x: 92, y: 88, direction: 315, fov_angle: 100 },
  { name: 'PRN-WH-LABEL', device_type: 'printer', ip_address: OFF(), brand: 'Zebra', model: 'ZT411', zone: 'Warehouse', floor: '1', map: 0, x: 82, y: 72 },
  // ชั้น 2
  { name: 'SW-FL2-01', device_type: 'switch', ip_address: ON(), brand: 'Cisco', model: 'CBS350-24P', zone: 'Office 2', floor: '2', cabinet: 'RACK-B1', map: 1, x: 6, y: 12 },
  { name: 'AP-FL2-01', device_type: 'ap', ip_address: ON(), brand: 'Ubiquiti', model: 'U6-Lite', zone: 'Office 2', floor: '2', map: 1, x: 25, y: 30 },
  { name: 'PC-HR-01', device_type: 'pc', ip_address: ON(), brand: 'HP', model: 'ProDesk 400', zone: 'Office 2', floor: '2', map: 1, x: 15, y: 60 },
  { name: 'PC-HR-02', device_type: 'pc', ip_address: OFF(), brand: 'HP', model: 'ProDesk 400', zone: 'Office 2', floor: '2', map: 1, x: 35, y: 60 },
  { name: 'PRN-FL2-01', device_type: 'printer', ip_address: ON(), brand: 'Canon', model: 'iR-ADV C3826', zone: 'Office 2', floor: '2', map: 1, x: 40, y: 85 },
  { name: 'PC-TRAIN-01', device_type: 'pc', ip_address: ON(), brand: 'Dell', model: 'OptiPlex 7010', zone: 'Training', floor: '2', map: 1, x: 65, y: 25 },
  { name: 'CAM-FL2-STORE', device_type: 'camera', ip_address: ON(), brand: 'Dahua', model: 'IPC-HDW2431T', zone: 'Store', floor: '2', map: 1, x: 75, y: 75, direction: 180, fov_angle: 90 },
  { name: 'UPS-FL2-01', device_type: 'ups', ip_address: null, brand: 'APC', model: 'Back-UPS 1500', zone: 'Office 2', floor: '2', cabinet: 'RACK-B1', map: 1, x: 6, y: 25, status: 'maintenance', remark: 'แบตเตอรี่หมดอายุ' },
];

// ---------- run ----------
async function clearMock() {
  const devices = await api('GET', '/devices');
  const mine = devices.filter((d) => (d.remark || '').startsWith(MOCK));
  for (const d of mine) await api('DELETE', `/devices/${d.id}`);
  const maps = await api('GET', '/maps');
  const mockMaps = maps.filter((m) => m.map_id.startsWith('mock-'));
  for (const m of mockMaps) await api('DELETE', `/maps/${m.map_id}`);
  console.log(`ลบอุปกรณ์ mock ${mine.length} ตัว, แผนผัง mock ${mockMaps.length} แผ่น`);
}

async function seed() {
  const existing = await api('GET', '/devices');
  if (existing.some((d) => (d.remark || '').startsWith(MOCK))) {
    console.log('มีข้อมูล mock อยู่แล้ว — ลบของเก่าก่อน');
    await clearMock();
  }

  for (const m of MAPS) {
    const form = new FormData();
    form.append('image', new Blob([drawFloorPlan(1200, 700, m.rooms)], { type: 'image/png' }), `${m.map_id}.png`);
    form.append('map_id', m.map_id);
    form.append('map_name', m.map_name);
    form.append('floor', m.floor);
    await api('POST', '/maps', form);
  }
  console.log(`สร้างแผนผัง ${MAPS.length} แผ่น`);

  for (const d of DEVICES) {
    const { map, x, y, remark, ...rest } = d;
    await api('POST', '/devices', {
      ...rest,
      map_id: MAPS[map].map_id,
      x_percent: x,
      y_percent: y,
      remark: remark ? `${MOCK} ${remark}` : MOCK,
      employee_name: 'seed-mock',
    });
  }
  console.log(`สร้างอุปกรณ์ ${DEVICES.length} ตัว — backend กำลัง ping ให้ (offline จะขึ้นหลังหลุดครบเกณฑ์ หรือกด "Ping ทั้งหมดตอนนี้" ในแท็บ Settings)`);
}

(async () => {
  try {
    await api('GET', '/admin/check');
  } catch (err) {
    console.error(`เชื่อม backend ไม่ได้หรือรหัสผู้ดูแลผิด (${BASE}) — ${err.message}`);
    console.error('รัน backend ก่อน (npm run dev) และส่ง --secret ถ้าตั้ง ADMIN_SECRET ไว้');
    process.exit(1);
  }
  if (CLEAR) await clearMock();
  else await seed();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
