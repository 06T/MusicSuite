import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Info, X } from '@phosphor-icons/react';

export function Toast({ message, error, onDismiss }: { message: string; error: boolean; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const remaining = useRef(error ? 10000 : 5000);
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (hidden || hovered || focused) return;
    const started = performance.now();
    const timer = setTimeout(() => dismiss.current(), Math.max(0, remaining.current));
    return () => { clearTimeout(timer); remaining.current -= performance.now() - started; };
  }, [hidden, hovered, focused]);
  return <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {error ? <Info size={20} /> : <CheckCircle size={20} />}<span>{message}</span><button className="icon-button small" aria-label="Dismiss notification" onClick={onDismiss}><X size={15} /></button>
  </div>;
}
