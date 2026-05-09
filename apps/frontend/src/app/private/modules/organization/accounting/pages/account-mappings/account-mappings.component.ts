import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  AlertBannerComponent,
  SpinnerComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components/index';
import {
  OrgAccountingService,
  AccountMappingRow,
} from '../../services/org-accounting.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Mapeo de Cuentas (read-only).
 */
@Component({
  selector: 'vendix-org-account-mappings',
  standalone: true,
  imports: [
    CardComponent,
    AlertBannerComponent,
    SpinnerComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2">
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Mapeo de Cuentas</h1>
        <p class="text-xs md:text-sm text-text-secondary mt-1">
          Vinculación entre eventos del sistema y cuentas del PUC
        </p>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el mapeo de cuentas">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [padding]="false" customClasses="mt-2">
        @if (loading()) {
          <div class="p-8"><app-spinner [center]="true" text="Cargando mapeo..." /></div>
        } @else if (rows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="link"
            title="Sin mapeos"
            description="No hay mapeos configurados todavía."
            [showActionButton]="false"
          />
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-xs md:text-sm">
              <thead class="bg-background-soft border-b border-border">
                <tr class="text-left text-text-secondary">
                  <th class="px-3 py-2 font-medium">Clave</th>
                  <th class="px-3 py-2 font-medium">Código</th>
                  <th class="px-3 py-2 font-medium">Cuenta</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Descripción</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.mapping_key) {
                  <tr class="border-b border-border/40 hover:bg-background-soft/50">
                    <td class="px-3 py-2 font-mono text-xs">{{ row.mapping_key }}</td>
                    <td class="px-3 py-2 font-mono">{{ row.account_code || '—' }}</td>
                    <td class="px-3 py-2">{{ row.account_name || '—' }}</td>
                    <td class="px-3 py-2 hidden md:table-cell text-text-secondary">
                      {{ row.description || '—' }}
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
export class OrgAccountMappingsComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<AccountMappingRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.service
      .getAccountMappings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgAccountMappings] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el mapeo.'),
          );
          this.loading.set(false);
        },
      });
  }
}
