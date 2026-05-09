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
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgAccountingService,
  JournalEntryRow,
} from '../../services/org-accounting.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Asientos Contables (consolidado).
 * Read-only.
 */
@Component({
  selector: 'vendix-org-journal-entries',
  standalone: true,
  imports: [
    CardComponent,
    AlertBannerComponent,
    SpinnerComponent,
    EmptyStateComponent,
    BadgeComponent,
    DatePipe,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2">
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Asientos Contables</h1>
        <p class="text-xs md:text-sm text-text-secondary mt-1">
          Asientos consolidados de la organización
        </p>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar los asientos">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [padding]="false" customClasses="mt-2">
        @if (loading()) {
          <div class="p-8"><app-spinner [center]="true" text="Cargando asientos..." /></div>
        } @else if (rows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="file-text"
            title="Sin asientos"
            description="No se han registrado asientos contables todavía."
            [showActionButton]="false"
          />
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-xs md:text-sm">
              <thead class="bg-background-soft border-b border-border">
                <tr class="text-left text-text-secondary">
                  <th class="px-3 py-2 font-medium">Número</th>
                  <th class="px-3 py-2 font-medium">Fecha</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Tienda</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Descripción</th>
                  <th class="px-3 py-2 font-medium text-right">Débito</th>
                  <th class="px-3 py-2 font-medium text-right">Crédito</th>
                  <th class="px-3 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.id) {
                  <tr class="border-b border-border/40 hover:bg-background-soft/50">
                    <td class="px-3 py-2 font-mono">{{ row.entry_number || row.id }}</td>
                    <td class="px-3 py-2">{{ row.entry_date | date: 'shortDate' }}</td>
                    <td class="px-3 py-2 hidden md:table-cell">
                      {{ row.store?.name || '—' }}
                    </td>
                    <td class="px-3 py-2 hidden md:table-cell truncate max-w-xs">
                      {{ row.description || '—' }}
                    </td>
                    <td class="px-3 py-2 text-right">
                      {{ asNumber(row.total_debit) | currency }}
                    </td>
                    <td class="px-3 py-2 text-right">
                      {{ asNumber(row.total_credit) | currency }}
                    </td>
                    <td class="px-3 py-2">
                      <app-badge [variant]="badgeVariant(row.status)" size="sm">
                        {{ row.status || '—' }}
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
export class OrgJournalEntriesComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<JournalEntryRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.service
      .getJournalEntries()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgJournalEntries] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los asientos.'),
          );
          this.loading.set(false);
        },
      });
  }

  asNumber(v: string | number | undefined | null): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  badgeVariant(status?: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
    switch ((status || '').toLowerCase()) {
      case 'posted':
      case 'approved':
        return 'success';
      case 'draft':
      case 'pending':
        return 'warning';
      case 'voided':
      case 'cancelled':
        return 'error';
      default:
        return 'neutral';
    }
  }
}
