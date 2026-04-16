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

import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, finalize } from 'rxjs';
import { ReservationsService } from '../../../services/reservations.service';
import { ProviderException } from '../../../interfaces/reservation.interface';
import {
  IconComponent,
  SpinnerComponent,
  ToastService,
  DialogService,
  ButtonComponent,
  InputComponent,
  ToggleComponent,
  BadgeComponent,
  EmptyStateComponent,
} from '../../../../../../../shared/components';

@Component({
  selector: 'app-exceptions-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, SpinnerComponent, ButtonComponent, InputComponent, ToggleComponent, BadgeComponent, EmptyStateComponent],
  templateUrl: './exceptions-manager.component.html',
  styleUrls: ['./exceptions-manager.component.scss'],
})
export class ExceptionsManagerComponent implements OnDestroy {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroy$ = new Subject<void>();

  readonly providerId = input.required<number>();

  exceptions = signal<ProviderException[]>([]);
  loading = signal(false);
  saving = signal(false);
  showForm = signal(false);

  // Form fields
  formDate = signal('');
  formIsUnavailable = signal(true);
  formStartTime = signal('08:00');
  formEndTime = signal('18:00');
  formReason = signal('');

  constructor() {
    effect(() => {
      const id = this.providerId();
      if (id) {
        untracked(() => this.loadExceptions(id));
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadExceptions(providerId: number): void {
    this.loading.set(true);
    this.reservationsService
      .getProviderExceptions(providerId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (exceptions) => this.exceptions.set(exceptions),
        error: () => this.toastService.error('Error al cargar excepciones'),
      });
  }

  private resetForm(): void {
    this.formDate.set('');
    this.formIsUnavailable.set(true);
    this.formStartTime.set('08:00');
    this.formEndTime.set('18:00');
    this.formReason.set('');
  }

  createException(): void {
    const date = this.formDate();
    if (!date) {
      this.toastService.error('Debes seleccionar una fecha');
      return;
    }

    this.saving.set(true);

    const dto: any = {
      date,
      is_unavailable: this.formIsUnavailable(),
      reason: this.formReason() || undefined,
    };

    if (!this.formIsUnavailable()) {
      dto.custom_start_time = this.formStartTime();
      dto.custom_end_time = this.formEndTime();
    }

    this.reservationsService
      .createProviderException(this.providerId(), dto)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success('Excepcion creada exitosamente');
          this.showForm.set(false);
          this.resetForm();
          this.loadExceptions(this.providerId());
        },
        error: () => this.toastService.error('Error al crear la excepcion'),
      });
  }

  deleteException(exceptionId: number): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Excepcion',
        message: '¿Estas seguro de que deseas eliminar esta excepcion?',
        confirmVariant: 'danger',
        confirmText: 'Eliminar',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.reservationsService
            .deleteProviderException(this.providerId(), exceptionId)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toastService.success('Excepcion eliminada');
                this.loadExceptions(this.providerId());
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
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
}
