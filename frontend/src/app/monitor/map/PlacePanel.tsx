import { Camera, Check, MapPin, Network, X } from 'lucide-react';
import { cn } from '../../components/ui/utils';
import { findType, useCatalog } from '../shared/catalog';
import { DirectionDial, isCameraLike } from './DirectionDial';
import { LanCombobox } from '../devices/LanCombobox';
import { CheckMethodFields } from '../devices/CheckMethodFields';
import type { Device } from '../../types/monitor';

/** ข้อมูลในฟอร์มวางอุปกรณ์ใหม่ (string ทั้งหมด — '' = ไม่ระบุ) */
export interface PlaceForm {
  name: string;
  device_type: string;
  zone: string;
  floor: string;
  status: string;
  ip_address: string;
  lan: string;
  cabinet: string;
  install_area: string;
  install_detail: string;
  requested_by: string;
  direction: string;
  fov_angle: string;
  remark: string;
  check_method: string;
  check_port: string;
  snmp_community: string;
}

export const EMPTY_PLACE_FORM: PlaceForm = {
  name: '', device_type: '', zone: '', floor: '', status: '', ip_address: '', lan: '', cabinet: '',
  install_area: '', install_detail: '', requested_by: '', direction: '', fov_angle: '', remark: '',
  check_method: 'ping', check_port: '', snmp_community: '',
};


interface PlacePanelProps {
  form: PlaceForm;
  onForm: (f: PlaceForm) => void;
  /** ชั้นของแผนผังที่เปิดอยู่ — ใส่ให้อุปกรณ์ใหม่อัตโนมัติ */
  mapFloor: string | null;
  pending: { x: number; y: number } | null;
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  /** อุปกรณ์ทั้งหมด — ใช้รวบรวมวงแลนที่มีอยู่สำหรับ dropdown */
  allDevices: Device[];
}

/** แผงวางอุปกรณ์ใหม่ (ด้านขวาของแผนผัง) */
export function PlacePanel(props: PlacePanelProps) {
  const { form, onForm, pending, mapFloor } = props;
  const catalog = useCatalog();
  const set = (k: keyof PlaceForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onForm({ ...form, [k]: e.target.value });

  const typeItem = findType(catalog, form.device_type);
  const showDir = isCameraLike(form.device_type, typeItem.icon, form.direction || null);
  const canSave = !!pending && !!form.name.trim() && !props.saving;

  return (
    // กันไม่ให้การกด/เลื่อนในแผงไปถึง viewer (ไม่งั้นจะนับเป็นคลิกวาง / ซูมแผนผัง)
    <aside className="place-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <header className="pp-head">
        <span className="pp-head-ico">
          <MapPin size={18} />
        </span>
        <div className="pp-head-text">
          <b>
            วางอุปกรณ์ใหม่ <em>NEW</em>
          </b>
          <span>คลิกบนแผนผังเพื่อกำหนดตำแหน่ง</span>
        </div>
        <button className="panel-close" onClick={props.onCancel} title="ยกเลิก (Esc)">
          <X />
        </button>
      </header>

      <div className="pp-body">
        {/* ตำแหน่ง */}
        <div className={cn('pp-pos', pending && 'ok')}>
          <MapPin size={15} />
          <span>
            X <b className="mono">{pending ? `${pending.x.toFixed(1)}%` : '—'}</b>
          </span>
          <span>
            Y <b className="mono">{pending ? `${pending.y.toFixed(1)}%` : '—'}</b>
          </span>
          <span className="pp-pos-state">{pending ? 'วางจุดแล้ว' : 'รอวางจุด'}</span>
        </div>

        {/* ข้อมูลอุปกรณ์ */}
        <div className="pp-section">
          <div className="pp-section-title">
            <Camera size={13} /> ข้อมูลอุปกรณ์
          </div>
          <div className="form-group">
            <label>ชื่อ *</label>
            <input autoFocus value={form.name} onChange={set('name')} placeholder="เช่น CAM-ลานจอด-03" />
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
                {form.zone && !catalog.zones.some((z) => z.key === form.zone) && <option value={form.zone}>{form.zone}</option>}
              </select>
            </div>
            <div className="form-group">
              <label>ชั้น (อัตโนมัติตามแผนผัง)</label>
              <input value={mapFloor || '—'} disabled title="ชั้นใส่ให้อัตโนมัติตามแผนผัง แก้เองไม่ได้" />
            </div>
          </div>
        </div>

        {/* เครือข่าย & ตำแหน่งติดตั้ง */}
        <div className="pp-section">
          <div className="pp-section-title">
            <Network size={13} /> เครือข่าย & ตำแหน่งติดตั้ง
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>IP Address</label>
              <input className="mono" value={form.ip_address} onChange={set('ip_address')} placeholder="192.168.1.10" />
            </div>
            <div className="form-group">
              <label>วงแลน (LAN)</label>
              <LanCombobox
                value={form.lan}
                devices={props.allDevices}
                placeholder="พิมพ์ หรือเลือก"
                onChange={(lan) => onForm({ ...form, lan })}
              />
            </div>
          </div>
          <div className="form-group">
            <label>ตู้คอนโทรล</label>
            <input value={form.cabinet} onChange={set('cabinet')} />
          </div>
        </div>

        {/* วิธีตรวจ */}
        <div className="pp-section">
          <div className="pp-section-title">
            <Network size={13} /> วิธีตรวจ
          </div>
          <CheckMethodFields
            value={{ method: form.check_method, port: form.check_port, community: form.snmp_community }}
            onChange={(v) => onForm({ ...form, check_method: v.method, check_port: v.port, snmp_community: v.community })}
          />
        </div>

        {showDir && (
          <div className="pp-section">
            <div className="pp-section-title">ทิศกล้อง + มุมมอง</div>
            <DirectionDial
              direction={form.direction}
              fov={form.fov_angle}
              onChange={(direction, fov_angle) => onForm({ ...form, direction, fov_angle })}
            />
          </div>
        )}

        <div className="form-group">
          <label>หมายเหตุ</label>
          <input value={form.remark} onChange={set('remark')} />
        </div>
      </div>

      <footer className="pp-foot">
        {props.error && <div className="notice error">{props.error}</div>}
        {!pending && <div className="pp-foot-hint">คลิกบนแผนผังเพื่อวางจุดก่อนบันทึก</div>}
        <div className="pp-foot-btns">
          <button className="btn btn-dark" onClick={props.onCancel}>
            ยกเลิก
          </button>
          <button className="btn btn-green" disabled={!canSave} onClick={props.onSave}>
            <Check size={14} /> {props.saving ? 'กำลังบันทึก...' : 'บันทึกอุปกรณ์'}
          </button>
        </div>
      </footer>

    </aside>
  );
}
