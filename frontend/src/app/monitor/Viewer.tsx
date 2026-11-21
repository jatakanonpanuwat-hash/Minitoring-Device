import { useEffect, useRef, useState } from 'react';
import { Check, Lock, Maximize, Minus, Move, Plus, X, MapPinOff } from 'lucide-react';
import { cn } from '../components/ui/utils';
import { formatAgo } from '../types/monitor';
import type { Device, MapItem } from '../types/monitor';
import type { ViewMode } from './TopBar';
import { DEFAULT_FOV, angleFrom, fovPath, isCameraLike } from './DirectionDial';
import { EMPTY_PLACE_FORM, PlacePanel, type PlaceForm } from './PlacePanel';
import { useAuth } from './auth';
import { CatalogIcon, StatusPill, findStatus, findType, findZone, resolveUploadUrl, useCatalog } from './catalog';

export interface MapView {
  k: number;
  x: number;
  y: number;
}

interface ViewerProps {
  map: MapItem | null;
  devices: Device[];
  /** อุปกรณ์ทั้งหมดในระบบ (ทุกแผนผัง) — ใช้รวบรวมวงแลนในแผงวางอุปกรณ์ */
  allDevices?: Device[];
  mode: ViewMode;
  selectedId: string | null;
  /** แจ้งระดับซูมหลังหยุดซูม (ใช้แสดงที่ bottom bar) */
  onViewChange?: (k: number) => void;
  /** ขอให้ซูมไปที่อุปกรณ์ (n เปลี่ยนทุกครั้งที่ขอ — กดซ้ำตัวเดิมก็ซูมใหม่) */
  focus?: { id: string; n: number } | null;
  onSelect: (d: Device) => void;
  /** บันทึกอุปกรณ์ที่วางใหม่ — คืนข้อความ error หรือ null */
  onConfirmPlace: (data: Partial<Device>, x: number, y: number) => Promise<string | null>;
  onPreviewMove: (id: string, x: number, y: number) => void;
  onCommitMove: (id: string, x: number, y: number) => void;
  /** หมุนทิศกล้องบนแผนผัง (โหมดย้าย) — บันทึกตอนปล่อยเมาส์ */
  onCommitRotate: (id: string, direction: number, fov: number) => void;
  /** สลับโหมด เพิ่ม / ย้าย อุปกรณ์ (แถบเครื่องมือบนแผนผัง) */
  onMode: (m: ViewMode) => void;
  /** ปุ่ม "ยกเลิก" บนแถบเครื่องมือ (โหมดย้าย/หมุน = คืนค่าทั้งรอบ) */
  onCancelEdit?: () => void;
  /** จำนวนการแก้ในรอบย้าย/หมุนปัจจุบัน */
  editCount?: number;
  /** กำลังวางอุปกรณ์ที่มีอยู่แล้วแต่ยังไม่มีตำแหน่ง (โหมด place แบบไม่ใช้ฟอร์ม) */
  placing?: Device | null;
  /** บันทึกตำแหน่งให้อุปกรณ์ที่กำลังวาง — คืนข้อความ error หรือ null */
  onConfirmPlaceExisting?: (id: string, x: number, y: number) => Promise<string | null>;
  /** เปิดฟอร์มเพิ่มอุปกรณ์แบบไม่วางบนแผนผัง */
  onAddUnplaced?: () => void;
  /** เอาหมุดออกจากแผนผัง (ตั้งเป็น "ไม่แสดงบนแผนผัง") — ปุ่ม × บนหมุดในโหมดย้าย */
  onRemoveFromMap?: (d: Device) => void;
}

type Gesture =
  | { type: null }
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { type: 'pinch'; dist: number; cx: number; cy: number; start: MapView }
  | { type: 'marker'; id: string; sx: number; sy: number; moved: boolean }
  | { type: 'rotate'; id: string; cx: number; cy: number; fov: number };

// ขอบที่แผนผังต้องเหลืออยู่ในจอเสมอ (px) — กันลากหลุดจอ
const KEEP_VISIBLE = 120;

