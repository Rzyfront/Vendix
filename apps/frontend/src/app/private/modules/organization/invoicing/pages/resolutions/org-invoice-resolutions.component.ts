import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  FilterConfig,
  FilterValues,
  InputComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  SaveRequirementsModalComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { FiscalRequirementsService } from '../../../../../../shared/services/fiscal-requirements.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  ResolutionsInUseCardComponent,
  deactivatedResolutionsToast,
  extractDeactivatedResolutionIds,
  formatArchivedAt,
  isResolutionInUse,
  ResolutionArchiveModalComponent,
  type ResolutionsInUseResponse,
} from '../../../../../../shared/components/dian';
import { OrgFiscalScopeSelectorComponent } from '../../../shared/components/org-fiscal-scope-selector.component';
import {
  OrgInvoicingService,
  OrgResolutionPayload,
  OrgResolutionRow,
} from '../../services/org-invoicing.service';

@Component({
  selector: 'vendix-org-invoice-resolutions',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    InputComponent,
    InputsearchComponent,
    ModalComponent,
    OptionsDropdownComponent,
    ReactiveFormsModule,
    ResponsiveDataViewComponent,
    SaveRequirementsModalComponent,
    StatsComponent,
    OrgFiscalScopeSelectorComponent,
    ResolutionsInUseCardComponent,
    ResolutionArchiveModalComponent,
    ToggleComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-org-fiscal-scope-selector
        [selectedStoreId]="selectedStoreId()"
        [showHeader]="false"
        (storeChange)="onFiscalStoreChange($event)"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Resoluciones"
          [value]="rows().length"
          smallText="Registros DIAN"
          iconName="hash"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Activas"
          [value]="activeCount()"
          smallText="Disponibles para numeración"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Facturas"
          [value]="invoiceCount()"
          smallText="Documentos asociados"
          iconName="receipt"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Por vencer"
          [value]="expiringCount()"
          smallText="Vencen en 30 días"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar resoluciones">
          {{ msg }}
        </app-alert-banner>
      }

      <div class="mb-3">
        <app-resolutions-in-use-card
          [data]="inUse()"
          [loading]="inUseLoading()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Resoluciones ({{ filteredRows().length }})
            </h2>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-toggle
                label="Ver archivadas"
                ariaLabel="Ver resoluciones archivadas"
                [checked]="showArchived()"
                (toggled)="onToggleArchived($event)"
              />
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar resolución, prefijo o tienda..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions()"
                [isLoading]="loading()"
                triggerLabel="Filtros"
                triggerIcon="filter"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              />

            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filteredRows()"
            [columns]="tableColumns"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin resoluciones"
            emptyMessage="Sin resoluciones"
            emptyDescription="No hay resoluciones para el alcance fiscal seleccionado."
            emptyIcon="hash"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
          />
        </div>
      </app-card>

      <app-modal
        [isOpen]="resolutionModalOpen()"
        (isOpenChange)="resolutionModalOpen.set($event)"
        (cancel)="closeResolutionModal()"
        [title]="editingResolution() ? 'Editar resolución' : 'Nueva resolución'"
        size="md"
      >
        <form
          class="space-y-4 p-4"
          [formGroup]="resolutionForm"
          (ngSubmit)="submitResolution()"
        >
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <app-input
              label="Número de resolución"
              formControlName="resolution_number"
              placeholder="18764000001"
              [required]="true"
            />
            <app-input
              label="Prefijo"
              formControlName="prefix"
              placeholder="FE"
              [required]="true"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <app-input
              label="Rango desde"
              type="number"
              formControlName="range_from"
              [required]="true"
            />
            <app-input
              label="Rango hasta"
              type="number"
              formControlName="range_to"
              [required]="true"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <app-input
              label="Fecha resolución"
              type="date"
              formControlName="resolution_date"
              [required]="true"
            />
            <app-input
              label="Válida desde"
              type="date"
              formControlName="valid_from"
              [required]="true"
            />
            <app-input
              label="Válida hasta"
              type="date"
              formControlName="valid_to"
              [required]="true"
            />
          </div>

          <app-input
            label="Clave técnica"
            formControlName="technical_key"
            placeholder="Opcional"
          />
        </form>

        <div slot="footer" class="flex items-center justify-end gap-3 border-t border-border bg-surface p-3">
          <app-button variant="outline" (clicked)="closeResolutionModal()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            [loading]="savingResolution()"
            [disabled]="resolutionForm.invalid || savingResolution()"
            (clicked)="submitResolution()"
          >
            {{ editingResolution() ? 'Actualizar' : 'Crear' }}
          </app-button>
        </div>
      </app-modal>

      <!-- Archivar (las resoluciones no se borran) -->
      @if (pendingArchive(); as row) {
        <vendix-resolution-archive-modal
          [resolution]="row"
          [busy]="archiveBusy()"
          [requirePrefix]="archiveRequirePrefix()"
          [errorMessage]="archiveError()"
          (confirmed)="confirmArchive(row, $event)"
          (cancelled)="cancelArchive()"
        />
      }

      <!-- Modal de requisitos fiscales: explica un 4xx fiscal que bloquea
           crear/actualizar/archivar una resolucion DIAN con su CTA. -->
      <app-save-requirements-modal
        [(isOpen)]="fiscalReq.isOpen"
        [requirements]="fiscalReq.requirements()"
        (action)="fiscalReq.handleAction($event)"
      />
    </div>
  `,
})
export class OrgInvoiceResolutionsComponent {
  private readonly service = inject(OrgInvoicingService);
  private readonly auth = inject(AuthFacade);
  private readonly errors = inject(ApiErrorService);
  readonly fiscalReq = inject(FiscalRequirementsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly loading = signal(false);
  readonly savingResolution = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly resolutionModalOpen = signal(false);
  readonly editingResolution = signal<OrgResolutionRow | null>(null);
  readonly selectedStoreId = signal<number | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly rows = signal<OrgResolutionRow[]>([]);
  readonly inUse = signal<ResolutionsInUseResponse | null>(null);
  readonly inUseLoading = signal(false);
  readonly showArchived = signal(false);
  readonly pendingArchive = signal<OrgResolutionRow | null>(null);
  readonly archiveBusy = signal(false);
  readonly archiveError = signal<string | null>(null);
  readonly archiveRequirePrefix = signal(false);

  readonly requiresStoreSelector = computed(() => this.auth.fiscalScope() === 'STORE');
  /** Las archivadas no cuentan en los stats: ya no son parte de la numeración. */
  private readonly liveRows = computed(() => this.rows().filter((row) => !row.archived_at));
  readonly activeCount = computed(() => this.liveRows().filter((row) => row.is_active).length);
  readonly invoiceCount = computed(() =>
    this.liveRows().reduce((total, row) => total + Number(row._count?.invoices || 0), 0),
  );
  readonly expiringCount = computed(() => {
    const now = new Date();
    const limit = new Date(now);
    limit.setDate(limit.getDate() + 30);
    return this.liveRows().filter((row) => {
      if (!row.valid_to || !row.is_active) return false;
      const validTo = new Date(row.valid_to);
      return validTo >= now && validTo <= limit;
    }).length;
  });

  readonly filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const state = this.filterValues()['state'] as string | undefined;
    const inUse = this.inUse();
    // La tabla puede mezclar entidades: `isResolutionInUse` solo marca las de
    // la `accounting_entity_id` devuelta cuando la fila la trae.
    const decorated = this.rows().map((row) => ({
      ...row,
      in_use: !row.archived_at && isResolutionInUse(row, inUse),
      state_label: row.archived_at ? 'Archivada' : row.is_active ? 'Activa' : 'Inactiva',
    }));
    return decorated.filter((row) => {
      if (state === 'active' && !row.is_active) return false;
      if (state === 'inactive' && row.is_active) return false;
      if (!search) return true;
      return [
        row.resolution_number,
        row.prefix,
        row.store?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'active', label: 'Activas' },
        { value: 'inactive', label: 'Inactivas' },
      ],
    },
  ];

  readonly dropdownActions = computed(() => [
    {
      label: 'Crear resolución',
      icon: 'plus',
      action: 'create-resolution',
      variant: 'primary' as const,
      disabled: this.requiresStoreSelector() && !this.selectedStoreId(),
    },
    { label: 'Configurar DIAN', icon: 'settings', action: 'dian-config', variant: 'outline' as const },
  ]);

  readonly tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      variant: 'secondary',
      show: (row: OrgResolutionRow) => !row.archived_at,
      action: (row: OrgResolutionRow) => this.openEditModal(row),
    },
    {
      // «Ya no la voy a usar más». Las resoluciones DIAN nunca se borran.
      label: 'Archivar',
      icon: 'archive',
      variant: 'danger',
      show: (row: OrgResolutionRow) => !row.archived_at,
      action: (row: OrgResolutionRow) => this.askArchive(row),
    },
    {
      label: 'Config DIAN',
      icon: 'settings',
      variant: 'secondary',
      action: () => this.onActionClick('dian-config'),
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'prefix', label: 'Prefijo', priority: 1 },
    { key: 'resolution_number', label: 'Resolución', priority: 1 },
    { key: 'store.name', label: 'Tienda', priority: 2, defaultValue: 'Organización' },
    {
      key: 'current_number',
      label: 'Consecutivo',
      align: 'right',
      priority: 2,
      transform: (value, row) => `${value || 0} / ${row?.range_to || 0}`,
    },
    {
      key: 'valid_to',
      label: 'Vigente hasta',
      align: 'center',
      priority: 2,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'in_use',
      label: 'Numeración',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { 'En uso': '#2563eb', '—': '#cbd5e1' },
      },
      transform: (value) => (value ? 'En uso' : '—'),
    },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { true: 'success', false: 'default' },
      },
      transform: (value, row) =>
        row?.archived_at ? 'Archivada' : value ? 'Activa' : 'Inactiva',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'resolution_number',
    titleTransform: (item) => `${item?.prefix || ''} ${item?.resolution_number || ''}`.trim(),
    subtitleTransform: (item) => item?.store?.name || 'Organización',
    avatarFallbackIcon: 'hash',
    avatarShape: 'square',
    badgeKey: 'state_label',
    badgeConfig: {
      type: 'status',
      colorMap: { Activa: 'success', Inactiva: 'default', Archivada: 'default' },
    },
    badgeTransform: (value) => String(value ?? ''),
    detailKeys: [
      { key: 'in_use', label: 'Numeración', icon: 'hash', transform: (value) => (value ? 'En uso' : '-') },
      { key: 'current_number', label: 'Consecutivo', icon: 'hash', transform: (value, item) => `${value || 0} / ${item?.range_to || 0}` },
      { key: 'valid_to', label: 'Vigente hasta', icon: 'calendar', transform: (value) => this.formatDate(value) },
      { key: 'archived_at', label: 'Archivada', icon: 'archive', transform: (value) => (value ? formatArchivedAt(value) : '-') },
      { key: '_count.invoices', label: 'Facturas', icon: 'receipt', transform: (value) => String(value || 0) },
    ],
  };

  readonly resolutionForm = this.fb.group({
    resolution_number: ['', [Validators.required, Validators.maxLength(100)]],
    prefix: ['', [Validators.required, Validators.maxLength(10)]],
    range_from: [null as number | null, [Validators.required, Validators.min(1)]],
    range_to: [null as number | null, [Validators.required, Validators.min(1)]],
    resolution_date: ['', Validators.required],
    valid_from: ['', Validators.required],
    valid_to: ['', Validators.required],
    technical_key: [''],
  });

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const storeId = params.get('store_id');
        this.selectedStoreId.set(storeId ? Number(storeId) : null);
        this.loadData();
      });
  }

  onFiscalStoreChange(storeId: number | null): void {
    if (storeId === this.selectedStoreId()) return;
    this.updateQuery({ store_id: storeId || null });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
  }

  onActionClick(action: string): void {
    if (action === 'create-resolution') {
      this.openCreateModal();
      return;
    }

    this.router.navigate([`../${action}`], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
    });
  }

  openCreateModal(): void {
    this.editingResolution.set(null);
    this.resolutionForm.reset({
      resolution_number: '',
      prefix: '',
      range_from: null,
      range_to: null,
      resolution_date: '',
      valid_from: '',
      valid_to: '',
      technical_key: '',
    });
    this.resolutionModalOpen.set(true);
  }

  openEditModal(row: OrgResolutionRow): void {
    this.editingResolution.set(row);
    this.resolutionForm.reset({
      resolution_number: row.resolution_number,
      prefix: row.prefix,
      range_from: row.range_from,
      range_to: row.range_to,
      resolution_date: this.toDateInput(row.resolution_date),
      valid_from: this.toDateInput(row.valid_from),
      valid_to: this.toDateInput(row.valid_to),
      technical_key: row.technical_key || '',
    });
    this.resolutionModalOpen.set(true);
  }

  closeResolutionModal(): void {
    this.resolutionModalOpen.set(false);
    this.savingResolution.set(false);
  }

  submitResolution(): void {
    if (this.resolutionForm.invalid) {
      this.resolutionForm.markAllAsTouched();
      return;
    }

    const value = this.resolutionForm.getRawValue();
    const payload: OrgResolutionPayload = {
      store_id: this.selectedStoreId(),
      resolution_number: value.resolution_number!,
      resolution_date: value.resolution_date!,
      prefix: value.prefix!,
      range_from: Number(value.range_from),
      range_to: Number(value.range_to),
      valid_from: value.valid_from!,
      valid_to: value.valid_to!,
      technical_key: value.technical_key || null,
      is_active: true,
    };
    const editing = this.editingResolution();
    const request = editing
      ? this.service.updateResolution(editing.id, payload)
      : this.service.createResolution(payload);

    this.savingResolution.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.closeResolutionModal();
        const deactivated = extractDeactivatedResolutionIds(response);
        if (deactivated.length > 0) {
          this.toast.info(deactivatedResolutionsToast(deactivated.length));
        }
        this.loadData();
      },
      error: (err) => {
        this.savingResolution.set(false);
        // Restriccion fiscal reconocida: explicarla con el modal de
        // requisitos (mismo CTA que el wizard) en lugar del banner crudo.
        if (this.fiscalReq.presentFiscalError(err)) {
          return;
        }
        this.errorMessage.set(
          this.errors.humanize(err, 'No se pudo guardar la resolución.'),
        );
      },
    });
  }

  onToggleArchived(value: boolean): void {
    this.showArchived.set(value);
    this.loadData();
  }

  askArchive(row: OrgResolutionRow): void {
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

  confirmArchive(row: OrgResolutionRow, replacementPrefix: string | undefined): void {
    this.archiveBusy.set(true);
    this.archiveError.set(null);

    this.service
      .archiveResolution(row.id, replacementPrefix)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.closeArchive();
          this.toast.success(
            res.data?.replacement_resolution_id
              ? 'Resolución archivada. Se creó la serie de reemplazo.'
              : 'Resolución archivada',
          );
          this.loadData();
        },
        error: (err) => {
          this.archiveBusy.set(false);
          // Restriccion fiscal reconocida: explicarla con el modal de requisitos.
          if (this.fiscalReq.presentFiscalError(err)) {
            this.closeArchive();
            return;
          }
          const { errorCode } = parseApiError(err);
          // 015: es la serie de notas en uso; hay que indicar la serie nueva.
          if (errorCode === 'INVOICING_RESOLUTION_015') {
            this.archiveRequirePrefix.set(true);
          }
          this.archiveError.set(
            this.errors.humanize(err, 'No se pudo archivar la resolución.'),
          );
        },
      });
  }

  hasActiveFilters(): boolean {
    return !!(this.searchTerm() || this.filterValues()['state']);
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  private toDateInput(value: string | null | undefined): string {
    return value ? value.slice(0, 10) : '';
  }

  private loadData(): void {
    if (this.requiresStoreSelector() && !this.selectedStoreId()) {
      this.rows.set([]);
      this.inUse.set(null);
      this.loading.set(false);
      return;
    }

    this.loadInUse();

    this.loading.set(true);
    this.errorMessage.set(null);

    this.service
      .getResolutions({
        ...(this.selectedStoreId() ? { store_id: this.selectedStoreId() } : {}),
        ...(this.showArchived() ? { include_archived: true } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las resoluciones.'),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  private loadInUse(): void {
    this.inUseLoading.set(true);
    this.service
      .getResolutionsInUse(this.selectedStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.inUse.set(res.data ?? null);
          this.inUseLoading.set(false);
        },
        error: () => {
          this.inUse.set(null);
          this.inUseLoading.set(false);
        },
      });
  }

  private updateQuery(queryParams: Record<string, string | number | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
