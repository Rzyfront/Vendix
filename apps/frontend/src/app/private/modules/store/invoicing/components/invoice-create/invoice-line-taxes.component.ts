import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  TaxOption,
  TaxSelection,
} from '../../../../../../shared/components/tax-selector';

/**
 * IMPUESTOS DE UNA LÍNEA — VARIOS, DEL CATÁLOGO REAL DE LA TIENDA.
 *
 * ─── QUÉ SUSTITUYE ──────────────────────────────────────────────────────────
 *
 * Al `app-tax-selector` compartido, que es de UN SOLO impuesto y que en esta
 * pantalla se alimentaba de cuatro tarifas escritas a mano (IVA 19/5/0 e INC 8).
 * Dos problemas distintos:
 *
 *  1. **Una línea colombiana lleva más de un impuesto.** IVA + INC conviven en
 *     el mismo renglón de un restaurante, e IVA + ICUI en una bebida azucarada.
 *     Con un solo selector, el segundo impuesto no se podía declarar: la factura
 *     salía correcta ante el motor y equivocada ante la DIAN.
 *  2. **El catálogo escrito a mano ignora los impuestos de la tienda.** Un
 *     comerciante que creó su propia tarifa no la encontraba, y terminaba
 *     facturando con la más parecida.
 *
 * ─── POR QUÉ ES UN `ControlValueAccessor` ───────────────────────────────────
 *
 * Porque la versión anterior guardaba la selección en un `Map` paralelo al
 * formulario, indexado primero por posición y después por `row_uid`. Un estado
 * espejo del formulario es un estado que se desincroniza: basta con que alguien
 * añada un `removeAt` sin tocar el `Map`. Siendo un CVA, el impuesto ES el valor
 * del control `taxes` de la línea — viaja con el `FormArray`, sobrevive a
 * reordenamientos y no hay una segunda copia que pueda mentir.
 *
 * ─── QUÉ NO CALCULA ─────────────────────────────────────────────────────────
 *
 * Nada. `taxable_amount` y `tax_amount` los pone el padre en `0` y los recalcula
 * el backend (`InvoiceCalculatorService`, `Prisma.Decimal`). Este componente
 * sólo declara QUÉ tarifa aplica y si va incluida en el precio o encima de él.
 */
