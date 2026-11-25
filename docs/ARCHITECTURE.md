# โครงสร้างโค้ด & วิธีทำงานต่อ

เอกสารนี้สำหรับคนในทีมที่จะแก้ / เพิ่มฟีเจอร์ — อ่านจบแล้วควรรู้ว่าโค้ดแต่ละส่วนอยู่ที่ไหนและต้องแก้กี่ไฟล์
(วิธีติดตั้ง / รัน / นำเข้าข้อมูล ดูที่ [README.md](../README.md))

## ภาพรวม

```
เบราว์เซอร์ (React)  ──HTTP /api/...──▶  backend (Express)  ──▶  MariaDB  หรือ  data/store.json
                                            │
                                            └─ ทุก 60 วิ: ping / TCP / SNMP อุปกรณ์ทุกตัว ─▶ Telegram (เมื่อสถานะเปลี่ยน)
```

- **frontend** ไม่มี state ฝั่ง server — ดึงข้อมูลจาก API ทุก 15 วินาที (`POLL_MS` ใน `MonitorApp.tsx`)
- **backend** เป็นตัวเดียวที่คุยกับฐานข้อมูลและอุปกรณ์ในเครือข่าย ต้องรันบนเครื่องที่อยู่วง LAN เดียวกับอุปกรณ์
- production: `npm run build` ใน frontend เขียนไฟล์ไปที่ `backend/build/` แล้ว backend เสิร์ฟทั้งเว็บและ API ที่ port 5000

## Backend (`backend/`)

```
backend/
├── index.js              จุดเริ่ม (แค่ require src/server.js)
├── src/
│   ├── server.js         เริ่มระบบ: เตรียมที่เก็บข้อมูล → เปิด port → เริ่ม monitor + ซิงก์ Excel
│   ├── app.js            ประกอบ Express: middleware → ไฟล์ static → auth → routes
│   ├── config.js         ค่าตั้งจาก .env ทั้งหมด (ที่เดียวที่อ่าน process.env)
│   ├── auth.js           login, บัญชีผู้ใช้, สิทธิ์ Admin / Editor, route /api/auth/* และ /api/users
│   ├── db/
│   │   ├── memory.js     โหมดไม่มี DB: ข้อมูลใน RAM + บันทึกลง data/store.json ทุก 3 วิ
│   │   ├── mariadb.js    connection pool + query()
│   │   └── schema.js     สร้างตาราง / เติมคอลัมน์ / ย้ายข้อมูล CCTV เดิม (รันทุกครั้งที่เริ่ม)
│   ├── models/           อ่าน-เขียนข้อมูลแต่ละชนิด (ทำงานได้ทั้ง 2 โหมด)
│   │   ├── devices.js    อุปกรณ์
│   │   ├── maps.js       แผนผัง
│   │   ├── logs.js       ประวัติการทำงาน + สถิติ Dashboard
│   │   ├── history.js    ผลตรวจรายชั่วโมง (กราฟ uptime)
│   │   ├── snapshots.js  สแนปช็อตรายการอุปกรณ์รายปี
│   │   ├── catalog.js    รายการ ประเภท / สถานะ / โซน
│   │   ├── settings.js   ค่าตั้งระบบ (key/value) + ค่าเริ่มต้น
│   │   └── tutorials.js  รายการคู่มือ (เก็บเป็น JSON ในค่าตั้ง TUTORIALS — ไม่มีตาราง)
│   ├── services/         งานที่ไม่ใช่แค่อ่าน-เขียนข้อมูล
│   │   ├── checks.js     ตรวจอุปกรณ์ 1 ครั้ง: ping / TCP / SNMP
│   │   ├── monitor.js    รอบตรวจอัตโนมัติ + ตัดสินสถานะ online / warning / offline
│   │   ├── telegram.js   แจ้งเตือน Telegram (รวมทั้งรอบเป็นข้อความเดียว)
│   │   ├── xlsx-sync.js  นำเข้ากล้องจาก Excel + เฝ้าไฟล์ซิงก์อัตโนมัติ
│   │   ├── xlsx-template.js  สร้างเทมเพลต Excel กรอกข้อมูลกล้อง (คอลัมน์ต้องตรงกับ toDevice ใน lib/xlsx.js)
│   │   └── network.js    สถานะเน็ต / WiFi / IP ของ server (แถบล่างของเว็บ)
│   ├── routes/           HTTP API — 1 ไฟล์ต่อ 1 กลุ่ม (เขียน path เต็ม /api/... ค้นด้วย Ctrl+Shift+F ได้เลย)
│   │   ├── system.js     /api/health, /api/network, /api/admin/*
│   │   ├── devices.js    /api/devices/**
│   │   ├── import.js     /api/import/xlsx/**
│   │   ├── monitor.js    /api/monitor/**
│   │   ├── catalog.js    /api/catalog/**
│   │   ├── maps.js       /api/maps/**
│   │   ├── logs.js       /api/logs/**, /api/stats/events
│   │   ├── settings.js   /api/settings, /api/telegram/**
│   │   └── tutorials.js  /api/tutorials/** (คู่มือ — ไฟล์อยู่ใน uploads/tutorial-*)
│   └── lib/
│       ├── xlsx.js       ตัวอ่านไฟล์ .xlsx (ไม่ใช้ package)
│       ├── xlsx-writer.js  ตัวเขียนไฟล์ .xlsx (ไม่ใช้ package)
│       └── uploads.js    รับไฟล์อัปโหลด (multer) + บันทึก/ลบใน uploads/
├── scripts/              สคริปต์ที่รันด้วยมือ (เรียก API ของ backend ที่รันอยู่)
│   ├── seed-mock.js          npm run seed
│   ├── import-from-sheet.js  npm run import:sheet
│   └── import-from-xlsx.js   npm run import:xlsx
├── data/                 (ไม่อยู่ใน git) store.json + ไฟล์ Excel ประจำโปรเจกต์
├── uploads/              (ไม่อยู่ใน git) รูปแผนผัง / ไอคอนที่อัปโหลด
└── build/                (ไม่อยู่ใน git) frontend ที่ build แล้ว
```

