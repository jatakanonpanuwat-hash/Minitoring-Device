import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, BookOpen, Download, ExternalLink, FileText, FileVideo, Image as ImageIcon, Map as MapIcon, Pencil,
  Presentation, Sheet, Trash2, Upload, X,
} from 'lucide-react';
import { confirmDialog } from '../../components/ui/confirm';
import { cn } from '../../components/ui/utils';
import {
  deleteTutorial, getTutorialLimits, getTutorials, reorderTutorials, updateTutorial, uploadTutorial, type Tutorial,
} from '../../utils/monitorClient';
import { useAuth } from '../shared/auth';
import { resolveUploadUrl } from '../shared/catalog';

// ชนิดไฟล์ → วิธีแสดงในหน้าเว็บ
type Kind = 'pdf' | 'image' | 'video' | 'text' | 'office';
function kindOf(ext: string): Kind {
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (ext === 'txt') return 'text';
  return 'office';
}

function KindIcon({ ext, size = 18 }: { ext: string; size?: number }) {
  const k = kindOf(ext);
  if (k === 'image') return <ImageIcon size={size} />;
  if (k === 'video') return <FileVideo size={size} />;
  if (['ppt', 'pptx'].includes(ext)) return <Presentation size={size} />;
  if (['xls', 'xlsx'].includes(ext)) return <Sheet size={size} />;
  return <FileText size={size} />;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const fileUrl = (t: Tutorial) => resolveUploadUrl(t.file_url);

interface TutorialPageProps {
  secret: string;
  onClose: () => void;
}

// เมนู Tutorial: รายการคู่มือ (ซ้าย) + เปิดดูในหน้า (ขวา) — Admin อัปโหลด / แก้ชื่อ / เรียง / ลบ ได้
export function TutorialPage({ secret, onClose }: TutorialPageProps) {
  const { isAdmin } = useAuth();
  const [list, setList] = useState<Tutorial[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // null = ปิด, 'new' = อัปโหลดใหม่, Tutorial = แก้ชื่อ/คำอธิบาย
  const [editing, setEditing] = useState<Tutorial | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await getTutorials();
      setList(rows);
      setError('');
      setSelectedId((cur) => (cur && rows.some((t) => t.id === cur) ? cur : rows[0]?.id ?? null));
    } catch {
      setError('โหลดรายการคู่มือไม่ได้');
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const selected = list.find((t) => t.id === selectedId) || null;

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    try {
      setList(await reorderTutorials(next.map((t) => t.id), secret));
    } catch (err) {
      setError((err as Error).message);
      load();
    }
  };

  const remove = async (t: Tutorial) => {
    if (!(await confirmDialog({ title: 'ลบคู่มือ', message: `ลบ "${t.title}" และไฟล์ ${t.file_name}?`, confirmLabel: 'ลบ', danger: true }))) return;
    try {
      await deleteTutorial(t.id, secret);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="dash-page">
      <div className="dash-inner tutorial-inner">
        <h2 className="dash-head">
          <span>
            คู่มือการใช้งาน <span className="dash-sub">· {list.length} รายการ</span>
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAdmin && (
              <button className="btn btn-green btn-sm" onClick={() => setEditing('new')}>
                <Upload size={14} /> อัปโหลดคู่มือ
              </button>
            )}
            <button className="btn btn-dark btn-sm dash-back" onClick={onClose} title="กลับไปที่แผนผัง">
              <MapIcon size={14} /> กลับไปแผนผัง
            </button>
          </span>
        </h2>
        {error && <div className="notice error" style={{ marginBottom: 12 }}>{error}</div>}

        {loaded && list.length === 0 ? (
          <div className="dash-card tutorial-empty">
            <BookOpen size={36} />
            <p>ยังไม่มีคู่มือ</p>
            {isAdmin ? (
              <button className="btn btn-green" onClick={() => setEditing('new')}>
                <Upload size={14} /> อัปโหลดคู่มือแรก
              </button>
            ) : (
              <span className="hint">ผู้ดูแลระบบยังไม่ได้อัปโหลดคู่มือ</span>
            )}
          </div>
        ) : (
          <div className="tutorial-layout">
            <div className="tutorial-list">
              {list.map((t, i) => (
                <div
                  key={t.id}
                  className={cn('tutorial-item', t.id === selectedId && 'active')}
                  onClick={() => setSelectedId(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedId(t.id)}
                >
                  <span className="tutorial-ico">
                    <KindIcon ext={t.ext} />
                  </span>
                  <span className="tutorial-meta">
                    <b>{t.title}</b>
                    {t.description && <span className="tutorial-desc">{t.description}</span>}
                    <span className="tutorial-sub">
                      {t.ext.toUpperCase()} · {formatSize(t.size)} · {new Date(t.created_at).toLocaleDateString('th-TH')}
                    </span>
                  </span>
                  {isAdmin && (
                    <span className="tutorial-actions" onClick={(e) => e.stopPropagation()}>
                      <button title="เลื่อนขึ้น" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button title="เลื่อนลง" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown size={14} />
                      </button>
                      <button title="แก้ชื่อ / คำอธิบาย" onClick={() => setEditing(t)}>
                        <Pencil size={14} />
                      </button>
                      <button title="ลบ" className="danger" onClick={() => remove(t)}>
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="dash-card tutorial-viewer">
              {selected && <TutorialViewer t={selected} />}
            </div>
          </div>
        )}
      </div>

      {editing && (
        <TutorialForm
          item={editing === 'new' ? null : editing}
          secret={secret}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            setEditing(null);
            setSelectedId(t.id);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------- ตัวเปิดไฟล์ ----------
function TutorialViewer({ t }: { t: Tutorial }) {
  const k = kindOf(t.ext);
  const url = fileUrl(t);
  return (
    <>
      <div className="tutorial-viewer-head">
        <div>
          <b>{t.title}</b>
          {t.description && <p>{t.description}</p>}
        </div>
        <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {k !== 'office' && (
            <a className="btn btn-dark btn-sm" href={url} target="_blank" rel="noopener noreferrer" title="เปิดในแท็บใหม่ (เต็มจอ / พิมพ์)">
              <ExternalLink size={14} /> เปิดแท็บใหม่
            </a>
          )}
          <a className="btn btn-dark btn-sm" href={url} download={t.file_name} title={t.file_name}>
            <Download size={14} /> ดาวน์โหลด
          </a>
        </span>
      </div>
      <div className="tutorial-frame">
        {k === 'pdf' || k === 'text' ? (
          <iframe key={t.id} src={url} title={t.title} />
        ) : k === 'image' ? (
          <img key={t.id} src={url} alt={t.title} />
        ) : k === 'video' ? (
          <video key={t.id} src={url} controls preload="metadata" />
        ) : (
          <div className="tutorial-office">
            <KindIcon ext={t.ext} size={40} />
            <p>
              ไฟล์ .{t.ext} เปิดดูในเบราว์เซอร์ไม่ได้
              <br />
              กดดาวน์โหลดแล้วเปิดด้วยโปรแกรม Office
            </p>
            <a className="btn btn-green" href={url} download={t.file_name}>
              <Download size={14} /> ดาวน์โหลด {t.file_name}
            </a>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- ฟอร์มอัปโหลด / แก้ไข ----------
function TutorialForm({
  item, secret, onClose, onSaved,
}: { item: Tutorial | null; secret: string; onClose: () => void; onSaved: (t: Tutorial) => void }) {
  const isNew = !item;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [limits, setLimits] = useState<{ exts: string[]; max_mb: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isNew) getTutorialLimits().then(setLimits).catch(() => {});
  }, [isNew]);

  const busy = progress !== null;
  const pick = (f: File | undefined) => {
    if (!f) return;
    setError('');
    const ext = `.${f.name.split('.').pop()?.toLowerCase()}`;
    if (limits && !limits.exts.includes(ext)) return setError(`ไม่รองรับไฟล์ ${ext} — ใช้ได้: ${limits.exts.join(' ')}`);
    if (limits && f.size > limits.max_mb * 1024 * 1024) return setError(`ไฟล์ใหญ่เกิน ${limits.max_mb}MB`);
    setFile(f);
    // ยังไม่ได้ตั้งชื่อ → ใช้ชื่อไฟล์ (ไม่เอานามสกุล)
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const save = async () => {
    setError('');
    try {
      if (isNew) {
        if (!file) return setError('เลือกไฟล์ก่อน');
        setProgress(0);
        onSaved(await uploadTutorial(file, { title: title.trim(), description: description.trim() }, secret, setProgress));
      } else {
        if (!title.trim()) return setError('ต้องมีชื่อคู่มือ');
        onSaved(await updateTutorial(item.id, { title: title.trim(), description: description.trim() }, secret));
      }
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  };

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div className="modal-box auth-box" onClick={(e) => e.stopPropagation()}>
        <div className="auth-head">
          <span className="auth-ico">{isNew ? <Upload size={20} /> : <Pencil size={20} />}</span>
          <div>
            <h2>{isNew ? 'อัปโหลดคู่มือ' : 'แก้ไขคู่มือ'}</h2>
            <p>{isNew ? 'ผู้ใช้ทุกคนจะเปิดดูได้ที่เมนู Tutorial' : item.file_name}</p>
          </div>
          <button type="button" className="panel-close" onClick={onClose} disabled={busy} title="ปิด">
            <X />
          </button>
        </div>

        {isNew && (
          <div className="form-group">
            <label>ไฟล์</label>
            <input
              ref={inputRef}
              type="file"
              style={{ display: 'none' }}
              accept={limits?.exts.join(',')}
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn btn-dark btn-block" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload size={14} /> {file ? `${file.name} (${formatSize(file.size)})` : 'เลือกไฟล์…'}
            </button>
            <span className="hint">
              PDF / รูปภาพ / วิดีโอ (.mp4 .webm) เปิดดูในหน้าเว็บได้ · Word / PowerPoint / Excel ให้ดาวน์โหลด
              {limits && ` · ไม่เกิน ${limits.max_mb}MB`}
            </span>
          </div>
        )}
        <div className="form-group">
          <label>ชื่อคู่มือ</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="เช่น วิธีเพิ่มกล้องบนแผนผัง" disabled={busy} />
        </div>
        <div className="form-group">
          <label>คำอธิบาย (ไม่บังคับ)</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} disabled={busy} />
        </div>

        {busy && (
          <div className="tutorial-progress" aria-label={`อัปโหลด ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
            <b>{progress! < 100 ? `กำลังอัปโหลด ${progress}%` : 'กำลังบันทึก…'}</b>
          </div>
        )}
        {error && <div className="notice error">{error}</div>}

        <button className="btn btn-green btn-block" disabled={busy || (isNew ? !file : !title.trim())} onClick={save}>
          {isNew ? <Upload size={14} /> : <Pencil size={14} />} {isNew ? 'อัปโหลด' : 'บันทึก'}
        </button>
      </div>
    </div>
  );
}
