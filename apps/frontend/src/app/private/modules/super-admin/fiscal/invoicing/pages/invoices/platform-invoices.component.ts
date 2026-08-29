import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  ModalComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components';
import type { ItemListCardConfig } from '../../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import type {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency';
import {
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalTransmission,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import { PlatformInvoiceDetailModalComponent } from '../../components/platform-invoice-detail-modal/platform-invoice-detail-modal.component';
import {
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
 * facturas de suscripción SaaS con total paridad visual y funcional.
 */
@Component({
  selector: 'app-platform-invoices',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    DatePipe,
    CurrencyPipe,
    CardComponent,
    StatsComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    ModalComponent,
    PlatformInvoiceDetailModalComponent,
  ],
  templateUrl: './platform-invoices.component.html',
})
export class PlatformInvoicesComponent {
  private readonly fb = inject(FormBuilder);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly store = inject(PlatformInvoicingStore);

  readonly transmissions = signal<SubscriptionFiscalTransmission[]>([]);
  readonly loadingTransmissions = signal(false);
  readonly issuingInvoice = signal(false);
  readonly retryingTransmissionId = signal<number | null>(null);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly pagination = signal({ page: 1, limit: 20, total: 0, totalPages: 0 });

  readonly showManualIssueModal = signal(false);
  readonly showDetailModal = signal(false);
  readonly selectedInvoiceId = signal<number | null>(null);

  readonly manualInvoiceIdControl = this.fb.control<string | null>(null, [
    optionalNumericIdValidator,
  ]);

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado DIAN',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'accepted', label: 'Aceptada' },
        { value: 'rejected', label: 'Rechazada' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'processing', label: 'Procesando' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
    {
      key: 'environment',
      label: 'Ambiente',
      type: 'select',
      options: [
        { value: '', label: 'Todos los ambientes' },
        { value: 'production', label: 'Producción' },
        { value: 'test', label: 'Habilitación / Pruebas' },
      ],
    },
    {
      key: 'source_type',
      label: 'Origen',
      type: 'select',
      options: [
        { value: '', label: 'Todos los orígenes' },
        { value: 'subscription_invoice', label: 'SaaS' },
        { value: 'platform_invoice', label: 'Factura Plataforma' },
        { value: 'platform_support_document', label: 'Documento Soporte Plataforma' },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva factura',
      icon: 'plus',
      action: 'new_invoice',
      variant: 'primary',
    },
    {
      label: 'Emisión manual SaaS',
      icon: 'send',
      action: 'manual_issue',
      variant: 'outline',
    },
    {
      label: 'Refrescar',
      icon: 'refresh-cw',
      action: 'refresh',
      variant: 'outline',
    },
  ];

  readonly columns: TableColumn[] = [
    {
      key: 'document_number',
      label: 'Documento',
      sortable: true,
      transform: (val, item: SubscriptionFiscalTransmission) => {
        return item.document_number || `ID ${item.source_id}`;
      },
    },
    {
      key: 'source_type',
      label: 'Origen',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          subscription_invoice: 'info',
          platform_invoice: 'primary',
          platform_support_document: 'secondary',
        },
      },
      transform: (val) => {
        if (val === 'subscription_invoice') return 'SaaS';
        if (val === 'platform_invoice') return 'Plataforma';
        if (val === 'platform_support_document') return 'Doc. Soporte';
        return val || '—';
      },
    },
    {
      key: 'source_id',
      label: 'Ref. Factura',
      transform: (val, item: SubscriptionFiscalTransmission) => {
        return item.subscription_invoice?.invoice_number || `Factura #${val}`;
      },
    },
    {
      key: 'transmission_status',
      label: 'Estado DIAN',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          accepted: 'success',
          rejected: 'error',
          pending: 'warning',
          processing: 'warning',
          cancelled: 'secondary',
        },
      },
      transform: (val) => transmissionStatusLabel(val),
    },
    {
      key: 'environment',
      label: 'Ambiente',
      transform: (val, item: SubscriptionFiscalTransmission) => {
        return environmentLabel(item.dian_configuration?.environment);
      },
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      transform: (val, item: SubscriptionFiscalTransmission) => {
        const total = asNumber(item.subscription_invoice?.total ?? 0);
        return new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: item.subscription_invoice?.currency || 'COP',
          minimumFractionDigits: 0,
        }).format(total);
      },
    },
    {
      key: 'created_at',
      label: 'Fecha',
      transform: (val) => (val ? new Date(val).toLocaleDateString('es-CO') : '—'),
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      action: (item: SubscriptionFiscalTransmission) => this.onRowClick(item),
    },
    {
      label: 'Descargar PDF',
      icon: 'file-text',
      show: (item: SubscriptionFiscalTransmission) => !!item.pdf_url,
      action: (item: SubscriptionFiscalTransmission) => {
        if (item.pdf_url) window.open(item.pdf_url, '_blank', 'noopener');
      },
    },
    {
      label: 'Reintentar',
      icon: 'refresh-cw',
      show: (item: SubscriptionFiscalTransmission) => item.transmission_status !== 'accepted',
      disabled: (item: SubscriptionFiscalTransmission) => this.retryingTransmissionId() === item.id,
      action: (item: SubscriptionFiscalTransmission) => this.onRetry(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'document_number',
    subtitleKey: 'source_type',
    subtitleTransform: (val) => {
      if (val === 'subscription_invoice') return 'SaaS';
      if (val === 'platform_invoice') return 'Plataforma';
      if (val === 'platform_support_document') return 'Doc. Soporte';
      return val || '—';
    },
    badgeKey: 'transmission_status',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        accepted: 'success',
        rejected: 'error',
        pending: 'warning',
        processing: 'warning',
        cancelled: 'secondary',
      },
    },
    badgeTransform: (val) => transmissionStatusLabel(val),
    footerKey: 'total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val, item: SubscriptionFiscalTransmission) => {
      const total = asNumber(item.subscription_invoice?.total ?? 0);
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: item.subscription_invoice?.currency || 'COP',
        minimumFractionDigits: 0,
      }).format(total);
    },
  };

  constructor() {
    this.store.loadStatus();
    this.loadTransmissions();
  }

  loadTransmissions(): void {
    this.loadingTransmissions.set(true);
    const pagination = this.pagination();
    const filters = this.filterValues();
    const status = (filters['status'] as string) || undefined;
    const environment =
      (filters['environment'] as SubscriptionFiscalEnvironment | '') || undefined;

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

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransmissions();
  }

  onClearFilters(): void {
    this.filterValues.set({});
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransmissions();
  }

  onDropdownActionClick(action: DropdownAction | string): void {
    const actionId = typeof action === 'string' ? action : action.action;
    if (actionId === 'new_invoice') {
      this.router.navigate(['/super-admin/fiscal/invoicing/invoices/new']);
    } else if (actionId === 'manual_issue') {
      this.showManualIssueModal.set(true);
    } else if (actionId === 'refresh') {
      this.loadTransmissions();
      this.store.loadStatus(true);
    }
  }

  onRowClick(row: SubscriptionFiscalTransmission): void {
    this.selectedInvoiceId.set(row.source_id);
    this.showDetailModal.set(true);
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
          this.showManualIssueModal.set(false);
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
}
