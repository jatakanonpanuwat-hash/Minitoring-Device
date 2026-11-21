import { useEffect, useState } from 'react';
import { Activity, MapPin, MapPinOff, X } from 'lucide-react';
import { formatAgo } from '../types/monitor';
import type { Device, LogEntry, MapItem } from '../types/monitor';
import { CatalogIcon, StatusPill, findStatus, findType, useCatalog } from './catalog';
import { getLogs } from '../utils/monitorClient';
import { actionLabel } from './LogsPage';
import { useAuth } from './auth';
import { DirectionDial } from './DirectionDial';
import { LanCombobox } from './LanCombobox';

interface DeviceModalProps {
  device: Device;
  maps: MapItem[];
  onClose: () => void;
  onSave: (id: string, data: Partial<Device>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPing: (id: string) => Promise<{ alive: boolean; latency: number | null }>;
  /** ไปวาง/ย้ายตำแหน่งอุปกรณ์นี้บนแผนผัง */
  onPlace: () => void;
  error: string;
  /** อุปกรณ์ทั้งหมด — ใช้รวบรวมวงแลนที่มีอยู่สำหรับ dropdown */
  allDevices: Device[];
  /** true = ไม่แสดงบนแผนผัง (ล้างตำแหน่ง), false = ยกเลิก */
  onSetHidden: (hidden: boolean) => void;
}

const s = (v: string | number | null | undefined) => (v == null ? '' : String(v));

export function DeviceModal({ device, maps, onClose, onSave, onDelete, onPing, onPlace, error, allDevices, onSetHidden }: DeviceModalProps) {
  const [form, setForm] = useState({
    name: device.name,
    device_type: device.device_type,
    status: device.status,
    monitor_enabled: device.monitor_enabled,
    ip_address: s(device.ip_address),
    mac_address: s(device.mac_address),
    brand: s(device.brand),
    model: s(device.model),
    serial_no: s(device.serial_no),
    zone: s(device.zone),
    floor: s(device.floor),
    lan: s(device.lan),
    cabinet: s(device.cabinet),
    map_id: s(device.map_id),
    direction: s(device.direction),
    fov_angle: s(device.fov_angle),
    remark: s(device.remark),
  });
  const [saving, setSaving] = useState(false);
  const [pingMsg, setPingMsg] = useState('');
  const [history, setHistory] = useState<LogEntry[]>([]);

  useEffect(() => {
    getLogs(20, device.id).then(setHistory).catch(() => {});
  }, [device.id, device.status]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  // แผนผังกับชั้นเป็นอัตโนมัติ แก้เองไม่ได้ (แผนผังไม่ระบุชั้น = คงค่าชั้นเดิมไว้)
  const placedMap = maps.find((m) => m.map_id === device.map_id);
  const mapLabel = placedMap ? `${placedMap.map_name}${placedMap.floor ? ` (${placedMap.floor})` : ''}` : '—';
  const autoFloor = placedMap?.floor || s(device.floor);

  const save = async () => {
    setSaving(true);
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    // สถานะกับแผนผังเป็นอัตโนมัติ — ไม่ส่งไป backend (กันค่าค้างทับค่าจริง)
    const { status: _st, map_id: _mp, ...rest } = form;
    void _st;
    void _mp;
    try {
      await onSave(device.id, {
        ...rest,
        floor: autoFloor || null,
        direction: num(form.direction),
        fov_angle: num(form.fov_angle),
      });
    } finally {
      setSaving(false);
    }
  };

  const ping = async () => {
    setPingMsg('กำลัง ping...');
    try {
      const r = await onPing(device.id);
      setPingMsg(r.alive ? `ตอบกลับ ${r.latency ?? '?'} ms` : 'ไม่ตอบ (timeout)');
    } catch (e) {
      setPingMsg((e as Error).message);
    }
  };

  const catalog = useCatalog();
  const { canEdit, requestLogin } = useAuth();
  const paused = !!findStatus(catalog, device.status).pause_monitor;
  // ทิศ/FOV สำหรับประเภทที่เป็นกล้อง (ดูจาก key หรือไอคอน) หรือเครื่องที่ตั้งค่าไว้แล้ว
  const typeIcon = findType(catalog, form.device_type).icon;
  const showFov = form.device_type === 'camera' || ['lucide:Cctv', 'lucide:Camera', 'lucide:Video'].includes(typeIcon) || form.direction !== '' || form.fov_angle !== '';
  // โซนเดิมที่ไม่อยู่ในรายการแล้ว — ยังแสดงให้เลือกค้างไว้ได้
  const zoneOptions = form.zone && !catalog.zones.some((z) => z.key === form.zone)
    ? [...catalog.zones, { key: form.zone, label: `${form.zone} (ไม่อยู่ในรายการ)`, icon: '' }]
    : catalog.zones;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h2>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CatalogIcon icon={findType(catalog, device.device_type).icon} size={18} />
            {device.name}
          </span>
          <button className="panel-close" onClick={onClose} title="ปิด">
            <X />
          </button>
        </h2>
        {error && <div className="notice error">{error}</div>}

        {device.hide_on_map && (device.x_percent == null || device.y_percent == null) ? (
          <div className="place-notice hidden-map">
            <MapPinOff size={16} />
            <span>
              ไม่แสดงบนแผนผัง <small>ยังถูก ping และแจ้งเตือนตามปกติ</small>
            </span>
            {canEdit && (
              <>
                <button className="btn btn-dark btn-sm" onClick={() => onSetHidden(false)} title="กลับไปนับเป็น 'ยังไม่วาง'">
                  ยกเลิก
                </button>
                <button className="btn btn-green btn-sm" onClick={onPlace}>
                  วางบนแผนผัง
                </button>
              </>
            )}
          </div>
        ) : device.x_percent == null || device.y_percent == null ? (
          <div className="place-notice">
            <MapPin size={16} />
            <span>อุปกรณ์นี้ยังไม่ได้วางบนแผนผัง</span>
            {canEdit && (
              <>
                <button className="btn btn-dark btn-sm" onClick={() => onSetHidden(true)} title="ตั้งใจไม่วาง — ไม่นับเป็น 'ยังไม่วาง'">
                  <MapPinOff size={13} /> ไม่ต้องวาง
                </button>
                <button className="btn btn-green btn-sm" onClick={onPlace}>
                  วางบนแผนผัง
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="place-notice placed">
            <MapPin size={16} />
            <span>
              อยู่บนแผนผัง <b>{(() => { const mm = maps.find((m) => m.map_id === device.map_id); return mm ? `${mm.map_name}${mm.floor ? ` (${mm.floor})` : ''}` : '—'; })()}</b>
            </span>
            {canEdit && (
              <>
                <button className="btn btn-dark btn-sm" onClick={() => onSetHidden(true)} title="เอาหมุดออกจากแผนผัง (อุปกรณ์ยังอยู่ในระบบ)">
                  <MapPinOff size={13} /> เอาออกจากแผนผัง
                </button>
                <button className="btn btn-dark btn-sm" onClick={onPlace} title="คลิกจุดใหม่บนแผนผังเพื่อย้ายตำแหน่ง">
                  ย้ายตำแหน่ง
                </button>
              </>
            )}
          </div>
        )}

        <div className="live-status">
          <StatusPill status={device.status} />
          <span>
            latency <b className="mono">{device.last_latency_ms != null ? `${device.last_latency_ms} ms` : '—'}</b>
          </span>
          <span>
            พบล่าสุด <b>{formatAgo(device.last_seen)}</b>
          </span>
          <span>
            ตรวจล่าสุด <b>{formatAgo(device.last_checked)}</b>
          </span>
          <button className="btn btn-dark btn-sm" disabled={!device.ip_address} onClick={ping}>
            <Activity size={14} /> Ping ตอนนี้
          </button>
          {pingMsg && <span className="hint">{pingMsg}</span>}
        </div>

        {/* ยังไม่ login = ดูได้อย่างเดียว */}
        <fieldset className="dm-fields" disabled={!canEdit}>
        <div className="form-row">
          <div className="form-group">
            <label>ชื่อ</label>
            <input value={form.name} onChange={set('name')} />
          </div>
          <div className="form-group">
            <label>ประเภท</label>
            <select value={form.device_type} onChange={set('device_type')}>
              {catalog.types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>IP / Hostname</label>
          <input value={form.ip_address} onChange={set('ip_address')} placeholder="192.168.1.10" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Monitor (ping อัตโนมัติ)</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', margin: '8px 0' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.monitor_enabled}
                onChange={(e) => setForm({ ...form, monitor_enabled: e.target.checked })}
              />
              เปิด
            </label>
          </div>
          <div className="form-group">
            <label>สถานะ (อัตโนมัติตาม ping)</label>
            <input value={findStatus(catalog, device.status).label} disabled title="สถานะเปลี่ยนเองตามผล ping แก้เองไม่ได้" />
            {paused && <span className="hint">สถานะนี้หยุด ping อัตโนมัติ</span>}
          </div>
        </div>
        <div className="form-group">
          <label>แผนผัง (ตามตำแหน่งที่วาง)</label>
          <input value={mapLabel} disabled title="แผนผังเปลี่ยนตามตำแหน่งที่วางบนแผนผัง แก้เองไม่ได้" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>โซน</label>
            <select value={form.zone} onChange={set('zone')}>
              <option value="">— ไม่ระบุ —</option>
              {zoneOptions.map((z) => (
                <option key={z.key} value={z.key}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>ชั้น (อัตโนมัติตามแผนผัง)</label>
            <input value={autoFloor || '—'} disabled title="ชั้นใส่ให้อัตโนมัติตามแผนผัง แก้เองไม่ได้" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>LAN / Port</label>
            <LanCombobox
              value={form.lan}
              devices={allDevices}
              placeholder="พิมพ์ หรือเลือก"
              onChange={(lan) => setForm((f) => ({ ...f, lan }))}
            />
          </div>
          <div className="form-group">
            <label>ตู้ / Rack</label>
            <input value={form.cabinet} onChange={set('cabinet')} />
          </div>
        </div>
        {showFov && (
          <div className="form-group">
            <label>ทิศทางกล้อง</label>
            <DirectionDial
              direction={form.direction}
              fov={form.fov_angle}
              onChange={(direction, fov_angle) => setForm({ ...form, direction, fov_angle })}
            />
          </div>
        )}
        <div className="form-group">
          <label>หมายเหตุ</label>
          <input value={form.remark} onChange={set('remark')} />
        </div>
        {device.x_percent != null && (
          <p className="hint" style={{ marginBottom: 12 }}>
            ตำแหน่งบนแผนผัง {Number(device.x_percent).toFixed(1)}%, {Number(device.y_percent).toFixed(1)}%
          </p>
        )}
        </fieldset>
        {!canEdit ? (
          <div className="readonly-note">
            <span>ดูอย่างเดียว — เข้าสู่ระบบเพื่อแก้ไขอุปกรณ์</span>
            <button className="btn btn-green btn-sm" onClick={requestLogin}>
              เข้าสู่ระบบ
            </button>
          </div>
        ) : (
        <div className="btn-row">
          <button className="btn btn-green" disabled={saving || !form.name.trim()} onClick={save}>
            บันทึก
          </button>
          <button
            className="btn btn-red"
            disabled={saving}
            onClick={() => onDelete(device.id)}
          >
            ลบอุปกรณ์
          </button>
        </div>
        )}

        <div className="section-title" style={{ marginTop: 16 }}>
          <span>ประวัติล่าสุด</span>
          <span>{history.length}</span>
        </div>
        <div className="device-history">
          {history.map((h) => (
            <div key={h.id} className="device-history-row">
              <span className="mono">{new Date(h.timestamp).toLocaleString('th-TH')}</span>
              <span>{actionLabel[h.action] || h.action}</span>
              <span className="grow">{h.details || ''}</span>
            </div>
          ))}
          {history.length === 0 && <p className="hint">ยังไม่มีประวัติ</p>}
        </div>
      </div>
    </div>
  );
}
