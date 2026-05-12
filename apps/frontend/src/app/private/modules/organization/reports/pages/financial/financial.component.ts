import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  CardComponent,
  AlertBannerComponent,
  SpinnerComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgReportsService,
  OrgTrialBalance,
} from '../../services/org-reports.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Balance de Comprobación (Trial Balance) consolidado.
 */
@Component({
  selector: 'vendix-org-financial-report',
  standalone: true,
  imports: [
    CardComponent,
    AlertBannerComponent,
    SpinnerComponent,
    EmptyStateComponent,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2">
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Balance de Comprobación</h1>
        <p class="text-xs md:text-sm text-text-secondary mt-1">
          Reporte financiero consolidado
        </p>
        @if (data(); as d) {
          @if (d.period_start || d.period_end) {
            <p class="text-xs text-text-secondary mt-1">
              {{ d.period_start | date: 'shortDate' }} — {{ d.period_end | date: 'shortDate' }}
            </p>
          }
        }
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el balance">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [padding]="false" customClasses="mt-2">
        @if (loading()) {
          <div class="p-8"><app-spinner [center]="true" text="Cargando..." /></div>
        } @else if (!data() || (data()?.lines?.length ?? 0) === 0) {
          <app-empty-state
            icon="bar-chart"
            title="Sin datos"
            description="No hay datos para el período actual."
            [showActionButton]="false"
          />
        } @else if (data(); as d) {
          <div class="overflow-x-auto">
            <table class="w-full text-xs md:text-sm">
              <thead class="bg-background-soft border-b border-border">
                <tr class="text-left text-text-secondary">
                  <th class="px-3 py-2 font-medium">Código</th>
                  <th class="px-3 py-2 font-medium">Cuenta</th>
                  <th class="px-3 py-2 font-medium text-right">Débito</th>
                  <th class="px-3 py-2 font-medium text-right">Crédito</th>
                  <th class="px-3 py-2 font-medium text-right hidden md:table-cell">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (line of d.lines; track line.account_code) {
                  <tr class="border-b border-border/40 hover:bg-background-soft/50">
                    <td class="px-3 py-2 font-mono">{{ line.account_code }}</td>
                    <td class="px-3 py-2">{{ line.account_name }}</td>
                    <td class="px-3 py-2 text-right">{{ asNumber(line.debit) | currency }}</td>
                    <td class="px-3 py-2 text-right">{{ asNumber(line.credit) | currency }}</td>
                    <td class="px-3 py-2 text-right hidden md:table-cell">
                      {{ asNumber(line.balance) | currency }}
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot class="bg-background-soft border-t-2 border-border font-semibold">
                <tr>
                  <td class="px-3 py-2" colspan="2">Totales</td>
                  <td class="px-3 py-2 text-right">{{ asNumber(d.total_debit) | currency }}</td>
                  <td class="px-3 py-2 text-right">{{ asNumber(d.total_credit) | currency }}</td>
                  <td class="px-3 py-2 hidden md:table-cell"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class OrgFinancialReportComponent {
  private readonly service = inject(OrgReportsService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly data = signal<OrgTrialBalance | null>(null);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.service
      .getTrialBalance()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.data.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgFinancialReport] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el balance.'),
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
