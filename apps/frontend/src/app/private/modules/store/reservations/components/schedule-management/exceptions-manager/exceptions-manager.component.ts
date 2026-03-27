import {
  Component,
  OnDestroy,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, finalize } from 'rxjs';
import { ReservationsService } from '../../../services/reservations.service';
import { ScheduleException } from '../../../interfaces/reservation.interface';
import {
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
  ToastService,
  DialogService,
} from '../../../../../../../shared/components';

@Component({
  selector: 'app-exceptions-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, SpinnerComponent],
  templateUrl: './exceptions-manager.component.html',
  styleUrls: ['./exceptions-manager.component.scss'],
})
export class ExceptionsManagerComponent implements OnDestroy {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroy$ = new Subject<void>();

  readonly productId = input.required<number>();

  exceptions = signal<ScheduleException[]>([]);
  loading = signal(false);
  saving = signal(false);
  showForm = signal(false);

  // Form fields
  formDate = signal('');
  formIsClosed = signal(true);
  formStartTime = signal('08:00');
  formEndTime = signal('18:00');
  formReason = signal('');

  constructor() {
    effect(() => {
      const id = this.productId();
      if (id) {
        untracked(() => this.loadExceptions(id));
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadExceptions(productId: number): void {
    this.loading.set(true);
    this.reservationsService
      .getExceptions(productId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (exceptions) => this.exceptions.set(exceptions),
        error: () => this.toastService.error('Error al cargar excepciones'),
      });
  }

  toggleForm(): void {
    this.showForm.update((v) => !v);
    if (this.showForm()) {
      this.resetForm();
    }
  }

  private resetForm(): void {
    this.formDate.set('');
    this.formIsClosed.set(true);
    this.formStartTime.set('08:00');
    this.formEndTime.set('18:00');
    this.formReason.set('');
  }

  saveException(): void {
    const date = this.formDate();
    if (!date) {
      this.toastService.error('Debes seleccionar una fecha');
      return;
    }

    this.saving.set(true);

    const dto: any = {
      product_id: this.productId(),
      date,
      is_closed: this.formIsClosed(),
      reason: this.formReason() || undefined,
    };

    if (!this.formIsClosed()) {
      dto.custom_start_time = this.formStartTime();
      dto.custom_end_time = this.formEndTime();
    }

    this.reservationsService
      .createException(dto)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success('Excepcion creada exitosamente');
          this.showForm.set(false);
          this.loadExceptions(this.productId());
        },
        error: () => this.toastService.error('Error al crear la excepcion'),
      });
  }

  deleteException(exception: ScheduleException): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Excepcion',
        message: `¿Estas seguro de que deseas eliminar la excepcion del ${this.formatDate(exception.date)}?`,
        confirmVariant: 'danger',
        confirmText: 'Eliminar',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.reservationsService
            .deleteException(exception.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toastService.success('Excepcion eliminada');
                this.loadExceptions(this.productId());
              },
              error: () => this.toastService.error('Error al eliminar la excepcion'),
            });
        }
      });
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('es-CO', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
