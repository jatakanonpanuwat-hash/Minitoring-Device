# Monitoring Device

โครงสร้างโปรเจกต์อ้างอิงจาก F5-I-DOJO: แยก `frontend` (React + Vite + Tailwind) กับ `backend` (Node/Express + MariaDB) และมี `gas/Code.gs` สำหรับเชื่อมต่อ Google Apps Script แยกส่วนกัน

## โครงสร้าง

```
monitoring-device/
├── backend/            Node.js + Express API
│   ├── index.js        API + เสิร์ฟ frontend build (production)
│   ├── package.json
│   ├── .env.example
│   └── uploads/        ไฟล์อัปโหลด (.gitkeep)
├── frontend/           React + Vite + TypeScript + Tailwind
│   └── src/
│       ├── main.tsx
│       ├── vite-env.d.ts
│       ├── styles/         index.css, tailwind.css, theme.css, monitor.css
│       └── app/
│           ├── App.tsx
│           ├── routes.tsx
│           ├── components/ui/  UI primitives (button, card, input, utils)
│           ├── monitor/        MonitorApp + TopBar, Rail, SlidePanel, Viewer, modals
│           ├── types/          monitor.ts (Device, ประเภทอุปกรณ์, Log, Settings)
│           └── utils/          monitorClient.ts
└── gas/Code.gs         Google Apps Script template (log ลง Sheet)
```

Base path ของเว็บคือ `/monitoring-device/` (ดู `frontend/vite.config.ts` และ `routes.tsx` ถ้าจะเปลี่ยนต้องเปลี่ยนทั้ง 2 ที่ + backend fallback)

## เริ่มใช้งาน

### Backend
```
cd backend
copy .env.example .env   # ตั้งค่า DB ของตัวเอง
npm install
npm run dev              # http://localhost:5000
```

### Frontend
```
cd frontend
npm install
npm run dev              # http://localhost:5173/monitoring-device/
```

หรือดับเบิลคลิก `run-dev.bat` ที่ root เพื่อรัน frontend อย่างเดียว

### รันแบบไม่ใช้ .env

backend รันได้เลยโดยไม่ต้องสร้าง `.env` — ถ้าไม่มีค่า `DB_USER`/`DB_NAME` จะเก็บข้อมูลในไฟล์ **`backend/data/store.json`** (บันทึกอัตโนมัติทุก 3 วินาทีเมื่อมีการเปลี่ยน, restart แล้วข้อมูลยังอยู่) และไม่ต้องใส่รหัสผู้ดูแล (ไม่ได้ตั้ง `ADMIN_SECRET` = ปิดรหัส):

```
cd backend
npm install
npm run dev              # http://localhost:5000 (mode: memory + file)
```

- เปลี่ยนที่เก็บไฟล์ได้ด้วย env `STORE_FILE=path` หรือปิดด้วย `STORE_FILE=off` (กลับเป็นข้อมูลหายเมื่อ restart)
- ล้างข้อมูลทั้งหมด: ปิด backend แล้วลบ `backend/data/store.json`
- nodemon ตั้งให้ข้าม `data/` `uploads/` `build/` แล้ว (ใน `package.json`) ไม่งั้นจะ restart วนทุกครั้งที่บันทึก
- ไฟล์อ่านไม่ได้ (เสีย) ระบบจะสำรองเป็น `store.json.broken-<เวลา>` แล้วเริ่มจากว่าง

ถ้าต้องการใช้ฐานข้อมูล ให้สร้าง `.env` จาก `.env.example` แล้ว restart backend จะสลับไปใช้ MariaDB เอง (ไฟล์ store.json จะไม่ถูกใช้)

### ข้อมูลตัวอย่าง (mock)

รัน backend ไว้ก่อน แล้วเปิดอีกหน้าต่าง:

```
cd backend
npm run seed             # แผนผัง 2 ชั้น + อุปกรณ์ 28 ตัว
npm run seed -- --clear  # ลบเฉพาะข้อมูล mock
```

ถ้าตั้ง `ADMIN_SECRET` ใน `.env` สคริปต์จะอ่านค่าเอง ถ้า backend ไม่ได้รันที่ port 5000 ให้ส่ง `--url http://host:port` ไปด้วย
IP ของ mock ตั้งใจให้ได้สถานะต่างกันจริง: `127.0.0.x` = online, `192.0.2.x` = offline, ไม่มี IP = unknown และมีบางเครื่องที่ตั้งเป็น maintenance

