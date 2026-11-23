// Combobox อเนกประสงค์: พิมพ์ค่าใหม่ได้ หรือเลือกจากค่าที่มีอยู่แล้วในระบบ (พร้อมจำนวนเครื่อง)
// ใช้กับฟิลด์ free-text ที่อยากให้ค่าซ้ำกัน (วงแลน, ตู้, ยี่ห้อ, รุ่น) — LanCombobox คือ wrapper ของตัวนี้
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { cn } from '../components/ui/utils';
import type { Device } from '../types/monitor';

interface SuggestOption {
  value: string;
  count: number;
}

interface SuggestComboboxProps {
  value: string;
  onChange: (v: string) => void;
  /** อุปกรณ์ทั้งหมดในระบบ — ใช้รวบรวมค่าที่มีอยู่ */
  devices: Device[];
  /** ดึงค่าของฟิลด์นี้จากอุปกรณ์แต่ละตัว */
  getValue: (d: Device) => string | null | undefined;
  /** ชื่อฟิลด์ เช่น 'วงแลน' / 'ตู้' — ใช้ประกอบข้อความใน dropdown */
  label: string;
  /** ชื่อสั้นสำหรับประโยค "ใช้…ใหม่" (ค่าเริ่มต้น = label) */
  newNoun?: string;
  /** ไอคอนหน้าตัวเลือกแต่ละแถว */
  icon?: React.ReactNode;
  placeholder?: string;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

export function SuggestCombobox({ value, onChange, devices, getValue, label, newNoun, icon, placeholder }: SuggestComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const noun = newNoun ?? label;

  // ค่าที่มีอยู่ — นับแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย แต่แสดงตามที่พบบ่อยสุด
  const all = useMemo<SuggestOption[]>(() => {
    const m = new Map<string, { names: Map<string, number>; count: number }>();
    for (const d of devices) {
      const v = getValue(d)?.trim();
      if (!v) continue;
      const k = v.toLowerCase();
      const e = m.get(k) || { names: new Map(), count: 0 };
      e.count++;
      e.names.set(v, (e.names.get(v) || 0) + 1);
      m.set(k, e);
    }
    return [...m.values()]
      .map((e) => ({ value: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0], count: e.count }))
      .sort((a, b) => byName(a.value, b.value));
  }, [devices, getValue]);

  const q = value.trim().toLowerCase();
  const options = q ? all.filter((o) => o.value.toLowerCase().includes(q)) : all;
  const exact = all.find((o) => o.value.toLowerCase() === q);
  const isNew = !!q && !exact;

  const pick = (v: string) => {
    onChange(v);
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
      pick(options[active].value);
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
            // พิมพ์ตรงกับค่าที่มีอยู่ (ต่างแค่ตัวพิมพ์/ช่องว่าง) → ใช้ชื่อเดิม กันค่าเดียวกันแตกเป็นหลายกลุ่ม
            if (exact && exact.value !== value) onChange(exact.value);
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
          title={`เลือก${label}ที่มีอยู่`}
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
          {options.length > 0 && <li className="combo-head">{label}ที่มีอยู่</li>}
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              data-idx={i}
              className={cn('combo-opt', i === active && 'active', exact?.value === o.value && 'selected')}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              <span className="combo-opt-label">
                {icon} {o.value}
              </span>
              <span className="combo-count">{o.count} เครื่อง</span>
            </li>
          ))}
          {isNew && (
            <li className="combo-new">
              <Plus size={12} /> ใช้{noun}ใหม่ “{value.trim()}”
            </li>
          )}
          {!options.length && !isNew && <li className="combo-empty">ยังไม่มี{label}ในระบบ — พิมพ์ชื่อ{noun}ได้เลย</li>}
        </ul>
      )}
    </div>
  );
}
