import { InjectionToken } from '@angular/core';

/**
 * Cycles through a fixed list of values on an interval, pausing while any
 * pause reason is active (hover, focus, an open form, a manual choice…).
 *
 * Framework-free so the cycle can be tested with fake timers. Resuming starts
 * a fresh full interval, so the view never changes right after the user
 * leaves the card.
 */
export interface RotatorTimers {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export const browserTimers: RotatorTimers = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/** Timers used by components that host an `AutoRotator`; tests swap in a fake clock. */
export const ROTATOR_TIMERS = new InjectionToken<RotatorTimers>('ROTATOR_TIMERS', {
  providedIn: 'root',
  factory: () => browserTimers,
});

export class AutoRotator<T extends string> {
  private readonly reasons = new Set<string>();
  private timerId: unknown = null;
  private stopped = false;

  constructor(
    private readonly values: readonly T[],
    private readonly getCurrent: () => T,
    private readonly setCurrent: (value: T) => void,
    private readonly intervalMs = 5000,
    private readonly timers: RotatorTimers = browserTimers,
  ) {}

  /** Starts (or restarts) the cycle unless paused or stopped. */
  start(): void {
    this.clear();
    if (this.stopped || this.reasons.size > 0 || this.values.length < 2) return;
    this.timerId = this.timers.setInterval(() => this.advance(), this.intervalMs);
  }

  /** Adds or removes one pause reason; the cycle runs only with none active. */
  setPaused(reason: string, paused: boolean): void {
    const had = this.reasons.size > 0;
    if (paused) this.reasons.add(reason);
    else this.reasons.delete(reason);
    const has = this.reasons.size > 0;
    if (has && !had) this.clear();
    else if (!has && had) this.start();
  }

  isPaused(): boolean {
    return this.reasons.size > 0;
  }

  isRunning(): boolean {
    return this.timerId !== null;
  }

  /** Clears the timer for good (component destroy). */
  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private advance(): void {
    const index = this.values.indexOf(this.getCurrent());
    this.setCurrent(this.values[(index + 1) % this.values.length]);
  }

  private clear(): void {
    if (this.timerId !== null) {
      this.timers.clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}