@Component({
  selector: 'vendix-invoice-line-taxes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InvoiceLineTaxesComponent),
      multi: true,
    },
  ],
  template: `
    <div class="relative">
      <div class="flex flex-wrap items-center gap-1.5">
        @for (tax of value(); track tax.tax_rate_id) {
          <span
            class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border border-border bg-[var(--color-surface)] text-[11px]"
            [title]="tax.name"
          >
            <span class="font-medium text-text-primary max-w-[7rem] truncate">
              {{ tax.name }}
            </span>
            <span class="text-[var(--color-text-secondary)]">
              {{ formatRate(tax.rate) }}%
            </span>
            <button
              type="button"
              class="px-1 rounded text-[10px] font-semibold uppercase tracking-wide"
              [class.text-primary]="tax.is_inclusive"
              [class.text-warning]="!tax.is_inclusive"
              [disabled]="isDisabled()"
              [title]="inclusiveHint(tax)"
              (click)="toggleInclusive(tax.tax_rate_id)"
            >
              {{ tax.is_inclusive ? 'Incl.' : 'Adic.' }}
            </button>
            <button
              type="button"
              class="p-0.5 text-[var(--color-text-secondary)] hover:text-error"
              [disabled]="isDisabled()"
              aria-label="Quitar impuesto"
              (click)="remove(tax.tax_rate_id)"
            >
              <app-icon name="x" [size]="12" />
            </button>
          </span>
        }

        <button
          type="button"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-border text-[11px] text-[var(--color-text-secondary)] hover:border-primary-600 hover:text-primary transition-colors disabled:opacity-50"
          [disabled]="isDisabled()"
          (click)="togglePanel($event)"
        >
          <app-icon name="plus" [size]="12" />
          @if (value().length === 0) {
            Sin impuesto
          } @else {
            Agregar
          }
        </button>
      </div>

      @if (panelOpen()) {
        <div
          class="absolute z-[10000] top-full left-0 mt-1 w-64 max-h-64 overflow-y-auto rounded-lg border border-border bg-[var(--color-surface)] shadow-lg"
        >
          <div class="p-2 border-b border-border">
            <input
              type="text"
              class="w-full px-2 py-1.5 text-xs border border-border rounded-md bg-[var(--color-surface)] text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              placeholder="Buscar impuesto..."
              autocomplete="off"
              [value]="query()"
              (input)="onQuery($event)"
              (keydown.escape)="closePanel()"
            />
          </div>

          @if (catalogEmpty()) {
            <p class="p-3 text-xs text-[var(--color-text-secondary)]">
              La tienda no tiene impuestos configurados. Créalos en Ajustes →
              Impuestos; una factura sin impuesto es válida sólo si la operación
              realmente es excluida o exenta.
            </p>
          } @else if (visibleTaxes().length === 0) {
            <p class="p-3 text-xs text-[var(--color-text-secondary)]">
              Ningún impuesto coincide con la búsqueda.
            </p>
          } @else {
            @for (option of visibleTaxes(); track option.id) {
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary-50 transition-colors"
                (click)="toggleTax(option)"
              >
                <span
                  class="w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center"
                  [class.border-primary]="isSelected(option.id)"
                  [class.bg-primary]="isSelected(option.id)"
                  [class.border-border]="!isSelected(option.id)"
                >
                  @if (isSelected(option.id)) {
                    <app-icon
                      name="check"
                      [size]="10"
                      class="text-[var(--color-text-on-primary)]"
                    />
                  }
                </span>
                <span class="flex-1 min-w-0">
                  <span class="block text-xs text-text-primary truncate">
                    {{ option.name }}
                  </span>
                  <span
                    class="block text-[10px] text-[var(--color-text-secondary)]"
                  >
                    {{ formatRate(option.rate) }}%
                    @if (option.tax_type) {
                      · {{ option.tax_type.toUpperCase() }}
                    }
                  </span>
                </span>
              </button>
            }
          }
        </div>
      }
    </div>
  `,
})
export class InvoiceLineTaxesComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef);

  /** Catálogo completo de la tienda. Lo carga el padre una sola vez. */
  readonly taxes = input<TaxOption[]>([]);

  /** Valor del control: los impuestos declarados para esta línea. */
  readonly value = signal<TaxSelection[]>([]);
  readonly panelOpen = signal(false);
  readonly query = signal('');
  private readonly disabledState = signal(false);

  readonly catalogEmpty = computed(() => this.taxes().length === 0);

  readonly visibleTaxes = computed<TaxOption[]>(() => {
    const term = this.query().trim().toLowerCase();
    if (!term) return this.taxes();
    return this.taxes().filter((option) => {
      const name = option.name?.toLowerCase() ?? '';
      const type = option.tax_type?.toLowerCase() ?? '';
      return name.includes(term) || type.includes(term);
    });
  });

  private onChange: (value: TaxSelection[]) => void = () => {};
  private onTouched: () => void = () => {};

  // ── ControlValueAccessor ────────────────────────────────────

  writeValue(value: TaxSelection[] | null): void {
    this.value.set(Array.isArray(value) ? [...value] : []);
  }

  registerOnChange(fn: (value: TaxSelection[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
    if (isDisabled) {
      this.panelOpen.set(false);
    }
  }

  isDisabled(): boolean {
    return this.disabledState();
  }

  // ── Interacción ─────────────────────────────────────────────

  togglePanel(event: Event): void {
    event.stopPropagation();
    if (this.isDisabled()) return;
    this.query.set('');
    this.panelOpen.update((open) => !open);
  }

  closePanel(): void {
    this.panelOpen.set(false);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  isSelected(taxRateId: number): boolean {
    return this.value().some((tax) => tax.tax_rate_id === taxRateId);
  }

  toggleTax(option: TaxOption): void {
    if (this.isDisabled()) return;
    if (this.isSelected(option.id)) {
      this.remove(option.id);
      return;
    }
    this.commit([
      ...this.value(),
      {
        tax_rate_id: option.id,
        rate: option.rate,
        name: option.name,
        tax_type: option.tax_type,
        // El default del catálogo (`tax_rates.is_inclusive`) es una decisión ya
        // tomada por el comerciante al configurar el impuesto; imponer
        // "adicional" aquí la contradiría en silencio.
        is_inclusive: option.default_is_inclusive ?? false,
      },
    ]);
  }

  toggleInclusive(taxRateId: number): void {
    if (this.isDisabled()) return;
    this.commit(
      this.value().map((tax) =>
        tax.tax_rate_id === taxRateId
          ? { ...tax, is_inclusive: !tax.is_inclusive }
          : tax,
      ),
    );
  }

  remove(taxRateId: number): void {
    if (this.isDisabled()) return;
    this.commit(this.value().filter((tax) => tax.tax_rate_id !== taxRateId));
  }

  formatRate(rate: number | null | undefined): string {
    if (rate == null) return '0';
    return Number.isInteger(rate) ? String(rate) : rate.toFixed(2);
  }

  inclusiveHint(tax: TaxSelection): string {
    return tax.is_inclusive
      ? 'El impuesto ya está dentro del precio unitario. Click para cambiarlo a adicional.'
      : 'El impuesto se suma sobre el precio unitario. Click para cambiarlo a incluido.';
  }

  private commit(next: TaxSelection[]): void {
    this.value.set(next);
    this.onChange(next);
    this.onTouched();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.panelOpen()) return;
    const inside = event
      .composedPath()
      .some((node) => node === this.elementRef.nativeElement);
    if (!inside) {
      this.closePanel();
      this.onTouched();
    }
  }
}
