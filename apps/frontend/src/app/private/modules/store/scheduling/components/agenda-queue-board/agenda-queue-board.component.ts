import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent, SpinnerComponent } from '../../../../../../shared/components';
import { ReservationsService } from '../../../reservations/services/reservations.service';
import { QueueBoard, QueueBoardRow } from '../../../reservations/interfaces/reservation.interface';

/**
 * Pestaña Cola de Agenda (agenda-unificada, Rafael 2026-11-24).
 *
 * Tres bloques, en el orden en que la recepción los necesita:
 * - En atención: quien ya está siendo atendido.
 * - En sala: quien hizo check-in y espera; el orden es el de la cola viva
 *   (cercanía a su hora reservada, con la prioridad manual como desempate).
 * - Próximos: la programación confirmada que todavía no empieza, por hora.
 *
 * El bloque superior es el "siguiente" y tiene un modo pantalla completa
 * pensado para un monitor a la vista del público: solo nombres, sin acciones
 * internas.
 *
 * El tablero es de solo lectura; "Llamar" es la única acción y reusa
 * `mark-attending` (el mismo endpoint de la cola anterior).
 */
@Component({
  selector: 'app-agenda-queue-board',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './agenda-queue-board.component.html',
  styleUrls: ['./agenda-queue-board.component.scss'],
})
export class AgendaQueueBoardComponent implements OnInit, OnDestroy {
  private readonly reservations = inject(ReservationsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly board = signal<QueueBoard | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly callingId = signal<number | null>(null);
  readonly isFullscreen = signal(false);
  readonly now = signal(Date.now());

  /** Se necesita un nodo real para entrar en pantalla completa. */
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  readonly inService = computed(() => this.board()?.in_service ?? []);
  readonly waiting = computed(() => this.board()?.waiting ?? []);
  readonly upcoming = computed(() => this.board()?.upcoming ?? []);

  /** Quien la recepción llama a continuación: primero el que ya está en sala. */
  readonly next = computed<QueueBoardRow | null>(
    () => this.waiting()[0] ?? this.upcoming()[0] ?? null,
  );

  /** Nombres que siguen después del "siguiente", para el monitor. */
  readonly following = computed<QueueBoardRow[]>(() =>
    [...this.waiting().slice(1), ...this.upcoming()].slice(0, 5),
  );

  readonly dayLabel = computed(() => {
    const day = this.board()?.day;
    if (!day) return 'Hoy';
    const [y, m, d] = day.split('-').map(Number);
    if (!y || !m || !d) return 'Hoy';
    return this.formatDay(new Date(y, m - 1, d));
  });

  readonly pendingCount = computed(
    () => this.inService().length + this.waiting().length + this.upcoming().length,
  );

  readonly updatedAt = computed(() => {
    const stamp = this.board()?.generated_at;
    if (!stamp) return null;
    return new Date(stamp);
  });

  ngOnInit(): void {
    this.refresh();
    // 30 s: es una lectura barata por tienda y deja el monitor al día sin SSE.
    this.pollHandle = setInterval(() => {
      this.now.set(Date.now());
      this.refresh(false);
    }, 30_000);
  }

  ngOnDestroy(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.exitFullscreen();
  }

  refresh(showSpinner = true): void {
    if (showSpinner) this.loading.set(true);
    this.reservations
      .getQueueBoard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (board) => {
          this.board.set(board);
          this.failed.set(false);
          this.loading.set(false);
          this.now.set(Date.now());
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  /** Llama al siguiente: mismo endpoint de la cola de siempre. */
  call(row: QueueBoardRow): void {
    if (this.callingId() != null) return;
    this.callingId.set(row.booking_id);
    this.reservations
      .markAttending(row.booking_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.callingId.set(null);
          this.refresh(false);
        },
        error: () => this.callingId.set(null),
      });
  }

  toggleFullscreen(): void {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      this.exitFullscreen();
      return;
    }
    const element = this.root()?.nativeElement ?? document.documentElement;
    void element.requestFullscreen?.().catch(() => this.isFullscreen.set(false));
    this.isFullscreen.set(true);
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    if (typeof document === 'undefined') return;
    this.isFullscreen.set(Boolean(document.fullscreenElement));
  }

  private exitFullscreen(): void {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    this.isFullscreen.set(false);
  }

  /** "Hace 5 min" en sala, "En 12 min" o "A las 15:30" para lo que falta. */
  timingLabel(row: QueueBoardRow): string {
    if (row.status === 'attending') return 'En atención';
    if (row.arrival_at) {
      const minutes = Math.max(
        0,
        Math.round((this.now() - new Date(row.arrival_at).getTime()) / 60_000),
      );
      return minutes <= 0 ? 'Llegó ahora' : `Hace ${minutes} min`;
    }
    if (row.minutes_to_start <= -5) return `Atrasado ${Math.abs(row.minutes_to_start)} min`;
    if (row.minutes_to_start <= 0) return 'Debe estar entrando';
    if (row.minutes_to_start < 60) return `En ${row.minutes_to_start} min`;
    return `A las ${row.start_time.slice(0, 5)}`;
  }

  statusLabel(row: QueueBoardRow): string {
    if (row.status === 'attending') return 'En atención';
    if (row.status === 'arriving') return 'En sala';
    return 'Confirmada';
  }

  initials(row: QueueBoardRow): string {
    const parts = row.customer_name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + second).toUpperCase() || '?';
  }

  private formatDay(date: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date);
  }
}
