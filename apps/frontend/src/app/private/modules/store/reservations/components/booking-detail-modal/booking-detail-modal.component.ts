import {Component, input, output, signal, computed, inject, effect, DestroyRef} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ModalComponent, IconComponent, SpinnerComponent, TooltipComponent } from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { DataCollectionSubmissionsService } from '../../../data-collection/services/data-collection-submissions.service';
import { Booking, BookingStatus, AvailabilitySlot, ProviderDateInfo, ServiceProvider } from '../../interfaces/reservation.interface';
import { finalize } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';

@Component({
  selector: 'app-booking-detail-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, IconComponent, SpinnerComponent, TooltipComponent,
    CurrencyPipe,
    DatePipe,
    NgClass,
  ],
  templateUrl: './booking-detail-modal.component.html',
  styleUrls: ['./booking-detail-modal.component.scss'],
})
export class BookingDetailModalComponent {
  private destroyRef = inject(DestroyRef);
  private reservationsService = inject(ReservationsService);
  private submissionsService = inject(DataCollectionSubmissionsService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private http = inject(HttpClient);

  readonly isOpen = input<boolean>(false);
  readonly booking = input<Booking | null>(null);

  readonly closed = output<void>();
  readonly confirmed = output<Booking>();
  readonly cancelled = output<Booking>();
  readonly completed = output<Booking>();
  readonly noShow = output<Booking>();
  readonly started = output<Booking>();
  readonly rescheduled = output<void>();
  readonly notesUpdated = output<void>();
  readonly checkedIn = output<Booking>();

  // Image fallback tracking
  imageErrors = signal<Record<number, boolean>>({});

  // Data collection & prediagnosis
  submission = signal<any>(null);
  showIntakeData = signal(false);
  prediagnosisHtml = signal('');

  // Edit mode — single toggle for notes
  editing = signal(false);
  notesValue = signal('');
  internalNotesValue = signal('');
  savingNotes = signal(false);

  // Inline reschedule state
  rescheduling = signal(false);
  dates = signal<ProviderDateInfo[]>([]);
  selectedDate = signal('');
  slots = signal<AvailabilitySlot[]>([]);
  selectedSlot = signal<AvailabilitySlot | null>(null);
  loadingDates = signal(false);
  loadingSlots = signal(false);
  submittingReschedule = signal(false);
  // QUI-972: the professional the reschedule targets (may differ from
  // the booking's when the current one has no schedule).
  rescheduleProviderId = signal<number | null>(null);
  serviceProviders = signal<ServiceProvider[]>([]);
  providersLoading = signal(false);
  // null = unknown (not loaded yet / free-booking skips provider dates).
  providerHasSchedule = signal<boolean | null>(null);

  isFreeBooking = computed(
    () => this.booking()?.product?.booking_mode === 'free_booking',
  );

  rescheduleProviderName = computed(() => {
    const id = this.rescheduleProviderId();
    if (id == null) return '';
    const fromList = this.serviceProviders().find((p) => p.id === id);
    if (fromList) return fromList.display_name || fromList.employee?.first_name || '';
    const b = this.booking();
    if (b?.provider_id === id) {
      return b.provider?.display_name || b.provider?.employee?.first_name || '';
    }
    return '';
  });

  statusLabel = computed(() => {
    const status = this.booking()?.status;
    const map: Record<BookingStatus, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      arriving: 'En sala',
      attending: 'Atendiendo',
      in_progress: 'En progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No show',
    };
    return status ? map[status] ?? status : '';
  });

  statusColor = computed(() => {
    const status = this.booking()?.status;
    const map: Record<BookingStatus, string> = {
      pending: 'status-pending',
      confirmed: 'status-confirmed',
      arriving: 'status-arriving',
      attending: 'status-attending',
      in_progress: 'status-in-progress',
      completed: 'status-completed',
      cancelled: 'status-cancelled',
      no_show: 'status-no-show',
    };
    return status ? map[status] ?? '' : '';
  });

  statusAccent = computed(() => {
    const status = this.booking()?.status;
    const map: Record<BookingStatus, string> = {
      pending: 'var(--color-warning)',
      confirmed: 'var(--color-info)',
      arriving: 'var(--color-success)',
      attending: 'var(--color-primary)',
      in_progress: 'var(--color-primary)',
      completed: 'var(--color-success)',
      cancelled: 'var(--color-error)',
      no_show: 'var(--color-neutral)',
    };
    return status ? map[status] ?? 'var(--color-primary)' : 'var(--color-primary)';
  });

