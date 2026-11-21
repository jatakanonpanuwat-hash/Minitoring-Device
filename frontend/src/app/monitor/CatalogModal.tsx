import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Plus, Trash2, Upload, X } from 'lucide-react';
import { confirmDialog } from '../components/ui/confirm';
import { cn } from '../components/ui/utils';
import type { Catalog, CatalogItem, CatalogKind, Device } from '../types/monitor';
import { saveCatalog, uploadIcon } from '../utils/monitorClient';
import { CatalogIcon, ICONS, newKey } from './catalog';

interface CatalogModalProps {
  catalog: Catalog;
  devices: Device[];
  secret: string;
  onSaved: (c: Catalog) => void;
  onClose: () => void;
}

const TABS: { kind: CatalogKind; label: string; hint: string }[] = [
  { kind: 'types', label: 'ประเภท', hint: 'ประเภทอุปกรณ์ — ไอคอนจะแสดงบนหมุดในแผนผัง' },
  {
    kind: 'statuses',
    label: 'สถานะ',
    hint: 'สถานะหลัก (🔒) ระบบ ping ใช้ — ลบไม่ได้ แต่เปลี่ยนชื่อ/สี/ไอคอนได้ สถานะที่เพิ่มเองเป็นสถานะที่ตั้งด้วยมือ เลือกได้ว่าจะหยุด ping หรือไม่',
  },
  { kind: 'zones', label: 'โซน', hint: 'โซน/พื้นที่ติดตั้ง — ใช้กรองและแสดงในรายการ' },
];

const FIELD: Record<CatalogKind, keyof Device> = { types: 'device_type', statuses: 'status', zones: 'zone' };
const PREFIX: Record<CatalogKind, string> = { types: 't', statuses: 's', zones: 'z' };
const PALETTE = ['#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#ef4444', '#db2777', '#7c3aed', '#475569'];

