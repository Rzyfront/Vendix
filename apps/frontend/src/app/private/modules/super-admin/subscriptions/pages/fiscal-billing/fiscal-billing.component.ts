import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  EmptyStateComponent,
  FileUploadDropzoneComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  PaginationComponent,
  SelectorComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import {
  StickyHeaderActionButton,
  StickyHeaderComponent,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import {
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalStatus,
  SubscriptionFiscalTransmission,
  UpsertSubscriptionFiscalConfigDto,
} from '../../interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../services/fiscal-billing-admin.service';

interface FiscalConfigFormControls {
  platform_organization_id: FormControl<string | null>;
  accounting_entity_id: FormControl<string | null>;
  invoice_resolution_id: FormControl<string | null>;
  dian_configuration_id: FormControl<string | null>;
  name: FormControl<string | null>;
  nit: FormControl<string | null>;
  nit_dv: FormControl<string | null>;
  software_id: FormControl<string | null>;
  software_pin: FormControl<string | null>;
  test_set_id: FormControl<string | null>;
  environment: FormControl<SubscriptionFiscalEnvironment>;
  is_enabled: FormControl<boolean>;
  auto_issue: FormControl<boolean>;
  confirm_production: FormControl<boolean>;
}

const numericIdValidator = Validators.pattern(/^[1-9]\d*$/);

const optionalNumericIdValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return /^[1-9]\d*$/.test(String(value)) ? null : { numeric_id: true };
};

const confirmProductionValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const environment = group.get('environment')?.value;
  const enabled = group.get('is_enabled')?.value;
  const confirmed = group.get('confirm_production')?.value;
  if (environment === 'production' && enabled && !confirmed) {
    return { confirm_production_required: true };
  }
  return null;
};

@Component({
  selector: 'app-fiscal-billing',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    CurrencyPipe,
    StickyHeaderComponent,
    ButtonComponent,
    EmptyStateComponent,
    FileUploadDropzoneComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    PaginationComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  templateUrl: './fiscal-billing.component.html',
})
export class FiscalBillingComponent {
  private fb = inject(FormBuilder);
  private fiscal = inject(FiscalBillingAdminService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly status = signal<SubscriptionFiscalStatus | null>(null);
  readonly transmissions = signal<SubscriptionFiscalTransmission[]>([]);
  readonly loadingStatus = signal(true);
  readonly loadingTransmissions = signal(false);
  readonly saving = signal(false);
  readonly testing = signal(false);
  readonly uploadingCertificate = signal(false);
  readonly issuingInvoice = signal(false);
  readonly retryingTransmissionId = signal<number | null>(null);
  readonly selectedCertificate = signal<File | null>(null);
  readonly certificatePasswordFilled = signal(false);
  readonly selectedEnvironment = signal<SubscriptionFiscalEnvironment>('test');
  readonly isEnabled = signal(false);
  readonly formInvalid = signal(true);
  readonly search = signal('');

  readonly pagination = signal({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  readonly form: FormGroup<FiscalConfigFormControls> =
    this.fb.group<FiscalConfigFormControls>(
      {
        platform_organization_id: this.fb.control<string | null>(null, [
          Validators.required,
          numericIdValidator,
        ]),
        accounting_entity_id: this.fb.control<string | null>(null, [
          Validators.required,
          numericIdValidator,
        ]),
        invoice_resolution_id: this.fb.control<string | null>(null, [
          optionalNumericIdValidator,
        ]),
        dian_configuration_id: this.fb.control<string | null>(null, [
          optionalNumericIdValidator,
        ]),
        name: this.fb.control<string | null>(null, [Validators.required]),
        nit: this.fb.control<string | null>(null, [Validators.required]),
        nit_dv: this.fb.control<string | null>(null),
        software_id: this.fb.control<string | null>(null, [
          Validators.required,
        ]),
        software_pin: this.fb.control<string | null>(null),
        test_set_id: this.fb.control<string | null>(null),
        environment:
          this.fb.nonNullable.control<SubscriptionFiscalEnvironment>('test'),
        is_enabled: this.fb.nonNullable.control(false),
        auto_issue: this.fb.nonNullable.control(false),
        confirm_production: this.fb.nonNullable.control(false),
      },
      { validators: confirmProductionValidator },
    );

  readonly certificatePasswordControl = this.fb.control<string | null>(null);
  readonly manualInvoiceIdControl = this.fb.control<string | null>(null, [
    optionalNumericIdValidator,
  ]);
  readonly statusFilterControl = this.fb.control<string | null>('');
  readonly environmentFilterControl = this.fb.control<string | null>('');

  readonly environmentOptions = [
    { value: 'test', label: 'Sandbox DIAN' },
    { value: 'production', label: 'Producción DIAN' },
  ];

  readonly filterEnvironmentOptions = [
    { value: '', label: 'Todos los ambientes' },
    { value: 'test', label: 'Sandbox' },
    { value: 'production', label: 'Producción' },
  ];

  readonly statusOptions = [
    { value: '', label: 'Todos los estados' },
    { value: 'queued', label: 'En cola' },
    { value: 'submitted', label: 'Enviada' },
    { value: 'accepted', label: 'Aceptada' },
    { value: 'rejected', label: 'Rechazada' },
    { value: 'error', label: 'Error' },
    { value: 'retrying', label: 'Reintentando' },
  ];

  readonly configured = computed(() => !!this.status()?.settings.dian_configuration_id);

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'test',
      label: 'Probar DIAN',
      variant: 'outline',
      icon: 'zap',
      loading: this.testing(),
      disabled:
        this.testing() ||
        this.saving() ||
        this.uploadingCertificate() ||
        !this.configured(),
    },
    {
      id: 'save',
      label: this.configured() ? 'Actualizar' : 'Guardar',
      variant: 'primary',
      icon: 'save',
      loading: this.saving(),
      disabled:
        this.saving() ||
        this.testing() ||
        this.uploadingCertificate() ||
        this.formInvalid(),
    },
  ]);

