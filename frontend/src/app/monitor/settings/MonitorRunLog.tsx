import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, Play } from 'lucide-react';
import { cn } from '../../components/ui/utils';
import { getMonitorProgress, runMonitorNow, type MonitorProgress, type MonitorProgressEntry } from '../../utils/monitorClient';
import { findStatus, useCatalog } from '../shared/catalog';

const POLL_MS = 700;
const MAX_LINES = 3000;

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour12: false });

function elapsed(from: string | null, to: string | null): string {
  if (!from) return '';
  const sec = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000));
  return sec < 60 ? `${sec} วินาที` : `${Math.floor(sec / 60)} นาที ${sec % 60} วินาที`;
}

interface MonitorRunLogProps {
  secret: string;
  /** เรียกเมื่อ ping ครบรอบ (ให้แอปโหลดสถานะอุปกรณ์ใหม่) */
  onFinished: () => void;
}

/** ปุ่ม "Ping ทั้งหมดตอนนี้" + แถบความคืบหน้า + log ผล ping ทีละเครื่องแบบวิ่ง */
export function MonitorRunLog({ secret, onFinished }: MonitorRunLogProps) {
  const catalog = useCatalog();
  const [prog, setProg] = useState<Omit<MonitorProgress, 'entries'> | null>(null);
  const [lines, setLines] = useState<MonitorProgressEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [, setTick] = useState(0); // อัปเดตเวลาที่ผ่านไประหว่างวิ่ง

  const cursor = useRef({ runId: 0, seq: 0 });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const wasRunning = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const poll = async () => {
    clearTimeout(timer.current);
    try {
      const p = await getMonitorProgress(cursor.current.runId, cursor.current.seq);
      const { entries, ...rest } = p;
      if (p.runId !== cursor.current.runId) {
        // รอบใหม่ — ล้าง log เดิม
        cursor.current = { runId: p.runId, seq: 0 };
        setLines(entries.slice(-MAX_LINES));
      } else if (entries.length) {
        setLines((old) => [...old, ...entries].slice(-MAX_LINES));
      }
      if (entries.length) cursor.current.seq = entries[entries.length - 1].seq;
      setProg(rest);
      setError('');
      if (wasRunning.current && !p.running) onFinishedRef.current();
      wasRunning.current = p.running;
      if (p.running) timer.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      setError((e as Error).message);
      if (wasRunning.current) timer.current = setTimeout(poll, POLL_MS * 3);
    }
  };

  // เปิดหน้ามา: แสดงผลรอบล่าสุด (ถ้ารอบอัตโนมัติกำลังวิ่งอยู่ก็ติดตามต่อ)
  useEffect(() => {
    poll();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!prog?.running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [prog?.running]);

  // เลื่อนลงล่างอัตโนมัติ — ยกเว้นผู้ใช้เลื่อนขึ้นไปดูบรรทัดก่อนหน้า
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines, onlyIssues]);

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      await runMonitorNow(secret);
      wasRunning.current = true;
      stickBottom.current = true;
      await poll();
    } catch (e) {
      setError((e as Error).message || 'สั่ง ping ไม่สำเร็จ');
    } finally {
      setStarting(false);
    }
  };

  const running = !!prog?.running;
  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : running ? 0 : 100;
  const shown = onlyIssues ? lines.filter((l) => l.status !== 'online' || l.changed) : lines;
  const label = (k: string) => (k === 'error' ? 'Error' : findStatus(catalog, k).label);
  const color = (k: string) => (k === 'error' ? '#a855f7' : findStatus(catalog, k).color);

  return (
    <div className="run-log">
      <div className="run-log-bar">
        <button className="btn btn-dark" onClick={start} disabled={starting || running}>
          {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {running ? 'กำลัง ping...' : 'Ping ทั้งหมดตอนนี้'}
        </button>
        {prog && prog.runId > 0 && (
          <div className="run-log-summary">
            <span>
              {running ? 'กำลัง ping' : 'รอบล่าสุด'} {prog.source === 'auto' ? '(อัตโนมัติ)' : prog.source === 'manual' ? '(กดเอง)' : ''} ·{' '}
              <b>
                {prog.done}/{prog.total}
              </b>{' '}
              เครื่อง · {elapsed(prog.startedAt, prog.finishedAt)}
              {!running && prog.finishedAt && ` · เสร็จ ${timeOf(prog.finishedAt)}`}
            </span>
          </div>
        )}
      </div>

      {prog && prog.runId > 0 && (
        <>
          <div className={cn('run-log-progress', running && 'active')}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="run-log-counts">
            {(['online', 'warning', 'offline', 'error'] as const).map((k) =>
              k === 'error' && !prog.counts.error ? null : (
                <span key={k} style={{ '--c': color(k) } as React.CSSProperties}>
                  <i /> {label(k)} <b>{prog.counts[k]}</b>
                </span>
              ),
            )}
            {prog.changed > 0 && (
              <span className="changed">
                เปลี่ยนสถานะ <b>{prog.changed}</b>
              </span>
            )}
            <label className="run-log-filter">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              เฉพาะที่มีปัญหา / เปลี่ยนสถานะ
            </label>
          </div>
        </>
      )}

      {error && <div className="notice error">{error}</div>}
      {prog?.note && <div className="notice error">{prog.note}</div>}

      {prog && prog.runId > 0 && (
        <div
          className="run-log-box"
          ref={boxRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {shown.length === 0 ? (
            <div className="run-log-empty">
              {running ? 'รอผล ping...' : prog.total === 0 ? 'ไม่มีอุปกรณ์ที่ต้อง ping (ต้องมี IP และเปิด monitor)' : 'ไม่มีรายการที่มีปัญหา'}
            </div>
          ) : (
            shown.map((l) => (
              <div key={l.seq} className={cn('run-log-line', l.status, l.changed && 'changed')}>
                <span className="t">{timeOf(l.at)}</span>
                <span className="st" style={{ '--c': color(l.status) } as React.CSSProperties}>
                  <i /> {label(l.status)}
                </span>
                <span className="nm" title={l.name}>
                  {l.name}
                </span>
                <span className="ip">{l.ip}</span>
                <span className="res">
                  {l.error ? l.error : l.latency != null ? `${l.latency} ms` : 'ไม่ตอบ'}
                  {l.changed && (
                    <em>
                      {label(l.prev)} <ArrowRight size={10} /> {label(l.status)}
                    </em>
                  )}
                </span>
              </div>
            ))
          )}
          {running && <div className="run-log-cursor">▍</div>}
        </div>
      )}
    </div>
  );
}
