import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, MapPin, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { cn } from '../components/ui/utils';
import type { CatalogItem, Device, MapItem } from '../types/monitor';
import { CatalogIcon, StatusPill, findType, useCatalog } from './catalog';
import { useAuth } from './auth';

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  devices: Device[];
  totalAll: number;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  typeFilter: string;
  onTypeFilter: (v: string) => void;
  zoneFilter: string;
  onZoneFilter: (v: string) => void;
  zones: CatalogItem[];
  selectedId: string | null;
  onSelect: (d: Device) => void;
  maps: MapItem[];
  activeMapId: string;
  onSelectMap: (id: string) => void;
  onUploadMap: (file: File, name: string) => void;
  onRenameMap: (id: string, name: string) => void;
  onDeleteMap: (id: string) => void;
  /** ไปวางอุปกรณ์ที่ยังไม่มีตำแหน่งบนแผนผัง */
  onPlace: (d: Device) => void;
  authRequired: boolean;
}

// ค่าที่จำไว้ในเบราว์เซอร์
const ONLY_MAP_KEY = 'monitoring-device:panel-only-map';
const MAPS_OPEN_KEY = 'monitoring-device:panel-maps-open';

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function saveBool(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* storage ใช้ไม่ได้ */
  }
}

/** แผงด้านข้าง: เลือก/จัดการแผนผัง + รายการอุปกรณ์ ในที่เดียว */
export function SlidePanel(props: SlidePanelProps) {
  const { open, onClose } = props;
  const catalog = useCatalog();
  const { canEdit, isAdmin } = useAuth();
  const [mapName, setMapName] = useState('');
  const [renaming, setRenaming] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [mapsOpen, setMapsOpenState] = useState(() => loadBool(MAPS_OPEN_KEY, true));
  const [onlyMap, setOnlyMapState] = useState(() => loadBool(ONLY_MAP_KEY, true));
  const fileRef = useRef<HTMLInputElement>(null);

  const setMapsOpen = (v: boolean) => {
    setMapsOpenState(v);
    saveBool(MAPS_OPEN_KEY, v);
  };
  const setOnlyMap = (v: boolean) => {
    setOnlyMapState(v);
    saveBool(ONLY_MAP_KEY, v);
  };

  // จำนวนอุปกรณ์ (ตามตัวกรอง) บนแต่ละแผนผัง
  const countByMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of props.devices) if (d.map_id) m.set(d.map_id, (m.get(d.map_id) || 0) + 1);
    return m;
  }, [props.devices]);

  const activeMap = props.maps.find((m) => m.map_id === props.activeMapId);
  // อุปกรณ์ที่ไม่ระบุแผนผังแสดงทุกแผนผัง (เหมือนบนแผนผัง)
  const shown =
    onlyMap && activeMap ? props.devices.filter((d) => !d.map_id || d.map_id === activeMap.map_id) : props.devices;
  const mapNameOf = (id: string | null) => props.maps.find((m) => m.map_id === id)?.map_name;

  return (
    <aside className={cn('slide-panel', open && 'open')}>
      <div className="slide-panel-inner">
        <div className="panel-header">
          <h3>แผนผัง & อุปกรณ์</h3>
          <button className="panel-close" onClick={onClose} title="ปิด">
            <X />
          </button>
        </div>
        <div className="panel-body">
          {/* ---------- แผนผัง ---------- */}
          <div className="section-title panel-toggle" onClick={() => setMapsOpen(!mapsOpen)}>
            <span>
              {mapsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              แผนผัง
              {!mapsOpen && activeMap && <em className="panel-current"> · {activeMap.map_name}</em>}
            </span>
            <span>{props.maps.length}</span>
          </div>

          {mapsOpen && (
            <>
              <div className="map-list">
                {props.maps.map((m) => (
                  <div
                    key={m.map_id}
                    className={cn('map-item', props.activeMapId === m.map_id && 'active')}
                    onClick={() => props.onSelectMap(m.map_id)}
                  >
                    {renaming === m.map_id ? (
                      <input
                        value={renameValue}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && renameValue.trim()) {
                            props.onRenameMap(m.map_id, renameValue.trim());
                            setRenaming('');
                          } else if (e.key === 'Escape') {
                            setRenaming('');
                          }
                        }}
                        onBlur={() => setRenaming('')}
                      />
                    ) : (
                      <span className="grow">{m.map_name}</span>
                    )}
                    <span className="map-count mono" title="อุปกรณ์บนแผนผังนี้ (ตามตัวกรอง)">
                      {countByMap.get(m.map_id) || 0}
                    </span>
                    {isAdmin && (<>
                    <button
                      className="mini-btn"
                      title="เปลี่ยนชื่อ"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(m.map_id);
                        setRenameValue(m.map_name);
                      }}
                    >
                      <Pencil />
                    </button>
                    <button
                      className="mini-btn danger"
                      title="ลบแผนผัง"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onDeleteMap(m.map_id);
                      }}
                    >
                      <Trash2 />
                    </button>
                    </>)}
                  </div>
                ))}
                {props.maps.length === 0 && <p className="hint">ยังไม่มีแผนผัง — อัปโหลดด้านล่าง</p>}
              </div>

              {!isAdmin ? null : showUpload || props.maps.length === 0 ? (
                <div className="map-upload">
                  <div className="form-group">
                    <input placeholder="ชื่อแผนผัง" value={mapName} onChange={(e) => setMapName(e.target.value)} />
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.gif,.webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        props.onUploadMap(f, mapName.trim() || f.name);
                        setMapName('');
                        setShowUpload(false);
                      }
                      e.target.value = '';
                    }}
                  />
                  <div className="btn-row">
                    <button className="btn btn-dark" onClick={() => fileRef.current?.click()}>
                      <Upload size={14} /> เลือกรูปแผนผัง
                    </button>
                    {props.maps.length > 0 && (
                      <button className="btn" onClick={() => setShowUpload(false)}>
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button className="map-add" onClick={() => setShowUpload(true)}>
                  <Plus size={14} /> เพิ่มแผนผัง
                </button>
              )}
            </>
          )}

          {/* ---------- อุปกรณ์ ---------- */}
          <div className="section-title">
            <span>อุปกรณ์</span>
            <span>
              {shown.length}
              {shown.length !== props.totalAll && <small> / {props.totalAll}</small>}
            </span>
          </div>
          <div className="filters">
            <select value={props.statusFilter} onChange={(e) => props.onStatusFilter(e.target.value)}>
              <option value="">ทุกสถานะ</option>
              <option value="problem">มีปัญหา (Off + Warn)</option>
              {catalog.statuses.map((st) => (
                <option key={st.key} value={st.key}>
                  {st.label}
                </option>
              ))}
            </select>
            <select value={props.typeFilter} onChange={(e) => props.onTypeFilter(e.target.value)}>
              <option value="">ทุกประเภท</option>
              {catalog.types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <select value={props.zoneFilter} onChange={(e) => props.onZoneFilter(e.target.value)}>
              <option value="">ทุกโซน</option>
              {props.zones.map((z) => (
                <option key={z.key} value={z.key}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          {activeMap && (
            <label className="panel-only-map">
              <input type="checkbox" checked={onlyMap} onChange={(e) => setOnlyMap(e.target.checked)} />
              เฉพาะแผนผัง “{activeMap.map_name}”
            </label>
          )}
          <div>
            {shown.map((d) => (
              <div
                key={d.id}
                className={cn('cam-row', props.selectedId === d.id && 'selected')}
                onClick={() => props.onSelect(d)}
              >
                <CatalogIcon icon={findType(catalog, d.device_type).icon} className="type-ico" />
                <span className="name">{d.name}</span>
                <span className="ip">
                  {d.ip_address || ''}
                  {d.last_latency_ms != null && ` · ${d.last_latency_ms}ms`}
                  {!onlyMap && d.map_id && d.map_id !== props.activeMapId && mapNameOf(d.map_id) && (
                    <> · 🗺 {mapNameOf(d.map_id)}</>
                  )}
                </span>
                {canEdit && (d.x_percent == null || d.y_percent == null) ? (
                  // ยังไม่มีตำแหน่ง — กดเพื่อไปคลิกวางบนแผนผัง
                  <button
                    className="row-place-btn"
                    title="ยังไม่ได้วางบนแผนผัง — คลิกเพื่อวาง"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onPlace(d);
                    }}
                  >
                    <MapPin size={12} /> วาง
                  </button>
                ) : (
                  <StatusPill status={d.status} />
                )}
              </div>
            ))}
            {shown.length === 0 && <p className="hint">ไม่พบอุปกรณ์ตามเงื่อนไข</p>}
          </div>
        </div>
      </div>
    </aside>
  );
}
