import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
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
  CardComponent,
  DianResolutionScanResult,
  DianResolutionScannerModalComponent,
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
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import {
  CreatePlatformResolutionDto,
  PlatformResolution,
  PlatformResolutionDocumentType,
  SubscriptionFiscalEnvironment,
  UpdatePlatformResolutionDto,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { ModuleShellActionsService } from '../../../../../../../shared/components/module-tabs-shell/module-shell-actions.service';
import {
  ResolutionArchiveModalComponent,
  ResolutionsInUseCardComponent,
  deactivatedResolutionsToast,
  extractDeactivatedResolutionIds,
  findNoteSeriesConflicts,
  formatArchivedAt,
  isResolutionInUse,
  isNoteSeriesType,
  noteSeriesActivationMessage,
  requirementsFor,
  type FiscalDocumentType,
} from '../../../../../../../shared/components/dian';
import {
  INTERNAL_SERIES_FORM_VALIDITY_YEARS,
  INTERNAL_SERIES_INITIAL_RANGE,
} from '../../../../../../../shared/components/dian/fiscal-document-requirements';
import { ConfirmationModalComponent } from '../../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';
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
    ButtonComponent,
    CardComponent,
    DianResolutionScannerModalComponent,
    ResolutionArchiveModalComponent,
    ToggleComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    StatsComponent,
    ResolutionsInUseCardComponent,
    ConfirmationModalComponent,
  ],
  templateUrl: './platform-resolutions.component.html',
})
export class PlatformResolutionsComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly shellActions = inject(ModuleShellActionsService);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(PlatformInvoicingStore);

  /**
   * Los botones de la pantalla viven en el sticky-header del shell, no en una
   * barra propia. Antes esta pagina dibujaba su propia cabecera sticky a
   * `top-[99px]`, justo debajo de la del shell: dos barras pegadas, ambas
   * fijas, repitiendo el titulo del modulo y robando ~90px de alto util en
   * movil. El titulo y el conteo ya los da el shell.
   */
  ngOnInit(): void {
    this.shellActions.set([
      {
        id: 'scan',
        label: 'Escanear con IA',
        variant: 'outline',
        icon: 'sparkles',
        title: 'Leer los datos desde una foto o PDF de la resolución',
        run: () => this.openScanner(),
      },
      {
        id: 'new',
        label: 'Nueva resolución',
        variant: 'primary',
        icon: 'plus',
        run: () => this.openModal(),
      },
    ]);
  }

  ngOnDestroy(): void {
    this.shellActions.clear();
    // «Ver archivadas» no debe filtrarse a las otras pestañas que comparten el store.
    if (this.store.includeArchived()) this.store.setIncludeArchived(false);
  }

  readonly modalOpen = signal(false);
  readonly saving = signal(false);
  readonly formInvalid = signal(true);
  /** Non-null while the modal edits an existing row instead of creating one. */
  readonly editing = signal<PlatformResolution | null>(null);
  readonly pendingArchive = signal<PlatformResolution | null>(null);
  readonly archiveBusy = signal(false);
  readonly archiveError = signal<string | null>(null);
  readonly archiveRequirePrefix = signal(false);
  readonly togglingId = signal<number | null>(null);
  readonly scannerOpen = signal(false);
  /**
   * Campos que la IA leyó pero no pudo verificar, para señalarlos en el
   * formulario recién precargado. Se limpia al cerrar el modal.
   */
  readonly scanUnverified = signal<string[]>([]);
  /** Tipo de documento del formulario, como signal para que la plantilla reaccione. */
  readonly selectedDocType = signal<PlatformResolutionDocumentType>('sales_invoice');
  /** Serie interna de nota: sin N° de resolución, ClTec ni validación DIAN. */
  readonly isNoteType = computed(() => this.isNoteDocType(this.selectedDocType()));
  /** Guardado/activación en espera de confirmación por conflicto de serie de notas. */
  readonly pendingConfirm = signal<{ message: string; proceed: () => void } | null>(null);
  /** Última siembra de defaults de nota, para no pisar lo que el usuario editó. */
  private noteSeed: {
    prefix: string;
    range_from: number;
    range_to: number;
    valid_from: string;
    valid_to: string;
  } | null = null;

  readonly documentTypeOptions = RESOLUTION_DOCUMENT_TYPE_OPTIONS;
  readonly environmentOptions = ENVIRONMENT_OPTIONS;
  readonly docTypeLabel = resolutionDocTypeLabel;

  /** Las archivadas no cuentan en los KPI: ya no son parte de la numeración. */
  private readonly liveResolutions = computed(() =>
    this.store.resolutions().filter((r) => !r.archived_at),
  );
  readonly totalCount = computed(() => this.liveResolutions().length);
  readonly activeCount = computed(
    () => this.liveResolutions().filter((r) => r.is_active).length,
  );
  readonly salesCount = computed(
    () =>
      this.liveResolutions().filter((r) => r.document_type === 'sales_invoice')
        .length,
  );
  readonly supportCount = computed(
    () =>
      this.liveResolutions().filter(
        (r) => r.document_type === 'support_document',
      ).length,
  );

  /** Filas decoradas con `in_use` (la que toma el generador) para tabla y cards. */
  readonly rows = computed(() => {
    const inUse = this.store.inUse();
    return this.store.resolutions().map((r) => ({
      ...r,
      in_use: !r.archived_at && isResolutionInUse(r, inUse),
      state_label: r.archived_at ? 'Archivada' : r.is_active ? 'Activa' : 'Inactiva',
    }));
  });

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
      key: 'in_use',
      label: 'Numeración',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { 'En uso': '#2563eb', '—': '#cbd5e1' },
      },
      transform: (v) => (v ? 'En uso' : '—'),
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
    {
      // Aparece solo en filas archivadas (con «Ver archivadas» encendido).
      key: 'archived_at',
      label: 'Archivada',
      transform: (v) => (v ? formatArchivedAt(v as string) : ''),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'prefix',
    subtitleKey: 'document_type',
    subtitleTransform: (v) =>
      this.docTypeLabel(v as PlatformResolutionDocumentType),
    badgeKey: 'state_label',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        Activa: 'success',
        Inactiva: 'secondary',
        Archivada: 'secondary',
      },
    },
    badgeTransform: (v) => String(v ?? ''),
    detailKeys: [
      {
        key: 'in_use',
        label: 'Numeración',
        icon: 'hash',
        transform: (v) => (v ? 'En uso' : '-'),
      },
    ],
    footerKey: 'current_number',
    footerLabel: 'Consecutivo actual',
    footerTransform: (v, item: PlatformResolution) =>
      `${item.current_number} / ${item.range_to}`,
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      show: (item: PlatformResolution) => !item.archived_at,
      action: (item: PlatformResolution) => this.openEdit(item),
    },
    {
      label: 'Alternar estado',
      icon: 'power',
      show: (item: PlatformResolution) => !item.archived_at,
      action: (item: PlatformResolution) => this.toggleActive(item),
    },
    {
      // «Ya no la voy a usar más». Las resoluciones DIAN nunca se borran.
      label: 'Archivar',
      icon: 'archive',
      variant: 'danger',
      show: (item: PlatformResolution) => !item.archived_at,
      action: (item: PlatformResolution) => this.askArchive(item),
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
    this.form.controls.document_type.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        this.selectedDocType.set(type);
        if (!this.editing()) this.applyNoteDefaults(type);
      });

    this.store.loadResolutions();
    this.store.loadInUse();
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
    this.noteSeed = null;
    this.selectedDocType.set('sales_invoice');
    this.setRangoFinalMin(2);
    this.formInvalid.set(this.form.invalid);
    this.modalOpen.set(true);
  }

  /** Abre el alta con el tipo indicado (CTA «Crear serie» de la tarjeta). */
  onCreateSeries(type: FiscalDocumentType): void {
    if (type !== 'credit_note' && type !== 'debit_note') return;
    this.openModal();
    this.form.controls.document_type.setValue(type);
    this.formInvalid.set(this.form.invalid);
  }

  private isNoteDocType(type: string | null | undefined): boolean {
    return type === 'credit_note' || type === 'debit_note';
  }

  private setRangoFinalMin(min: number): void {
    const ctrl = this.form.controls.rango_final;
    ctrl.setValidators([Validators.required, Validators.min(min)]);
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Al elegir una nota en el alta se siembran prefijo, rango y vigencia de la
   * serie interna. Solo se pisan los campos vacíos o que aún valen la siembra
   * anterior; al volver a un tipo DIAN se retira lo sembrado.
   */
  private applyNoteDefaults(type: PlatformResolutionDocumentType): void {
    const c = this.form.controls;
    const prev = this.noteSeed;
    const untouched = (cur: unknown, was: unknown) =>
      cur === null || cur === '' || cur === undefined || (prev !== null && cur === was);

    if (!this.isNoteDocType(type)) {
      if (prev) {
        if (c.prefix.value === prev.prefix) c.prefix.setValue(null);
        if (c.rango_inicial.value === prev.range_from) c.rango_inicial.setValue(null);
        if (c.rango_final.value === prev.range_to) c.rango_final.setValue(null);
        if (c.valid_from.value === prev.valid_from) c.valid_from.setValue(null);
        if (c.valid_to.value === prev.valid_to) c.valid_to.setValue(null);
      }
      this.noteSeed = null;
      return;
    }

    const now = new Date();
    const end = new Date(now);
    end.setFullYear(now.getFullYear() + INTERNAL_SERIES_FORM_VALIDITY_YEARS);
    const seed = {
      prefix: requirementsFor(type as FiscalDocumentType).internal_series_prefix ?? '',
      range_from: 1,
      range_to: INTERNAL_SERIES_INITIAL_RANGE,
      valid_from: toLocalDateString(now),
      valid_to: toLocalDateString(end),
    };
    if (untouched(c.prefix.value, prev?.prefix)) c.prefix.setValue(seed.prefix);
    if (untouched(c.rango_inicial.value, prev?.range_from)) c.rango_inicial.setValue(seed.range_from);
    if (untouched(c.rango_final.value, prev?.range_to)) c.rango_final.setValue(seed.range_to);
    if (untouched(c.valid_from.value, prev?.valid_from)) c.valid_from.setValue(seed.valid_from);
    if (untouched(c.valid_to.value, prev?.valid_to)) c.valid_to.setValue(seed.valid_to);
    this.noteSeed = seed;
    this.formInvalid.set(this.form.invalid);
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

    this.noteSeed = null;
    this.selectedDocType.set(row.document_type);
    this.form.enable({ emitEvent: false });
    this.setRangoFinalMin(this.isLocked(row) ? Math.max(2, row.current_number) : 2);
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
    const isNote = this.isNoteDocType(value.document_type);
    const dto: CreatePlatformResolutionDto = {
      prefix: value.prefix!.trim(),
      document_type: value.document_type,
      environment: value.environment,
      rango_inicial: Number(value.rango_inicial),
      rango_final: Number(value.rango_final),
    };
    // Serie interna de nota: no hay N° de resolución, fecha ni ClTec que enviar.
    if (!isNote) {
      if (value.technical_key?.trim()) {
        dto.technical_key = value.technical_key.trim();
      }
      if (value.resolution_number?.trim()) {
        dto.resolution_number = value.resolution_number.trim();
      }
      if (value.resolution_date) dto.resolution_date = value.resolution_date;
    }
    if (value.valid_from) dto.valid_from = value.valid_from;
    if (value.valid_to) dto.valid_to = value.valid_to;

    const send = () => this.sendCreate(dto);
    if (isNote) {
      const conflicts = findNoteSeriesConflicts(this.liveRows(), {
        id: null,
        document_type: dto.document_type,
      });
      if (conflicts.length > 0) {
        this.pendingConfirm.set({
          message: noteSeriesActivationMessage(dto.prefix, conflicts),
          proceed: send,
        });
        return;
      }
    }
    send();
  }

  private liveRows(): PlatformResolution[] {
    return this.store.resolutions().filter((r) => !r.archived_at);
  }

  confirmPending(): void {
    const pending = this.pendingConfirm();
    this.pendingConfirm.set(null);
    pending?.proceed();
  }

  /** Tras guardar: avisa si el backend desactivó otra serie de notas. */
  private afterWrite(res: unknown, message: string): void {
    const deactivated = extractDeactivatedResolutionIds(res);
    this.toast.success(message, 'Plataforma');
    if (deactivated.length > 0) {
      this.toast.info(deactivatedResolutionsToast(deactivated.length), 'Plataforma');
    }
    // Forzado: las otras pestañas ofrecen estas resoluciones en sus selectores
    // y quedarían mostrando la lista vieja. También recarga «Numeración vigente».
    this.store.loadResolutions(true);
  }

  private sendCreate(dto: CreatePlatformResolutionDto): void {
    this.saving.set(true);
    this.fiscal
      .createResolution(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.closeModal();
          this.afterWrite(res, 'Resolución DIAN creada');
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
        next: (res) => {
          this.saving.set(false);
          this.closeModal();
          this.afterWrite(res, 'Resolución DIAN actualizada');
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
   * pause a resolution reversibly. To retire it for good use «Archivar»:
   * resolutions are fiscal evidence and are never deleted.
   */
  toggleActive(row: PlatformResolution): void {
    if (this.togglingId() !== null) return;
    if (!row.is_active && isNoteSeriesType(row.document_type)) {
      const conflicts = findNoteSeriesConflicts(this.liveRows(), {
        id: row.id,
        document_type: row.document_type,
        accounting_entity_id: row.accounting_entity_id,
      });
      if (conflicts.length > 0) {
        this.pendingConfirm.set({
          message: noteSeriesActivationMessage(row.prefix, conflicts),
          proceed: () => this.sendToggle(row),
        });
        return;
      }
    }
    this.sendToggle(row);
  }

  private sendToggle(row: PlatformResolution): void {
    this.togglingId.set(row.id);
    this.fiscal
      .updateResolution(row.id, { is_active: !row.is_active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.togglingId.set(null);
          this.afterWrite(
            res,
            row.is_active ? 'Resolución desactivada' : 'Resolución activada',
          );
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

  onToggleArchived(value: boolean): void {
    this.store.setIncludeArchived(value);
  }

  askArchive(row: PlatformResolution): void {
    this.archiveError.set(null);
    this.archiveRequirePrefix.set(false);
    this.archiveBusy.set(false);
    this.pendingArchive.set(row);
  }

  cancelArchive(): void {
    if (this.archiveBusy()) return;
    this.closeArchive();
  }

  private closeArchive(): void {
    this.pendingArchive.set(null);
    this.archiveBusy.set(false);
    this.archiveError.set(null);
    this.archiveRequirePrefix.set(false);
  }

  confirmArchive(row: PlatformResolution, replacementPrefix: string | undefined): void {
    if (this.archiveBusy()) return;
    this.archiveBusy.set(true);
    this.archiveError.set(null);
    this.fiscal
      .archiveResolution(row.id, replacementPrefix)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.closeArchive();
          this.toast.success(
            res?.replacement_resolution_id
              ? 'Resolución DIAN archivada. Se creó la serie de reemplazo.'
              : 'Resolución DIAN archivada',
            'Plataforma',
          );
          this.store.loadResolutions(true);
        },
        error: (err: unknown) => {
          this.archiveBusy.set(false);
          const { errorCode, userMessage } = parseApiError(err);
          // 015: es la serie de notas en uso; hay que indicar la serie nueva.
          if (errorCode === 'INVOICING_RESOLUTION_015') {
            this.archiveRequirePrefix.set(true);
          }
          this.archiveError.set(userMessage);
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
