import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';

import {
  CardComponent,
  StatsComponent,
  StickyHeaderComponent,
  ResponsiveDataViewComponent,
  PaginationComponent,
  SpinnerComponent,
} from '../../../../../shared/components';
import type {
  TableColumn,
  ItemListCardConfig,
} from '../../../../../shared/components';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency/currency.pipe';

import { SuppliersService } from '../services/suppliers.service';
import type {
  Supplier,
  SupplierSummary,
  SupplierPurchaseOrderRow,
  SupplierPayableRow,
} from '../interfaces';

/**
 * QUI-656 — Perfil del proveedor.
 *
 * Espejo de `CustomerDetailsComponent`: ruta lazy con URL compartible en vez de
 * modal, `app-sticky-header` para que la identidad y el volver sigan visibles
 * al bajar, y `app-responsive-data-view` para las dos tablas — no markup propio,
 * que en móvil obliga a scroll horizontal y no ofrece fila clickeable.
 *
 * REQUISITO DURO del ticket: las cifras se CONSUMEN del backend, que las deriva
 * del contrato de métrica (`PURCHASE_COMMITTED_STATES`). Este componente no
 * calcula ningún agregado propio; una tercera definición de "cuánto le he
 * comprado" garantizaba un tercer desacuerdo, que es el bug de QUI-625.
 */
