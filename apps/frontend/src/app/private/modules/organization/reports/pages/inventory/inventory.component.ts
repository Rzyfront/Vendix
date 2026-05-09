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
  OrgInventorySummary,
} from '../../services/org-reports.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Reporte de Inventario consolidado.
 */
@Component({
  selector: 'vendix-org-inventory-report',
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
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Reporte de Inventario</h1>
        <p class="text-xs md:text-sm text-text-secondary mt-1">
          Resumen consolidado de inventario
        </p>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el reporte de inventario">
          {{ msg }}
        </app-alert-banner>
      }

      @if (loading()) {
        <div class="p-8"><app-spinner [center]="true" text="Cargando..." /></div>
      } @else if (summary(); as s) {
        <div class="stats-container grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
          <app-stats
            title="Productos"
            [value]="s.total_products ?? 0"
            iconName="package"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          />
          <app-stats
            title="Unidades"
            [value]="s.total_units ?? 0"
            iconName="layers"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          />
          <app-stats
            title="Valor total"
            [value]="asNumber(s.total_value)"
            iconName="dollar-sign"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
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
                    <th class="px-3 py-2 font-medium text-right">Unidades</th>
                    <th class="px-3 py-2 font-medium text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  @for (b of s.by_store; track b.store_id) {
                    <tr class="border-b border-border/40 hover:bg-background-soft/50">
                      <td class="px-3 py-2">{{ b.store_name }}</td>
                      <td class="px-3 py-2 text-right">{{ b.units }}</td>
                      <td class="px-3 py-2 text-right">{{ asNumber(b.value) | currency }}</td>
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
              No hay desglose por tienda disponible.
            </p>
          </app-card>
        }
      }
    </div>
  `,
})
export class OrgInventoryReportComponent {
  private readonly service = inject(OrgReportsService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly summary = signal<OrgInventorySummary | null>(null);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.service
      .getInventorySummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.summary.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgInventoryReport] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el reporte de inventario.'),
          );
          this.loading.set(false);
        },
      });
  }

  asNumber(v: number | string | undefined | null): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }
}
