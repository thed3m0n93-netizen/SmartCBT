import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameToast } from './types';

export function useGameToasts(maxVisible = 2, durationMs = 2800) {
  const [toasts, setToasts] = useState<GameToast[]>([]);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<Map<number, number>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const triggerToast = useCallback(
    (text: string, tone: GameToast['tone'] = 'info') => {
      const id = ++toastIdRef.current;
      setToasts((prev) => {
        const deduped = prev.filter((item) => {
          if (item.text === text) {
            const oldTimer = toastTimersRef.current.get(item.id);
            if (oldTimer) {
              window.clearTimeout(oldTimer);
              toastTimersRef.current.delete(item.id);
            }
            return false;
          }
          return true;
        });

        const keepCount = Math.max(0, maxVisible - 1);
        const kept = keepCount > 0 ? deduped.slice(-keepCount) : [];
        if (deduped.length > kept.length) {
          const dropped = deduped.slice(0, deduped.length - kept.length);
          dropped.forEach((d) => {
            const t = toastTimersRef.current.get(d.id);
            if (t) {
              window.clearTimeout(t);
              toastTimersRef.current.delete(d.id);
            }
          });
        }
        return [...kept, { id, text, tone }];
      });

      const timer = window.setTimeout(() => {
        toastTimersRef.current.delete(id);
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, durationMs);
      toastTimersRef.current.set(id, timer);
    },
    [durationMs, maxVisible]
  );

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { toasts, triggerToast, dismissToast };
}
