import { Component, OnInit, inject, signal, computed, model, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  EmptyStateComponent,
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  IconComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  ToastService,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { PartnerMarginsService } from '../../services/partner-margins.service';
import {
  PartnerPlanOverride,
  CreatePlanOverrideDto,
  UpdatePlanOverrideDto,
} from '../../interfaces/org-subscription.interface';

@Component({
  selector: 'app-partner-margins',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
  ],
  template: `
    <div class="w-full">
      <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
             md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Margenes Partner ({{ overrides().length }})
          </h2>
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar plan..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
            <app-button variant="primary" size="sm" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              <span class="hidden sm:inline">Nuevo Override</span>
            </app-button>
          </div>
        </div>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading() && overrides().length === 0) {
        <app-empty-state
          icon="percent"
          title="Sin overrides de plan"
          description="Crea un override para personalizar márgenes"
          actionButtonText="Crear Override"
          (actionClick)="openCreateModal()"
        ></app-empty-state>
      }

      @if (!loading() && overrides().length > 0) {
        <div class="bg-surface rounded-card shadow-card border border-border md:min-h-[600px]">
          <div class="p-2 md:p-4">
            <app-responsive-data-view
              [data]="filteredOverrides()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="loading()"
            ></app-responsive-data-view>
          </div>
        </div>
      }

      <app-modal
        [(isOpen)]="isModalOpen"
        title="{{ editingOverride() ? 'Editar Override' : 'Nuevo Override' }}"
        size="md"
        (cancel)="closeModal()"
      >
        <div class="p-4 space-y-4">
          <form [formGroup]="form">
            <app-input
              label="Nombre Personalizado"
              formControlName="custom_name"
              [control]="form.get('custom_name')"
            ></app-input>
            <div class="mt-4">
              <app-input
                label="Margen (%)"
                formControlName="margin_pct"
                [control]="form.get('margin_pct')"
                [required]="true"
                type="number"
              ></app-input>
            </div>
          </form>
        </div>
        <div slot="footer" class="flex gap-3 justify-end w-full">
          <app-button variant="ghost" (clicked)="closeModal()">Cancelar</app-button>
          <app-button variant="primary" [loading]="submitting()" (clicked)="onSubmit()">
            {{ editingOverride() ? 'Actualizar' : 'Crear' }}
          </app-button>
        </div>
      </app-modal>
    </div>
  `,
})
export class PartnerMarginsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private marginsService = inject(PartnerMarginsService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);

  readonly overrides = signal<PartnerPlanOverride[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly isModalOpen = model<boolean>(false);
  readonly editingOverride = signal<PartnerPlanOverride | null>(null);
  readonly searchTerm = signal('');
  readonly filteredOverrides = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.overrides();
    if (!term) return items;
    return items.filter(
      (o) =>
        o.base_plan_name.toLowerCase().includes(term) ||
        (o.custom_name || '').toLowerCase().includes(term),
    );
  });

  form = this.fb.group({
    base_plan_id: ['', Validators.required],
    custom_name: [''],
    margin_pct: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
  });

  columns: TableColumn[] = [
    { key: 'base_plan_name', label: 'Plan Base', sortable: true, priority: 1 },
    { key: 'custom_name', label: 'Nombre Custom', priority: 2, defaultValue: '-' },
    {
      key: 'margin_pct',
      label: 'Margen',
      sortable: true,
      align: 'center',
      priority: 1,
      transform: (val: any) => `${val}%`,
    },
    {
      key: 'effective_price',
      label: 'Precio Efectivo',
      align: 'right',
      priority: 1,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      badge: true,
      priority: 2,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (val: boolean) => (val ? 'active' : 'inactive'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'base_plan_name',
    subtitleKey: 'custom_name',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => (val ? 'active' : 'inactive'),
    footerKey: 'effective_price',
    footerLabel: 'Precio',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'margin_pct',
        label: 'Margen',
        icon: 'percent',
        transform: (val: any) => `${val}%`,
      },
    ],
  };

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (item: PartnerPlanOverride) => this.openEditModal(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: PartnerPlanOverride) => this.deleteOverride(item),
    },
  ];

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadOverrides();
  }

  private loadOverrides(): void {
    this.loading.set(true);
    this.marginsService.getPlanOverrides()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.overrides.set(res.data);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar overrides');
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  openCreateModal(): void {
    this.editingOverride.set(null);
    this.form.reset({ base_plan_id: '', custom_name: '', margin_pct: 0 });
    this.isModalOpen.set(true);
  }

  openEditModal(override: PartnerPlanOverride): void {
    this.editingOverride.set(override);
    this.form.patchValue({
      base_plan_id: override.base_plan_id,
      custom_name: override.custom_name || '',
      margin_pct: override.margin_pct,
    });
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.editingOverride.set(null);
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);

    const editing = this.editingOverride();
    if (editing) {
      this.marginsService.updatePlanOverride(editing.id, this.form.value as UpdatePlanOverrideDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Override actualizado');
            this.submitting.set(false);
            this.closeModal();
            this.loadOverrides();
          },
          error: () => {
            this.submitting.set(false);
            this.toastService.error('Error al actualizar override');
          },
        });
    } else {
      const dto = this.form.value as CreatePlanOverrideDto;
      this.marginsService.createPlanOverride(dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Override creado');
            this.submitting.set(false);
            this.closeModal();
            this.loadOverrides();
          },
          error: () => {
            this.submitting.set(false);
            this.toastService.error('Error al crear override');
          },
        });
    }
  }

  deleteOverride(override: PartnerPlanOverride): void {
    this.marginsService.deletePlanOverride(override.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Override eliminado');
          this.loadOverrides();
        },
        error: () => this.toastService.error('Error al eliminar override'),
      });
  }
}
