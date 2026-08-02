import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import {
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  PaginationComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency';
import {
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalTransmission,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import {
  FILTER_ENVIRONMENT_OPTIONS,
  TRANSMISSION_STATUS_OPTIONS,
  asNumber,
  environmentLabel,
  optionalNumericIdValidator,
  parseRequiredId,
  skippedReasonLabel,
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';

/**
 * Pestaña «Facturas»: emisión manual y registro de transmisiones DIAN de las
 * facturas de suscripción SaaS.
 */
@Component({
  selector: 'app-platform-invoices',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    CurrencyPipe,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    PaginationComponent,
    SelectorComponent,
  ],
  templateUrl: './platform-invoices.component.html',
})
export class PlatformInvoicesComponent {
  private readonly fb = inject(FormBuilder);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(PlatformInvoicingStore);

  readonly transmissions = signal<SubscriptionFiscalTransmission[]>([]);
  readonly loadingTransmissions = signal(false);
  readonly issuingInvoice = signal(false);
  readonly retryingTransmissionId = signal<number | null>(null);
  readonly search = signal('');
  readonly pagination = signal({ page: 1, limit: 20, total: 0, totalPages: 0 });

  readonly manualInvoiceIdControl = this.fb.control<string | null>(null, [
    optionalNumericIdValidator,
  ]);
  readonly statusFilterControl = this.fb.control<string | null>('');
  readonly environmentFilterControl = this.fb.control<string | null>('');

  readonly statusOptions = TRANSMISSION_STATUS_OPTIONS;
  readonly filterEnvironmentOptions = FILTER_ENVIRONMENT_OPTIONS;
  readonly environmentLabel = environmentLabel;
  readonly statusLabel = transmissionStatusLabel;
  readonly statusBadgeClasses = transmissionStatusBadgeClasses;
  readonly asNumber = asNumber;

  constructor() {
    this.store.loadStatus();
    this.loadTransmissions();

    this.statusFilterControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pagination.update((p) => ({ ...p, page: 1 }));
        this.loadTransmissions();
      });

    this.environmentFilterControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pagination.update((p) => ({ ...p, page: 1 }));
        this.loadTransmissions();
      });
  }

  loadTransmissions(): void {
    this.loadingTransmissions.set(true);
    const pagination = this.pagination();
    const status = this.statusFilterControl.value || undefined;
    const environment =
      (this.environmentFilterControl.value as
        | SubscriptionFiscalEnvironment
        | '') || undefined;

    this.fiscal
      .listTransmissions({
        page: pagination.page,
        limit: pagination.limit,
        status,
        environment,
        search: this.search(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.transmissions.set(res.data ?? []);
          this.pagination.update((p) => ({
            ...p,
            total: res.meta.total,
            totalPages: res.meta.totalPages,
          }));
          this.loadingTransmissions.set(false);
        },
        error: () => {
          this.toast.error('No se pudo cargar el registro fiscal', 'Error');
          this.loadingTransmissions.set(false);
        },
      });
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransmissions();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadTransmissions();
  }

  onIssueManualInvoice(): void {
    const invoiceId = parseRequiredId(this.manualInvoiceIdControl.value);
    if (!invoiceId || this.issuingInvoice()) {
      this.manualInvoiceIdControl.markAsTouched();
      return;
    }

    this.issuingInvoice.set(true);
    this.fiscal
      .issueInvoice(invoiceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.issuingInvoice.set(false);
          if ('skipped' in result && result.skipped) {
            this.toast.warning(skippedReasonLabel(result.reason), 'No emitida');
          } else {
            this.toast.success('Solicitud de emisión registrada', 'Facturación');
          }
          this.manualInvoiceIdControl.reset(null, { emitEvent: false });
          this.loadTransmissions();
          this.store.loadStatus(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.issuingInvoice.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo emitir la factura',
            'Error',
          );
        },
      });
  }

  onRetry(row: SubscriptionFiscalTransmission): void {
    if (row.transmission_status === 'accepted' || this.retryingTransmissionId()) {
      return;
    }
    this.retryingTransmissionId.set(row.id);
    this.fiscal
      .retryTransmission(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.retryingTransmissionId.set(null);
          this.toast.success('Reintento registrado', 'Facturación');
          this.loadTransmissions();
          this.store.loadStatus(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.retryingTransmissionId.set(null);
          this.toast.error(
            err?.error?.message ?? 'No se pudo reintentar la transmisión',
            'Error',
          );
        },
      });
  }

  canRetry(row: SubscriptionFiscalTransmission): boolean {
    return row.transmission_status !== 'accepted';
  }
}
