import { cn } from '../components/ui/utils';
import { formatAgo, type MonitorStatus } from '../types/monitor';
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

export function BottomBar({ connected, deviceCount, mapName, mode, zoom, monitor }: BottomBarProps) {
  return (
    <footer className="bottom-bar">
      <span className={cn('conn', !connected && 'bad')}>
        <span className="dot" />
        {connected ? 'backend connected' : 'backend disconnected'}
      </span>
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
