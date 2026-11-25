import { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { Catalog, Device } from '../../types/monitor';
import { CatalogIcon, findStatus, findType, findZone, useCatalog } from '../shared/catalog';

// ---------- CSV ----------
const CSV_COLS: (keyof Device)[] = ['name', 'device_type', 'status', 'ip_address', 'mac_address', 'brand', 'model',
  'serial_no', 'zone', 'floor', 'lan', 'cabinet', 'last_latency_ms', 'last_seen', 'remark'];

export function toCsv(devices: Device[], c: Catalog): string {
  // แปลง key เป็นชื่อที่อ่านได้
  const value = (d: Device, col: keyof Device) =>
    col === 'device_type' ? findType(c, d.device_type).label
      : col === 'status' ? findStatus(c, d.status).label
      : col === 'zone' ? findZone(c, d.zone)?.label ?? ''
      : d[col];
  // กันสูตร Excel (=, +, -, @) ในข้อมูลที่ผู้ใช้กรอก
  const esc = (v: unknown) => {
    let t = String(v ?? '');
    if (/^[=+\-@]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  return [CSV_COLS.join(','), ...devices.map((d) => CSV_COLS.map((col) => esc(value(d, col))).join(','))].join('\r\n');
}

function downloadCsv(devices: Device[], c: Catalog, fileName: string) {
  // BOM ให้ Excel อ่านภาษาไทยถูก
  const blob = new Blob(['﻿' + toCsv(devices, c)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- หน้าตั้งค่า ----------
type Kind = 'type' | 'zone' | 'status';
const keyOf = (d: Device, k: Kind) => (k === 'type' ? d.device_type : k === 'zone' ? d.zone : d.status) || '';

interface ExportCsvDialogProps {
  /** รายการที่เลือกส่งออกได้ (ข้อมูลของหน้า ตามตัวกรองบน TopBar / สแนปช็อตปีที่ดูอยู่) */
  devices: Device[];
  /** เลือกไว้ล่วงหน้า เช่น การ์ดกลุ่ม / สถานะที่กรองอยู่ในหน้า */
  initial?: Partial<Record<Kind, string[]>>;
  /** ต่อท้ายชื่อไฟล์ เช่น -snap2025 */
  nameSuffix?: string;
  onClose: () => void;
}

// Export CSV แบบเลือกได้ว่าจะเอาประเภทไหน / โซนไหน / สถานะไหน
export function ExportCsvDialog({ devices, initial, nameSuffix = '', onClose }: ExportCsvDialogProps) {
  const catalog = useCatalog();

  // ตัวเลือกของแต่ละหมวด: เฉพาะค่าที่มีอยู่จริงในรายการ เรียงตามลำดับใน catalog, "ไม่ระบุ" ท้ายสุด
  const options = useMemo(() => {
    const build = (k: Kind) => {
      const items = k === 'type' ? catalog.types : k === 'zone' ? catalog.zones : catalog.statuses;
      const counts = new Map<string, number>();
      for (const d of devices) counts.set(keyOf(d, k), (counts.get(keyOf(d, k)) || 0) + 1);
      const rank = (key: string) => {
        if (!key) return Number.MAX_SAFE_INTEGER;
        const i = items.findIndex((it) => it.key === key);
        return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
      };
      return [...counts.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'th'))
        .map(([key, count]) => {
          if (k === 'type') {
            const t = findType(catalog, key);
            return { key, count, label: key ? t.label : '(ไม่ระบุประเภท)', icon: key ? t.icon : '', color: undefined as string | undefined };
          }
          if (k === 'zone') {
            const z = findZone(catalog, key);
            return { key, count, label: z ? z.label : '(ไม่ระบุโซน)', icon: z?.icon || '', color: z?.color };
          }
          const s = findStatus(catalog, key);
          return { key, count, label: s.label, icon: '', color: s.color };
        });
    };
    return { type: build('type'), zone: build('zone'), status: build('status') };
  }, [devices, catalog]);

  // ค่าที่เลือก — เริ่มจาก initial ถ้ามี (เฉพาะค่าที่มีอยู่จริง) ไม่งั้นเลือกทั้งหมด
  const [sel, setSel] = useState<Record<Kind, Set<string>>>(() => {
    const init = (k: Kind) => {
      const all = options[k].map((o) => o.key);
      const pre = (initial?.[k] || []).filter((v) => all.includes(v));
      return new Set(pre.length ? pre : all);
    };
    return { type: init('type'), zone: init('zone'), status: init('status') };
  });

  const toggle = (k: Kind, key: string) =>
    setSel((prev) => {
      const next = new Set(prev[k]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [k]: next };
    });
  const setAll = (k: Kind, on: boolean) => setSel((prev) => ({ ...prev, [k]: new Set(on ? options[k].map((o) => o.key) : []) }));

  const result = useMemo(
    () =>
      devices
        .filter((d) => sel.type.has(keyOf(d, 'type')) && sel.zone.has(keyOf(d, 'zone')) && sel.status.has(keyOf(d, 'status')))
        .sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true })),
    [devices, sel],
  );

  // ชื่อไฟล์บอกสิ่งที่เลือก (เลือกหมวดละ 1 ค่า → ใส่ชื่อค่านั้น)
  const fileName = useMemo(() => {
    const part = (k: Kind) => {
      if (sel[k].size !== 1 || options[k].length <= 1) return '';
      const o = options[k].find((x) => sel[k].has(x.key));
      return o?.key ? `-${o.label}` : '';
    };
    const base = `devices-${new Date().toISOString().slice(0, 10)}${part('type')}${part('zone')}${part('status')}${nameSuffix}`;
    return `${base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 150)}.csv`;
  }, [sel, options, nameSuffix]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doExport = () => {
    downloadCsv(result, catalog, fileName);
    onClose();
  };

  const section = (k: Kind, title: string) => {
    const opts = options[k];
    const n = sel[k].size;
    return (
      <div className="form-group csv-section">
        <div className="csv-section-head">
          <label>
            {title} <span className="csv-count">({n === opts.length ? 'ทั้งหมด' : `${n}/${opts.length}`})</span>
          </label>
          <span>
            <button type="button" className="csv-link" onClick={() => setAll(k, true)} disabled={n === opts.length}>
              เลือกทั้งหมด
            </button>
            <button type="button" className="csv-link" onClick={() => setAll(k, false)} disabled={n === 0}>
              ล้าง
            </button>
          </span>
        </div>
        <div className="csv-chips">
          {opts.map((o) => (
            <label key={o.key || '__none'} className={'csv-chip' + (sel[k].has(o.key) ? ' on' : '')} style={o.color ? ({ '--c': o.color } as React.CSSProperties) : undefined}>
              <input type="checkbox" checked={sel[k].has(o.key)} onChange={() => toggle(k, o.key)} />
              {o.icon ? <CatalogIcon icon={o.icon} size={13} /> : o.color ? <span className="csv-dot" /> : null}
              <span>{o.label}</span>
              <span className="csv-n">{o.count}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box csv-box" onClick={(e) => e.stopPropagation()}>
        <div className="auth-head">
          <span className="auth-ico">
            <Download size={20} />
          </span>
          <div>
            <h2>Export CSV</h2>
            <p>เลือกอุปกรณ์ที่จะส่งออกจาก {devices.length} เครื่องในหน้านี้ (ตามตัวกรองบน TopBar)</p>
          </div>
          <button type="button" className="panel-close" onClick={onClose} title="ปิด">
            <X />
          </button>
        </div>

        {section('type', 'ประเภท')}
        {section('zone', 'โซน')}
        {section('status', 'สถานะ')}

        <p className="hint" style={{ margin: '4px 0 0' }}>
          ไฟล์: <span className="mono">{fileName}</span>
        </p>
        <button className="btn btn-green btn-block" style={{ marginTop: 10 }} disabled={result.length === 0} onClick={doExport}>
          <Download size={14} /> {result.length ? `Export ${result.length} เครื่อง` : 'ไม่มีอุปกรณ์ตามที่เลือก'}
        </button>
      </div>
    </div>
  );
}
