import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';

export function Modal({ title, description, children, onClose, busy = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const dismissBackdrop = useEffectEvent((event: MouseEvent) => {
    const dialog = ref.current;
    if (!dialog || event.target !== dialog || busy) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  });
  useEffect(() => {
    const dialog = ref.current; const trigger = document.activeElement as HTMLElement | null;
    const click = (event: MouseEvent) => dismissBackdrop(event);
    dialog?.addEventListener('click', click);
    dialog?.showModal();
    return () => { dialog?.removeEventListener('click', click); dialog?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><h2 id={`${id}-title`}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={20} /></button></div>
    {description && <p className="modal-description" id={`${id}-description`}>{description}</p>}
    {children}
  </dialog>;
}
