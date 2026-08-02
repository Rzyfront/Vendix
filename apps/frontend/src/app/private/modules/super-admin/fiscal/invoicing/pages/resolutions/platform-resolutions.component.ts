import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../../shared/components';
import {
  CreatePlatformResolutionDto,
  PlatformResolutionDocumentType,
  SubscriptionFiscalEnvironment,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import {
  ENVIRONMENT_OPTIONS,
  RESOLUTION_DOCUMENT_TYPE_OPTIONS,
  rangoFinalGreaterValidator,
  resolutionDocTypeLabel,
} from '../../platform-invoicing.constants';

interface ResolutionFormControls {
  prefix: FormControl<string | null>;
  document_type: FormControl<PlatformResolutionDocumentType>;
  environment: FormControl<SubscriptionFiscalEnvironment>;
  rango_inicial: FormControl<number | null>;
  rango_final: FormControl<number | null>;
  technical_key: FormControl<string | null>;
  resolution_number: FormControl<string | null>;
  resolution_date: FormControl<string | null>;
  valid_from: FormControl<string | null>;
  valid_to: FormControl<string | null>;
}

/**
 * Pestaña «Resoluciones»: rangos de numeración DIAN de la organización
 * plataforma, para factura electrónica y documento soporte.
 */
@Component({
  selector: 'app-platform-resolutions',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
  ],
  templateUrl: './platform-resolutions.component.html',
})
export class PlatformResolutionsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(PlatformInvoicingStore);

  readonly modalOpen = signal(false);
  readonly saving = signal(false);
  readonly formInvalid = signal(true);

  readonly documentTypeOptions = RESOLUTION_DOCUMENT_TYPE_OPTIONS;
  readonly environmentOptions = ENVIRONMENT_OPTIONS;
  readonly docTypeLabel = resolutionDocTypeLabel;

  readonly form: FormGroup<ResolutionFormControls> =
    this.fb.group<ResolutionFormControls>(
      {
        prefix: this.fb.control<string | null>(null, [
          Validators.required,
          Validators.maxLength(4),
        ]),
        document_type:
          this.fb.nonNullable.control<PlatformResolutionDocumentType>(
            'sales_invoice',
            [Validators.required],
          ),
        environment: this.fb.nonNullable.control<SubscriptionFiscalEnvironment>(
          'test',
          [Validators.required],
        ),
        rango_inicial: this.fb.control<number | null>(null, [
          Validators.required,
          Validators.min(1),
        ]),
        rango_final: this.fb.control<number | null>(null, [
          Validators.required,
          Validators.min(2),
        ]),
        technical_key: this.fb.control<string | null>(null),
        resolution_number: this.fb.control<string | null>(null),
        resolution_date: this.fb.control<string | null>(null),
        valid_from: this.fb.control<string | null>(null),
        valid_to: this.fb.control<string | null>(null),
      },
      { validators: rangoFinalGreaterValidator },
    );

  constructor() {
    this.store.loadResolutions();
    this.store.loadStatus();

    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.formInvalid.set(this.form.invalid));
  }

  openModal(): void {
    this.form.reset({
      prefix: null,
      document_type: 'sales_invoice',
      environment: this.store.settings()?.environment ?? 'test',
      rango_inicial: null,
      rango_final: null,
      technical_key: null,
      resolution_number: null,
      resolution_date: null,
      valid_from: null,
      valid_to: null,
    });
    this.formInvalid.set(this.form.invalid);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  onCreate(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const dto: CreatePlatformResolutionDto = {
      prefix: value.prefix!.trim(),
      document_type: value.document_type,
      environment: value.environment,
      rango_inicial: Number(value.rango_inicial),
      rango_final: Number(value.rango_final),
    };
    if (value.technical_key?.trim()) {
      dto.technical_key = value.technical_key.trim();
    }
    if (value.resolution_number?.trim()) {
      dto.resolution_number = value.resolution_number.trim();
    }
    if (value.resolution_date) dto.resolution_date = value.resolution_date;
    if (value.valid_from) dto.valid_from = value.valid_from;
    if (value.valid_to) dto.valid_to = value.valid_to;

    this.saving.set(true);
    this.fiscal
      .createResolution(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.modalOpen.set(false);
          this.toast.success('Resolución DIAN creada', 'Plataforma');
          // Forzado: las otras pestañas ofrecen estas resoluciones en sus
          // selectores y quedarían mostrando la lista vieja.
          this.store.loadResolutions(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo crear la resolución',
            'Error',
          );
        },
      });
  }
}
