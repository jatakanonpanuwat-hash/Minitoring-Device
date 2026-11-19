import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Crosshair, Download, Map as MapIcon, Pencil, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../components/ui/utils';
import { useAuth } from './auth';
import type { Device, IpRow, IpUpdate, IpYearsInfo } from '../types/monitor';
import {
  addIpUpdate,
  createIpRow,
  createIpYear,
  deleteIpRow,
  getIpTable,
  getIpUpdates,
  getIpYears,
  updateIpRow,
} from '../utils/monitorClient';

interface IpTablePageProps {
  devices: Device[];
  secret: string;
  onFocusDevice: (d: Device) => void;
  onClose: () => void;
}

type View = 'table' | 'nvr' | 'updates';
type MapFilter = '' | 'exists' | 'missing';
type StatusFilter = '' | 'active' | 'deleted';

const lower = (v: string | null | undefined) => String(v || '').trim().toLowerCase();
const isDeleted = (r: IpRow) => /^deleted/i.test(r.status || '');
const fmtTime = (iso: string) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const errText = (e: unknown) => {
  const m = (e as Error).message || '';
  return /401/.test(m) ? 'ไม่มีสิทธิ์ — กรุณาเข้าสู่ระบบ' : m;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

function downloadCsv(rows: IpRow[], year: number, onMap: (r: IpRow) => boolean) {
  const head = ['No.', 'NVR IP', 'Channel', 'Camera IP', 'Camera Name', 'Control', 'Status', 'บนแผนผัง', 'Remark'];
  const esc = (v: unknown) => {
    let t = String(v ?? '');
    if (/^[=+\-@]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) =>
    [r.row_no, r.nvr_ip, r.channel, r.camera_ip, r.camera_name, r.control, r.status, onMap(r) ? 'มีแล้ว' : 'ยังไม่มี', r.remark].map(esc).join(',')
  );
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `TABLE_IP_${year}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function IpTablePage({ devices, secret, onFocusDevice, onClose }: IpTablePageProps) {
  const { canEdit, requestLogin } = useAuth();
  // ยังไม่ login: กดแถว/ช่อง = ขอให้เข้าสู่ระบบ
  const edit = (r: IpRow | 'new') => (canEdit ? setEditing(r) : requestLogin());
  const [info, setInfo] = useState<IpYearsInfo | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [rows, setRows] = useState<IpRow[]>([]);
  const [updates, setUpdates] = useState<IpUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('table');
  const [q, setQ] = useState('');
  const [nvr, setNvr] = useState('');
  const [mapFilter, setMapFilter] = useState<MapFilter>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [control, setControl] = useState('');
  const [editing, setEditing] = useState<IpRow | 'new' | null>(null);
  const [newYear, setNewYear] = useState<{ year: string; copyFrom: string } | null>(null);
  const [toast, setToast] = useState('');

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 1800);
  };

  const loadYears = useCallback(async () => {
    const i = await getIpYears();
    setInfo(i);
    setYear((y) => y ?? i.current);
    return i;
  }, []);

  const loadYear = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const [t, u] = await Promise.all([getIpTable(y), getIpUpdates(y)]);
      setRows(t.rows);
      setUpdates(u);
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadYears().catch((e) => {
      setError(errText(e));
      setLoading(false);
    });
  }, [loadYears]);

  useEffect(() => {
    if (year != null) loadYear(year);
  }, [year, loadYear]);

  const reload = async () => {
    await loadYears();
    if (year != null) await loadYear(year);
  };

  // IP → อุปกรณ์ (ใช้ดูว่าอยู่บนแผนผังหรือยัง)
  const devByIp = useMemo(() => {
    const m = new Map<string, Device>();
    for (const d of devices) if (d.ip_address) m.set(lower(d.ip_address), d);
    return m;
  }, [devices]);
  const deviceOf = (r: IpRow) => (r.camera_ip ? devByIp.get(lower(r.camera_ip)) : undefined);
  const onMap = (r: IpRow) => {
    const d = deviceOf(r);
    return !!d && d.x_percent != null && !!d.map_id;
  };

  const latestByIp = useMemo(() => {
    const m = new Map<string, IpUpdate>();
    for (const u of updates) {
      const k = lower(u.camera_ip);
      if (k && !m.has(k)) m.set(k, u); // updates เรียงใหม่ → เก่าแล้ว
    }
    return m;
  }, [updates]);

  const nvrs = useMemo(
    () => [...new Set(rows.map((r) => r.nvr_ip || ''))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [rows]
  );
  const controls = useMemo(
    () => [...new Set(rows.map((r) => r.control).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [rows]
  );

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === 'active' && isDeleted(r)) return false;
      if (statusFilter === 'deleted' && !isDeleted(r)) return false;
      if (nvr && (r.nvr_ip || '') !== nvr) return false;
      if (control && r.control !== control) return false;
      if (mapFilter === 'exists' && !onMap(r)) return false;
      if (mapFilter === 'missing' && onMap(r)) return false;
      if (!t) return true;
      return [r.camera_ip, r.camera_name, r.nvr_ip, r.control, r.remark, String(r.channel ?? '')].some((v) => lower(v).includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, nvr, control, mapFilter, statusFilter, devByIp]);

  const summary = useMemo(() => {
    const m = new Map<string, { nvr: string; count: number; min: number; max: number; missing: number }>();
    for (const r of rows) {
      if (isDeleted(r)) continue;
      const k = r.nvr_ip || '';
      const s = m.get(k) || { nvr: k, count: 0, min: Infinity, max: 0, missing: 0 };
      s.count++;
      if (r.channel != null) {
        s.min = Math.min(s.min, r.channel);
        s.max = Math.max(s.max, r.channel);
      }
      if (!onMap(r)) s.missing++;
      m.set(k, s);
    }
    return [...m.values()].sort((a, b) => a.nvr.localeCompare(b.nvr, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, devByIp]);

  const activeCount = rows.filter((r) => !isDeleted(r)).length;
  const missingCount = summary.reduce((n, s) => n + s.missing, 0);

  const focus = (r: IpRow) => {
    const d = deviceOf(r);
    if (d) onFocusDevice(d);
  };

  const remove = async (r: IpRow) => {
    if (!window.confirm(`ลบแถว ${r.camera_ip} (${r.camera_name || '-'}) ออกจากตารางปี ${r.year}?\n(ถ้าต้องการเก็บประวัติ ให้แก้สถานะเป็น DELETED แทน)`)) return;
    try {
      await deleteIpRow(r.id, secret);
      flash('ลบแล้ว');
      reload();
    } catch (e) {
      setError(errText(e));
    }
  };

  const createYear = async () => {
    if (!newYear) return;
    const y = parseInt(newYear.year, 10);
    if (!y) return;
    try {
      const r = await createIpYear(y, newYear.copyFrom ? Number(newYear.copyFrom) : null, secret);
      setNewYear(null);
      await loadYears();
      setYear(r.year);
      flash(`สร้างตารางปี ${r.year} (${r.count} แถว)`);
    } catch (e) {
      setError(errText(e));
    }
  };

  const clearFilters = () => {
    setQ('');
    setNvr('');
    setMapFilter('');
    setStatusFilter('active');
    setControl('');
  };

  return (
    <div className="dash-page ip-page">
      <div className="ip-modal">
        <h2>
          <span className="ip-title">
            IP Management / NVR
            {year != null && <span className="ip-year-badge">TABLE_IP_{year}</span>}
          </span>
          <span className="ip-head-actions">
            <select
              value={year ?? ''}
              onChange={(e) => setYear(Number(e.target.value))}
              title="เลือกปี"
            >
              {info?.years.map((y) => (
                <option key={y.year} value={y.year}>
                  ปี {y.year} ({y.count}){y.year === info.current ? ' • ปัจจุบัน' : ''}
                </option>
              ))}
              {info && info.years.length === 0 && <option value={info.current}>ปี {info.current} (ว่าง)</option>}
            </select>
            {canEdit && <button
              className="btn btn-dark btn-sm"
              onClick={() => setNewYear({ year: String((info?.years[0]?.year ?? new Date().getFullYear()) + 1), copyFrom: String(info?.years[0]?.year ?? '') })}
            >
              <Plus size={14} /> ปีใหม่
            </button>}
<button className="btn btn-dark btn-sm dash-back" onClick={onClose} title="กลับไปที่แผนผัง">
              <MapIcon size={14} /> กลับไปแผนผัง
            </button>
          </span>
        </h2>

        {newYear && (
          <div className="ip-newyear">
            <span>สร้างตารางปี</span>
            <input type="number" value={newYear.year} min={2000} max={2100} onChange={(e) => setNewYear({ ...newYear, year: e.target.value })} />
            <span>คัดลอกจาก</span>
            <select value={newYear.copyFrom} onChange={(e) => setNewYear({ ...newYear, copyFrom: e.target.value })}>
              <option value="">— เริ่มว่าง —</option>
              {info?.years.map((y) => (
                <option key={y.year} value={y.year}>
                  ปี {y.year} ({y.count} แถว)
                </option>
              ))}
            </select>
            <span className="hint">ไม่คัดลอกแถวที่ถูกลบ (DELETED) ตารางปีล่าสุดจะเป็น "ปีปัจจุบัน" ที่ระบบซิงก์กล้องใหม่เข้า</span>
            <button className="btn btn-green btn-sm" onClick={createYear}>
              สร้าง
            </button>
            <button className="btn btn-sm" onClick={() => setNewYear(null)}>
              ยกเลิก
            </button>
          </div>
        )}

        {error && (
          <div className="notice error" onClick={() => setError('')}>
            {error}
          </div>
        )}

        <div className="ip-stats">
          <div>
            <b>{activeCount}</b>
            <span>กล้องในตาราง</span>
          </div>
          <div>
            <b>{summary.length}</b>
            <span>NVR</span>
          </div>
          <div className="ok">
            <b>{activeCount - missingCount}</b>
            <span>บนแผนผังแล้ว</span>
          </div>
          <div className={cn(missingCount > 0 && 'bad')} onClick={() => setMapFilter(mapFilter === 'missing' ? '' : 'missing')} title="คลิกเพื่อกรอง">
            <b>{missingCount}</b>
            <span>ยังไม่มีบนแผนผัง</span>
          </div>
          <div>
            <b>{rows.length - activeCount}</b>
            <span>ลบแล้ว (DELETED)</span>
          </div>
        </div>

        <div className="ip-nvr-chips">
          {summary.map((s) => (
            <button
              key={s.nvr}
              className={cn('ip-chip', nvr === s.nvr && 'active')}
              onClick={() => setNvr(nvr === s.nvr ? '' : s.nvr)}
              title={`ยังไม่มีบนแผนผัง ${s.missing}`}
            >
              <span className="mono">{s.nvr || '(ไม่มี NVR)'}</span>
              <b>{s.count}</b>
              <span className="range">CH {s.min === Infinity ? '-' : `${s.min}–${s.max}`}</span>
              {s.missing > 0 && <span className="miss">{s.missing}</span>}
            </button>
          ))}
        </div>

        <div className="ip-toolbar">
          <div className="ip-views">
            {(['table', 'nvr', 'updates'] as View[]).map((v) => (
              <button key={v} className={cn(view === v && 'active')} onClick={() => setView(v)}>
                {v === 'table' ? 'ตาราง' : v === 'nvr' ? 'ตาม NVR' : `ประวัติอัปเดต (${updates.length})`}
              </button>
            ))}
          </div>
          {view !== 'updates' && (
            <>
              <input className="grow" placeholder="ค้นหา IP, ชื่อกล้อง, NVR, Control..." value={q} onChange={(e) => setQ(e.target.value)} />
              <select value={nvr} onChange={(e) => setNvr(e.target.value)}>
                <option value="">ทุก NVR</option>
                {nvrs.map((n) => (
                  <option key={n} value={n}>
                    {n || '(ไม่มี NVR)'}
                  </option>
                ))}
              </select>
              <select value={mapFilter} onChange={(e) => setMapFilter(e.target.value as MapFilter)}>
                <option value="">บน/ไม่บนแผนผัง</option>
                <option value="exists">✅ บนแผนผังแล้ว</option>
                <option value="missing">❌ ยังไม่มีบนแผนผัง</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="active">ใช้งานอยู่</option>
                <option value="deleted">ลบแล้ว (DELETED)</option>
                <option value="">ทั้งหมด</option>
              </select>
              {controls.length > 0 && (
                <select value={control} onChange={(e) => setControl(e.target.value)}>
                  <option value="">ทุก Control</option>
                  {controls.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn btn-sm" onClick={clearFilters} title="ล้างตัวกรอง">
                ล้าง
              </button>
              <span className="ip-count">{filtered.length} แถว</span>
              <button className="btn btn-dark btn-sm" disabled={!filtered.length || year == null} onClick={() => year != null && downloadCsv(filtered, year, onMap)}>
                <Download size={14} /> CSV
              </button>
              <button className="btn btn-green btn-sm" disabled={year == null} onClick={() => edit('new')}>
                <Plus size={14} /> เพิ่มแถว
              </button>
            </>
          )}
        </div>

        <div className="ip-body">
          {loading ? (
            <p className="hint" style={{ padding: 24, textAlign: 'center' }}>
              กำลังโหลด...
            </p>
          ) : rows.length === 0 && view !== 'updates' ? (
            <div className="viewer-empty" style={{ position: 'static', padding: 40 }}>
              <p>
                ยังไม่มีตาราง IP ปี {year}
                <br />
                กด "ปีใหม่" เพื่อสร้าง หรือนำเข้าจาก Excel ด้วย <span className="mono">npm run import:xlsx</span>
              </p>
            </div>
          ) : view === 'table' ? (
            <table className="cctv-table ip-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>NVR IP</th>
                  <th>CH</th>
                  <th>Camera IP</th>
                  <th>ชื่อกล้อง</th>
                  <th>Control</th>
                  <th>บนแผนผัง</th>
                  <th>สถานะ / อัปเดตล่าสุด</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const d = deviceOf(r);
                  const last = latestByIp.get(lower(r.camera_ip));
                  return (
                    <tr key={r.id} className={cn(isDeleted(r) && 'deleted')}>
                      <td className="mono">{r.row_no ?? '—'}</td>
                      <td className="mono">{r.nvr_ip || '—'}</td>
                      <td className="mono">{r.channel ?? '—'}</td>
                      <td className="mono">
                        <span className="ip-cell">
                          {r.camera_ip}
                          <button className="mini-btn" title="คัดลอก IP" onClick={() => copyText(r.camera_ip || '').then(() => flash(`คัดลอก ${r.camera_ip}`))}>
                            <Copy />
                          </button>
                        </span>
                      </td>
                      <td>
                        {r.camera_name || '—'}
                        {d && d.name !== r.camera_name && <div className="hint">บนแผนผัง: {d.name}</div>}
                      </td>
                      <td>{r.control || '—'}</td>
                      <td>
                        {onMap(r) ? (
                          <button className="ip-onmap ok" title="ไปที่กล้องบนแผนผัง" onClick={() => focus(r)}>
                            <Crosshair size={12} /> มีแล้ว
                          </button>
                        ) : d ? (
                          <span className="ip-onmap warn" title="มีอุปกรณ์ IP นี้ แต่ยังไม่ได้วางบนแผนผัง">ยังไม่วาง</span>
                        ) : (
                          <span className="ip-onmap bad">ยังไม่มี</span>
                        )}
                      </td>
                      <td>
                        {isDeleted(r) && <span className="pill status-pill" style={{ '--c': '#64748b' } as React.CSSProperties}>{r.status}</span>}
                        {!isDeleted(r) && r.status && <span className="ip-status">{r.status}</span>}
                        {last && (
                          <div className="ip-last" title={`${last.detail || ''}\n${fmtTime(last.timestamp)} โดย ${last.updated_by_name || '-'}`}>
                            <b>{last.update_type}</b> {last.detail} <span>· {fmtTime(last.timestamp)}</span>
                          </div>
                        )}
                        {!last && !r.status && '—'}
                      </td>
                      <td className="ip-actions">
                        <button className="mini-btn" title="แก้ไข / บันทึกอัปเดต" onClick={() => edit(r)}>
                          <Pencil />
                        </button>
                        {canEdit && (
                          <button className="mini-btn danger" title="ลบแถว" onClick={() => remove(r)}>
                            <Trash2 />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                      ไม่พบแถวตามเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : view === 'nvr' ? (
            <div className="ip-nvr-view">
              {nvrs
                .filter((n) => filtered.some((r) => (r.nvr_ip || '') === n))
                .map((n) => {
                  const list = filtered.filter((r) => (r.nvr_ip || '') === n);
                  return (
                    <section key={n} className="ip-nvr-card">
                      <header>
                        <span className="mono">{n || '(ไม่มี NVR)'}</span>
                        <span>{list.length} กล้อง</span>
                        <span className="legend">
                          <i className="ok" /> บนแผนผัง <i className="bad" /> ยังไม่มี <i className="del" /> ลบแล้ว
                        </span>
                      </header>
                      <div className="ip-ch-grid">
                        {list.map((r) => (
                          <button
                            key={r.id}
                            className={cn('ip-ch', isDeleted(r) ? 'del' : onMap(r) ? 'ok' : 'bad')}
                            title={`CH ${r.channel ?? '-'} • ${r.camera_ip}\n${r.camera_name || ''}${r.control ? `\nControl ${r.control}` : ''}`}
                            onClick={() => edit(r)}
                          >
                            <b>{r.channel ?? '?'}</b>
                            <span>{r.camera_name || r.camera_ip}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
            </div>
          ) : (
            <table className="cctv-table ip-table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ประเภท</th>
                  <th>Camera IP</th>
                  <th>ชื่อกล้อง</th>
                  <th>NVR / CH</th>
                  <th>รายละเอียด</th>
                  <th>หมายเหตุ</th>
                  <th>โดย</th>
                </tr>
              </thead>
              <tbody>
                {updates.map((u) => (
                  <tr key={u.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {fmtTime(u.timestamp)}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{u.update_type || '—'}</td>
                    <td className="mono">{u.camera_ip || '—'}</td>
                    <td>{u.camera_name || '—'}</td>
                    <td className="mono">
                      {u.nvr_ip || '—'} / {u.channel ?? '—'}
                    </td>
                    <td>{u.detail || '—'}</td>
                    <td>{u.remark || '—'}</td>
                    <td>{u.updated_by_name || u.updated_by_id || '—'}</td>
                  </tr>
                ))}
                {updates.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                      ยังไม่มีประวัติอัปเดตปี {year}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {toast && <div className="ip-toast">{toast}</div>}

        {editing && year != null && info && (
          <IpRowEditor
            row={editing === 'new' ? null : editing}
            year={year}
            nvrs={nvrs.filter(Boolean)}
            rows={rows}
            updateTypes={info.update_types}
            device={editing !== 'new' ? deviceOf(editing) : undefined}
            secret={secret}
            onFocus={editing !== 'new' && onMap(editing) ? () => focus(editing) : undefined}
            onClose={() => setEditing(null)}
            onSaved={(text) => {
              flash(text);
              reload();
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------- แก้แถว + บันทึกอัปเดต ----------
interface IpRowEditorProps {
  row: IpRow | null;
  year: number;
  nvrs: string[];
  rows: IpRow[];
  updateTypes: string[];
  device?: Device;
  secret: string;
  onFocus?: () => void;
  onClose: () => void;
  onSaved: (text: string) => void;
}

const str = (v: string | number | null | undefined) => (v == null ? '' : String(v));

function IpRowEditor({ row, year, nvrs, rows, updateTypes, device, secret, onFocus, onClose, onSaved }: IpRowEditorProps) {
  const [form, setForm] = useState({
    row_no: str(row?.row_no),
    nvr_ip: str(row?.nvr_ip),
    channel: str(row?.channel),
    camera_ip: str(row?.camera_ip),
    camera_name: str(row?.camera_name),
    control: str(row?.control),
    status: str(row?.status),
    remark: str(row?.remark),
  });
  const [note, setNote] = useState({ update_type: '', detail: '', remark: '' });
  const [history, setHistory] = useState<IpUpdate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (row?.camera_ip) getIpUpdates(year, row.camera_ip).then(setHistory).catch(() => {});
  }, [row, year]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  // channel ถัดไปของ NVR ที่เลือก (ช่วยกรอก)
  const suggestedCh = form.nvr_ip
    ? rows.filter((r) => lower(r.nvr_ip) === lower(form.nvr_ip)).reduce((m, r) => Math.max(m, r.channel || 0), 0) + 1
    : null;
  const chTaken =
    form.nvr_ip && form.channel
      ? rows.find((r) => r.id !== row?.id && !isDeleted(r) && lower(r.nvr_ip) === lower(form.nvr_ip) && String(r.channel) === form.channel)
      : undefined;

  const save = async () => {
    if (!form.camera_ip.trim()) {
      setError('ต้องกรอก Camera IP');
      return;
    }
    setBusy(true);
    try {
      const data = {
        row_no: form.row_no ? Number(form.row_no) : null,
        nvr_ip: form.nvr_ip || null,
        channel: form.channel ? Number(form.channel) : null,
        camera_ip: form.camera_ip.trim(),
        camera_name: form.camera_name || null,
        control: form.control || null,
        status: form.status || null,
        remark: form.remark || null,
      };
      if (row) await updateIpRow(row.id, data, secret);
      else await createIpRow(year, data, secret);
      onSaved(row ? 'บันทึกแล้ว' : `เพิ่ม ${data.camera_ip} แล้ว`);
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!row) return;
    if (!note.update_type || !note.detail.trim()) {
      setError('เลือกประเภทอัปเดตและกรอกรายละเอียด');
      return;
    }
    setBusy(true);
    try {
      await addIpUpdate({ row_id: row.id, ...note }, secret);
      setNote({ update_type: '', detail: '', remark: '' });
      setHistory(await getIpUpdates(year, row.camera_ip || ''));
      onSaved('บันทึกอัปเดตแล้ว');
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal ip-editor-backdrop" onClick={onClose}>
      <div className="modal-box ip-editor" onClick={(e) => e.stopPropagation()}>
        <h2>
          {row ? `${row.camera_ip} • ${row.camera_name || ''}` : `เพิ่มแถว TABLE_IP_${year}`}
          <button className="panel-close" onClick={onClose} title="ปิด">
            <X />
          </button>
        </h2>
        {error && <div className="notice error">{error}</div>}
        {device && (
          <p className="hint" style={{ marginBottom: 10 }}>
            อุปกรณ์ที่ใช้ IP นี้: <b>{device.name}</b>
            {onFocus && (
              <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={onFocus}>
                <Crosshair size={12} /> ไปที่กล้องบนแผนผัง
              </button>
            )}
          </p>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>NVR IP</label>
            <input list="ip-nvr-list" value={form.nvr_ip} onChange={set('nvr_ip')} placeholder="192.168.10.201" />
            <datalist id="ip-nvr-list">
              {nvrs.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div className="form-group">
            <label>Channel</label>
            <input type="number" value={form.channel} onChange={set('channel')} placeholder={suggestedCh ? `ว่างถัดไป ${suggestedCh}` : ''} />
            {chTaken && <span className="hint warn-text">CH นี้ใช้แล้ว: {chTaken.camera_ip}</span>}
            {!form.channel && suggestedCh && (
              <span className="hint">
                เว้นว่าง = ใช้ CH {suggestedCh}{' '}
                <button className="link-btn" onClick={() => setForm({ ...form, channel: String(suggestedCh) })}>
                  ใส่เลย
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Camera IP</label>
            <input value={form.camera_ip} onChange={set('camera_ip')} placeholder="192.168.11.10" />
          </div>
          <div className="form-group">
            <label>ชื่อกล้อง</label>
            <input value={form.camera_name} onChange={set('camera_name')} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Control / ตู้</label>
            <input value={form.control} onChange={set('control')} />
          </div>
          <div className="form-group">
            <label>No.</label>
            <input type="number" value={form.row_no} onChange={set('row_no')} placeholder="อัตโนมัติ" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>สถานะ</label>
            <input value={form.status} onChange={set('status')} placeholder="เช่น DELETED - ..." />
          </div>
          <div className="form-group">
            <label>หมายเหตุ</label>
            <input value={form.remark} onChange={set('remark')} />
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-green" disabled={busy} onClick={save}>
            {row ? 'บันทึกการแก้ไข' : 'เพิ่มแถว'}
          </button>
          {row && !isDeleted(row) && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => setForm({ ...form, status: `DELETED - ${new Date().toISOString().slice(0, 10)}` })}
              title="ทำเครื่องหมายว่าลบแล้ว แต่ยังเก็บแถวไว้"
            >
              ทำเครื่องหมาย DELETED
            </button>
          )}
        </div>

        {row && (
          <>
            <div className="section-title" style={{ marginTop: 18 }}>
              <span>เพิ่มบันทึกอัปเดต</span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>ประเภทอัปเดต</label>
                <select value={note.update_type} onChange={(e) => setNote({ ...note, update_type: e.target.value })}>
                  <option value="">— เลือกประเภท —</option>
                  {updateTypes.map((t) => (
                    <option key={t} value={t}>
                      {t === 'Offline' ? 'แจ้ง Offline' : t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>หมายเหตุเพิ่มเติม</label>
                <input value={note.remark} onChange={(e) => setNote({ ...note, remark: e.target.value })} placeholder="เช่น ต้องติดตามต่อ, รออะไหล่..." />
              </div>
            </div>
            <div className="form-group">
              <label>รายละเอียด</label>
              <input value={note.detail} onChange={(e) => setNote({ ...note, detail: e.target.value })} placeholder="เช่น ย้ายกล้องจากจุด A ไปจุด B เนื่องจาก..." />
            </div>
            <button className="btn btn-dark" disabled={busy} onClick={saveNote}>
              บันทึกอัปเดต
            </button>

            <div className="section-title" style={{ marginTop: 18 }}>
              <span>ประวัติอัปเดตของ IP นี้</span>
              <span>{history.length}</span>
            </div>
            <div className="device-history">
              {history.map((h) => (
                <div key={h.id} className="device-history-row">
                  <span className="mono">{fmtTime(h.timestamp)}</span>
                  <span>{h.update_type}</span>
                  <span className="grow">
                    {h.detail}
                    {h.remark ? ` (${h.remark})` : ''} — {h.updated_by_name || '-'}
                  </span>
                </div>
              ))}
              {history.length === 0 && <p className="hint">ยังไม่มีประวัติ</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
