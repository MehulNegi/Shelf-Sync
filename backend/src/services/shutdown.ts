import type { EventEmitter } from 'node:events';

type ShutdownEvent = 'shutdown_started' | 'shutdown_timed_out' | 'shutdown_failed';

// The owner disposes this guard only after its HTTP requests/worker and resource
// cleanup finish. A sync abort request alone does not cancel the deadline.
export function installShutdown(stop: () => void, options: {
  signals?: Pick<EventEmitter, 'on' | 'removeListener'>;
  timeoutMs?: number;
  terminate?: (code: number) => void;
  log?: (event: ShutdownEvent) => void;
} = {}) {
  const signals = options.signals ?? process;
  const terminate = options.terminate ?? ((code: number) => process.exit(code));
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listener = () => {
    if (stopping) return;
    stopping = true;
    options.log?.('shutdown_started');
    timer = setTimeout(() => { options.log?.('shutdown_timed_out'); terminate(1); }, options.timeoutMs ?? 25000);
    timer.unref();
    try { stop(); } catch { options.log?.('shutdown_failed'); terminate(1); }
  };
  signals.on('SIGINT', listener);
  signals.on('SIGTERM', listener);
  return {
    dispose() {
      if (timer) clearTimeout(timer);
      signals.removeListener('SIGINT', listener);
      signals.removeListener('SIGTERM', listener);
    }
  };
}
