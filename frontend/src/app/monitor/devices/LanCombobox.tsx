import { Network } from 'lucide-react';
import type { Device } from '../../types/monitor';
import { SuggestCombobox } from './SuggestCombobox';

interface LanComboboxProps {
  value: string;
  onChange: (lan: string) => void;
  /** อุปกรณ์ทั้งหมดในระบบ — ใช้รวบรวมวงแลนที่มีอยู่ */
  devices: Device[];
  placeholder?: string;
}

/** ช่องวงแลน: พิมพ์ค่าใหม่ได้ หรือเลือกจากวงแลนที่มีอยู่แล้วในระบบ (พร้อมจำนวนเครื่อง) */
export function LanCombobox({ value, onChange, devices, placeholder }: LanComboboxProps) {
  return (
    <SuggestCombobox
      value={value}
      onChange={onChange}
      devices={devices}
      getValue={(d) => d.lan}
      label="วงแลน"
      newNoun="วง"
      icon={<Network size={12} />}
      placeholder={placeholder}
    />
  );
}