  readonly badgeText = computed(() => {
    const settings = this.status()?.settings;
    if (!settings?.dian_configuration_id) return 'No configurada';
    if (!settings.is_enabled) return 'Configurada · Inactiva';
    return `Activa · ${this.environmentLabel(settings.environment)}`;
  });

  readonly badgeColor = computed(() => {
    const settings = this.status()?.settings;
    return settings?.is_enabled ? 'green' : 'red';
  });

  readonly stats = computed(
    () => this.status()?.stats ?? { accepted: 0, errors: 0, pending: 0 },
  );

  readonly lastTest = computed(
    () => this.status()?.settings.last_test_result ?? null,
  );

  readonly lastTestedAt = computed(
    () => this.status()?.settings.last_tested_at ?? null,
  );

  readonly certificateReady = computed(
    () =>
      !!this.selectedCertificate() &&
      this.certificatePasswordFilled() &&
      !this.uploadingCertificate(),
  );

  constructor() {
    this.loadStatus();
    this.loadTransmissions();

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshFormSignals());

    this.form.controls.environment.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((environment) => {
        this.selectedEnvironment.set(environment);
        if (environment !== 'production') {
          this.form.controls.confirm_production.setValue(false, {
            emitEvent: false,
          });
        }
        this.form.updateValueAndValidity({ emitEvent: false });
        this.refreshFormSignals();
      });

