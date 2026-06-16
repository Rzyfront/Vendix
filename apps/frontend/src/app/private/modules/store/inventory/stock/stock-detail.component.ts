import {
  Component,
  OnInit,
  signal,
  computed,
  inject,
  DestroyRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  StatsComponent,
  CardComponent,
  SpinnerComponent,
  ButtonComponent,
  IconComponent,
  EmptyStateComponent,
  ResponsiveDataViewComponent,
  ToastService,
} from '../../../../../shared/components/index';

import type {
  TableColumn,
  ItemListCardConfig,
} from '../../../../../shared/components/index';

import { InventoryService } from '../services';
import { StockLevel } from '../interfaces';

interface LocationStock {
  locationId: number;
  locationName: string;
  available: number;
  reserved: number;
  onHand: number;
  type: string;
  lastUpdated: string;
  // ===== UoM derived display (Fase UoM) =====
  // Populated by the backend for ingredients with a purchase→stock factor.
  // `null` for retail/legacy products — render the total as-is.
  sealed_units?: number | null;
  open_remaining?: number | null;
  stock_unit?: string | null;
  purchase_unit?: string | null;
  purchase_to_stock_factor?: number | null;
}

interface ConsolidatedStock {
  product_id: number;
  totalAvailable: number;
  totalReserved: number;
  totalOnHand: number;
  stockByLocation: LocationStock[];
  product?: { name: string; sku?: string };
}

