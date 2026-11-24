import { useEffect, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { LogAction, LogEntry } from '../../types/monitor';
import { getLogs } from '../../utils/monitorClient';

export const actionLabel: Record<LogAction, string> = {
  added: '➕ เพิ่ม',
  updated: '✏️ แก้ไข',
  moved: '📍 ย้าย',
  deleted: '🗑️ ลบ',
  down: '🔴 Offline',
  up: '🟢 Online',
  imported: '📥 นำเข้า',
  ip_table: '🗂️ TABLE_IP',
  snapshot: '📸 สแนปช็อต',
};

type LogFilter = '' | 'status' | 'edit';

export function LogsPage({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<LogFilter>('');

  useEffect(() => {
    getLogs(500)
      .then((rows) => {
        setLogs(rows);
        setError('');
      })
      .catch(() => setError('โหลดประวัติไม่ได้'));
  }, []);

  const shown = logs.filter((l) => {
    if (filter === 'status') return l.action === 'down' || l.action === 'up';
    if (filter === 'edit') return l.action !== 'down' && l.action !== 'up';
    return true;
  });

  return (
    <div className="dash-page">
      <div className="dash-inner">
        <h2 className="dash-head">
          ประวัติ ({shown.length})
          <button className="btn btn-dark btn-sm dash-back" onClick={onClose} title="กลับไปที่แผนผัง">
            <MapIcon size={14} /> กลับไปแผนผัง
          </button>
        </h2>
        <div className="filters" style={{ marginBottom: 12 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as LogFilter)}>
            <option value="">ทั้งหมด</option>
            <option value="status">สถานะ online / offline</option>
            <option value="edit">การแก้ไขข้อมูล</option>
          </select>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="dash-card list-page-card">
          <table className="cctv-table list-page-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>กิจกรรม</th>
                <th>อุปกรณ์</th>
                <th>โซน</th>
                <th>โดย</th>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((log) => (
                <tr key={log.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(log.timestamp).toLocaleString('th-TH')}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{actionLabel[log.action] || log.action}</td>
                  <td>{log.device_name || '—'}</td>
                  <td>{log.zone || '—'}</td>
                  <td>{log.employee_name || log.employee_id || '—'}</td>
                  <td>{log.details || '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && !error && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                    ยังไม่มีประวัติ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
