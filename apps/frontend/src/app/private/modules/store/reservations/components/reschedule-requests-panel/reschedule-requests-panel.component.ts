import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReservationsService } from '../../services/reservations.service';
import { RescheduleRequest } from '../../interfaces/reservation.interface';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

interface RejectModalState {
  open: boolean;
  request: RescheduleRequest | null;
  reason: string;
  submitting: boolean;
}

/**
 * RescheduleRequestsPanel
 *
 * Panel standalone que muestra la cola de solicitudes de reagendamiento
 * pendientes cuando `settings.reservations.allow_direct_reschedule = false`.
 *
 * - Lista cada request con info del booking original + slot solicitado.
 * - Botones "Aprobar" (1 click) y "Rechazar" (abre modal de razón).
 * - Refetch cada 30s + botón "Actualizar".
 * - Auto-hide cuando la cola está vacía (mostramos un empty state amable).
 *
 * El padre (`ReservationsComponent`) decide dónde renderizarlo.
 */
@Component({
  selector: 'app-reschedule-requests-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IconComponent],
  providers: [DatePipe],
  templateUrl: './reschedule-requests-panel.component.html',
  styleUrls: ['./reschedule-requests-panel.component.scss'],
})
export class RescheduleRequestsPanelComponent implements OnInit {
  private readonly reservationsService = inject(ReservationsService);
  private readonly toast_service = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly requests = signal<RescheduleRequest[]>([]);
  readonly loading = signal(false);
  readonly processing = signal<number | null>(null);

  readonly rejectModal = signal<RejectModalState>({
    open: false,
    request: null,
    reason: '',
    submitting: false,
  });

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.load();
    this.pollHandle = setInterval(() => this.load(), 30_000);
  }

  ngOnDestroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  load() {
    this.loading.set(true);
    this.reservationsService
      .listRescheduleRequests('pending')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.requests.set(rows ?? []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast_service.error('No se pudieron cargar las solicitudes');
        },
      });
  }

  approve(req: RescheduleRequest) {
    this.processing.set(req.id);
    this.reservationsService
      .approveRescheduleRequest(req.id, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.success(`Solicitud de ${req.booking.customer.first_name} aprobada`);
          this.processing.set(null);
          this.load();
        },
        error: (err) => {
          this.processing.set(null);
          const msg = err?.error?.message ?? 'No se pudo aprobar la solicitud';
          this.toast_service.error(msg);
        },
      });
  }

  openRejectModal(req: RescheduleRequest) {
    this.rejectModal.set({ open: true, request: req, reason: '', submitting: false });
  }

  closeRejectModal() {
    this.rejectModal.set({ ...this.rejectModal(), open: false, request: null, reason: '' });
  }

  /**
   * Update only the `reason` field of the reject-modal signal. The
   * template can't use spread on a signal call result (Angular's
   * template parser doesn't support `{ ...signal(), field: x }` in
   * event bindings), so we centralize the update here.
   */
  updateRejectReason(reason: string): void {
    this.rejectModal.set({ ...this.rejectModal(), reason });
  }

  submitReject() {
    const state = this.rejectModal();
    const req = state.request;
    if (!req) return;
    if (state.reason.trim().length < 3) {
      this.toast_service.error('La razón debe tener al menos 3 caracteres');
      return;
    }
    this.rejectModal.set({ ...state, submitting: true });
    this.reservationsService
      .rejectRescheduleRequest(req.id, { decision_reason: state.reason.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.success(`Solicitud rechazada`);
          this.closeRejectModal();
          this.load();
        },
        error: (err) => {
          this.rejectModal.set({ ...this.rejectModal(), submitting: false });
          const msg = err?.error?.message ?? 'No se pudo rechazar la solicitud';
          this.toast_service.error(msg);
        },
      });
  }

  /** Formato corto del slot solicitado, p.ej. "Mié 29/07 · 09:00–09:30". */
  formatRequestedSlot(req: RescheduleRequest): string {
    const date = this.formatDateShort(req.requested_date);
    return `${date} · ${req.requested_start_time}–${req.requested_end_time}`;
  }

  /** Formato corto del slot original (el que el cliente quiere dejar). */
  formatOriginalSlot(req: RescheduleRequest): string {
    const date = this.formatDateShort(req.booking.date);
    return `${date} · ${req.booking.start_time}–${req.booking.end_time}`;
  }

  private formatDateShort(isoDate: string): string {
    try {
      const [y, m, d] = isoDate.split('T')[0].split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('es-ES', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      });
    } catch {
      return isoDate;
    }
  }

  fullName(req: RescheduleRequest): string {
    const c = req.booking.customer;
    return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Cliente';
  }
}