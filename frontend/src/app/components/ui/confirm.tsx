import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** ปุ่มยืนยันสีแดง (สำหรับลบ / เขียนทับ) */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export const useConfirm = () => useContext(ConfirmContext);

// เรียกจาก handler ตรง ๆ ได้โดยไม่ต้องอยู่ใน tree (เช่น handler ใน MonitorApp)
let globalConfirm: ConfirmFn = () => Promise.resolve(false);
export const confirmDialog = (opts: ConfirmOptions) => globalConfirm(opts);

/** Modal ยืนยันกลาง — เรียกผ่าน useConfirm() แล้ว await ผล (true = ยืนยัน) */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(ok: boolean) => void>(() => {});
  const pending = useRef(false);

  const confirm: ConfirmFn = useCallback(
    (opts) =>
      new Promise<boolean>((resolve) => {
        if (pending.current) resolver.current(false); // มีอันเก่าค้าง = ยกเลิกอันเก่า
        pending.current = true;
        resolver.current = (ok: boolean) => {
          pending.current = false;
          resolve(ok);
        };
        setState(opts);
      }),
    []
  );

  const done = useCallback((ok: boolean) => {
    setState(null);
    resolver.current(ok);
  }, []);

  useEffect(() => {
    globalConfirm = confirm;
  }, [confirm]);

  // Esc = ยกเลิก
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, done]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        // คลิกพื้นหลัง = ยกเลิก
        <div className="modal confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
          <div
            className={state.danger ? 'modal-box confirm-box danger' : 'modal-box confirm-box'}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <button className="panel-close confirm-close" onClick={() => done(false)} title="ปิด (Esc)">
              <X size={16} />
            </button>
            <div className="confirm-body">
              <span className={state.danger ? 'confirm-ico danger' : 'confirm-ico'}>
                {state.danger ? <AlertTriangle size={22} /> : <Info size={22} />}
              </span>
              <div className="confirm-text">
                <h2 id="confirm-title">{state.title}</h2>
                <div className="confirm-msg">{state.message}</div>
              </div>
            </div>
            <div className="confirm-actions">
              <button className="btn btn-dark" onClick={() => done(false)}>
                {state.cancelLabel ?? 'ยกเลิก'}
              </button>
              <button autoFocus className={state.danger ? 'btn btn-red' : 'btn btn-green'} onClick={() => done(true)}>
                {state.confirmLabel ?? 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
