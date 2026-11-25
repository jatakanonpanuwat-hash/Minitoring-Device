// จัดวางหมุด + ป้ายชื่อสำหรับรูป export ไม่ให้ซ้อนกัน (ไม่ขึ้นกับ canvas — ทดสอบแยกได้)
// 1) หมุดที่อยู่ชิดกันเกินไป → ดันออกจากกันทีละนิดจนไม่ทับ (เส้นชี้กลับไปยังตำแหน่งจริง)
// 2) ป้ายชื่อ → ลองวางรอบหมุดหลายทิศ ถ้ารอบหมุดเต็มจะขยับออกไกลขึ้นทีละวง แล้วลากเส้นโยงกลับมาที่หมุด

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInput {
  /** ตำแหน่งจริงบนรูป (px) */
  points: { x: number; y: number }[];
  /** ขนาดป้ายชื่อของแต่ละจุด (null = ไม่มีป้าย) */
  labels: ({ w: number; h: number } | null)[];
  /** รัศมีหมุด (px) */
  radius: number;
  /** ระยะห่างขั้นต่ำระหว่างของ (px) */
  gap: number;
  /** พื้นที่ที่วางได้ (ตัวแผนผัง) */
  bounds: Rect;
}

export interface LayoutResult {
  /** ตำแหน่งหมุดที่ใช้วาด (อาจขยับจากตำแหน่งจริง) */
  badges: { x: number; y: number; moved: boolean }[];
  /** กรอบป้ายชื่อ + ต้องลากเส้นโยงไหม */
  labels: ({ rect: Rect; leader: boolean } | null)[];
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function outside(r: Rect, b: Rect): number {
  const inside = overlap(r, b);
  return r.w * r.h - inside;
}

// ตารางแบ่งช่อง — หาของที่อยู่ใกล้ ๆ ได้เร็ว ไม่ต้องเทียบทุกคู่
class Grid {
  private cells = new Map<string, Rect[]>();
  constructor(private size: number) {}
  private keys(r: Rect): string[] {
    const out: string[] = [];
    const x0 = Math.floor(r.x / this.size);
    const x1 = Math.floor((r.x + r.w) / this.size);
    const y0 = Math.floor(r.y / this.size);
    const y1 = Math.floor((r.y + r.h) / this.size);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) out.push(`${gx},${gy}`);
    return out;
  }
  add(r: Rect) {
    for (const k of this.keys(r)) {
      const c = this.cells.get(k);
      if (c) c.push(r);
      else this.cells.set(k, [r]);
    }
  }
  /** พื้นที่ที่ทับของที่มีอยู่ (ไม่นับ skip) */
  cost(r: Rect, skip?: Rect): number {
    const seen = new Set<Rect>();
    let sum = 0;
    for (const k of this.keys(r)) {
      for (const o of this.cells.get(k) || []) {
        if (o === skip || seen.has(o)) continue;
        seen.add(o);
        sum += overlap(r, o);
      }
    }
    return sum;
  }
}

/** ดันหมุดที่ทับกันออกจากกัน — คืนตำแหน่งใหม่ (ขยับน้อยที่สุดเท่าที่จำเป็น) */
function spreadBadges(points: { x: number; y: number }[], minD: number, b: Rect) {
  const q = points.map((p) => ({ x: p.x, y: p.y }));
  const lo = { x: b.x + minD / 2, y: b.y + minD / 2 };
  const hi = { x: b.x + b.w - minD / 2, y: b.y + b.h - minD / 2 };
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    // จัดกลุ่มตามช่อง เทียบเฉพาะช่องข้างเคียง
    const cells = new Map<string, number[]>();
    q.forEach((p, i) => {
      const k = `${Math.floor(p.x / minD)},${Math.floor(p.y / minD)}`;
      const c = cells.get(k);
      if (c) c.push(i);
      else cells.set(k, [i]);
    });
    for (let i = 0; i < q.length; i++) {
      const gx = Math.floor(q[i].x / minD);
      const gy = Math.floor(q[i].y / minD);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of cells.get(`${gx + dx},${gy + dy}`) || []) {
            if (j <= i) continue;
            let vx = q[j].x - q[i].x;
            let vy = q[j].y - q[i].y;
            let d = Math.hypot(vx, vy);
            if (d >= minD - 0.01) continue;
            if (d < 1e-6) {
              // ตำแหน่งเดียวกันเป๊ะ — แยกตามมุมทองคำ ให้ทิศไม่ซ้ำกัน
              const a = j * 2.39996;
              vx = Math.cos(a);
              vy = Math.sin(a);
              d = 1;
            }
            const push = (minD - d) / 2 + 0.01;
            const ux = vx / d;
            const uy = vy / d;
            q[i].x -= ux * push;
            q[i].y -= uy * push;
            q[j].x += ux * push;
            q[j].y += uy * push;
            moved = true;
          }
        }
      }
    }
    for (const p of q) {
      p.x = Math.min(hi.x, Math.max(lo.x, p.x));
      p.y = Math.min(hi.y, Math.max(lo.y, p.y));
    }
    if (!moved) break;
  }
  return q;
}