## API (backend)

| Method | Path | หมายเหตุ |
| ------ | ---- | -------- |
| GET | `/api/health` | ตรวจสถานะ + เชื่อม DB |
| GET | `/api/admin/check` | ตรวจรหัสผู้ดูแล (ต้องมี `x-admin-secret`) |
| GET | `/api/devices` | รายการอุปกรณ์ (`?map_id=` กรองตามแผนผัง) |
| GET | `/api/devices/:id` | อุปกรณ์ตัวเดียว |
| POST | `/api/devices` | เพิ่มอุปกรณ์ (admin) + log + ping ทันที |
| PUT | `/api/devices/:id` | แก้ไข/ย้ายอุปกรณ์ (admin) + log |
| DELETE | `/api/devices/:id` | ลบอุปกรณ์ (admin) + log |
| POST | `/api/devices/:id/ping` | ping ตัวเดียวทันที |
| GET | `/api/devices/snapshots/years` | ปีที่มีสแนปช็อตรายการอุปกรณ์ + ปีปัจจุบัน |
| GET | `/api/devices/snapshots?year=` | สแนปช็อตรายการอุปกรณ์ของปีนั้น (อ่านอย่างเดียว) |
| POST | `/api/devices/snapshots` | บันทึกสแนปช็อตจากรายการปัจจุบัน (admin, `{ year }`, มีแล้ว = เขียนทับ) + log |
| GET | `/api/monitor/status` | ค่าตั้ง monitor + เวลารอบล่าสุด |
| POST | `/api/monitor/run` | สั่ง ping ทุกตัวตอนนี้ (admin) |
| GET | `/api/catalog` | รายการประเภท / สถานะ / โซน |
| PUT | `/api/catalog/:kind` | บันทึกรายการ `types` / `statuses` / `zones` (admin, body `{ items }`) — ลบรายการที่มีอุปกรณ์ใช้อยู่ไม่ได้ (409) |
| POST | `/api/catalog/icon` | อัปโหลดไอคอน/โลโก้ (admin, multipart `image`, ≤512KB, รองรับ .svg) |
| GET | `/api/iptable/years` | ปีที่มีตาราง IP + ปีปัจจุบัน + ประเภทอัปเดต + ค่าซิงก์ |
| GET | `/api/iptable?year=` | แถวในตาราง IP ของปีนั้น |
| POST / PUT / DELETE | `/api/iptable`, `/api/iptable/:id` | เพิ่ม / แก้ / ลบแถว (admin) + บันทึกประวัติอัปเดตอัตโนมัติ |
| POST | `/api/iptable/years` | สร้างตารางปีใหม่ (admin, `{ year, copy_from }`) |
| GET / POST | `/api/iptable/updates` | ประวัติอัปเดต (`?year=&ip=`) / บันทึกอัปเดตด้วยมือ (admin) |
| POST | `/api/iptable/import` | นำเข้าทั้งปี (admin, `{ year, rows, updates? }`) |
| POST | `/api/import/xlsx` | อัปโหลดไฟล์ .xlsx ตรงจากหน้าเว็บ (admin, multipart `file`, `only=cameras,iptable`, `dry_run=1` = ดูสรุปก่อน) |
| GET | `/api/maps` | รายการแผนผัง |
| POST | `/api/maps` | อัปโหลดรูปแผนผัง (admin, multipart field `image`) |
| POST | `/api/maps/:id/image` | เปลี่ยนรูปแผนผังเดิม (admin, multipart field `image`, อุปกรณ์/ตำแหน่งคงเดิม) |
| PUT | `/api/maps/:id` | แก้ไขแผนผัง ชื่อ / ชั้น (admin) |
| DELETE | `/api/maps/:id` | ลบแผนผัง (admin) |
| GET | `/api/logs` | ประวัติ (`?limit=`, `?device_id=`) |
| GET | `/api/settings` | ค่า Monitor / ซิงก์ TABLE_IP / ซิงก์ Excel |
| POST | `/api/settings` | บันทึกการตั้งค่า (admin) |
| POST | `/api/devices/import` | นำเข้าอุปกรณ์ทั้งชุด (admin, body `{ type, devices }`) แทนที่เฉพาะ type นั้น + log ครั้งเดียว |
| POST | `/api/maps/import` | นำเข้าแผนผังทั้งชุด (admin, body `{ maps }`) |
| POST | `/api/logs/import` | นำเข้าประวัติทั้งชุด (admin, body `{ logs }`) |

