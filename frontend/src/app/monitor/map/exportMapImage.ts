// Export แผนผังเป็นรูป PNG พร้อมหมุดอุปกรณ์ (กรวยมุมกล้อง, ไอคอน, ชื่อ) + หัวรูปชื่อแผนผัง/วันที่/สรุปสถานะ
// วาดเองบน canvas ที่ความละเอียดเต็มของรูปแผนผัง — หน้าตาหมุดเลียนแบบ .dev-marker ใน styles/monitor.css
import { createElement } from 'react';
import { Box } from 'lucide-react';
import type { Catalog, Device, MapItem } from '../../types/monitor';
import { ICONS, findStatus, findType, resolveUploadUrl } from '../shared/catalog';
import { layoutMarkers } from './exportLayout';

// ด้านยาวสุดของรูปที่ export — กัน canvas ใหญ่เกินที่เบราว์เซอร์รับได้
const MAX_SIDE = 8000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`โหลดรูปไม่ได้: ${src}`));
    img.src = src;
  });
}

// ไอคอนประเภทอุปกรณ์ → รูปที่วาดบน canvas ได้ (lucide = แปลงเป็น SVG สีขาว, ไอคอนอัปโหลด = โหลดรูป)
async function loadIcon(icon: string | undefined): Promise<HTMLImageElement | null> {
  try {
    if (icon && !icon.startsWith('lucide:')) return await loadImage(resolveUploadUrl(icon));
    const { renderToStaticMarkup } = await import('react-dom/server');
    const Comp = (icon && ICONS[icon.slice(7)]) || Box;
    const svg = renderToStaticMarkup(createElement(Comp, { size: 64, color: '#ffffff', strokeWidth: 2.25 }));
    const withNs = svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`);
  } catch {
    return null;
  }
}

// #rrggbb + alpha → rgba()
function alpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ตัดข้อความให้ไม่เกินความกว้าง (ใส่ …)
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export const EXPORT_FORMATS: { key: ExportFormat; label: string; ext: string; mime: string }[] = [
  { key: 'png', label: 'PNG — คมชัด ไม่สูญเสียคุณภาพ (ไฟล์ใหญ่)', ext: 'png', mime: 'image/png' },
  { key: 'jpeg', label: 'JPG — ไฟล์เล็ก เหมาะส่งต่อ/แนบอีเมล', ext: 'jpg', mime: 'image/jpeg' },
  { key: 'webp', label: 'WebP — ไฟล์เล็กที่สุด (เปิดได้ในเบราว์เซอร์ใหม่ ๆ)', ext: 'webp', mime: 'image/webp' },
];

export interface RenderOptions {
  /** ขนาดหมุด/ป้ายชื่อ/กรวยกล้อง เทียบกับค่าปกติ (1 = 100%) */
  markerScale?: number;
  /** แสดงชื่ออุปกรณ์ (ค่าเริ่มต้น true) */
  labels?: boolean;
  /** ด้านยาวสุดของรูป (px) — ใช้ทำรูปตัวอย่างเล็ก ๆ; ไม่ใส่ = ความละเอียดเต็ม (ไม่เกิน MAX_SIDE) */
  maxSide?: number;
}

export interface MapExporter {
  /** ขนาดรูปเต็ม (px รวมหัวรูป) */
  fullSize: { w: number; h: number };
  /** จำนวนอุปกรณ์ที่มีตำแหน่งบนแผนผัง */
  count: number;
  render: (opts?: RenderOptions) => HTMLCanvasElement;
}

/** โหลดรูปแผนผัง + ไอคอนครั้งเดียว แล้ววาดซ้ำได้หลายแบบ (ตัวอย่างในหน้าตั้งค่า / ไฟล์จริง) */
export async function prepareMapExport(map: MapItem, devices: Device[], catalog: Catalog): Promise<MapExporter> {
  const img = await loadImage(resolveUploadUrl(map.image_url));
  const natMax = Math.max(img.naturalWidth, img.naturalHeight);
  // ขนาดหมุดอิงความละเอียดรูปต้นฉบับ (เทียบกับรูปกว้าง ~1600px ที่ขนาดจริงบนจอ) — ตัวอย่างกับไฟล์จริงจึงหน้าตาเหมือนกัน
  const baseS = Math.max(1, natMax / 1600);
  const placed = devices.filter((d) => num(d.x_percent) != null && num(d.y_percent) != null);
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';

  // โหลดไอคอนของทุกประเภทที่ใช้ (ครั้งเดียวต่อประเภท)
  const icons = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    [...new Set(placed.map((d) => d.device_type))].map(async (k) => icons.set(k, await loadIcon(findType(catalog, k).icon))),
  );

  const fullFit = Math.min(1, MAX_SIDE / natMax);
  const fullSize = {
    w: Math.round(img.naturalWidth * fullFit),
    h: Math.round(img.naturalHeight * fullFit) + Math.round(64 * baseS * fullFit),
  };

  const render = ({ markerScale = 1, labels = true, maxSide }: RenderOptions = {}): HTMLCanvasElement => {
    const fit = Math.min(1, (maxSide ?? MAX_SIDE) / natMax);
    const W = Math.round(img.naturalWidth * fit);
    const H = Math.round(img.naturalHeight * fit);
    const s = baseS * fit; // หัวรูป
    const m = s * markerScale; // หมุด / ป้าย / กรวย
    const headerH = Math.round(64 * s);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H + headerH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('เบราว์เซอร์ไม่รองรับ canvas');
    ctx.imageSmoothingQuality = 'high';

    // ---------- หัวรูป ----------
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, headerH - Math.max(1, s), W, Math.max(1, s));
    const pad = 18 * s;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 ${20 * s}px ${font}`;
    ctx.fillText(map.map_name, pad, headerH * 0.36);
    ctx.fillStyle = '#64748b';
    ctx.font = `500 ${12.5 * s}px ${font}`;
    const when = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    ctx.fillText(`อุปกรณ์ ${placed.length} ตัว · ${when}`, pad, headerH * 0.72);

    // สรุปสถานะ (ชิดขวา)
    const counts = new Map<string, number>();
    for (const d of placed) counts.set(d.status, (counts.get(d.status) || 0) + 1);
    const legend = catalog.statuses.filter((st) => counts.has(st.key)).map((st) => ({ st, n: counts.get(st.key)! }));
    for (const [k, n] of counts) if (!catalog.statuses.some((st) => st.key === k)) legend.push({ st: findStatus(catalog, k), n });
    ctx.font = `600 ${13 * s}px ${font}`;
    let lx = W - pad;
    for (const { st, n } of [...legend].reverse()) {
      const text = `${st.label} ${n}`;
      const tw = ctx.measureText(text).width;
      lx -= tw;
      ctx.fillStyle = '#334155';
      ctx.fillText(text, lx, headerH / 2);
      lx -= 14 * s;
      ctx.fillStyle = st.color || '#94a3b8';
      ctx.beginPath();
      ctx.arc(lx + 5 * s, headerH / 2, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      lx -= 18 * s;
      if (lx < W * 0.45) break; // ไม่ให้ทับชื่อแผนผัง
    }

    // ---------- แผนผัง ----------
    ctx.drawImage(img, 0, headerH, W, H);
    const pos = (d: Device) => ({ x: (num(d.x_percent)! / 100) * W, y: headerH + (num(d.y_percent)! / 100) * H });

    // ---------- จัดวางไม่ให้ซ้อน (ดู exportLayout.ts) ----------
    const R = 12 * m; // รัศมีหมุด
    const colorOf = (d: Device) => findStatus(catalog, d.status).color || '#94a3b8';
    const dot = 6 * m;
    const dotGap = 4 * m;
    const labelH = 10.5 * m * 1.35 + 4 * m;
    ctx.font = `600 ${10.5 * m}px ${font}`;
    const texts = placed.map((d) => fitText(ctx, d.name || d.id, 160 * m - dot - dotGap - 13 * m));
    const layout = layoutMarkers({
      points: placed.map(pos),
      labels: placed.map((_, i) => (labels ? { w: 6 * m + dot + dotGap + ctx.measureText(texts[i]).width + 7 * m, h: labelH } : null)),
      radius: R,
      gap: 3 * m,
      bounds: { x: 0, y: headerH, w: W, h: H },
    });

    // 1) กรวยมุมกล้อง — วาดจากตำแหน่งจริงเสมอ (ล่างสุด)
    for (const d of placed) {
      const dir = num(d.direction);
      const fov = num(d.fov_angle);
      if (dir == null || fov == null) continue;
      const c = colorOf(d);
      const { x, y } = pos(d);
      const r = 60 * m;
      const half = Math.min(Math.max(fov, 1), 359) / 2;
      const a0 = ((dir - half - 90) * Math.PI) / 180;
      const a1 = ((dir + half - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = alpha(c, 0.24 * 0.75);
      ctx.fill();
      ctx.strokeStyle = alpha(c, 0.45 * 0.75);
      ctx.lineWidth = 1.2 * m;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 2) เส้นโยง: หมุดที่ถูกดันออก → จุดจริง, ป้ายที่อยู่ไกล → หมุด
    ctx.lineCap = 'round';
    placed.forEach((d, i) => {
      const b = layout.badges[i];
      if (!b.moved) return;
      const p = pos(d);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.lineWidth = 1.6 * m;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // จุดตำแหน่งจริง
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 * m, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(d);
      ctx.fill();
      ctx.lineWidth = 1.2 * m;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });
    placed.forEach((_, i) => {
      const L = layout.labels[i];
      if (!L || !L.leader) return;
      const b = layout.badges[i];
      // จุดบนกรอบป้ายที่ใกล้หมุดที่สุด
      const tx = Math.min(L.rect.x + L.rect.w, Math.max(L.rect.x, b.x));
      const ty = Math.min(L.rect.y + L.rect.h, Math.max(L.rect.y, b.y));
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.lineWidth = 1.2 * m;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    });

    // 3) หมุด
    placed.forEach((d, i) => {
      const c = colorOf(d);
      const { x, y } = layout.badges[i];
      ctx.beginPath();
      ctx.arc(x, y, R + 2.5 * m, 0, Math.PI * 2);
      ctx.fillStyle = alpha(c, 0.24);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.lineWidth = 2 * m;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      const icon = icons.get(d.device_type);
      if (icon) {
        const is = 13 * m;
        ctx.drawImage(icon, x - is / 2, y - is / 2, is, is);
      }
    });

    // 4) ป้ายชื่อ (บนสุด)
    ctx.font = `600 ${10.5 * m}px ${font}`;
    ctx.textBaseline = 'middle';
    placed.forEach((d, i) => {
      const L = layout.labels[i];
      if (!L) return;
      const { x: left, y: top, w, h } = L.rect;
      roundRect(ctx, left, top, w, h, h / 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(left + 6 * m + dot / 2, top + h / 2, dot / 2, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(d);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(texts[i], left + 6 * m + dot + dotGap, top + h / 2 + 0.5 * m);
    });

    return canvas;
  };

  return { fullSize, count: placed.length, render };
}

/** ชื่อไฟล์ที่ใช้ได้ทุกระบบ (ตัดอักขระต้องห้ามของ Windows) */
export function safeFileName(name: string): string {
  return name.replace(/[\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/[. ]+$/, '').trim().slice(0, 150);
}

export function defaultExportName(map: MapItem): string {
  return safeFileName(`${map.map_name}-${new Date().toISOString().slice(0, 10)}`) || map.map_id;
}

/** แปลง canvas เป็นไฟล์แล้วดาวน์โหลด */
export async function downloadCanvas(canvas: HTMLCanvasElement, format: ExportFormat, fileName: string): Promise<void> {
  const f = EXPORT_FORMATS.find((x) => x.key === format) || EXPORT_FORMATS[0];
  if (f.key !== 'png') {
    // JPG/WebP ไม่มีพื้นโปร่งใส — รองพื้นขาวกันส่วนโปร่งใสของรูปแผนผังกลายเป็นดำ
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, f.mime, 0.92));
  if (!blob) throw new Error('สร้างไฟล์รูปไม่ได้ (รูปแผนผังอาจใหญ่เกินไป)');
  // เบราว์เซอร์ที่สร้าง WebP ไม่ได้จะคืน PNG มาแทน — แจ้งแทนการตั้งนามสกุลผิด
  if (blob.type !== f.mime) throw new Error(`เบราว์เซอร์นี้บันทึกเป็น ${f.ext.toUpperCase()} ไม่ได้ — เลือกนามสกุลอื่น`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(fileName) || 'map'}.${f.ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
