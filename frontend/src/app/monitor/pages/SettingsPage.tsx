import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BellRing, FileSpreadsheet, ListChecks, Lock, Map as MapIcon, Radar, Users } from 'lucide-react';
import { cn } from '../../components/ui/utils';
import { CatalogIcon } from '../shared/catalog';
import { ExcelImport } from '../settings/ExcelImport';
import { useCatalog } from '../shared/catalog';
import { useAuth } from '../shared/auth';
import { UsersSection } from '../settings/UsersSection';
import { TelegramSection } from '../settings/TelegramSection';
import { MonitorRunLog } from '../settings/MonitorRunLog';

export interface MonitorForm {
  enabled: boolean;
  intervalSec: string;
  timeoutMs: string;
  failThreshold: string;
  warnMs: string;
  /** ประเภทอุปกรณ์ที่ ping — null = ทุกประเภท */
  types: string[] | null;
}

interface SettingsPageProps {
  onClose: () => void;
  secret: string;
  authRequired: boolean;
  onSecret: (v: string) => void;
  onCheckAdmin: () => void;
  adminResult: string;
  monitorForm: MonitorForm;
  onMonitorForm: (v: MonitorForm) => void;
  onSaveMonitor: () => void;
  /** ping ทั้งหมดครบรอบ — โหลดสถานะอุปกรณ์ใหม่ */
  onMonitorRunDone: () => void;
  monitorResult: string;
  onOpenCatalog: () => void;
  onImported: () => void;
}

type SectionKey = 'users' | 'monitor' | 'telegram' | 'catalog' | 'import';

interface Section {
  key: SectionKey;
  icon: LucideIcon;
  title: string;
  desc: string;
}

const SECTIONS: Section[] = [
  { key: 'users', icon: Users, title: 'ผู้ใช้งาน', desc: 'บัญชี login และสิทธิ์ Admin / Editor' },
  { key: 'monitor', icon: Radar, title: 'Monitor', desc: 'ping อัตโนมัติ · รอบเวลา · เกณฑ์สถานะ' },
  { key: 'telegram', icon: BellRing, title: 'แจ้งเตือน Telegram', desc: 'ส่งข้อความเมื่ออุปกรณ์ Offline / กลับมา Online' },
  { key: 'catalog', icon: ListChecks, title: 'ประเภท / สถานะ / โซน', desc: 'ไอคอน สี และชื่อของรายการ' },
  { key: 'import', icon: FileSpreadsheet, title: 'นำเข้าจาก Excel', desc: 'นำเข้าอุปกรณ์และแผนผังจากไฟล์' },
];

// จำหัวข้อที่เปิดล่าสุดไว้ในเบราว์เซอร์
const SECTION_KEY = 'monitoring-device:settings-section';