ถ้าตั้ง `ADMIN_SECRET` ใน `.env` งานที่แก้ข้อมูลต้องส่ง header `x-admin-secret` ให้ตรง และหน้าเว็บจะแสดงช่องรหัสผู้ดูแล — ไม่ได้ตั้ง = ไม่ต้องใส่รหัส (`GET /api/admin/mode` บอกว่าต้องใช้รหัสไหม)

## ระบบบันทึกและ Monitor อุปกรณ์ IT / เครือข่าย

หน้า `/` เป็นแอปเต็มจอ (ธีมขาว-เขียว ต่อยอดจาก UI CCTV เดิม):

- **ประเภท / สถานะ / โซน กำหนดเองได้** (Settings → จัดการรายการ) — เพิ่ม/ลบ/เปลี่ยนชื่อ/เรียงลำดับ, เลือกสี, เลือกไอคอนจากชุดไอคอน หรืออัปโหลดโลโก้เอง
  - ค่าเริ่มต้นของประเภท: กล้อง CCTV, NVR/DVR, Switch, Router/Firewall, Access Point, Server, PC/Notebook, Printer, UPS, อื่น ๆ
  - สถานะหลัก `online` `offline` `warning` `maintenance` `unknown` ระบบ ping ใช้ ลบไม่ได้ (แก้ชื่อ/สี/ไอคอนได้) — สถานะที่เพิ่มเองเลือกได้ว่าจะ "หยุด ping" หรือไม่
  - โซนเดิมที่พิมพ์ไว้ในอุปกรณ์ถูกดึงเข้ารายการอัตโนมัติ, ลบรายการที่ยังมีอุปกรณ์ใช้อยู่ไม่ได้
  - เก็บเป็น JSON ในตาราง `settings` (`CATALOG_TYPES`, `CATALOG_STATUSES`, `CATALOG_ZONES`) ไอคอนที่อัปโหลดอยู่ใน `backend/uploads/icon-*`
- **ข้อมูลที่บันทึก** — ชื่อ, IP/hostname, MAC, ยี่ห้อ, รุ่น, Serial, โซน, ชั้น, LAN/Port, ตู้/Rack, แผนผัง + ตำแหน่ง, หมายเหตุ (กล้องมีทิศและ FOV เพิ่ม)
- **Ping อัตโนมัติ** — backend ping ทุกอุปกรณ์ที่มี IP และเปิด monitor ตามรอบที่ตั้ง (ค่าเริ่มต้น 60 วินาที ครั้งละ 20 เครื่องพร้อมกัน) ใช้คำสั่ง `ping` ของระบบ ไม่ต้องลง package เพิ่ม
  - `online` = ตอบปกติ, `warning` = ตอบช้ากว่าเกณฑ์ หรือหลุดครั้งแรก, `offline` = หลุดติดกันครบเกณฑ์ (ค่าเริ่มต้น 2 ครั้ง)
  - `maintenance` = ตั้งเองเพื่อหยุด ping ชั่วคราว, `unknown` = ยังไม่เคยตรวจ
  - เมื่อสถานะเปลี่ยนเป็น offline หรือกลับมา online ระบบจะเขียน log (`down` / `up`) 
- **หน้าจอ** — KPI (Total/Online/Off/Warn/Main คลิกเพื่อกรอง), กรองตามสถานะ/ประเภท/โซน, หมุดบนแผนผังแสดงสีตามสถานะ + ไอคอนประเภท, หน้าต่างอุปกรณ์แสดง latency / พบล่าสุด / ปุ่ม Ping ตอนนี้ / ประวัติของเครื่องนั้น, ตารางรายการ + Export CSV, Log กรองเฉพาะสถานะหรือการแก้ไขได้
- **ตั้งค่า** (แท็บ Settings) — เปิด/ปิด ping, รอบเวลา, timeout, จำนวนครั้งก่อนนับ offline, เกณฑ์ latency ที่ถือว่าช้า

