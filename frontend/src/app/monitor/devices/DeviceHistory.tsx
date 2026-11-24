// กราฟ uptime / latency ย้อนหลังรายเครื่อง — แสดงใน DeviceModal
import { useEffect, useState } from 'react';
import type { DeviceHistory, HistoryBucket, HistoryRange } from '../../types/monitor';
import { getDeviceHistory } from '../../utils/monitorClient';
import { ColumnChart, type ColumnDatum } from '../shared/ColumnChart';

const RANGES: { key: HistoryRange; label: string }[] = [
  { key: '24h', label: '24 ชม' },
  { key: '7d', label: '7 วัน' },
  { key: '30d', label: '30 วัน' },
];

const pad = (n: number) => String(n).padStart(2, '0');

interface Slot {
  key: string;
  at: Date;
  bucket: HistoryBucket | null;
}

// สร้างแกนเวลาต่อเนื่องทั้งช่วง แล้ววาง bucket ที่ backend ส่งมา (sparse) ลงไป — ช่องที่หาย = gap
function buildSlots(range: HistoryRange, buckets: HistoryBucket[]): Slot[] {
  const byKey = new Map<string, HistoryBucket>();
  if (range === '30d') {
    for (const b of buckets) byKey.set(b.t.slice(0, 10), b);
    const slots: Slot[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const at = new Date(today.getTime() - i * 86400000);
      const key = at.toISOString().slice(0, 10);
      slots.push({ key, at, bucket: byKey.get(key) || null });
    }
    return slots;
  }
  for (const b of buckets) byKey.set(b.t.slice(0, 13), b);
  const n = range === '7d' ? 168 : 24;
  const top = new Date();
  top.setUTCMinutes(0, 0, 0);
  const slots: Slot[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const at = new Date(top.getTime() - i * 3600000);
    const key = at.toISOString().slice(0, 13);
    slots.push({ key, at, bucket: byKey.get(key) || null });
  }
  return slots;
}

export function DeviceHistory({ deviceId }: { deviceId: string }) {
  const [range, setRange] = useState<HistoryRange>('24h');
  const [data, setData] = useState<DeviceHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getDeviceHistory(deviceId, range)
      .then((d) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [deviceId, range]);

  const slots = buildSlots(range, data?.buckets || []);
  const every = range === '24h' ? 4 : range === '7d' ? 24 : 5;
  const labelOf = (at: Date) =>
    range === '30d' ? `${at.getUTCDate()}/${at.getUTCMonth() + 1}` : `${pad(at.getHours())}:00`;
  const fullOf = (at: Date) =>
    range === '30d'
      ? at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
      : at.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const uptimeData: ColumnDatum[] = slots.map((s, i) => ({
    key: s.key,
    label: i % every === 0 ? labelOf(s.at) : '',
    value: s.bucket?.uptime ?? null,
    tip: s.bucket
      ? [fullOf(s.at), `Uptime ${s.bucket.uptime}%`, `ตรวจ ${s.bucket.checks} ครั้ง ตอบ ${s.bucket.alive}`]
      : [fullOf(s.at), 'ไม่มีการตรวจ'],
  }));
  const latencyData: ColumnDatum[] = slots.map((s, i) => ({
    key: s.key,
    label: i % every === 0 ? labelOf(s.at) : '',
    value: s.bucket?.latency ?? null,
    tip: s.bucket
      ? [fullOf(s.at), s.bucket.latency != null ? `เฉลี่ย ${s.bucket.latency} ms` : 'ไม่มีคำตอบ']
      : [fullOf(s.at), 'ไม่มีการตรวจ'],
  }));

  const checks = (data?.buckets || []).reduce((a, b) => a + b.checks, 0);
  const aliveCount = (data?.buckets || []).reduce((a, b) => a + b.alive, 0);
  const total = checks ? `Uptime รวม ${Math.round((aliveCount / checks) * 1000) / 10}% (ตรวจ ${checks} ครั้ง)` : null;

  return (
    <>
      <div className="section-title" style={{ marginTop: 16 }}>
        <span>Uptime ย้อนหลัง</span>
        <span className="ip-views">
          {RANGES.map((r) => (
            <button key={r.key} className={r.key === range ? 'active' : ''} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </span>
      </div>
      {loading ? (
        <p className="hint">กำลังโหลด…</p>
      ) : (
        <>
          <p className="hint">
            Uptime % {range === '30d' ? 'รายวัน' : 'รายชั่วโมง'} (ช่องว่าง = ไม่มีการตรวจ){total && <> · {total}</>}
          </p>
          <ColumnChart data={uptimeData} color="#16a34a" unit="%" emptyText="ไม่มีข้อมูลย้อนหลังในช่วงนี้" />
          <p className="hint" style={{ marginTop: 10 }}>
            Latency เฉลี่ย (ms)
          </p>
          <ColumnChart data={latencyData} color="#2563eb" unit="ms" emptyText="ไม่มีข้อมูลย้อนหลังในช่วงนี้" />
        </>
      )}
    </>
  );
}
