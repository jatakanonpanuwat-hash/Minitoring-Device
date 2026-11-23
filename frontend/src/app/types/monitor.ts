// ประเภท / สถานะ / โซน มาจากรายการที่ผู้ดูแลกำหนด (GET /api/catalog) — key เป็น string
export type DeviceStatus = string;
export type DeviceType = string;
/** วิธีตรวจอุปกรณ์: 'ping' (ICMP) / 'tcp' (เปิดพอร์ต) / 'snmp' (ถาม sysUpTime) */
export type CheckMethod = string;

export interface CatalogItem {
  key: string;
  label: string;
  /** "lucide:<ชื่อ>" หรือ "/api/uploads/icon-....png" หรือ "" */
  icon: string;
  color?: string;
  /** สถานะ: ไม่ ping อุปกรณ์ที่อยู่ในสถานะนี้ */
  pause_monitor?: boolean;
  /** สถานะหลักของระบบ ping — ลบไม่ได้ */
  builtin?: boolean;
}

export interface Catalog {
  types: CatalogItem[];
  statuses: CatalogItem[];
  zones: CatalogItem[];
}

export type CatalogKind = keyof Catalog;

export interface Device {
  id: string;
  name: string;
  device_type: DeviceType;
  zone: string | null;
  floor: string | null;
  x_percent: number | null;
  y_percent: number | null;
  ip_address: string | null;
  mac_address: string | null;
  brand: string | null;
  model: string | null;
  serial_no: string | null;
  status: DeviceStatus;
  monitor_enabled: boolean;
  /** วิธีตรวจ (backend ใส่ 'ping' ให้ถ้าไม่มี) */
  check_method: CheckMethod;
  /** TCP: พอร์ตปลายทาง / SNMP: พอร์ต (null = 161) */
  check_port: number | null;
  /** SNMP v2c community (null = public) */
  snmp_community: string | null;
  /** ตั้งใจไม่วางบนแผนผัง (เช่นสวิตช์ในห้อง server) — ไม่นับเป็น "ยังไม่วาง" */
  hide_on_map?: boolean;
  last_seen: string | null;
  last_checked: string | null;
  last_latency_ms: number | null;
  fail_count: number;
  remark: string | null;
  map_id: string | null;
  direction: number | null;
  fov_angle: number | null;
  lan: string | null;
  cabinet: string | null;
  install_area: string | null;
  install_detail: string | null;
  requested_by: string | null;
  created_at?: string;
  updated_at?: string;
  updated_by: string | null;
}

export interface MapItem {
  map_id: string;
  map_name: string;
  image_url: string;
  floor: string | null;
}

export type LogAction = 'added' | 'updated' | 'moved' | 'deleted' | 'down' | 'up' | 'imported' | 'ip_table' | 'snapshot';

export interface LogEntry {
  id: number;
  timestamp: string;
  employee_id: string | null;
  employee_name: string | null;
  action: LogAction;
  device_id: string | null;
  device_name: string | null;
  zone: string | null;
  floor: string | null;
  details: string | null;
  old_values: string | null;
  new_values: string | null;
}

export interface AppSettings {
  MONITOR_ENABLED: string;
  MONITOR_INTERVAL_SEC: string;
  MONITOR_TIMEOUT_MS: string;
  MONITOR_FAIL_THRESHOLD: string;
  MONITOR_WARN_MS: string;
  /** key ประเภทที่ ping คั่นด้วย , — ว่าง = ทุกประเภท */
  MONITOR_TYPES: string;
  XLSX_AUTO_SYNC: string;
}

// ---------- สแนปช็อตรายการอุปกรณ์รายปี ----------
export interface DeviceSnapshotYear {
  year: number;
  count: number;
  created_at: string;
  created_by: string | null;
}

export interface DeviceSnapshotYearsInfo {
  years: DeviceSnapshotYear[];
  current: number;
}

export interface DeviceSnapshot {
  year: number;
  created_at: string;
  created_by: string | null;
  devices: Device[];
}

export interface MonitorStatus {
  enabled: boolean;
  intervalSec: number;
  running: boolean;
  lastRunAt: string | null;
  checked: number;
}

// ---------- ประวัติผลตรวจ (กราฟ uptime ย้อนหลัง) ----------
export type HistoryRange = '24h' | '7d' | '30d';

export interface HistoryBucket {
  /** UTC ISO — รายชั่วโมง (24h/7d) หรือรายวัน (30d) */
  t: string;
  checks: number;
  alive: number;
  /** % uptime ของช่องนี้ (null = ไม่มีข้อมูล) */
  uptime: number | null;
  /** latency เฉลี่ย ms (null = ไม่มีข้อมูล) */
  latency: number | null;
}

export interface DeviceHistory {
  device_id: string;
  range: string;
  buckets: HistoryBucket[];
}

/** มีตำแหน่งบนแผนผังแล้วหรือยัง */
export const isPlaced = (d: Pick<Device, 'x_percent' | 'y_percent'>) => d.x_percent != null && d.y_percent != null;
/** ยังไม่วาง และไม่ได้ตั้ง "ไม่แสดงบนแผนผัง" — ต้องไปวาง */
export const needsPlacement = (d: Pick<Device, 'x_percent' | 'y_percent' | 'hide_on_map'>) => !d.hide_on_map && !isPlaced(d);

export function formatAgo(iso: string | null): string {
  if (!iso) return '—';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${Math.max(sec, 0)} วิ.ที่แล้ว`;
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชม.ที่แล้ว`;
  return new Date(iso).toLocaleString('th-TH');
}
