import { History, LayoutDashboard, Map as MapIcon, Network, Settings, Table } from 'lucide-react';
import { cn } from '../components/ui/utils';
import { useAuth } from './auth';

interface RailProps {
  panelOpen: boolean;
  onPanel: () => void;
  onOpenTable: () => void;
  onOpenLogs: () => void;
  onOpenIpTable: () => void;
  page: PageKind;
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
}

export type PageKind = 'map' | 'dashboard' | 'table' | 'iptable' | 'logs' | 'settings';

export function Rail({ panelOpen, onPanel, onOpenTable, onOpenLogs, onOpenIpTable, page, onOpenDashboard, onOpenSettings }: RailProps) {
  const { isAdmin } = useAuth();
  return (
    <nav className="rail">
      <button
        className={cn('rail-btn', page === 'dashboard' && 'active')}
        title="Dashboard - ภาพรวมสถานะ"
        onClick={onOpenDashboard}
      >
        <LayoutDashboard />
        <span>Dash</span>
      </button>
      <button
        className={cn('rail-btn', page === 'map' && panelOpen && 'active')}
        title="Map - แผนผัง & อุปกรณ์"
        onClick={onPanel}
      >
        <MapIcon />
        <span>Map</span>
      </button>
      <button
        className={cn('rail-btn', page === 'table' && 'active')}
        title="Device List - ตารางอุปกรณ์"
        onClick={onOpenTable}
      >
        <Table />
        <span>List</span>
      </button>
      <button
        className={cn('rail-btn', page === 'iptable' && 'active')}
        title="NVR - TABLE_IP / NVR Management"
        onClick={onOpenIpTable}
      >
        <Network />
        <span>NVR</span>
      </button>
      <button
        className={cn('rail-btn', page === 'logs' && 'active')}
        title="Logs - ประวัติสถานะและการแก้ไข"
        onClick={onOpenLogs}
      >
        <History />
        <span>Log</span>
      </button>
      {isAdmin && (
      <button
        className={cn('rail-btn', page === 'settings' && 'active')}
        title="Settings - ตั้งค่า"
        onClick={onOpenSettings}
      >
        <Settings />
        <span>Set</span>
      </button>
      )}
      <div className="rail-spacer" />
      <div className="rail-avatar" title="Monitoring Device">
        MD
      </div>
    </nav>
  );
}
