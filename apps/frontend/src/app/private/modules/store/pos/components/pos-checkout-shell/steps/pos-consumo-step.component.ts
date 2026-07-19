import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components';
import {
  PosFulfillmentSelectorComponent,
  FulfillmentType,
} from '../../pos-fulfillment-selector.component';
import { PosOpenTableModalComponent } from '../../pos-open-table-modal.component';
import { OpenTableSessionResult } from '../../../services/pos-restaurant-integration.service';
import { CartState } from '../../../models/cart.model';

/**
 * Paso · Consumo — `app-pos-consumo-step`.
 *
 * Step-child dedicado que gobierna el **tipo de servicio** (consumo/entrega) y
 * la selección de mesa para tiendas restaurante. Extraído del paso Cobro
 * (`pos-payment-step`) para que la elección de fulfillment deje de vivir dentro
 * del cobro. El shell monta este paso solo cuando el tenant es restaurante y el
 * intent NO es delivery (gating por industria ∧ intent), por lo que este
 * componente ya NO gatea por `isRestaurantWithPrepared`: el shell decide si se
 * muestra o no.
 *
 * El shell lee `fulfillment()`, `pickedTableId()`, `pickedSessionId()` y
 * `needsTable()` para consolidar el payload de cobro y el gate del footer.
 */
@Component({
  selector: 'app-pos-consumo-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    PosFulfillmentSelectorComponent,
    PosOpenTableModalComponent,
  ],
  templateUrl: './pos-consumo-step.component.html',
  styleUrl: './pos-consumo-step.component.scss',
})
export class PosConsumoStepComponent {
  // ── Inputs (from shell) ──────────────────────────────────────────────────
  /** Cart state — used to pass the current customer to the open-table modal. */
  readonly cartState = input<CartState | null>(null);
  /** External table id (when the POS already carries one). */
  readonly tableId = input<number | null>(null);

  // ── Fulfillment / table state (owned here) ───────────────────────────────
  readonly fulfillment = signal<FulfillmentType>('entrega');
  /** Local mirror of the picked table id so the shell can unblock cobro even
   *  before the parent persists a currentTableSession. */
  readonly pickedTableId = signal<number | null>(null);
  /** Mirror of the opened table_session id forwarded to the backend payload. */
  readonly pickedSessionId = signal<number | null>(null);
  /** Toggles the inline PosOpenTableModalComponent. */
  readonly openTablePicker = signal(false);

  // ── Public gate read by the shell footer ─────────────────────────────────
  /** 'consumo' still requires an open table before the order can be confirmed. */
  readonly needsTable = computed<boolean>(
    () =>
      this.fulfillment() === 'consumo' &&
      (this.tableId() ?? this.pickedTableId()) == null,
  );

  // ── Outputs ──────────────────────────────────────────────────────────────
  readonly fulfillmentChange = output<FulfillmentType>();
  readonly tableSessionOpened = output<OpenTableSessionResult>();

  // ── Handlers (moved verbatim from pos-payment-step) ──────────────────────
  onFulfillmentChange(next: FulfillmentType): void {
    this.fulfillment.set(next);
    if (next !== 'consumo') {
      this.pickedTableId.set(null);
    }
    this.fulfillmentChange.emit(next);
  }

  onTableSessionPicked(result: OpenTableSessionResult): void {
    this.openTablePicker.set(false);
    const session = result?.session ?? result;
    const tableId = (session as any)?.table_id ?? null;
    const sessionId = (session as any)?.id ?? null;
    this.pickedTableId.set(tableId);
    this.pickedSessionId.set(sessionId);
    this.tableSessionOpened.emit(result);
  }
}