@Component({
  selector: 'app-stock-detail',
  standalone: true,
  imports: [
    StatsComponent,
    CardComponent,
    SpinnerComponent,
    ButtonComponent,
    IconComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <app-spinner />
        </div>
      }

      @if (error() && !loading()) {
        <app-empty-state
          icon="alert-circle"
          title="Error al cargar stock"
          [description]="error()!"
          [showRefreshButton]="true"
          (refreshClick)="loadStock()"
        ></app-empty-state>
      }

      @if (!loading() && !error()) {
        <div class="flex items-center gap-3 mb-4 px-1">
          <app-button
            variant="ghost"
            size="sm"
            (clicked)="goBack()"
          >
            <app-icon slot="icon" name="arrow-left" [size]="18"></app-icon>
          </app-button>
          <div>
            <h1 class="text-lg font-semibold text-text-primary">
              Stock por Bodega
            </h1>
            @if (productName()) {
              <p class="text-sm text-text-secondary">
                {{ productName() }}
                @if (productSku()) {
                  <span class="ml-2 text-text-secondary/60">SKU: {{ productSku() }}</span>
                }
              </p>
            }
          </div>
        </div>

        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Total Disponible"
            [value]="totalAvailable()"
            smallText="Unidades disponibles"
            iconName="package-check"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Total Reservado"
            [value]="totalReserved()"
            smallText="Unidades reservadas"
            iconName="lock"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
          ></app-stats>

          <app-stats
            title="Total en Mano"
            [value]="uomHeadline() ? uomHeadline()!.sealed : totalOnHand()"
            [smallText]="uomHeadline() ? 'Unidades selladas' : 'Stock fisico total'"
            iconName="warehouse"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>
        </div>

        <!-- ===== UoM headline (Modelo B) =====
             Only rendered for ingredients with a purchase→stock factor.
             Sellados = número principal; capacidad y volumen total al detalle. -->
        @if (uomHeadline(); as uom) {
          <div
            class="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs md:text-sm text-blue-900 flex flex-col gap-2"
            data-testid="uom-headline"
          >
            <div
              class="flex flex-col md:flex-row md:items-center md:justify-between gap-2"
            >
              <span class="flex items-center gap-2">
                <app-icon name="package" [size]="14" class="text-blue-600"></app-icon>
                <span>
                  <strong>{{ uom.sealed }}</strong> sellado{{ uom.sealed === 1 ? '' : 's' }}
                  @if (uom.open > 0) {
                    + <strong>1</strong> abierto
                    (<strong>{{ uom.open }}</strong> {{ uom.unit }})
                  }
                </span>
              </span>

              <!-- mismo pill de conversión que el detalle de producto -->
              <div
                class="self-start md:self-auto rounded-lg bg-primary-50 border border-primary-100 px-3 py-1 text-center whitespace-nowrap"
              >
                <span
                  class="text-[9px] text-primary-600 uppercase font-bold tracking-wider mr-1.5"
                >
                  Equivale a
                </span>
                <span class="text-xs md:text-sm font-bold text-primary-700">
                  1 unidad = {{ uom.capacity }} {{ uom.unit }}
                </span>
              </div>
            </div>
            <span class="text-blue-700/80 pl-6">
              Volumen total: <strong>{{ uom.totalVolume }} {{ uom.unit }}</strong>
            </span>
          </div>
        }

        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[400px]">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
              Ubicaciones <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ locations().length }})</span>
            </h2>
          </div>

          @if (locations().length === 0) {
            <app-empty-state
              icon="warehouse"
              title="Sin ubicaciones"
              description="No se encontraron ubicaciones con stock para este producto"
            ></app-empty-state>
          }

          @if (locations().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="locations()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [loading]="loading()"
                emptyMessage="Sin ubicaciones"
              ></app-responsive-data-view>
            </div>
          }
        </app-card>
      }
    </div>
  `,
})
export class StockDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inventoryService = inject(InventoryService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly productName = signal<string>('');
  readonly productSku = signal<string>('');
  readonly totalAvailable = signal(0);
  readonly totalReserved = signal(0);
  readonly totalOnHand = signal(0);
  readonly locations = signal<LocationStock[]>([]);

  readonly productId = computed(() => {
    const id = this.route.snapshot.paramMap.get('productId');
    return id ? parseInt(id, 10) : null;
  });

  columns: TableColumn[] = [
    {
      key: 'locationName',
      label: 'Bodega',
      sortable: true,
      priority: 1,
    },
    {
      key: 'type',
      label: 'Tipo',
      sortable: true,
      width: '120px',
      align: 'center',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          warehouse: '#3b82f6',
          store: '#22c55e',
          virtual: '#8b5cf6',
        },
      },
      transform: (value: string) => value || 'N/A',
    },
    {
      key: 'available',
      label: 'Disponible',
      sortable: true,
      width: '110px',
      align: 'right',
      priority: 1,
    },
    {
      key: 'reserved',
      label: 'Reservado',
      sortable: true,
      width: '110px',
      align: 'right',
      priority: 1,
    },
    {
      key: 'onHand',
      label: 'Total',
      sortable: true,
      width: '100px',
      align: 'right',
      priority: 1,
    },
    {
      key: 'lastUpdated',
      label: 'Última Actualización',
      sortable: true,
      width: '170px',
      align: 'center',
      priority: 2,
      transform: (value: string) =>
        value ? new Date(value).toLocaleString('es-CO') : '-',
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'locationName',
    badgeKey: 'type',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        warehouse: '#3b82f6',
        store: '#22c55e',
        virtual: '#8b5cf6',
      },
    },
    badgeTransform: (val: string) => val || 'N/A',
    detailKeys: [
      { key: 'available', label: 'Disponible' },
      { key: 'reserved', label: 'Reservado' },
      { key: 'onHand', label: 'Total' },
      {
        key: 'lastUpdated',
        label: 'Actualizado',
        transform: (v: string) =>
          v ? new Date(v).toLocaleDateString('es-CO') : '-',
      },
    ],
  };

  ngOnInit(): void {
    this.loadStock();
  }

  loadStock(): void {
    const id = this.productId();
    if (!id) {
      this.error.set('ID de producto inválido');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.inventoryService
      .getStockByProduct(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.data) {
            this.processStockData(response.data);
          }
          this.loading.set(false);
        },
        error: (err: string) => {
          this.toastService.error(err || 'Error al cargar stock por bodega');
          this.error.set(err || 'No se pudo cargar la información de stock');
          this.loading.set(false);
        },
      });
  }

  /**
   * Modelo B headline summary for ingredients. The sealed/open split is
   * derived from the AGGREGATE total volume across locations (treated as a
   * single pool) and the per-unit capacity, so the user sees "9 sellados"
   * instead of the raw 9680 ml. Also carries the capacity (volume per unit)
   * and the total volume for the detail rows. Returns `null` for
   * retail/legacy products that have no factor.
   */
  readonly uomHeadline = computed<{
    sealed: number;
    open: number;
    unit: string;
    capacity: number;
    totalVolume: number;
  } | null>(() => {
    const first = this.locations()[0];
    if (!first) return null;
    const capacity = Number(first.purchase_to_stock_factor ?? 0);
    // sealed_units present signals "ingredient with factor"; without a valid
    // capacity there is nothing to split.
    if (first.sealed_units == null || !Number.isFinite(capacity) || capacity <= 0) {
      return null;
    }
    const totalVolume = this.totalOnHand();
    return {
      sealed: Math.floor(totalVolume / capacity),
      open: totalVolume % capacity,
      unit: first.stock_unit || '',
      capacity,
      totalVolume,
    };
  });

  private processStockData(data: StockLevel | StockLevel[]): void {
    if (Array.isArray(data)) {
      if (data.length > 0) {
        const first = data[0];
        this.productName.set(first.product?.name || '');
        this.productSku.set(first.product?.sku || '');
      }
      const mapped: LocationStock[] = data.map((level) => ({
        locationId: level.location_id,
        locationName: level.location?.name || `Ubicación ${level.location_id}`,
        available: level.quantity_available,
        reserved: level.quantity_reserved,
        onHand: level.quantity_on_hand,
        type: (level.location as any)?.type || 'warehouse',
        lastUpdated: level.updated_at || '',
        // UoM split (Fase UoM) — see stock-levels.service.ts:
        // sealed_units = floor(quantity_on_hand / factor), open_remaining
        // = quantity_on_hand % factor. Null for non-ingredients.
        sealed_units: (level as any).sealed_units ?? null,
        open_remaining: (level as any).open_remaining ?? null,
        stock_unit: (level.product as any)?.stock_unit ?? null,
        purchase_unit: (level.product as any)?.purchase_unit ?? null,
        purchase_to_stock_factor:
          (level.product as any)?.purchase_to_stock_factor ?? null,
      }));
      this.locations.set(mapped);
      this.totalAvailable.set(mapped.reduce((sum, l) => sum + l.available, 0));
      this.totalReserved.set(mapped.reduce((sum, l) => sum + l.reserved, 0));
      this.totalOnHand.set(mapped.reduce((sum, l) => sum + l.onHand, 0));
    } else {
      const consolidated = data as any;
      this.productName.set(consolidated.product?.name || '');
      this.productSku.set(consolidated.product?.sku || '');
      this.totalAvailable.set(consolidated.totalAvailable ?? 0);
      this.totalReserved.set(consolidated.totalReserved ?? 0);
      this.totalOnHand.set(consolidated.totalOnHand ?? 0);
      this.locations.set(consolidated.stockByLocation || []);
    }
  }

  goBack(): void {
    this.router.navigate(['/admin/inventory']);
  }
}
