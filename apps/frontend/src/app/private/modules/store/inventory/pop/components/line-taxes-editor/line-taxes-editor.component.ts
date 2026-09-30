import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type {
  PopLineTax,
  PurchaseTaxBaseMode,
  PurchaseTaxType,
} from '../../interfaces/pop-cart.interface';
import { deriveLineTaxes } from '../../utils/purchase-line-tax.util';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';

const TAX_LABELS: Record<PurchaseTaxType, string> = {
  iva: 'IVA',
  inc: 'INC',
  icui: 'ICUI',
  ibua: 'IBUA',
};
const TAX_ORDER: PurchaseTaxType[] = ['iva', 'inc', 'icui', 'ibua'];

/** Etiqueta corta de un impuesto: «IVA», «INC», «ICUI», «IBUA». */
export function taxTypeLabel(type: PurchaseTaxType): string {
  return TAX_LABELS[type] ?? String(type).toUpperCase();
}

/**
 * QUI-855 — editor multi-impuesto de UNA línea de compra (IVA / INC / ICUI /
 * IBUA, máx. 4, uno por tipo). Extraído del carrito POP para compartirlo con el
 * modal de precarga por IA.
 *
 * Es de presentación pura: no conoce el carrito ni el escáner. Recibe las filas
 * y los datos de la línea, muestra el desglose del kernel
 * (`purchase-line-taxes`, vía `deriveLineTaxes`) y EMITE cambios; quien lo usa
 * decide dónde guardarlos.
 */
@Component({
  selector: 'app-line-taxes-editor',
  standalone: true,
  imports: [FormsModule, IconComponent, InputComponent, ToggleComponent],
  template: `
    <div class="flex flex-col gap-1 text-[10px]">
      <div class="flex flex-wrap items-center gap-2">
        <span class="uppercase tracking-wider font-bold text-text-secondary/60">
          Impuestos
        </span>
        @if (needsReview()) {
          <span
            class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700"
          >
            <app-icon name="alert-triangle" [size]="10"></app-icon>
            Confirma el impuesto
          </span>
        }
        <div class="ml-auto flex items-center gap-1.5">
          <span class="text-text-secondary">
            {{ pricesIncludeTax() ? 'Incluido' : 'Agregado' }}
          </span>
          <app-toggle
            [checked]="pricesIncludeTax()"
            (changed)="pricesIncludeTaxChange.emit($event)"
            ariaLabel="Precio con impuestos incluidos para esta línea"
          ></app-toggle>
        </div>
      </div>

      @for (tax of rows(); track tax.tax_type) {
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
          <span class="w-9 font-bold uppercase text-text-primary">
            {{ label(tax.tax_type) }}
          </span>
          @if (tax.calc_mode === 'fixed_per_unit') {
            <div class="flex items-center gap-1">
              <span class="text-text-secondary">$</span>
              <app-input
                type="number"
                size="sm"
                [ngModel]="tax.fixed_amount_per_unit"
                (ngModelChange)="updateFixedAmount(tax.tax_type, $event)"
                customInputClass="text-right !h-7 !py-0 !w-16"
                customWrapperClass="!mt-0"
                min="0"
                step="0.01"
              ></app-input>
              <span class="text-text-secondary">por unidad</span>
            </div>
          } @else {
            <div class="flex items-center gap-1">
              <app-input
                type="number"
                size="sm"
                [ngModel]="tax.tax_rate"
                (ngModelChange)="updateRate(tax.tax_type, $event)"
                customInputClass="text-right !h-7 !py-0 !w-14"
                customWrapperClass="!mt-0"
                min="0"
                step="0.01"
              ></app-input>
              <span class="text-text-secondary">%</span>
            </div>
          }
          <div class="flex items-center gap-1">
            <span class="text-text-secondary">
              {{ rowInclusive(tax) ? 'Incl.' : 'Agr.' }}
            </span>
            <app-toggle
              [checked]="rowInclusive(tax)"
              (changed)="patchRow(tax.tax_type, { is_inclusive: $event })"
              [ariaLabel]="'Impuesto ' + label(tax.tax_type) + ' incluido en el precio'"
            ></app-toggle>
          </div>
          @if (tax.calc_mode !== 'fixed_per_unit' && rows().length > 1) {
            <select
              class="h-7 text-[10px] px-1 py-0 border border-border rounded bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              [value]="tax.base_mode ?? 'net'"
              (change)="onBaseModeChange(tax.tax_type, $event)"
              aria-label="Base del impuesto"
            >
              <option value="net">Base: neto</option>
              <option value="net_plus_prior">Base: neto + anteriores</option>
            </select>
          }
          @if (tax.tax_type === 'iva') {
            <label class="flex items-center gap-1 text-text-secondary">
              <input
                type="checkbox"
                class="h-3.5 w-3.5 accent-primary"
                [checked]="tax.add_to_cost"
                (change)="
                  patchRow(tax.tax_type, { add_to_cost: $any($event.target).checked })
                "
              />
              Al costo
            </label>
          } @else {
            <span class="text-text-secondary">Al costo: sí</span>
          }
          <span class="ml-auto font-medium text-text-primary">
            {{ formatCurrency(amountOf(tax.tax_type)) }}
          </span>
          @if (rows().length > 1) {
            <button
              type="button"
              class="text-text-secondary hover:text-destructive"
              (click)="removeRow(tax.tax_type)"
              [attr.aria-label]="'Quitar impuesto ' + label(tax.tax_type)"
            >
              <app-icon name="trash" [size]="12"></app-icon>
            </button>
          }
        </div>
      }

      @if (availableTypes().length > 0) {
        @if (adding()) {
          <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <span class="text-text-secondary">Tipo:</span>
            @for (type of availableTypes(); track type) {
              <button
                type="button"
                class="rounded border border-border px-2 py-0.5 font-medium text-text-primary hover:border-primary hover:bg-primary/5"
                (click)="addRow(type)"
              >
                {{ label(type) }}
              </button>
            }
            <button
              type="button"
              class="text-text-secondary hover:underline"
              (click)="adding.set(false)"
            >
              Cancelar
            </button>
          </div>
        } @else {
          <button
            type="button"
            class="inline-flex items-center gap-1 self-start pt-1 font-medium text-primary hover:underline"
            (click)="adding.set(true)"
          >
            <app-icon name="plus" [size]="10"></app-icon>
            Agregar impuesto
          </button>
        }
      }

      <!-- Desglose con los montos del kernel. -->
      <div class="flex flex-wrap items-center gap-x-2 pt-1 text-text-secondary">
        <span>Neto {{ formatCurrency(derived().net_line) }}</span>
        <span>· Impuestos {{ formatCurrency(derived().tax_amount) }}</span>
        @if (derived().capitalized_tax_total > 0) {
          <span>· Al costo {{ formatCurrency(derived().capitalized_tax_total) }}</span>
        }
      </div>
    </div>
  `,
})
export class LineTaxesEditorComponent {
  private readonly currencyService = inject(CurrencyFormatService);

