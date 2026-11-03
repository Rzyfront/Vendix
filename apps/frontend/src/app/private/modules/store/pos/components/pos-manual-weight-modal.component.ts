import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  model,
  output,
  viewChild,
} from '@angular/core';

import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import {
  convertWeighAmount,
  defaultWeighUnit,
  formatWeighAmount,
  ManualWeighUnit,
  MAX_WEIGH_AMOUNT,
  parseWeighAmount,
  stockUnitsForWeighAmount,
  weighTotal,
} from '../utils/manual-weigh.util';

export interface ManualWeighResult {
  /** Cantidad digitada, en la unidad elegida. */
  amount: number;
  /** Código de la unidad elegida (la que se muestra en el ticket). */
  unitCode: string;
  /** Cantidad convertida a la UoM principal (la del precio). */
  principalAmount: number;
  /** Código de la UoM principal. */
  principalCode: string;
  /** Unidades de stock que se descuentan (redondeadas, como el backend). */
  stockQuantity: number;
  /**
   * Unidades de stock por cada unidad elegida (`factorToBase` de la elegida).
   * Lo anota quien abre el modal; ausente = se deduce de la cantidad.
   */
  unitFactor?: number;
}

/**
 * QUI-978 — pesado manual multi-UoM del POS.
 *
 * Reemplaza los `dialogService.prompt` con `defaultValue: '1.0'` que siempre
 * abrían en "1" y no dejaban borrarlo: acá el campo nace vacío con foco y
 * autoselección, el cajero pesa en cualquiera de las UoMs de venta del
 * producto (la principal por defecto) y ve en vivo la equivalencia y el
 * total. El precio siempre se calcula sobre la principal.
 */
