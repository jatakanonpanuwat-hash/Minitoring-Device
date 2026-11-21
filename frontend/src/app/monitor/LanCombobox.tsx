import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Network, Plus } from 'lucide-react';
import { cn } from '../components/ui/utils';
import type { Device } from '../types/monitor';

interface LanOption {
  lan: string;
  count: number;
}

interface LanComboboxProps {
  value: string;
  onChange: (lan: string) => void;
  /** อุปกรณ์ทั้งหมดในระบบ — ใช้รวบรวมวงแลนที่มีอยู่ */
  devices: Device[];
  placeholder?: string;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

/** ช่องวงแลน: พิมพ์ค่าใหม่ได้ หรือเลือกจากวงแลนที่มีอยู่แล้วในระบบ (พร้อมจำนวนเครื่อง) */
export function LanCombobox({ value, onChange, devices, placeholder }: LanComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // วงแลนที่มีอยู่ — นับแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย แต่แสดงตามที่พบบ่อยสุด
  const all = useMemo<LanOption[]>(() => {
    const m = new Map<string, { names: Map<string, number>; count: number }>();
    for (const d of devices) {
      const lan = d.lan?.trim();
      if (!lan) continue;
      const k = lan.toLowerCase();
      const e = m.get(k) || { names: new Map(), count: 0 };
      e.count++;
      e.names.set(lan, (e.names.get(lan) || 0) + 1);
      m.set(k, e);
    }
    return [...m.values()]
      .map((e) => ({ lan: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0], count: e.count }))
      .sort((a, b) => byName(a.lan, b.lan));
  }, [devices]);

  const q = value.trim().toLowerCase();
  const options = q ? all.filter((o) => o.lan.toLowerCase().includes(q)) : all;
  const exact = all.find((o) => o.lan.toLowerCase() === q);
  const isNew = !!q && !exact;

  const pick = (lan: string) => {
    onChange(lan);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!options.length) return;
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      setActive(next);
      listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      pick(options[active].lan);
    } else if (e.key === 'Escape' && open) {
      // ปิดแค่ dropdown — ไม่ให้ Esc ไปยกเลิกการวางอุปกรณ์
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  return (
    <div className={cn('combo', open && 'open')}>
      <div className="combo-field">
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            // พิมพ์ตรงกับวงที่มีอยู่ (ต่างแค่ตัวพิมพ์/ช่องว่าง) → ใช้ชื่อเดิม กันวงเดียวกันแตกเป็นหลายกลุ่ม
            if (exact && exact.lan !== value) onChange(exact.lan);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          title="เลือกวงแลนที่มีอยู่"
          onMouseDown={(e) => {
            e.preventDefault(); // อย่าให้ input เสีย focus
            setOpen(!open);
            inputRef.current?.focus();
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && (
        <ul className="combo-list" ref={listRef} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {options.length > 0 && <li className="combo-head">วงแลนที่มีอยู่</li>}
          {options.map((o, i) => (
            <li
              key={o.lan}
              role="option"
              aria-selected={i === active}
              data-idx={i}
              className={cn('combo-opt', i === active && 'active', exact?.lan === o.lan && 'selected')}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.lan)}
            >
              <span className="combo-opt-label">
                <Network size={12} /> {o.lan}
              </span>
              <span className="combo-count">{o.count} เครื่อง</span>
            </li>
          ))}
          {isNew && (
            <li className="combo-new">
              <Plus size={12} /> ใช้วงใหม่ “{value.trim()}”
            </li>
          )}
          {!options.length && !isNew && <li className="combo-empty">ยังไม่มีวงแลนในระบบ — พิมพ์ชื่อวงได้เลย</li>}
        </ul>
      )}
    </div>
  );
}
