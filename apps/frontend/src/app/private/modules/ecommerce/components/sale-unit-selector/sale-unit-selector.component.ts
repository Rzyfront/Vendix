import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  viewChildren,
} from '@angular/core';

import { SaleUnitOption } from '../../services/catalog.service';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';

/**
 * Selector de presentación de venta (multitarifa) para la vitrina pública.
 *
 * Pinta las `available_sale_units` de un producto como chips táctiles grandes
 * ("Bulto 50kg" / "$100.000", "Kilo" / "$2.380") dentro de un `radiogroup`
 * accesible, y devuelve el `price_tier_id` elegido por two-way binding:
 *
 *   <app-sale-unit-selector
 *     [options]="product().available_sale_units ?? []"
 *     [(selectedTierId)]="selectedTierId" />
 *
 * REGLA DE DINERO (heredada del contrato `SaleUnitOption`): `price` ya es el
 * precio del PAQUETE COMPLETO, resuelto por el backend con impuesto incluido.
 * Este componente es de SOLO LECTURA sobre dinero: no multiplica por
 * `units_per_package`, no aplica descuentos, no recalcula nada. Solo pinta lo
 * que llega. Cualquier aritmética aquí reintroduciría el bug que el contrato
 * previene (inflar el cobro por el tamaño del empaque).
 *
 * El componente tampoco auto-selecciona la presentación `is_default`: escribir
 * la señal `model()` desde un `effect()` alimentaría `computed`s leídos en el
 * mismo tick (prohibido en zoneless). El consumidor siembra `selectedTierId`
 * con el `is_default` cuando carga el producto.
 *
 * El `CurrencyPipe` de Vendix es IMPURO: sin un atributo que dependa de la
 * moneda del tenant, los precios no se repintan si la moneda resuelve después
 * del primer paint y el comprador se queda viendo el formato de fallback. Por
 * eso la raíz lleva `[attr.data-currency]="currencyCode()"` — misma técnica que
 * `app-cart-item-card` y `app-cart-promotions`.
 */
