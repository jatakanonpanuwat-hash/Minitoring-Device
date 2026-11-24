import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FolderOpen, RefreshCw } from 'lucide-react';
import { getXlsxSyncStatus, importXlsx, saveSettings, type XlsxImportSummary, type XlsxSyncStatus } from '../../utils/monitorClient';
import { confirmDialog } from '../../components/ui/confirm';
import { formatAgo } from '../../types/monitor';

interface ExcelImportProps {
  secret: string;
  onImported: () => void;
}

// อัปโหลดไฟล์ .xlsx (รูปแบบเดียวกับ Google Sheet CCTV เดิม) → ดูสรุปก่อน → ยืนยันนำเข้า
export function ExcelImport({ secret, onImported }: ExcelImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | 'project' | null>(null);
  const [cameras, setCameras] = useState(true);
  const [preview, setPreview] = useState<XlsxImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sync, setSync] = useState<XlsxSyncStatus | null>(null);
  const lastSyncRef = useRef<string | null | undefined>(undefined);

  // สถานะซิงก์อัตโนมัติ — ถ้า backend ซิงก์รอบใหม่ (บันทึกใน Excel) ให้รีเฟรชแผนที่/รายการ
  const loadSync = async () => {
    try {
      const st = await getXlsxSyncStatus();
      if (lastSyncRef.current !== undefined && st.last_sync && st.last_sync !== lastSyncRef.current) onImported();
      lastSyncRef.current = st.last_sync;
      setSync(st);
    } catch {
      setSync(null);
    }
  };
  useEffect(() => {
    loadSync();
    const t = setInterval(loadSync, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAuto = async (on: boolean) => {
    try {
      await saveSettings({ XLSX_AUTO_SYNC: on ? 'TRUE' : 'FALSE' }, secret);
      setMsg(on ? 'เปิดซิงก์อัตโนมัติแล้ว' : 'ปิดซิงก์อัตโนมัติแล้ว');
      setTimeout(loadSync, 1500);
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`);
    }
  };

  const run = async (f: File | 'project', dryRun: boolean, opts = { cameras }) => {
    if (!opts.cameras) {
      setMsg('ติ๊กเลือกกล้องก่อนนำเข้า');
      setPreview(null);
      return;
    }
    setBusy(true);
    setMsg(dryRun ? 'กำลังอ่านไฟล์…' : 'กำลังนำเข้า…');
    try {
      const r = await importXlsx(f, { ...opts, dryRun }, secret);
      if (dryRun) {
        setPreview(r);
        setMsg('');
      } else {
        const res = r.result!;
        const parts = [res.cameras && `กล้อง ${res.cameras.imported} ตัว`].filter(Boolean);
        const noImg = res.maps.filter((m) => m.status === 'no_image');
        setMsg(
          `✅ นำเข้าแล้ว: ${parts.join(', ')}` +
            (noImg.length ? ` — แผนผังที่ไม่มีรูป: ${noImg.map((m) => m.map_name).join(', ')} (อัปโหลดรูปในแท็บ Map)` : ''),
        );
        setPreview(null);
        setFile(null);
        onImported();
      }
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`);
      if (dryRun) setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: File | 'project' | undefined) => {
    if (!f) return;
    setFile(f);
    run(f, true);
  };

  const toggleCameras = (v: boolean) => {
    setCameras(v);
    if (file) run(file, true, { cameras: v });
  };

  const confirmImport = async () => {
    if (!file || !preview) return;
    const warn = preview.cameras
      ? `กล้องประเภท camera ที่มีอยู่ ${preview.cameras.current} ตัวจะถูกแทนที่ด้วย ${preview.cameras.count} ตัวจากไฟล์\n(ตำแหน่ง/สถานะที่แก้ในเว็บหลังนำเข้าครั้งก่อนจะหาย — อุปกรณ์ประเภทอื่นไม่โดนลบ)\n\n`
      : '';
    if (await confirmDialog({ title: 'นำเข้าข้อมูล', message: `${warn}ยืนยันนำเข้า?`, confirmLabel: 'นำเข้า', danger: true })) run(file, false);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {sync && (
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={sync.enabled} onChange={(e) => toggleAuto(e.target.checked)} />
            ซิงก์อัตโนมัติเมื่อบันทึกไฟล์ Excel ในโปรเจกต์
          </label>
          <p className="hint" style={{ marginTop: 4, lineHeight: 1.6 }}>
            <RefreshCw style={{ width: 12, height: 12, verticalAlign: -1 }} /> {sync.file}
            {!sync.exists && ' — ไม่พบไฟล์'}
            {sync.syncing && ' — กำลังซิงก์…'}
            {sync.last_sync && (
              <>
                <br />
                ซิงก์ล่าสุด {formatAgo(sync.last_sync)}
                {sync.last_result && `: ${sync.last_result}`}
              </>
            )}
            {sync.last_error && (
              <>
                <br />⚠ {sync.last_error}
              </>
            )}
            {sync.enabled && (
              <>
                <br />
                แก้ข้อมูลกล้องใน Excel แล้วกด Save — ที่แก้ในเว็บจะถูกทับ
              </>
            )}
          </p>
        </div>
      )}
      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={cameras} onChange={(e) => toggleCameras(e.target.checked)} />
          กล้อง (แท็บ cctv + Maps)
        </label>
      </div>
      <button className="btn btn-dark btn-block" disabled={busy} onClick={() => inputRef.current?.click()}>
        <FileSpreadsheet /> {file instanceof File ? `เลือกไฟล์ใหม่ (${file.name})` : 'เลือกไฟล์ Excel (.xlsx)'}
      </button>
      <button className="btn btn-block" style={{ marginTop: 6 }} disabled={busy} onClick={() => pick('project')}>
        <FolderOpen /> ใช้ไฟล์ในโปรเจกต์ (backend/data)
      </button>

      {preview && (
        <div className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
          <b>{preview.file}</b>
          {preview.cameras && (
            <div>
              กล้อง: {preview.cameras.count} ตัว (ในระบบตอนนี้ {preview.cameras.current})
              {preview.cameras.skipped > 0 && ` · ข้าม ${preview.cameras.skipped} แถวไม่มี id`}
            </div>
          )}
          {preview.maps.map((m) => (
            <div key={m.map_id}>
              แผนผัง {m.map_name}: {m.exists ? 'มีอยู่แล้ว (ใช้รูปเดิม)' : 'ใหม่ — จะลองโหลดรูปจาก Google Drive'}
            </div>
          ))}
          {preview.cameras === null && <div>ไม่พบข้อมูลที่จะนำเข้า</div>}
          {preview.warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
          <button
            className="btn btn-green btn-block"
            style={{ marginTop: 8 }}
            disabled={busy || !preview.cameras?.count}
            onClick={confirmImport}
          >
            นำเข้าข้อมูล
          </button>
        </div>
      )}
      {msg && (
        <p className="hint" style={{ marginTop: 8 }}>
          {msg}
        </p>
      )}
    </>
  );
}
