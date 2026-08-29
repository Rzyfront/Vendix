import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  DianResolutionScanResult,
  DianResolutionScannerModalComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  ItemListCardConfig,
  ModalComponent,
  RESOLUTION_SCAN_FIELD_LABELS,
  ResponsiveDataViewComponent,
  SelectorComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components';
import {
  CreatePlatformResolutionDto,
  PlatformResolution,
  PlatformResolutionDocumentType,
  SubscriptionFiscalEnvironment,
  UpdatePlatformResolutionDto,
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
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    DianResolutionScannerModalComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    StatsComponent,
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
  /** Non-null while the modal edits an existing row instead of creating one. */
  readonly editing = signal<PlatformResolution | null>(null);
  readonly pendingDelete = signal<PlatformResolution | null>(null);
  readonly deleting = signal(false);
  readonly togglingId = signal<number | null>(null);
  readonly scannerOpen = signal(false);
  /**
   * Campos que la IA leyó pero no pudo verificar, para señalarlos en el
   * formulario recién precargado. Se limpia al cerrar el modal.
   */
  readonly scanUnverified = signal<string[]>([]);

  readonly documentTypeOptions = RESOLUTION_DOCUMENT_TYPE_OPTIONS;
  readonly environmentOptions = ENVIRONMENT_OPTIONS;
  readonly docTypeLabel = resolutionDocTypeLabel;

  readonly totalCount = computed(() => this.store.resolutions().length);
  readonly activeCount = computed(
    () => this.store.resolutions().filter((r) => r.is_active).length,
  );
  readonly salesCount = computed(
    () =>
      this.store.resolutions().filter((r) => r.document_type === 'sales_invoice')
        .length,
  );
  readonly supportCount = computed(
    () =>
      this.store.resolutions().filter(
        (r) => r.document_type === 'support_document',
      ).length,
  );

  readonly columns: TableColumn[] = [
    { key: 'prefix', label: 'Prefijo' },
    {
      key: 'document_type',
      label: 'Tipo',
      transform: (v) => this.docTypeLabel(v as PlatformResolutionDocumentType),
    },
    {
      key: 'range',
      label: 'Rango autorizado',
      transform: (_v, item: PlatformResolution) =>
        `${item.range_from} – ${item.range_to}`,
    },
    {
      key: 'current_number',
      label: 'Consecutivo actual',
      align: 'right',
      transform: (v) => String(v),
    },
    {
      key: 'validity',
      label: 'Vigencia',
      transform: (_v, item: PlatformResolution) => {
        const from = item.valid_from ? item.valid_from.slice(0, 10) : '—';
        const to = item.valid_to ? item.valid_to.slice(0, 10) : '—';
        return `${from} → ${to}`;
      },
    },
    {
      key: 'is_active',
      label: 'Estado',
      badgeConfig: {
        type: 'custom',
        colorMap: {
          true: 'success',
          false: 'secondary',
        },
      },
      badgeTransform: (v) => (v ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'prefix',
    subtitleKey: 'document_type',
    subtitleTransform: (v) =>
      this.docTypeLabel(v as PlatformResolutionDocumentType),
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        true: 'success',
        false: 'secondary',
      },
    },
    badgeTransform: (v) => (v ? 'Activa' : 'Inactiva'),
    footerKey: 'current_number',
    footerLabel: 'Consecutivo actual',
    footerTransform: (v, item: PlatformResolution) =>
      `${item.current_number} / ${item.range_to}`,
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (item: PlatformResolution) => this.openEdit(item),
    },
    {
      label: 'Alternar estado',
      icon: 'power',
      action: (item: PlatformResolution) => this.toggleActive(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      disabled: (item: PlatformResolution) => this.isLocked(item),
      action: (item: PlatformResolution) => this.askDelete(item),
    },
  ];

  onTableAction(event: { action: TableAction; item: PlatformResolution }): void {
    event.action.action(event.item);
  }

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
    this.editing.set(null);
    this.scanUnverified.set([]);
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
    this.form.enable({ emitEvent: false });
    this.formInvalid.set(this.form.invalid);
    this.modalOpen.set(true);
  }

  /**
   * Opens the same modal in edit mode. When the resolution already consumed
   * DIAN numbering, the identity controls are disabled instead of merely
   * validated: the backend rejects them and a disabled control explains why
   * before the user types.
   */
  openEdit(row: PlatformResolution): void {
    this.editing.set(row);
    this.scanUnverified.set([]);
    this.form.reset({
      prefix: row.prefix,
      document_type: row.document_type,
      environment: row.environment,
      rango_inicial: row.range_from,
      rango_final: row.range_to,
      technical_key: row.technical_key ?? null,
      resolution_number: row.resolution_number ?? null,
      resolution_date: this.dateOnly(row.resolution_date),
      valid_from: this.dateOnly(row.valid_from),
      valid_to: this.dateOnly(row.valid_to),
    });

    this.form.enable({ emitEvent: false });
    if (this.isLocked(row)) {
      this.form.controls.prefix.disable({ emitEvent: false });
      this.form.controls.document_type.disable({ emitEvent: false });
      this.form.controls.rango_inicial.disable({ emitEvent: false });
    }
    // Environment is a display grouping, not a stored column — editing it would
    // suggest a change the PATCH cannot make.
    this.form.controls.environment.disable({ emitEvent: false });

    this.formInvalid.set(this.form.invalid);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editing.set(null);
    this.scanUnverified.set([]);
  }

  /**
   * El escáner es una puerta de entrada a la creación, no un modal anidado: se
   * abre con el formulario cerrado y, al confirmar, abre el formulario ya
   * precargado. Así el usuario siempre termina en el mismo sitio donde guarda.
   */
  openScanner(): void {
    this.modalOpen.set(false);
    this.scannerOpen.set(true);
  }

  /**
   * Precarga el formulario con lo que la IA leyó. Solo copia campos con valor:
   * un campo que no se leyó se queda vacío para que el usuario lo escriba, en
   * vez de recibir un cero o una fecha inventada.
   */
  applyScan(scan: DianResolutionScanResult): void {
    this.openModal();

    const patch: Partial<{
      prefix: string;
      document_type: PlatformResolutionDocumentType;
      environment: SubscriptionFiscalEnvironment;
      rango_inicial: number;
      rango_final: number;
      technical_key: string;
      resolution_number: string;
      resolution_date: string;
      valid_from: string;
      valid_to: string;
    }> = {};

    if (scan.prefix.value) patch.prefix = scan.prefix.value;
    if (scan.document_type.value) patch.document_type = scan.document_type.value;
    if (scan.environment.value) patch.environment = scan.environment.value;
    if (scan.range_from.value !== null) {
      patch.rango_inicial = scan.range_from.value;
    }
    if (scan.range_to.value !== null) patch.rango_final = scan.range_to.value;
    if (scan.technical_key.value) patch.technical_key = scan.technical_key.value;
    if (scan.resolution_number.value) {
      patch.resolution_number = scan.resolution_number.value;
    }
    if (scan.resolution_date.value) {
      patch.resolution_date = scan.resolution_date.value;
    }
    if (scan.valid_from.value) patch.valid_from = scan.valid_from.value;
    if (scan.valid_to.value) patch.valid_to = scan.valid_to.value;

    this.form.patchValue(patch);
    this.form.markAllAsTouched();
    this.formInvalid.set(this.form.invalid);
    this.scanUnverified.set(scan.requires_manual_confirmation);

    if (scan.requires_manual_confirmation.length > 0) {
      this.toast.warning(
        `Revisa ${scan.requires_manual_confirmation.length} campo(s) antes de guardar`,
        'Precargado con IA',
      );
    } else {
      this.toast.success('Formulario precargado desde la resolución', 'IA');
    }
  }

  /** True once at least one consecutive left the range or a document exists. */
  isLocked(row: PlatformResolution): boolean {
    return row.current_number >= row.range_from;
  }

  onSubmit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const editing = this.editing();
    if (editing) {
      this.submitUpdate(editing);
      return;
    }
    this.submitCreate();
  }

  private submitCreate(): void {
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
          this.closeModal();
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

  /**
   * Sends only what actually changed. A PATCH that echoes every field would make
   * the backend's immutability guard fire on values the user never touched.
   */
  private submitUpdate(editing: PlatformResolution): void {
    const value = this.form.getRawValue();
    const dto: UpdatePlatformResolutionDto = {};

    const nextPrefix = value.prefix?.trim() || null;
    if (nextPrefix && nextPrefix !== editing.prefix) dto.prefix = nextPrefix;
    if (value.document_type !== editing.document_type) {
      dto.document_type = value.document_type;
    }
    if (Number(value.rango_inicial) !== editing.range_from) {
      dto.rango_inicial = Number(value.rango_inicial);
    }
    if (Number(value.rango_final) !== editing.range_to) {
      dto.rango_final = Number(value.rango_final);
    }

    const nextTechnicalKey = value.technical_key?.trim() ?? '';
    if (nextTechnicalKey !== (editing.technical_key ?? '')) {
      dto.technical_key = nextTechnicalKey;
    }
    const nextNumber = value.resolution_number?.trim() ?? '';
    if (nextNumber && nextNumber !== (editing.resolution_number ?? '')) {
      dto.resolution_number = nextNumber;
    }
    if (value.resolution_date !== this.dateOnly(editing.resolution_date)) {
      if (value.resolution_date) dto.resolution_date = value.resolution_date;
    }
    if (value.valid_from !== this.dateOnly(editing.valid_from)) {
      if (value.valid_from) dto.valid_from = value.valid_from;
    }
    if (value.valid_to !== this.dateOnly(editing.valid_to)) {
      if (value.valid_to) dto.valid_to = value.valid_to;
    }

    if (Object.keys(dto).length === 0) {
      this.closeModal();
      this.toast.info('No hay cambios por guardar', 'Plataforma');
      return;
    }

    this.saving.set(true);
    this.fiscal
      .updateResolution(editing.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.toast.success('Resolución DIAN actualizada', 'Plataforma');
          this.store.loadResolutions(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo actualizar la resolución',
            'Error',
          );
        },
      });
  }

  /**
   * Flips `is_active` without opening the form. This is the supported way to
   * retire a resolution that already numbered documents — deleting it is
   * refused by the backend precisely because it is fiscal evidence.
   */
  toggleActive(row: PlatformResolution): void {
    if (this.togglingId() !== null) return;
    this.togglingId.set(row.id);
    this.fiscal
      .updateResolution(row.id, { is_active: !row.is_active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.togglingId.set(null);
          this.toast.success(
            row.is_active ? 'Resolución desactivada' : 'Resolución activada',
            'Plataforma',
          );
          this.store.loadResolutions(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.togglingId.set(null);
          this.toast.error(
            err?.error?.message ?? 'No se pudo cambiar el estado',
            'Error',
          );
        },
      });
  }

  askDelete(row: PlatformResolution): void {
    this.pendingDelete.set(row);
  }

  deleteMessage(row: PlatformResolution): string {
    return `Se eliminará la resolución ${row.prefix} · ${this.docTypeLabel(row.document_type)} (rango ${row.range_from} – ${row.range_to}). No ha numerado ningún documento, así que no hay evidencia fiscal que preservar. Si vuelve a necesitarse, tendrás que crearla de nuevo.`;
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  confirmDelete(): void {
    const row = this.pendingDelete();
    if (!row || this.deleting()) return;

    this.deleting.set(true);
    this.fiscal
      .deleteResolution(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.toast.success('Resolución DIAN eliminada', 'Plataforma');
          this.store.loadResolutions(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.toast.error(
            err?.error?.message ?? 'No se pudo eliminar la resolución',
            'Error',
          );
        },
      });
  }

  /** Etiqueta legible de un campo señalado por el escáner. */
  scanFieldLabel(key: string): string {
    return (
      (RESOLUTION_SCAN_FIELD_LABELS as Record<string, string>)[key] ?? key
    );
  }

  /**
   * `<input type="date">` wants `yyyy-MM-dd`. Slicing the ISO string keeps the
   * calendar day the backend stored instead of shifting it through the local
   * timezone, which is the classic off-by-one on fiscal dates.
   */
  private dateOnly(value: string | null | undefined): string | null {
    if (!value) return null;
    return value.slice(0, 10);
  }
}
