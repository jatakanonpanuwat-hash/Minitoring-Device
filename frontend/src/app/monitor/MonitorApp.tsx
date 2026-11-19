import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import type { Catalog, Device, MapItem, MonitorStatus } from '../types/monitor';
import {
  checkAdmin,
  getAdminMode,
  getAuthState,
  setAuthToken,
  setUnauthorizedHandler,
  type AuthState,
  type AuthUser,
  createDevice,
  deleteDevice,
  restoreDevice,
  deleteMap,
  getCatalog,
  getDevices,
  getMaps,
  getMonitorStatus,
  getSettings,
  pingDevice,
  renameMap,
  runMonitorNow,
  saveSettings,
  updateDevice,
  uploadMap,
} from '../utils/monitorClient';
import { BottomBar } from './BottomBar';
import { DashboardPage } from './DashboardPage';
import { DeviceModal } from './DeviceModal';
import { DeviceTablePage } from './DeviceTablePage';
import { LogsPage } from './LogsPage';
import { CatalogModal } from './CatalogModal';
import { IpTablePage } from './IpTablePage';
import { CatalogContext, EMPTY_CATALOG } from './catalog';
import { Rail, type PageKind } from './Rail';
import { SlidePanel } from './SlidePanel';
import { SettingsPage, type MonitorForm } from './SettingsPage';
import { TopBar, type ViewMode } from './TopBar';
import { AuthContext, ChangePasswordModal, LoginModal, UserMenu, type AuthInfo } from './auth';
import { Viewer } from './Viewer';

type ModalKind = 'device' | 'catalog' | null;

// ดึงสถานะอุปกรณ์ใหม่ทุก ๆ กี่วินาที (backend ping เองตามรอบที่ตั้งใน Settings)
const POLL_MS = 15000;
const LAST_MAP_KEY = 'monitoring-device:last-map';

