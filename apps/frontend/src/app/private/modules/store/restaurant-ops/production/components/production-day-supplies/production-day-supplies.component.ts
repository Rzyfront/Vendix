import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
} from '../../../../../../../shared/components';
import { ProductionDaySupplies } from '../../interfaces';
import { ProductionApiScope, ProductionOrdersService } from '../../services';
import {
  ProductionDaySummaryCounts,
  formatSupplyQty,
  shouldAutoOpenDaySummary,
} from './production-day-supplies.util';

const PRINT_BODY_CLASS = 'production-supplies-printing';
const EMPTY_SUMMARY: ProductionDaySummaryCounts = { waiting: 0, in_progress: 0, completed: 0 };

/**
 * Panel "Consumo del día" (planned vs consumed vs pending supplies of one
 * day) plus the "Resumen de producción del día" modal. Quantities only, never
 * cost. Mounted by the day list and the active board, so restaurant, Planta
 * and scheduled-orders day all get it. The host passes its day, API scope and
 * summary, and bumps `refreshToken` on every successful reload (live SSE
 * refreshes included) so the panel reloads with it.
 */
@Component({
  selector: 'app-production-day-supplies',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Global on purpose: the print rules must reach the body and the modal overlay.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'block' },
  imports: [ButtonComponent, IconComponent, ModalComponent, SpinnerComponent],
  styles: [
    `
      .ps-print-title {
        display: none;
      }
      @media print {
        body.${PRINT_BODY_CLASS} * {
          visibility: hidden;
        }
        body.${PRINT_BODY_CLASS} .ps-print-area,
        body.${PRINT_BODY_CLASS} .ps-print-area * {
          visibility: visible;
        }
        body.${PRINT_BODY_CLASS} .ps-print-area {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          overflow: visible;
        }
        body.${PRINT_BODY_CLASS} .ps-no-print {
          display: none !important;
        }
        body.${PRINT_BODY_CLASS} .ps-print-title {
          display: block;
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
        }
      }
    `,
  ],
  template: `
    <section class="mb-3 rounded-xl border border-border bg-surface shadow-sm">
      <header class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left"
          [attr.aria-expanded]="expanded()"
          (click)="toggle()"
        >
          <app-icon [name]="expanded() ? 'chevron-up' : 'chevron-down'" [size]="16" />
          <span class="truncate text-sm font-semibold text-text-primary">Consumo del día</span>
        </button>
        @if (canShowSummary()) {
          <app-button variant="outline" size="sm" (clicked)="openSummary()">
            <app-icon slot="icon" name="file-text" [size]="14" />
            Resumen del día
          </app-button>
        }
      </header>

      @if (expanded()) {
        <div class="border-t border-border px-3 py-2">
          @if (loading() && !supplies()) {
            <div class="flex justify-center py-4"><app-spinner /></div>
          } @else if (errorMessage() && !supplies()) {
            <p class="py-2 text-sm text-text-secondary">{{ errorMessage() }}</p>
          } @else if (supplies(); as s) {
            @if (s.supplies.length === 0) {
              <p class="py-2 text-sm text-text-secondary">
                No hay insumos planificados para este día.
              </p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-[11px] uppercase text-text-secondary">
                      <th class="py-1 pr-2">Insumo</th>
                      <th class="py-1 pr-2">Unidad</th>
                      <th class="py-1 pr-2 text-right">Planificado</th>
                      <th class="py-1 pr-2 text-right">Consumido</th>
                      <th class="py-1 text-right">Pendiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of s.supplies; track row.product_id) {
                      <tr class="border-t border-border">
                        <td class="py-1 pr-2 text-text-primary">{{ row.name }}</td>
                        <td class="py-1 pr-2 text-text-secondary">{{ row.unit || '—' }}</td>
                        <td class="py-1 pr-2 text-right">{{ qty(row.planned) }}</td>
                        <td class="py-1 pr-2 text-right">{{ qty(row.consumed) }}</td>
                        <td class="py-1 text-right font-medium">{{ qty(row.pending) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            @if (s.orders_without_breakdown > 0) {
              <p class="mt-2 text-xs text-text-secondary">
                {{ s.orders_without_breakdown }} órdenes finalizadas antes de este cambio no tienen desglose de consumo.
              </p>
            }
          }
        </div>
      }
    </section>

    <app-modal
      [isOpen]="summaryOpen()"
      (isOpenChange)="summaryOpen.set($event)"
      title="Resumen de producción del día"
      size="lg"
      [fullScreenOnMobile]="true"
    >
      <div class="ps-print-area flex flex-col gap-3">
        <div class="ps-print-title">Resumen de producción del día — {{ date() }}</div>
        @if (supplies(); as s) {
          <p class="text-sm text-text-secondary">
            {{ s.orders_completed }} de {{ s.orders_total }} órdenes finalizadas
          </p>
          @if (s.supplies.length === 0) {
            <p class="text-sm text-text-secondary">No hay insumos planificados para este día.</p>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-[11px] uppercase text-text-secondary">
                    <th class="py-1 pr-2">Insumo</th>
                    <th class="py-1 pr-2">Unidad</th>
                    <th class="py-1 pr-2 text-right">Planificado</th>
                    <th class="py-1 pr-2 text-right">Consumido</th>
                    <th class="py-1 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of s.supplies; track row.product_id) {
                    <tr class="border-t border-border">
                      <td class="py-1 pr-2 text-text-primary">{{ row.name }}</td>
                      <td class="py-1 pr-2 text-text-secondary">{{ row.unit || '—' }}</td>
                      <td class="py-1 pr-2 text-right">{{ qty(row.planned) }}</td>
                      <td class="py-1 pr-2 text-right">{{ qty(row.consumed) }}</td>
                      <td class="py-1 text-right font-medium">{{ qty(row.difference) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else if (loading()) {
          <div class="flex justify-center py-4"><app-spinner /></div>
        }
      </div>
      <div slot="footer" class="ps-no-print flex justify-end">
        <app-button variant="primary" [disabled]="!supplies()" (clicked)="print()">
          <app-icon slot="icon" name="printer" [size]="16" />
          Imprimir
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ProductionDaySuppliesComponent {
  private readonly service = inject(ProductionOrdersService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);

  /** YYYY-MM-DD of the day the host shows. */
  readonly date = input.required<string>();
  readonly apiScope = input<ProductionApiScope>('restaurant');
  /** Any value that changes whenever the host reloads its day (its data signal works). */
  readonly refreshToken = input<unknown>(null);
  /** The host's day summary: drives the "Resumen del día" button and its auto-open. */
  readonly summary = input<ProductionDaySummaryCounts>(EMPTY_SUMMARY);

  readonly supplies = signal<ProductionDaySupplies | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly expanded = signal(true);
  readonly summaryOpen = signal(false);

  readonly canShowSummary = computed(() => this.summary().completed > 0);

  private loadSub: Subscription | null = null;
  /** `date|scope` of the data on screen: a change of key drops it, a refresh keeps it. */
  private loadedKey: string | null = null;
  /** Last summary reading of the day on screen (session only). */
  private lastSeen: { date: string; summary: ProductionDaySummaryCounts } | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.loadSub?.unsubscribe());

    effect(() => {
      const date = this.date();
      const scope = this.apiScope();
      this.refreshToken();
      untracked(() => this.load(date, scope));
    });

    effect(() => {
      const date = this.date();
      const summary = this.summary();
      untracked(() => {
        const prev = this.lastSeen?.date === date ? this.lastSeen.summary : null;
        this.lastSeen = { date, summary };
        if (shouldAutoOpenDaySummary(prev, summary)) this.summaryOpen.set(true);
      });
    });
  }

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  openSummary(): void {
    this.summaryOpen.set(true);
  }

  qty(value: number | null | undefined): string {
    return formatSupplyQty(value);
  }

  /** Same print pattern as the production list page: body class + @media print rules. */
  print(): void {
    const body = this.doc.body;
    body.classList.add(PRINT_BODY_CLASS);
    try {
      window.print();
    } finally {
      body.classList.remove(PRINT_BODY_CLASS);
    }
  }

  private load(date: string, scope: ProductionApiScope): void {
    this.loadSub?.unsubscribe();
    const key = `${date}|${scope}`;
    if (this.loadedKey !== key) this.supplies.set(null);
    this.loadedKey = key;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.loadSub = this.service.getDaySupplies(date, scope).subscribe({
      next: (res) => {
        this.supplies.set(res);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        // A background refresh that fails keeps the numbers on screen.
        if (this.supplies()) return;
        this.errorMessage.set(
          typeof err === 'string' ? err : 'No se pudo cargar el consumo del día',
        );
      },
    });
  }
}
