import { useState } from 'react';
import { MapPin, Map as MapIcon } from 'lucide-react';
import { formatAgo } from '../types/monitor';
import type { Catalog, Device } from '../types/monitor';
import { CatalogIcon, StatusPill, ZoneTag, findStatus, findType, findZone, useCatalog } from './catalog';
import { useAuth } from './auth';

interface DeviceTablePageProps {
  devices: Device[];
  totalAll: number;
  filtered: boolean;
  onClose: () => void;
  onSelect: (d: Device) => void;
  /** ไปวางอุปกรณ์ที่ยังไม่มีตำแหน่งบนแผนผัง */
  onPlace: (d: Device) => void;
}

function toCsv(devices: Device[], c: Catalog): string {
  const cols: (keyof Device)[] = ['name', 'device_type', 'status', 'ip_address', 'mac_address', 'brand', 'model',
    'serial_no', 'zone', 'floor', 'lan', 'cabinet', 'last_latency_ms', 'last_seen', 'remark'];
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
  return [cols.join(','), ...devices.map((d) => cols.map((col) => esc(value(d, col))).join(','))].join('\r\n');
}

function downloadCsv(devices: Device[], c: Catalog) {
  // BOM ให้ Excel อ่านภาษาไทยถูก
  const blob = new Blob(['﻿' + toCsv(devices, c)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `devices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DeviceTablePage({ devices: all, totalAll, filtered, onClose, onSelect, onPlace }: DeviceTablePageProps) {
  const catalog = useCatalog();
  const { canEdit } = useAuth();
  // แสดงเฉพาะที่ยังไม่วางบนแผนผัง
  const [onlyUnplaced, setOnlyUnplaced] = useState(false);
  const isUnplaced = (d: Device) => d.x_percent == null || d.y_percent == null;
  const unplacedCount = all.filter(isUnplaced).length;
  const devices = onlyUnplaced ? all.filter(isUnplaced) : all;
  return (
    <div className="dash-page">
      <div className="dash-inner">
        <h2 className="dash-head">
          <span>
            รายการอุปกรณ์ ({devices.length}
            {filtered && devices.length !== totalAll ? ` จาก ${totalAll}` : ''})
            {filtered && <span className="dash-sub"> · กรองตามคำค้น / ตัวกรองบน TopBar</span>}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {(unplacedCount > 0 || onlyUnplaced) && (
              <button
                className={'btn btn-sm unplaced-toggle' + (onlyUnplaced ? ' active' : '')}
                onClick={() => setOnlyUnplaced(!onlyUnplaced)}
                title="แสดงเฉพาะอุปกรณ์ที่ยังไม่ได้วางบนแผนผัง"
              >
                <MapPin size={13} /> ยังไม่วาง {unplacedCount}
              </button>
            )}
            <button className="btn btn-dark btn-sm" onClick={() => downloadCsv(devices, catalog)} disabled={devices.length === 0}>
              Export CSV
            </button>
            <button className="btn btn-dark btn-sm dash-back" onClick={onClose} title="กลับไปที่แผนผัง">
              <MapIcon size={14} /> กลับไปแผนผัง
            </button>
          </span>
        </h2>
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
                <th>โซน</th>
                <th>ยี่ห้อ / รุ่น</th>
                <th>ตู้</th>
                <th>แผนผัง</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const t = findType(catalog, d.device_type);
                return (
                  <tr key={d.id} onClick={() => onSelect(d)} style={{ cursor: 'pointer' }}>
                    <td>
                      <StatusPill status={d.status} />
                    </td>
                    <td>{d.name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <CatalogIcon icon={t.icon} size={14} className="inline-ico" />
                      {t.label}
                    </td>
                    <td className="mono">{d.ip_address || '—'}</td>
                    <td className="mono">{d.last_latency_ms != null ? `${d.last_latency_ms} ms` : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatAgo(d.last_seen)}</td>
                    <td>
                      <ZoneTag zone={d.zone} />
                    </td>
                    <td>{[d.brand, d.model].filter(Boolean).join(' ') || '—'}</td>
                    <td>{d.cabinet || '—'}</td>
                    <td>
                      {isUnplaced(d) && !canEdit ? (
                        <span className="placed-mark">ยังไม่วาง</span>
                      ) : isUnplaced(d) ? (
                        <button
                          className="btn btn-green btn-sm"
                          title="คลิกจุดบนแผนผังเพื่อวางอุปกรณ์นี้"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlace(d);
                          }}
                        >
                          <MapPin size={12} /> วาง
                        </button>
                      ) : (
                        <span className="placed-mark">✓ วางแล้ว</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {devices.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                    {onlyUnplaced ? 'อุปกรณ์ทุกตัววางบนแผนผังแล้ว' : 'ยังไม่มีอุปกรณ์'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
