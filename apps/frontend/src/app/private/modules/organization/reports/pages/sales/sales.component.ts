import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  AlertBannerComponent,
  SpinnerComponent,
  StatsComponent,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgReportsService,
  OrgSalesSummary,
} from '../../services/org-reports.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Reporte de Ventas (consolidado + breakdown por tienda).
 */
@Component({
  selector: 'vendix-org-sales-report',
  standalone: true,
  imports: [
    CardComponent,
    AlertBannerComponent,
    SpinnerComponent,
    StatsComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2">
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Reporte de Ventas</h1>
        <p class="text-xs md:text-sm text-text-secondary mt-1">
          Resumen consolidado de ventas
        </p>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el reporte de ventas">
          {{ msg }}
        </app-alert-banner>
      }

      @if (loading()) {
        <div class="p-8"><app-spinner [center]="true" text="Cargando reporte..." /></div>
      } @else if (summary(); as s) {
        <div class="stats-container grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <app-stats
            title="Órdenes"
            [value]="s.total_orders ?? 0"
            iconName="shopping-bag"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          />
          <app-stats
            title="Ingreso bruto"
            [value]="formatMoney(s.total_revenue)"
            iconName="dollar-sign"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          />
          <app-stats
            title="Impuestos"
            [value]="formatMoney(s.total_taxes)"
            iconName="percent"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          />
          <app-stats
            title="Ingreso neto"
            [value]="formatMoney(s.net_revenue)"
            iconName="trending-up"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [clickable]="false"
          />
        </div>

        @if (s.by_store && s.by_store.length > 0) {
          <app-card [padding]="false">
            <div class="px-3 py-2 border-b border-border bg-background-soft">
              <h2 class="text-sm md:text-base font-semibold">Detalle por tienda</h2>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs md:text-sm">
                <thead class="bg-background-soft border-b border-border">
                  <tr class="text-left text-text-secondary">
                    <th class="px-3 py-2 font-medium">Tienda</th>
                    <th class="px-3 py-2 font-medium text-right">Órdenes</th>
                    <th class="px-3 py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (b of s.by_store; track b.store_id) {
                    <tr class="border-b border-border/40 hover:bg-background-soft/50">
                      <td class="px-3 py-2">{{ b.store_name }}</td>
                      <td class="px-3 py-2 text-right">{{ b.orders }}</td>
                      <td class="px-3 py-2 text-right">{{ asNumber(b.total) | currency }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>
        } @else {
          <!-- TODO: backend payload mismatch — by_store missing -->
          <app-card>
            <p class="text-sm text-text-secondary">
              No hay desglose por tienda disponible en este momento.
            </p>
          </app-card>
        }
      }
    </div>
  `,
})
export class OrgSalesReportComponent {
  private readonly service = inject(OrgReportsService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly summary = signal<OrgSalesSummary | null>(null);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.service
      .getSalesSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.summary.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgSalesReport] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el reporte de ventas.'),
          );
          this.loading.set(false);
        },
      });
  }

  asNumber(v: number | string | undefined | null): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  formatMoney(v: number | string | undefined | null): number {
    return this.asNumber(v);
  }
}