### ย้ายข้อมูลจาก Google Sheet (CCTV เดิม)

รัน backend ไว้ก่อน แล้วเปิดอีกหน้าต่าง:

```
cd backend
npm run import:sheet -- --dry-run   # ดูจำนวนที่จะนำเข้าโดยยังไม่เขียน
npm run import:sheet                 # นำเข้าจริง
npm run import:sheet -- --only devices,maps   # เลือกเฉพาะบางส่วน
```

สคริปต์ดึงแท็บ `CCTV` (→ อุปกรณ์ประเภท camera), `maps` (รูปอ้างอิง Drive), `Logs` (ประวัติ) ผ่านลิงก์แชร์ (Sheet ต้องเปิด "ใครก็ตามที่มีลิงก์ดูได้") — อุปกรณ์ประเภทอื่นไม่โดนลบ, สถานะ `relocated` ถูกเพิ่มเข้ารายการสถานะให้อัตโนมัติ, แท็บ `inventory` / `TABLE_IP_*` ยังไม่นำเข้า (ยังไม่มีตารางรองรับ)

ถ้าตั้ง `ADMIN_SECRET` ใน `.env` สคริปต์จะอ่านค่าเอง ถ้า backend ไม่ได้รันที่ port 5000 ให้ส่ง `--url http://host:port` และเปลี่ยน Sheet ได้ด้วย `--sheet <SPREADSHEET_ID`

### นำเข้าจากไฟล์ Excel (.xlsx ที่ export จาก Sheet CCTV เดิม)

ง่ายสุดคือทำในหน้าเว็บ: **Settings → นำเข้าจาก Excel** → เลือกไฟล์ → ดูสรุป (จำนวนกล้อง / แผนผัง / TABLE_IP แต่ละปี) → กด **นำเข้าข้อมูล** (ต้องกรอกรหัสผู้ดูแลก่อน) หรือใช้สคริปต์ด้านล่าง

**ซิงก์อัตโนมัติ (เปิดเป็นค่าเริ่มต้น):** backend เฝ้าไฟล์ในโปรเจกต์ — แก้ใน Excel แล้วกด Save ภายในไม่กี่วินาทีจะนำเข้ากล้อง + TABLE_IP ใหม่เอง (เก็บสถานะ ping เดิมไว้) และตอนเริ่ม backend จะนำเข้าเฉพาะเมื่อไฟล์ต่างจากครั้งล่าสุด (เทียบ hash) — Excel จึงเป็นต้นฉบับ การแก้กล้อง/TABLE_IP ในเว็บจะถูกทับเมื่อไฟล์เปลี่ยน ปิดได้ที่ Settings → นำเข้าจาก Excel หรือ `XLSX_WATCH=off` ใน `.env` ดูสถานะที่ `GET /api/import/xlsx/status`

ไฟล์ประจำโปรเจกต์อยู่ที่ `backend/data/CCTV-MECHA-PART.xlsx` (เปลี่ยนได้ด้วย `XLSX_FILE` ใน `.env`) — ปุ่ม **ใช้ไฟล์ในโปรเจกต์** ในหน้าเว็บ และ `npm run import:xlsx` ที่ไม่ใส่ `--file` จะอ่านไฟล์นี้:

```
cd backend
npm run import:xlsx -- --file "C:\path\CCTV-MECHA-PART.xlsx" --dry-run
npm run import:xlsx -- --file "C:\path\CCTV-MECHA-PART.xlsx" --map-image "MAP-17889417978541=C:\path\Layout-MECHA-1-2-1FL.png"
npm run import:xlsx -- --file "C:\path\CCTV-MECHA-PART.xlsx" --clear   # ลบกล้องประเภท camera ทั้งหมด
```

- แท็บ `cctv` → อุปกรณ์ประเภท camera (แทนที่เฉพาะประเภท camera) — อ่านค่าดิบในไฟล์ ช่องที่ Excel แสดงเป็นวันที่ผิด ๆ (เช่น FOV) ได้ตัวเลขเดิม
- แท็บ `Maps` → อัปโหลดแผนผังทีละแผ่นตาม `map_id` เดิม (ไม่ลบแผนผังอื่น) รูปมาจาก `--map-image MAP_ID=path` (ใส่ได้หลายครั้ง) ถ้าไม่ใส่จะลองโหลดจาก Google Drive (ไฟล์ต้องแชร์แบบลิงก์)
- แท็บ `TABLE_IP_<ปี>` ทุกปี + `TABLE_IP_UPDATES` (ของปีล่าสุด) / `TABLE_IP_UPDATES_<ปี>` → ตาราง IP / NVR (แทนที่ข้อมูลของปีนั้น) — เลือกเฉพาะส่วนได้ด้วย `--only cameras` หรือ `--only iptable`
- ไม่นำเข้า `Logs` (คอลัมน์ในไฟล์เลื่อนไม่ตรงหัวตาราง), `settings`, `inventory`