export function CatalogModal({ catalog, devices, secret, onSaved, onClose }: CatalogModalProps) {
  const [kind, setKind] = useState<CatalogKind>('types');
  const [drafts, setDrafts] = useState<Catalog>(() => structuredClone(catalog));
  const [dirty, setDirty] = useState<Record<CatalogKind, boolean>>({ types: false, statuses: false, zones: false });
  const [picker, setPicker] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const items = drafts[kind];
  const usage = useMemo(() => {
    const field = FIELD[kind];
    const m: Record<string, number> = {};
    for (const d of devices) {
      const v = d[field] as string | null;
      if (v) m[v] = (m[v] || 0) + 1;
    }
    return m;
  }, [devices, kind]);

  const update = (next: CatalogItem[]) => {
    setDrafts({ ...drafts, [kind]: next });
    setDirty({ ...dirty, [kind]: true });
    setMsg(null);
  };
  const patch = (i: number, p: Partial<CatalogItem>) => update(items.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const add = () => {
    const item: CatalogItem = { key: newKey(PREFIX[kind]), label: '', icon: kind === 'zones' ? '' : 'lucide:Box' };
    if (kind !== 'types') item.color = PALETTE[items.length % PALETTE.length];
    if (kind === 'statuses') item.pause_monitor = true;
    update([...items, item]);
    setPicker(null);
  };

  const switchTab = async (k: CatalogKind) => {
    if (dirty[kind] && !(await confirmDialog({ title: 'ทิ้งการแก้ไข?', message: 'มีการแก้ไขที่ยังไม่บันทึก — ทิ้งการแก้ไขแท็บนี้?', confirmLabel: 'ทิ้ง', danger: true }))) return;
    setDrafts({ ...drafts, [kind]: structuredClone(catalog[kind]) });
    setDirty({ ...dirty, [kind]: false });
    setKind(k);
    setPicker(null);
    setMsg(null);
  };

  const save = async () => {
    const empty = items.find((i) => !i.label.trim());
    if (empty) {
      setMsg({ ok: false, text: 'ทุกรายการต้องมีชื่อ' });
      return;
    }
    if (!(await confirmDialog({ title: 'บันทึกรายการ', message: `บันทึกรายการ${tab.title}?`, confirmLabel: 'บันทึก' }))) return;
    setBusy(true);
    try {
      const saved = await saveCatalog(kind, items.map((i) => ({ ...i, label: i.label.trim() })), secret);
      onSaved(saved);
      setDrafts({ ...drafts, [kind]: structuredClone(saved[kind]) });
      setDirty({ ...dirty, [kind]: false });
      setMsg({ ok: true, text: 'บันทึกแล้ว' });
    } catch (e) {
      const text = (e as Error).message;
      setMsg({ ok: false, text: /401/.test(text) ? 'ไม่มีสิทธิ์ — กรุณาเข้าสู่ระบบด้วยบัญชี Admin' : text });
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    if (picker == null) return;
    setBusy(true);
    try {
      const icon = await uploadIcon(file, secret);
      patch(picker, { icon });
      setPicker(null);
    } catch (e) {
      const text = (e as Error).message;
      setMsg({ ok: false, text: /401/.test(text) ? 'ไม่มีสิทธิ์ — กรุณาเข้าสู่ระบบด้วยบัญชี Admin' : text });
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (Object.values(dirty).some(Boolean) && !(await confirmDialog({ title: 'ปิดเลยหรือไม่?', message: 'มีการแก้ไขที่ยังไม่บันทึก — ปิดเลยหรือไม่?', confirmLabel: 'ปิดเลย', danger: true }))) return;
    onClose();
  };

  const tab = TABS.find((t) => t.kind === kind)!;

  return (
    <div className="modal" onClick={close}>
      <div className="modal-box wide catalog-modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          จัดการรายการ
          <button className="panel-close" onClick={close} title="ปิด">
            <X />
          </button>
        </h2>

        <div className="catalog-tabs">
          {TABS.map((t) => (
            <button key={t.kind} className={cn(kind === t.kind && 'active')} onClick={() => kind !== t.kind && switchTab(t.kind)}>
              {t.label}
              <span className="count">{drafts[t.kind].length}</span>
              {dirty[t.kind] && <span className="dirty" title="ยังไม่บันทึก" />}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          {tab.hint}
        </p>

        <div className="catalog-list">
          {items.map((it, i) => {
            const used = usage[it.key] || 0;
            return (
              <div key={it.key} className="catalog-row-wrap">
                <div className="catalog-row">
                  <button
                    className={cn('catalog-icon-btn', picker === i && 'active')}
                    style={it.color ? ({ '--c': it.color } as React.CSSProperties) : undefined}
                    title="เลือกไอคอน"
                    onClick={() => setPicker(picker === i ? null : i)}
                  >
                    {it.icon || kind !== 'zones' ? <CatalogIcon icon={it.icon} size={18} /> : <span className="zone-dot big" />}
                  </button>
                  <input
                    className="grow"
                    value={it.label}
                    placeholder="ชื่อ"
                    maxLength={60}
                    onChange={(e) => patch(i, { label: e.target.value })}
                  />
                  {it.color !== undefined && (
                    <input
                      type="color"
                      className="catalog-color"
                      value={it.color}
                      title="สี"
                      onChange={(e) => patch(i, { color: e.target.value })}
                    />
                  )}
                  {kind === 'statuses' && (
                    <label className={cn('catalog-pause', it.builtin && 'disabled')} title={it.builtin ? 'สถานะหลัก — ระบบกำหนด' : ''}>
                      <input
                        type="checkbox"
                        checked={!!it.pause_monitor}
                        disabled={it.builtin}
                        onChange={(e) => patch(i, { pause_monitor: e.target.checked })}
                      />
                      หยุด ping
                    </label>
                  )}
                  <span className="catalog-usage" title="จำนวนอุปกรณ์ที่ใช้">
                    {used} เครื่อง
                  </span>
                  <button className="mini-btn" title="เลื่อนขึ้น" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </button>
                  <button className="mini-btn" title="เลื่อนลง" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </button>
                  {it.builtin ? (
                    <span className="mini-btn locked" title="สถานะหลัก ลบไม่ได้">
                      <Lock />
                    </span>
                  ) : (
                    <button
                      className="mini-btn danger"
                      title={used ? `ยังมีอุปกรณ์ใช้อยู่ ${used} เครื่อง` : 'ลบ'}
                      disabled={used > 0}
                      onClick={() => {
                        update(items.filter((_, j) => j !== i));
                        setPicker(null);
                      }}
                    >
                      <Trash2 />
                    </button>
                  )}
                </div>

                {picker === i && (
                  <div className="icon-picker">
                    <div className="icon-grid">
                      {kind === 'zones' && (
                        <button className={cn(!it.icon && 'active')} title="ไม่มีไอคอน (จุดสี)" onClick={() => { patch(i, { icon: '' }); setPicker(null); }}>
                          <span className="zone-dot big" style={{ '--c': it.color } as React.CSSProperties} />
                        </button>
                      )}
                      {Object.entries(ICONS).map(([name, I]) => (
                        <button
                          key={name}
                          title={name}
                          className={cn(it.icon === `lucide:${name}` && 'active')}
                          onClick={() => {
                            patch(i, { icon: `lucide:${name}` });
                            setPicker(null);
                          }}
                        >
                          <I size={18} />
                        </button>
                      ))}
                    </div>
                    <div className="icon-picker-foot">
                      <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                        <Upload size={14} /> อัปโหลดโลโก้ / รูปไอคอน
                      </button>
                      <span className="hint">.png .jpg .webp .gif .svg ไม่เกิน 512KB (แนะนำรูปสี่เหลี่ยมจัตุรัส พื้นใส)</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && <p className="hint">ยังไม่มีรายการ</p>}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />

        <div className="catalog-foot">
          <button className="btn btn-dark" onClick={add}>
            <Plus size={16} /> เพิ่ม{tab.label}
          </button>
          <span className="spacer" />
          {msg && <span className={cn('catalog-msg', msg.ok ? 'ok' : 'err')}>{msg.text}</span>}
          <button className="btn btn-green" disabled={busy || !dirty[kind]} onClick={save}>
            บันทึก{tab.label}
          </button>
        </div>
      </div>
    </div>
  );
}
