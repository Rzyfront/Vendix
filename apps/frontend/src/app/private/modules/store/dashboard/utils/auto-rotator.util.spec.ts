import { AutoRotator, RotatorTimers } from './auto-rotator.util';

/** Fake interval clock: time only moves when the test calls tick(). */
class FakeTimers implements RotatorTimers {
  private now = 0;
  private nextId = 1;
  private readonly intervals = new Map<number, { handler: () => void; ms: number; due: number }>();

  setInterval(handler: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.intervals.set(id, { handler, ms, due: this.now + ms });
    return id;
  }

  clearInterval(id: unknown): void {
    this.intervals.delete(id as number);
  }

  pending(): number {
    return this.intervals.size;
  }

  tick(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let nextId = -1;
      let nextDue = Infinity;
      for (const [id, t] of this.intervals) {
        if (t.due <= end && t.due < nextDue) {
          nextDue = t.due;
          nextId = id;
        }
      }
      if (nextId === -1) break;
      const t = this.intervals.get(nextId)!;
      this.now = t.due;
      t.due += t.ms;
      t.handler();
    }
    this.now = end;
  }
}

type View = 'channels' | 'log';

function setup() {
  const timers = new FakeTimers();
  let view: View = 'channels';
  const rotator = new AutoRotator<View>(
    ['channels', 'log'],
    () => view,
    (v) => (view = v),
    5000,
    timers,
  );
  return { timers, rotator, view: () => view, setView: (v: View) => (view = v) };
}

describe('AutoRotator', () => {
  it('shows Rosa first and alternates every 5 seconds', () => {
    const { timers, rotator, view } = setup();
    rotator.start();

    expect(view()).toBe('channels');
    timers.tick(4999);
    expect(view()).toBe('channels');
    timers.tick(1);
    expect(view()).toBe('log');
    timers.tick(5000);
    expect(view()).toBe('channels');
    timers.tick(5000);
    expect(view()).toBe('log');
  });

  it('does not rotate while paused and restarts a full interval on resume', () => {
    const { timers, rotator, view } = setup();
    rotator.start();
    timers.tick(4000);

    rotator.setPaused('hover', true);
    timers.tick(20000);
    expect(view()).toBe('channels');
    expect(timers.pending()).toBe(0);

    rotator.setPaused('hover', false);
    timers.tick(4999);
    expect(view()).toBe('channels');
    timers.tick(1);
    expect(view()).toBe('log');
  });

  it('stays paused until every reason is cleared (hover + open form)', () => {
    const { timers, rotator, view, setView } = setup();
    rotator.start();
    setView('log');

    rotator.setPaused('hover', true);
    rotator.setPaused('log-busy', true);
    rotator.setPaused('hover', false);
    timers.tick(15000);
    expect(view()).toBe('log');
    expect(rotator.isPaused()).toBe(true);

    rotator.setPaused('log-busy', false);
    expect(rotator.isPaused()).toBe(false);
    timers.tick(5000);
    expect(view()).toBe('channels');
  });

  it('keeps a manual choice until the manual pause is lifted', () => {
    const { timers, rotator, view, setView } = setup();
    rotator.start();

    setView('log');
    rotator.setPaused('manual', true);
    timers.tick(30000);
    expect(view()).toBe('log');

    rotator.setPaused('manual', false);
    timers.tick(5000);
    expect(view()).toBe('channels');
  });

  it('clears the timer on stop and never restarts afterwards', () => {
    const { timers, rotator, view } = setup();
    rotator.start();
    expect(timers.pending()).toBe(1);

    rotator.stop();
    expect(timers.pending()).toBe(0);
    expect(rotator.isRunning()).toBe(false);

    rotator.setPaused('hover', true);
    rotator.setPaused('hover', false);
    rotator.start();
    timers.tick(20000);
    expect(timers.pending()).toBe(0);
    expect(view()).toBe('channels');
  });
});
