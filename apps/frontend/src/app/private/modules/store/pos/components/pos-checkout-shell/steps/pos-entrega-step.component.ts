import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components';
import { PosOpenTableModalComponent } from '../../pos-open-table-modal.component';
import { PosRestaurantIntegrationService } from '../../../services/pos-restaurant-integration.service';
import { CartState } from '../../../models/cart.model';
import type { Table } from '../../../../restaurant-ops/tables/interfaces';

export type EntregaChoice = 'mesa' | 'llevar' | 'enviar';

/**
 * Paso · Entrega — `app-pos-entrega-step`.
 *
 * Primer paso del checkout POS unificado (Consumir / Para llevar / Enviar).
 * Absorbe el paso Consumo (`pos-consumo-step`) y consolida la decisión de fulfillment
 * adentro del modal.
 *
 * - 'mesa' (Consumo en mesa): visible solo si el tenant es restaurante (`isRestaurantMode`).
 *   Integra el picker de mesa en modo selección pura (QUI-535).
 * - 'llevar' (Para llevar): entrega directa en mostrador (default).
 * - 'enviar' (Enviar a domicilio): inserta dinámicamente el paso Envío en el shell.
 */
@Component({
  selector: 'app-pos-entrega-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PosOpenTableModalComponent],
  templateUrl: './pos-entrega-step.component.html',
  styleUrl: './pos-entrega-step.component.scss',
})
export class PosEntregaStepComponent {
  private readonly integration = inject(PosRestaurantIntegrationService);

  // ── Inputs ───────────────────────────────────────────────────────────────
  readonly cartState = input<CartState | null>(null);
  readonly tableId = input<number | null>(null);
  readonly initialChoice = input<EntregaChoice>('llevar');

  // ── State ────────────────────────────────────────────────────────────────
  readonly isRestaurantMode = computed<boolean>(() =>
    this.integration.isRestaurantMode(),
  );

  readonly availableChoices = computed<EntregaChoice[]>(() =>
    this.isRestaurantMode() ? ['mesa', 'llevar', 'enviar'] : ['llevar', 'enviar'],
  );

  readonly choice = model<EntregaChoice>('llevar');

  /** Mesa elegida por el operador en el picker (modo selección pura). */
  readonly pickedTable = signal<Table | null>(null);
  readonly openTablePicker = signal(false);

  // ── Precedencia: operador siempre gana ────────────────────────────────────
  readonly effectiveTableId = computed<number | null>(
    () => this.pickedTable()?.id ?? this.tableId(),
  );

  readonly checkoutTableId = computed<number | null>(() =>
    this.choice() === 'mesa' ? this.effectiveTableId() : null,
  );

  readonly hasSelectedTable = computed<boolean>(
    () => this.effectiveTableId() != null,
  );

  readonly selectedTableLabel = computed<string>(() => {
    const picked = this.pickedTable();
    if (picked?.name) {
      return `${picked.name}${picked.zone ? ' · ' + picked.zone : ''}`;
    }
    const externalId = this.tableId();
    if (externalId == null) return '';
    const table = this.integration.currentTableSession()?.table;
    if (table?.name && table.id === externalId) {
      return `${table.name}${table.zone ? ' · ' + table.zone : ''}`;
    }
    return '';
  });

  readonly tablePillText = computed<string>(() => {
    const label = this.selectedTableLabel();
    return label ? `${label} seleccionada` : 'Mesa seleccionada';
  });

  readonly needsTable = computed<boolean>(
    () => this.choice() === 'mesa' && this.effectiveTableId() == null,
  );

  // ── Outputs ──────────────────────────────────────────────────────────────
  readonly advanceRequested = output<void>();

  // ── Handlers ─────────────────────────────────────────────────────────────
  onOptionClick(next: EntregaChoice): void {
    if (next === this.choice()) {
      this.onOptionReselected(next);
      return;
    }
    this.onOptionChange(next);
  }

  onOptionChange(next: EntregaChoice): void {
    this.choice.set(next);
    if (next !== 'mesa') {
      this.pickedTable.set(null);
    }
  }

  onOptionReselected(next: EntregaChoice): void {
    if (next === 'mesa') {
      if (this.needsTable()) {
        this.openTablePicker.set(true);
        return;
      }
      this.advanceRequested.emit();
      return;
    }
    this.advanceRequested.emit();
  }

  onTableSelected(table: Table): void {
    this.openTablePicker.set(false);
    if (!table) return;
    this.pickedTable.set(table);
    this.advanceRequested.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    const choices = this.availableChoices();
    if (choices.length <= 1) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      const curIdx = choices.indexOf(this.choice());
      const nextIdx = (curIdx + 1) % choices.length;
      this.onOptionChange(choices[nextIdx]);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      const curIdx = choices.indexOf(this.choice());
      const prevIdx = (curIdx - 1 + choices.length) % choices.length;
      this.onOptionChange(choices[prevIdx]);
    }
  }
}