export function MonitorApp() {
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [activeMapId, setActiveMapIdState] = useState('');
  // จำแผนผังที่เลือกล่าสุดไว้ในเบราว์เซอร์ (เปิดครั้งหน้ากลับมาที่เดิม)
  const setActiveMapId = useCallback((v: string | ((prev: string) => string)) => {
    setActiveMapIdState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try {
        if (next) localStorage.setItem(LAST_MAP_KEY, next);
      } catch {
        /* storage ใช้ไม่ได้ — ไม่เป็นไร */
      }
      return next;
    });
  }, []);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connected, setConnected] = useState(true);
  const [mode, setMode] = useState<ViewMode>('view');
  const [panelOpen, setPanelOpen] = useState(true);
  const [modal, setModal] = useState<ModalKind>(null);
  // หน้าหลัก: แผนผัง / Dashboard / รายการอุปกรณ์ (เต็มจอ)
  const [page, setPage] = useState<PageKind>('map');
  const togglePage = (p: PageKind) => setPage((cur) => (cur === p ? 'map' : p));
  const [selected, setSelected] = useState<Device | null>(null);
  const [modalError, setModalError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [secret, setSecret] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  // ---------- login ----------
  const [authState, setAuthState] = useState<AuthState>({ user: null, needsSetup: false, setupNeedsSecret: false, open: false });
  const [loginOpen, setLoginOpen] = useState<{ reason?: string } | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [adminResult, setAdminResult] = useState('');
  const [monitorForm, setMonitorForm] = useState<MonitorForm>({
    enabled: true, intervalSec: '60', timeoutMs: '1000', failThreshold: '2', warnMs: '200',
  });
  const [monitorResult, setMonitorResult] = useState('');
  const [ipAuto, setIpAuto] = useState({ add: true, remove: 'soft' });
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [zoom, setZoom] = useState(1);

  const refreshMaps = useCallback(async () => {
    try {
      const rows = await getMaps();
      setMaps(rows);
      let saved = '';
      try {
        saved = localStorage.getItem(LAST_MAP_KEY) || '';
      } catch {
        /* storage ใช้ไม่ได้ */
      }
      setActiveMapId((prev) =>
        rows.some((m) => m.map_id === prev) ? prev
          : rows.some((m) => m.map_id === saved) ? saved
          : rows[0]?.map_id || ''
      );
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  // ค่าล่าสุดจาก backend — ใช้จำค่าเดิมก่อนแก้ เพื่อ "เลิกทำ"
  const savedRef = useRef<Device[]>([]);

  const refreshDevices = useCallback(async () => {
    try {
      const rows = await getDevices();
      savedRef.current = rows;
      setDevices(rows);
      // ให้ modal ที่เปิดอยู่เห็นสถานะล่าสุดด้วย
      setSelected((prev) => (prev ? rows.find((d) => d.id === prev.id) || prev : prev));
      setConnected(true);
    } catch {
      setConnected(false);
    }
    getMonitorStatus().then(setMonitorStatus).catch(() => {});
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await getSettings();
    setMonitorForm({
      enabled: s.MONITOR_ENABLED === 'TRUE',
      intervalSec: s.MONITOR_INTERVAL_SEC,
      timeoutMs: s.MONITOR_TIMEOUT_MS,
      failThreshold: s.MONITOR_FAIL_THRESHOLD,
      warnMs: s.MONITOR_WARN_MS,
    });
    setIpAuto({ add: s.IPTABLE_AUTO_ADD !== 'FALSE', remove: s.IPTABLE_AUTO_REMOVE || 'soft' });
  }, []);

  useEffect(() => {
    refreshMaps();
    refreshDevices();
    loadSettings().catch(() => {});
    getCatalog().then(setCatalog).catch(() => {});
    getAdminMode().then((m) => setAuthRequired(m.required)).catch(() => {});
    getAuthState().then(setAuthState).catch(() => {});
    const t = setInterval(refreshDevices, POLL_MS);
    return () => clearInterval(t);
  }, [refreshMaps, refreshDevices, loadSettings]);

  const activeMap = maps.find((m) => m.map_id === activeMapId) || null;
  const zones = catalog.zones;

  const pausedKeys = useMemo(
    () => new Set(catalog.statuses.filter((s) => s.pause_monitor).map((s) => s.key)),
    [catalog]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (statusFilter === 'problem') {
        if (d.status !== 'offline' && d.status !== 'warning') return false;
      } else if (statusFilter === 'paused') {
        if (!pausedKeys.has(d.status)) return false;
      } else if (statusFilter && d.status !== statusFilter) return false;
      if (typeFilter && d.device_type !== typeFilter) return false;
      if (zoneFilter && d.zone !== zoneFilter) return false;
      if (!q) return true;
      return [d.name, d.ip_address, d.mac_address, d.zone, d.brand, d.model, d.serial_no].some((v) =>
        (v || '').toLowerCase().includes(q)
      );
    });
  }, [devices, search, statusFilter, typeFilter, zoneFilter, pausedKeys]);

  const visibleOnMap = useMemo(
    () => filtered.filter((d) => !activeMap || !d.map_id || d.map_id === activeMap.map_id),
    [filtered, activeMap]
  );

  const openPanel = () => {
    if (page !== 'map') {
      // อยู่หน้าอื่น — กลับไปแผนผังแล้วเปิดแผง
      setPage('map');
      setPanelOpen(true);
    } else {
      setPanelOpen(!panelOpen);
    }
  };

  const showSettingsError = (msg: string) => {
    setAdminResult(msg);
    setPage('settings');
  };

  // ไปที่อุปกรณ์บนแผนผัง (จาก TABLE_IP) — ล้างตัวกรองให้เห็นแน่ ๆ, สลับแผนผัง, ไฮไลต์, ซูมเข้า
  const focusDevice = (d: Device) => {
    setSearch('');
    setStatusFilter('');
    setTypeFilter('');
    setZoneFilter('');
    if (d.map_id) setActiveMapId(d.map_id);
    setPage('map');
    setSelected(d);
    setModal(null);
    setFocus((f) => ({ id: d.id, n: (f?.n || 0) + 1 }));
  };

  const handleSaveIpAuto = async (next: { add: boolean; remove: string }) => {
    setIpAuto(next);
    try {
      await saveSettings({ IPTABLE_AUTO_ADD: next.add ? 'TRUE' : 'FALSE', IPTABLE_AUTO_REMOVE: next.remove }, secret);
      setMonitorResult('บันทึกการซิงก์ TABLE_IP แล้ว');
    } catch {
      setMonitorResult('บันทึกไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ');
      loadSettings().catch(() => {});
    }
  };

  const openDevice = (d: Device) => {
    setSelected(d);
    setModalError('');
    setModal('device');
  };

  // ---------- device actions ----------
  // วางอุปกรณ์ใหม่จากแผง PlacePanel
  const handleConfirmPlace = async (
    data: Partial<Device>,
    x: number,
    y: number
  ): Promise<string | null> => {
    if (!activeMap) return 'ยังไม่ได้เลือกแผนผัง';
    const payload = { ...data, map_id: activeMap.map_id, x_percent: x, y_percent: y };
    try {
      const saved = await createDevice({ ...payload, name: data.name || '' }, secret);
      setMode('view');
      await refreshDevices();
      // เลือก + ซูมไปที่ตัวใหม่ (ล้างตัวกรองด้วย) — จุดเล็กสีเทาบนแผนผังที่มีอุปกรณ์เยอะมองหาไม่เจอ
      focusDevice(saved);
      // backend ping ตัวใหม่ทันที — ดึงอีกรอบให้เห็นสถานะ
      setTimeout(refreshDevices, 2500);
      return null;
    } catch (e) {
      const msg = (e as Error).message;
      return /401|403/.test(msg)
        ? 'บันทึกไม่สำเร็จ — ไม่มีสิทธิ์ — กรุณาเข้าสู่ระบบ'
        : `บันทึกไม่สำเร็จ — ${msg}`;
    }
  };

  // ---------- วางอุปกรณ์ที่ยังไม่มีตำแหน่ง (เช่นนำเข้าจาก Excel) ----------
  const [placingId, setPlacingId] = useState<string | null>(null);
  const placingDevice = placingId ? devices.find((d) => d.id === placingId) || null : null;

  // เปลี่ยนโหมดจากแถบเครื่องมือ — ออกจากการวางอุปกรณ์เดิมเสมอ
  // จุดเริ่มของรอบ "ย้าย / หมุน" ในประวัติเลิกทำ — ใช้ตอนกด "ยกเลิก" เพื่อคืนทุกอย่างในรอบนี้
  const editStart = useRef(0);

  const changeMode = (m: ViewMode) => {
    setPlacingId(null);
    if (m === 'move') editStart.current = undoStack.length;
    setMode(m);
  };

  const startPlacing = (d: Device) => {
    if (maps.length === 0) {
      window.alert('ยังไม่มีแผนผัง — อัปโหลดแผนผังก่อน (เมนู Map ด้านซ้าย)');
      return;
    }
    // ไปแผนผังของอุปกรณ์ (ถ้ามี) ไม่งั้นใช้แผนผังที่เปิดอยู่
    if (d.map_id && maps.some((m) => m.map_id === d.map_id)) setActiveMapId(d.map_id);
    setModal(null);
    setSelected(null);
    setPage('map');
    setPlacingId(d.id);
    setMode('place');
  };

  const handleConfirmPlaceExisting = async (id: string, x: number, y: number): Promise<string | null> => {
    if (!activeMap) return 'ยังไม่ได้เลือกแผนผัง';
    try {
      const saved = await updateDevice(id, { map_id: activeMap.map_id, x_percent: x, y_percent: y }, secret);
      pushUndo(id, 'วางตำแหน่ง', ['map_id', 'x_percent', 'y_percent']);
      changeMode('view');
      await refreshDevices();
      focusDevice(saved);
      return null;
    } catch (e) {
      const msg = (e as Error).message;
      return /401|403/.test(msg) ? 'ไม่มีสิทธิ์ — กรุณาเข้าสู่ระบบ' : `บันทึกไม่สำเร็จ — ${msg}`;
    }
  };

  const handlePreviewMove =(id: string, x: number, y: number) => {
    setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, x_percent: x, y_percent: y } : d)));
  };

  // ---------- เลิกทำ (Undo) การย้าย / หมุน / วางตำแหน่ง ----------
  // update = คืนค่าฟิลด์เดิม, delete = สร้างอุปกรณ์คืนด้วย id เดิม
  type UndoEntry =
    | { kind: 'update'; id: string; label: string; prev: Partial<Device> }
    | { kind: 'delete'; id: string; label: string; snapshot: Device };
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [toast, setToast] = useState<{ text: string; canUndo: boolean; error?: boolean } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (text: string, canUndo: boolean, error = false) => {
    setToast({ text, canUndo, error });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 6000 : 10000);
  };

  /** จำค่าเดิม (จาก backend) ของฟิลด์ที่กำลังจะเปลี่ยน — เรียกก่อน refreshDevices */
  const pushUndo = (id: string, verb: string, fields: (keyof Device)[]) => {
    const old = savedRef.current.find((d) => d.id === id);
    if (!old) return;
    const prev: Partial<Device> = {};
    for (const f of fields) (prev as Record<string, unknown>)[f] = old[f];
    const label = `${verb} ${old.name}`;
    setUndoStack((st) => [...st.slice(-19), { kind: 'update', id, label, prev }]);
    showToast(`${label} แล้ว`, true);
  };

  // คืนค่าหนึ่งรายการในประวัติ (โยน error ถ้าบันทึกไม่สำเร็จ)
  const revertEntry = async (entry: UndoEntry) => {
    if (entry.kind === 'delete') {
      // สร้างคืน — ตัวอื่นที่ใช้ id นี้ในประวัติเลิกทำยังใช้ได้ต่อ
      await restoreDevice(entry.snapshot, secret);
    } else {
      setDevices((prev) => prev.map((d) => (d.id === entry.id ? { ...d, ...entry.prev } : d)));
      await updateDevice(entry.id, entry.prev, secret);
    }
  };

  /** จำนวนการแก้ในรอบ ย้าย / หมุน ปัจจุบัน */
  const editCount = mode === 'move' ? Math.max(undoStack.length - editStart.current, 0) : 0;

  // ปุ่ม "ยกเลิก" บนแถบเครื่องมือ: โหมดเพิ่ม = ออกโดยไม่บันทึก, โหมดย้าย/หมุน = คืนทุกอย่างที่ทำในรอบนี้แล้วออก
  const cancelEdit = async () => {
    if (mode !== 'move') {
      changeMode('view');
      return;
    }
    const start = Math.min(editStart.current, undoStack.length);
    const entries = undoStack.slice(start).reverse();
    changeMode('view');
    if (entries.length === 0) return;
    setUndoStack((st) => st.slice(0, start));
    let failed = 0;
    for (const e of entries) {
      try {
        await revertEntry(e);
      } catch {
        failed++;
      }
    }
    if (failed) showToast(`ยกเลิกไม่สำเร็จ ${failed} รายการ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ`, false, true);
    else showToast(`ยกเลิกการย้าย / หมุนแล้ว ${entries.length} รายการ`, false);
    refreshDevices();
  };

  const undoLast = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((st) => st.slice(0, -1));
    // เลิกทำเกินจุดเริ่มรอบย้าย/หมุน → เลื่อนจุดเริ่มตาม
    if (editStart.current > undoStack.length - 1) editStart.current = undoStack.length - 1;
    try {
      await revertEntry(last);
      showToast(`เลิกทำแล้ว — ${last.label}`, undoStack.length > 1);
    } catch (e) {
      const msg = (e as Error).message;
      showToast(
        /401|403/.test(msg) ? 'เลิกทำไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ' : `เลิกทำไม่สำเร็จ — ${msg}`,
        false,
        true
      );
    }
    refreshDevices();
  };

  // Ctrl+Z / ⌘+Z = เลิกทำ (ไม่ทำงานตอนพิมพ์ในช่องกรอก หรือมีหน้าต่างเปิดอยู่)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.cctv-app .modal') || undoStack.length === 0) return;
      e.preventDefault();
      undoLast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleCommitMove = async (id: string, x: number, y: number) => {
    try {
      await updateDevice(id, { x_percent: x, y_percent: y }, secret);
      pushUndo(id, 'ย้าย', ['x_percent', 'y_percent']);
    } catch {
      showToast('ย้ายอุปกรณ์ไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ', false, true);
    }
    refreshDevices();
  };

  const handleCommitRotate = async (id: string, direction: number, fov: number) => {
    // แสดงทิศใหม่ทันที ไม่ต้องรอ backend
    setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, direction, fov_angle: fov } : d)));
    try {
      await updateDevice(id, { direction, fov_angle: fov }, secret);
      pushUndo(id, 'หมุนทิศ', ['direction', 'fov_angle']);
    } catch {
      showToast('หมุนทิศกล้องไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ', false, true);
    }
    refreshDevices();
  };

  const handleSaveDevice =async (id: string, data: Partial<Device>) => {
    try {
      await updateDevice(id, data, secret);
      setModal(null);
      setSelected(null);
      refreshDevices();
    } catch (e) {
      setModalError(`บันทึกไม่สำเร็จ — ${(e as Error).message}`);
    }
  };

  const handleDeleteDevice = async (id: string) => {
    // เก็บข้อมูลก่อนลบ ไว้สร้างคืนเมื่อกด "เลิกทำ"
    const snapshot = savedRef.current.find((d) => d.id === id) || devices.find((d) => d.id === id);
    try {
      await deleteDevice(id, secret);
      setModal(null);
      setSelected(null);
      if (snapshot) {
        const label = `ลบ ${snapshot.name}`;
        setUndoStack((st) => [...st.slice(-19), { kind: 'delete', id, label, snapshot }]);
        showToast(`${label} แล้ว`, true);
      }
      refreshDevices();
    } catch {
      setModalError('ลบไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ');
    }
  };

  const handlePing = async (id: string) => {
    const r = await pingDevice(id);
    setDevices((prev) => prev.map((d) => (d.id === id ? r.device : d)));
    setSelected((prev) => (prev && prev.id === id ? r.device : prev));
    return r;
  };

  // ---------- map actions ----------
  const handleUploadMap = async (file: File, name: string) => {
    try {
      const map = await uploadMap(file, name, secret);
      await refreshMaps();
      setActiveMapId(map.map_id);
      setAdminResult('');
    } catch (e) {
      setAdminResult(`อัปโหลดแผนผังไม่สำเร็จ — ${(e as Error).message}`);
    }
  };

  const handleRenameMap = async (id: string, name: string) => {
    try {
      await renameMap(id, name, secret);
      refreshMaps();
    } catch {
      setAdminResult('เปลี่ยนชื่อไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ');
    }
  };

  const handleDeleteMap = async (id: string) => {
    try {
      await deleteMap(id, secret);
      if (id === activeMapId) setActiveMapId('');
      refreshMaps();
    } catch {
      setAdminResult('ลบแผนผังไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ');
    }
  };

  // ---------- settings ----------
  const handleCheckAdmin = async () => {
    try {
      const ok = await checkAdmin(secret);
      setAdminResult(ok ? 'รหัสผู้ดูแลถูกต้อง' : 'รหัสผู้ดูแลไม่ถูกต้อง');
    } catch {
      setAdminResult('เชื่อมต่อ backend ไม่ได้');
    }
  };

  const handleSaveMonitor = async () => {
    try {
      await saveSettings(
        {
          MONITOR_ENABLED: monitorForm.enabled ? 'TRUE' : 'FALSE',
          MONITOR_INTERVAL_SEC: monitorForm.intervalSec,
          MONITOR_TIMEOUT_MS: monitorForm.timeoutMs,
          MONITOR_FAIL_THRESHOLD: monitorForm.failThreshold,
          MONITOR_WARN_MS: monitorForm.warnMs,
        },
        secret
      );
      setMonitorResult('บันทึกการตั้งค่า Monitor แล้ว');
      refreshDevices();
    } catch {
      setMonitorResult('บันทึกไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ');
    }
  };

  const handleRunMonitor = async () => {
    try {
      setMonitorResult('กำลัง ping ทุกอุปกรณ์...');
      await runMonitorNow(secret);
      setMonitorResult('ping ครบแล้ว');
      refreshDevices();
    } catch {
      setMonitorResult('สั่ง ping ไม่สำเร็จ — ไม่มีสิทธิ์หรือยังไม่ได้เข้าสู่ระบบ');
    }
  };

  // ---------- login / logout ----------
  const refreshAuth = () =>
    getAuthState()
      .then((a) => {
        setAuthState(a);
        getAdminMode().then((m) => setAuthRequired(m.required)).catch(() => {});
      })
      .catch(() => {});

  const onSession = (token: string, user: AuthUser) => {
    setAuthToken(token);
    setAuthState((a) => ({ ...a, user, needsSetup: false, setupNeedsSecret: false, open: false }));
    setLoginOpen(null);
    setPwOpen(false);
    showToast(`สวัสดี ${user.display_name}`, false);
    refreshAuth();
  };

  const logout = () => {
    setAuthToken(null);
    setAuthState((a) => ({ ...a, user: null }));
    setMode('view');
    setPlacingId(null);
    setUndoStack([]); // ประวัติเลิกทำผูกกับคนที่ทำ
    if (page === 'settings') setPage('map');
    showToast('ออกจากระบบแล้ว', false);
    refreshAuth();
  };

  // server ตอบ 401 ขณะ login อยู่ = token หมดอายุ / ถูกปิดบัญชี / เปลี่ยนรหัสจากที่อื่น
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setAuthState((a) => ({ ...a, user: null }));
      setMode('view');
      setLoginOpen({ reason: 'เซสชันหมดอายุหรือบัญชีถูกเปลี่ยนแปลง — กรุณาเข้าสู่ระบบใหม่' });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const authInfo: AuthInfo = {
    user: authState.user,
    open: authState.open,
    needsSetup: authState.needsSetup,
    canEdit: !!authState.user || authState.open,
    isAdmin: authState.user?.role === 'admin' || authState.open,
    requestLogin: () => setLoginOpen({}),
  };

  return (
    <AuthContext.Provider value={authInfo}>
    <CatalogContext.Provider value={catalog}>
    <div className="cctv-app">
      <TopBar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage((p) => (p === 'table' ? p : 'map'));
          setPanelOpen(true);
        }}
        mapName={activeMap?.map_name || ''}
        onOpenSettings={() => {
          setPage('settings');
        }}
        userMenu={<UserMenu onLogout={logout} onChangePassword={() => setPwOpen(true)} />}
      />
      <Rail
        panelOpen={panelOpen}
        onPanel={openPanel}
        onOpenTable={() => togglePage('table')}
        onOpenLogs={() => togglePage('logs')}
        onOpenIpTable={() => togglePage('iptable')}
        page={page}
        onOpenDashboard={() => togglePage('dashboard')}
        onOpenSettings={() => togglePage('settings')}
      />
      <main className="main-area">
        {page === 'dashboard' ? (
          <DashboardPage devices={devices} monitor={monitorStatus} onClose={() => setPage('map')} onSelect={openDevice} />
        ) : page === 'iptable' ? (
          <IpTablePage devices={devices} secret={secret} onFocusDevice={focusDevice} onClose={() => setPage('map')} />
        ) : page === 'settings' ? (
          <SettingsPage
            onClose={() => setPage('map')}
            secret={secret}
            authRequired={authRequired}
            onSecret={setSecret}
            onCheckAdmin={handleCheckAdmin}
            adminResult={adminResult}
            monitorForm={monitorForm}
            onMonitorForm={setMonitorForm}
            onSaveMonitor={handleSaveMonitor}
            onRunMonitor={handleRunMonitor}
            monitorResult={monitorResult}
            ipAuto={ipAuto}
            onIpAuto={handleSaveIpAuto}
            onOpenCatalog={() => setModal('catalog')}
            onImported={() => {
              refreshMaps();
              refreshDevices();
              getCatalog().then(setCatalog).catch(() => {});
            }}
          />
        ) : page === 'logs' ? (
          <LogsPage onClose={() => setPage('map')} />
        ) : page === 'table' ? (
          <DeviceTablePage
            devices={filtered}
            totalAll={devices.length}
            filtered={!!(search.trim() || statusFilter || typeFilter || zoneFilter)}
            onClose={() => setPage('map')}
            onSelect={openDevice}
            onPlace={startPlacing}
          />
        ) : (
        <>
        <SlidePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          devices={filtered}
          totalAll={devices.length}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          zoneFilter={zoneFilter}
          onZoneFilter={setZoneFilter}
          zones={zones}
          selectedId={selected?.id || null}
          onSelect={openDevice}
          maps={maps}
          activeMapId={activeMapId}
          onSelectMap={setActiveMapId}
          onUploadMap={handleUploadMap}
          onRenameMap={handleRenameMap}
          onDeleteMap={handleDeleteMap}
          authRequired={authRequired}
          onPlace={startPlacing}
        />
        <Viewer
          map={activeMap}
          devices={visibleOnMap}
          mode={mode}
          selectedId={selected?.id || null}
          onViewChange={setZoom}
          onSelect={openDevice}
          onConfirmPlace={handleConfirmPlace}
          onPreviewMove={handlePreviewMove}
          onCommitMove={handleCommitMove}
          onCommitRotate={handleCommitRotate}
          onMode={changeMode}
          onCancelEdit={cancelEdit}
          editCount={editCount}
          placing={placingDevice}
          onConfirmPlaceExisting={handleConfirmPlaceExisting}
          focus={focus}
        />
        </>
        )}
      </main>
      {toast && (
        <div className={'undo-toast' + (toast.error ? ' error' : '')} role="status">
          <span>{toast.text}</span>
          {toast.canUndo && undoStack.length > 0 && (
            <button className="undo-btn" onClick={undoLast} title="เลิกทำ (Ctrl+Z)">
              <Undo2 size={14} /> เลิกทำ
            </button>
          )}
          <button className="undo-close" onClick={() => setToast(null)} title="ปิด">
            <X size={14} />
          </button>
        </div>
      )}
      <BottomBar
        connected={connected}
        deviceCount={devices.length}
        mapName={activeMap?.map_name || ''}
        mode={mode}
        zoom={zoom}
        monitor={monitorStatus}
      />
      {modal === 'catalog' && (
        <CatalogModal
          catalog={catalog}
          devices={devices}
          secret={secret}
          onSaved={(c) => {
            setCatalog(c);
            refreshDevices();
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'device' && selected && (
        <DeviceModal
          key={selected.id}
          device={selected}
          maps={maps}
          onClose={() => {
            setModal(null);
            setSelected(null);
          }}
          onSave={handleSaveDevice}
          onDelete={handleDeleteDevice}
          onPing={handlePing}
          onPlace={() => startPlacing(selected)}
          error={modalError}
        />
      )}
      {loginOpen && (
        <LoginModal
          needsSetup={authState.needsSetup}
          setupNeedsSecret={authState.setupNeedsSecret}
          reason={loginOpen.reason}
          onDone={onSession}
          onClose={() => setLoginOpen(null)}
        />
      )}
      {pwOpen && <ChangePasswordModal onDone={onSession} onClose={() => setPwOpen(false)} />}
    </div>
    </CatalogContext.Provider>
    </AuthContext.Provider>
  );
}
