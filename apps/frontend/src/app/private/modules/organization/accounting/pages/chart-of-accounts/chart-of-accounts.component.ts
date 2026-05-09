import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  AlertBannerComponent,
  SpinnerComponent,
  EmptyStateComponent,
  BadgeComponent,
} from '../../../../../../shared/components/index';
import { OrgAccountingService, ChartAccountRow } from '../../services/org-accounting.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Plan de Cuentas (consolidado).
 * Read-only listing consuming /api/organization/accounting/chart-of-accounts.
 */
@Component({
  selector: 'vendix-org-chart-of-accounts',
  standalone: true,
  imports: [CardComponent, AlertBannerComponent, SpinnerComponent, EmptyStateComponent, BadgeComponent],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2">
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Plan de Cuentas</h1>
        <p class="text-xs md:text-sm text-text-secondary mt-1">
          PUC consolidado de la organización
        </p>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" [title]="'No se pudo cargar el plan de cuentas'">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [padding]="false" customClasses="mt-2">
        @if (loading()) {
          <div class="p-8"><app-spinner [center]="true" text="Cargando cuentas..." /></div>
        } @else if (rows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="book-open"
            title="Sin cuentas"
            description="Aún no se ha generado el plan de cuentas para tu organización."
            [showActionButton]="false"
          />
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-xs md:text-sm">
              <thead class="bg-background-soft border-b border-border">
                <tr class="text-left text-text-secondary">
                  <th class="px-3 py-2 font-medium">Código</th>
                  <th class="px-3 py-2 font-medium">Nombre</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Tipo</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Acepta asientos</th>
                  <th class="px-3 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.id) {
                  <tr class="border-b border-border/40 hover:bg-background-soft/50">
                    <td class="px-3 py-2 font-mono">{{ row.account_code }}</td>
                    <td class="px-3 py-2">{{ row.account_name }}</td>
                    <td class="px-3 py-2 hidden md:table-cell">{{ row.account_type || '—' }}</td>
                    <td class="px-3 py-2 hidden md:table-cell">
                      {{ row.accepts_entries ? 'Sí' : 'No' }}
                    </td>
                    <td class="px-3 py-2">
                      <app-badge
                        [variant]="row.is_active ? 'success' : 'neutral'"
                        size="sm"
                      >{{ row.is_active ? 'Activa' : 'Inactiva' }}</app-badge>
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
export class OrgChartOfAccountsComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<ChartAccountRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.service
      .getChartOfAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[OrgChartOfAccounts] load failed', err);
          this.errorMessage.set(this.errors.humanize(err, 'No se pudo cargar el plan de cuentas.'));
          this.loading.set(false);
        },
      });
  }
}
