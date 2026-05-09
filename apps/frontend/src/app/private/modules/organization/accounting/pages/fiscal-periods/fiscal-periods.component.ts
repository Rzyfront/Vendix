import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  CardComponent,
  AlertBannerComponent,
  SpinnerComponent,
  EmptyStateComponent,
  BadgeComponent,
} from '../../../../../../shared/components/index';
import {
  OrgAccountingService,
  FiscalPeriodRow,
} from '../../services/org-accounting.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Periodos Fiscales (read-only).
 */
@Component({
  selector: 'vendix-org-fiscal-periods',
  standalone: true,
  imports: [
    CardComponent,
    AlertBannerComponent,
    SpinnerComponent,
    EmptyStateComponent,
    BadgeComponent,
    DatePipe,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2">
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Periodos Fiscales</h1>
        <p class="text-xs md:text-sm text-text-secondary mt-1">
          Periodos contables de la organización
        </p>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar los periodos">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [padding]="false" customClasses="mt-2">
        @if (loading()) {
          <div class="p-8"><app-spinner [center]="true" text="Cargando periodos..." /></div>
        } @else if (rows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="calendar"
            title="Sin periodos"
            description="Aún no hay periodos fiscales configurados."
            [showActionButton]="false"
          />
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-xs md:text-sm">
              <thead class="bg-background-soft border-b border-border">
                <tr class="text-left text-text-secondary">
                  <th class="px-3 py-2 font-medium">Nombre</th>
                  <th class="px-3 py-2 font-medium">Año</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Inicio</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Fin</th>
                  <th class="px-3 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.id) {
                  <tr class="border-b border-border/40 hover:bg-background-soft/50">
                    <td class="px-3 py-2 font-medium">{{ row.name || ('Periodo ' + row.id) }}</td>
                    <td class="px-3 py-2">{{ row.period_year || '—' }}</td>
                    <td class="px-3 py-2 hidden md:table-cell">
                      {{ row.start_date | date: 'shortDate' }}
                    </td>
                    <td class="px-3 py-2 hidden md:table-cell">
                      {{ row.end_date | date: 'shortDate' }}
                    </td>
                    <td class="px-3 py-2">
                      <app-badge [variant]="row.status === 'closed' ? 'neutral' : 'success'" size="sm">
                        {{ row.status === 'closed' ? 'Cerrado' : 'Abierto' }}
                      </app-badge>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class OrgFiscalPeriodsComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<FiscalPeriodRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.service
      .getFiscalPeriods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgFiscalPeriods] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los periodos fiscales.'),
          );
          this.loading.set(false);
        },
      });
  }
}
