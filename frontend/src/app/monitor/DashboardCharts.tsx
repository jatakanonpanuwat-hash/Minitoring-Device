import { useState } from 'react';

export interface ColumnDatum {
  key: string;
  /** ป้ายใต้แท่ง (เว้นว่าง = ไม่แสดง เพื่อไม่ให้ชนกัน) */
  label: string;
  value: number;
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
export function ColumnChart({ data, color, unit }: { data: ColumnDatum[]; color: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [0, max / 2, max];
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const allZero = data.every((d) => d.value === 0);

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
              className={'col-slot' + (hover === i ? ' hover' : '')}
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            >
              <div className="col-bar-wrap">
                {!allZero && i === peak && d.value > 0 && <span className="col-peak mono">{d.value}</span>}
                <div
                  className="col-bar"
                  style={{ height: `${(d.value / max) * 100}%`, background: color, opacity: hover == null || hover === i ? 1 : 0.55 }}
                />
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
      {allZero && <div className="col-empty">ไม่มี{unit}ในช่วงนี้</div>}
    </div>
  );
}
