import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subject, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  InvoiceOrderLookupService,
  InvoiceOrderOption,
} from '../../services/invoice-order-lookup.service';

const SEARCH_DEBOUNCE_MS = 300;

/** `orders.state` → etiqueta del comerciante. Sólo presentación. */
const ORDER_STATE_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  processing: 'En proceso',
  shipped: 'Enviado',
  delivered: 'Entregado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  refunded: 'Devuelto',
  draft: 'Borrador',
};

/**
 * BUSCADOR DEL PEDIDO A FACTURAR.
 *
 * ─── QUÉ SUSTITUYE ──────────────────────────────────────────────────────────
 *
 * A `<app-input label="ID del pedido" type="number">`. Literal del comerciante:
 * «si la creo desde orden me pide el ID de la orden; debe pedirme el ID de la
 * orden o el código de la orden, porque no todo el mundo conoce el ID». Y tiene
 * razón: el id es la clave primaria y no aparece en ninguna pantalla suya —
 * lista, ticket y WhatsApp muestran `order_number`.
 *
 * ─── EL CONTRATO NO CAMBIA ──────────────────────────────────────────────────
 *
 * El valor del control SIGUE SIENDO el `id` numérico: es lo que consume
 * `POST /store/invoicing/from-order/:orderId`. Lo que cambia es cómo se llega a
 * él. Escribir un número puro sigue funcionando (se resuelve por id además de
 * por texto), así que quien sí conocía el id no pierde nada.
 *
 * Es un `ControlValueAccessor` para poder colgarse del `orderIdControl` que ya
 * existía, con sus validadores intactos.
 */
