import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ImagePlus, MapPin, Pencil, Plus, Trash2, Upload, X, MapPinOff } from 'lucide-react';
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
  onUploadMap: (file: File, name: string, floor: string) => void;
  onRenameMap: (id: string, name: string, floor: string) => void;
  onReplaceMapImage: (id: string, file: File) => void;
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
  const [mapFloor, setMapFloor] = useState('');
  const [renaming, setRenaming] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [renameFloor, setRenameFloor] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [mapsOpen, setMapsOpenState] = useState(() => loadBool(MAPS_OPEN_KEY, true));
  const [onlyMap, setOnlyMapState] = useState(() => loadBool(ONLY_MAP_KEY, true));
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState('');

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
          {/* ---------- ส่วนล็อคค้างด้านบน: แผนผัง + ตัวกรอง ---------- */}
          <div className="panel-sticky">
          <div className="section-title panel-toggle" onClick={() => setMapsOpen(!mapsOpen)}>
            <span>
              {mapsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              แผนผัง
              {!mapsOpen && activeMap && <em className="panel-current"> · {activeMap.map_name}</em>}
            </span>
            <span className="maps-title-right">
              <span>{props.maps.length}</span>
              {isAdmin && (
                <button
                  className="mini-btn"
                  title="เพิ่มแผนผัง"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMapsOpen(true);
                    setShowUpload(true);
                  }}
                >
                  <Plus size={14} />
                </button>
              )}
            </span>
          </div>

          {mapsOpen && (
            <>
              {props.maps.length === 0 ? (
                <p className="hint">ยังไม่มีแผนผัง — กด + เพื่ออัปโหลด</p>
              ) : renaming ? (
                <span
                  className="map-rename map-edit-row"
                  onBlur={(e) => {
                    // โฟกัสหลุดออกจากกล่องแก้ชื่อ/ชั้นทั้งหมด = ยกเลิก (สลับช่องกันเองไม่ยกเลิก)
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRenaming('');
                  }}
                >
                  <input
                    value={renameValue}
                    autoFocus
                    placeholder="ชื่อแผนผัง"
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && renameValue.trim()) {
                        props.onRenameMap(renaming, renameValue.trim(), renameFloor.trim());
                        setRenaming('');
                      } else if (e.key === 'Escape') {
                        setRenaming('');
                      }
                    }}
                  />
                  <input
                    className="map-rename-floor"
                    value={renameFloor}
                    placeholder="ชั้น"
                    title="ชั้นของแผนผัง (เช่น 1FL)"
                    onChange={(e) => setRenameFloor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && renameValue.trim()) {
                        props.onRenameMap(renaming, renameValue.trim(), renameFloor.trim());
                        setRenaming('');
                      } else if (e.key === 'Escape') {
                        setRenaming('');
                      }
                    }}
                  />
                  <button
                    className="mini-btn"
                    title="บันทึก (Enter)"
                    onClick={() => {
                      if (renameValue.trim()) {
                        props.onRenameMap(renaming, renameValue.trim(), renameFloor.trim());
                        setRenaming('');
                      }
                    }}
                  >
                    <Check size={14} />
                  </button>
                  <button className="mini-btn" title="ยกเลิก (Esc)" onClick={() => setRenaming('')}>
                    <X size={14} />
                  </button>
                </span>
              ) : (
                <div className="map-select-row">
                  <select
                    value={props.maps.some((m) => m.map_id === props.activeMapId) ? props.activeMapId : ''}
                    onChange={(e) => e.target.value && props.onSelectMap(e.target.value)}
                    title="เลือกแผนผัง"
                  >
                    <option value="" disabled>— เลือกแผนผัง —</option>
                    {props.maps.map((m) => (
                      <option key={m.map_id} value={m.map_id}>
                        {m.map_name}{m.floor ? ` (${m.floor})` : ''} · {countByMap.get(m.map_id) || 0}
                      </option>
                    ))}
                  </select>
                  {isAdmin && (
                    <>
                      <button
                        className="mini-btn"
                        title="แก้ไขชื่อ / ชั้น"
                        onClick={() => {
                          const m = props.maps.find((x) => x.map_id === props.activeMapId);
                          if (!m) return;
                          setRenaming(m.map_id);
                          setRenameValue(m.map_name);
                          setRenameFloor(m.floor || '');
                        }}
                      >
                        <Pencil />
                      </button>
                      <button
                        className="mini-btn"
                        title="เปลี่ยนรูปแผนผัง (อุปกรณ์และตำแหน่งคงเดิม)"
                        onClick={() => {
                          setReplacing(props.activeMapId);
                          replaceRef.current?.click();
                        }}
                      >
                        <ImagePlus />
                      </button>
                      <button
                        className="mini-btn danger"
                        title="ลบแผนผัง"
                        onClick={() => props.onDeleteMap(props.activeMapId)}
                      >
                        <Trash2 />
                      </button>
                    </>
                  )}
                </div>
              )}
              <input
                ref={replaceRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && replacing) props.onReplaceMapImage(replacing, f);
                  setReplacing('');
                  e.target.value = '';
                }}
              />

              {!isAdmin ? null : showUpload || props.maps.length === 0 ? (
                <div className="map-upload">
                  <div className="form-group">
                    <input placeholder="ชื่อแผนผัง" value={mapName} onChange={(e) => setMapName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <input placeholder="ชั้น (เช่น 1FL) — เว้นว่างได้" value={mapFloor} onChange={(e) => setMapFloor(e.target.value)} />
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.gif,.webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        props.onUploadMap(f, mapName.trim() || f.name, mapFloor.trim());
                        setMapName('');
                        setMapFloor('');
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
              ) : null}
            </>
          )}

          {/* ---------- อุปกรณ์ ---------- */}
          <div className="section-title">
            <span>
              อุปกรณ์
              <span className="sec-count">
                {shown.length}
                {shown.length !== props.totalAll && <small> / {props.totalAll}</small>}
              </span>
            </span>
            {activeMap && (
              <label className="panel-only-map" title="แสดงเฉพาะอุปกรณ์บนแผนผังนี้">
                <input type="checkbox" checked={onlyMap} onChange={(e) => setOnlyMap(e.target.checked)} />
                เฉพาะแผนผังนี้
              </label>
            )}
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
          </div>
          <div className="cam-list">
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
                {d.hide_on_map && d.x_percent == null ? (
                  <span className="row-hidden-tag" title="ตั้งค่าไม่แสดงบนแผนผัง">
                    <MapPinOff size={12} /> ไม่อยู่บนแผนผัง
                  </span>
                ) : canEdit && (d.x_percent == null || d.y_percent == null) ? (
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
