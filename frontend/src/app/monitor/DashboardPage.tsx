import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { formatAgo } from '../types/monitor';
import type { CatalogItem, Device, LogEntry, MonitorStatus } from '../types/monitor';
import { getEventStats, getLogs, type EventStats } from '../utils/monitorClient';
import { ColumnChart, type ColumnDatum } from './DashboardCharts';
import { CatalogIcon, StatusPill, ZoneTag, findStatus, findType, findZone, useCatalog } from './catalog';

interface DashboardPageProps {
  devices: Device[];
  monitor: MonitorStatus | null;
  onClose: () => void;
  onSelect: (d: Device) => void;
}

interface Bucket {
  item: CatalogItem;
  total: number;
  problem: number;
}

const RANGES = [7, 14, 30] as const;
const RANGE_KEY = 'monitoring-device:dash-range';

const LATENCY_BINS: { label: string; min: number; max: number }[] = [
  { label: '<10', min: 0, max: 10 },
  { label: '10–50', min: 10, max: 50 },
  { label: '50–100', min: 50, max: 100 },
  { label: '100–200', min: 100, max: 200 },
  { label: '200–500', min: 200, max: 500 },
  { label: '500+', min: 500, max: Infinity },
];

/** เติมวันที่ไม่มีเหตุการณ์ให้ครบช่วง (วันที่ YYYY-MM-DD ตามเวลาไทยจาก backend) */
function dailySeries(stats: EventStats): ColumnDatum[] {
  const map = new Map(stats.daily.map((d) => [d.date, d]));
  const end = new Date(`${stats.today}T00:00:00Z`);
  const every = stats.days <= 7 ? 1 : stats.days <= 14 ? 2 : 5;
  const out: ColumnDatum[] = [];
  for (let i = stats.days - 1; i >= 0; i--) {
    const dt = new Date(end.getTime() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    const row = map.get(key);
    const down = row?.down || 0;
    const up = row?.up || 0;
    const nice = dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    out.push({
      key,
      label: i % every === 0 ? `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}` : '',
      value: down,
      tip: [i === 0 ? `${nice} (วันนี้)` : nice, `Offline ${down} ครั้ง`, `กลับมา Online ${up} ครั้ง`],
    });
  }
  return out;
}

const isProblem = (d: Device) => d.status === 'offline' || d.status === 'warning';

/** นับจำนวนอุปกรณ์ตาม key (ประเภท / โซน) เรียงจากมากไปน้อย */
function groupBy(devices: Device[], keyOf: (d: Device) => string, itemOf: (k: string) => CatalogItem): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const d of devices) {
    const k = keyOf(d);
    const b = m.get(k) || { item: itemOf(k), total: 0, problem: 0 };
    b.total++;
    if (isProblem(d)) b.problem++;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

function BarList({ rows, max }: { rows: Bucket[]; max: number }) {
  if (rows.length === 0) return <div className="dash-empty">ยังไม่มีข้อมูล</div>;
  return (
    <div className="dash-bars">
      {rows.map((r) => (
        <div key={r.item.key || '_'} className="dash-bar-row">
          <span className="dash-bar-label" title={r.item.label}>
            {r.item.icon ? <CatalogIcon icon={r.item.icon} size={13} className="inline-ico" /> : null}
            {r.item.label}
          </span>
          <span className="dash-bar-track">
            <span className="dash-bar-fill" style={{ width: `${(r.total / max) * 100}%` }} />
            {r.problem > 0 && (
              <span className="dash-bar-fill bad" style={{ width: `${(r.problem / max) * 100}%` }} />
            )}
          </span>
          <span className="dash-bar-num mono">
            {r.total}
            {r.problem > 0 && <em> / {r.problem} มีปัญหา</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage({ devices, monitor, onClose, onSelect }: DashboardPageProps) {
  const catalog = useCatalog();
  const [events, setEvents] = useState<LogEntry[]>([]);

  useEffect(() => {
    getLogs(200)
      .then((rows) => setEvents(rows.filter((l) => l.action === 'down' || l.action === 'up').slice(0, 12)))
      .catch(() => setEvents([]));
  }, []);

  // ช่วงเวลาของกราฟเหตุการณ์ (จำไว้ในเบราว์เซอร์)
  const [range, setRangeState] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(RANGE_KEY));
      return (RANGES as readonly number[]).includes(v) ? v : 14;
    } catch {
      return 14;
    }
  });
  const setRange = (v: number) => {
    setRangeState(v);
    try {
      localStorage.setItem(RANGE_KEY, String(v));
    } catch {
      /* storage ใช้ไม่ได้ */
    }
  };
  const [eventStats, setEventStats] = useState<EventStats | null>(null);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getEventStats(range)
        .then((s) => {
          if (!alive) return;
          setEventStats(s);
          setStatsError(false);
        })
        .catch(() => {
          if (alive) setStatsError(true);
        });
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [range]);

  const stats = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const d of devices) byStatus.set(d.status, (byStatus.get(d.status) || 0) + 1);
    const latencies = devices
      .filter((d) => d.status === 'online' && d.last_latency_ms != null)
      .map((d) => d.last_latency_ms as number);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    const pausedKeys = new Set(catalog.statuses.filter((s) => s.pause_monitor).map((s) => s.key));
    const monitored = devices.filter((d) => !pausedKeys.has(d.status) && d.ip_address);
    const onlineCount = byStatus.get('online') || 0;
    const uptime = monitored.length ? Math.round((onlineCount / monitored.length) * 1000) / 10 : null;
    // ลำดับสถานะตามที่ตั้งในรายการ แล้วต่อด้วยสถานะที่ไม่อยู่ในรายการ
    const order = [...catalog.statuses.map((s) => s.key), ...[...byStatus.keys()].filter((k) => !catalog.statuses.some((s) => s.key === k))];
    const statusRows = order
      .filter((k) => byStatus.get(k))
      .map((k) => ({ item: findStatus(catalog, k), count: byStatus.get(k) as number }));
    return { byStatus, avgLatency, uptime, statusRows, paused: devices.length - monitored.length };
  }, [devices, catalog]);

  const byType = useMemo(() => groupBy(devices, (d) => d.device_type, (k) => findType(catalog, k)), [devices, catalog]);
  const byZone = useMemo(
    () =>
      groupBy(
        devices,
        (d) => d.zone || '',
        (k) => findZone(catalog, k) || { key: '', label: 'ไม่ระบุโซน', icon: '', color: '#94a3b8' }
      ),
    [devices, catalog]
  );
  const problems = useMemo(
    () =>
      devices
        .filter(isProblem)
        .sort((a, b) => (a.status === b.status ? (a.last_seen || '').localeCompare(b.last_seen || '') : a.status === 'offline' ? -1 : 1)),
    [devices]
  );

  const offlineColor = findStatus(catalog, 'offline').color || '#dc2626';
  const daily = useMemo(() => (eventStats ? dailySeries(eventStats) : []), [eventStats]);
  const totalDown = daily.reduce((a, d) => a + d.value, 0);

  const latencyBins = useMemo<ColumnDatum[]>(() => {
    const vals = devices
      .filter((d) => (d.status === 'online' || d.status === 'warning') && d.last_latency_ms != null)
      .map((d) => d.last_latency_ms as number);
    return LATENCY_BINS.map((b) => {
      const n = vals.filter((v) => v >= b.min && v < b.max).length;
      return {
        key: b.label,
        label: b.label,
        value: n,
        tip: [`${b.label} ms`, `${n} อุปกรณ์${vals.length ? ` (${Math.round((n / vals.length) * 100)}%)` : ''}`],
      };
    });
  }, [devices]);

  const topDown = eventStats?.top || [];
  const topMax = topDown[0]?.down || 1;

  const total = devices.length;
  const tiles = [
    { label: 'อุปกรณ์ทั้งหมด', value: total, color: '#2563eb' },
    { label: 'Online', value: stats.byStatus.get('online') || 0, color: findStatus(catalog, 'online').color },
    { label: 'Offline', value: stats.byStatus.get('offline') || 0, color: findStatus(catalog, 'offline').color },
    { label: 'Warning', value: stats.byStatus.get('warning') || 0, color: findStatus(catalog, 'warning').color },
    { label: 'Uptime', value: stats.uptime != null ? `${stats.uptime}%` : '—', color: '#0f172a' },
    { label: 'Latency เฉลี่ย', value: stats.avgLatency != null ? `${stats.avgLatency} ms` : '—', color: '#0f172a' },
  ];

  return (
    <div className="dash-page">
      <div className="dash-inner">
        <h2 className="dash-head">
          Dashboard
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="dash-sub">
              {monitor
                ? monitor.enabled
                  ? `Monitor ทำงาน · ทุก ${monitor.intervalSec} วิ. · รอบล่าสุด ${formatAgo(monitor.lastRunAt)}`
                  : 'Monitor ปิดอยู่'
                : ''}
            </span>
            <button className="btn btn-dark btn-sm dash-back" onClick={onClose} title="กลับไปที่แผนผัง">
              <MapIcon size={14} /> กลับไปแผนผัง
            </button>
          </span>
        </h2>

        <div className="dash-tiles">
          {tiles.map((t) => (
            <div key={t.label} className="dash-tile">
              <div className="dash-tile-label">{t.label}</div>
              <div className="dash-tile-value mono" style={{ color: t.color }}>
                {t.value}
              </div>
            </div>
          ))}
        </div>

        {total > 0 && (
          <div className="dash-card">
            <div className="dash-card-title">สัดส่วนสถานะ</div>
            <div className="dash-stack">
              {stats.statusRows.map((r) => (
                <span
                  key={r.item.key}
                  title={`${r.item.label}: ${r.count}`}
                  style={{ width: `${(r.count / total) * 100}%`, background: r.item.color }}
                />
              ))}
            </div>
            <div className="dash-legend">
              {stats.statusRows.map((r) => (
                <span key={r.item.key}>
                  <i style={{ background: r.item.color }} />
                  {r.item.label} <b className="mono">{r.count}</b>
                  <small> ({Math.round((r.count / total) * 100)}%)</small>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="dash-card dash-chart-card">
          <div className="dash-card-head">
            <div>
              <div className="dash-card-title">เหตุการณ์ Offline รายวัน</div>
              <div className="dash-card-sub">
                {eventStats ? `รวม ${totalDown} ครั้งใน ${range} วันที่ผ่านมา` : statsError ? 'โหลดสถิติไม่ได้' : 'กำลังโหลด...'}
              </div>
            </div>
            <div className="dash-seg" role="group" aria-label="ช่วงเวลา">
              {RANGES.map((r) => (
                <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>
                  {r} วัน
                </button>
              ))}
            </div>
          </div>
          {eventStats && <ColumnChart data={daily} color={offlineColor} unit="เหตุการณ์ Offline" />}
        </div>

        <div className="dash-grid">
          <div className="dash-card">
            <div className="dash-card-title">อุปกรณ์ที่หลุดบ่อยที่สุด ({range} วัน)</div>
            {topDown.length === 0 ? (
              <div className="dash-empty">{eventStats ? 'ไม่มีอุปกรณ์หลุดในช่วงนี้ 🎉' : '—'}</div>
            ) : (
              <div className="dash-bars">
                {topDown.map((t) => {
                  const dev = devices.find((d) => d.id === t.device_id);
                  return (
                    <div
                      key={t.device_id || t.device_name}
                      className={'dash-bar-row' + (dev ? ' clickable' : '')}
                      onClick={dev ? () => onSelect(dev) : undefined}
                      title={dev ? 'คลิกเพื่อดูรายละเอียด' : 'อุปกรณ์นี้ถูกลบไปแล้ว'}
                    >
                      <span className="dash-bar-label">{t.device_name}</span>
                      <span className="dash-bar-track">
                        <span className="dash-bar-fill" style={{ width: `${(t.down / topMax) * 100}%`, background: offlineColor }} />
                      </span>
                      <span className="dash-bar-num mono">{t.down} ครั้ง</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="dash-card">
            <div className="dash-card-title">การกระจาย Latency (ms)</div>
            <div className="dash-card-sub" style={{ marginTop: -8, marginBottom: 4 }}>ค่าล่าสุดของอุปกรณ์ที่ตอบ ping</div>
            <ColumnChart data={latencyBins} color="#2563eb" unit="ข้อมูล Latency" />
          </div>
        </div>

        <div className="dash-grid">
          <div className="dash-card">
            <div className="dash-card-title">ตามประเภท</div>
            <BarList rows={byType} max={byType[0]?.total || 1} />
          </div>
          <div className="dash-card">
            <div className="dash-card-title">ตามโซน</div>
            <BarList rows={byZone} max={byZone[0]?.total || 1} />
          </div>
        </div>

        <div className="dash-grid">
          <div className="dash-card">
            <div className="dash-card-title">อุปกรณ์ที่มีปัญหา ({problems.length})</div>
            {problems.length === 0 ? (
              <div className="dash-empty">ไม่มีอุปกรณ์ที่มีปัญหา 🎉</div>
            ) : (
              <div className="dash-list">
                <table className="cctv-table">
                  <tbody>
                    {problems.map((d) => (
                      <tr key={d.id} onClick={() => onSelect(d)} style={{ cursor: 'pointer' }}>
                        <td>
                          <StatusPill status={d.status} />
                        </td>
                        <td>{d.name}</td>
                        <td className="mono">{d.ip_address || '—'}</td>
                        <td>
                          <ZoneTag zone={d.zone} />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatAgo(d.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="dash-card">
            <div className="dash-card-title">เหตุการณ์ล่าสุด (Online / Offline)</div>
            {events.length === 0 ? (
              <div className="dash-empty">ยังไม่มีเหตุการณ์</div>
            ) : (
              <div className="dash-list">
                <table className="cctv-table">
                  <tbody>
                    {events.map((l) => (
                      <tr key={l.id}>
                        <td>{l.action === 'down' ? '🔴' : '🟢'}</td>
                        <td>{l.device_name || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatAgo(l.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
