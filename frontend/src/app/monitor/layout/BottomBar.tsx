import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../components/ui/utils';
import { formatAgo, type MonitorStatus } from '../../types/monitor';
import { getNetworkInfo, type NetworkInfo } from '../../utils/monitorClient';
import type { ViewMode } from './TopBar';

interface BottomBarProps {
  connected: boolean;
  deviceCount: number;
  mapName: string;
  mode: ViewMode;
  zoom: number;
  monitor: MonitorStatus | null;
}

const modeLabel: Record<ViewMode, string> = {
  view: 'โหมด: ดู',
  place: 'โหมด: วางอุปกรณ์',
  move: 'โหมด: ย้ายอุปกรณ์',
};

const NETWORK_POLL_MS = 20000;

// สถานะเครือข่าย: อินเทอร์เน็ต/WiFi/IP ของเครื่อง server + IP ของเครื่องที่เปิดเว็บ
function useNetworkInfo() {
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getNetworkInfo()
        .then((n) => alive && setInfo(n))
        .catch(() => alive && setInfo(null));
    load();
    const t = setInterval(load, NETWORK_POLL_MS);
    const on = () => {
      setBrowserOnline(true);
      load();
    };
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return { info, browserOnline };
}

export function BottomBar({ connected, deviceCount, mapName, mode, zoom, monitor }: BottomBarProps) {
  const { info, browserOnline } = useNetworkInfo();
  const [netOpen, setNetOpen] = useState(false);
  const server = info?.server;
  const wifi = server?.wifi;

  // ปิดป๊อปอัพเมื่อคลิกข้างนอก / กด Esc (ดักที่ document ก่อน window — ไม่ให้ Esc ไปยกเลิกโหมดบนแผนผังด้วย)
  useEffect(() => {
    if (!netOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.('.net-dropdown, .net-btn')) setNetOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setNetOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [netOpen]);

  const netBad = !browserOnline || (server != null && !server.internet.online);

  return (
    <footer className="bottom-bar">
      <div className="bottom-bar-inner">
        <div className="bar-group">
          <span className="bar-group-label">การเชื่อมต่อ</span>
          <span className={cn('conn', !connected && 'bad')}>
            <span className="dot" />
            {connected ? 'backend connected' : 'backend disconnected'}
          </span>
          <button
            type="button"
            className={cn('net-btn', info ? netBad && 'bad' : 'unknown')}
            onClick={() => setNetOpen(!netOpen)}
            aria-expanded={netOpen}
            title="ข้อมูลเครือข่าย: เน็ต/WiFi/IP เครื่อง server + IP เครื่องคุณ"
          >
            <span className="dot" />
            เครือข่าย
            <ChevronDown size={12} />
          </button>
        </div>
        <span className="bar-divider" />
        <div className="bar-group">
          <span className="bar-group-label">มอนิเตอร์</span>
          <span>
            อุปกรณ์ <span className="mono">{deviceCount}</span> ตัว
          </span>
          {monitor && (
            <span>
              {monitor.enabled
                ? `ping ทุก ${monitor.intervalSec} วิ. • รอบล่าสุด ${formatAgo(monitor.lastRunAt)} (${monitor.checked} เครื่อง)`
                : 'ping อัตโนมัติ: ปิด'}
            </span>
          )}
        </div>
        <span className="spacer" />
        <div className="bar-group">
          <span className="bar-group-label">มุมมอง</span>
          {mapName && <span>แผนที่: {mapName}</span>}
          <span>{modeLabel[mode]}</span>
          <span className="mono">{Math.round(zoom * 100)}%</span>
        </div>
      </div>
      {netOpen && (
        <div className="net-dropdown" role="dialog" aria-label="ข้อมูลเครือข่าย">
          <div className="net-row">
            <span className="net-row-label">อินเทอร์เน็ต (server)</span>
            {server ? (
              <span className={cn('conn', !server.internet.online && 'bad')} title="ทดสอบเชื่อมต่อ 1.1.1.1 / 8.8.8.8">
                <span className="dot" />
                {server.internet.online ? `${server.internet.latencyMs ?? '-'} ms` : 'offline'}
              </span>
            ) : (
              <span className="hint">กำลังโหลด…</span>
            )}
          </div>
          <div className="net-row">
            <span className="net-row-label">WiFi (server)</span>
            {wifi ? (
              <span>{wifi.connected ? `${wifi.ssid || '-'}${wifi.signal != null ? ` (${wifi.signal}%)` : ''}` : 'ไม่ได้เชื่อมต่อ'}</span>
            ) : (
              <span className="hint">—</span>
            )}
          </div>
          <div className="net-row">
            <span className="net-row-label">Server</span>
            {server ? (
              <span className="net-server">
                <b>{server.hostname}</b>
                {server.ips.map((i) => (
                  <span key={`${i.iface}:${i.address}`} className="mono">
                    {i.iface}: {i.address}
                  </span>
                ))}
              </span>
            ) : (
              <span className="hint">กำลังโหลด…</span>
            )}
          </div>
          <div className="net-row">
            <span className="net-row-label">เครื่องคุณ</span>
            {info ? (
              <span className={cn('mono', !browserOnline && 'net-bad')}>
                {info.client.ip}
                {!browserOnline && ' (ออฟไลน์)'}
              </span>
            ) : (
              <span className="hint">กำลังโหลด…</span>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
