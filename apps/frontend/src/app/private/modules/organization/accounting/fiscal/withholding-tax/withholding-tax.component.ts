import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgCreateConceptDto,
  OrgWithholdingConcept,
  WithholdingStats,
} from './interfaces/org-withholding.interface';
import { OrgWithholdingTaxService } from './services/org-withholding-tax.service';
import { OrgWithholdingConceptFormModalComponent } from './components/org-withholding-concept-form-modal.component';

/**
 * Organization-scoped withholding-tax view.
 *
 * Mirrors the store withholding-tax UX (stats + concepts table) but reads the
 * shell-synced `?store_id` from the URL and fetches through the org service so
 * the org accounting module reaches consolidated or per-store data.
 *
 * Adds full concept CRUD: a "Nuevo Concepto" header button plus per-row edit
 * and delete table actions, both wired through the shared modal and refreshing
 * the list after each mutation. Each create/update sends the fiscal-typing
 * fields (`withholding_type`, `supplier_type_filter`, `account_code`).
 */
@Component({
  selector: 'vendix-org-withholding-tax',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    OrgWithholdingConceptFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Conceptos Activos"
          [value]="stats()?.active_concepts ?? activeConceptsCount()"
          smallText="Conceptos de retención"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="UVT Vigente"
          [value]="formatCurrency(stats()?.current_uvt || 0)"
          smallText="Valor unidad tributaria"
          iconName="calculator"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Ret. del Mes"
          [value]="formatCurrency(stats()?.month_withholdings || 0)"
          smallText="Practicadas este mes"
          iconName="trending-down"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Ret. del Año"
          [value]="formatCurrency(stats()?.year_withholdings || 0)"
          smallText="Acumulado anual"
          iconName="calendar"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar la retención en la fuente">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                Conceptos de Retención ({{ filteredConcepts().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Conceptos de retención en la fuente del alcance fiscal seleccionado.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar código o nombre..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />
              <app-button variant="primary" size="sm" (clicked)="openCreateModal()">
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Nuevo Concepto
              </app-button>
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filteredConcepts()"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [actions]="tableActions"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin conceptos"
            emptyMessage="Sin conceptos"
            emptyDescription="No hay conceptos de retención para el alcance fiscal seleccionado."
            emptyIcon="file-text"
            [showEmptyAction]="false"
          />
        </div>
      </app-card>

      <app-org-withholding-concept-form-modal
        [isOpen]="isModalOpen()"
        [concept]="selectedConcept()"
        [isSubmitting]="isSubmitting()"
        (cancel)="closeModal()"
        (save)="onSaveConcept($event)"
      ></app-org-withholding-concept-form-modal>
    </div>
  `,
})
export class OrgWithholdingTaxComponent {
  private readonly service = inject(OrgWithholdingTaxService);
  private readonly errors = inject(ApiErrorService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  private readonly storeId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('store_id'))),
    { initialValue: this.route.snapshot.queryParamMap.get('store_id') },
  );

  readonly loading = signal(true);
  readonly concepts = signal<OrgWithholdingConcept[]>([]);
  readonly stats = signal<WithholdingStats | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');

  readonly isModalOpen = signal(false);
  readonly selectedConcept = signal<OrgWithholdingConcept | null>(null);
  readonly isSubmitting = signal(false);

  readonly activeConceptsCount = computed(
    () => this.concepts().filter((concept) => concept.is_active).length,
  );

  readonly filteredConcepts = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    if (!search) return this.concepts();
    return this.concepts().filter((concept) =>
      [concept.code, concept.name, concept.applies_to]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search)),
    );
  });

  readonly tableColumns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, priority: 1, cellClass: () => 'font-mono' },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'rate',
      label: 'Tasa %',
      align: 'right',
      sortable: true,
      priority: 1,
      transform: (value) => `${(Number(value) * 100).toFixed(1)}%`,
    },
    {
      key: 'withholding_type',
      label: 'Tipo',
      priority: 2,
      transform: (value) => this.withholdingTypeLabel(value),
    },
    {
      key: 'min_uvt_threshold',
      label: 'Umbral UVT',
      align: 'right',
      priority: 3,
      defaultValue: '0',
    },
    {
      key: 'applies_to',
      label: 'Aplica a',
      priority: 3,
      cellClass: () => 'capitalize',
      defaultValue: '—',
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
      transform: (value) => (value ? 'Activo' : 'Inactivo'),
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: OrgWithholdingConcept) => this.openEditModal(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: OrgWithholdingConcept) => this.confirmDelete(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'status',
      colorMap: { true: 'success', false: 'default' },
    },
    badgeTransform: (value) => (value ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'rate', label: 'Tasa', icon: 'percent', transform: (value) => `${(Number(value) * 100).toFixed(1)}%` },
      { key: 'withholding_type', label: 'Tipo', icon: 'tag', transform: (value) => this.withholdingTypeLabel(value) },
      { key: 'min_uvt_threshold', label: 'Umbral UVT', icon: 'calculator', transform: (value) => String(value ?? 0) },
      { key: 'applies_to', label: 'Aplica a', icon: 'tag', transform: (value) => String(value || '—') },
    ],
  };

  constructor() {
    // React to store_id changes from the shell-synced query param.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  // ─── Data loading ──────────────────────────────────────────────────────────
  private reload(): void {
    this.loadConcepts();
    this.loadStats();
  }

  private currentQuery(): Record<string, any> | undefined {
    const storeId = this.storeId();
    return storeId ? { store_id: storeId } : undefined;
  }

  private loadConcepts(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .getConcepts(this.currentQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.concepts.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los conceptos de retención.'),
          );
          this.concepts.set([]);
          this.loading.set(false);
        },
      });
  }

  private loadStats(): void {
    this.service
      .getStats(this.currentQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.stats.set(res?.data ?? null),
        error: () => this.stats.set(null),
      });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }

  withholdingTypeLabel(value: unknown): string {
    switch (value) {
      case 'retefuente':
        return 'Retefuente';
      case 'reteiva':
        return 'ReteIVA';
      case 'reteica':
        return 'ReteICA';
      default:
        return '—';
    }
  }

  // ─── Modal CRUD ──────────────────────────────────────────────────────────────
  openCreateModal(): void {
    this.selectedConcept.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(concept: OrgWithholdingConcept): void {
    this.selectedConcept.set(concept);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.selectedConcept.set(null);
  }

  onSaveConcept(payload: OrgCreateConceptDto): void {
    this.isSubmitting.set(true);
    const selected = this.selectedConcept();
    const query = this.currentQuery();
    const obs = selected
      ? this.service.updateConcept(selected.id, payload, query)
      : this.service.createConcept(payload, query);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          selected
            ? 'Concepto actualizado correctamente'
            : 'Concepto creado correctamente',
        );
        this.isSubmitting.set(false);
        this.closeModal();
        this.reload();
      },
      error: (err) => {
        this.toast.error(
          this.errors.humanize(err, 'No se pudo guardar el concepto de retención.'),
        );
        this.isSubmitting.set(false);
      },
    });
  }

  confirmDelete(concept: OrgWithholdingConcept): void {
    this.dialog
      .confirm({
        title: 'Eliminar concepto',
        message: `¿Está seguro de que desea eliminar "${concept.name}"?`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) this.deleteConcept(concept);
      });
  }

  private deleteConcept(concept: OrgWithholdingConcept): void {
    this.service
      .deleteConcept(concept.id, this.currentQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Concepto eliminado correctamente');
          this.reload();
        },
        error: (err) => {
          this.toast.error(
            this.errors.humanize(err, 'No se pudo eliminar el concepto.'),
          );
        },
      });
  }
}
