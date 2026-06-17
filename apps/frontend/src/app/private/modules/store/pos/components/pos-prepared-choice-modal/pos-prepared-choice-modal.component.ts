import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';

/**
 * Decision made by the cashier on a `prepared` + track_inventory +
 * stock>0 product:
 *  - `kds`: "Producir por KDS" — the item is fired to the kitchen
 *    (legacy behaviour). Stock of leaf ingredients is consumed at
 *    fire; the product's own stock is NOT touched.
 *  - `stock`: "Usar stock" — the item is added with `skipKds=true`.
 *    No kitchen ticket is created. The product's own stock is
 *    consumed at PAYMENT as a regular `sale` movement.
 *  - `cancel`: the modal is closed without adding the item.
 */
export type PreparedChoice = 'kds' | 'stock' | 'cancel';

export interface PreparedChoiceResult {
  product: { id: number; name: string; stock?: number };
  choice: PreparedChoice;
}

/**
 * PosPreparedChoiceModal (Restaurant Suite — Fase K Gap 1)
 *
 * Two-way bound `[(isOpen)]`, a `product` input, and emits
 * `(decided)` with the cashier choice + product payload. Zoneless
 * and standalone; no OnPush toggle needed because the component
 * uses `ChangeDetectionStrategy.OnPush` and only re-renders on
 * signal changes.
 */
@Component({
  selector: 'app-pos-prepared-choice-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent, BadgeComponent],
  templateUrl: './pos-prepared-choice-modal.component.html',
  styleUrl: './pos-prepared-choice-modal.component.scss',
})
export class PosPreparedChoiceModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly product = input<{
    id: number;
    name: string;
    stock?: number;
    sku?: string | null;
  } | null>(null);

  /** Emitted on every close — parent decides what to do with it. */
  readonly decided = output<PreparedChoiceResult>();

  /** Live mirror of the product to keep the payload local to the modal. */
  private readonly productMirror = signal<{
    id: number;
    name: string;
    stock?: number;
    sku?: string | null;
  } | null>(null);

  readonly productDisplay = computed(() => this.productMirror() ?? this.product());

  readonly stockLabel = computed(() => {
    const stock = this.productDisplay()?.stock;
    if (stock == null) return '—';
    return stock > 0 ? `${stock} und.` : 'Sin stock';
  });

  constructor() {
    // Sync the mirror when the product input changes (zoneless-safe
    // via the effect written in the parent if needed; for now we
    // just keep the input-driven view).
  }

  onKds(): void {
    const p = this.productDisplay();
    if (!p) return;
    this.decided.emit({ product: p, choice: 'kds' });
  }

  onStock(): void {
    const p = this.productDisplay();
    if (!p) return;
    this.decided.emit({ product: p, choice: 'stock' });
  }

  onCancel(): void {
    const p = this.productDisplay();
    if (!p) return;
    this.decided.emit({ product: p, choice: 'cancel' });
  }
}
