# Monitoring Device

โครงสร้างโปรเจกต์อ้างอิงจาก F5-I-DOJO: แยก `frontend` (React + Vite + Tailwind) กับ `backend` (Node/Express + MariaDB) และมี `gas/Code.gs` สำหรับเชื่อมต่อ Google Apps Script แยกส่วนกัน

## โครงสร้าง

```
monitoring-device/
├── backend/                 Node.js + Express API
│   ├── index.js             จุดเริ่ม → src/server.js
│   ├── src/
│   │   ├── server.js, app.js, config.js, auth.js
│   │   ├── db/              MariaDB / โหมดไฟล์ / สร้างตาราง
│   │   ├── models/          อ่าน-เขียนข้อมูล (อุปกรณ์, แผนผัง, log, ค่าตั้ง, ...)
│   │   ├── services/        ตรวจอุปกรณ์อัตโนมัติ, Telegram, ซิงก์ Excel, สถานะเครือข่าย
│   │   ├── routes/          HTTP API แยกตามกลุ่ม
│   │   └── lib/             อ่าน .xlsx, รับไฟล์อัปโหลด
│   ├── scripts/             seed / import (npm run ...)
│   └── .env.example         ค่าตั้งทั้งหมดพร้อมคำอธิบาย
├── frontend/                React + Vite + TypeScript + Tailwind
│   └── src/app/
│       ├── monitor/         MonitorApp + layout/ map/ devices/ pages/ settings/ shared/
│       ├── types/monitor.ts type ของข้อมูลจาก API
│       └── utils/monitorClient.ts  ฟังก์ชันเรียก API
├── docs/ARCHITECTURE.md     อธิบายโครงสร้างโค้ด + วิธีเพิ่มฟีเจอร์ (อ่านก่อนแก้โค้ด)
└── gas/Code.gs              Google Apps Script template (log ลง Sheet)
```

