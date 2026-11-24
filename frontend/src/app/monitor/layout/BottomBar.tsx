import { useEffect, useState } from 'react';
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
  const server = info?.server;
  const primaryIp = server?.ips[0]?.address;
  const allIps = server?.ips.map((i) => `${i.iface}: ${i.address}`).join('\n') || '';
  const wifi = server?.wifi;

  return (
    <footer className="bottom-bar">
      <span className={cn('conn', !connected && 'bad')}>
        <span className="dot" />
        {connected ? 'backend connected' : 'backend disconnected'}
      </span>
      {server && (
        <span
          className={cn('conn', !server.internet.online && 'bad')}
          title="สถานะอินเทอร์เน็ตของเครื่อง server (ทดสอบเชื่อมต่อ 1.1.1.1 / 8.8.8.8)"
        >
          <span className="dot" />
          {server.internet.online ? `Internet ${server.internet.latencyMs ?? '-'} ms` : 'Internet offline'}
        </span>
      )}
      {wifi && (
        <span title="WiFi ของเครื่อง server">
          WiFi: {wifi.connected ? `${wifi.ssid || '-'}${wifi.signal != null ? ` (${wifi.signal}%)` : ''}` : 'ไม่ได้เชื่อมต่อ'}
        </span>
      )}
      {server && (
        <span title={`เครื่อง server: ${server.hostname}\n${allIps}`}>
          Server: <span className="mono">{primaryIp || '-'}</span>
          {server.ips.length > 1 && <span className="mono"> +{server.ips.length - 1}</span>}
        </span>
      )}
      {info && (
        <span className={cn(!browserOnline && 'net-bad')} title="IP ของเครื่องที่เปิดหน้าเว็บนี้ (ตามที่ server เห็น)">
          เครื่องคุณ: <span className="mono">{info.client.ip}</span>
          {!browserOnline && ' (ออฟไลน์)'}
        </span>
      )}
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
      {mapName && <span>แผนที่: {mapName}</span>}
      <span className="spacer" />
      <span>{modeLabel[mode]}</span>
      <span className="mono">{Math.round(zoom * 100)}%</span>
    </footer>
  );
}
