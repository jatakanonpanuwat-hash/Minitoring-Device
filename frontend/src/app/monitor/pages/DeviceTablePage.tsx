import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Archive, Camera, ChevronDown, ChevronUp, Download, LayoutGrid, List, MapPin, MapPinOff, Map as MapIcon, Network, Plus, X } from 'lucide-react';
import { confirmDialog } from '../../components/ui/confirm';
import { cn } from '../../components/ui/utils';
import { formatAgo, needsPlacement } from '../../types/monitor';
import type { Device, DeviceSnapshot, DeviceSnapshotYearsInfo } from '../../types/monitor';
import { getDeviceSnapshot, getDeviceSnapshotYears, saveDeviceSnapshot } from '../../utils/monitorClient';
import { ExportCsvDialog } from '../devices/ExportCsvDialog';
import { useAuth } from '../shared/auth';
import { CatalogIcon, StatusPill, ZoneTag, findStatus, findType, findZone, useCatalog } from '../shared/catalog';

interface DeviceTablePageProps {
  devices: Device[];
  totalAll: number;
  filtered: boolean;
  secret: string;
  onClose: () => void;
  onSelect: (d: Device) => void;
  /** ไปวางอุปกรณ์ที่ยังไม่มีตำแหน่งบนแผนผัง */
  onPlace: (d: Device) => void;
  /** เปิดฟอร์มเพิ่มอุปกรณ์ (ไม่ต้องคลิกบนแผนผัง) */
  onAdd: () => void;
}

type View = 'card' | 'list';
type GroupBy = 'lan' | 'type' | 'zone' | 'cabinet';
const VIEW_KEY = 'device-table-view';
const GROUP_KEY = 'device-table-group';

// จำมุมมองที่เลือกไว้ในเบราว์เซอร์ (ถ้า localStorage ใช้ไม่ได้ก็ใช้ค่าเริ่มต้น)
function loadPref<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

// สถานะหลักที่แสดงเป็นตัวเลขสรุป (ตรงกับ BUILTIN_KEYS ฝั่ง backend)
const SUMMARY_STATUSES = ['online', 'offline', 'warning', 'maintenance'];

/** สีขอบบนของการ์ด: แดงถ้ามี offline, เหลืองถ้ามี warning, เขียวถ้าออนไลน์ทั้งหมด */
function healthOf(list: Device[]): 'bad' | 'warn' | 'ok' | 'idle' {
  if (list.some((d) => d.status === 'offline')) return 'bad';
  if (list.some((d) => d.status === 'warning')) return 'warn';
  if (list.length && list.every((d) => d.status === 'online')) return 'ok';
  return 'idle';
}

function latencyClass(ms: number | null | undefined): string {
  if (ms == null) return 'lat none';
  if (ms < 50) return 'lat good';
  if (ms < 200) return 'lat mid';
  return 'lat slow';
}

