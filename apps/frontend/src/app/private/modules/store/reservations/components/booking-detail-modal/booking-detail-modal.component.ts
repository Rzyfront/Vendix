import {Component, input, output, signal, computed, inject, effect, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ModalComponent, IconComponent, SpinnerComponent, TooltipComponent } from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { DataCollectionSubmissionsService } from '../../../data-collection/services/data-collection-submissions.service';
import { Booking, BookingStatus, AvailabilitySlot } from '../../interfaces/reservation.interface';
import { finalize } from 'rxjs';

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
  dates = signal<string[]>([]);
  selectedDate = signal('');
  slots = signal<AvailabilitySlot[]>([]);
  selectedSlot = signal<AvailabilitySlot | null>(null);
  loadingSlots = signal(false);
  submittingReschedule = signal(false);

  statusLabel = computed(() => {
    const status = this.booking()?.status;
    const map: Record<BookingStatus, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
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
    this.rescheduling.set(true);
    this.generateDates();
  }

  cancelReschedule(): void {
    this.rescheduling.set(false);
    this.selectedDate.set('');
    this.selectedSlot.set(null);
    this.slots.set([]);
  }

  private generateDates(): void {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }
    this.dates.set(dates);
    if (dates.length > 0) {
      this.selectDate(dates[0]);
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
    this.reservationsService.getAvailability(b.product_id, date, date, b.provider_id)
      .pipe(finalize(() => this.loadingSlots.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (slots) => this.slots.set(slots.filter(s => s.total_available > 0)),
        error: () => this.slots.set([]),
      });
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
  }

  submitReschedule(): void {
    const slot = this.selectedSlot();
    const b = this.booking();
    if (!slot || !b) return;

    this.submittingReschedule.set(true);
    this.reservationsService.rescheduleReservation(b.id, {
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
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
}
