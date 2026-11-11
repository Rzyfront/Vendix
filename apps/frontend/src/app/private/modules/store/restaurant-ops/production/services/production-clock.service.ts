import { Injectable, signal } from '@angular/core';

/**
 * S25 (release #1134): reloj de los cronómetros de producción.
 *
 * El cronómetro se calcula con `started_at` (hora del servidor) contra la hora
 * del equipo; con un reloj desfasado marcaba otro tiempo en cada equipo. Aquí
 * se guarda el desfase `Date.parse(server_now) - Date.now()` al recibir la
 * respuesta del día, y todos los cronómetros leen `now()`.
 * Sin `server_now` el desfase es 0.
 */
@Injectable({ providedIn: 'root' })
export class ProductionClockService {
  private readonly offset = signal(0);
  /** Milisegundos que el servidor va por delante del equipo (negativo: atrás). */
  readonly offsetMs = this.offset.asReadonly();

  /** Registra el desfase con la hora del servidor de una respuesta recién recibida. */
  sync(serverNow: string | null | undefined, localNowMs: number = Date.now()): void {
    const serverMs = serverNow ? Date.parse(serverNow) : Number.NaN;
    this.offset.set(Number.isFinite(serverMs) ? serverMs - localNowMs : 0);
  }

  /** Hora corregida, en ms desde epoch. */
  now(): number {
    return Date.now() + this.offset();
  }
}
