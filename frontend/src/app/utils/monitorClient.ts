import type {
  AppSettings, Catalog, CatalogItem, CatalogKind, Device, DeviceHistory, DeviceSnapshot, DeviceSnapshotYearsInfo,
  HistoryRange, LogEntry, MapItem, MonitorStatus,
} from '../types/monitor';

const BASE = import.meta.env.BASE_URL;

// ---------- login token ----------
// เก็บในเบราว์เซอร์ (ต่อเครื่อง) — ส่งเป็น Authorization: Bearer กับทุก request
const TOKEN_KEY = 'monitoring-device:token';
let authToken: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage ใช้ไม่ได้ — ใช้ได้จนปิดหน้า */
  }
}
export const getAuthToken = () => authToken;
/** เรียกเมื่อ server ตอบ 401 ขณะมี token (หมดอายุ / ถูกปิดบัญชี / เปลี่ยนรหัส) */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (authToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${authToken}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401 && authToken && onUnauthorized) onUnauthorized();
    throw new Error(body?.error || `${init?.method || 'GET'} ${path} failed: ${res.status}`);
  }
  return res.json();
}

// ---------- auth / users ----------
export type Role = 'admin' | 'editor';
export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  employee_id: string | null;
  role: Role;
  disabled: boolean;
  last_login: string | null;
  created_at: string | null;
}
export interface AuthState {
  user: AuthUser | null;
  needsSetup: boolean;
  setupNeedsSecret: boolean;
  open: boolean;
}
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function getAuthState(): Promise<AuthState> {
  return request<AuthState>('api/auth/me');
}
export async function login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  return request('api/auth/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, password }) });
}
export async function setupFirstAdmin(data: {
  username: string; password: string; display_name: string; employee_id?: string; admin_secret?: string;
}): Promise<{ token: string; user: AuthUser }> {
  return request('api/auth/setup', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
}
export async function changeMyPassword(old_password: string, new_password: string): Promise<{ token: string; user: AuthUser }> {
  return request('api/auth/password', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ old_password, new_password }) });
}
export async function listUsers(): Promise<AuthUser[]> {
  return request<AuthUser[]>('api/users');
}
export async function createUser(data: {
  username: string; password: string; display_name: string; employee_id?: string; role: Role;
}): Promise<AuthUser> {
  return request<AuthUser>('api/users', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
}
export async function updateUser(
  id: string,
  data: Partial<{ display_name: string; employee_id: string | null; role: Role; disabled: boolean; password: string }>
): Promise<AuthUser> {
  return request<AuthUser>(`api/users/${id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(data) });
}
export async function deleteUser(id: string): Promise<void> {
  await request(`api/users/${id}`, { method: 'DELETE' });
}

function adminHeaders(secret: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-admin-secret': secret };
}

export async function getAdminMode(): Promise<{ required: boolean }> {
  return request<{ required: boolean }>('api/admin/mode');
}

export async function checkAdmin(adminSecret: string): Promise<boolean> {
  const res = await fetch(`${BASE}api/admin/check`, { headers: { 'x-admin-secret': adminSecret } });
  return res.ok;
}

// ---------- devices ----------
export async function getDevices(mapId?: string): Promise<Device[]> {
  const q = mapId ? `?map_id=${encodeURIComponent(mapId)}` : '';
  return request<Device[]>(`api/devices${q}`);
}

export async function createDevice(data: Partial<Device> & { name: string }, adminSecret: string): Promise<Device> {
  return request<Device>('api/devices', {
    method: 'POST',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(data),
  });
}

export async function updateDevice(id: string, data: Partial<Device>, adminSecret: string): Promise<Device> {
  return request<Device>(`api/devices/${id}`, {
    method: 'PUT',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(data),
  });
}

/** กู้คืนอุปกรณ์ที่เพิ่งลบด้วย id เดิม (เลิกทำการลบ) */
export async function restoreDevice(device: Device, adminSecret: string): Promise<Device> {
  return request<Device>(`api/devices/${encodeURIComponent(device.id)}/restore`, {
    method: 'POST',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(device),
  });
}

export async function deleteDevice(id: string, adminSecret: string): Promise<void> {
  await request<{ ok: boolean }>(`api/devices/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-secret': adminSecret },
  });
}

