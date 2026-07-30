import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ReservationsService,
  RescheduleRequest,
} from '../../services/reservations.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';

interface RejectModalState {
  open: boolean;
  request: RescheduleRequest | null;
  reason: string;
  submitting: boolean;
}

/**
 * RescheduleRequestsPageComponent
 *
 * Dedicated view for the pending-reschedule-requests queue. Reached from
 * `/admin/reservations/reschedule-requests` (click on the header button
 * in the parent module). Same data and actions as the inline panel,
 * but rendered as a full-width page with the standard sticky header
 * + back button — same UX pattern as the
 * `<app-provider-availability>` "Disponibilidad" view.
 */
@Component({
  selector: 'app-reschedule-requests-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    StickyHeaderComponent,
    RouterLink,
  ],
  providers: [DatePipe],
  templateUrl: './reschedule-requests-page.component.html',
  styleUrls: ['./reschedule-requests-page.component.scss'],
})
export class RescheduleRequestsPageComponent implements OnInit {
  private readonly reservationsService = inject(ReservationsService);
  private readonly toast_service = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly requests = signal<RescheduleRequest[]>([]);
  readonly loading = signal(false);
  readonly processing = signal<number | null>(null);

  readonly rejectModal = signal<RejectModalState>({
    open: false,
    request: null,
    reason: '',
    submitting: false,
  });

  /** Header badge mirrors the pending count for the sticky header. */
  readonly badgeText = computed(() => {
    const n = this.requests().length;
    if (n === 0) return 'Sincronizado';
    return `${n} pendiente${n === 1 ? '' : 's'}`;
  });
  readonly badgeColor = computed<StickyHeaderBadgeColor>(() =>
    this.requests().length > 0 ? 'yellow' : 'green',
  );

  /** Header action — single back button (mirrors provider-availability). */
  readonly headerActions: StickyHeaderActionButton[] = [
    {
      id: 'back',
      label: 'Reservas',
      variant: 'outline',
      icon: 'arrow-left',
    },
  ];

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.load();
    // 30s polling — same cadence as the inline panel so the page stays
    // in sync with new requests filed by customers.
    this.pollHandle = setInterval(() => this.load(), 30_000);
  }

  ngOnDestroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  /** Sticky header action router — back to the reservations module. */
  onHeaderAction(id: string): void {
    if (id === 'back') this.goBack();
  }

  goBack(): void {
    this.router.navigate(['/admin/reservations']);
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
          this.toast_service.success(
            `Solicitud de ${req.booking.customer.first_name} aprobada`,
          );
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
    this.rejectModal.set({
      ...this.rejectModal(),
      open: false,
      request: null,
      reason: '',
    });
  }

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
          this.toast_service.success('Solicitud rechazada');
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

  formatRequestedSlot(req: RescheduleRequest): string {
    const date = this.formatDateShort(req.requested_date);
    return `${date} · ${req.requested_start_time}–${req.requested_end_time}`;
  }

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