  channelLabel = computed(() => {
    const channel = this.booking()?.channel;
    const map: Record<string, string> = {
      pos: 'Punto de venta',
      ecommerce: 'E-commerce',
      whatsapp: 'WhatsApp',
      agent: 'Agente AI',
      marketplace: 'Marketplace',
    };
    return channel ? map[channel] ?? channel : '';
  });

  channelIcon = computed(() => {
    const channel = this.booking()?.channel;
    const map: Record<string, string> = {
      pos: 'monitor',
      ecommerce: 'globe',
      whatsapp: 'message-circle',
      agent: 'bot',
      marketplace: 'store',
    };
    return channel ? map[channel] ?? 'globe' : 'globe';
  });

  isTerminal = computed(() => {
    const status = this.booking()?.status;
    return status === 'completed' || status === 'cancelled' || status === 'no_show';
  });

  /**
   * Check-in button is enabled for `confirmed` (will transition to arriving)
   * and for `arriving` (idempotent re-mark by staff).
   */
  canCheckIn = computed(() => {
    const status = this.booking()?.status;
    return status === 'confirmed' || status === 'arriving';
  });

  /**
   * Manual "mark attending" button for staff once the customer is on
   * site. Distinct from check-in so the staff can flag "this customer is
   * next" without auto-starting the service.
   */
  canMarkAttending = computed(() => {
    const status = this.booking()?.status;
    return status === 'arriving';
  });

  /// True while a check-in PATCH is in flight (button shows spinner).
  checkingIn = signal(false);
  /// True while a complete PATCH is in flight.
  completing = signal(false);

  canReschedule = computed(() => {
    const status = this.booking()?.status;
    return status === 'pending' || status === 'confirmed';
  });

  isConsultation = computed(() => {
    return !!this.booking()?.product?.is_consultation;
  });

  showConsultationButton = computed(() => {
    const status = this.booking()?.status;
    return this.isConsultation() && (status === 'confirmed' || status === 'in_progress' || status === 'completed');
  });

  consultationButtonLabel = computed(() => {
    const status = this.booking()?.status;
    if (status === 'in_progress') return 'Atender Consulta';
    if (status === 'completed') return 'Ver Consulta';
    return 'Iniciar Consulta';
  });

  private bookingEffect = effect(() => {
    const b = this.booking();
    if (b?.id) {
      this.loadSubmission(b.id);
    } else {
      this.submission.set(null);
      this.prediagnosisHtml.set('');
    }
  });

  onOpen(): void {
    const b = this.booking();
    this.editing.set(false);
    this.notesValue.set(b?.notes || '');
    this.internalNotesValue.set(b?.internal_notes || '');
    this.savingNotes.set(false);
    this.rescheduling.set(false);
    this.selectedDate.set('');
    this.selectedSlot.set(null);
    this.slots.set([]);
    this.submittingReschedule.set(false);
  }

  toggleEdit(): void {
    if (this.editing()) {
      const b = this.booking();
      this.notesValue.set(b?.notes || '');
      this.internalNotesValue.set(b?.internal_notes || '');
      this.editing.set(false);
    } else {
      this.editing.set(true);
    }
  }