export async function pingDevice(id: string): Promise<{ alive: boolean; latency: number | null; device: Device }> {
  return request(`api/devices/${id}/ping`, { method: 'POST' });
}

// ---------- สแนปช็อตรายการอุปกรณ์รายปี ----------
export async function getDeviceSnapshotYears(): Promise<DeviceSnapshotYearsInfo> {
  return request<DeviceSnapshotYearsInfo>('api/devices/snapshots/years');
}

export async function getDeviceSnapshot(year: number): Promise<DeviceSnapshot> {
  return request<DeviceSnapshot>(`api/devices/snapshots?year=${year}`);
}

export async function saveDeviceSnapshot(year: number, adminSecret: string): Promise<{ year: number; count: number; created_at: string }> {
  return request('api/devices/snapshots', { method: 'POST', headers: adminHeaders(adminSecret), body: JSON.stringify({ year }) });
}

// ---------- network (แถบล่าง) ----------
export interface NetworkInfo {
  server: {
    hostname: string;
    ips: { iface: string; address: string }[];
    wifi: { connected: boolean; ssid: string | null; signal: number | null } | null;
    internet: { online: boolean; latencyMs: number | null };
  };
  client: { ip: string };
  checkedAt: string;
}
export async function getNetworkInfo(): Promise<NetworkInfo> {
  return request<NetworkInfo>('api/network');
}

// ---------- monitor ----------
export async function getMonitorStatus(): Promise<MonitorStatus> {
  return request<MonitorStatus>('api/monitor/status');
}

/** เริ่ม ping ทั้งหมด (เบื้องหลัง) — ติดตามผลด้วย getMonitorProgress */
export async function runMonitorNow(adminSecret: string): Promise<{ ok: boolean; alreadyRunning: boolean; runId: number }> {
  return request('api/monitor/run', { method: 'POST', headers: { 'x-admin-secret': adminSecret } });
}

export interface MonitorProgressEntry {
  seq: number;
  at: string;
  id: string;
  name: string;
  ip: string;
  status: string; // online | warning | offline | error
  prev: string;
  changed: boolean;
  latency: number | null;
  error: string | null;
}

export interface MonitorProgress {
  runId: number;
  source: 'auto' | 'manual' | null;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  counts: { online: number; warning: number; offline: number; error: number };
  changed: number;
  note: string | null;
  entries: MonitorProgressEntry[];
}

export async function getMonitorProgress(runId: number, since: number): Promise<MonitorProgress> {
  return request<MonitorProgress>(`api/monitor/progress?runId=${runId}&since=${since}`);
}

// ---------- catalog (ประเภท / สถานะ / โซน) ----------
export async function getCatalog(): Promise<Catalog> {
  return request<Catalog>('api/catalog');
}

export async function saveCatalog(kind: CatalogKind, items: CatalogItem[], adminSecret: string): Promise<Catalog> {
  return request<Catalog>(`api/catalog/${kind}`, {
    method: 'PUT',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify({ items }),
  });
}

export async function uploadIcon(file: File, adminSecret: string): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const r = await request<{ icon: string }>('api/catalog/icon', {
    method: 'POST',
    headers: { 'x-admin-secret': adminSecret },
    body: form,
  });
  return r.icon;
}

// ---------- maps ----------
export async function getMaps(): Promise<MapItem[]> {
  return request<MapItem[]>('api/maps');
}

export async function uploadMap(file: File, mapName: string, adminSecret: string, floor?: string): Promise<MapItem> {
  const form = new FormData();
  form.append('image', file);
  form.append('map_name', mapName);
  if (floor) form.append('floor', floor);
  return request<MapItem>('api/maps', {
    method: 'POST',
    headers: { 'x-admin-secret': adminSecret },
    body: form,
  });
}

export async function replaceMapImage(mapId: string, file: File, adminSecret: string): Promise<MapItem> {
  const form = new FormData();
  form.append('image', file);
  return request<MapItem>(`api/maps/${mapId}/image`, {
    method: 'POST',
    headers: { 'x-admin-secret': adminSecret },
    body: form,
  });
}

