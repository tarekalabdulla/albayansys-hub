import { useEffect, useRef } from "react";

interface UseIdleTimeoutOptions {
  /** Total idle time (ms) before logout fires. */
  timeout: number;
  /** How long before logout to show the warning (ms). */
  warningBefore: number;
  /** Called when warning threshold reached. */
  onWarning: () => void;
  /** Called when full timeout reached. */
  onTimeout: () => void;
  /** Called whenever activity resets the timer (e.g. to dismiss a warning toast). */
  onReset?: () => void;
  /** Disable the watcher (e.g. when user is logged out). */
  disabled?: boolean;
}

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

/**
 * Watches user activity and fires onWarning + onTimeout after the configured
 * idle period. Timers are reset on any activity event.
 */
export function useIdleTimeout({
  timeout,
  warningBefore,
  onWarning,
  onTimeout,
  onReset,
  disabled,
}: UseIdleTimeoutOptions) {
  const warningRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const warnedRef = useRef(false);

  useEffect(() => {
    if (disabled) return;

    const clearTimers = () => {
      if (warningRef.current !== null) {
        window.clearTimeout(warningRef.current);
        warningRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const startTimers = () => {
      clearTimers();
      warningRef.current = window.setTimeout(() => {
        warnedRef.current = true;
        onWarning();
      }, Math.max(0, timeout - warningBefore));
      timeoutRef.current = window.setTimeout(() => {
        onTimeout();
      }, timeout);
    };

    const handleActivity = () => {
      if (warnedRef.current) {
        warnedRef.current = false;
        onReset?.();
      }
      startTimers();
    };

    startTimers();
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, handleActivity, { passive: true }),
    );

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, handleActivity),
      );
    };
  }, [timeout, warningBefore, onWarning, onTimeout, onReset, disabled]);
}
