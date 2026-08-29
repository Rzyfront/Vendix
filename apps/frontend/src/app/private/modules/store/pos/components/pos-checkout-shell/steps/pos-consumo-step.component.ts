import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components';
import { FulfillmentType } from '../../pos-fulfillment-selector.component';
import { PosOpenTableModalComponent } from '../../pos-open-table-modal.component';
import { PosRestaurantIntegrationService } from '../../../services/pos-restaurant-integration.service';
import { CartState } from '../../../models/cart.model';
import type { Table } from '../../../../restaurant-ops/tables/interfaces';

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
 * El shell lee `fulfillment()`, `checkoutTableId()` y `needsTable()` para
 * consolidar el payload de cobro y el gate del footer.
 *
 * QUI-535: el picker se usa en modo **selección pura** (`[selectOnly]="true"`),
 * así que aquí NO se abre ninguna sesión de mesa — la mesa se materializa recién
 * en el cobro. La mesa elegida se guarda completa (`pickedTable`) porque el
 * operador identifica la mesa por su NOMBRE, nunca por el `id` de la fila.
 */
@Component({
  selector: 'app-pos-consumo-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PosOpenTableModalComponent],
  templateUrl: './pos-consumo-step.component.html',
  styleUrl: './pos-consumo-step.component.scss',
})
export class PosConsumoStepComponent {
  private readonly integration = inject(PosRestaurantIntegrationService);

  // ── Inputs (from shell) ──────────────────────────────────────────────────
  /** Cart state — used to pass the current customer to the open-table modal. */
  readonly cartState = input<CartState | null>(null);
  /** External table id (when the POS already carries one). */
  readonly tableId = input<number | null>(null);

  // ── Fulfillment / table state (owned here) ───────────────────────────────
  readonly fulfillment = signal<FulfillmentType>('entrega');
  /**
   * Mesa elegida por el operador en el picker, COMPLETA (id + name + zone).
   * Fuente única de la mesa del checkout; el `tableId` del padre es solo el
   * fallback residual de una sesión ya abierta fuera del POS.
   */
  readonly pickedTable = signal<Table | null>(null);
  /** Toggles the inline PosOpenTableModalComponent. */
  readonly openTablePicker = signal(false);

  // ── Precedencia única: la elección del operador SIEMPRE gana ─────────────
  /**
   * Mesa efectiva del paso: la elegida por el operador primero, y solo si no
   * eligió ninguna, la mesa residual que trae el padre. Pill y payload leen esta
   * misma precedencia (antes la pill hacía `tableId() ?? pickedTableId()` y el
   * shell `pickedTableId() ?? tableId()`: mostraba una mesa y cobraba otra).
   */
  readonly effectiveTableId = computed<number | null>(
    () => this.pickedTable()?.id ?? this.tableId(),
  );

  /**
   * Mesa que el cobro debe materializar. Null cuando el servicio no es consumo
   * en mesa: "Para llevar" nunca debe ocupar una mesa, ni siquiera si el padre
   * arrastra una sesión residual.
   */
  readonly checkoutTableId = computed<number | null>(() =>
    this.fulfillment() === 'consumo' ? this.effectiveTableId() : null,
  );

  /** True cuando hay mesa que mostrar en la pill. */
  readonly hasSelectedTable = computed<boolean>(
    () => this.effectiveTableId() != null,
  );

  /**
   * Etiqueta de la mesa ante el operador: `"Mesa 2"` o `"Mesa 2 · Terraza"`.
   * Cadena vacía cuando la mesa viene solo del padre (un id sin nombre) y la
   * sesión cacheada no permite resolver el nombre. El `id` de la fila NUNCA se
   * imprime — no es información de usuario.
   */
  readonly selectedTableLabel = computed<string>(() => {
    const picked = this.pickedTable();
    if (picked?.name) {
      return `${picked.name}${picked.zone ? ' · ' + picked.zone : ''}`;
    }
    const externalId = this.tableId();
    if (externalId == null) return '';
    // El contrato de TableSession ya trae `table: {id,name,zone,status}`.
    const table = this.integration.currentTableSession()?.table;
    if (table?.name && table.id === externalId) {
      return `${table.name}${table.zone ? ' · ' + table.zone : ''}`;
    }
    return '';
  });

