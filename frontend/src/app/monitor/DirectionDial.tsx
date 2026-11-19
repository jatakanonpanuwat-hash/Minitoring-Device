import { useRef } from 'react';

/** รูปพัด FOV ใน viewBox 110×110 (จุดศูนย์กลาง 55,55) — 0° = ชี้ขึ้น, หมุนตามเข็มนาฬิกา */
export function fovPath(fov: number): string {
  const half = (Math.min(Math.max(fov, 1), 359) / 2) * (Math.PI / 180);
  const x1 = 55 + 55 * Math.sin(-half);
  const y1 = 55 - 55 * Math.cos(-half);
  const x2 = 55 + 55 * Math.sin(half);
  const y2 = 55 - 55 * Math.cos(half);
  return `M55,55 L${x1.toFixed(1)},${y1.toFixed(1)} A55,55 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
}

export const DEFAULT_FOV = 90;

/** อุปกรณ์ที่ตั้งทิศได้: ประเภท camera, ไอคอนกล้อง หรือเคยตั้งทิศไว้แล้ว */
export function isCameraLike(typeKey: string, typeIcon: string | undefined, direction: unknown): boolean {
  return (
    typeKey === 'camera' ||
    ['lucide:Cctv', 'lucide:Camera', 'lucide:Video'].includes(typeIcon || '') ||
    (direction != null && direction !== '')
  );
}

/** มุมจากจุดศูนย์กลางไปยังเมาส์ — 0° = ขึ้น, ตามเข็มนาฬิกา (Shift = ทีละ 15°) */
export function angleFrom(cx: number, cy: number, x: number, y: number, snap = false): number {
  let deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  if (snap) deg = Math.round(deg / 15) * 15;
  return Math.round(((deg % 360) + 360) % 360);
}
const PRESETS: { label: string; deg: number }[] = [
  { label: '↑', deg: 0 },
  { label: '↗', deg: 45 },
  { label: '→', deg: 90 },
  { label: '↘', deg: 135 },
  { label: '↓', deg: 180 },
  { label: '↙', deg: 225 },
  { label: '←', deg: 270 },
  { label: '↖', deg: 315 },
];
const FOV_PRESETS = [60, 90, 120, 180, 360];

interface DirectionDialProps {
  /** ค่าเป็น string ตามฟอร์ม ('' = ไม่ระบุ) */
  direction: string;
  fov: string;
  onChange: (direction: string, fov: string) => void;
}

/** ตัวตั้งทิศกล้อง: ลาก/คลิกบนวงกลมเพื่อหมุน, ปรับ FOV ด้วยแถบเลื่อน — ทิศอิงแผนผัง (0° = ด้านบนของรูป) */
export function DirectionDial({ direction, fov, onChange }: DirectionDialProps) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const has = direction.trim() !== '';
  const dir = has ? Number(direction) || 0 : 0;
  const fovNum = fov.trim() !== '' ? Number(fov) || DEFAULT_FOV : DEFAULT_FOV;

  // เลือกทิศแล้วยังไม่มี FOV → ใส่ค่าเริ่มต้นให้ ไม่งั้นจะไม่แสดงบนแผนผัง
  const setDir = (d: number) => onChange(String(Math.round(((d % 360) + 360) % 360)), fov.trim() === '' ? String(DEFAULT_FOV) : fov);
  const setFov = (f: number) => onChange(has ? direction : '0', String(f));

  const fromPointer = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15; // Shift = ทีละ 15°
    setDir(deg);
  };

  const knob = {
    x: 70 + 52 * Math.sin((dir * Math.PI) / 180),
    y: 70 - 52 * Math.cos((dir * Math.PI) / 180),
  };

  return (
    <div className="dir-dial">
      <svg
        ref={ref}
        className={'dir-dial-svg' + (has ? '' : ' unset')}
        viewBox="0 0 140 140"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        role="slider"
        aria-label="ทิศกล้อง"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={dir}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 1;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            setDir(dir + step);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            setDir(dir - step);
          }
        }}
      >
        <circle cx="70" cy="70" r="62" className="dir-ring" />
        {[0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1={70 + 56 * Math.sin((a * Math.PI) / 180)}
            y1={70 - 56 * Math.cos((a * Math.PI) / 180)}
            x2={70 + 62 * Math.sin((a * Math.PI) / 180)}
            y2={70 - 62 * Math.cos((a * Math.PI) / 180)}
            className="dir-tick"
          />
        ))}
        <g transform={`translate(15 15) rotate(${dir} 55 55)`}>
          <path d={fovPath(fovNum)} className="dir-wedge" />
        </g>
        <line x1="70" y1="70" x2={knob.x} y2={knob.y} className="dir-arm" />
        <circle cx="70" cy="70" r="7" className="dir-center" />
        <circle cx={knob.x} cy={knob.y} r="8" className="dir-knob" />
        <text x="70" y="12" className="dir-label">บน</text>
      </svg>

      <div className="dir-side">
        <div className="dir-value">
          <span>
            ทิศ <b className="mono">{has ? `${dir}°` : '—'}</b>
          </span>
          <span>
            FOV <b className="mono">{has ? `${fovNum}°` : '—'}</b>
          </span>
        </div>
        <div className="dir-presets" title="ทิศลัด (อิงด้านบนของแผนผัง)">
          {PRESETS.map((p) => (
            <button key={p.deg} type="button" className={has && dir === p.deg ? 'active' : ''} onClick={() => setDir(p.deg)}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="dir-fov">
          มุมมอง (FOV)
          <input
            type="range"
            min={10}
            max={360}
            step={5}
            value={fovNum}
            onChange={(e) => setFov(Number(e.target.value))}
          />
        </label>
        <div className="dir-presets fov">
          {FOV_PRESETS.map((f) => (
            <button key={f} type="button" className={has && fovNum === f ? 'active' : ''} onClick={() => setFov(f)}>
              {f}°
            </button>
          ))}
        </div>
        <div className="dir-foot">
          <span className="hint">ลากบนวงกลมเพื่อหมุน · Shift = ทีละ 15°</span>
          {has && (
            <button type="button" className="dir-clear" onClick={() => onChange('', '')}>
              ล้างทิศ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
