// ฟอร์มเลือกวิธีตรวจรายเครื่อง — ใช้ร่วมกันทั้ง DeviceModal / AddDeviceModal / PlacePanel
// ค่าเป็น string ทั้งหมด ('' = ไม่ระบุ) ให้แต่ละฟอร์มแปลงเป็น type ของตัวเองตอนบันทึก

export interface CheckMethodValue {
  method: string;
  port: string;
  community: string;
}

interface CheckMethodFieldsProps {
  value: CheckMethodValue;
  onChange: (v: CheckMethodValue) => void;
}

export function CheckMethodFields({ value, onChange }: CheckMethodFieldsProps) {
  const set = (k: keyof CheckMethodValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.value });

  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label>วิธีตรวจ</label>
          <select value={value.method} onChange={set('method')}>
            <option value="ping">Ping (ICMP)</option>
            <option value="tcp">TCP port</option>
            <option value="snmp">SNMP v2c</option>
          </select>
        </div>
        {value.method !== 'ping' && (
          <div className="form-group">
            <label>{value.method === 'tcp' ? 'พอร์ต *' : 'พอร์ต SNMP'}</label>
            <input
              inputMode="numeric"
              value={value.port}
              onChange={set('port')}
              placeholder={value.method === 'tcp' ? 'เช่น 80' : 'ว่าง = 161'}
            />
          </div>
        )}
      </div>
      {value.method === 'tcp' && (
        <p className="hint" style={{ marginTop: -4 }}>
          ต่อ TCP ไม่ติด = อุปกรณ์ down (ใช้กับเครื่องที่ปิด ping) — ไม่ใส่พอร์ตจะถอยไปใช้ ping
        </p>
      )}
      {value.method === 'snmp' && (
        <div className="form-group">
          <label>Community</label>
          <input value={value.community} onChange={set('community')} placeholder="ว่าง = public" spellCheck={false} />
          <p className="hint" style={{ marginTop: 4 }}>
            ถาม sysUpTime จากอุปกรณ์ — ไม่ตอบ = อุปกรณ์ down
          </p>
        </div>
      )}
    </>
  );
}