  /**
   * Filas a editar. El padre entrega SIEMPRE al menos una (una línea legacy se
   * convierte antes en su fila IVA); PORCENTAJE en `tax_rate`.
   */
  readonly taxes = input<PopLineTax[]>([]);
  /** Precio unitario tal como se captura (bruto si `pricesIncludeTax`). */
  readonly unitPrice = input<number>(0);
  readonly quantity = input<number>(0);
  /** Descuento propio de la línea en DINERO, sobre ese mismo precio. */
  readonly discountAmount = input<number>(0);
  /** Modo efectivo de la línea; el de cada fila lo pisa si trae `is_inclusive`. */
  readonly pricesIncludeTax = input<boolean>(false);
  /** La tasa nunca se capturó: muestra «Confirma el impuesto». */
  readonly needsReview = input<boolean>(false);

  readonly taxesChange = output<PopLineTax[]>();
  /** El operador movió el toggle de modo de LA LÍNEA. */
  readonly pricesIncludeTaxChange = output<boolean>();

  /** ¿Está abierto el selector de tipo de impuesto? */
  readonly adding = signal(false);

  readonly rows = computed<PopLineTax[]>(() => {
    const t = this.taxes();
    return t.length > 0 ? t : [{ tax_type: 'iva', tax_rate: null, calc_mode: 'percent', add_to_cost: false }];
  });

  /** Línea derivada por el kernel (montos por impuesto, neto, al costo). */
  readonly derived = computed(() =>
    deriveLineTaxes(
      {
        unit_price: this.unitPrice(),
        quantity: this.quantity(),
        discount_amount: this.discountAmount(),
        prices_include_tax: this.pricesIncludeTax(),
        taxes: this.rows(),
      },
      { prices_include_tax: this.pricesIncludeTax() },
      0,
    ),
  );

  /** Tipos todavía no usados en la línea (sin duplicar; máx. 4). */
  readonly availableTypes = computed<PurchaseTaxType[]>(() => {
    const rows = this.rows();
    if (rows.length >= 4) return [];
    const used = new Set(rows.map((t) => t.tax_type));
    return TAX_ORDER.filter((t) => !used.has(t));
  });

  label(type: PurchaseTaxType): string {
    return taxTypeLabel(type);
  }

  rowInclusive(tax: PopLineTax): boolean {
    return tax.is_inclusive ?? this.pricesIncludeTax();
  }

  amountOf(type: PurchaseTaxType): number {
    return this.derived().taxes.find((t) => t.tax_type === type)?.tax_amount ?? 0;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount || 0);
  }

  /** Agrega una fila del tipo elegido (arranca en 0; INC/ICUI/IBUA al costo). */
  addRow(type: PurchaseTaxType): void {
    const rows = this.rows();
    if (rows.length >= 4 || rows.some((t) => t.tax_type === type)) return;
    const row: PopLineTax =
      type === 'ibua'
        ? {
            tax_type: 'ibua',
            calc_mode: 'fixed_per_unit',
            fixed_amount_per_unit: 0,
            tax_rate: null,
            add_to_cost: true,
          }
        : {
            tax_type: type,
            calc_mode: 'percent',
            tax_rate: 0,
            add_to_cost: type !== 'iva',
          };
    this.taxesChange.emit([...rows, row]);
    this.adding.set(false);
  }

  /** Quita la fila de ese tipo (siempre queda al menos una). */
  removeRow(type: PurchaseTaxType): void {
    const rows = this.rows();
    if (rows.length <= 1) return;
    this.taxesChange.emit(rows.filter((t) => t.tax_type !== type));
  }

  updateRate(type: PurchaseTaxType, rate: number | string): void {
    const parsed = Number(rate);
    this.patchRow(type, {
      tax_rate: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    });
  }

  updateFixedAmount(type: PurchaseTaxType, amount: number | string): void {
    const parsed = Number(amount);
    this.patchRow(type, {
      fixed_amount_per_unit: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    });
  }

  onBaseModeChange(type: PurchaseTaxType, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const base_mode: PurchaseTaxBaseMode =
      value === 'net_plus_prior' ? 'net_plus_prior' : 'net';
    this.patchRow(type, { base_mode });
  }

  patchRow(type: PurchaseTaxType, patch: Partial<PopLineTax>): void {
    this.taxesChange.emit(
      this.rows().map((t) => (t.tax_type === type ? { ...t, ...patch } : t)),
    );
  }
}