    this.form.controls.is_enabled.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled) => {
        this.isEnabled.set(enabled);
        this.form.updateValueAndValidity({ emitEvent: false });
        this.refreshFormSignals();
      });

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

    this.certificatePasswordControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.certificatePasswordFilled.set(!!value?.trim()));
  }

  loadStatus(): void {
    this.loadingStatus.set(true);
    this.fiscal
      .getStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.applyStatusToForm(status);
          this.loadingStatus.set(false);
        },
        error: () => {
          this.toast.error(
            'No se pudo cargar la configuración de facturación',
            'Error',
          );
          this.loadingStatus.set(false);
        },
      });
  }

  loadTransmissions(): void {
    this.loadingTransmissions.set(true);
    const pagination = this.pagination();
    const status = this.statusFilterControl.value || undefined;
    const environment =
      (this.environmentFilterControl.value as SubscriptionFiscalEnvironment | '') ||
      undefined;

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

  onHeaderAction(id: string): void {
    if (id === 'test') this.onTestConnection();
    if (id === 'save') this.onSave();
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

  onCertificateSelected(file: File): void {
    this.selectedCertificate.set(file);
  }

  onCertificateRemoved(): void {
    this.selectedCertificate.set(null);
  }

  onUploadCertificate(): void {
    const file = this.selectedCertificate();
    const password = this.certificatePasswordControl.value?.trim();
    if (!file || !password) {
      this.toast.warning('Selecciona el P12 y escribe la contraseña', 'Faltan datos');
      return;
    }

    this.uploadingCertificate.set(true);
    this.fiscal
      .uploadCertificate(file, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploadingCertificate.set(false);
          this.selectedCertificate.set(null);
          this.certificatePasswordControl.reset(null, { emitEvent: false });
          this.toast.success('Certificado DIAN validado y guardado', 'Listo');
          this.loadStatus();
        },
        error: (err: { error?: { message?: string } }) => {
          this.uploadingCertificate.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo subir el certificado',
            'Error',
          );
        },
      });
  }

  onTestConnection(): void {
    if (!this.configured() || this.testing()) return;
    this.testing.set(true);
    this.fiscal
      .testConnection()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testing.set(false);
          if (result.ok) {
            this.toast.success(result.message ?? 'Conexión DIAN OK', 'Test exitoso');
          } else {
            this.toast.error(result.message ?? 'DIAN no respondió correctamente', 'Test fallido');
          }
          this.loadStatus();
        },
        error: (err: { error?: { message?: string } }) => {
          this.testing.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo probar la conexión DIAN',
            'Test fallido',
          );
        },
      });
  }

  onSave(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.configured() && !this.form.controls.software_pin.value?.trim()) {
      this.toast.warning(
        'El PIN de software es obligatorio al crear la configuración',
        'Faltan datos',
      );
      return;
    }

    this.saving.set(true);
    this.fiscal
      .saveConfig(this.buildConfigDto())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.applyStatusToForm(status);
          this.saving.set(false);
          this.toast.success('Configuración fiscal guardada', 'Facturación');
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

  onIssueManualInvoice(): void {
    const invoiceId = this.parseRequiredId(this.manualInvoiceIdControl.value);
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
            this.toast.warning(this.skippedReason(result.reason), 'No emitida');
          } else {
            this.toast.success('Solicitud de emisión registrada', 'Facturación');
          }
          this.manualInvoiceIdControl.reset(null, { emitEvent: false });
          this.loadTransmissions();
          this.loadStatus();
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
          this.loadStatus();
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

  environmentLabel(environment?: SubscriptionFiscalEnvironment | null): string {
    if (environment === 'production') return 'Producción';
    if (environment === 'test') return 'Sandbox';
    return '—';
  }

  statusLabel(status?: string | null): string {
    switch (status) {
      case 'accepted':
        return 'Aceptada';
      case 'rejected':
        return 'Rechazada';
      case 'error':
        return 'Error';
      case 'submitted':
        return 'Enviada';
      case 'retrying':
        return 'Reintentando';
      case 'queued':
        return 'En cola';
      default:
        return status ?? '—';
    }
  }

  statusBadgeClasses(status?: string | null): string {
    if (status === 'accepted') {
      return 'bg-green-50 text-green-700 border-green-200';
    }
    if (status === 'rejected' || status === 'error') {
      return 'bg-red-50 text-red-700 border-red-200';
    }
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }

  asNumber(value: string | number | null | undefined): number {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  }

  private applyStatusToForm(status: SubscriptionFiscalStatus): void {
    const settings = status.settings;
    const config = status.dian_config;
    this.form.patchValue(
      {
        platform_organization_id: this.toIdValue(settings.platform_organization_id),
        accounting_entity_id: this.toIdValue(settings.accounting_entity_id),
        invoice_resolution_id: this.toIdValue(settings.invoice_resolution_id),
        dian_configuration_id: this.toIdValue(settings.dian_configuration_id),
        name: config?.name ?? null,
        nit: config?.nit ?? null,
        nit_dv: config?.nit_dv ?? null,
        software_id: config?.software_id ?? null,
        software_pin: null,
        test_set_id: config?.test_set_id ?? null,
        environment: settings.environment,
        is_enabled: settings.is_enabled,
        auto_issue: settings.auto_issue,
        confirm_production: false,
      },
      { emitEvent: false },
    );
    this.refreshFormSignals();
  }

  private refreshFormSignals(): void {
    const value = this.form.getRawValue();
    this.selectedEnvironment.set(value.environment);
    this.isEnabled.set(value.is_enabled);
    this.formInvalid.set(this.form.invalid);
  }

  private buildConfigDto(): UpsertSubscriptionFiscalConfigDto {
    const value = this.form.getRawValue();
    const dto: UpsertSubscriptionFiscalConfigDto = {
      platform_organization_id: this.parseRequiredId(
        value.platform_organization_id,
      )!,
      accounting_entity_id: this.parseRequiredId(value.accounting_entity_id)!,
      name: value.name?.trim() ?? '',
      nit: value.nit?.trim() ?? '',
      software_id: value.software_id?.trim() ?? '',
      environment: value.environment,
      is_enabled: value.is_enabled,
      auto_issue: value.auto_issue,
    };

    const resolutionId = this.parseOptionalId(value.invoice_resolution_id);
    const configId = this.parseOptionalId(value.dian_configuration_id);
    if (resolutionId) dto.invoice_resolution_id = resolutionId;
    if (configId) dto.dian_configuration_id = configId;
    if (value.nit_dv?.trim()) dto.nit_dv = value.nit_dv.trim();
    if (value.software_pin?.trim()) dto.software_pin = value.software_pin.trim();
    if (value.test_set_id?.trim()) dto.test_set_id = value.test_set_id.trim();
    if (value.environment === 'production') {
      dto.confirm_production = value.confirm_production;
    }
    return dto;
  }

  private parseRequiredId(value: string | number | null | undefined): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private parseOptionalId(value: string | number | null | undefined): number | undefined {
    return this.parseRequiredId(value) ?? undefined;
  }

  private toIdValue(value: number | null | undefined): string | null {
    return value ? String(value) : null;
  }

  private skippedReason(reason: string): string {
    if (reason === 'subscription_fiscal_billing_disabled') {
      return 'La facturación electrónica está desactivada';
    }
    if (reason === 'subscription_fiscal_auto_issue_disabled') {
      return 'La emisión automática está desactivada';
    }
    if (reason === 'subscription_invoice_not_paid') {
      return 'La factura SaaS aún no está pagada';
    }
    return reason;
  }
}
