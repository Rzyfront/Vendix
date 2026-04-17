import {Component, inject, signal, computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';


import { AccountingService } from '../../services/accounting.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  FixedAsset,
  FixedAssetCategory,
  ApiResponse} from '../../interfaces/accounting.interface';
import { FixedAssetCreateModalComponent } from './fixed-asset-create-modal/fixed-asset-create-modal.component';
import { FixedAssetDetailModalComponent } from './fixed-asset-detail-modal/fixed-asset-detail-modal.component';
import { FixedAssetCategoriesModalComponent } from './fixed-asset-categories-modal/fixed-asset-categories-modal.component';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  StatsComponent,
  InputsearchComponent,
  SelectorComponent} from '../../../../../../shared/components/index';

interface AssetStats {
  total: number;
  active: number;
  fully_depreciated: number;
  total_book_value: number;
}

@Component({
  selector: 'vendix-fixed-assets',
  standalone: true,
  imports: [
    FormsModule,
    FixedAssetCreateModalComponent,
    FixedAssetDetailModalComponent,
    FixedAssetCategoriesModalComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    SelectorComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Activos"
          [value]="stats().total"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="stats().active"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Totalmente Depreciados"
          [value]="stats().fully_depreciated"
          iconName="alert-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Valor en Libros"
          [value]="formatted_book_value()"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
          [clickable]="false"
        ></app-stats>
      </div>

      <!-- Unified Container: Search Header + Data -->
      <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[400px]">
        <!-- Search Header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary"
            >
              Activos Fijos ({{ filtered_assets().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar activo..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>

              <app-selector
                class="w-36 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [options]="status_options"
                [ngModel]="filter_status"
                placeholder="Estado"
                (valueChange)="onFilterStatus($event)"
              ></app-selector>

              <app-button
                variant="outline"
                size="sm"
                (clicked)="openCategoriesModal()"
              >
                <app-icon name="tag" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Categorias</span>
              </app-button>

              <app-button
                variant="outline"
                size="sm"
                (clicked)="openDepreciationDialog()"
              >
                <app-icon
                  name="trending-down"
                  [size]="16"
                  slot="icon"
                ></app-icon>
                <span class="hidden sm:inline">Depreciar</span>
              </app-button>

              <app-button
                variant="primary"
                size="sm"
                (clicked)="openCreateModal()"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Nuevo Activo</span>
                <span class="sm:hidden">Nuevo</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          @if (is_loading()) {
            <div
              class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
            </div>
          }

          <!-- Table Header (desktop) -->
          <div
            class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-gray-50 rounded-lg
                      text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1"
          >
            <div class="col-span-1">N.o</div>
            <div class="col-span-2">Nombre</div>
            <div class="col-span-2">Categoria</div>
            <div class="col-span-2 text-right">Costo</div>
            <div class="col-span-2 text-right">Deprec. Acum.</div>
            <div class="col-span-1 text-right">Valor Libros</div>
            <div class="col-span-1 text-center">Estado</div>
            <div class="col-span-1 text-right">Acciones</div>
          </div>

          @if (filtered_assets().length === 0 && !is_loading()) {
            <div
              class="flex flex-col items-center justify-center py-16 text-gray-400"
            >
              <app-icon name="package" [size]="48"></app-icon>
              <p class="mt-4 text-base">No se encontraron activos fijos</p>
              <p class="text-sm">
                {{
                  search_term()
                    ? 'Intenta con otro termino de busqueda.'
                    : 'Crea tu primer activo fijo para comenzar.'
                }}
              </p>
            </div>
          } @else {
            <div class="divide-y divide-border">
              @for (asset of filtered_assets(); track asset.id) {
                <!-- Mobile Card -->
                <div
                  class="md:hidden p-3 mx-2 my-1 bg-surface rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
                  (click)="openDetailModal(asset)"
                >
                  <div class="flex items-center justify-between">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-mono text-gray-500">{{
                          asset.asset_number
                        }}</span>
                        <span
                          class="text-[15px] font-bold text-text-primary truncate"
                          >{{ asset.name }}</span
                        >
                      </div>
                      <div class="flex items-center gap-2 mt-1">
                        @if (asset.category) {
                          <span
                            class="text-[10px] font-bold uppercase text-gray-500 px-1.5 py-0.5 rounded bg-gray-100"
                            >{{ asset.category.name }}</span
                          >
                        }
                        <span
                          class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                          [class]="getStatusClass(asset.status)"
                        >
                          {{ getStatusLabel(asset.status) }}
                        </span>
                      </div>
                      <div
                        class="flex items-center gap-4 mt-2 text-xs text-gray-500"
                      >
                        <span
                          >Costo:
                          {{
                            asset.acquisition_cost
                              | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                          }}</span
                        >
                        <span class="font-semibold text-text-primary"
                          >VL:
                          {{
                            asset.book_value ?? 0
                              | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                          }}</span
                        >
                      </div>
                    </div>
                    <app-icon
                      name="chevron-right"
                      [size]="16"
                      class="text-gray-400 ml-2"
                    ></app-icon>
                  </div>
                </div>

                <!-- Desktop Row -->
                <div
                  class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-gray-50 transition-colors cursor-pointer"
                  (click)="openDetailModal(asset)"
                >
                  <div class="col-span-1 text-sm font-mono text-gray-600">
                    {{ asset.asset_number }}
                  </div>
                  <div
                    class="col-span-2 text-sm text-text-primary font-medium truncate"
                  >
                    {{ asset.name }}
                  </div>
                  <div class="col-span-2 text-xs text-gray-500">
                    {{ asset.category?.name || '—' }}
                  </div>
                  <div class="col-span-2 text-sm text-right font-mono">
                    {{
                      asset.acquisition_cost
                        | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                    }}
                  </div>
                  <div
                    class="col-span-2 text-sm text-right font-mono text-red-500"
                  >
                    {{
                      asset.accumulated_depreciation
                        | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                    }}
                  </div>
                  <div
                    class="col-span-1 text-sm text-right font-mono font-semibold"
                  >
                    {{
                      asset.book_value ?? 0
                        | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                    }}
                  </div>
                  <div class="col-span-1 text-center">
                    <span
                      class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      [class]="getStatusClass(asset.status)"
                    >
                      {{ getStatusLabel(asset.status) }}
                    </span>
                  </div>
                  <div class="col-span-1 flex items-center justify-end gap-1">
                    @if (asset.status === 'active') {
                      <button
                        (click)="openEditModal(asset); $event.stopPropagation()"
                        class="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-primary"
                      >
                        <app-icon name="edit" [size]="14"></app-icon>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </app-card>

      <!-- Depreciation Run Dialog -->
      @if (show_depreciation_dialog) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          (click)="show_depreciation_dialog = false"
        >
          <div
            class="bg-surface rounded-xl shadow-xl p-6 w-full max-w-sm mx-4"
            (click)="$event.stopPropagation()"
          >
            <h3 class="text-lg font-semibold text-text-primary mb-4">
              Ejecutar Depreciacion
            </h3>
            <p class="text-sm text-gray-500 mb-4">
              Selecciona el periodo para ejecutar la depreciacion mensual de
              todos los activos activos.
            </p>
            <div class="grid grid-cols-2 gap-3 mb-6">
              <div>
                <label class="text-xs font-medium text-gray-600 mb-1 block"
                  >Anio</label
                >
                <select
                  [(ngModel)]="depreciation_year"
                  class="w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface"
                >
                  @for (y of available_years; track y) {
                    <option [value]="y">{{ y }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="text-xs font-medium text-gray-600 mb-1 block"
                  >Mes</label
                >
                <select
                  [(ngModel)]="depreciation_month"
                  class="w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface"
                >
                  @for (m of months; track m.value) {
                    <option [value]="m.value">{{ m.label }}</option>
                  }
                </select>
              </div>
            </div>
            <div class="flex justify-end gap-3">
              <app-button
                variant="outline"
                (clicked)="show_depreciation_dialog = false"
                >Cancelar</app-button
              >
              <app-button
                variant="primary"
                (clicked)="runDepreciation()"
                [loading]="is_running_depreciation"
              >
                Ejecutar
              </app-button>
            </div>
          </div>
        </div>
      }

      <!-- Create/Edit Modal -->
      <vendix-fixed-asset-create-modal
        [(isOpen)]="is_create_modal_open"
        [editAsset]="selected_asset_for_edit"
        [categories]="categories()"
        (saved)="onAssetSaved()"
      ></vendix-fixed-asset-create-modal>

      <!-- Detail Modal -->
      <vendix-fixed-asset-detail-modal
        [(isOpen)]="is_detail_modal_open"
        [asset]="selected_asset_for_detail"
        (assetUpdated)="onAssetSaved()"
      ></vendix-fixed-asset-detail-modal>

      <!-- Categories Modal -->
      <vendix-fixed-asset-categories-modal
        [(isOpen)]="is_categories_modal_open"
        [categories]="categories()"
        (categoriesChanged)="loadCategories()"
      ></vendix-fixed-asset-categories-modal>
    </div>
  `})
export class FixedAssetsComponent {
  private destroyRef = inject(DestroyRef);
private accounting_service = inject(AccountingService);
  private currencyService = inject(CurrencyFormatService);

  // Data
  readonly assets = signal<FixedAsset[]>([]);
  readonly filtered_assets = signal<FixedAsset[]>([]);
  readonly categories = signal<FixedAssetCategory[]>([]);
  readonly is_loading = signal(false);

  // Stats
  readonly stats = signal<AssetStats>({
    total: 0,
    active: 0,
    fully_depreciated: 0,
    total_book_value: 0});

  readonly formatted_book_value = computed(() =>
    this.currencyService.format(this.stats().total_book_value || 0),
  );

  // Filters
  search_term = signal('');
  filter_status = '';
  filter_category = '';

  status_options = [
    { value: '', label: 'Todos' },
    { value: 'active', label: 'Activo' },
    { value: 'fully_depreciated', label: 'Totalmente Depreciado' },
    { value: 'retired', label: 'Retirado' },
    { value: 'disposed', label: 'Dado de Baja' },
  ];

  // Modals
  is_create_modal_open = false;
  is_detail_modal_open = false;
  is_categories_modal_open = false;
  selected_asset_for_edit: FixedAsset | null = null;
  selected_asset_for_detail: FixedAsset | null = null;

  // Depreciation dialog
  show_depreciation_dialog = false;
  is_running_depreciation = false;
  depreciation_year = new Date().getFullYear();
  depreciation_month = new Date().getMonth() + 1;

  available_years: number[] = [];
  months = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' },
  ];

  constructor() {
    const current_year = new Date().getFullYear();
    this.available_years = [current_year - 1, current_year, current_year + 1];
    this.loadAssets();
    this.loadCategories();
  }
loadAssets(): void {
    this.is_loading.set(true);
    const query: Record<string, any> = {};
    if (this.filter_status) query['status'] = this.filter_status;

    this.accounting_service
      .getFixedAssets(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.assets.set(response.data);
          this.computeStats();
          this.applyFilters();
          this.is_loading.set(false);
        },
        error: () => {
          this.is_loading.set(false);
        }});
  }

  loadCategories(): void {
    this.accounting_service
      .getFixedAssetCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.categories.set(response.data);
        }});
  }

  private computeStats(): void {
    const assets = this.assets();
    this.stats.set({
      total: assets.length,
      active: assets.filter((a) => a.status === 'active').length,
      fully_depreciated: assets.filter((a) => a.status === 'fully_depreciated').length,
      total_book_value: assets.reduce((sum, a) => sum + (a.book_value ?? 0), 0)});
  }

  private applyFilters(): void {
    let result = [...this.assets()];

    if (this.search_term()) {
      const term = this.search_term().toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(term) ||
          a.asset_number.toLowerCase().includes(term) ||
          a.category?.name?.toLowerCase().includes(term),
      );
    }

    if (this.filter_status) {
      result = result.filter((a) => a.status === this.filter_status);
    }

    this.filtered_assets.set(result);
  }

  onSearch(term: string): void {
    this.search_term.set(term);
    this.applyFilters();
  }

  onFilterStatus(status: any): void {
    this.filter_status = status;
    this.applyFilters();
  }

  // ── Modal management ──────────────────────────────────
  openCreateModal(): void {
    this.selected_asset_for_edit = null;
    this.is_create_modal_open = true;
  }

  openEditModal(asset: FixedAsset): void {
    this.selected_asset_for_edit = asset;
    this.is_create_modal_open = true;
  }

  openDetailModal(asset: FixedAsset): void {
    this.selected_asset_for_detail = asset;
    this.is_detail_modal_open = true;
  }

  openCategoriesModal(): void {
    this.is_categories_modal_open = true;
  }

  openDepreciationDialog(): void {
    this.show_depreciation_dialog = true;
  }

  runDepreciation(): void {
    this.is_running_depreciation = true;
    this.accounting_service
      .runDepreciation({
        year: this.depreciation_year,
        month: this.depreciation_month})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.is_running_depreciation = false;
          this.show_depreciation_dialog = false;
          this.loadAssets();
        },
        error: () => {
          this.is_running_depreciation = false;
        }});
  }

  onAssetSaved(): void {
    this.loadAssets();
  }

  // ── Helpers ───────────────────────────────────────────
  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      fully_depreciated: 'Depreciado',
      retired: 'Retirado',
      disposed: 'Baja'};
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-600',
      fully_depreciated: 'bg-amber-50 text-amber-600',
      retired: 'bg-gray-100 text-gray-500',
      disposed: 'bg-red-50 text-red-500'};
    return classes[status] || 'bg-gray-100 text-gray-500';
  }
}