  saveNotes(): void {
    const b = this.booking();
    if (!b) return;

    this.savingNotes.set(true);
    this.reservationsService.updateNotes(b.id, {
      notes: this.notesValue(),
      internal_notes: this.internalNotesValue(),
    })
      .pipe(finalize(() => this.savingNotes.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.editing.set(false);
          this.notesUpdated.emit();
          this.toastService.success('Notas actualizadas');
        },
        error: () => {
          this.toastService.error('Error al guardar las notas');
        },
      });
  }

  // --- Inline Reschedule ---

  startReschedule(): void {
    const b = this.booking();
    this.rescheduling.set(true);
    this.rescheduleProviderId.set(b?.provider_id ?? null);
    this.providerHasSchedule.set(null);
    this.serviceProviders.set([]);
    this.loadServiceProviders();
    if (this.isFreeBooking()) {
      // QUI-972: free-booking services follow store hours, not any
      // professional — skip the provider path entirely (the backend
      // answers [] when a provider filter meets free-booking).
      this.generateFallbackDates();
      return;
    }
    this.loadProviderDates();
  }

  cancelReschedule(): void {
    this.rescheduling.set(false);
    this.selectedDate.set('');
    this.selectedSlot.set(null);
    this.slots.set([]);
    this.rescheduleProviderId.set(null);
    this.providerHasSchedule.set(null);
  }

  private loadServiceProviders(): void {
    const b = this.booking();
    if (!b?.product_id) return;
    this.providersLoading.set(true);
    this.reservationsService
      .getProvidersForService(b.product_id)
      .pipe(finalize(() => this.providersLoading.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (providers) => this.serviceProviders.set(providers ?? []),
        error: () => this.serviceProviders.set([]),
      });
  }

  selectRescheduleProvider(providerId: number): void {
    if (this.rescheduleProviderId() === providerId) return;
    this.rescheduleProviderId.set(providerId);
    this.selectedDate.set('');
    this.selectedSlot.set(null);
    this.slots.set([]);
    this.dates.set([]);
    this.loadProviderDates();
  }

  private loadProviderDates(): void {
    const providerId = this.rescheduleProviderId();
    const b = this.booking();
    if (!providerId) {
      this.generateFallbackDates();
      return;
    }

    this.loadingDates.set(true);
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 30);
    const dateFrom = this.formatDateISO(today);
    const dateTo = this.formatDateISO(endDate);

    this.reservationsService
      .getProviderDates(providerId, dateFrom, dateTo, b?.product_id)
      .pipe(finalize(() => this.loadingDates.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (providerDates) => {
          const list = providerDates ?? [];
          this.providerHasSchedule.set(list.some((d) => d.has_schedule));
          const availableDates = list.filter((d) => d.has_schedule);
          this.dates.set(availableDates);
          if (availableDates.length > 0) {
            this.selectDate(availableDates[0].date);
          }
        },
        error: () => this.generateFallbackDates(),
      });
  }

  private generateFallbackDates(): void {
    const dates: ProviderDateInfo[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push({
        date: this.formatDateISO(d),
        day_of_week: d.getDay(),
        has_schedule: true,
        booking_count: 0,
        bookings: [],
      });
    }
    this.dates.set(dates);
    if (dates.length > 0) {
      this.selectDate(dates[0].date);
    }
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.selectedSlot.set(null);
    this.loadSlots(date);
  }

  private loadSlots(date: string): void {
    const b = this.booking();
    if (!b) return;

    this.loadingSlots.set(true);
    // QUI-972: free-booking uses store hours (no provider filter); other
    // modes use the targeted professional (possibly just switched).
    const providerId = this.isFreeBooking()
      ? undefined
      : (this.rescheduleProviderId() ?? undefined);
    this.reservationsService.getAvailability(b.product_id, date, date, providerId)
      .pipe(finalize(() => this.loadingSlots.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (slots) => this.slots.set(slots.filter(s => s.total_available > 0)),
        error: () => this.slots.set([]),
      });
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
  }

  getSelectedDateBookings(): Array<{
    id: number;
    start_time: string;
    end_time: string;
    status: string;
    customer_name: string;
    service_name: string;
  }> {
    const selected = this.selectedDate();
    const dateInfo = this.dates().find((d) => d.date === selected);
    return dateInfo?.bookings || [];
  }

  submitReschedule(): void {
    const slot = this.selectedSlot();
    const b = this.booking();
    if (!slot || !b) return;

    this.submittingReschedule.set(true);
    const targetProviderId = this.isFreeBooking() ? undefined : (this.rescheduleProviderId() ?? undefined);
    this.reservationsService.rescheduleReservation(b.id, {
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      // QUI-972: only send when the professional actually changed.
      ...(targetProviderId != null && targetProviderId !== b.provider_id
        ? { provider_id: targetProviderId }
        : {}),
    })
      .pipe(finalize(() => this.submittingReschedule.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.toastService.success('Reserva reagendada exitosamente');
          this.rescheduling.set(false);
          this.rescheduled.emit();
        },
        error: () => {
          this.toastService.error('Error al reagendar. El horario no está disponible.');
        },
      });
  }

  // --- Consultation Navigation ---

  goToConsultation(): void {
    const b = this.booking();
    if (!b) return;
    this.closed.emit();
    this.router.navigate(['/admin/consultations', b.id, 'attend']);
  }

  // --- Check-in / Mark attending (appointment redesign) ---

  /**
   * POST PATCH /:id/check-in (server marks `arrival_at`, transitions to
   * `arriving`, and broadcasts `booking.arrival_recorded` so the smart
   * queue refreshes + notifies the next-in-line customer).
   */
  checkIn(): void {
    const b = this.booking();
    if (!b || this.checkingIn()) return;
    this.checkingIn.set(true);
    this.reservationsService.checkInReservation(b.id)
      .pipe(finalize(() => this.checkingIn.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.checkedIn.emit(updated);
          this.toastService.success('Check-in registrado. Cliente en cola.');
        },
        error: () => {
          this.toastService.error('No se pudo registrar el check-in');
        },
      });
  }

  /**
   * PATCH /:id/mark-attending. The staff is calling this customer to the
   * chair; the queue listener fires `appointment_queued` to the customer.
   */
  markAttending(): void {
    const b = this.booking();
    if (!b || this.checkingIn()) return;
    this.checkingIn.set(true);
    this.reservationsService.markAttending(b.id)
      .pipe(finalize(() => this.checkingIn.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.checkedIn.emit(updated);
          this.toastService.success('Cliente llamado a la silla');
        },
        error: () => {
          this.toastService.error('No se pudo marcar como atendiendo');
        },
      });
  }

  /** Start the booking service from the detail modal. */
  startBooking(): void {
    const b = this.booking();
    if (!b) return;
    if (b.product?.requires_station) {
      this.checkingIn.set(true);
      this.http.post<any>(`${environment.apiUrl}/store/service-sessions`, { booking_id: b.id })
        .pipe(finalize(() => this.checkingIn.set(false)), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => {
            const token = response?.data?.access_token;
            const url = response?.data?.access_url || (token ? `${window.location.origin}/seguimiento-servicio/${encodeURIComponent(token)}` : '');
            if (response?.data?.email_delivery_status === 'sent') this.toastService.success('Enlace de seguimiento enviado al correo del cliente.');
            else if (response?.data?.email_delivery_status === 'failed') this.toastService.error('No se pudo enviar el correo; copia el enlace temporal para compartirlo.');
            if (url && navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(url).then(
                () => this.toastService.success('Atención iniciada. Enlace de seguimiento copiado.'),
                () => window.prompt('Atención iniciada. Copia el enlace temporal para compartirlo con el cliente:', url),
              );
            } else if (url) {
              window.prompt('Atención iniciada. Copia el enlace temporal para compartirlo con el cliente:', url);
            }
            this.started.emit(b);
          },
          error: (error) => this.toastService.error(error?.error?.message || 'No se pudo iniciar la atención. Verifica que la reserva tenga estación asignada.'),
        });
      return;
    }
    this.checkingIn.set(true);
    this.reservationsService.startReservation(b.id)
      .pipe(finalize(() => this.checkingIn.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.started.emit(updated);
        },
        error: () => {
          this.toastService.error('Error al iniciar el servicio');
        },
      });
  }

  /** Complete the booking service from the detail modal. */
  completeBooking(): void {
    const b = this.booking();
    if (!b) return;
    this.completing.set(true);
    this.reservationsService.completeReservation(b.id)
      .pipe(finalize(() => this.completing.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.completed.emit(updated);
        },
        error: () => {
          this.toastService.error('Error al completar el servicio');
        },
      });
  }

  // --- Data Collection ---

  private loadSubmission(bookingId: number) {
    this.submissionsService.getByBooking(bookingId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.submission.set(data);
        if (data?.ai_prediagnosis) {
          this.prediagnosisHtml.set(data.ai_prediagnosis);
        }
      },
      error: () => this.submission.set(null),
    });
  }

  copyIntakeLink() {
    const token = this.submission()?.token;
    if (token) {
      const url = `${window.location.origin}/preconsulta/${token}`;
      navigator.clipboard.writeText(url);
    }
  }

  // --- Image fallback ---

  onImageError(productId: number): void {
    this.imageErrors.update(errors => ({ ...errors, [productId]: true }));
  }

  // --- Formatters ---

  formatDate(date: string): string {
    const d = this.parseDate(date);
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  formatDateShort(date: string): string {
    const d = this.parseDate(date);
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return `${days[d.getDay()]} ${d.getDate()}`;
  }

  private parseDate(date: string): Date {
    // Handle both "2026-03-28" and "2026-03-28T00:00:00.000Z" formats
    const dateStr = date.includes('T') ? date.split('T')[0] : date;
    return new Date(dateStr + 'T12:00:00');
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  getDurationMinutes(): number {
    const b = this.booking();
    if (!b) return 0;
    const [sh, sm] = b.start_time.split(':').map(Number);
    const [eh, em] = b.end_time.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }

  private formatDateISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
