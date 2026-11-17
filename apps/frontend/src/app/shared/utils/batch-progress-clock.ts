import { computed, signal } from '@angular/core';

/**
 * Cronómetro y estimado de una carga masiva que se envía por lotes (QUI-1009).
 *
 * El estimado sale del ritmo REAL de los lotes ya terminados en esta corrida
 * (tiempo hasta el último lote / lotes hechos), no de un valor fijo: hasta que
 * termina el primer lote no hay ritmo y `remainingMs` es `null` («calculando»).
 * Entre lotes la cuenta baja sola con el reloj, así la pantalla nunca se ve
 * congelada.
 *
 * Es estado de UI con signals (zoneless): el componente lo crea como campo y
 * llama `dispose()` al destruirse para soltar el intervalo de 1 s.
 */
export class BatchProgressClock {
  private readonly now = signal(0);
  private readonly startedAt = signal<number | null>(null);
  private readonly stoppedAt = signal<number | null>(null);
  private readonly lastBatchAt = signal<number | null>(null);
  /** Lotes ya hechos al arrancar (un reintento manual reanuda a mitad). */
  private readonly batchesAtStart = signal(0);
  private readonly doneBatches = signal(0);
  private readonly totalBatchesState = signal(0);
  private tickId: ReturnType<typeof setInterval> | null = null;

  readonly totalBatches = this.totalBatchesState.asReadonly();
  readonly running = computed(
    () => this.startedAt() !== null && this.stoppedAt() === null,
  );

  /** Lote en curso, 1-based y acotado al total («lote x/y»). */
  readonly currentBatch = computed(() =>
    Math.min(this.doneBatches() + 1, Math.max(1, this.totalBatchesState())),
  );

  readonly elapsedMs = computed(() => {
    const start = this.startedAt();
    if (start === null) return 0;
    return Math.max(0, (this.stoppedAt() ?? this.now()) - start);
  });

  readonly remainingMs = computed<number | null>(() => {
    const start = this.startedAt();
    const last = this.lastBatchAt();
    if (start === null || last === null) return null;
    return estimateRemainingMs({
      startedAt: start,
      lastBatchAt: last,
      now: this.stoppedAt() ?? this.now(),
      batchesDone: this.doneBatches() - this.batchesAtStart(),
      batchesLeft: this.totalBatchesState() - this.doneBatches(),
    });
  });

  readonly elapsedLabel = computed(() => formatDuration(this.elapsedMs()));
  readonly remainingLabel = computed(() => {
    const ms = this.remainingMs();
    if (ms === null) return null;
    return ms < 1_000 ? 'unos segundos' : `~${formatDuration(ms)}`;
  });

  /** Arranca (o reanuda tras un reintento manual) la medición. */
  start(totalBatches: number, doneBatches = 0): void {
    this.clearTick();
    const t = Date.now();
    this.now.set(t);
    this.startedAt.set(t);
    this.stoppedAt.set(null);
    this.lastBatchAt.set(null);
    this.batchesAtStart.set(doneBatches);
    this.doneBatches.set(doneBatches);
    this.totalBatchesState.set(Math.max(0, totalBatches));
    this.tickId = setInterval(() => this.now.set(Date.now()), 1_000);
  }

  /** Registra que ya van `doneBatches` lotes terminados de `totalBatches`. */
  recordBatch(doneBatches: number, totalBatches = this.totalBatchesState()): void {
    if (this.startedAt() === null) return;
    const t = Date.now();
    this.now.set(t);
    this.lastBatchAt.set(t);
    this.doneBatches.set(doneBatches);
    this.totalBatchesState.set(Math.max(0, totalBatches));
  }

  /** Congela el cronómetro (fin, fallo o cierre). */
  stop(): void {
    this.clearTick();
    if (this.startedAt() !== null && this.stoppedAt() === null) {
      this.stoppedAt.set(Date.now());
    }
  }

  /** Vuelve a cero (nueva carga). */
  reset(): void {
    this.clearTick();
    this.startedAt.set(null);
    this.stoppedAt.set(null);
    this.lastBatchAt.set(null);
    this.batchesAtStart.set(0);
    this.doneBatches.set(0);
    this.totalBatchesState.set(0);
  }

  dispose(): void {
    this.clearTick();
  }

  private clearTick(): void {
    if (this.tickId !== null) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
  }
}

/**
 * Tiempo restante con el ritmo medido: (tiempo hasta el último lote / lotes
 * hechos) × lotes que faltan, menos lo que ya corrió desde el último lote.
 * `null` mientras no hay ningún lote medido; nunca negativo.
 */
export function estimateRemainingMs(params: {
  startedAt: number;
  lastBatchAt: number;
  now: number;
  batchesDone: number;
  batchesLeft: number;
}): number | null {
  if (params.batchesLeft <= 0) return 0;
  if (params.batchesDone <= 0) return null;
  const perBatch = (params.lastBatchAt - params.startedAt) / params.batchesDone;
  const sinceLast = Math.max(0, params.now - params.lastBatchAt);
  return Math.max(0, Math.round(perBatch * params.batchesLeft - sinceLast));
}

/** «8 s», «1 min 05 s», «1 h 02 min». */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}