export function Viewer(props: ViewerProps) {
  const { map, devices, mode, selectedId, onViewChange } = props;
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const imgSize = useRef({ w: 1000, h: 600 });
  const fittedMap = useRef('');
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  // ทิศที่กำลังหมุนอยู่ (แสดงทันทีระหว่างลาก ก่อนบันทึก)
  const [rotating, setRotating] = useState<{ id: string; dir: number; fov: number } | null>(null);
  const catalog = useCatalog();
  const { canEdit, requestLogin } = useAuth();

  // ---------- วางอุปกรณ์ใหม่ (แผง PlacePanel) ----------
  // ประเภทเริ่มต้น = ประเภทที่ใช้ครั้งล่าสุด → camera → ประเภทแรก
  const lastType = () => {
    let t = 'camera';
    try {
      t = localStorage.getItem('monitoring-device:last-place-type') || 'camera';
    } catch {
      /* ignore */
    }
    return catalog.types.some((x) => x.key === t) ? t : catalog.types[0]?.key || '';
  };
  const [placeForm, setPlaceFormState] = useState<PlaceForm>(EMPTY_PLACE_FORM);
  const setPlaceForm = (f: PlaceForm) => {
    if (f.device_type !== placeForm.device_type) {
      try {
        localStorage.setItem('monitoring-device:last-place-type', f.device_type);
      } catch {
        /* ignore */
      }
    }
    setPlaceFormState(f);
  };
  const [placeSaving, setPlaceSaving] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const placeType = placeForm.device_type || lastType();

  // เข้าโหมดเพิ่ม → เริ่มฟอร์มใหม่ (ชั้นดึงจากแผนผังตอนบันทึก ไม่ต้องเก็บในฟอร์ม)
  useEffect(() => {
    if (mode === 'place') {
      setPlaceFormState({ ...EMPTY_PLACE_FORM, device_type: lastType() });
      setPlaceError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ออกจากโหมดเพิ่ม → ล้างจุดที่ค้างไว้; กด Esc = ยกเลิกจุด / ออกจากโหมด
  useEffect(() => {
    if (mode !== 'place') setPending(null);
    if (mode === 'view') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.cctv-app .modal')) return; // มีหน้าต่างเปิดอยู่ — ให้หน้าต่างจัดการเอง
      if (mode === 'place' && pending) setPending(null);
      else props.onMode('view');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pending]);

  // วางอุปกรณ์เดิมที่ยังไม่มีตำแหน่ง
  const placing = mode === 'place' ? props.placing || null : null;
  const confirmPlaceExisting = async () => {
    if (!placing || !pending || placeSaving || !props.onConfirmPlaceExisting) return;
    setPlaceSaving(true);
    setPlaceError('');
    const err = await props.onConfirmPlaceExisting(placing.id, pending.x, pending.y);
    setPlaceSaving(false);
    if (err) setPlaceError(err);
    else setPending(null);
  };
  // Enter = ยืนยันตำแหน่ง
  useEffect(() => {
    if (!placing || !pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !document.querySelector('.cctv-app .modal')) confirmPlaceExisting();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing, pending, placeSaving]);

  const confirmPlace = async () => {
    if (!pending || !placeForm.name.trim() || placeSaving) return;
    const f = placeForm;
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const opt = (v: string) => (v.trim() === '' ? null : v.trim());
    const data: Partial<Device> = {
      name: f.name.trim(),
      device_type: placeType,
      zone: opt(f.zone),
      floor: map?.floor || null,
      ip_address: opt(f.ip_address),
      lan: opt(f.lan),
      cabinet: opt(f.cabinet),
      install_area: opt(f.install_area),
      install_detail: opt(f.install_detail),
      requested_by: opt(f.requested_by),
      direction: num(f.direction),
      fov_angle: num(f.fov_angle),
      remark: opt(f.remark),
    };
    setPlaceSaving(true);
    setPlaceError('');
    const err = await props.onConfirmPlace(data, pending.x, pending.y);
    setPlaceSaving(false);
    if (err) setPlaceError(err);
    else setPending(null);
  };

  // ค่าซูม/ตำแหน่งเก็บใน ref แล้วเขียน transform ลง DOM ตรง ๆ ทีละเฟรม
  // — ลาก/ซูมไม่ทำให้ React render ใหม่ทั้งแอป และไม่มีค่าเก่าค้างเวลาหมุนล้อเร็ว ๆ
  const view = useRef<MapView>({ k: 0.6, x: 40, y: 24 });
  const limits = useRef({ min: 0.05, max: 4 });
  const frame = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const gesture = useRef<Gesture>({ type: null });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const markerMove = useRef<{ id: string; x: number; y: number } | null>(null);
  // ซูมแบบนุ่ม: เก็บ "ค่าซูมเป้าหมาย" + จุดยึด แล้วค่อย ๆ ไล่ไปทีละเฟรม (แทนการกระโดดทีละ 16%)
  const zoomAnim = useRef<{ k: number; px: number; py: number } | null>(null);
  const lastTs = useRef(0);
  const reportedK = useRef(0);
  // ขนาด viewer เก็บไว้ใน ref (อัปเดตจาก ResizeObserver) — ไม่ต้องเรียก getBoundingClientRect ทุก event
  // ซึ่งบังคับให้เบราว์เซอร์คำนวณ layout ใหม่กลางการซูม
  const viewerRect = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const getViewerRect = () => {
    if (!viewerRect.current && viewerRef.current) {
      const r = viewerRef.current.getBoundingClientRect();
      viewerRect.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return viewerRect.current;
  };

  const clampView = (v: MapView): MapView => {
    const rect = getViewerRect();
    if (!rect) return v;
    const w = imgSize.current.w * v.k;
    const h = imgSize.current.h * v.k;
    const keepX = Math.min(KEEP_VISIBLE, w);
    const keepY = Math.min(KEEP_VISIBLE, h);
    return {
      k: v.k,
      x: Math.min(Math.max(v.x, keepX - w), rect.width - keepX),
      y: Math.min(Math.max(v.y, keepY - h), rect.height - keepY),
    };
  };

  const render = () => {
    frame.current = 0;
    const v = view.current;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.k})`;
      // หมุดอ่านค่านี้ (CSS variable สืบทอดลงไป) เพื่อคงขนาดเท่าเดิมบนจอ
      canvas.style.setProperty('--inv-scale', String(1 / v.k));
    }
    viewerRef.current?.classList.toggle('labels-auto', v.k < limits.current.min * 2.8);
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(v.k * 100)}%`;
    if (markerMove.current) {
      const m = markerMove.current;
      props.onPreviewMove(m.id, m.x, m.y);
      markerMove.current = null;
    }
  };

  // หนึ่งเฟรมของแอนิเมชันซูม: ไล่ log(k) เข้าหาเป้าหมายแบบ exponential (τ ≈ 70ms) รอบจุดยึด
  const tick = (ts: number) => {
    const a = zoomAnim.current;
    if (a) {
      const dt = Math.min(lastTs.current ? ts - lastTs.current : 16, 50);
      lastTs.current = ts;
      const cur = view.current;
      const t = 1 - Math.exp(-dt / 70);
      const done = Math.abs(Math.log(a.k / cur.k)) < 0.002;
      const k = done ? a.k : Math.exp(Math.log(cur.k) + (Math.log(a.k) - Math.log(cur.k)) * t);
      const s = k / cur.k;
      view.current = clampView({ k, x: a.px - (a.px - cur.x) * s, y: a.py - (a.py - cur.y) * s });
      markInteracting();
      if (done) {
        zoomAnim.current = null;
        lastTs.current = 0;
      }
    }
    render();
    if (zoomAnim.current) frame.current = requestAnimationFrame(tick);
  };

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  };

  // ระหว่างลาก/ซูมให้ GPU ถือภาพไว้ (ลื่น) — หยุดแล้วปล่อยให้เบราว์เซอร์วาดใหม่ที่ความละเอียดจริง (คมชัด)
  const markInteracting = () => {
    viewerRef.current?.classList.add('interacting');
    clearTimeout(settleTimer.current);
    // 300ms: หมุนล้อต่อเนื่อง (มีช่วงหยุดสั้น ๆ ระหว่างคลิก) จะไม่สลับ layer GPU ไปมาจนภาพกระตุก
    settleTimer.current = setTimeout(() => {
      viewerRef.current?.classList.remove('interacting');
      // แจ้งแอปเฉพาะเมื่อค่าซูมเปลี่ยนจริง (กัน render ทั้งแอปโดยไม่จำเป็น)
      if (Math.abs(view.current.k - reportedK.current) > 1e-4) {
        reportedK.current = view.current.k;
        onViewChange?.(view.current.k);
      }
    }, 300);
  };

  const setView = (v: MapView) => {
    zoomAnim.current = null; // ลาก/pinch/fit = ควบคุมตรง ยกเลิกแอนิเมชันที่ค้าง
    lastTs.current = 0;
    view.current = clampView(v);
    markInteracting();
    schedule();
  };

  // ซูมแบบนุ่ม (ล้อเมาส์ / ปุ่ม +− / ดับเบิลคลิก) — ซ้อนหลายคลิกได้ เพราะคูณจากค่าเป้าหมายเดิม
  const zoomSmooth = (clientX: number, clientY: number, factor: number) => {
    const rect = getViewerRect();
    if (!rect) return;
    const fromK = zoomAnim.current?.k ?? view.current.k;
    const k = Math.min(Math.max(fromK * factor, limits.current.min), limits.current.max);
    zoomAnim.current = { k, px: clientX - rect.left, py: clientY - rect.top };
    markInteracting();
    schedule();
  };

  const zoomAt = (clientX: number, clientY: number, factor: number, from: MapView = view.current) => {
    const rect = getViewerRect()!;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const k = Math.min(Math.max(from.k * factor, limits.current.min), limits.current.max);
    const s = k / from.k;
    setView({ k, x: px - (px - from.x) * s, y: py - (py - from.y) * s });
  };

  const zoomCenter = (factor: number) => {
    const r = getViewerRect();
    if (r) zoomSmooth(r.left + r.width / 2, r.top + r.height / 2, factor);
  };

  const fit = () => {
    const rect = getViewerRect();
    if (!rect || rect.width === 0) return;
    const fitK = Math.min(rect.width / imgSize.current.w, rect.height / imgSize.current.h) * 0.96;
    // ซูมออกได้ถึงครึ่งหนึ่งของขนาดพอดีจอ ซูมเข้าได้ถึง 4 เท่าของ pixel จริง (รูปเล็กอย่างน้อย 8 เท่าของพอดีจอ)
    limits.current = { min: fitK * 0.5, max: Math.max(4, fitK * 8) };
    setView({
      k: fitK,
      x: (rect.width - imgSize.current.w * fitK) / 2,
      y: (rect.height - imgSize.current.h * fitK) / 2,
    });
  };

  // ซูมไปที่อุปกรณ์ (เช่นกด "ไปที่กล้อง" จาก TABLE_IP) — ถ้ารูปแผนผังยังโหลดไม่เสร็จ รอทำหลัง onLoad
  const pendingFocus = useRef<string | null>(null);
  const applyFocus = (id: string) => {
    const d = devices.find((x) => x.id === id);
    const rect = getViewerRect();
    if (!d || d.x_percent == null || d.y_percent == null || !rect) return false;
    const fitK = limits.current.min * 2;
    const k = Math.min(Math.max(view.current.k, fitK * 4), limits.current.max);
    setView({
      k,
      x: rect.width / 2 - (imgSize.current.w * k * d.x_percent) / 100,
      y: rect.height / 2 - (imgSize.current.h * k * d.y_percent) / 100,
    });
    return true;
  };
  useEffect(() => {
    if (!props.focus || !map) return;
    if (fittedMap.current === map.map_id && applyFocus(props.focus.id)) pendingFocus.current = null;
    else pendingFocus.current = props.focus.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus, map?.map_id]);

  // wheel ต้องเป็น listener แบบ non-passive ถึงจะ preventDefault ได้
  // (กัน trackpad pinch / ctrl+ล้อ ไปซูมทั้งหน้าเบราว์เซอร์)
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !map) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.place-banner, .zoom-bar, .place-panel')) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1; // line / page → px
      const dy = e.deltaY * unit;
      // ซูมตามระยะที่หมุนจริง: ล้อเมาส์ 1 คลิก (~100px) ≈ 16%, trackpad ซูมละเอียดตามนิ้ว
      const sensitivity = e.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.min(Math.max(Math.exp(-dy * sensitivity), 0.5), 2);
      // trackpad / pinch ส่ง event ถี่และละเอียดอยู่แล้ว → ตามนิ้วทันที
      // ล้อเมาส์ (ทีละคลิกใหญ่ ๆ) → แอนิเมชันนุ่ม
      const isTrackpad = e.ctrlKey || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40);
      if (isTrackpad && !zoomAnim.current) zoomAt(e.clientX, e.clientY, factor);
      else zoomSmooth(e.clientX, e.clientY, factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // ขนาดหน้าต่าง/แผงข้างเปลี่ยน — ดึงแผนผังกลับเข้าจอ
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      viewerRect.current = null; // วัดใหม่ครั้งถัดไป
      view.current = clampView(view.current);
      schedule();
    });
    ro.observe(el);
    const invalidate = () => (viewerRect.current = null);
    window.addEventListener('resize', invalidate);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', invalidate);
      cancelAnimationFrame(frame.current);
      clearTimeout(settleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // หลัง React render ใหม่ (เช่นรายการหมุดเปลี่ยน) ให้ transform ยังอยู่ — React ไม่ได้ถือค่านี้
  useEffect(() => {
    render();
  });

  const toPercent = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const r = (v: number) => Math.min(Math.max(Math.round(v * 100) / 100, 0), 100);
    return { x: r(((clientX - rect.left) / rect.width) * 100), y: r(((clientY - rect.top) / rect.height) * 100) };
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      start: { ...view.current },
    };
  };

  const onViewerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      startPinch();
    } else if (pointers.current.size === 1) {
      gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.current.x, oy: view.current.y, moved: false };
    }
  };

  const onViewerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      // ซูมรอบจุดกึ่งกลางนิ้ว + เลื่อนตามนิ้ว
      const shifted = { ...g.start, x: g.start.x + (cx - g.cx), y: g.start.y + (cy - g.cy) };
      zoomAt(cx, cy, dist / g.dist, shifted);
    } else if (g.type === 'pan') {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      if (g.moved) setView({ k: view.current.k, x: g.ox + dx, y: g.oy + dy });
    } else if (g.type === 'rotate') {
      setRotating({ id: g.id, dir: angleFrom(g.cx, g.cy, e.clientX, e.clientY, e.shiftKey), fov: g.fov });
    } else if (g.type === 'marker' && canvasRef.current) {
      if (!g.moved && Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 3) g.moved = true;
      if (g.moved) {
        markerMove.current = { id: g.id, ...toPercent(e.clientX, e.clientY) };
        schedule();
      }
    }
  };

  const onViewerUp = (e: React.PointerEvent) => {
    const wasPinch = gesture.current.type === 'pinch';
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (wasPinch) {
      // ยกนิ้วหนึ่งนิ้ว — ต่อด้วยการลากด้วยนิ้วที่เหลือ (ไม่นับเป็นคลิกวาง)
      const rest = [...pointers.current.values()][0];
      gesture.current = rest
        ? { type: 'pan', sx: rest.x, sy: rest.y, ox: view.current.x, oy: view.current.y, moved: true }
        : { type: null };
      return;
    }
    gesture.current = { type: null };
    if (g.type === 'rotate') {
      const dir = angleFrom(g.cx, g.cy, e.clientX, e.clientY, e.shiftKey);
      setRotating(null);
      if (e.type !== 'pointercancel') props.onCommitRotate(g.id, dir, g.fov);
      return;
    }
    if (!map || !canvasRef.current || e.type === 'pointercancel') return;
    if (g.type === 'pan' && !g.moved && mode === 'place') {
      setPending(toPercent(e.clientX, e.clientY));
    } else if (g.type === 'marker' && g.moved) {
      const { x, y } = toPercent(e.clientX, e.clientY);
      props.onCommitMove(g.id, x, y);
    }
  };

  // จับที่จับหมุน — จุดศูนย์กลางคือตำแหน่งของหมุดบนจอ
  const onRotateDown = (e: React.PointerEvent, cam: Device) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const marker = (e.currentTarget as HTMLElement).closest('.dev-marker') as HTMLElement;
    const r = marker.getBoundingClientRect();
    const fov = cam.fov_angle != null ? Number(cam.fov_angle) : DEFAULT_FOV;
    gesture.current = { type: 'rotate', id: cam.id, cx: r.left + r.width / 2, cy: r.top + r.height / 2, fov };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setRotating({ id: cam.id, dir: Number(cam.direction) || 0, fov });
  };

  const onMarkerDown = (e: React.PointerEvent, cam: Device) => {
    e.stopPropagation();
    if (mode === 'move') {
      gesture.current = { type: 'marker', id: cam.id, sx: e.clientX, sy: e.clientY, moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (mode === 'view') {
      props.onSelect(cam);
    }
  };



  return (
    <div
      ref={viewerRef}
      className={cn('viewer', mode === 'place' && 'place-mode', mode === 'move' && 'move-mode')}
      onPointerDown={onViewerDown}
      onPointerMove={onViewerMove}
      onPointerUp={onViewerUp}
      onPointerCancel={onViewerUp}
      onDoubleClick={(e) => {
        if (map && mode === 'view' && !(e.target as HTMLElement).closest('.place-banner, .zoom-bar, .map-tools, .place-panel, .dev-marker')) {
          zoomSmooth(e.clientX, e.clientY, 2);
        }
      }}
    >
      {map ? (
        <div ref={canvasRef} className="map-canvas">
          <div style={{ position: 'relative' }}>
            <img
              src={resolveUploadUrl(map.image_url)}
              alt={map.map_name}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                imgSize.current = { w: img.naturalWidth, h: img.naturalHeight };
                // พอดีจออัตโนมัติเมื่อเปลี่ยนแผนผัง หรือเปลี่ยนรูปแผนผังเดิม (URL ใหม่)
                const fitKey = map ? `${map.map_id}|${map.image_url}` : '';
                if (map && fittedMap.current !== fitKey) {
                  fittedMap.current = fitKey;
                  fit();
                  if (pendingFocus.current && applyFocus(pendingFocus.current)) pendingFocus.current = null;
                }
              }}
            />
            {placing && pending && (
              // หมุดของอุปกรณ์เดิมที่กำลังวาง
              <div className="place-pin" style={{ left: `${pending.x}%`, top: `${pending.y}%` }}>
                {placing.direction != null && (
                  <div className="cam-fov-container place-pin-fov" style={{ '--dir': `${Number(placing.direction) || 0}deg` } as React.CSSProperties}>
                    <svg className="cam-fov-svg" viewBox="0 0 110 110">
                      <path d={fovPath(Number(placing.fov_angle) || DEFAULT_FOV)} className="cam-fov-wedge" />
                    </svg>
                  </div>
                )}
                <span className="place-pin-pulse" />
                <span className="place-pin-badge">
                  <CatalogIcon icon={findType(catalog, placing.device_type).icon} size={14} />
                </span>
                <span className="place-pin-label">{placing.name}</span>
              </div>
            )}
            {mode === 'place' && !placing && pending && (
              // หมุดแสดงจุดที่จะวางอุปกรณ์ใหม่ (คลิกที่อื่นเพื่อเปลี่ยนตำแหน่ง)
              <div className="place-pin" style={{ left: `${pending.x}%`, top: `${pending.y}%` }}>
                {placeForm.direction !== '' && (
                  // ตัวอย่างทิศ/มุมมองตามที่ตั้งในแผง
                  <div className="cam-fov-container place-pin-fov" style={{ '--dir': `${Number(placeForm.direction) || 0}deg` } as React.CSSProperties}>
                    <svg className="cam-fov-svg" viewBox="0 0 110 110">
                      <path d={fovPath(Number(placeForm.fov_angle) || DEFAULT_FOV)} className="cam-fov-wedge" />
                    </svg>
                  </div>
                )}
                <span className="place-pin-pulse" />
                <span className="place-pin-badge">
                  <CatalogIcon icon={findType(catalog, placeType).icon} size={14} />
                </span>
                <span className="place-pin-label">{placeForm.name.trim() || 'อุปกรณ์ใหม่'}</span>
              </div>
            )}
            {devices.map((d) => {
              if (d.x_percent == null || d.y_percent == null) return null;
              const t = findType(catalog, d.device_type);
              const st = findStatus(catalog, d.status);
              const zone = findZone(catalog, d.zone);
              const problem = d.status === 'offline' || d.status === 'warning';
              const rot = rotating?.id === d.id ? rotating : null;
              const dirShown = rot ? rot.dir : d.direction;
              const fovShown = rot ? rot.fov : d.fov_angle;
              const canRotate = mode === 'move' && isCameraLike(d.device_type, t.icon, d.direction);
              return (
                <div
                  key={d.id}
                  className={cn('dev-marker', `st-${d.status}`, selectedId === d.id && 'selected', rot && 'rotating', canRotate && 'can-rotate')}
                  style={{ left: `${d.x_percent}%`, top: `${d.y_percent}%`, '--c': st.color } as React.CSSProperties}
                  onPointerDown={(e) => onMarkerDown(e, d)}
                >
                  {dirShown != null && fovShown != null && (
                    <div className="cam-fov-container" style={{ '--dir': `${dirShown}deg` } as React.CSSProperties}>
                      <svg className="cam-fov-svg" viewBox="0 0 110 110">
                        <path d={fovPath(Number(fovShown))} className="cam-fov-wedge" />
                      </svg>
                    </div>
                  )}
                  {canRotate && (
                    // ที่จับหมุนทิศ: ลากรอบหมุดเพื่อหมุน (Shift = ทีละ 15°)
                    <div
                      className={cn('cam-rotate', d.direction == null && !rot && 'unset')}
                      style={{ '--dir': `${Number(dirShown) || 0}deg` } as React.CSSProperties}
                    >
                      <span className="cam-rotate-arm" />
                      <span
                        className="cam-rotate-handle"
                        title="ลากเพื่อหมุนทิศกล้อง (Shift = ทีละ 15°)"
                        onPointerDown={(e) => onRotateDown(e, d)}
                      />
                    </div>
                  )}
                  {rot && <span className="cam-rotate-deg mono">{rot.dir}°</span>}
                  {mode === 'move' && props.onRemoveFromMap && !rot && (
                    // เอาหมุดออกจากแผนผัง — ไม่ให้กดแล้วกลายเป็นเริ่มลากหมุด
                    <button
                      className="dev-remove"
                      title="เอาออกจากแผนผัง"
                      aria-label={`เอา ${d.name} ออกจากแผนผัง`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRemoveFromMap?.(d);
                      }}
                    >
                      <X />
                    </button>
                  )}
                  {problem && <span className="dev-pulse" />}
                  <span className="dev-badge">
                    <CatalogIcon icon={t.icon} />
                  </span>
                  <span className="dev-label">
                    <span>{d.name}</span>
                  </span>
                  <div className="dev-tip">
                    <div className="dev-tip-head">
                      <b>{d.name}</b>
                      <StatusPill status={d.status} />
                    </div>
                    <div className="dev-tip-row">
                      <span>ประเภท</span>
                      <span>{t.label}</span>
                    </div>
                    <div className="dev-tip-row">
                      <span>IP</span>
                      <span className="mono">{d.ip_address || '—'}</span>
                    </div>
                    {d.last_latency_ms != null && (
                      <div className="dev-tip-row">
                        <span>Latency</span>
                        <span className="mono">{d.last_latency_ms} ms</span>
                      </div>
                    )}
                    <div className="dev-tip-row">
                      <span>พบล่าสุด</span>
                      <span>{formatAgo(d.last_seen)}</span>
                    </div>
                    {zone && (
                      <div className="dev-tip-row">
                        <span>โซน</span>
                        <span>{zone.label}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="viewer-empty">
          <p>
            ยังไม่มีแผนผัง
            <br />
            เปิดแท็บ Map จากเมนูซ้ายเพื่ออัปโหลดรูปแผนผัง
          </p>
        </div>
      )}

      {placing && map && (
        // แถบวางอุปกรณ์เดิม — คลิกจุด แล้วกดยืนยัน
        <div className="place-banner place-existing" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <CatalogIcon icon={findType(catalog, placing.device_type).icon} size={14} />
          <b className="pe-name">{placing.name}</b>
          {pending ? (
            <>
              <span className="place-pos">
                {pending.x.toFixed(1)}%, {pending.y.toFixed(1)}%
              </span>
              <button disabled={placeSaving} onClick={confirmPlaceExisting}>
                {placeSaving ? 'กำลังบันทึก...' : 'ยืนยันตำแหน่ง'}
              </button>
            </>
          ) : (
            <span className="pe-hint">คลิกบนแผนผังตรงจุดที่ต้องการวาง</span>
          )}
          <button className="pe-cancel" onClick={() => props.onMode('view')}>
            ยกเลิก
          </button>
          {placeError && <span className="pe-error">{placeError}</span>}
        </div>
      )}

      {mode === 'place' && !placing && map && (
        <>
          {!pending && (
            <div className="place-banner place-banner-left" onPointerDown={(e) => e.stopPropagation()}>
              <span>คลิกบนแผนผังตรงจุดที่ต้องการวางอุปกรณ์ · Esc เพื่อออก</span>
            </div>
          )}
          <PlacePanel
            form={{ ...placeForm, device_type: placeType }}
            onForm={setPlaceForm}
            mapFloor={map?.floor || null}
            pending={pending}
            saving={placeSaving}
            error={placeError}
            onSave={confirmPlace}
            onCancel={() => props.onMode('view')}
            allDevices={props.allDevices ?? devices}
          />
        </>
      )}

      {mode === 'move' && map && (
        <div className="place-banner" onPointerDown={(e) => e.stopPropagation()}>
          <span>ลากอุปกรณ์เพื่อย้าย · ลากจุดฟ้ารอบกล้องเพื่อหมุนทิศ (บันทึกอัตโนมัติ) · Esc เพื่อออก</span>
        </div>
      )}

      {map && (
        // แถบเครื่องมือแก้ไขบนแผนผัง — เพิ่ม / ย้าย อุปกรณ์
        <div className="map-tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {!canEdit ? (
            <button className="map-tool" title="เข้าสู่ระบบเพื่อเพิ่ม / ย้ายอุปกรณ์" onClick={requestLogin}>
              <Lock /> เข้าสู่ระบบเพื่อแก้ไข
            </button>
          ) : mode === 'view' ? (
            <>
              <button className="map-tool primary" title="เพิ่มอุปกรณ์ - คลิกบนแผนผังเพื่อวาง" onClick={() => props.onMode('place')}>
                <Plus /> เพิ่มอุปกรณ์
              </button>
              {props.onAddUnplaced && (
                <button
                  className="map-tool"
                  title="เพิ่มอุปกรณ์ที่ไม่ต้องวางบนแผนผัง (เช่น สวิตช์ / NVR ในห้อง server)"
                  onClick={props.onAddUnplaced}
                >
                  <MapPinOff /> เพิ่มแบบไม่วาง
                </button>
              )}
              <button className="map-tool" title="ย้ายอุปกรณ์ / หมุนทิศกล้อง / เอาออกจากแผนผัง" onClick={() => props.onMode('move')}>
                <Move /> ย้าย / หมุน
              </button>
            </>
          ) : (
            <>
              <span className="map-tool-state">
                {mode === 'place' ? <Plus /> : <Move />}
                {placing ? 'วางอุปกรณ์บนแผนผัง' : mode === 'place' ? 'โหมดเพิ่มอุปกรณ์' : 'โหมดย้าย / หมุน'}
              </span>
              {mode === 'move' && (props.editCount || 0) > 0 && (
                <span className="map-tool-count" title="จำนวนการย้าย / หมุนในรอบนี้ (บันทึกแล้ว)">
                  แก้ {props.editCount}
                </span>
              )}
              <button
                className="map-tool cancel"
                title={
                  mode === 'move'
                    ? 'ยกเลิก — คืนตำแหน่ง / ทิศทุกตัวที่ย้ายในรอบนี้ แล้วออก'
                    : 'ยกเลิก — ออกโดยไม่บันทึก'
                }
                onClick={() => (props.onCancelEdit ? props.onCancelEdit() : props.onMode('view'))}
              >
                <X /> ยกเลิก
              </button>
              {mode === 'move' && (
                <button className="map-tool done" title="บันทึกและออกจากโหมด (Esc)" onClick={() => props.onMode('view')}>
                  <Check /> เสร็จสิ้น
                </button>
              )}
            </>
          )}
        </div>
      )}

      {map && (
        <div className="zoom-bar" onPointerDown={(e) => e.stopPropagation()}>
          <button title="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>
            <Minus />
          </button>
          <span className="zoom-label" ref={zoomLabelRef} />
          <button title="Zoom in" onClick={() => zoomCenter(1.25)}>
            <Plus />
          </button>
          <button title="พอดีจอ (ดับเบิลคลิกบนแผนผังเพื่อซูมเข้า)" onClick={fit}>
            <Maximize />
          </button>
        </div>
      )}
    </div>
  );
}