### ทิศทางการเรียกกัน

```
routes/  ──▶  services/  ──▶  models/  ──▶  db/
   └──────────────────────────▶ models/
```

- **routes** รับ request, ตรวจ input, เรียก models/services, ตอบ JSON — ไม่เขียน SQL เอง
- **models** เป็นที่เดียวที่แตะ `query()` และ `mem` — ทุกฟังก์ชันมี 2 ทาง: `if (!USE_DB) { ...mem... }` กับ SQL
- **services** ไม่ require routes; models ไม่ require services
- ข้อยกเว้นเดียว: `models/catalog.js` ↔ `models/devices.js` เรียกกันไปมา — catalog จึง `require('./devices')` *ในฟังก์ชัน* แทนด้านบนไฟล์ (กัน require วน) ถ้าเพิ่มคู่แบบนี้อีกให้ทำแบบเดียวกัน

### กติกาที่ต้องรู้

1. **ทุกการเปลี่ยนข้อมูลต้องทำทั้ง 2 โหมด** — MariaDB และไฟล์ (`mem`) ทดสอบโหมดไฟล์ได้ง่ายสุด: ไม่ต้องมี `.env`
2. **สิทธิ์**: route ที่แก้ข้อมูลต้องใส่ `requireEditor` (เพิ่ม/แก้/ลบอุปกรณ์) หรือ `requireAdmin` (ตั้งค่า, แผนผัง, นำเข้า, ผู้ใช้) — ได้มาจากพารามิเตอร์ของไฟล์ route
3. **ชื่อผู้แก้** ไม่ต้องรับจาก client: `auth.js` ใส่ `req.body.employee_id / employee_name` จากบัญชีที่ login ให้แล้ว
4. **บันทึก Log** ทุกครั้งที่ข้อมูลเปลี่ยนด้วย `addLog({ action, device_id, details, ... })`
5. **ข้อความ error** ที่ผู้ใช้เห็นเป็นภาษาไทย `res.status(4xx).json({ error: '...' })` — หน้าเว็บแสดงข้อความนี้ตรง ๆ
6. **IP / hostname** ที่จะส่งเข้าคำสั่ง ping ต้องผ่าน `HOST_RE` (services/checks.js) เสมอ
7. Comment เขียนภาษาไทย อธิบาย *ทำไม* ไม่ใช่ *ทำอะไร*

## Frontend (`frontend/src/`)

```
src/
├── main.tsx, app/App.tsx, app/routes.tsx   จุดเริ่ม (มีหน้าเดียว: MonitorApp)
├── app/
│   ├── types/monitor.ts      type ของข้อมูลจาก API (Device, MapItem, LogEntry, ...) + helper เล็ก ๆ
│   ├── utils/monitorClient.ts ฟังก์ชันเรียก API ทั้งหมด (ใส่ token ให้เอง)
│   ├── components/ui/        ปุ่ม / input / กล่องยืนยัน (confirmDialog) ที่ใช้ทั่วไป
│   └── monitor/
│       ├── MonitorApp.tsx    ตัวหลัก: ถือ state ทั้งหมด (อุปกรณ์, แผนผัง, หน้าปัจจุบัน, modal) แล้วส่งลงไป
│       ├── layout/           โครงหน้าจอ: TopBar, Rail (เมนูซ้าย), SlidePanel (รายการข้างแผนผัง), BottomBar
│       ├── map/              แผนผัง: Viewer (ซูม/ลาก/หมุด), PlacePanel (ฟอร์มวางอุปกรณ์), DirectionDial (ทิศกล้อง), ExportMapDialog (ตั้งค่า Export รูป) + exportMapImage (วาดรูปพร้อมหมุด) + exportLayout (จัดหมุด/ป้ายไม่ให้ซ้อน)
│       ├── devices/          ฟอร์มและหน้าต่างอุปกรณ์: DeviceModal, AddDeviceModal, DeviceHistory (กราฟ) + ช่องกรอกที่ใช้ร่วมกัน
│       ├── pages/            หน้าเต็มจอ: Dashboard, ตารางอุปกรณ์, Log, Tutorial (คู่มือ), Settings
│       ├── settings/         ส่วนย่อยของหน้า Settings: จัดการรายการ, Excel, ผู้ใช้, Telegram, Ping ทั้งหมด
│       └── shared/           ใช้หลายที่: auth (login/สิทธิ์), catalog (ไอคอน/สี/ป้ายสถานะ), ColumnChart
└── styles/monitor.css        สไตล์ทั้งแอป (class ขึ้นต้นด้วย .cctv-app)
```