  /** Texto de la pill. Sin nombre resoluble cae a un neutro, jamás a `Mesa #id`. */
  readonly tablePillText = computed<string>(() => {
    const label = this.selectedTableLabel();
    return label ? `${label} seleccionada` : 'Mesa seleccionada';
  });

  // ── Public gate read by the shell footer ─────────────────────────────────
  /** 'consumo' still requires a table before the order can be confirmed. */
  readonly needsTable = computed<boolean>(
    () => this.fulfillment() === 'consumo' && this.effectiveTableId() == null,
  );

  // ── Outputs ──────────────────────────────────────────────────────────────
  readonly fulfillmentChange = output<FulfillmentType>();
  /**
   * Asks the shell to advance to the next top-level step. Fired when:
   *  - the operator re-clicks the already-selected fulfillment and no further
   *    input is pending (entrega, or consumo with a table already picked), or
   *  - a table was just selected in the picker (consumo → mesa elegida).
   */
  readonly advanceRequested = output<void>();

  /**
   * QUI-739 (B.2) — "Cambiar tipo de servicio". Fired when the operator wants
   * to change the fulfillment/table choice without closing the whole flow.
   * The SHELL owns the reset semantics: it calls {@link resetFulfillment} on
   * this child and navigates back to the "Tipo" step. Event emission is
   * separate so the two responsibilities (announce intent vs. reset state)
   * stay decoupled, matching the two-controls/two-behaviours decision.
   */
  readonly back = output<void>();

  // ── Handlers (moved verbatim from pos-payment-step) ──────────────────────
  /**
   * Single entry point for the inline option rows. Preserves the exact
   * change-vs-reselect semantics that {@link PosFulfillmentSelectorComponent}
   * used to encapsulate: picking a NEW option runs {@link onFulfillmentChange};
   * re-clicking the ALREADY-selected option runs {@link onFulfillmentReselected}
   * (which advances the wizard, or opens the table picker for consumo).
   */
  onOptionClick(type: FulfillmentType): void {
    if (type === this.fulfillment()) {
      this.onFulfillmentReselected(type);
      return;
    }
    this.onFulfillmentChange(type);
  }

  onFulfillmentChange(next: FulfillmentType): void {
    this.fulfillment.set(next);
    if (next !== 'consumo') {
      this.pickedTable.set(null);
    }
    this.fulfillmentChange.emit(next);
  }

  /**
   * Re-click on the ALREADY-selected fulfillment option:
   *  - entrega (para llevar) → nothing else is required, advance.
   *  - consumo → advance only when a table is already picked; otherwise open the
   *    table picker so the operator can pick one (which then advances via
   *    {@link onTableSelected}).
   */
  onFulfillmentReselected(type: FulfillmentType): void {
    if (type === 'entrega') {
      this.advanceRequested.emit();
      return;
    }
    // consumo
    if (this.needsTable()) {
      this.openTablePicker.set(true);
      return;
    }
    this.advanceRequested.emit();
  }

  /**
   * Mesa elegida en el picker (modo selección pura: NO hubo `POST`). Guardamos
   * la fila completa para poder mostrar el nombre y avanzamos el wizard.
   */
  onTableSelected(table: Table): void {
    this.openTablePicker.set(false);
    if (!table) return;
    this.pickedTable.set(table);
    this.advanceRequested.emit();
  }

  /**
   * QUI-739 (B.2) — "Cambiar tipo de servicio" click handler. Announces the
   * intent via {@link back}; the shell handler performs the reset + navigation.
   * We deliberately do NOT reset here: the checklist scopes the reset to the
   * parent (pos-checkout-shell), keeping one owner for the state teardown.
   */
  onChangeServiceType(): void {
    this.back.emit();
  }

  /**
   * QUI-739 (B.2) — restores the Consumo step to its "no selection" baseline:
   * fulfillment back to `'entrega'` (the type is non-nullable), picked table
   * cleared, inline table-picker closed. Called by the shell's `back` handler
   * so a "Cambiar tipo de servicio" never leaks the previously-picked mesa
   * into the next selection (blast-radius: stale mesa preselected).
   */
  resetFulfillment(): void {
    this.fulfillment.set('entrega');
    this.pickedTable.set(null);
    this.openTablePicker.set(false);
  }
}
