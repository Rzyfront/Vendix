import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../../shared/components/multi-selector/multi-selector.component';

/**
 * QUI-431 — POS serial selection modal.
 *
 * Opened when the cashier adds a product with `requires_serial_numbers = true`
 * to the cart. The cashier picks serials from the in_stock pool (multi-select,
 * searchable) and/or types free-text serials (one per line / comma separated)
 * for units not yet in the pool. Free-text serials are resolved-or-created as
 * real pool rows by the backend at payment time, preserving pool↔stock parity.
 *
 * The component is fully zoneless/signal-based and standalone. It emits a
 * `confirmed` payload `{ serialIds, freeTextSerials }` to the parent, which
 * threads them onto the cart line so they reach the backend on checkout.
 */
@Component({
  selector: 'app-pos-serial-selection-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    MultiSelectorComponent,
  ],
  templateUrl: './pos-serial-selection-modal.component.html',
})
export class PosSerialSelectionModalComponent {
  /** Two-way bound visibility from the parent. */
  readonly isOpen = input<boolean>(false);
  /** Product display name shown in the modal header/body. */
  readonly productName = input<string>('');
  /** How many serials the line needs (quantity being sold). */
  readonly quantity = input<number>(1);
  /** Available in_stock serials from the pool (id + serial_number). */
  readonly options = input<MultiSelectorOption[]>([]);
  /** True while the available-serials request is in-flight. */
  readonly loading = input<boolean>(false);

  /** Emitted with the cashier's selection. */
  readonly confirmed = output<{
    serialIds: number[];
    freeTextSerials: string[];
  }>();
  /** Emitted when the cashier cancels (no serials chosen). */
  readonly cancelled = output<void>();

  /** Serial ids picked from the pool. */
  readonly selectedSerialIds = signal<(string | number)[]>([]);
  /** Raw free-text the cashier typed (one serial per line or comma separated). */
  readonly freeText = signal<string>('');

  /** Parsed free-text serials: trimmed, blanks dropped, de-duped. */
  readonly freeTextSerials = computed<string[]>(() => {
    const raw = this.freeText();
    if (!raw || !raw.trim()) return [];
    const parts = raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return Array.from(new Set(parts));
  });

  /** Total serials chosen so far (pool + free text). */
  readonly totalSelected = computed(
    () => this.selectedSerialIds().length + this.freeTextSerials().length,
  );

  /** Whether the cashier has chosen enough serials to cover the quantity. */
  readonly canConfirm = computed(() => this.totalSelected() >= this.quantity());

  onSelectionChange(values: (string | number)[]): void {
    this.selectedSerialIds.set(values);
  }

  onFreeTextChange(value: string): void {
    this.freeText.set(value);
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;
    const serialIds = this.selectedSerialIds()
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    this.confirmed.emit({
      serialIds,
      freeTextSerials: this.freeTextSerials(),
    });
    this.reset();
  }

  onCancel(): void {
    this.cancelled.emit();
    this.reset();
  }

  private reset(): void {
    this.selectedSerialIds.set([]);
    this.freeText.set('');
  }
}
