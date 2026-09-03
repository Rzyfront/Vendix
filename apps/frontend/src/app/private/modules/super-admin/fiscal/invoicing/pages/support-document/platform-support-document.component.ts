import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components';
import {
  PatchVendorSupportFiscalConfigDto,
  SubscriptionFiscalEnvironment,
  VendorSupportFiscalConfig,
  VendorSupportFiscalTransmission,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import {
  ENVIRONMENT_OPTIONS,
  optionalNumericIdValidator,
  parseOptionalId,
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';

interface VendorSupportFiscalFormControls {
  is_enabled: FormControl<boolean>;
  auto_transmit: FormControl<boolean>;
  environment: FormControl<SubscriptionFiscalEnvironment>;
  invoice_resolution_id: FormControl<string | null>;
}

/**
 * Pestaña «Documento soporte»: emisión electrónica del documento soporte a la
 * DIAN por compras a proveedores no obligados a facturar electrónicamente.
 *
 * Va en su propia pestaña y no dentro de «Facturas» porque es el flujo inverso:
 * lo que Vendix COMPRA, no lo que factura. Comparte credenciales DIAN, pero su
 * interruptor, su resolución y su registro son independientes.
 */
@Component({
  selector: 'app-platform-support-document',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    StatsComponent,
    ToggleComponent,
  ],
  templateUrl: './platform-support-document.component.html',
})
export class PlatformSupportDocumentComponent {
  private readonly fb = inject(FormBuilder);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(PlatformInvoicingStore);

  readonly config = signal<VendorSupportFiscalConfig | null>(null);
  readonly loadingConfig = signal(false);
  readonly saving = signal(false);
  readonly transmissions = signal<VendorSupportFiscalTransmission[]>([]);
  readonly loadingTransmissions = signal(false);
  readonly retryingId = signal<number | null>(null);
  readonly isEnabled = signal(false);
  readonly selectedEnvironment = signal<SubscriptionFiscalEnvironment>('test');
  readonly pagination = signal({ page: 1, limit: 20, total: 0, totalPages: 0 });

  readonly environmentOptions = ENVIRONMENT_OPTIONS;
  readonly statusLabel = transmissionStatusLabel;
  readonly statusBadgeClasses = transmissionStatusBadgeClasses;

  readonly columns: TableColumn[] = [
    {
      key: 'document_number',
      label: 'Documento',
      transform: (v, item: VendorSupportFiscalTransmission) =>
        item.document_number || `ID #${item.id}`,
    },
    {
      key: 'cuds',
      label: 'CUDS',
      transform: (v) => (v ? String(v).slice(0, 16) + '…' : '—'),
    },
    {
      key: 'transmitted_at',
      label: 'Fecha transmisión',
      transform: (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—'),
    },
    {
      key: 'transmission_status',
      label: 'Estado DIAN',
      badgeConfig: {
        type: 'custom',
        colorMap: {
          accepted: 'success',
          rejected: 'error',
          pending: 'warning',
          processing: 'warning',
        },
      },
      badgeTransform: (v) => transmissionStatusLabel(v as any),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'document_number',
    subtitleKey: 'cuds',
    subtitleTransform: (v) => (v ? `CUDS: ${String(v).slice(0, 16)}…` : 'Sin CUDS'),
    badgeKey: 'transmission_status',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        accepted: 'success',
        rejected: 'error',
        pending: 'warning',
        processing: 'warning',
      },
    },
    badgeTransform: (v) => transmissionStatusLabel(v as any),
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Reintentar',
      icon: 'refresh-cw',
      show: (item: VendorSupportFiscalTransmission) => this.canRetry(item),
      action: (item: VendorSupportFiscalTransmission) => this.onRetry(item),
    },
  ];

  onTableAction(event: { action: TableAction; item: VendorSupportFiscalTransmission }): void {
    event.action.action(event.item);
  }

  readonly form: FormGroup<VendorSupportFiscalFormControls> =
    this.fb.group<VendorSupportFiscalFormControls>({
      is_enabled: this.fb.nonNullable.control(false),
      auto_transmit: this.fb.nonNullable.control(false),
      environment:
        this.fb.nonNullable.control<SubscriptionFiscalEnvironment>('test'),
      invoice_resolution_id: this.fb.control<string | null>(null, [
        optionalNumericIdValidator,
      ]),
    });

  readonly resolutionOptions = computed(() =>
    this.store.resolutionOptions('support_document', this.selectedEnvironment()),
  );

  constructor() {
    this.store.loadResolutions();
    this.loadConfig();
    this.loadTransmissions();

    this.form.controls.is_enabled.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled) => {
        this.isEnabled.set(enabled);
        if (!enabled) {
          this.form.controls.auto_transmit.setValue(false, {
            emitEvent: false,
          });
        }
      });

    // El selector de resolución filtra por ambiente: sin esto seguiría
    // ofreciendo las de sandbox después de cambiar a producción.
    this.form.controls.environment.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((environment) => this.selectedEnvironment.set(environment));
  }

  loadConfig(): void {
    this.loadingConfig.set(true);
    this.fiscal
      .getVendorSupportFiscalConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config) => {
          this.config.set(config);
          this.applyConfigToForm(config);
          this.loadingConfig.set(false);
        },
        error: () => {
          this.toast.error(
            'No se pudo cargar la configuración de documento soporte',
            'Error',
          );
          this.loadingConfig.set(false);
        },
      });
  }

  loadTransmissions(): void {
    this.loadingTransmissions.set(true);
    const pagination = this.pagination();
    this.fiscal
      .listVendorSupportTransmissions({
        page: pagination.page,
        limit: pagination.limit,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.transmissions.set(res.data ?? []);
          this.pagination.update((p) => ({
            ...p,
            total: res.meta?.total ?? 0,
            totalPages: res.meta?.totalPages ?? 0,
          }));
          this.loadingTransmissions.set(false);
        },
        error: () => {
          this.toast.error(
            'No se pudo cargar el registro de documento soporte',
            'Error',
          );
          this.loadingTransmissions.set(false);
        },
      });
  }

  onSave(): void {
    if (this.saving()) return;
    const value = this.form.getRawValue();
    const dto: PatchVendorSupportFiscalConfigDto = {
      is_enabled: value.is_enabled,
      auto_transmit: value.auto_transmit,
      environment: value.environment,
    };
    const resolutionId = parseOptionalId(value.invoice_resolution_id);
    if (resolutionId) dto.invoice_resolution_id = resolutionId;

    this.saving.set(true);
    this.fiscal
      .patchVendorSupportFiscalConfig(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config) => {
          this.config.set(config);
          this.applyConfigToForm(config);
          this.saving.set(false);
          this.toast.success(
            'Configuración de documento soporte guardada',
            'Plataforma',
          );
          this.loadTransmissions();
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo guardar la configuración',
            'Error',
          );
        },
      });
  }

  onRetry(row: VendorSupportFiscalTransmission): void {
    if (row.transmission_status === 'accepted' || this.retryingId()) return;
    this.retryingId.set(row.id);
    this.fiscal
      .retryVendorSupportTransmission(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.retryingId.set(null);
          this.toast.success('Reintento solicitado', 'Documento soporte');
          this.loadTransmissions();
          this.loadConfig();
        },
        error: (err: { error?: { message?: string } }) => {
          this.retryingId.set(null);
          this.toast.error(
            err?.error?.message ?? 'No se pudo reintentar la transmisión',
            'Error',
          );
        },
      });
  }

  canRetry(row: VendorSupportFiscalTransmission): boolean {
    return row.transmission_status !== 'accepted';
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadTransmissions();
  }

  private applyConfigToForm(config: VendorSupportFiscalConfig): void {
    const settings = config.settings;
    this.form.patchValue(
      {
        is_enabled: settings.is_enabled,
        auto_transmit: settings.auto_transmit,
        environment: settings.environment,
        invoice_resolution_id: settings.invoice_resolution_id
          ? String(settings.invoice_resolution_id)
          : null,
      },
      { emitEvent: false },
    );
    this.isEnabled.set(settings.is_enabled);
    this.selectedEnvironment.set(settings.environment);
  }
}
