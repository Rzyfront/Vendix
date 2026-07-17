import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';

import {
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  InputsearchComponent,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../shared/components/index';

import {
  RepartosService,
  type RepartosApiError,
} from '../services/repartos.service';
import { ActiveRouteStore } from '../state/active-route.store';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import type { PoolItem } from '../interfaces/repartos.interface';

/**
 * Pool de reparto (`/repartos/pool`) — Fase F3.
 *
 * Lista las órdenes que ya salieron a despacho y esperan a que un carrier las
 * TOME a su ruta activa (`GET /store/carrier/pool`). Cada tarjeta ofrece la
 * acción "Tomar" (`POST /store/carrier/pool/:orderId/claim`), una toma atómica
 * primero-gana: si otra persona ganó la carrera el backend responde 409
 * `CARRIER_CLAIM_TAKEN` y la lista se reconcilia.
 *
 * Zoneless-safe: todo el estado observado por la plantilla vive en signals; la
 * suscripción HTTP se ata a `takeUntilDestroyed`. Reutiliza los componentes
 * compartidos (ResponsiveDataView + Inputsearch + Pagination + EmptyState)
 * calcando el patrón de `PlanillasListComponent`.
 */
@Component({
  selector: 'app-pool-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
  ],
  template: `
    <div class="md:space-y-4">
      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Header + búsqueda -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Pool de reparto ({{ totalItems() }})
            </h2>

            <app-inputsearch
              class="flex-1 md:w-72 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar por pedido, cliente o dirección..."
              [debounceTime]="1000"
              [ngModel]="search()"
              (ngModelChange)="onSearchChange($event)"
            ></app-inputsearch>
          </div>
        </div>

        <!-- Cargando -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando pool...</p>
          </div>
        }

        <!-- Vacío -->
        @if (!loading() && poolItems().length === 0) {
          <app-empty-state
            icon="package"
            [title]="emptyStateTitle()"
            [description]="emptyStateDescription()"
            [showActionButton]="false"
            [showClearFilters]="hasFilters()"
            (clearFiltersClick)="clearFilters()"
          ></app-empty-state>
        }

        <!-- Lista -->
        @if (!loading() && poolItems().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="poolItems()"
              [columns]="tableColumns"
              [actions]="tableActions"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              [sortable]="true"
            ></app-responsive-data-view>

            <app-pagination
              [currentPage]="page()"
              [totalPages]="totalPages()"
              [total]="totalItems()"
              [limit]="limit"
              infoStyle="range"
              (pageChange)="goToPage($event)"
            ></app-pagination>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class PoolPageComponent implements OnInit {
  private readonly repartosService = inject(RepartosService);
  private readonly activeRouteStore = inject(ActiveRouteStore);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly poolItems = signal<PoolItem[]>([]);
  readonly loading = signal(false);
  readonly page = signal(1);
  readonly totalPages = signal(1);
  readonly totalItems = signal(0);
  readonly search = signal('');

  /** Orden que se está tomando ahora mismo (guard anti doble-tap), o `null`. */
  readonly takingId = signal<number | null>(null);

  /** Tamaño de página fijo del pool (paginación server-side obligatoria). */
  readonly limit = 20;

  readonly tableColumns: TableColumn[] = [
    {
      key: 'order_number',
      label: 'Pedido',
      sortable: true,
      width: '140px',
      priority: 1,
    },
    {
      key: 'customer_name',
      label: 'Cliente',
      defaultValue: '—',
      priority: 2,
    },
    {
      key: 'address',
      label: 'Dirección',
      defaultValue: '—',
      priority: 3,
    },
    {
      key: 'total_to_collect',
      label: 'A recaudar',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.formatCurrency(value),
    },
    {
      key: 'pooled_at',
      label: 'Ingresó',
      sortable: true,
      priority: 2,
      transform: (value: string) => this.formatPooledAt(value),
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: (item: PoolItem) =>
        this.takingId() === item.order_id ? 'Tomando…' : 'Tomar',
      icon: 'package-check',
      action: (item: PoolItem) => this.take(item),
      variant: 'primary',
      disabled: (_item: PoolItem) => this.takingId() !== null,
      tooltip: 'Tomar esta orden a mi ruta',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    titleTransform: (item: PoolItem) => `#${item.order_number}`,
    subtitleTransform: (item: PoolItem) =>
      item.customer_name || 'Cliente sin nombre',
    avatarFallbackIcon: 'package',
    avatarShape: 'square',
    footerKey: 'total_to_collect',
    footerLabel: 'A recaudar',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.formatCurrency(val),
    detailKeys: [
      {
        key: 'address',
        label: 'Dirección',
        icon: 'map-pin',
        transform: (val: any) => (val ? String(val) : '—'),
      },
      {
        key: 'pooled_at',
        label: 'Ingresó',
        icon: 'clock',
        transform: (val: any) => this.formatPooledAt(val),
      },
    ],
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.repartosService
      .getPool({
        page: this.page(),
        limit: this.limit,
        search: this.search() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.poolItems.set(res.data);
          this.totalItems.set(res.meta.total);
          this.totalPages.set(res.meta.totalPages);
          this.loading.set(false);
        },
        error: (err: RepartosApiError) => {
          this.loading.set(false);
          this.toast.error(err?.message ?? 'No se pudo cargar el pool');
        },
      });
  }

  /**
   * Toma una orden a mi ruta activa. Guard anti doble-tap: si ya hay una toma
   * en vuelo se ignora. En 409 `CARRIER_CLAIM_TAKEN` se reconcilia recargando.
   */
  take(item: PoolItem): void {
    if (this.takingId() !== null) return; // otra toma ya en curso
    const orderId = item.order_id;
    this.takingId.set(orderId);
    this.repartosService
      .takeToMyRoute(orderId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.takingId.set(null)),
      )
      .subscribe({
        next: () => {
          // Quitar la orden del pool localmente (respuesta optimista).
          this.poolItems.update((items) =>
            items.filter((i) => i.order_id !== orderId),
          );
          this.totalItems.update((t) => Math.max(0, t - 1));
          // Refrescar "mi ruta" para que ruta/bottom-nav reflejen la parada.
          this.activeRouteStore.refresh();
          this.toast.success('Orden agregada a tu ruta', 'Tomada');
          this.router.navigate(['/repartos/ruta']);
        },
        error: (err: RepartosApiError) => {
          if (err?.errorCode === 'CARRIER_CLAIM_TAKEN') {
            this.toast.error('Otra persona ya tomó esta orden');
            this.load(); // reconciliar el pool
          } else {
            this.toast.error(err?.message ?? 'No se pudo tomar la orden');
          }
        },
      });
  }

  onSearchChange(term: string): void {
    this.search.set(term);
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.search.set('');
    this.page.set(1);
    this.load();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.load();
  }

  hasFilters(): boolean {
    return !!this.search();
  }

  emptyStateTitle(): string {
    return this.hasFilters()
      ? 'Sin resultados en el pool'
      : 'No hay órdenes en el pool';
  }

  emptyStateDescription(): string {
    return this.hasFilters()
      ? 'Ajusta tu búsqueda para ver más órdenes disponibles.'
      : 'Cuando haya pedidos listos para reparto aparecerán aquí para tomarlos.';
  }

  formatCurrency(value: any): string {
    const num_value =
      typeof value === 'string' ? parseFloat(value) : value || 0;
    return this.currencyService.format(num_value);
  }

  /**
   * Formatea `pooled_at` (instante ISO real, no fecha-solo) en zona horaria
   * LOCAL del navegador — el patrón correcto para un timestamp según
   * `vendix-date-timezone` (evita el off-by-one de `formatDateOnlyUTC`, que es
   * solo para campos date-only guardados a medianoche UTC).
   */
  formatPooledAt(value: string): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
