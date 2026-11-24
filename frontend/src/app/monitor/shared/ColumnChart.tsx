import { useState } from 'react';

export interface ColumnDatum {
  key: string;
  /** ป้ายใต้แท่ง (เว้นว่าง = ไม่แสดง เพื่อไม่ให้ชนกัน) */
  label: string;
  /** null = ช่องว่าง (ไม่มีข้อมูล วาดเป็นลายเส้น ไม่ใช่แท่ง 0) */
  value: number | null;
  /** บรรทัดใน tooltip */
  tip: string[];
}

/** ขั้นแกน y ที่อ่านง่าย (1, 2, 5 × 10^n) */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** กราฟแท่งแนวตั้ง ชุดเดียว — มีเส้นกริด, ป้ายค่าเฉพาะแท่งสูงสุด, tooltip เมื่อชี้ */
export function ColumnChart({ data, color, unit, emptyText }: { data: ColumnDatum[]; color: string; unit: string; emptyText?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
  const ticks = [0, max / 2, max];
  let peak = -1;
  data.forEach((d, i) => {
    if (d.value != null && (peak < 0 || d.value > (data[peak].value ?? -1))) peak = i;
  });
  const hasValue = data.some((d) => d.value != null);
  // ไม่ส่ง emptyText = พฤติกรรมเดิม (เลข 0 ทั้งหมด = ไม่มีข้อมูล) — ส่งมา = มีข้อมูล 0 จริง แสดงข้อความเฉพาะตอนว่างทุกช่อง
  const empty = !hasValue || (emptyText === undefined && data.every((d) => d.value == null || d.value === 0));

  return (
    <div className="col-chart" onMouseLeave={() => setHover(null)}>
      <div className="col-plot">
        <div className="col-grid">
          {ticks.map((t) => (
            <div key={t} className="col-gridline" style={{ bottom: `${(t / max) * 100}%` }}>
              <span className="mono">{Number.isInteger(t) ? t : t.toFixed(1)}</span>
            </div>
          ))}
        </div>
        <div className="col-bars">
          {data.map((d, i) => (
            <div
              key={d.key}
              className={'col-slot' + (hover === i ? ' hover' : '') + (d.value == null ? ' gap' : '')}
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            >
              <div className="col-bar-wrap">
                {i === peak && d.value != null && d.value > 0 && <span className="col-peak mono">{d.value}</span>}
                {d.value != null && (
                  <div
                    className="col-bar"
                    style={{ height: `${(d.value / max) * 100}%`, background: color, opacity: hover == null || hover === i ? 1 : 0.55 }}
                  />
                )}
              </div>
              {hover === i && (
                <div className={'col-tip' + (i > data.length * 0.6 ? ' left' : '')}>
                  {d.tip.map((line, k) => (
                    <div key={k} className={k === 0 ? 'col-tip-head' : ''}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="col-axis">
        {data.map((d) => (
          <span key={d.key}>{d.label}</span>
        ))}
      </div>
      {empty && <div className="col-empty">{emptyText ?? `ไม่มี${unit}ในช่วงนี้`}</div>}
    </div>
  );
}
