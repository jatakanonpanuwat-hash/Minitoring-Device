import { Activity, Search } from 'lucide-react';

export type ViewMode = 'view' | 'place' | 'move';

interface TopBarProps {
  search: string;
  onSearch: (v: string) => void;
  mapName: string;
  onOpenSettings: () => void;
  /** ปุ่มเข้าสู่ระบบ / เมนูผู้ใช้ */
  userMenu?: React.ReactNode;
}

export function TopBar({ search, onSearch, mapName, userMenu }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-main">
        <div className="brand">
          <div className="brand-logo">
            <Activity />
          </div>
          <div className="brand-text">
            <b>MONITORING DEVICE</b>
            <span>IT • NETWORK MONITOR</span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="global-search">
            <span className="search-ico">
              <Search />
            </span>
            <input placeholder="ค้นหาชื่อ / IP / MAC..." value={search} onChange={(e) => onSearch(e.target.value)} />
          </div>
          {mapName && <span className="map-name-pill">{mapName}</span>}
          {userMenu}
        </div>
      </div>
    </header>
  );
}
