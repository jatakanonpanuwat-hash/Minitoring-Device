import { useState } from 'react';
import { MapPin, MapPinOff, Plus, X } from 'lucide-react';
import { cn } from '../components/ui/utils';
import type { Device } from '../types/monitor';
import { useCatalog } from './catalog';
import { LanCombobox } from './LanCombobox';

export interface NewDeviceInput {
  data: Partial<Device> & { name: string };
  /** true = บันทึกแล้วไปคลิกวางบนแผนผังต่อ, false = ไม่แสดงบนแผนผัง */
  placeAfter: boolean;
}

interface AddDeviceModalProps {
  allDevices: Device[];
  hasMaps: boolean;
  onClose: () => void;
  /** คืนข้อความ error หรือ null ถ้าสำเร็จ */
  onSubmit: (input: NewDeviceInput) => Promise<string | null>;
}

const EMPTY = { name: '', device_type: '', ip_address: '', lan: '', zone: '', cabinet: '', brand: '', model: '', remark: '' };

/** เพิ่มอุปกรณ์จากหน้ารายการ — ไม่ต้องคลิกบนแผนผัง */
export function AddDeviceModal({ allDevices, hasMaps, onClose, onSubmit }: AddDeviceModalProps) {
  const catalog = useCatalog();
  const [form, setForm] = useState({ ...EMPTY, device_type: catalog.types[0]?.key || 'other' });
  const [monitor, setMonitor] = useState(true);
  const [placeAfter, setPlaceAfter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const dupIp = form.ip_address.trim() ? allDevices.find((d) => d.ip_address?.trim() === form.ip_address.trim()) : undefined;

  const submit = async () => {
    if (!form.name.trim()) {
      setError('กรุณาใส่ชื่ออุปกรณ์');
      return;
    }
    setSaving(true);
    setError('');
    const clean = (v: string) => (v.trim() === '' ? null : v.trim());
    const err = await onSubmit({
      data: {
        name: form.name.trim(),
        device_type: form.device_type,
        ip_address: clean(form.ip_address),
        lan: clean(form.lan),
        zone: clean(form.zone),
        cabinet: clean(form.cabinet),
        brand: clean(form.brand),
        model: clean(form.model),
        remark: clean(form.remark),
        monitor_enabled: monitor,
        hide_on_map: !placeAfter,
      },
      placeAfter,
    });
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal-box add-device-box" role="dialog" aria-modal="true" aria-labelledby="add-device-title">
        <h2 id="add-device-title">
          <span className="add-device-title">
            <Plus size={18} /> เพิ่มอุปกรณ์
          </span>
          <button className="panel-close" onClick={onClose} title="ปิด" disabled={saving}>
            <X />
          </button>
        </h2>

        <div className="form-row">
          <div className="form-group">
            <label>ชื่อ *</label>
            <input autoFocus value={form.name} onChange={set('name')} placeholder="เช่น SW-ห้องServer-01" />
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

        <div className="form-row">
          <div className="form-group">
            <label>IP / Hostname</label>
            <input className="mono" value={form.ip_address} onChange={set('ip_address')} placeholder="192.168.1.10" spellCheck={false} />
            {dupIp && <span className="hint warn-text">IP นี้ใช้กับ “{dupIp.name}” อยู่แล้ว</span>}
          </div>
          <div className="form-group">
            <label>วงแลน (LAN)</label>
            <LanCombobox value={form.lan} devices={allDevices} placeholder="พิมพ์ หรือเลือก" onChange={(lan) => setForm({ ...form, lan })} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>โซน</label>
            <select value={form.zone} onChange={set('zone')}>
              <option value="">— ไม่ระบุ —</option>
              {catalog.zones.map((z) => (
                <option key={z.key} value={z.key}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>ตู้ / Rack</label>
            <input value={form.cabinet} onChange={set('cabinet')} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>ยี่ห้อ</label>
            <input value={form.brand} onChange={set('brand')} />
          </div>
          <div className="form-group">
            <label>รุ่น</label>
            <input value={form.model} onChange={set('model')} />
          </div>
        </div>

        <div className="form-group">
          <label>หมายเหตุ</label>
          <input value={form.remark} onChange={set('remark')} />
        </div>

        <label className="settings-check add-device-check">
          <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} />
          Monitor (ping อัตโนมัติ)
        </label>

        <div className="add-device-place">
          <button type="button" className={cn('add-device-opt', !placeAfter && 'active')} onClick={() => setPlaceAfter(false)}>
            <MapPinOff size={16} />
            <span>
              <b>ไม่แสดงบนแผนผัง</b>
              <small>เช่น สวิตช์ / NVR ในห้อง server — ยังถูก ping และแจ้งเตือนตามปกติ</small>
            </span>
          </button>
          <button
            type="button"
            className={cn('add-device-opt', placeAfter && 'active')}
            onClick={() => setPlaceAfter(true)}
            disabled={!hasMaps}
            title={hasMaps ? undefined : 'ยังไม่มีแผนผัง'}
          >
            <MapPin size={16} />
            <span>
              <b>วางบนแผนผังต่อ</b>
              <small>{hasMaps ? 'บันทึกแล้วไปคลิกตำแหน่งบนแผนผัง' : 'ยังไม่มีแผนผัง — อัปโหลดก่อน'}</small>
            </span>
          </button>
        </div>

        {error && <div className="notice error">{error}</div>}

        <div className="btn-row add-device-actions">
          <button className="btn btn-dark" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button className="btn btn-green" onClick={submit} disabled={saving || !form.name.trim()}>
            <Plus size={14} /> {saving ? 'กำลังบันทึก...' : placeAfter ? 'บันทึก แล้วไปวาง' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
