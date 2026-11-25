import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageDown, X } from 'lucide-react';
import type { Catalog, Device, MapItem } from '../../types/monitor';
import {
  EXPORT_FORMATS,
  defaultExportName,
  downloadCanvas,
  prepareMapExport,
  safeFileName,
  type ExportFormat,
  type MapExporter,
} from './exportMapImage';

interface ExportMapDialogProps {
  map: MapItem;
  /** อุปกรณ์ที่แสดงอยู่บนแผนผัง (ตามตัวกรองปัจจุบัน) */
  devices: Device[];
  catalog: Catalog;
  onClose: () => void;
}

// จำค่าที่ใช้ครั้งล่าสุด (ขนาดหมุด / นามสกุล / แสดงชื่อ) ไว้ในเครื่องผู้ใช้
const PREF_KEY = 'monitoring-device:map-export';
interface Prefs {
  scale: number;
  format: ExportFormat;
  labels: boolean;
}
function loadPrefs(): Prefs {
  const def: Prefs = { scale: 100, format: 'png', labels: true };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return {
      scale: Number.isFinite(p.scale) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, p.scale)) : def.scale,
      format: EXPORT_FORMATS.some((f) => f.key === p.format) ? p.format : def.format,
      labels: typeof p.labels === 'boolean' ? p.labels : def.labels,
    };
  } catch {
    return def;
  }
}

const SCALE_MIN = 40;
const SCALE_MAX = 300;
const PREVIEW_SIDE = 1100;

// Export แผนผังเป็นรูป: ตั้งขนาดหมุด, นามสกุลไฟล์, ชื่อไฟล์ — มีรูปตัวอย่างอัปเดตตามค่าที่ตั้ง
export function ExportMapDialog({ map, devices, catalog, onClose }: ExportMapDialogProps) {
  const [prefs] = useState(loadPrefs);
  const [scale, setScale] = useState(prefs.scale);
  const [format, setFormat] = useState<ExportFormat>(prefs.format);
  const [labels, setLabels] = useState(prefs.labels);
  const [name, setName] = useState(() => defaultExportName(map));
  const [exporter, setExporter] = useState<MapExporter | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const previewUrl = useRef<string | null>(null);

  // โหลดรูปแผนผัง + ไอคอนครั้งเดียว
  useEffect(() => {
    let alive = true;
    prepareMapExport(map, devices, catalog)
      .then((ex) => alive && setExporter(ex))
      .catch((err) => alive && setError((err as Error).message));
    return () => {
      alive = false;
    };
  }, [map, devices, catalog]);

  // รูปตัวอย่าง — รอให้หยุดเลื่อนแถบก่อนค่อยวาด (จัดวางป้ายใช้เวลาเมื่ออุปกรณ์เยอะ)
  useEffect(() => {
    if (!exporter) return;
    const t = setTimeout(() => {
      const canvas = exporter.render({ markerScale: scale / 100, labels, maxSide: PREVIEW_SIDE });
      canvas.toBlob((b) => {
        if (!b) return;
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = URL.createObjectURL(b);
        setPreview(previewUrl.current);
      }, 'image/png');
    }, 250);
    return () => clearTimeout(t);
  }, [exporter, scale, labels]);
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const fmt = EXPORT_FORMATS.find((f) => f.key === format)!;
  const cleanName = safeFileName(name);

  const doExport = async () => {
    if (!exporter || !cleanName) return;
    setBusy(true);
    setError('');
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ scale, format, labels }));
    } catch {
      /* เก็บค่าไม่ได้ก็ export ต่อ */
    }
    // ให้ปุ่มขึ้น "กำลังสร้าง…" ก่อนเริ่มงานหนัก
    await new Promise((r) => setTimeout(r, 30));
    try {
      const canvas = exporter.render({ markerScale: scale / 100, labels });
      await downloadCanvas(canvas, format, cleanName);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  // วางไว้ที่ .cctv-app (นอกกรอบแผนผัง) — ไม่ให้ล้อเมาส์/ลากบนหน้าต่างนี้ไปซูม/เลื่อนแผนผัง
  const host = (document.querySelector('.cctv-app') as HTMLElement | null) || document.body;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      className="modal"
      onClick={() => !busy && onClose()}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      <div className="modal-box export-box" onClick={(e) => e.stopPropagation()}>
        <div className="auth-head">
          <span className="auth-ico">
            <ImageDown size={20} />
          </span>
          <div>
            <h2>Export รูปแผนผัง</h2>
            <p>
              {map.map_name} · อุปกรณ์ {exporter ? exporter.count : '…'} ตัว (ตามตัวกรองที่ใช้อยู่)
            </p>
          </div>
          <button type="button" className="panel-close" onClick={onClose} disabled={busy} title="ปิด">
            <X />
          </button>
        </div>

        <div className="export-preview">
          {preview ? <img src={preview} alt="ตัวอย่างรูปที่จะ export" /> : <span className="hint">{error ? '' : 'กำลังเตรียมรูปตัวอย่าง…'}</span>}
        </div>

        <div className="form-group">
          <label>
            ขนาดหมุดกล้อง <b className="mono">{scale}%</b>
          </label>
          <div className="export-scale">
            <input
              type="range"
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={10}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
            />
            <button type="button" className="btn btn-dark" onClick={() => setScale(100)} disabled={scale === 100}>
              ค่าเริ่มต้น
            </button>
          </div>
          <span className="hint">ปรับขนาดหมุด ป้ายชื่อ และกรวยมุมกล้องพร้อมกัน — เล็กลงช่วยให้จุดที่กล้องอยู่แน่นอ่านง่ายขึ้น</span>
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={labels} onChange={(e) => setLabels(e.target.checked)} />
            แสดงชื่อกล้อง
          </label>
        </div>

        <div className="export-row">
          <div className="form-group">
            <label>ชื่อไฟล์</label>
            <div className="export-name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} spellCheck={false} />
              <span className="mono">.{fmt.ext}</span>
            </div>
          </div>
          <div className="form-group">
            <label>นามสกุลไฟล์</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f.key} value={f.key}>
                  .{f.ext}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="hint" style={{ marginTop: -4 }}>
          {fmt.label}
          {exporter && ` · ขนาดรูป ${exporter.fullSize.w.toLocaleString()} × ${exporter.fullSize.h.toLocaleString()} px`}
        </p>

        {error && <div className="notice error">{error}</div>}

        <button className="btn btn-green btn-block" style={{ marginTop: 10 }} disabled={!exporter || busy || !cleanName} onClick={doExport}>
          <ImageDown /> {busy ? 'กำลังสร้างไฟล์…' : `Export เป็น ${cleanName || '…'}.${fmt.ext}`}
        </button>
      </div>
    </div>,
    host,
  );
}
