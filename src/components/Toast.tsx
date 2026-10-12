import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle, Info, X } from '@phosphor-icons/react';

const isHidden = () => document.hidden;
const subscribeVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};

export function Toast({ message, error, onDismiss }: { message: string; error: boolean; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hidden = useSyncExternalStore(subscribeVisibility, isHidden);
  const remaining = useRef(error ? 10000 : 5000);
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (hidden || hovered || focused) return;
    const started = performance.now();
    const timer = setTimeout(() => dismiss(), Math.max(0, remaining.current));
    return () => { clearTimeout(timer); remaining.current -= performance.now() - started; };
  }, [hidden, hovered, focused]);
  return <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {error ? <Info size={20} /> : <CheckCircle size={20} />}<span>{message}</span><button className="icon-button small" aria-label="Dismiss notification" onClick={onDismiss}><X size={15} /></button>
  </div>;
}
