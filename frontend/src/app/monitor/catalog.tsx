import { createContext, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, AirVent, Antenna, Archive, Ban, Battery, BatteryCharging, Bell, Box, Building2, Cable, Camera, Car,
  Cctv, CircleCheck, CircleHelp, CirclePause, CircleX, Clock, Cog, Cpu, Database, DoorOpen, Factory, Fan, Flag,
  Flame, Gauge, HardDrive, Hammer, Headphones, Home, KeyRound, Laptop, Layers, Lightbulb, Lock, MapPin,
  MemoryStick, Monitor, Network, Package, Phone, Plug, Power, Printer, Projector, Radio, Router, Scan, ScanLine,
  Server, Settings, Shield, ShieldAlert, Siren, Smartphone, Speaker, Star, Tablet, Thermometer, TriangleAlert,
  Truck, Tv, Users, Video, Warehouse, Wifi, Wrench, Zap,
} from 'lucide-react';
import { cn } from '../components/ui/utils';
import type { Catalog, CatalogItem } from '../types/monitor';

// ชุดไอคอนให้เลือก — ค่าที่เก็บคือ "lucide:<ชื่อ>"
export const ICONS: Record<string, LucideIcon> = {
  Cctv, Camera, Video, HardDrive, Server, Database, Network, Router, Wifi, Antenna, Radio, Cable,
  Monitor, Laptop, Tablet, Smartphone, Phone, Tv, Projector, Printer, Scan, ScanLine, Speaker, Headphones,
  Cpu, MemoryStick, Zap, Battery, BatteryCharging, Plug, Power, Lightbulb, Fan, AirVent, Thermometer, Gauge,
  Flame, Siren, Bell, Lock, KeyRound, Shield, ShieldAlert, Factory, Warehouse, Building2, Home, DoorOpen,
  Layers, MapPin, Car, Truck, Package, Box, Archive, Users, Wrench, Hammer, Cog, Settings, Activity,
  CircleCheck, CircleX, TriangleAlert, CirclePause, CircleHelp, Ban, Clock, Flag, Star,
};

const BASE = import.meta.env.BASE_URL;

export function resolveUploadUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${BASE}${url.replace(/^\//, '')}`;
}

/** แสดงไอคอนของรายการ: lucide หรือรูปโลโก้ที่อัปโหลด */
export function CatalogIcon({ icon, className, size }: { icon?: string | null; className?: string; size?: number }) {
  if (icon && icon.startsWith('lucide:')) {
    const I = ICONS[icon.slice(7)] || Box;
    return <I className={className} size={size} />;
  }
  if (icon) {
    return (
      <img
        src={resolveUploadUrl(icon)}
        alt=""
        draggable={false}
        className={cn('catalog-img', className)}
        style={size ? { width: size, height: size } : undefined}
      />
    );
  }
  return <Box className={className} size={size} />;
}

export const EMPTY_CATALOG: Catalog = { types: [], statuses: [], zones: [] };

export const CatalogContext = createContext<Catalog>(EMPTY_CATALOG);
export const useCatalog = () => useContext(CatalogContext);

const FALLBACK_STATUS: CatalogItem = { key: 'unknown', label: 'Unknown', color: '#94a3b8', icon: 'lucide:CircleHelp' };

export function findType(c: Catalog, key: string | null | undefined): CatalogItem {
  return c.types.find((t) => t.key === key) || { key: key || '', label: key || '—', icon: 'lucide:Box' };
}

export function findStatus(c: Catalog, key: string | null | undefined): CatalogItem {
  return c.statuses.find((s) => s.key === key) || { ...FALLBACK_STATUS, key: key || 'unknown', label: key || 'Unknown' };
}

export function findZone(c: Catalog, key: string | null | undefined): CatalogItem | null {
  if (!key) return null;
  return c.zones.find((z) => z.key === key) || { key, label: key, color: '#94a3b8', icon: '' };
}

/** ป้ายสถานะ สีตามที่ตั้งในรายการ */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = findStatus(useCatalog(), status);
  return (
    <span className={cn('pill status-pill', className)} style={{ '--c': s.color } as React.CSSProperties}>
      {s.label}
    </span>
  );
}

/** ป้ายโซน: จุดสี/ไอคอน + ชื่อ */
export function ZoneTag({ zone }: { zone: string | null | undefined }) {
  const z = findZone(useCatalog(), zone);
  if (!z) return <>—</>;
  return (
    <span className="zone-tag" style={{ '--c': z.color } as React.CSSProperties}>
      {z.icon ? <CatalogIcon icon={z.icon} size={12} /> : <span className="zone-dot" />}
      {z.label}
    </span>
  );
}

export function newKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
