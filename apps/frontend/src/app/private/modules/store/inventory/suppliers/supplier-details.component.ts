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

import { CardComponent } from '../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
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
 * modal, por consistencia con el perfil de cliente que ya resuelve este mismo
 * problema del otro lado del mostrador.
 *
 * REQUISITO DURO del ticket: las cifras se CONSUMEN del backend, que a su vez
 * las deriva del contrato de métrica (`PURCHASE_COMMITTED_STATES`). Este
 * componente no calcula ningún agregado propio. Agregar una tercera definición
 * de "cuánto le he comprado a este proveedor" garantizaba un tercer desacuerdo,
 * que es literalmente el bug de QUI-625.
 */
@Component({
  selector: 'vendix-supplier-details',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="pb-6 space-y-4">
      <!-- Encabezado -->
      <div class="flex items-center gap-3 px-1">
        <app-button variant="outline" size="sm" (clicked)="goBack()">
          <app-icon name="arrow-left" [size]="16"></app-icon>
        </app-button>
        <div class="min-w-0">
          <h1 class="text-lg font-bold text-[var(--color-text-primary)] truncate">
            {{ supplier()?.name || 'Proveedor' }}
          </h1>
          <p class="text-xs text-[var(--color-text-secondary)]">
            @if (summary(); as s) {
              <!--
                El alcance se DECLARA: en una organización con alcance
                ORGANIZATION estas cifras suman todas las tiendas, y sin decirlo
                el usuario de una tienda leería deuda que no es suya.
              -->
              {{ s.scope === 'ORGANIZATION'
                  ? 'Cifras de toda la organización'
                  : 'Cifras de esta tienda' }}
            } @else {
              Perfil del proveedor
            }
          </p>
        </div>
      </div>

      @if (loading()) {
        <div class="stats-container">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
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
            existe porque nace con la recepción. Va como tarjeta aparte para no
            mezclarla con lo que sí cuadra contra contabilidad.
          -->
          <app-stats
            title="Comprometido"
            [value]="summary()?.committed_amount | currency"
            [smallText]="(summary()?.committed_orders || 0) + ' órdenes sin recibir'"
            iconName="clock"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>

          <app-stats
            title="Ticket promedio"
            [value]="summary()?.average_order_value | currency"
            [smallText]="lastOrderLabel()"
            iconName="calculator"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
        </div>

        <!-- Identidad -->
        <app-card shadow="none" [showHeader]="true" [padding]="false">
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Identidad</span>
          </div>
          <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            @for (field of identityFields(); track field.label) {
              <div class="flex flex-col">
                <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {{ field.label }}
                </span>
                <span class="text-[var(--color-text-primary)]">{{ field.value }}</span>
              </div>
            }
          </div>
        </app-card>

        <!-- Historial de órdenes -->
        <app-card shadow="none" [showHeader]="true" [padding]="false">
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Órdenes de compra</span>
            <span class="text-xs text-[var(--color-text-secondary)]">
              {{ ordersTotal() }} en total
            </span>
          </div>
          <div class="p-4 overflow-x-auto">
            @if (orders().length === 0) {
              <p class="text-sm text-[var(--color-text-secondary)] py-4 text-center">
                Sin órdenes de compra para este proveedor.
              </p>
            } @else {
              <table class="w-full text-sm min-w-[640px]">
                <thead>
                  <tr class="text-left text-xs text-[var(--color-text-secondary)] border-b border-border">
                    <th class="py-2 pr-4 font-medium">Orden</th>
                    <th class="py-2 pr-4 font-medium">Fecha</th>
                    <th class="py-2 pr-4 font-medium">Estado</th>
                    <th class="py-2 pr-4 font-medium">Pago</th>
                    <th class="py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of orders(); track row.id) {
                    <tr class="border-b border-border/50">
                      <td class="py-2 pr-4 text-[var(--color-text-primary)]">
                        {{ row.order_number }}
                      </td>
                      <td class="py-2 pr-4 text-[var(--color-text-secondary)]">
                        {{ formatDate(row.order_date) }}
                      </td>
                      <td class="py-2 pr-4">
                        <app-badge [variant]="statusVariant(row.status)" size="xsm">
                          {{ statusLabel(row.status) }}
                        </app-badge>
                      </td>
                      <td class="py-2 pr-4 text-[var(--color-text-secondary)]">
                        {{ paymentLabel(row.payment_status) }}
                      </td>
                      <td class="py-2 text-right tabular-nums text-[var(--color-text-primary)]">
                        {{ +row.total_amount | currency }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
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
          <div class="p-4 overflow-x-auto">
            @if (payables().length === 0) {
              <p class="text-sm text-[var(--color-text-secondary)] py-4 text-center">
                Sin cuentas por pagar a este proveedor.
              </p>
            } @else {
              <table class="w-full text-sm min-w-[640px]">
                <thead>
                  <tr class="text-left text-xs text-[var(--color-text-secondary)] border-b border-border">
                    <th class="py-2 pr-4 font-medium">Documento</th>
                    <th class="py-2 pr-4 font-medium">Vence</th>
                    <th class="py-2 pr-4 font-medium">Estado</th>
                    <th class="py-2 pr-4 font-medium text-right">Original</th>
                    <th class="py-2 font-medium text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of payables(); track row.id) {
                    <tr class="border-b border-border/50">
                      <td class="py-2 pr-4 text-[var(--color-text-primary)]">
                        {{ row.document_number || (row.source_type + ' #' + (row.source_id ?? '—')) }}
                      </td>
                      <td class="py-2 pr-4 text-[var(--color-text-secondary)]">
                        {{ formatDate(row.due_date) }}
                        @if (row.days_overdue > 0) {
                          <span class="text-red-600 font-medium"> · {{ row.days_overdue }} d</span>
                        }
                      </td>
                      <td class="py-2 pr-4">
                        <app-badge
                          [variant]="row.status === 'open' ? (row.days_overdue > 0 ? 'error' : 'warning') : 'success'"
                          size="xsm"
                        >
                          {{ row.status === 'open' ? (row.days_overdue > 0 ? 'Vencida' : 'Abierta') : 'Pagada' }}
                        </app-badge>
                      </td>
                      <td class="py-2 pr-4 text-right tabular-nums text-[var(--color-text-secondary)]">
                        {{ +row.original_amount | currency }}
                      </td>
                      <td class="py-2 text-right tabular-nums text-[var(--color-text-primary)]">
                        {{ +row.balance | currency }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </app-card>
      }
    </div>
  `,
})
export class SupplierDetailsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly suppliersService = inject(SuppliersService);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly supplier = signal<Supplier | null>(null);
  readonly summary = signal<SupplierSummary | null>(null);
  readonly orders = signal<SupplierPurchaseOrderRow[]>([]);
  readonly ordersTotal = signal(0);
  readonly payables = signal<SupplierPayableRow[]>([]);

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

  readonly identityFields = computed(() => {
    const s = this.supplier() as (Supplier & Record<string, unknown>) | null;
    if (!s) return [];
    const nit = s['tax_id']
      ? `${s['tax_id']}${s['verification_digit'] ? '-' + s['verification_digit'] : ''}`
      : '—';
    return [
      { label: 'NIT', value: nit },
      { label: 'Contacto', value: (s['contact_person'] as string) || '—' },
      { label: 'Email', value: (s['email'] as string) || '—' },
      { label: 'Teléfono', value: (s['phone'] as string) || (s['mobile'] as string) || '—' },
      { label: 'Términos de pago', value: (s['payment_terms'] as string) || '—' },
      { label: 'Lead time', value: s['lead_time_days'] ? `${s['lead_time_days']} días` : '—' },
      { label: 'Categoría', value: (s['supplier_category'] as string) || '—' },
      { label: 'Estado', value: (s['state'] as string) || '—' },
      { label: 'Banco', value: (s['bank_name'] as string) || '—' },
    ];
  });

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.loadError.set(true);
      this.loading.set(false);
      return;
    }
    this.load(id);
  }

  private load(id: number): void {
    this.loading.set(true);
    // La identidad llega dentro del resumen: `GET /:id` no alcanza a los
    // proveedores de organización y su 404 tumbaba el forkJoin entero.
    forkJoin({
      summary: this.suppliersService.getSupplierSummary(id),
      orders: this.suppliersService.getSupplierPurchaseOrders(id, 1, 10),
      payables: this.suppliersService.getSupplierPayables(id, 1, 10),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, orders, payables }) => {
          this.supplier.set(summary?.data?.supplier ?? null);
          this.summary.set(summary?.data ?? null);
          this.orders.set(orders?.data ?? []);
          this.ordersTotal.set((orders as any)?.meta?.total ?? 0);
          this.payables.set(payables?.data ?? []);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/admin/inventory/suppliers']);
  }

  statusLabel(status: string): string {
    return SupplierDetailsComponent.STATUS_LABELS[status] ?? status;
  }

  paymentLabel(status: string): string {
    return SupplierDetailsComponent.PAYMENT_LABELS[status] ?? status;
  }

  statusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
    if (status === 'received') return 'success';
    if (status === 'cancelled') return 'error';
    if (status === 'draft') return 'neutral';
    return 'warning';
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