export function layoutMarkers({ points, labels, radius, gap, bounds }: LayoutInput): LayoutResult {
  const minD = radius * 2 + gap;
  const q = spreadBadges(points, minD, bounds);
  const badges = q.map((p, i) => ({ ...p, moved: Math.hypot(p.x - points[i].x, p.y - points[i].y) > radius * 0.35 }));

  // สิ่งกีดขวาง: หมุดทุกตัว + ป้ายที่วางไปแล้ว
  const grid = new Grid(Math.max(minD * 3, 64));
  const badgeRects = q.map((p) => ({ x: p.x - radius - gap / 2, y: p.y - radius - gap / 2, w: (radius + gap / 2) * 2, h: (radius + gap / 2) * 2 }));
  badgeRects.forEach((r) => grid.add(r));

  // วางป้ายของจุดที่แน่นที่สุดก่อน (มีที่ให้เลือกน้อยกว่า)
  const crowd = q.map((p) => q.filter((o) => Math.abs(o.x - p.x) < minD * 4 && Math.abs(o.y - p.y) < minD * 4).length);
  const order = q.map((_, i) => i).sort((a, b) => crowd[b] - crowd[a]);

  const result: LayoutResult['labels'] = labels.map(() => null);
  const DIRS = 16;
  for (const i of order) {
    const L = labels[i];
    if (!L) continue;
    const p = q[i];
    const near = radius + gap;
    // วงแรก: ใต้ / บน / ขวา / ซ้าย / มุมทั้ง 4 ติดหมุด
    const cands: { rect: Rect; ring: number }[] = [
      [0, near + L.h / 2],
      [0, -(near + L.h / 2)],
      [near + L.w / 2, 0],
      [-(near + L.w / 2), 0],
      [radius * 0.6 + L.w / 2, near * 0.7 + L.h / 2],
      [-(radius * 0.6 + L.w / 2), near * 0.7 + L.h / 2],
      [radius * 0.6 + L.w / 2, -(near * 0.7 + L.h / 2)],
      [-(radius * 0.6 + L.w / 2), -(near * 0.7 + L.h / 2)],
    ].map(([dx, dy]) => ({ rect: { x: p.x + dx - L.w / 2, y: p.y + dy - L.h / 2, w: L.w, h: L.h }, ring: 0 }));
    // วงถัดไป: รอบหมุด 16 ทิศ ห่างออกไปเรื่อย ๆ (ต้องมีเส้นโยง)
    for (let ring = 1; ring <= 10; ring++) {
      const dist = near + ring * (L.h + gap * 1.5);
      for (let k = 0; k < DIRS; k++) {
        const a = (k / DIRS) * Math.PI * 2 + (ring % 2 ? Math.PI / DIRS : 0);
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const cx = p.x + ux * (dist + L.w / 2 * Math.abs(ux));
        const cy = p.y + uy * (dist + L.h / 2 * Math.abs(uy));
        cands.push({ rect: { x: cx - L.w / 2, y: cy - L.h / 2, w: L.w, h: L.h }, ring });
      }
    }
    let best = cands[0];
    let bestCost = Infinity;
    for (const c of cands) {
      // ทับของอื่น + ล้นขอบแผนผัง (ล้นขอบหนักกว่า) + ไกลหมุดเสียแต้มเล็กน้อย
      const cost = grid.cost(c.rect) + outside(c.rect, bounds) * 4 + c.ring * 0.001;
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
        if (cost < 0.01) break; // วงในสุดที่ว่าง — ใช้เลย
      }
    }
    grid.add(best.rect);
    result[i] = { rect: best.rect, leader: best.ring > 0 };
  }
  return { badges, labels: result };
}