**คนในทีมที่จะแก้โค้ด เริ่มอ่านที่ [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

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

สิทธิ์: ว่าง = ทุกคน, **editor** = login แล้ว (Editor หรือ Admin), **admin** = Admin เท่านั้น — คอลัมน์ "ไฟล์" คือไฟล์ใน `backend/src/routes/`

| Method | Path | สิทธิ์ | หมายเหตุ | ไฟล์ |
| ------ | ---- | ---- | -------- | ---- |
| GET | `/api/health` | | ตรวจสถานะ + เชื่อม DB | system |
| GET | `/api/network` | | อินเทอร์เน็ต / WiFi / IP ของเครื่อง server + IP ผู้เปิดเว็บ (แถบล่าง) | system |
| GET | `/api/admin/check` | admin | ตรวจรหัสผู้ดูแล (`x-admin-secret`) | system |
| GET | `/api/admin/mode` | | หน้าเว็บต้องแสดงช่องรหัส/login ไหม | system |
| GET | `/api/auth/me` | | ผู้ใช้ปัจจุบัน + ต้องสร้าง Admin คนแรกไหม | auth.js |
| POST | `/api/auth/setup` | | สร้าง Admin คนแรก (ใช้ได้เฉพาะตอนยังไม่มีผู้ใช้) | auth.js |
| POST | `/api/auth/login` | | เข้าสู่ระบบ → token (ผิด 5 ครั้ง = รอ 5 นาที) | auth.js |
| POST | `/api/auth/password` | login | เปลี่ยนรหัสผ่านตัวเอง | auth.js |
| GET/POST | `/api/users` | admin | รายชื่อ / เพิ่มผู้ใช้ | auth.js |
| PUT/DELETE | `/api/users/:id` | admin | แก้ / ลบผู้ใช้ | auth.js |
| GET | `/api/devices` | | รายการอุปกรณ์ (`?map_id=` กรองตามแผนผัง) | devices |
| GET | `/api/devices/:id` | | อุปกรณ์ตัวเดียว | devices |
| POST | `/api/devices` | editor | เพิ่มอุปกรณ์ + log + ping ทันที | devices |
| PUT | `/api/devices/:id` | editor | แก้ไข/ย้ายอุปกรณ์ + log | devices |
| DELETE | `/api/devices/:id` | editor | ลบอุปกรณ์ + log | devices |
| POST | `/api/devices/:id/restore` | editor | กู้คืนอุปกรณ์ที่เพิ่งลบด้วย id เดิม (ปุ่ม "เลิกทำ") | devices |
| POST | `/api/devices/:id/ping` | | ตรวจตัวเดียวทันทีด้วยวิธีของเครื่องนั้น | devices |
| GET | `/api/devices/:id/history?range=24h\|7d\|30d` | | ประวัติผลตรวจรายชั่วโมง (30d ยุบเป็นรายวัน) — กราฟ uptime | devices |
| GET | `/api/devices/snapshots/years` | | ปีที่มีสแนปช็อตรายการอุปกรณ์ + ปีปัจจุบัน | devices |
| GET | `/api/devices/snapshots?year=` | | สแนปช็อตรายการอุปกรณ์ของปีนั้น (อ่านอย่างเดียว) | devices |
| POST | `/api/devices/snapshots` | admin | บันทึกสแนปช็อตจากรายการปัจจุบัน (`{ year }`, มีแล้ว = เขียนทับ) + log | devices |
| POST | `/api/devices/import` | admin | นำเข้าอุปกรณ์ทั้งชุด (`{ type, devices }`) แทนที่เฉพาะ type นั้น + log ครั้งเดียว | devices |
| GET | `/api/monitor/status` | | ค่าตั้ง monitor + เวลารอบล่าสุด | monitor |
| POST | `/api/monitor/run` | editor | สั่ง ping ทุกตัวตอนนี้ (ทำเบื้องหลัง) | monitor |
| GET | `/api/monitor/progress?runId=&since=` | editor | ความคืบหน้า + ผลรายเครื่องของรอบล่าสุด | monitor |
| GET | `/api/catalog` | | รายการประเภท / สถานะ / โซน | catalog |
| PUT | `/api/catalog/:kind` | admin | บันทึกรายการ `types` / `statuses` / `zones` (`{ items }`) — ลบรายการที่มีอุปกรณ์ใช้อยู่ไม่ได้ (409) | catalog |
| POST | `/api/catalog/icon` | admin | อัปโหลดไอคอน/โลโก้ (multipart `image`, ≤512KB, รองรับ .svg) | catalog |
| POST | `/api/import/xlsx` | admin | อัปโหลดไฟล์ .xlsx (multipart `file`, `dry_run=1` = ดูสรุปก่อน, `source=project` = ใช้ไฟล์ในโปรเจกต์) | import |
| GET | `/api/import/xlsx/template` | | ดาวน์โหลดเทมเพลต .xlsx กรอกข้อมูลกล้อง (`data=1` = ใส่กล้อง/แผนผังปัจจุบันไว้ด้วย) | import |
| GET | `/api/import/xlsx/status` | | สถานะซิงก์ Excel อัตโนมัติ | import |
| GET | `/api/maps` | | รายการแผนผัง | maps |
| POST | `/api/maps` | admin | อัปโหลดรูปแผนผัง (multipart `image`) | maps |
| POST | `/api/maps/:id/image` | admin | เปลี่ยนรูปแผนผังเดิม (multipart `image`, อุปกรณ์/ตำแหน่งคงเดิม) | maps |
| PUT | `/api/maps/:id` | admin | แก้ไขแผนผัง ชื่อ / ชั้น | maps |
| DELETE | `/api/maps/:id` | admin | ลบแผนผัง | maps |
| POST | `/api/maps/import` | admin | นำเข้าแผนผังทั้งชุด (`{ maps }`) | maps |
| GET | `/api/logs` | | ประวัติ (`?limit=`, `?device_id=`) | logs |
| GET | `/api/stats/events?days=` | | สถิติ offline/online รายวัน (หน้า Dashboard) | logs |
| POST | `/api/logs/import` | admin | นำเข้าประวัติทั้งชุด (`{ logs }`) | logs |
| GET | `/api/settings` | | ค่า Monitor / ซิงก์ Excel | settings |
| POST | `/api/settings` | admin | บันทึกการตั้งค่า | settings |
| GET/PUT | `/api/telegram` | admin | ค่าตั้งแจ้งเตือน Telegram (token ไม่ถูกส่งกลับ) | settings |
| POST | `/api/telegram/test` | admin | ส่งข้อความทดสอบ | settings |
| GET | `/api/tutorials` | | รายการคู่มือ (เมนู Tutorial) | tutorials |
| GET | `/api/tutorials/limits` | | ชนิดไฟล์ / ขนาดที่อัปโหลดได้ | tutorials |
| POST | `/api/tutorials` | admin | อัปโหลดคู่มือ (multipart `file` + `title`, `description`) — PDF, รูป, .mp4/.webm, Office, .txt ไม่เกิน 300MB | tutorials |
| PUT | `/api/tutorials/:id` | admin | แก้ชื่อ / คำอธิบาย | tutorials |
| PUT | `/api/tutorials/order` | admin | เรียงลำดับ (`{ ids }`) | tutorials |
| DELETE | `/api/tutorials/:id` | admin | ลบคู่มือ + ไฟล์ | tutorials |

ยังไม่มีผู้ใช้และไม่ได้ตั้ง `ADMIN_SECRET` = โหมดเปิด (ทุกคนแก้ได้) — header `x-admin-secret` ที่ตรงกับ `ADMIN_SECRET` ได้สิทธิ์ admin เสมอ (สคริปต์ import ใช้วิธีนี้)

## ระบบบันทึกและ Monitor อุปกรณ์ IT / เครือข่าย

หน้า `/` เป็นแอปเต็มจอ (ธีมขาว-เขียว ต่อยอดจาก UI CCTV เดิม):

- **ประเภท / สถานะ / โซน กำหนดเองได้** (Settings → จัดการรายการ) — เพิ่ม/ลบ/เปลี่ยนชื่อ/เรียงลำดับ, เลือกสี, เลือกไอคอนจากชุดไอคอน หรืออัปโหลดโลโก้เอง
  - ค่าเริ่มต้นของประเภท: กล้อง CCTV, NVR/DVR, Switch, Router/Firewall, Access Point, Server, PC/Notebook, Printer, UPS, อื่น ๆ
  - สถานะหลัก `online` `offline` `warning` `maintenance` `unknown` ระบบ ping ใช้ ลบไม่ได้ (แก้ชื่อ/สี/ไอคอนได้) — สถานะที่เพิ่มเองเลือกได้ว่าจะ "หยุด ping" หรือไม่
  - โซนเดิมที่พิมพ์ไว้ในอุปกรณ์ถูกดึงเข้ารายการอัตโนมัติ, ลบรายการที่ยังมีอุปกรณ์ใช้อยู่ไม่ได้
  - เก็บเป็น JSON ในตาราง `settings` (`CATALOG_TYPES`, `CATALOG_STATUSES`, `CATALOG_ZONES`) ไอคอนที่อัปโหลดอยู่ใน `backend/uploads/icon-*`
- **ข้อมูลที่บันทึก** — ชื่อ, IP/hostname, MAC, ยี่ห้อ, รุ่น, Serial, โซน, ชั้น, LAN/Port, ตู้/Rack, แผนผัง + ตำแหน่ง, วิธีตรวจ (ping / TCP port / SNMP + community), หมายเหตุ (กล้องมีทิศและ FOV เพิ่ม)
- **ตรวจอัตโนมัติ** — backend ตรวจทุกอุปกรณ์ที่มี IP และเปิด monitor ตามรอบที่ตั้ง (ค่าเริ่มต้น 60 วินาที ครั้งละ 20 เครื่องพร้อมกัน) เลือกวิธีได้รายเครื่อง: `ping` (คำสั่ง ping ของระบบ), `tcp` (ต่อพอร์ตที่ระบุ — สำหรับเครื่องที่ปิด ICMP), `snmp` (ถาม sysUpTime ผ่าน SNMP v2c + community — ต้องลง package `net-snmp` ด้วย `npm install`)
  - `online` = ตอบปกติ, `warning` = ตอบช้ากว่าเกณฑ์ หรือหลุดครั้งแรก, `offline` = หลุดติดกันครบเกณฑ์ (ค่าเริ่มต้น 2 ครั้ง)
  - `maintenance` = ตั้งเองเพื่อหยุดตรวจชั่วคราว, `unknown` = ยังไม่เคยตรวจ
  - เมื่อสถานะเปลี่ยนเป็น offline หรือกลับมา online ระบบจะเขียน log (`down` / `up`) พร้อมชื่อวิธีตรวจ
  - ผลตรวจทุกรอบถูกรวมเป็นรายชั่วโมง/อุปกรณ์ เก็บ 30 วัน (ลบของเก่าอัตโนมัติ) — ดูเป็นกราฟ Uptime % + Latency ในหน้าต่างอุปกรณ์ (24 ชม / 7 วัน / 30 วัน)
- **หน้าจอ** — KPI (Total/Online/Off/Warn/Main คลิกเพื่อกรอง), กรองตามสถานะ/ประเภท/โซน, หมุดบนแผนผังแสดงสีตามสถานะ + ไอคอนประเภท, หน้าต่างอุปกรณ์แสดง latency / พบล่าสุด / ปุ่มตรวจตอนนี้ / กราฟ uptime ย้อนหลัง / ประวัติของเครื่องนั้น, ตารางรายการ + Export CSV, Log กรองเฉพาะสถานะหรือการแก้ไขได้
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

ง่ายสุดคือทำในหน้าเว็บ: **Settings → นำเข้าจาก Excel** → เลือกไฟล์ → ดูสรุป (จำนวนกล้อง / แผนผัง) → กด **นำเข้าข้อมูล** (ต้องกรอกรหัสผู้ดูแลก่อน) หรือใช้สคริปต์ด้านล่าง

ยังไม่มีไฟล์? ดาวน์โหลด **เทมเพลต** ในหน้าเดียวกัน — มีแท็บ cctv / Maps พร้อม dropdown โซน/แผนผัง/สถานะ, ตรวจค่าพิกัด (x/y = % ของรูปแผนผัง 0–100, ทิศ 0–360°) และแท็บ "วิธีใช้" อธิบายทุกคอลัมน์ แบบ "พร้อมข้อมูลปัจจุบัน" ใส่กล้องที่มีอยู่ไว้ให้แก้ต่อ (การนำเข้าแทนที่กล้องทั้งหมด)

**ซิงก์อัตโนมัติ (เปิดเป็นค่าเริ่มต้น):** backend เฝ้าไฟล์ในโปรเจกต์ — แก้ใน Excel แล้วกด Save ภายในไม่กี่วินาทีจะนำเข้ากล้องใหม่เอง (เก็บสถานะ ping เดิมไว้) และตอนเริ่ม backend จะนำเข้าเฉพาะเมื่อไฟล์ต่างจากครั้งล่าสุด (เทียบ hash) — Excel จึงเป็นต้นฉบับ การแก้กล้องในเว็บจะถูกทับเมื่อไฟล์เปลี่ยน ปิดได้ที่ Settings → นำเข้าจาก Excel หรือ `XLSX_WATCH=off` ใน `.env` ดูสถานะที่ `GET /api/import/xlsx/status`

ไฟล์ประจำโปรเจกต์อยู่ที่ `backend/data/CCTV-MECHA-PART.xlsx` (เปลี่ยนได้ด้วย `XLSX_FILE` ใน `.env`) — ปุ่ม **ใช้ไฟล์ในโปรเจกต์** ในหน้าเว็บ และ `npm run import:xlsx` ที่ไม่ใส่ `--file` จะอ่านไฟล์นี้:

```
cd backend
npm run import:xlsx -- --file "C:\path\CCTV-MECHA-PART.xlsx" --dry-run
npm run import:xlsx -- --file "C:\path\CCTV-MECHA-PART.xlsx" --map-image "MAP-17889417978541=C:\path\Layout-MECHA-1-2-1FL.png"
npm run import:xlsx -- --file "C:\path\CCTV-MECHA-PART.xlsx" --clear   # ลบกล้องประเภท camera ทั้งหมด
```

- แท็บ `cctv` → อุปกรณ์ประเภท camera (แทนที่เฉพาะประเภท camera) — อ่านค่าดิบในไฟล์ ช่องที่ Excel แสดงเป็นวันที่ผิด ๆ (เช่น FOV) ได้ตัวเลขเดิม
- แท็บ `Maps` → อัปโหลดแผนผังทีละแผ่นตาม `map_id` เดิม (ไม่ลบแผนผังอื่น) รูปมาจาก `--map-image MAP_ID=path` (ใส่ได้หลายครั้ง) ถ้าไม่ใส่จะลองโหลดจาก Google Drive (ไฟล์ต้องแชร์แบบลิงก์)
- ไม่นำเข้า `Logs` (คอลัมน์ในไฟล์เลื่อนไม่ตรงหัวตาราง), `settings`, `inventory`, แท็บ `TABLE_IP_*`
- อ่าน .xlsx เอง ไม่ต้องลง package เพิ่ม

### ย้ายข้อมูลจาก CCTV เดิม (ฐานข้อมูลเก่า)

ตอนเริ่ม backend ในโหมด MariaDB ครั้งแรก ระบบจะ:
1. เติมคอลัมน์ที่ขาดให้ตาราง `devices` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
2. คัดลอกทุกแถวจากตาราง `cameras` มาเป็นอุปกรณ์ประเภท `camera` (id เดิม ตำแหน่งบนแผนผังเดิม)
3. คัดลอก `logs.camera_id/camera_name` ไปที่ `device_id/device_name`

ทำครั้งเดียว (ตั้ง flag `MIGRATED_CCTV` ในตาราง `settings`) และ **ไม่ลบ** ตาราง `cameras` เดิม เก็บไว้เป็นสำรอง

> ⚠️ backend ต้องรันบนเครื่องที่เข้าถึงอุปกรณ์ได้ (อยู่ในวง LAN เดียวกัน หรือมี route ถึง) ถ้า firewall ของอุปกรณ์ปิด ICMP ให้เปลี่ยนวิธีตรวจของเครื่องนั้นเป็น TCP หรือ SNMP แทนการปิด monitor
