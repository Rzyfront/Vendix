import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  signal,
} from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

/**
 * Fulfillment type for restaurant orders.
 *
 *  - `consumo` → consume on premises (Dine-in). When no table is picked,
 *               the parent must block the action (the selector exposes
 *               `isConsumoBlocked` for the parent to read and surface a
 *               hint to the operator).
 *  - `entrega` → take away / delivery-by-store (the operator will use the
 *               "Envío" button for shipping flows that need a delivery
 *               address; this selector does NOT touch `delivery_type`).
 *
 * The selector is intentionally dumb: it does not talk to the backend,
 * it does not own the open-table session, and it does not know about
 * `delivery_type`. Those concerns live in the wrapper modal and in
 * `PosRestaurantIntegrationService`.
 */
export type FulfillmentType = 'consumo' | 'entrega';

export interface FulfillmentSelection {
  type: FulfillmentType;
  tableId: number | null;
}

@Component({
  selector: 'app-pos-fulfillment-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="fulfillment-selector" role="radiogroup" aria-label="Tipo de servicio">
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="value() === 'consumo'"
        class="fulfillment-option"
        [class.selected]="value() === 'consumo'"
        [class.blocked]="isConsumoBlocked()"
        [disabled]="isConsumoBlocked()"
        (click)="onPick('consumo')"
      >
        <app-icon name="utensils" [size]="22"></app-icon>
        <div class="fulfillment-option-body">
          <span class="fulfillment-option-title">Consumo</span>
          <span class="fulfillment-option-hint">
            @if (isConsumoBlocked()) {
              Selecciona una mesa primero
            } @else {
              Para servir en la mesa
            }
          </span>
        </div>
      </button>

      <button
        type="button"
        role="radio"
        [attr.aria-checked]="value() === 'entrega'"
        class="fulfillment-option"
        [class.selected]="value() === 'entrega'"
        (click)="onPick('entrega')"
      >
        <app-icon name="shopping-bag" [size]="22"></app-icon>
        <div class="fulfillment-option-body">
          <span class="fulfillment-option-title">Entrega</span>
          <span class="fulfillment-option-hint">
            Para llevar / takeaway
          </span>
        </div>
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .fulfillment-selector {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .fulfillment-option {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 12px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        color: var(--color-text-primary);
        text-align: left;
        cursor: pointer;
        transition: all 0.18s ease;
      }

      .fulfillment-option:hover:not(:disabled):not(.selected) {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.04);
      }

      .fulfillment-option.selected {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.08);
        box-shadow: 0 0 0 1px var(--color-primary);
      }

      .fulfillment-option.blocked {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .fulfillment-option-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .fulfillment-option-title {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
      }

      .fulfillment-option-hint {
        font-size: 12px;
        color: var(--color-text-secondary);
        line-height: 1.2;
      }
    `,
  ],
})
export class PosFulfillmentSelectorComponent {
  /** Currently selected fulfillment type. Defaults to 'entrega'. */
  readonly value = input<FulfillmentType>('entrega');

  /**
   * `true` when 'consumo' cannot be selected yet (e.g. no open table
   * session). The selector visually disables that option and blocks the
   * click; the parent must still refuse to submit.
   */
  readonly consumoBlocked = input<boolean>(false);

  /** Emits when the operator picks a fulfillment option. */
  readonly selectionChange = output<FulfillmentType>();

  /**
   * Emits when the operator clicks the option that is ALREADY selected. The
   * parent uses this to advance the wizard (e.g. re-clicking "Entrega" jumps to
   * the next step). Kept separate from `selectionChange` so a re-click never
   * re-runs selection side-effects.
   */
  readonly reselected = output<FulfillmentType>();

  /** Convenience: same as `consumoBlocked()` but exposed for the parent. */
  readonly isConsumoBlocked = computed(() => this.consumoBlocked());

  onPick(type: FulfillmentType): void {
    if (type === 'consumo' && this.isConsumoBlocked()) return;
    // Re-click on the already-selected option → ask the parent to advance
    // instead of silently ignoring it.
    if (type === this.value()) {
      this.reselected.emit(type);
      return;
    }
    this.selectionChange.emit(type);
  }
}