export function SettingsPage(props: SettingsPageProps) {
  const catalog = useCatalog();
  const mf = props.monitorForm;
  const setMf = (k: keyof MonitorForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    props.onMonitorForm({ ...mf, [k]: e.target.value });

  const { isAdmin, requestLogin, user } = useAuth();
  // โหมดเปิด (ยังไม่มีผู้ใช้) — ซ่อนหัวข้อผู้ใช้ ให้ตั้งค่าบัญชีแรกจากปุ่มบน TopBar
  const sections = SECTIONS.filter((x) => x.key !== 'users' || !!user);
  const [active, setActiveState] = useState<SectionKey>(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(SECTION_KEY) || '';
    } catch {
      /* storage ใช้ไม่ได้ */
    }
    return (sections.find((x) => x.key === saved) || sections[0]).key;
  });
  const setActive = (k: SectionKey) => {
    setActiveState(k);
    try {
      localStorage.setItem(SECTION_KEY, k);
    } catch {
      /* storage ใช้ไม่ได้ */
    }
  };
  const current = sections.find((x) => x.key === active) || sections[0];
  const Icon = current.icon;

  return (
    <div className="dash-page">
      <div className="dash-inner">
        <h2 className="dash-head">
          Settings
          <button className="btn btn-dark btn-sm dash-back" onClick={props.onClose} title="กลับไปที่แผนผัง">
            <MapIcon size={14} /> กลับไปแผนผัง
          </button>
        </h2>

        {props.adminResult && <div className="notice settings-notice">{props.adminResult}</div>}

        {!isAdmin ? (
          <div className="dash-card settings-gate">
            <Lock size={28} />
            <h3>หน้านี้สำหรับ Admin</h3>
            <p>{user ? `บัญชี ${user.display_name} เป็น Editor — ติดต่อ Admin หากต้องการเปลี่ยนการตั้งค่า` : 'เข้าสู่ระบบด้วยบัญชี Admin เพื่อตั้งค่าระบบ'}</p>
            {!user && (
              <button className="btn btn-green" onClick={requestLogin}>
                เข้าสู่ระบบ
              </button>
            )}
          </div>
        ) : (
        <div className="settings-layout">
          <nav className="settings-nav">
            {sections.map((x) => (
              <button
                key={x.key}
                className={cn('settings-nav-item', x.key === current.key && 'active')}
                onClick={() => setActive(x.key)}
              >
                <x.icon size={18} />
                <span>
                  <b>{x.title}</b>
                  <small>{x.desc}</small>
                </span>
              </button>
            ))}
          </nav>

          <section className="dash-card settings-content">
            <header className="settings-content-head">
              <Icon size={20} />
              <div>
                <h3>{current.title}</h3>
                <p>{current.desc}</p>
              </div>
            </header>

            <div className="settings-content-body">
              {current.key === 'users' && <UsersSection />}

              {current.key === 'telegram' && <TelegramSection />}

              {current.key === 'monitor' && (
                <>
                  <div className="form-group">
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={mf.enabled}
                        onChange={(e) => props.onMonitorForm({ ...mf, enabled: e.target.checked })}
                      />
                      เปิด ping อุปกรณ์ทุกตัวที่มี IP
                    </label>
                  </div>
                  <div className="settings-fields">
                    <div className="form-group">
                      <label>ทุก (วินาที)</label>
                      <input type="number" min={10} value={mf.intervalSec} onChange={setMf('intervalSec')} />
                    </div>
                    <div className="form-group">
                      <label>Timeout (ms)</label>
                      <input type="number" min={200} value={mf.timeoutMs} onChange={setMf('timeoutMs')} />
                    </div>
                    <div className="form-group">
                      <label>Offline เมื่อหลุด (ครั้ง)</label>
                      <input type="number" min={1} value={mf.failThreshold} onChange={setMf('failThreshold')} />
                    </div>
                    <div className="form-group">
                      <label>Warn เมื่อช้ากว่า (ms)</label>
                      <input type="number" min={1} value={mf.warnMs} onChange={setMf('warnMs')} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>ประเภทอุปกรณ์ที่ ping</label>
                    <div className="monitor-type-mode">
                      <label className="settings-check">
                        <input
                          type="radio"
                          name="monitor-type-mode"
                          checked={!mf.types}
                          onChange={() => props.onMonitorForm({ ...mf, types: null })}
                        />
                        ทุกประเภท
                      </label>
                      <label className="settings-check">
                        <input
                          type="radio"
                          name="monitor-type-mode"
                          checked={!!mf.types}
                          onChange={() => props.onMonitorForm({ ...mf, types: mf.types || catalog.types.map((t) => t.key) })}
                        />
                        เลือกเฉพาะประเภท
                      </label>
                    </div>
                    {mf.types && (
                      <>
                        <div className="monitor-type-grid">
                          {catalog.types.map((t) => {
                            const on = mf.types!.includes(t.key);
                            return (
                              <label key={t.key} className={cn('monitor-type-chip', on && 'on')}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() =>
                                    props.onMonitorForm({
                                      ...mf,
                                      types: on ? mf.types!.filter((k) => k !== t.key) : [...mf.types!, t.key],
                                    })
                                  }
                                />
                                <CatalogIcon icon={t.icon} size={15} />
                                <span>{t.label}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="monitor-type-tools">
                          <button type="button" className="link-btn" onClick={() => props.onMonitorForm({ ...mf, types: catalog.types.map((t) => t.key) })}>
                            เลือกทั้งหมด
                          </button>
                          <button type="button" className="link-btn" onClick={() => props.onMonitorForm({ ...mf, types: [] })}>
                            ล้าง
                          </button>
                          <span className="hint">
                            เลือก {mf.types.filter((k) => catalog.types.some((t) => t.key === k)).length}/{catalog.types.length} ประเภท · ประเภทที่ไม่ได้เลือกจะไม่ถูก ping (ทั้งรอบอัตโนมัติและ Ping ทั้งหมด)
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="btn-row settings-actions">
                    <button className="btn btn-green" onClick={props.onSaveMonitor}>
                      บันทึก
                    </button>
                  </div>
                  {props.monitorResult && (
                    <p className="hint" style={{ marginTop: 10 }}>
                      {props.monitorResult}
                    </p>
                  )}

                  <div className="settings-subhead">Ping ทั้งหมด / Log</div>
                  <MonitorRunLog secret={props.secret} onFinished={props.onMonitorRunDone} />
                </>
              )}

              {current.key === 'catalog' && (
                <>
                  <div className="settings-counts">
                    <div>
                      <b>{catalog.types.length}</b>
                      <span>ประเภท</span>
                    </div>
                    <div>
                      <b>{catalog.statuses.length}</b>
                      <span>สถานะ</span>
                    </div>
                    <div>
                      <b>{catalog.zones.length}</b>
                      <span>โซน</span>
                    </div>
                  </div>
                  <button className="btn btn-dark" onClick={props.onOpenCatalog}>
                    <ListChecks size={14} /> จัดการรายการ (ไอคอน / สี / ชื่อ)
                  </button>
                </>
              )}

              {current.key === 'import' && <ExcelImport secret={props.secret} onImported={props.onImported} />}
            </div>
          </section>
        </div>
        )}
      </div>
    </div>
  );
}