- ข้อมูลไหลทางเดียว: `MonitorApp` โหลดผ่าน `monitorClient.ts` → ส่ง props ลงไป → ลูกเรียก callback ขึ้นมาเมื่อต้องการแก้
- ข้อมูลที่ทุกที่ใช้ส่งผ่าน context แทน props: `useCatalog()` (shared/catalog.tsx), `useAuth()` (shared/auth.tsx)
- ซ่อนปุ่มตามสิทธิ์ด้วย `useAuth()` → `canEdit` / `isAdmin` (backend ตรวจสิทธิ์ซ้ำเสมอ ซ่อนปุ่มอย่างเดียวไม่พอ)

## สูตรงานที่เจอบ่อย

### เพิ่ม API ใหม่
1. เพิ่ม route ในไฟล์ที่ตรงกลุ่มใน `backend/src/routes/` (กลุ่มใหม่: สร้างไฟล์ใหม่แบบเดียวกัน แล้วเพิ่มใน `ROUTES` ของ `src/app.js`)
2. งานอ่าน-เขียนข้อมูลใส่ใน `src/models/` (ทั้ง 2 โหมด)
3. เพิ่มฟังก์ชันเรียกใน `frontend/src/app/utils/monitorClient.ts` + type ใน `types/monitor.ts`
4. เพิ่มแถวในตาราง API ของ README

### เพิ่มฟิลด์ให้อุปกรณ์ (เช่น "วันหมดประกัน")
1. `backend/src/db/schema.js` → `DEVICE_COLUMNS` (MariaDB เติมคอลัมน์ให้เองตอน restart)
2. `backend/src/models/devices.js` → `DEVICE_FIELDS` (ไม่ใส่ = API ทิ้งค่านี้)
3. ถ้าเป็นตัวเลข/boolean: แปลงใน `normalizeDevice()`
4. `frontend/src/app/types/monitor.ts` → `interface Device`
5. ช่องกรอกใน `devices/DeviceModal.tsx` (+ `AddDeviceModal.tsx`, `map/PlacePanel.tsx` ถ้าต้องกรอกตอนเพิ่ม) และคอลัมน์ใน `pages/DeviceTablePage.tsx`

### เพิ่มค่าตั้งระบบ
1. ค่าเริ่มต้นใน `SETTING_DEFAULTS` (`backend/src/models/settings.js`)
2. ถ้าหน้าเว็บต้องอ่าน/แก้: เพิ่มใน `PUBLIC_SETTINGS` (`backend/src/routes/settings.js`) — **ห้ามใส่ค่าลับ**
3. `AppSettings` ใน `frontend/src/app/types/monitor.ts` + ช่องกรอกใน `pages/SettingsPage.tsx`

### เพิ่มวิธีตรวจอุปกรณ์ (เช่น HTTP)
1. เขียนฟังก์ชันตรวจใน `backend/src/services/checks.js` คืน `{ alive, latency }` แล้วเพิ่มใน `CHECK_METHODS`, `runCheck`, `checkMethodLabel`
2. รายการที่ยอมรับใน `pickDeviceFields()` (`models/devices.js`)
3. ตัวเลือกใน `frontend/src/app/monitor/devices/CheckMethodFields.tsx`

### เพิ่มหน้าใหม่ในเมนูซ้าย
1. สร้างไฟล์ใน `frontend/src/app/monitor/pages/`
2. เพิ่มชื่อหน้าใน `PageKind` + ปุ่มใน `layout/Rail.tsx`
3. เพิ่มเงื่อนไขแสดงหน้าใน `MonitorApp.tsx` (ค้นคำว่า `page === 'logs'`)

## ทดสอบก่อนส่งงาน

ยังไม่มี automated test — ก่อน push อย่างน้อยให้:

```
cd frontend && npx tsc --noEmit -p .     # ต้องไม่มี error
cd backend  && npm run dev               # เปิดได้ ไม่มี error ใน console
```

แล้วลองใช้ฟีเจอร์ที่แก้ในหน้าเว็บจริง ทั้งตอนยังไม่ login และ login เป็น Editor / Admin
ทดสอบด้วยข้อมูลตัวอย่าง: รัน backend แบบไม่มี `.env` แล้ว `npm run seed` (ข้อมูลอยู่ใน `data/store.json` ลบทิ้งได้)
