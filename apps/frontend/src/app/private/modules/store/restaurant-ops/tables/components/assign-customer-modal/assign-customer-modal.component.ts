import {
  Component,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import { PosCustomer } from '../../../../pos/models/customer.model';
import { TableSessionCustomerRef } from '../../interfaces';

/**
 * Restaurant Suite — assign/change the customer of an already-open table.
 *
 * Wraps the shared {@link PosCustomerSelectorComponent} (the same inline
 * panel used in the open-table flow and POS) inside a modal. It does NOT
 * call the backend itself — it emits `assign(customerId | null)` and the
 * page calls `TablesService.assignCustomer`. Passing `null` detaches the
 * customer (true anonymous — no "Cliente General" sentinel).
 *
 * Zoneless + Signals.
 */
@Component({
  selector: 'app-assign-customer-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    PosCustomerSelectorComponent,
  ],
  templateUrl: './assign-customer-modal.component.html',
  styleUrl: './assign-customer-modal.component.scss',
})
export class AssignCustomerModalComponent {
  // ── Inputs ──────────────────────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  /** Currently assigned customer (from order.customer), or null. */
  readonly current = input<TableSessionCustomerRef | null>(null);
  /** Driven by the parent while the assign request is in flight. */
  readonly isProcessing = input<boolean>(false);

  // ── Outputs ─────────────────────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  /** Emits the chosen customer id, or `null` to detach. */
  readonly assign = output<number | null>();

  // ── State ───────────────────────────────────────────────────────────
  readonly picked = signal<PosCustomer | null>(null);

  private readonly selectorRef = viewChild(PosCustomerSelectorComponent);

  constructor() {
    // Reset the picked draft each time the modal opens.
    effect(() => {
      if (this.isOpen()) {
        this.picked.set(null);
        this.selectorRef()?.reset();
      }
    });
  }

  onCustomerSelected(customer: PosCustomer): void {
    this.picked.set(customer);
  }

  clearPicked(): void {
    this.picked.set(null);
  }

  /** Confirm: assign the picked customer. */
  confirmAssign(): void {
    const c = this.picked();
    if (!c) return;
    this.assign.emit(Number(c.id));
  }

  /** Detach the current customer (anonymous). */
  detach(): void {
    this.assign.emit(null);
  }

  onIsOpenChange(value: boolean): void {
    this.isOpenChange.emit(value);
  }

  onModalClosed(): void {
    this.picked.set(null);
    this.closed.emit();
  }
}
