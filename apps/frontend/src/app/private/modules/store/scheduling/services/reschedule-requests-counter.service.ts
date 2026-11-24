import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { ReservationsService } from '../../reservations/services/reservations.service';

/** Cada cuánto se refresca el conteo (mismo intervalo que la pantalla vieja de Reservas). */
const POLL_MS = 30_000;

/**
 * Solicitudes de reagenda pendientes para el botón con contador de la Agenda
 * (lo que mostraba la cabecera de la pantalla vieja de Reservas). Un solo
 * sondeo compartido mientras alguna pestaña lo use.
 */
@Injectable({ providedIn: 'root' })
export class RescheduleRequestsCounterService {
  private readonly reservations = inject(ReservationsService);
  readonly count = signal(0);
  private watchers = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Empieza a contar mientras `destroyRef` viva. */
  watch(destroyRef: DestroyRef): void {
    this.watchers += 1;
    if (this.watchers === 1) {
      this.refresh();
      this.timer = setInterval(() => this.refresh(), POLL_MS);
    }
    destroyRef.onDestroy(() => {
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    });
  }

  refresh(): void {
    this.reservations.listRescheduleRequests('pending').subscribe({
      next: (rows) => this.count.set(rows?.length ?? 0),
      // Silencioso: la pantalla de solicitudes muestra los errores reales.
      error: () => undefined,
    });
  }
}