@Component({
  selector: 'vendix-invoice-order-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InvoiceOrderSelectComponent),
      multi: true,
    },
  ],
  template: `
    <div class="relative">
      <label
        class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
      >
        Pedido a facturar
        <span class="text-error">*</span>
      </label>

      @if (selected(); as order) {
        <div
          class="flex items-center gap-3 rounded-lg border border-border bg-[var(--color-surface-secondary)] px-3 py-2.5"
        >
          <app-icon name="receipt" [size]="16" class="shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-text-primary">
              {{ order.orderNumber }}
            </span>
            <span
              class="block truncate text-xs text-[var(--color-text-secondary)]"
            >
              {{ describe(order) }}
            </span>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-md p-1 text-[var(--color-text-secondary)] transition-colors hover:text-error"
            [disabled]="isDisabled()"
            title="Elegir otro pedido"
            (click)="clear()"
          >
            <app-icon name="x" [size]="16" />
          </button>
        </div>
      } @else {
        <div class="relative">
          <span
            class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-secondary)]"
          >
            <app-icon name="search" [size]="16" />
          </span>
          <input
            type="text"
            autocomplete="off"
            [placeholder]="placeholder()"
            class="w-full h-11 pl-9 pr-3 rounded-lg border border-border bg-[var(--color-surface)] text-text-primary placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-colors disabled:opacity-60"
            [value]="query()"
            [disabled]="isDisabled()"
            (input)="onQuery($event)"
            (focus)="onFocus()"
          />
        </div>

        @if (panelOpen()) {
          <div
            class="absolute z-[10000] left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-[var(--color-surface)] shadow-lg"
          >
            @if (loading()) {
              <p
                class="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-text-secondary)]"
              >
                <app-icon name="loader-2" [size]="14" [spin]="true" />
                Buscando pedidos…
              </p>
            } @else if (results().length === 0) {
              <p class="px-3 py-3 text-xs text-[var(--color-text-secondary)]">
                @if (query().trim()) {
                  Ningún pedido coincide con «{{ query().trim() }}». Busca por
                  número de pedido, nombre o correo del cliente — o pega el id si
                  lo conoces.
                } @else {
                  No hay pedidos para mostrar.
                }
              </p>
            } @else {
              @for (order of results(); track order.id) {
                <button
                  type="button"
                  class="w-full px-3 py-2 text-left transition-colors hover:bg-primary-50"
                  (click)="select(order)"
                >
                  <span
                    class="flex items-center justify-between gap-2 text-sm text-text-primary"
                  >
                    <span class="truncate font-medium">{{
                      order.orderNumber
                    }}</span>
                    <span class="shrink-0 tabular-nums">{{
                      formatCurrency(order.total)
                    }}</span>
                  </span>
                  <span
                    class="block truncate text-xs text-[var(--color-text-secondary)]"
                  >
                    {{ describe(order) }}
                  </span>
                </button>
              }
            }
          </div>
        }
      }

      @if (error()) {
        <p class="mt-1 text-xs text-error">{{ error() }}</p>
      } @else {
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
          Busca por número de pedido (p. ej. <code>ORD-000142</code>), por
          cliente o por su id.
        </p>
      }
    </div>
  `,
})
export class InvoiceOrderSelectComponent implements ControlValueAccessor {
  private readonly lookup = inject(InvoiceOrderLookupService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly placeholder = input<string>('Número de pedido, cliente o id...');
  readonly error = input<string | undefined>(undefined);

  readonly query = signal('');
  readonly results = signal<InvoiceOrderOption[]>([]);
  readonly selected = signal<InvoiceOrderOption | null>(null);
  readonly loading = signal(false);
  readonly panelOpen = signal(false);
  private readonly disabledState = signal(false);

  private readonly search$ = new Subject<string>();

  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  readonly isDisabled = computed(() => this.disabledState());

  constructor() {
    this.search$
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((term) =>
          this.lookup
            .search(term)
            .pipe(catchError(() => of([] as InvoiceOrderOption[]))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((options) => {
        this.loading.set(false);
        this.results.set(options);
      });
  }

  // ── ControlValueAccessor ────────────────────────────────────

  writeValue(value: number | null): void {
    if (value == null) {
      this.selected.set(null);
      this.query.set('');
      return;
    }
    // Un id escrito desde fuera todavía no tiene etiqueta: se resuelve para que
    // el usuario vea QUÉ pedido quedó elegido y no un número desnudo.
    this.selected.set({
      id: value,
      orderNumber: `Pedido #${value}`,
      state: '',
      customerName: '',
      total: 0,
      createdAt: '',
    });
    this.lookup
      .getById(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((order) => {
        if (order) this.selected.set(order);
      });
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
    if (isDisabled) this.panelOpen.set(false);
  }

  // ── Interacción ─────────────────────────────────────────────

  onFocus(): void {
    if (this.isDisabled()) return;
    this.panelOpen.set(true);
    if (this.results().length === 0 && !this.loading()) {
      this.search$.next(this.query());
    }
  }

  onQuery(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.query.set(term);
    this.panelOpen.set(true);
    this.search$.next(term);
  }

  select(order: InvoiceOrderOption): void {
    this.selected.set(order);
    this.results.set([]);
    this.query.set('');
    this.panelOpen.set(false);
    this.onChange(order.id);
    this.onTouched();
  }

  clear(): void {
    if (this.isDisabled()) return;
    this.selected.set(null);
    this.results.set([]);
    this.query.set('');
    this.onChange(null);
    this.onTouched();
  }

  describe(order: InvoiceOrderOption): string {
    const state = ORDER_STATE_LABELS[order.state] ?? order.state;
    return [order.customerName, state, formatDate(order.createdAt)]
      .filter(Boolean)
      .join(' · ');
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.panelOpen()) return;
    const inside = event
      .composedPath()
      .some((node) => node === this.elementRef.nativeElement);
    if (!inside) {
      this.panelOpen.set(false);
      this.onTouched();
    }
  }
}

/**
 * `created_at` recortado a fecha. Se parte la cadena ISO en vez de construir un
 * `Date`: `new Date('2026-08-15')` es medianoche UTC y en Bogotá se pinta como
 * el día 14 (ver `vendix-date-timezone`).
 */
function formatDate(value: string): string {
  if (!value) return '';
  return value.split('T')[0] ?? '';
}
