import {
  BatchProgressClock,
  estimateRemainingMs,
  formatDuration,
} from './batch-progress-clock';

/** QUI-1009 — cronómetro y estimado por ritmo real de los lotes. */
describe('BatchProgressClock (QUI-1009)', () => {
  let clock: BatchProgressClock;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    clock = new BatchProgressClock();
  });
  afterEach(() => {
    clock.dispose();
    jasmine.clock().uninstall();
  });

  it('el cronómetro avanza solo cada segundo y se congela al detenerse', () => {
    clock.start(4);
    expect(clock.elapsedLabel()).toBe('0 s');

    jasmine.clock().tick(3_000);
    expect(clock.elapsedMs()).toBe(3_000);
    expect(clock.elapsedLabel()).toBe('3 s');

    clock.stop();
    jasmine.clock().tick(10_000);
    expect(clock.elapsedMs()).toBe(3_000);
    expect(clock.running()).toBeFalse();
  });

  it('no inventa un estimado antes del primer lote y luego usa el ritmo medido', () => {
    clock.start(4);
    jasmine.clock().tick(5_000);
    expect(clock.remainingMs()).toBeNull();
    expect(clock.remainingLabel()).toBeNull();
    expect(clock.currentBatch()).toBe(1);

    // Primer lote en 10 s → faltan 3 lotes a 10 s cada uno.
    jasmine.clock().tick(5_000);
    clock.recordBatch(1);
    expect(clock.remainingMs()).toBe(30_000);
    expect(clock.remainingLabel()).toBe('~30 s');
    expect(clock.currentBatch()).toBe(2);

    // La cuenta baja sola entre lotes.
    jasmine.clock().tick(4_000);
    expect(clock.remainingMs()).toBe(26_000);

    // Segundo lote más lento: 30 s / 2 lotes = 15 s por lote × 2 que faltan.
    jasmine.clock().tick(16_000);
    clock.recordBatch(2);
    expect(clock.remainingMs()).toBe(30_000);
    expect(clock.currentBatch()).toBe(3);

    clock.recordBatch(4);
    expect(clock.remainingMs()).toBe(0);
    expect(clock.currentBatch()).toBe(4);
  });

  it('al reanudar a mitad mide solo los lotes de esta corrida', () => {
    clock.start(10, 6);
    expect(clock.currentBatch()).toBe(7);
    jasmine.clock().tick(2_000);
    clock.recordBatch(7);
    expect(clock.remainingMs()).toBe(3 * 2_000);
  });

  it('estimateRemainingMs nunca devuelve negativo', () => {
    expect(
      estimateRemainingMs({
        startedAt: 0,
        lastBatchAt: 1_000,
        now: 60_000,
        batchesDone: 1,
        batchesLeft: 2,
      }),
    ).toBe(0);
  });

  it('formatDuration', () => {
    expect(formatDuration(8_400)).toBe('8 s');
    expect(formatDuration(65_000)).toBe('1 min 05 s');
    expect(formatDuration(3_720_000)).toBe('1 h 02 min');
  });
});