export async function renameMap(mapId: string, mapName: string, adminSecret: string, floor?: string): Promise<MapItem> {
  return request<MapItem>(`api/maps/${mapId}`, {
    method: 'PUT',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(floor === undefined ? { map_name: mapName } : { map_name: mapName, floor }),
  });
}

export async function deleteMap(mapId: string, adminSecret: string): Promise<void> {
  await request<{ ok: boolean }>(`api/maps/${mapId}`, {
    method: 'DELETE',
    headers: { 'x-admin-secret': adminSecret },
  });
}

// ---------- logs ----------
export async function getLogs(limit = 200, deviceId?: string): Promise<LogEntry[]> {
  const q = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : '';
  return request<LogEntry[]>(`api/logs?limit=${limit}${q}`);
}

export interface EventStats {
  days: number;
  today: string;
  daily: { date: string; down: number; up: number }[];
  top: { device_id: string | null; device_name: string; down: number }[];
}

export async function getEventStats(days = 14): Promise<EventStats> {
  return request<EventStats>(`api/stats/events?days=${days}`);
}

export async function getDeviceHistory(id: string, range: HistoryRange): Promise<DeviceHistory> {
  return request<DeviceHistory>(`api/devices/${id}/history?range=${range}`);
}

// ---------- settings / notify ----------
export async function getSettings(): Promise<AppSettings> {
  return request<AppSettings>('api/settings');
}

export async function saveSettings(
  data: Partial<AppSettings>,
  adminSecret: string
): Promise<void> {
  await request<{ ok: boolean }>('api/settings', {
    method: 'POST',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(data),
  });
}


// ---------- นำเข้าไฟล์ Excel (.xlsx) ----------
export interface XlsxSyncStatus {
  enabled: boolean;
  file: string;
  exists: boolean;
  modified: string | null;
  last_sync: string | null;
  last_result: string | null;
  last_error: string | null;
  syncing: boolean;
}

export async function getXlsxSyncStatus(): Promise<XlsxSyncStatus> {
  return request<XlsxSyncStatus>('api/import/xlsx/status');
}

export interface XlsxImportSummary {
  file: string;
  sheets: string[];
  warnings: string[];
  cameras: { count: number; skipped: number; current: number } | null;
  maps: { map_id: string; map_name: string; exists: boolean }[];
  result?: {
    maps: { map_id: string; map_name: string; status: 'exists' | 'downloaded' | 'no_image' }[];
    cameras: { imported: number; skipped: number } | null;
  };
}

export async function importXlsx(
  file: File | 'project', // 'project' = อ่าน backend/data/CCTV-MECHA-PART.xlsx ในโปรเจกต์
  opts: { cameras: boolean; dryRun: boolean },
  adminSecret: string,
): Promise<XlsxImportSummary> {
  const form = new FormData();
  if (file === 'project') form.append('source', 'project');
  else form.append('file', file);
  form.append('only', opts.cameras ? 'cameras' : '');
  if (opts.dryRun) form.append('dry_run', '1');
  return request<XlsxImportSummary>('api/import/xlsx', {
    method: 'POST',
    headers: { 'x-admin-secret': adminSecret },
    body: form,
  });
}

// ---------- แจ้งเตือน Telegram ----------
export interface TelegramConfig {
  enabled: boolean;
  chatId: string;
  notifyRecovery: boolean;
  /** ตั้ง token ไว้แล้วหรือยัง (server ไม่ส่ง token จริงกลับมา) */
  tokenSet: boolean;
  tokenHint: string;
  lastSentAt: string | null;
  lastError: string | null;
}

export async function getTelegramConfig(): Promise<TelegramConfig> {
  return request<TelegramConfig>('api/telegram');
}

/** token: ส่งเฉพาะตอนเปลี่ยน ('' = ลบ, undefined = คงเดิม) */
export async function saveTelegramConfig(data: { enabled?: boolean; chatId?: string; notifyRecovery?: boolean; token?: string }): Promise<void> {
  await request<{ ok: boolean }>('api/telegram', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function testTelegram(data: { token?: string; chatId?: string }): Promise<void> {
  await request<{ ok: boolean }>('api/telegram/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