@Component({
  selector: 'app-sale-unit-selector',
  standalone: true,
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length > 0) {
      <div
        class="su-group"
        role="radiogroup"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-disabled]="disabled() ? 'true' : null"
        [attr.data-currency]="currencyCode()"
        (keydown)="onKeydown($event)"
      >
        @for (option of options(); track option.price_tier_id) {
          <button
            #chipRef
            type="button"
            class="su-chip"
            role="radio"
            [class.selected]="option.price_tier_id === selectedTierId()"
            [class.sold-out]="isSoldOut(option)"
            [disabled]="disabled() || isSoldOut(option)"
            [attr.aria-checked]="
              option.price_tier_id === selectedTierId() ? 'true' : 'false'
            "
            [attr.tabindex]="
              option.price_tier_id === rovingTierId() ? 0 : -1
            "
            [attr.data-tier-id]="option.price_tier_id"
            (click)="select(option)"
          >
            <span class="su-name">{{ option.name }}</span>

            @if (isSoldOut(option)) {
              <span class="su-soldout">Agotado</span>
            } @else {
              <span class="su-price-row">
                <span class="su-price">{{ option.price | currency }}</span>
                @if (hasCompareAt(option)) {
                  <s class="su-compare">
                    {{ option.compare_at_price | currency }}
                  </s>
                }
              </span>
            }
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .su-group {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        min-width: 0;
      }

      /* Chip táctil: vitrina pública, no herramienta de operador. Alto mínimo
         de 56px para dedo pulgar; crece con el contenido en vez de truncar. */
      .su-chip {
        flex: 1 1 auto;
        min-width: 8.5rem;
        max-width: 100%;
        min-height: 56px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 0.15rem;
        padding: 0.55rem 0.75rem;
        margin: 0;
        text-align: left;
        cursor: pointer;
        background: var(--color-surface);
        color: var(--color-text-primary);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: var(--radius-lg);
        transition:
          border-color 0.15s ease,
          background-color 0.15s ease,
          box-shadow 0.15s ease;
      }

      .su-chip:hover:not(:disabled) {
        border-color: rgba(var(--color-primary-rgb, 46, 204, 113), 0.45);
      }

      .su-chip:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.45);
        outline-offset: 2px;
      }

      .su-chip.selected {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.08);
        box-shadow: inset 0 0 0 1px var(--color-primary);
      }

      .su-chip:disabled {
        cursor: not-allowed;
      }

      .su-chip.sold-out {
        opacity: 0.5;
        background: var(--color-background);
      }

      .su-name {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        line-height: 1.25;
        color: var(--color-text-secondary);
        overflow-wrap: anywhere;
      }

      .su-chip.selected .su-name {
        color: var(--color-text-primary);
      }

      .su-price-row {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 0.35rem;
        min-width: 0;
      }

      .su-price {
        font-size: var(--fs-base);
        font-weight: var(--fw-bold);
        line-height: 1.2;
        color: var(--color-text-primary);
      }

      .su-chip.selected .su-price {
        color: var(--color-primary);
      }

      .su-compare {
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-muted);
      }

      .su-soldout {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--color-text-muted);
      }

      /* Desktop — los chips dejan de estirarse a lo ancho del contenedor para
         no quedar desproporcionados cuando solo hay dos presentaciones. */
      @media (min-width: 768px) {
        .su-chip {
          flex: 0 1 auto;
          min-width: 9.5rem;
        }

        .su-name {
          font-size: var(--fs-sm);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .su-chip {
          transition: none;
        }
      }
    `,
  ],
})
export class SaleUnitSelectorComponent {
  /** Presentaciones ofrecidas por el backend (`available_sale_units`). */
  readonly options = input.required<SaleUnitOption[]>();

  /** `price_tier_id` elegido. Two-way: `[(selectedTierId)]="..."`. */
  readonly selectedTierId = model<number | null>(null);

  /** Deshabilita todos los chips (p.ej. mientras el carrito está ocupado). */
  readonly disabled = input<boolean>(false);

  /** Etiqueta accesible del `radiogroup`. */
  readonly ariaLabel = input<string>('Presentación de venta');

  private readonly currencyFormat = inject(CurrencyFormatService);

  /**
   * Moneda del tenant, leída en la plantilla vía `data-currency` para que este
   * componente OnPush se repinte cuando la carga asíncrona de moneda resuelve;
   * sin esto el pipe impuro `| currency` se queda pegado al formato de
   * fallback y el comprador ve el símbolo equivocado.
   */
  protected readonly currencyCode = this.currencyFormat.currencyCode;

  private readonly chipRefs =
    viewChildren<ElementRef<HTMLButtonElement>>('chipRef');

  /**
   * Chip que participa en el orden de tabulación (roving tabindex): el
   * seleccionado si es elegible, si no el primer chip elegible. Así el
   * radiogroup completo ocupa una sola parada de TAB, como manda WAI-ARIA.
   */
  protected readonly rovingTierId = computed<number | null>(() => {
    const options = this.options();
    const selected = this.selectedTierId();

    const selectedOption = options.find(
      (option) => option.price_tier_id === selected,
    );
    if (selectedOption && !this.isSoldOut(selectedOption)) {
      return selectedOption.price_tier_id;
    }

    const firstSelectable = options.find((option) => !this.isSoldOut(option));
    return firstSelectable?.price_tier_id ?? null;
  });

  /** Sin stock de paquetes, o marcada no disponible por el backend. */
  protected isSoldOut(option: SaleUnitOption): boolean {
    // `available_packages === null` significa "no rastrea inventario", que NO
    // es agotado; por eso la comparación es estricta contra 0.
    return option.is_available === false || option.available_packages === 0;
  }

  /** Solo se tacha el comparativo cuando de verdad es un precio mayor. */
  protected hasCompareAt(option: SaleUnitOption): boolean {
    return (
      option.compare_at_price !== null &&
      option.compare_at_price !== undefined &&
      option.compare_at_price > option.price
    );
  }

  protected select(option: SaleUnitOption): void {
    if (this.disabled() || this.isSoldOut(option)) return;
    this.selectedTierId.set(option.price_tier_id);
  }

  /**
   * Navegación de teclado del radiogroup: flechas mueven foco Y selección,
   * saltándose los chips agotados; Home/End van a los extremos elegibles.
   * Espacio/Enter los resuelve el `<button>` nativo vía `click`.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;

    const selectable = this.options().filter((option) => !this.isSoldOut(option));
    if (selectable.length === 0) return;

    const current = selectable.findIndex(
      (option) => option.price_tier_id === this.selectedTierId(),
    );

    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % selectable.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next =
          current < 0
            ? selectable.length - 1
            : (current - 1 + selectable.length) % selectable.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = selectable.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();

    const target = selectable[next];
    this.selectedTierId.set(target.price_tier_id);
    this.focusChip(target.price_tier_id);
  }

  private focusChip(tierId: number): void {
    const chip = this.chipRefs().find(
      (ref) => ref.nativeElement.dataset['tierId'] === String(tierId),
    );
    chip?.nativeElement.focus();
  }

  constructor() {
    // Asegura que la moneda del tenant esté cargada antes de formatear precios.
    this.currencyFormat.loadCurrency();
  }
}
