import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { storeToday } from '../../../../../../shared/utils/date.util';
import {
  ProductionList,
  ProductionOption,
  STATUS_LABELS,
  describeVariant,
} from '../../interfaces/scheduled-order.interface';
import { ScheduledOrdersApiService } from '../../services/scheduled-orders-api.service';
import { fullDate } from '../../utils/ymd.util';

/** Clase en <body> que activa las reglas de impresión de esta página. */
const PRINT_BODY_CLASS = 'production-list-printing';

@Component({
  selector: 'app-scheduled-orders-production-list-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sin encapsulación: las reglas @media print deben alcanzar el <body>.
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink, ButtonComponent, IconComponent, SpinnerComponent],
  styles: [
    `
      app-scheduled-orders-production-list-page {
        display: block;
      }
      .pl-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }
      .pl-toolbar-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .pl-date {
        padding: 0.375rem 0.625rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 10px);
        background: var(--color-surface);
        color: var(--color-text-primary);
        font-size: var(--fs-sm, 0.875rem);
      }
      .pl-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg, 14px);
        padding: 0.75rem;
        margin-bottom: 0.75rem;
      }
      .pl-slot-title {
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }
      .pl-order {
        border-top: 1px solid var(--color-border);
        padding: 0.5rem 0;
      }
      .pl-order:first-of-type {
        border-top: 0;
      }
      .pl-order-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.25rem;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .pl-status {
        font-weight: 500;
        font-size: var(--fs-sm, 0.875rem);
        color: var(--color-text-muted);
      }
      .pl-items {
        margin: 0.25rem 0 0;
        padding-left: 1rem;
        color: var(--color-text-primary);
      }
      .pl-options {
        margin: 0;
        padding-left: 1rem;
        font-size: var(--fs-sm, 0.875rem);
        color: var(--color-text-muted);
      }
      .pl-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--fs-sm, 0.875rem);
      }
      .pl-table th,
      .pl-table td {
        text-align: left;
        padding: 0.375rem 0.5rem;
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text-primary);
      }
      .pl-table .num {
        text-align: right;
      }
      .pl-print-title {
        display: none;
      }
      @media print {
        body.${PRINT_BODY_CLASS} * {
          visibility: hidden;
        }
        body.${PRINT_BODY_CLASS} .pl-print-area,
        body.${PRINT_BODY_CLASS} .pl-print-area * {
          visibility: visible;
        }
        body.${PRINT_BODY_CLASS} .pl-print-area {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
        }
        .pl-no-print {
          display: none !important;
        }
        .pl-print-title {
          display: block;
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
        }
        .pl-card {
          break-inside: avoid;
          border: 1px solid #999;
          background: #fff;
        }
        .pl-card,
        .pl-card * {
          color: #000 !important;
        }
      }
    `,
  ],
  template: `
    <div class="p-2 md:p-4">
      <div class="pl-toolbar pl-no-print">
        <h1 class="text-xl font-semibold" style="color: var(--color-text-primary)">
          Lista de producción
        </h1>
        <div class="pl-toolbar-group">
          <a routerLink="/admin/scheduled-orders">
            <app-button variant="ghost" size="sm">
              <app-icon slot="icon" name="arrow-left" [size]="16"></app-icon>
              Agenda
            </app-button>
          </a>
          <input
            type="date"
            class="pl-date"
            aria-label="Fecha de producción"
            [value]="date()"
            (change)="onDateChange($event)"
          />
          <app-button variant="primary" size="sm" [disabled]="!list()" (clicked)="print()">
            <app-icon slot="icon" name="printer" [size]="16"></app-icon>
            Imprimir
          </app-button>
        </div>
      </div>

      @if (loading()) {
        <div class="flex justify-center py-8 pl-no-print"><app-spinner></app-spinner></div>
      } @else if (list(); as data) {
        <div class="pl-print-area">
          <div class="pl-print-title">Lista de producción — {{ dateLabel() }}</div>
          <p class="pl-no-print" style="color: var(--color-text-muted); text-transform: capitalize">
            {{ dateLabel() }}
          </p>

          @if (data.slots.length === 0) {
            <div class="pl-card" style="color: var(--color-text-muted)">
              No hay pedidos programados para este día.
            </div>
          }

          @for (slot of data.slots; track slot.start) {
            <section class="pl-card">
              <div class="pl-slot-title">{{ slot.local_start }} – {{ slot.local_end }}</div>
              @for (order of slot.orders; track order.schedule_id) {
                <div class="pl-order">
                  <div class="pl-order-head">
                    <span>
                      #{{ order.order_number }} · {{ order.customer_name || 'Cliente general' }}
                    </span>
                    <span class="pl-status">{{ statusLabel(order.status) }}</span>
                  </div>
                  <ul class="pl-items">
                    @for (item of order.items; track $index) {
                      <li>
                        {{ item.quantity }} × {{ item.product_name }}
                        @if (variant(item.variant_attributes); as v) {
                          ({{ v }})
                        }
                        @if (item.options.length > 0) {
                          <ul class="pl-options">
                            @for (opt of item.options; track $index) {
                              <li>{{ optionText(opt) }}</li>
                            }
                          </ul>
                        }
                      </li>
                    }
                  </ul>
                </div>
              }
            </section>
          }

          @if (data.ingredients.length > 0) {
            <section class="pl-card">
              <div class="pl-slot-title">Ingredientes consolidados</div>
              <table class="pl-table">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th class="num">Cantidad</th>
                    <th>Unidad</th>
                  </tr>
                </thead>
                <tbody>
                  @for (ing of data.ingredients; track ing.product_id) {
                    <tr>
                      <td>{{ ing.name }}</td>
                      <td class="num">{{ ing.quantity }}</td>
                      <td>{{ ing.uom || '' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }
        </div>
      }
    </div>
  `,
})
export class ProductionListPageComponent {
  private readonly api = inject(ScheduledOrdersApiService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly date = signal<string>(storeToday(this.settings.timezone()));
  readonly list = signal<ProductionList | null>(null);
  readonly loading = signal(false);
  readonly dateLabel = computed(() => fullDate(this.date()));

  private loadSub?: Subscription;

  constructor() {
    // Recarga al cambiar la fecha.
    effect(() => {
      const date = this.date();
      untracked(() => this.load(date));
    });

    // Activa las reglas de impresión solo mientras la página está abierta.
    this.doc.body.classList.add(PRINT_BODY_CLASS);
    this.destroyRef.onDestroy(() => {
      this.doc.body.classList.remove(PRINT_BODY_CLASS);
      this.loadSub?.unsubscribe();
    });
  }

  onDateChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) this.date.set(value);
  }

  print(): void {
    window.print();
  }

  statusLabel(status: keyof typeof STATUS_LABELS): string {
    return STATUS_LABELS[status] ?? status;
  }

  variant(v: Parameters<typeof describeVariant>[0]): string {
    return describeVariant(v);
  }

  optionText(o: ProductionOption): string {
    const qty = Number(o.quantity);
    const extra = qty > 1 || o.uom ? ` (${o.quantity}${o.uom ? ' ' + o.uom : ''})` : '';
    return `${o.group_name}: ${o.option_name}${extra}`;
  }

  private load(date: string): void {
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.loadSub = this.api
      .getProductionList(date)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.list.set(data);
          this.loading.set(false);
        },
        error: (err) => {
          this.list.set(null);
          this.loading.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo cargar la lista de producción.',
          );
        },
      });
  }
}