@Component({
  selector: 'vendix-supplier-details',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    StickyHeaderComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    SpinnerComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Perfil del Proveedor"
        [subtitle]="supplier()?.name || 'Cargando...'"
        icon="truck"
        [showBackButton]="true"
        backRoute="/admin/inventory/suppliers"
        [badgeText]="scopeBadge()"
        [badgeColor]="summary()?.scope === 'ORGANIZATION' ? 'blue' : 'gray'"
      ></app-sticky-header>

      <div class="flex flex-col gap-4 md:gap-6 pb-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner></app-spinner>
          </div>
        } @else if (loadError()) {
          <app-card shadow="none" [responsivePadding]="true">
            <p class="text-sm text-[var(--color-text-secondary)] py-6 text-center">
              No se pudo cargar el perfil del proveedor.
            </p>
          </app-card>
        } @else {
          <div class="stats-container">
            <app-stats
              title="Comprado (sin IVA)"
              [value]="summary()?.total_purchased | currency"
              [smallText]="(summary()?.total_orders || 0) + ' órdenes'"
              iconName="shopping-cart"
              iconBgColor="bg-blue-100"
              iconColor="text-blue-600"
            ></app-stats>

            <app-stats
              title="Deuda vigente"
              [value]="summary()?.outstanding_debt | currency"
              [smallText]="overdueLabel()"
              iconName="credit-card"
              iconBgColor="bg-amber-100"
              iconColor="text-amber-600"
            ></app-stats>

            <!--
              "Comprometido" NO es deuda: son OCs aprobadas cuya CxP todavía no
              existe porque nace con la recepción. Va como tarjeta aparte para
              no mezclarla con lo que sí cuadra contra contabilidad.
            -->
            <app-stats
              title="Comprometido"
              [value]="summary()?.committed_amount | currency"
              [smallText]="(summary()?.committed_orders || 0) + ' órdenes sin recibir'"
              iconName="clock"
              iconBgColor="bg-purple-100"
              iconColor="text-purple-600"
            ></app-stats>

            <!--
              CP-ID-VNDX-2026-08-18-PO-PROD — F2.S3: 5ta card "YTD" (año a la fecha).
            -->
            <app-stats
              title="Compras YTD"
              [value]="summary()?.ytd_purchases | currency"
              [smallText]="(summary()?.open_pos_count || 0) + ' OCs abiertas'"
              iconName="calendar"
              iconBgColor="bg-cyan-100"
              iconColor="text-cyan-600"
            ></app-stats>
          </div>

          <!--
            Identidad. Dos decisiones de layout, ambas por densidad:
            1. Grid de 2 columnas ya en móvil. Un NIT o un teléfono ocupaban
               una fila entera para ocho caracteres; a una columna la tarjeta
               medía tres pantallas de alto para nueve datos cortos.
            2. Los campos vacíos NO se pintan. Nueve guiones seguidos no son
               información: son ruido que empuja hacia abajo lo que sí importa.
               Si el proveedor no tiene nada capturado, se dice una vez.
          -->
          <app-card shadow="none" [showHeader]="true" [padding]="false">
            <div slot="header" class="flex flex-col">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Identidad</span>
              @if (missingIdentityCount() > 0) {
                <span class="text-xs text-[var(--color-text-secondary)]">
                  {{ missingIdentityCount() }} campo(s) sin capturar
                </span>
              }
            </div>
            @if (identityFields().length === 0) {
              <p class="text-sm text-[var(--color-text-secondary)] p-4 text-center">
                Este proveedor no tiene datos de contacto capturados.
              </p>
            } @else {
              <div class="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-4">
                @for (field of identityFields(); track field.label) {
                  <div
                    class="flex flex-col gap-0.5 min-w-0 border-l-2 border-[var(--color-border)] pl-3"
                    [class.col-span-2]="field.wide"
                  >
                    <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] truncate">
                      {{ field.label }}
                    </span>
                    <span
                      class="text-sm font-medium text-[var(--color-text-primary)] truncate"
                      [title]="field.value"
                    >
                      {{ field.value }}
                    </span>
                  </div>
                }
              </div>
            }
          </app-card>

          <!-- Órdenes de compra -->
          <app-card shadow="none" [showHeader]="true" [padding]="false">
            <div slot="header" class="flex flex-col">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Órdenes de compra</span>
              <span class="text-xs text-[var(--color-text-secondary)]">
                {{ ordersTotal() }} en total · toca una para abrirla
              </span>
            </div>
            <div class="p-4">
              <app-responsive-data-view
                [data]="orders()"
                [columns]="orderColumns"
                [cardConfig]="orderCardConfig"
                [loading]="loadingOrders()"
                [hoverable]="true"
                emptyTitle="Sin órdenes"
                emptyMessage="Sin órdenes de compra para este proveedor."
                (rowClick)="openOrder($event)"
              ></app-responsive-data-view>
              <app-pagination
                [currentPage]="ordersPage()"
                [totalPages]="ordersTotalPages()"
                [total]="ordersTotal()"
                [limit]="pageSize"
                (pageChange)="onOrdersPageChange($event)"
              ></app-pagination>
            </div>
          </app-card>

          <!-- Cuentas por pagar -->
          <app-card shadow="none" [showHeader]="true" [padding]="false">
            <div slot="header" class="flex flex-col">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Cuentas por pagar</span>
              <span class="text-xs text-[var(--color-text-secondary)]">
                Deuda formalizada; cuadra contra contabilidad
              </span>
            </div>
            <div class="p-4">
              <app-responsive-data-view
                [data]="payables()"
                [columns]="payableColumns"
                [cardConfig]="payableCardConfig"
                [loading]="loadingPayables()"
                [hoverable]="true"
                emptyTitle="Sin cuentas por pagar"
                emptyMessage="Sin cuentas por pagar a este proveedor."
                (rowClick)="openPayableSource($event)"
              ></app-responsive-data-view>
              <app-pagination
                [currentPage]="payablesPage()"
                [totalPages]="payablesTotalPages()"
                [total]="payablesTotal()"
                [limit]="pageSize"
                (pageChange)="onPayablesPageChange($event)"
              ></app-pagination>
            </div>
          </app-card>
        }
      </div>
    </div>
  `,
})
export class SupplierDetailsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly suppliersService = inject(SuppliersService);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly pageSize = 10;

  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly supplier = signal<Supplier | null>(null);
  readonly summary = signal<SupplierSummary | null>(null);

  readonly orders = signal<SupplierPurchaseOrderRow[]>([]);
  readonly ordersTotal = signal(0);
  readonly ordersPage = signal(1);
  readonly loadingOrders = signal(false);
  readonly ordersTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.ordersTotal() / this.pageSize)),
  );

  readonly payables = signal<SupplierPayableRow[]>([]);
  readonly payablesTotal = signal(0);
  readonly payablesPage = signal(1);
  readonly loadingPayables = signal(false);
  readonly payablesTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.payablesTotal() / this.pageSize)),
  );

  private static readonly STATUS_LABELS: Record<string, string> = {
    draft: 'Borrador',
    approved: 'Aprobada',
    partial: 'Parcial',
    received: 'Recibida',
    cancelled: 'Cancelada',
  };

  private static readonly PAYMENT_LABELS: Record<string, string> = {
    unpaid: 'Sin pagar',
    partial: 'Parcial',
    paid: 'Pagada',
  };

  /**
   * Hex de 7 caracteres y no clases de Tailwind: `badgeConfig` los pasa por
   * `makeColorSoft()`, que no entiende clases.
   */
  private static readonly STATUS_COLORS: Record<string, string> = {
    draft: '#6b7280',
    approved: '#d97706',
    partial: '#d97706',
    received: '#16a34a',
    cancelled: '#dc2626',
  };

  readonly orderColumns: TableColumn[] = [
    { key: 'order_number', label: 'Orden', priority: 1 },
    {
      key: 'order_date',
      label: 'Fecha',
      priority: 2,
      defaultValue: 'Sin fecha',
      transform: (value: any) => this.formatDate(value as string | null),
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      badge: true,
      // El texto del badge sale de `transform`: la celda de badge de
      // `app-table` lee `column.transform` e IGNORA `badgeTransform`, que solo
      // existe en la interfaz. `type: 'custom'` es obligatorio para que
      // `colorMap` se aplique (ver getBadgeBackgroundColor).
      transform: (value: any) =>
        SupplierDetailsComponent.STATUS_LABELS[String(value)] ?? String(value),
      badgeConfig: {
        type: 'custom',
        colorMap: SupplierDetailsComponent.STATUS_COLORS,
        size: 'sm',
      },
    },
    {
      key: 'payment_status',
      label: 'Pago',
      priority: 3,
      transform: (value: any) =>
        SupplierDetailsComponent.PAYMENT_LABELS[String(value)] ?? String(value),
    },
    {
      key: 'total_amount',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.currencyService.format(Number(value)),
    },
  ];

  readonly orderCardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    subtitleKey: 'supplier_invoice_number',
    badgeKey: 'status',
    badgeTransform: (value: any) =>
      SupplierDetailsComponent.STATUS_LABELS[String(value)] ?? String(value),
    badgeConfig: {
      type: 'custom',
      colorMap: SupplierDetailsComponent.STATUS_COLORS,
      size: 'sm',
    },
    // `detailKeys` NO hereda el `transform` de la columna: es configuración
    // aparte. Sin esto la tarjeta móvil mostraba el ISO crudo
    // (2026-08-10T08:19:19.681Z) y el estado de pago en inglés.
    detailKeys: [
      {
        key: 'order_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (value: any) => this.formatDate(value as string | null),
      },
      {
        key: 'payment_status',
        label: 'Pago',
        icon: 'credit-card',
        transform: (value: any) =>
          SupplierDetailsComponent.PAYMENT_LABELS[String(value)] ??
          String(value),
      },
    ],
    footerKey: 'total_amount',
    footerLabel: 'Total',
    footerTransform: (value: any) => this.currencyService.format(Number(value)),
  };

  readonly payableColumns: TableColumn[] = [
    {
      // La clave es `source_type` y NO `document_number`: la celda de
      // `app-table` corta antes del transform cuando el valor es null, y
      // `document_number` es null en las CxP generadas por recepción — habría
      // mostrado "No data" en vez del documento origen. `source_type` nunca es
      // null, así que el transform siempre corre y arma la etiqueta.
      key: 'source_type',
      label: 'Documento',
      priority: 1,
      transform: (_value: any, row?: any) =>
        (row?.document_number as string) ||
        `${row?.source_type ?? 'documento'} #${row?.source_id ?? '—'}`,
    },
    {
      key: 'due_date',
      label: 'Vence',
      priority: 1,
      transform: (value: any) => this.formatDate(value as string | null),
    },
    /**
     * CP-ID-VNDX-2026-08-18-PO-PROD — F2.S4: columna "Cuota N de M".
     * Solo aplica cuando la CxP proviene de un PO con plan de pagos.
     * Si no hay plan: muestra "Única".
     */
    {
      key: 'installment_info',
      label: 'Cuota',
      priority: 2,
      transform: (_value: any, row?: any) => {
        const info = row?.installment_info;
        if (!info || !info.total_installments || info.payment_plan === 'immediate') {
          return 'Única';
        }
        const n = info.installment_number ?? '?';
        const m = info.total_installments;
        return `${n} de ${m}`;
      },
    },
    {
      key: 'days_overdue',
      label: 'Mora',
      priority: 3,
      transform: (value: any) => (Number(value) > 0 ? `${value} días` : '—'),
    },
    {
      key: 'original_amount',
      label: 'Original',
      align: 'right',
      priority: 3,
      transform: (value: any) => this.currencyService.format(Number(value)),
    },
    {
      key: 'balance',
      label: 'Saldo',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.currencyService.format(Number(value)),
    },
  ];

  readonly payableCardConfig: ItemListCardConfig = {
    titleKey: 'document_number',
    titleTransform: (item: any) =>
      (item?.document_number as string) ||
      `${item?.source_type} #${item?.source_id ?? '—'}`,
    badgeKey: 'status',
    badgeTransform: (value: any) =>
      String(value) === 'open' ? 'Abierta' : 'Pagada',
    badgeConfig: {
      type: 'custom',
      colorMap: { open: '#d97706', paid: '#16a34a' },
      size: 'sm',
    },
    detailKeys: [
      {
        key: 'due_date',
        label: 'Vence',
        icon: 'calendar',
        transform: (value: any) => this.formatDate(value as string | null),
      },
      {
        key: 'days_overdue',
        label: 'Mora',
        icon: 'alert-triangle',
        transform: (value: any) =>
          Number(value) > 0 ? `${value} días` : 'Al día',
      },
    ],
    footerKey: 'balance',
    footerLabel: 'Saldo',
    footerTransform: (value: any) => this.currencyService.format(Number(value)),
  };

  readonly scopeBadge = computed(() => {
    const scope = this.summary()?.scope;
    if (!scope) return '';
    return scope === 'ORGANIZATION' ? 'Toda la organización' : 'Esta tienda';
  });

  readonly overdueLabel = computed(() => {
    const s = this.summary();
    if (!s || s.overdue_debt <= 0) return 'Sin mora';
    return `${this.currencyService.format(s.overdue_debt)} vencidos · ${s.max_days_overdue} d`;
  });

  readonly lastOrderLabel = computed(() => {
    const iso = this.summary()?.last_order_date;
    if (!iso) return 'Sin compras';
    return `Última compra ${this.formatDate(iso)}`;
  });

  /**
   * Campos de identidad presentes. `wide` marca los que necesitan las dos
   * columnas: un email o un nombre de banco truncado a media columna en móvil
   * es ilegible, mientras que un NIT o un teléfono caben de sobra.
   *
   * Se filtran los vacíos en vez de rellenarlos con guiones — ver el comentario
   * del template.
   */
  readonly identityFields = computed(() => {
    const s = this.supplier() as (Supplier & Record<string, unknown>) | null;
    if (!s) return [];
    const nit = s['tax_id']
      ? `${s['tax_id']}${s['verification_digit'] ? '-' + s['verification_digit'] : ''}`
      : '';
    const all: Array<{ label: string; value: string; wide?: boolean }> = [
      { label: 'NIT', value: nit },
      { label: 'Teléfono', value: (s['phone'] as string) || (s['mobile'] as string) || '' },
      { label: 'Email', value: (s['email'] as string) || '', wide: true },
      { label: 'Contacto', value: (s['contact_person'] as string) || '', wide: true },
      { label: 'Términos de pago', value: (s['payment_terms'] as string) || '' },
      {
        label: 'Lead time',
        value: s['lead_time_days'] ? `${s['lead_time_days']} días` : '',
      },
      { label: 'Categoría', value: (s['supplier_category'] as string) || '' },
      { label: 'Estado', value: (s['state'] as string) || '' },
      { label: 'Banco', value: (s['bank_name'] as string) || '', wide: true },
    ];
    return all.filter((f) => f.value !== '');
  });

  /** Cuántos campos quedaron sin capturar, para decirlo una vez en la cabecera. */
  readonly missingIdentityCount = computed(() => {
    if (!this.supplier()) return 0;
    return 9 - this.identityFields().length;
  });

  private supplierId = 0;

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.loadError.set(true);
      this.loading.set(false);
      return;
    }
    this.supplierId = id;
    this.load(id);
  }

  private load(id: number): void {
    this.loading.set(true);
    // La identidad llega dentro del resumen: `GET /:id` no alcanza a los
    // proveedores de organización y su 404 tumbaba el forkJoin entero.
    forkJoin({
      summary: this.suppliersService.getSupplierSummary(id),
      orders: this.suppliersService.getSupplierPurchaseOrders(
        id,
        1,
        this.pageSize,
      ),
      payables: this.suppliersService.getSupplierPayables(id, 1, this.pageSize),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, orders, payables }) => {
          this.supplier.set(summary?.data?.supplier ?? null);
          this.summary.set(summary?.data ?? null);
          this.orders.set(orders?.data ?? []);
          this.ordersTotal.set((orders as any)?.meta?.total ?? 0);
          this.payables.set(payables?.data ?? []);
          this.payablesTotal.set((payables as any)?.meta?.total ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  onOrdersPageChange(page: number): void {
    this.ordersPage.set(page);
    this.loadingOrders.set(true);
    this.suppliersService
      .getSupplierPurchaseOrders(this.supplierId, page, this.pageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.orders.set(res?.data ?? []);
          this.ordersTotal.set((res as any)?.meta?.total ?? 0);
          this.loadingOrders.set(false);
        },
        error: () => this.loadingOrders.set(false),
      });
  }

  onPayablesPageChange(page: number): void {
    this.payablesPage.set(page);
    this.loadingPayables.set(true);
    this.suppliersService
      .getSupplierPayables(this.supplierId, page, this.pageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.payables.set(res?.data ?? []);
          this.payablesTotal.set((res as any)?.meta?.total ?? 0);
          this.loadingPayables.set(false);
        },
        error: () => this.loadingPayables.set(false),
      });
  }

  /** Una orden listada tiene que llevar a la orden. */
  openOrder(row: SupplierPurchaseOrderRow): void {
    this.router.navigate(['/admin/orders/purchase-orders', row.id]);
  }

  /**
   * La CxP no tiene pantalla propia; su documento origen sí. Cuando el origen
   * es una orden de compra se abre esa orden, que es donde el usuario puede
   * actuar sobre la deuda.
   */
  openPayableSource(row: SupplierPayableRow): void {
    if (row.source_type === 'purchase_order' && row.source_id) {
      this.router.navigate(['/admin/orders/purchase-orders', row.source_id]);
    }
  }

  /**
   * `order_date` y `due_date` llegan crudas. Se formatean en la zona del
   * navegador y no con un `America/Bogota` fijo: el operador está en la tienda,
   * y codificar un país rompería para cualquier tenant fuera de Colombia.
   */
  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
}