@Component({
  selector: 'app-pos-manual-weight-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="title()"
      size="sm"
      [showCloseButton]="true"
      (isOpenChange)="onModalClose()"
      [dialog]="true"
    >
      <div class="flex flex-col gap-3 py-2">
        @if (message()) {
          <p class="text-sm text-text-secondary whitespace-pre-line">
            {{ message() }}
          </p>
        }

        <div>
          <label
            for="manual-weigh-amount"
            class="text-xs font-semibold text-text-primary mb-1 block"
          >
            Cantidad en {{ activeUnit()?.code ?? '' }}
          </label>
          <div class="relative">
            <input
              #amountInput
              id="manual-weigh-amount"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0"
              [value]="amountText()"
              (input)="amountText.set($any($event.target).value)"
              (focus)="$any($event.target).select()"
              (keydown.enter)="onConfirm()"
              class="h-11 w-full rounded-xl border border-border bg-surface pl-3 pr-14 text-lg font-bold text-text-primary placeholder:text-text-secondary/60 placeholder:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            <span
              class="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary"
            >
              {{ activeUnit()?.code ?? '' }}
            </span>
          </div>
          @if (amountText().trim() !== '' && parsed() == null) {
            <p class="text-xs text-error mt-1 flex items-center gap-1">
              <app-icon name="alert-triangle" [size]="12"></app-icon>
              Escribe un peso mayor a 0.
            </p>
          } @else if (parsed() != null && parsed()! > maxAmount()) {
            <p class="text-xs text-error mt-1 flex items-center gap-1">
              <app-icon name="alert-triangle" [size]="12"></app-icon>
              El máximo es {{ maxAmount() }} {{ activeUnit()?.code ?? '' }}.
            </p>
          }
        </div>

        @if (units().length > 1) {
          <div>
            <p class="text-xs font-semibold text-text-primary mb-1">
              Unidad de medida
            </p>
            <div class="flex flex-wrap gap-2" role="group" aria-label="Unidad de medida">
              @for (u of units(); track u.code) {
                <button
                  type="button"
                  [attr.aria-pressed]="u.code === unitCode()"
                  (click)="unitCode.set(u.code)"
                  class="min-h-8 px-3 inline-flex items-center gap-1.5 rounded-full border text-xs font-semibold active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  [class]="
                    u.code === unitCode()
                      ? 'border-primary/25 bg-primary/10 text-primary-on-tint'
                      : 'border-border bg-surface text-text-secondary hover:bg-text-secondary/10'
                  "
                >
                  {{ u.code }}
                  @if (u.isPrincipal) {
                    <app-icon name="star" [size]="12"></app-icon>
                  }
                </button>
              }
            </div>
          </div>
        }

        @if (parsed() != null && principalAmount() != null) {
          <div
            class="rounded-xl border border-border bg-primary/5 px-3 py-2 space-y-1"
          >
            @if (activeUnit()?.code !== principalUnit()?.code) {
              <p class="text-sm text-text-secondary">
                {{ formatAmount(parsed()!) }} {{ activeUnit()?.code }} =
                <span class="font-bold text-text-primary"
                  >{{ formatAmount(principalAmount()!) }}
                  {{ principalUnit()?.code }}</span
                >
              </p>
            }
            @if (stockQuantity() != null && stockUnitCode()) {
              @if (stockQuantity()! > 0) {
                <p class="text-xs text-text-secondary">
                  Descuenta {{ stockQuantity() }} {{ stockUnitCode() }} del
                  inventario
                </p>
              } @else {
                <p class="text-xs text-error flex items-center gap-1">
                  <app-icon name="alert-triangle" [size]="12"></app-icon>
                  Muy poco: no alcanza a una {{ stockUnitCode() }}.
                </p>
              }
            }
            @if (total() != null) {
              <p class="flex items-center justify-between">
                <span class="text-xs font-semibold text-text-secondary"
                  >Total</span
                >
                <span class="text-lg font-bold text-text-primary">{{
                  formatMoney(total()!)
                }}</span>
              </p>
            }
          </div>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="onCancel()"
          >Cancelar</app-button
        >
        <app-button
          variant="primary"
          (clicked)="onConfirm()"
          [disabled]="!canConfirm()"
        >
          {{ confirmText() }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PosManualWeightModalComponent {
  readonly title = input<string>('Ingresar peso');
  readonly message = input<string>('');
  /**
   * UoMs de venta elegibles (principal marcada). Una sola = sin chips.
   * `factorToBase` viene expresado POR UNIDAD DE STOCK (no a la base de la
   * dimensión): las conversiones son idénticas y el redondeo a stock es
   * directo.
   */
  readonly units = input<ManualWeighUnit[]>([]);
  /**
   * Precio por UNIDAD DE STOCK (`final_price / price_unit_quantity`), para
   * el total en vivo. Null = sin total. El total usa la cantidad redondeada
   * a stock, byte por byte como el cobro del backend.
   */
  readonly pricePerStockUnit = input<number | null>(null);
  /**
   * Precio por unidad PRINCIPAL, solo para el total en vivo del flujo de
   * peso legado (ahí no hay redondeo a stock). Se usa únicamente cuando
   * `pricePerStockUnit` es null.
   */
  readonly pricePerPrincipal = input<number | null>(null);
  /** Código de la unidad de stock (línea "descuenta N g"). */
  readonly stockUnitCode = input<string>('');
  /** Cantidad inicial (edición). Vacío = campo vacío con foco. */
  readonly initialAmount = input<string>('');
  /** Unidad inicial (edición). Si no está en `units`, manda la principal. */
  readonly initialUnitCode = input<string>('');
  readonly confirmText = input<string>('Agregar');
  readonly maxAmount = input<number>(MAX_WEIGH_AMOUNT);
  /**
   * Exigir que la captura descuente al menos 1 unidad de stock. El flujo de
   * peso legado (sin stock) lo apaga: ahí no hay conversión a stock.
   */
  readonly enforceStockQuantity = input<boolean>(true);

  readonly isOpen = model<boolean>(true);
  readonly confirm = output<ManualWeighResult>();
  readonly cancel = output<void>();

  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly amountInput =
    viewChild<ElementRef<HTMLInputElement>>('amountInput');

  /**
   * `linkedSignal` y no inicialización en el constructor: el servicio monta
   * el modal con `createComponent` + `setInput`, así que en el constructor
   * los inputs aún van vacíos. El link se recalcula cuando llegan y después
   * conserva lo digitado/elegido.
   */
  readonly amountText = linkedSignal(() => this.initialAmount());
  readonly unitCode = linkedSignal(() => {
    const units = this.units();
    const initial = this.initialUnitCode();
    if (initial && units.some((u) => u.code === initial)) return initial;
    return defaultWeighUnit(units)?.code ?? '';
  });

  constructor() {
    // Foco + autoselección al abrir: el cajero digita sin borrar nada.
    effect(() => {
      if (!this.isOpen()) return;
      const el = this.amountInput()?.nativeElement;
      if (!el) return;
      queueMicrotask(() => {
        el.focus();
        el.select();
      });
    });
  }

  readonly activeUnit = computed<ManualWeighUnit | null>(
    () => this.units().find((u) => u.code === this.unitCode()) ?? null,
  );

  readonly principalUnit = computed<ManualWeighUnit | null>(() => {
    const units = this.units();
    return units.find((u) => u.isPrincipal) ?? units[0] ?? null;
  });

  readonly parsed = computed<number | null>(() =>
    parseWeighAmount(this.amountText()),
  );

  readonly principalAmount = computed<number | null>(() => {
    const amount = this.parsed();
    const from = this.activeUnit();
    const principal = this.principalUnit();
    if (amount == null || !from || !principal) return null;
    return convertWeighAmount(
      amount,
      from.factorToBase,
      principal.factorToBase,
    );
  });

  readonly stockQuantity = computed<number | null>(() => {
    const amount = this.parsed();
    const from = this.activeUnit();
    if (amount == null || !from) return null;
    return stockUnitsForWeighAmount(amount, from.factorToBase, 1);
  });

  readonly total = computed<number | null>(() => {
    const perStock = this.pricePerStockUnit();
    const qty = this.stockQuantity();
    if (perStock != null && qty != null) return weighTotal(qty, perStock);
    const perPrincipal = this.pricePerPrincipal();
    const inPrincipal = this.principalAmount();
    if (perPrincipal != null && inPrincipal != null) {
      return weighTotal(inPrincipal, perPrincipal);
    }
    return null;
  });

  readonly canConfirm = computed<boolean>(() => {
    const amount = this.parsed();
    const qty = this.stockQuantity();
    const stockOk =
      !this.enforceStockQuantity() || (qty != null && qty > 0);
    return (
      amount != null &&
      amount <= this.maxAmount() &&
      this.activeUnit() != null &&
      this.principalAmount() != null &&
      stockOk
    );
  });

  formatAmount(value: number): string {
    return formatWeighAmount(value);
  }

  formatMoney(value: number): string {
    return this.currencyFormat.format(value);
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;
    this.confirm.emit({
      amount: this.parsed()!,
      unitCode: this.unitCode(),
      principalAmount: this.principalAmount()!,
      principalCode: this.principalUnit()?.code ?? this.unitCode(),
      stockQuantity: this.stockQuantity()!,
    });
    this.isOpen.set(false);
  }

  onCancel(): void {
    this.cancel.emit();
    this.isOpen.set(false);
  }

  onModalClose(): void {
    if (!this.isOpen()) {
      this.cancel.emit();
    }
  }
}