export function DeviceTablePage({ devices: all, totalAll, filtered, secret, onClose, onSelect, onAdd }: DeviceTablePageProps) {
  const catalog = useCatalog();
  const { user, isAdmin, canEdit, requestLogin } = useAuth();
  // ยังไม่วาง = ไม่มีตำแหน่ง และไม่ได้ตั้ง "ไม่แสดงบนแผนผัง"
  const isUnplaced = needsPlacement;

  // สแนปช็อตรายปี — snapYear == null คือข้อมูลสดปัจจุบัน, ไม่ null คือดูย้อนหลังแบบอ่านอย่างเดียว
  const [snapInfo, setSnapInfo] = useState<DeviceSnapshotYearsInfo | null>(null);
  const [snapYear, setSnapYear] = useState<number | null>(null);
  const [snap, setSnap] = useState<DeviceSnapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState('');
  const [snapNotice, setSnapNotice] = useState('');
  const isSnapshot = snapYear != null;

  const loadSnapYears = useCallback(async () => {
    try {
      setSnapInfo(await getDeviceSnapshotYears());
    } catch {
      /* backend เก่า / โหลดไม่ได้ — ซ่อนตัวเลือกปีไว้ */
      setSnapInfo(null);
    }
  }, []);

  useEffect(() => {
    loadSnapYears();
  }, [loadSnapYears]);

  useEffect(() => {
    if (snapYear == null) {
      setSnap(null);
      setSnapError('');
      return;
    }
    let cancelled = false;
    setSnapLoading(true);
    setSnapError('');
    getDeviceSnapshot(snapYear)
      .then((s) => {
        if (!cancelled) setSnap(s);
      })
      .catch((e) => {
        if (!cancelled) {
          setSnap(null);
          setSnapError((e as Error).message || `โหลดสแนปช็อตปี ${snapYear} ไม่ได้`);
        }
      })
      .finally(() => {
        if (!cancelled) setSnapLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapYear]);

  const flashSnap = (t: string) => {
    setSnapNotice(t);
    setTimeout(() => setSnapNotice(''), 3000);
  };

  // ตัวกรองภายในหน้า (นอกเหนือจากตัวกรองบน TopBar)
  const [onlyUnplaced, setOnlyUnplaced] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const [view, setViewState] = useState<View>(() => loadPref<View>(VIEW_KEY, ['card', 'list'], 'card'));
  const [groupBy, setGroupByState] = useState<GroupBy>(() => loadPref<GroupBy>(GROUP_KEY, ['lan', 'type', 'zone', 'cabinet'], 'lan'));
  // การ์ดที่ถูกย่อไว้ (key ของกลุ่ม) — ล้างเมื่อเปลี่ยนวิธีจัดกลุ่มเพราะ key คนละชุดกัน
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const setView = (v: View) => {
    setViewState(v);
    savePref(VIEW_KEY, v);
  };
  const setGroupBy = (g: GroupBy) => {
    setGroupByState(g);
    setGroupFilter(null);
    setCollapsed(new Set());
    savePref(GROUP_KEY, g);
  };
  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // แหล่งข้อมูลที่แสดง: โหมดย้อนหลังใช้สแนปช็อตของปีนั้น (ตัวกรอง TopBar ไม่มีผล), โหมดปกติใช้ข้อมูลสด
  const base = isSnapshot ? (snap?.devices ?? []) : all;

  const switchYear = (y: number | null) => {
    setSnapYear(y);
    setGroupFilter(null);
    setCollapsed(new Set());
  };

  const handleSaveSnapshot = async () => {
    if (!isAdmin) {
      requestLogin();
      return;
    }
    const year = snapInfo?.current ?? new Date().getFullYear();
    const existing = snapInfo?.years.find((y) => y.year === year);
    if (!(await confirmDialog({
      title: 'บันทึกสแนปช็อต',
      message: existing
        ? `มีสแนปช็อตปี ${year} อยู่แล้ว (${existing.count} เครื่อง) — บันทึกทับด้วยข้อมูลปัจจุบัน?`
        : `บันทึกภาพรายการอุปกรณ์ปัจจุบันเก็บเป็นของปี ${year}?`,
      confirmLabel: 'บันทึก',
      danger: !!existing,
    }))) return;
    try {
      const r = await saveDeviceSnapshot(year, secret);
      await loadSnapYears();
      flashSnap(`บันทึกสแนปช็อตปี ${r.year} แล้ว (${r.count} เครื่อง)`);
    } catch (e) {
      setSnapError((e as Error).message || 'บันทึกสแนปช็อตไม่สำเร็จ');
    }
  };

  const unplacedCount = base.filter(isUnplaced).length;
  const statusCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of base) m.set(d.status, (m.get(d.status) || 0) + 1);
    return m;
  }, [base]);

  const devices = useMemo(
    () => base.filter((d) => (!onlyUnplaced || needsPlacement(d)) && (!statusFilter || d.status === statusFilter)),
    [base, onlyUnplaced, statusFilter],
  );

  // จัดกลุ่มสำหรับมุมมอง Card — เรียงอัตโนมัติตามจำนวนอุปกรณ์มากสุดก่อน, กลุ่ม "ไม่ระบุ" อยู่ท้ายสุด
  const groups = useMemo(() => {
    const keyOf = (d: Device) =>
      (groupBy === 'lan' ? d.lan?.trim() : groupBy === 'type' ? d.device_type : groupBy === 'zone' ? d.zone : d.cabinet) || '';
    const map = new Map<string, Device[]>();
    for (const d of devices) {
      const k = keyOf(d);
      const list = map.get(k);
      if (list) list.push(d);
      else map.set(k, [d]);
    }
    const items = groupBy === 'type' ? catalog.types : groupBy === 'zone' ? catalog.zones : null;
    const order = (k: string) => {
      if (!k) return Number.MAX_SAFE_INTEGER;
      const i = items ? items.findIndex((it) => it.key === k) : -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
    };
    return [...map.entries()]
      .sort(([a, listA], [b, listB]) => {
        // กลุ่ม "ไม่ระบุ" (key ว่าง) อยู่ท้ายสุดเสมอ
        if (!a && b) return 1;
        if (a && !b) return -1;
        // การ์ดที่มีอุปกรณ์เยอะสุดขึ้นก่อน, เท่ากันใช้ลำดับเดิม (catalog แล้วตามชื่อ)
        if (listB.length !== listA.length) return listB.length - listA.length;
        return order(a) - order(b) || byName(a, b);
      })
      .map(([key, list]) => ({ key, list: [...list].sort((x, y) => byName(x.name, y.name)) }));
  }, [devices, groupBy, catalog]);

  const shownGroups = groupFilter == null ? groups : groups.filter((g) => g.key === groupFilter);
  // มุมมอง List ใช้ตัวกรองกลุ่มเดียวกัน — กรองแถวตามกลุ่มที่เลือก
  const listRows = useMemo(() => {
    if (groupFilter == null) return devices;
    const keyOf = (d: Device) =>
      (groupBy === 'lan' ? d.lan?.trim() : groupBy === 'type' ? d.device_type : groupBy === 'zone' ? d.zone : d.cabinet) || '';
    return devices.filter((d) => keyOf(d) === groupFilter);
  }, [devices, groupFilter, groupBy]);
  const shownCount = view === 'card' ? shownGroups.reduce((n, g) => n + g.list.length, 0) : listRows.length;

  // ย่อ/ขยายการ์ดทั้งหมด (ทุกกลุ่มที่ตรงตัวกรองปัจจุบัน)
  const collapseAll = () => setCollapsed(new Set(groups.map((g) => g.key)));
  const expandAll = () => setCollapsed(new Set());
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));
  const noneCollapsed = groups.every((g) => !collapsed.has(g.key));

  const groupHead = (key: string): { title: string; icon: ReactNode; color?: string } => {
    if (groupBy === 'lan') return { title: key || '(ไม่ระบุวง LAN)', icon: <Network size={18} /> };
    if (groupBy === 'type') {
      const t = findType(catalog, key);
      return { title: key ? t.label : '(ไม่ระบุประเภท)', icon: <CatalogIcon icon={key ? t.icon : 'lucide:Box'} size={18} /> };
    }
    if (groupBy === 'zone') {
      const z = findZone(catalog, key);
      return {
        title: z ? z.label : '(ไม่ระบุโซน)',
        icon: z?.icon ? <CatalogIcon icon={z.icon} size={18} /> : <MapPin size={18} />,
        color: z?.color,
      };
    }
    return { title: key || '(ไม่ระบุตู้)', icon: <Archive size={18} /> };
  };

  const hasLocalFilter = onlyUnplaced || !!statusFilter || groupFilter != null;
  const clearLocal = () => {
    setOnlyUnplaced(false);
    setStatusFilter('');
    setGroupFilter(null);
  };
  const emptyText = hasLocalFilter ? 'ไม่พบอุปกรณ์ตามเงื่อนไข' : 'ยังไม่มีอุปกรณ์';
  const groupLabel = { lan: 'วง LAN', type: 'ประเภท', zone: 'โซน', cabinet: 'ตู้' }[groupBy];

  return (
    <div className="dash-page">
      <div className="dash-inner">
        <h2 className="dash-head">
          <span>
            รายการอุปกรณ์
            {isSnapshot && snapYear != null && <span className="ip-year-badge" style={{ marginLeft: 8 }}>ย้อนหลังปี {snapYear}</span>}
            <span className="dash-sub">
              {' '}
              {isSnapshot ? (
                <>· แสดง {shownCount} จาก {base.length} (สแนปช็อตปี {snapYear} · อ่านอย่างเดียว)</>
              ) : (
                <>· แสดง {shownCount} จาก {filtered ? `${all.length} (ทั้งหมด ${totalAll})` : all.length}
                {filtered && ' · กรองตามคำค้น / ตัวกรองบน TopBar'}</>
              )}
            </span>
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {snapInfo && (snapInfo.years.length > 0 || isSnapshot) && (
              <select
                value={snapYear ?? ''}
                onChange={(e) => switchYear(e.target.value === '' ? null : Number(e.target.value))}
                title="เลือกปีข้อมูล"
                style={{ fontSize: 12, padding: '5px 8px' }}
              >
                <option value="">ปัจจุบัน (ข้อมูลสด)</option>
                {snapInfo.years.map((y) => (
                  <option key={y.year} value={y.year}>
                    ปี {y.year} ({y.count})
                  </option>
                ))}
              </select>
            )}
            {!isSnapshot && (isAdmin || !user) && (
              <button className="btn btn-sm" onClick={handleSaveSnapshot} title={`บันทึกภาพรายการอุปกรณ์ปัจจุบันเก็บเป็นของปี ${snapInfo?.current ?? new Date().getFullYear()}`}>
                <Camera size={14} /> สแนปช็อตปี {snapInfo?.current ?? new Date().getFullYear()}
              </button>
            )}
            {!isSnapshot && canEdit && (
              <button className="btn btn-green btn-sm" onClick={onAdd} title="เพิ่มอุปกรณ์โดยไม่ต้องคลิกบนแผนผัง">
                <Plus size={14} /> เพิ่มอุปกรณ์
              </button>
            )}
            <button className="btn btn-dark btn-sm" onClick={() => setCsvOpen(true)} disabled={base.length === 0} title="เลือกประเภท / โซน / สถานะที่จะส่งออก">
              <Download size={14} /> Export CSV
            </button>
            <button className="btn btn-dark btn-sm dash-back" onClick={onClose} title="กลับไปที่แผนผัง">
              <MapIcon size={14} /> กลับไปแผนผัง
            </button>
          </span>
        </h2>
        {csvOpen && (
          <ExportCsvDialog
            devices={base}
            initial={{
              type: groupBy === 'type' && groupFilter != null ? [groupFilter] : undefined,
              zone: groupBy === 'zone' && groupFilter != null ? [groupFilter] : undefined,
              status: statusFilter ? [statusFilter] : undefined,
            }}
            nameSuffix={isSnapshot && snapYear != null ? `-snap${snapYear}` : ''}
            onClose={() => setCsvOpen(false)}
          />
        )}
        {snapNotice && <div className="notice ok" style={{ marginBottom: 12 }}>{snapNotice}</div>}
        {snapError && <div className="notice error" style={{ marginBottom: 12 }}>{snapError}</div>}
        {isSnapshot && snapLoading && <div className="notice" style={{ marginBottom: 12 }}>กำลังโหลดสแนปช็อตปี {snapYear}...</div>}
        {isSnapshot && !snapLoading && snap && (
          <div className="notice" style={{ marginBottom: 12 }}>
            กำลังดูข้อมูลย้อนหลังปี {snap.year} (อ่านอย่างเดียว — กดที่แถวไม่ได้)
            {' '}· บันทึกเมื่อ {new Date(snap.created_at).toLocaleString('th-TH')}
            {snap.created_by ? ` · โดย ${snap.created_by}` : ''}
          </div>
        )}

        {/* ตัวเลขสรุป — คลิกเพื่อกรอง */}
        <div className="dev-stats">
          <button className={cn('dev-stat', !statusFilter && !onlyUnplaced && 'active')} onClick={() => { setStatusFilter(''); setOnlyUnplaced(false); }}>
            <span className="dev-stat-label">ทั้งหมด</span>
            <span className="dev-stat-value">{base.length}</span>
          </button>
          {SUMMARY_STATUSES.map((k) => {
            const s = findStatus(catalog, k);
            const n = statusCount.get(k) || 0;
            return (
              <button
                key={k}
                className={cn('dev-stat', statusFilter === k && 'active')}
                style={{ '--c': s.color } as CSSProperties}
                onClick={() => setStatusFilter(statusFilter === k ? '' : k)}
                disabled={n === 0 && statusFilter !== k}
              >
                <span className="dev-stat-label">
                  <i className="dot" /> {s.label}
                </span>
                <span className="dev-stat-value">{n}</span>
              </button>
            );
          })}
          <button
            className={cn('dev-stat unplaced', onlyUnplaced && 'active')}
            onClick={() => setOnlyUnplaced(!onlyUnplaced)}
            disabled={unplacedCount === 0 && !onlyUnplaced}
            title="แสดงเฉพาะอุปกรณ์ที่ยังไม่ได้วางบนแผนผัง"
          >
            <span className="dev-stat-label">
              <MapPin size={12} /> ยังไม่วาง
            </span>
            <span className="dev-stat-value">{unplacedCount}</span>
          </button>
        </div>

        <div className="ip-toolbar dev-toolbar">
          <div className="ip-views">
            <button className={cn(view === 'card' && 'active')} onClick={() => setView('card')}>
              <LayoutGrid size={13} /> Card
            </button>
            <button className={cn(view === 'list' && 'active')} onClick={() => setView('list')}>
              <List size={13} /> List
            </button>
          </div>
          <label className="dev-group-by">
            จัดกลุ่มตาม
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="lan">วง LAN</option>
              <option value="type">ประเภท</option>
              <option value="zone">โซน</option>
              <option value="cabinet">ตู้</option>
            </select>
          </label>
          {groups.length > 1 && (
            <label className="dev-group-by" title={`กรองแสดงเฉพาะบาง${groupLabel}`}>
              แสดง
              <select
                value={groupFilter == null ? '' : String(groups.findIndex((g) => g.key === groupFilter))}
                onChange={(e) => setGroupFilter(e.target.value === '' ? null : groups[Number(e.target.value)].key)}
              >
                <option value="">ทุก{groupLabel} ({devices.length})</option>
                {groups.map(({ key, list }, i) => {
                  const off = list.filter((d) => d.status === 'offline').length;
                  return (
                    <option key={key} value={String(i)}>
                      {groupHead(key).title} ({list.length}{off > 0 ? `, Offline ${off}` : ''})
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          {view === 'card' && (
            <span className="dev-collapse-all">
              <button className="btn btn-sm" onClick={collapseAll} disabled={groups.length === 0 || allCollapsed} title="ย่อการ์ดทุกใบ">
                <ChevronDown size={13} /> ย่อทั้งหมด
              </button>
              <button className="btn btn-sm" onClick={expandAll} disabled={groups.length === 0 || noneCollapsed} title="ขยายการ์ดทุกใบ">
                <ChevronUp size={13} /> ขยายทั้งหมด
              </button>
            </span>
          )}
          <span style={{ flex: 1 }} />
          {hasLocalFilter && (
            <button className="btn btn-sm" onClick={clearLocal}>
              <X size={13} /> ล้างตัวกรอง
            </button>
          )}
        </div>

        {view === 'card' ? (
          shownGroups.length === 0 ? (
            <div className="dash-card dev-empty">{emptyText}</div>
          ) : (
            <div className="nvr-grid device-card-grid">
              {shownGroups.map(({ key, list }) => {
                const h = groupHead(key);
                const hiddenCount = list.filter((d) => d.hide_on_map).length;
                const placedCount = list.filter((d) => d.x_percent != null && d.y_percent != null).length;
                const online = list.filter((d) => d.status === 'online').length;
                const isCollapsed = collapsed.has(key);
                // สัดส่วนสถานะ สำหรับแถบสีใต้หัวการ์ด
                const parts = [...list.reduce((m, d) => m.set(d.status, (m.get(d.status) || 0) + 1), new Map<string, number>())]
                  .sort((a, b) => SUMMARY_STATUSES.indexOf(a[0]) - SUMMARY_STATUSES.indexOf(b[0]));
                return (
                  <section key={key} className={cn('nvr-card dev-card', `health-${healthOf(list)}`, isCollapsed && 'is-collapsed')}>
                    <header
                      className="nvr-card-head dev-card-head"
                      role="button"
                      tabIndex={0}
                      aria-expanded={!isCollapsed}
                      title={isCollapsed ? 'คลิกเพื่อขยาย' : 'คลิกเพื่อย่อ'}
                      onClick={() => toggleCollapsed(key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleCollapsed(key);
                        }
                      }}
                    >
                      <div className="nvr-info">
                        <div className="nvr-icon" style={h.color ? ({ color: h.color } as CSSProperties) : undefined}>
                          {h.icon}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className={cn('nvr-title device-card-title', groupBy === 'lan' && key && 'mono-title')} title={h.title}>
                            {h.title}
                          </div>
                          <div className="nvr-sub">
                            Online {online}/{list.length} • บนแผนผัง {placedCount}/{list.length - hiddenCount}
                            {hiddenCount > 0 && ` • ไม่แสดง ${hiddenCount}`}
                          </div>
                        </div>
                      </div>
                      <span className="dev-card-head-right">
                        <span className="nvr-badge">{list.length} เครื่อง</span>
                        <ChevronDown size={16} className={cn('dev-collapse-ico', isCollapsed && 'collapsed')} aria-hidden />
                      </span>
                    </header>
                    {!isCollapsed && (
                      <>
                    <div className="dev-health-bar" aria-hidden>
                      {parts.map(([st, n]) => (
                        <i key={st} style={{ flex: n, background: findStatus(catalog, st).color }} title={`${findStatus(catalog, st).label}: ${n}`} />
                      ))}
                    </div>
                    <div className="nvr-scroll dev-card-body">
                      <table className="nvr-table">
                        <colgroup>
                          <col style={{ width: 92 }} />
                          <col />
                          <col style={{ width: 118 }} />
                          <col style={{ width: 72 }} />
                          <col style={{ width: 112 }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>STATUS</th>
                            <th>NAME</th>
                            <th>IP</th>
                            <th>LATENCY</th>
                            <th>{groupBy === 'type' ? 'ZONE' : 'TYPE'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((d) => {
                            const t = findType(catalog, d.device_type);
                            return (
                              <tr
                                key={d.id}
                                className={cn('nvr-row', d.status === 'offline' && 'is-offline')}
                                onClick={() => {
                                  if (!isSnapshot) onSelect(d);
                                }}
                                style={isSnapshot ? { cursor: 'default' } : undefined}
                                title={`${d.name} · พบล่าสุด ${formatAgo(d.last_seen)}`}
                              >
                                <td>
                                  <StatusPill status={d.status} />
                                </td>
                                <td className="name">
                                  {d.name}
                                  {isUnplaced(d) && <MapPin size={11} className="device-unplaced-ico" aria-label="ยังไม่วางบนแผนผัง" />}
                                  {d.hide_on_map && (
                                    <span className="device-hidden-ico" title="ไม่แสดงบนแผนผัง">
                                      <MapPinOff size={11} />
                                    </span>
                                  )}
                                </td>
                                <td className="mono">{d.ip_address || <span className="muted">—</span>}</td>
                                <td>
                                  <span className={latencyClass(d.last_latency_ms)}>
                                    {d.last_latency_ms != null ? `${d.last_latency_ms} ms` : '—'}
                                  </span>
                                </td>
                                <td className="name">
                                  {groupBy === 'type' ? (
                                    <ZoneTag zone={d.zone} />
                                  ) : (
                                    <>
                                      <CatalogIcon icon={t.icon} size={13} className="inline-ico" />
                                      {t.label}
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          )
        ) : (
          <div className="dash-card list-page-card">
            <table className="cctv-table list-page-table">
              <thead>
                <tr>
                  <th>สถานะ</th>
                  <th>ชื่อ</th>
                  <th>ประเภท</th>
                  <th>IP</th>
                  <th>Latency</th>
                  <th>พบล่าสุด</th>
                  <th>วง LAN</th>
                  <th>โซน</th>
                  <th>ยี่ห้อ / รุ่น</th>
                  <th>ตู้</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((d) => {
                  const t = findType(catalog, d.device_type);
                  return (
                    <tr
                      key={d.id}
                      onClick={() => {
                        if (!isSnapshot) onSelect(d);
                      }}
                      style={{ cursor: isSnapshot ? 'default' : 'pointer' }}
                    >
                      <td>
                        <StatusPill status={d.status} />
                      </td>
                      <td>{d.name}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <CatalogIcon icon={t.icon} size={14} className="inline-ico" />
                        {t.label}
                      </td>
                      <td className="mono">{d.ip_address || '—'}</td>
                      <td>
                        <span className={latencyClass(d.last_latency_ms)}>{d.last_latency_ms != null ? `${d.last_latency_ms} ms` : '—'}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatAgo(d.last_seen)}</td>
                      <td className="mono">{d.lan || '—'}</td>
                      <td>
                        <ZoneTag zone={d.zone} />
                      </td>
                      <td>{[d.brand, d.model].filter(Boolean).join(' ') || '—'}</td>
                      <td>{d.cabinet || '—'}</td>
                    </tr>
                  );
                })}
                {listRows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                      {emptyText}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