### TABLE_IP / NVR (เมนูซ้าย "NVR")

ย้ายมาจาก TABLE_IP ของเว็บ CCTV เดิม (`backend/iptable.js`):
- ตาราง IP แยกตามปี (No., NVR IP, Channel, Camera IP, ชื่อกล้อง, Control, สถานะ, หมายเหตุ) — แก้ / เพิ่ม / ลบแถว, กันใช้ IP ซ้ำในปีเดียวกัน, แนะนำ Channel ว่างถัดไปของ NVR
- สรุปต่อ NVR (จำนวนกล้อง, ช่วง CH, จำนวนที่ยังไม่อยู่บนแผนผัง), มุมมองตาราง / ตาม NVR (ช่อง CH สีตามสถานะ) / ประวัติอัปเดต
- "บนแผนผัง" คำนวณสดจาก IP ของอุปกรณ์ — กด "มีแล้ว" เพื่อไปซูมที่กล้องบนแผนผัง
- บันทึกอัปเดต (ติดตั้งใหม่ / ย้ายตำแหน่ง / ซ่อมบำรุง / เปลี่ยน IP / เปลี่ยนชื่อ / แจ้ง Offline / Online แล้ว / อื่นๆ) + ประวัติต่อ IP
- สร้างตารางปีใหม่ (คัดลอกจากปีอื่น ไม่เอาแถวที่ DELETED หรือเริ่มว่าง) — ตารางปีล่าสุด = "ปีปัจจุบัน"
- ซิงก์อัตโนมัติกับอุปกรณ์ประเภท `camera` (ตั้งค่าใน Settings → ซิงก์ TABLE_IP):
  - เพิ่มกล้อง → เพิ่ม IP เข้าปีปัจจุบัน หา NVR จากช่อง LAN (ไม่มีก็เดาจาก subnet) + Channel ถัดไป
  - แก้ IP / ชื่อกล้อง → แก้แถวตาม, ลบกล้อง → ทำเครื่องหมาย `DELETED - CCTV Removed <วันที่>` (หรือลบแถว / ไม่ทำอะไร)
  - ทุกการเปลี่ยนแปลงบันทึกในประวัติอัปเดต
- Export CSV ตามตัวกรอง
- อ่าน .xlsx เอง ไม่ต้องลง package เพิ่ม

### ย้ายข้อมูลจาก CCTV เดิม (ฐานข้อมูลเก่า)

ตอนเริ่ม backend ในโหมด MariaDB ครั้งแรก ระบบจะ:
1. เติมคอลัมน์ที่ขาดให้ตาราง `devices` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
2. คัดลอกทุกแถวจากตาราง `cameras` มาเป็นอุปกรณ์ประเภท `camera` (id เดิม ตำแหน่งบนแผนผังเดิม)
3. คัดลอก `logs.camera_id/camera_name` ไปที่ `device_id/device_name`

ทำครั้งเดียว (ตั้ง flag `MIGRATED_CCTV` ในตาราง `settings`) และ **ไม่ลบ** ตาราง `cameras` เดิม เก็บไว้เป็นสำรอง

> ⚠️ backend ต้องรันบนเครื่องที่ ping ไปถึงอุปกรณ์ได้ (อยู่ในวง LAN เดียวกัน หรือมี route ถึง) ถ้า firewall ของอุปกรณ์ปิด ICMP อุปกรณ์จะขึ้น offline แม้ใช้งานได้ปกติ — กรณีนี้ปิด monitor ของเครื่องนั้นไว้

ส่วนที่ยังไม่ทำ: ตรวจด้วย TCP port / SNMP, กราฟ uptime ย้อนหลัง, ยืนยันตัวตนพนักงาน
