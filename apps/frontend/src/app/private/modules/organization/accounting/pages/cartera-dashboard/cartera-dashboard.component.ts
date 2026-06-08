import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { OrgCarteraService } from '../../services/org-cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  CarteraDashboard,
  AgingReport,
  AgingBucket,
  AccountReceivable,
  AccountPayable,
} from '../../../../store/accounting/interfaces/cartera.interface';
import {
  AlertBannerComponent,
  CardComponent,
  IconComponent,
  StatsComponent,
} from '../../../../../../shared/components/index';

interface CarteraDashboardBundle {
  ar_dashboard: CarteraDashboard | null;
  ap_dashboard: CarteraDashboard | null;
  ar_aging: AgingReport | null;
  ap_aging: AgingReport | null;
  ar_upcoming: AccountReceivable[];
  ap_upcoming: AccountPayable[];
}

@Component({
  selector: 'vendix-org-cartera-dashboard',
  standalone: true,
  imports: [DatePipe, AlertBannerComponent, CardComponent, IconComponent, StatsComponent],
  template: `
    @if (is_loading()) {
      <div class="p-8 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p class="mt-2 text-text-secondary">Cargando dashboard de cartera...</p>
      </div>
    } @else {
      <div class="space-y-6">
        @if (errorMessage(); as msg) {
          <app-alert-banner variant="danger" title="No se pudo cargar el dashboard de cartera">
            {{ msg }}
          </app-alert-banner>
        }

        <!-- ══════ CUENTAS POR COBRAR ══════ -->
        <div>
          <h2 class="text-lg font-semibold text-text-primary mb-3 flex items-center gap-2">
            <app-icon name="file-input" [size]="20" class="text-blue-600"></app-icon>
            Cuentas por Cobrar
          </h2>

          @if (ar_dashboard()) {
            <div class="stats-container">
              <app-stats
                title="Pendiente"
                [value]="ar_total_pending()"
                smallText="Total por cobrar"
                iconName="wallet"
                iconBgColor="bg-blue-100"
                iconColor="text-blue-600"
                [loading]="is_loading()"
              ></app-stats>
              <app-stats
                title="Vencido"
                [value]="ar_total_overdue()"
                smallText="Requiere atencion"
                iconName="alert-triangle"
                iconBgColor="bg-red-100"
                iconColor="text-red-600"
                [loading]="is_loading()"
              ></app-stats>
              <app-stats
                title="Proximo a Vencer"
                [value]="ar_due_soon()"
                smallText="Proximos 7 dias"
                iconName="calendar-clock"
                iconBgColor="bg-amber-100"
                iconColor="text-amber-600"
                [loading]="is_loading()"
              ></app-stats>
              <app-stats
                title="Cobrado este Mes"
                [value]="ar_collected_month()"
                smallText="Total cobrado"
                iconName="check-circle"
                iconBgColor="bg-emerald-100"
                iconColor="text-emerald-600"
                [loading]="is_loading()"
              ></app-stats>
            </div>
          }

          @if (ar_aging(); as ar_aging) {
            @if (ar_aging.buckets.length > 0) {
              <app-card [responsive]="true">
                <div class="p-4">
                  <h3 class="text-sm font-semibold text-text-primary mb-3">
                    Antiguedad de Cartera (CxC)
                  </h3>
                  <div class="space-y-2">
                    @for (bucket of ar_aging.buckets; track bucket.label; let i = $index) {
                      <div class="flex items-center gap-3">
                        <span class="text-xs text-gray-500 w-24 shrink-0">{{ bucket.label }}</span>
                        <div class="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                          <div
                            class="h-full rounded-full transition-all duration-300"
                            [class]="getAgingBarColor(i)"
                            [style.width]="getAgingBarWidth(bucket, ar_aging)"
                          ></div>
                        </div>
                        <span class="text-xs font-mono font-medium w-28 text-right shrink-0">
                          {{ format(bucket.total) }}
                        </span>
                        <span class="text-xs text-gray-400 w-8 text-right shrink-0">
                          {{ bucket.count }}
                        </span>
                      </div>
                    }
                  </div>
                  <div class="flex justify-between mt-3 pt-3 border-t border-border text-sm">
                    <span class="font-semibold">Total</span>
                    <span class="font-bold font-mono">{{ format(ar_aging.totals.grand_total) }}</span>
                  </div>
                </div>
              </app-card>
            }
          }

          @if (ar_upcoming().length > 0) {
            <app-card [responsive]="true" class="mt-4">
              <div class="p-4">
                <h3 class="text-sm font-semibold text-text-primary mb-3">
                  Proximos Vencimientos (CxC)
                </h3>
                <div class="space-y-2">
                  @for (item of ar_upcoming(); track item.id) {
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div class="min-w-0">
                        <p class="text-sm font-medium truncate">
                          {{ item.customer?.name || '—' }}
                        </p>
                        <p class="text-xs text-gray-500">
                          {{ item.document_number || '—' }} · Vence:
                          {{ item.due_date | date: 'dd/MM/yyyy' }}
                        </p>
                      </div>
                      <span class="text-sm font-semibold font-mono text-primary shrink-0 ml-3">
                        {{ format(item.balance) }}
                      </span>
                    </div>
                  }
                </div>
              </div>
            </app-card>
          }
        </div>

        <!-- ══════ CUENTAS POR PAGAR ══════ -->
        <div>
          <h2 class="text-lg font-semibold text-text-primary mb-3 flex items-center gap-2">
            <app-icon name="file-output" [size]="20" class="text-orange-600"></app-icon>
            Cuentas por Pagar
          </h2>

          @if (ap_dashboard()) {
            <div class="stats-container">
              <app-stats
                title="Pendiente"
                [value]="ap_total_pending()"
                smallText="Total por pagar"
                iconName="wallet"
                iconBgColor="bg-orange-100"
                iconColor="text-orange-600"
                [loading]="is_loading()"
              ></app-stats>
              <app-stats
                title="Vencido"
                [value]="ap_total_overdue()"
                smallText="Requiere atencion"
                iconName="alert-triangle"
                iconBgColor="bg-red-100"
                iconColor="text-red-600"
                [loading]="is_loading()"
              ></app-stats>
              <app-stats
                title="Proximo a Vencer"
                [value]="ap_due_soon()"
                smallText="Proximos 7 dias"
                iconName="calendar-clock"
                iconBgColor="bg-amber-100"
                iconColor="text-amber-600"
                [loading]="is_loading()"
              ></app-stats>
              <app-stats
                title="Pagado este Mes"
                [value]="ap_paid_month()"
                smallText="Total pagado"
                iconName="check-circle"
                iconBgColor="bg-emerald-100"
                iconColor="text-emerald-600"
                [loading]="is_loading()"
              ></app-stats>
            </div>
          }

          @if (ap_aging(); as ap_aging) {
            @if (ap_aging.buckets.length > 0) {
              <app-card [responsive]="true">
                <div class="p-4">
                  <h3 class="text-sm font-semibold text-text-primary mb-3">
                    Antiguedad de Cartera (CxP)
                  </h3>
                  <div class="space-y-2">
                    @for (bucket of ap_aging.buckets; track bucket.label; let i = $index) {
                      <div class="flex items-center gap-3">
                        <span class="text-xs text-gray-500 w-24 shrink-0">{{ bucket.label }}</span>
                        <div class="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                          <div
                            class="h-full rounded-full transition-all duration-300"
                            [class]="getAgingBarColor(i)"
                            [style.width]="getAgingBarWidth(bucket, ap_aging)"
                          ></div>
                        </div>
                        <span class="text-xs font-mono font-medium w-28 text-right shrink-0">
                          {{ format(bucket.total) }}
                        </span>
                        <span class="text-xs text-gray-400 w-8 text-right shrink-0">
                          {{ bucket.count }}
                        </span>
                      </div>
                    }
                  </div>
                  <div class="flex justify-between mt-3 pt-3 border-t border-border text-sm">
                    <span class="font-semibold">Total</span>
                    <span class="font-bold font-mono">{{ format(ap_aging.totals.grand_total) }}</span>
                  </div>
                </div>
              </app-card>
            }
          }

          @if (ap_upcoming().length > 0) {
            <app-card [responsive]="true" class="mt-4">
              <div class="p-4">
                <h3 class="text-sm font-semibold text-text-primary mb-3">
                  Proximos Vencimientos (CxP)
                </h3>
                <div class="space-y-2">
                  @for (item of ap_upcoming(); track item.id) {
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div class="min-w-0">
                        <p class="text-sm font-medium truncate">
                          {{ item.supplier?.name || '—' }}
                        </p>
                        <p class="text-xs text-gray-500">
                          {{ item.document_number || '—' }} · Vence:
                          {{ item.due_date | date: 'dd/MM/yyyy' }}
                        </p>
                      </div>
                      <span class="text-sm font-semibold font-mono text-primary shrink-0 ml-3">
                        {{ format(item.balance) }}
                      </span>
                    </div>
                  }
                </div>
              </div>
            </app-card>
          }
        </div>
      </div>
    }
  `,
})
export class OrgCarteraDashboardComponent {
  private readonly service = inject(OrgCarteraService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly is_loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  private readonly bundle = signal<CarteraDashboardBundle>({
    ar_dashboard: null,
    ap_dashboard: null,
    ar_aging: null,
    ap_aging: null,
    ar_upcoming: [],
    ap_upcoming: [],
  });

  constructor() {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('store_id')),
        switchMap((storeId) => {
          this.is_loading.set(true);
          this.errorMessage.set(null);
          return forkJoin({
            ar_dashboard: this.service.getArDashboard(storeId).pipe(
              map((r) => r.data),
              catchError(() => of(null)),
            ),
            ap_dashboard: this.service.getApDashboard(storeId).pipe(
              map((r) => r.data),
              catchError(() => of(null)),
            ),
            ar_aging: this.service.getArAging(storeId).pipe(
              map((r) => r.data),
              catchError(() => of(null)),
            ),
            ap_aging: this.service.getApAging(storeId).pipe(
              map((r) => r.data),
              catchError(() => of(null)),
            ),
            ar_upcoming: this.service.getArUpcoming(7, storeId).pipe(
              map((r) => r.data ?? []),
              catchError(() => of([] as AccountReceivable[])),
            ),
            ap_upcoming: this.service.getApUpcoming(7, storeId).pipe(
              map((r) => r.data ?? []),
              catchError(() => of([] as AccountPayable[])),
            ),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.bundle.set(data as CarteraDashboardBundle);
          this.is_loading.set(false);
        },
        error: () => {
          this.errorMessage.set('No se pudo cargar el dashboard de cartera.');
          this.is_loading.set(false);
        },
      });
  }

  readonly ar_dashboard = computed(() => this.bundle().ar_dashboard);
  readonly ap_dashboard = computed(() => this.bundle().ap_dashboard);
  readonly ar_aging = computed(() => this.bundle().ar_aging);
  readonly ap_aging = computed(() => this.bundle().ap_aging);
  readonly ar_upcoming = computed(() => this.bundle().ar_upcoming);
  readonly ap_upcoming = computed(() => this.bundle().ap_upcoming);

  // ── Format helpers ──────────────────────────────────

  format(value: number): string {
    return this.currencyService.format(value || 0);
  }

  readonly ar_total_pending = computed(() => this.format(this.ar_dashboard()?.total_pending || 0));
  readonly ar_total_overdue = computed(() => this.format(this.ar_dashboard()?.total_overdue || 0));
  readonly ar_due_soon = computed(() => this.format(this.ar_dashboard()?.due_soon || 0));
  readonly ar_collected_month = computed(() =>
    this.format(this.ar_dashboard()?.collected_this_month || 0),
  );
  readonly ap_total_pending = computed(() => this.format(this.ap_dashboard()?.total_pending || 0));
  readonly ap_total_overdue = computed(() => this.format(this.ap_dashboard()?.total_overdue || 0));
  readonly ap_due_soon = computed(() => this.format(this.ap_dashboard()?.due_soon || 0));
  readonly ap_paid_month = computed(() => this.format(this.ap_dashboard()?.paid_this_month || 0));

  // ── Aging helpers ───────────────────────────────────

  getAgingBarWidth(bucket: AgingBucket, report: AgingReport): string {
    if (!report || report.totals.grand_total === 0) return '0%';
    const pct = (bucket.total / report.totals.grand_total) * 100;
    return `${Math.max(pct, 2)}%`;
  }

  getAgingBarColor(index: number): string {
    const colors = [
      'bg-emerald-400',
      'bg-blue-400',
      'bg-amber-400',
      'bg-orange-400',
      'bg-red-400',
      'bg-red-600',
    ];
    return colors[index] || 'bg-gray-400';
  }
}
