import { Component, computed, effect, input, model, output, signal } from '@angular/core';

import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { CurrencyPipe } from '../../pipes/currency/currency.pipe';
import type {
  ItemCancellationDestination,
  ItemCancellationPreview,
} from './item-cancellation-totals';

export interface ItemCancellationSubmit {
  reason: string;
  destination: ItemCancellationDestination;
}

/**
 * D.4 (CP-pos-order-flows-remediation) — modal compartido "Destino del plato".
 *
 * Un solo modal para los dos carriles: detalle de orden (cancel + reversa de
 * entrega) y sesión de mesa (cancelación de la cuenta). El wrapper es dueño
 * del form (motivo + destino, `app-modal` solo cromo/visibilidad); el padre
 * ejecuta la mutación al recibir `(confirmed)` y reporta el error de red vía
 * `serverError` sin cerrar el modal.
 *
 * Accesibilidad heredada de `app-modal` (`dialog`): foco inicial al primer
 * control, trampa de foco, Escape (solo topmost), restauración del foco al
 * disparador y `z-[9999]` sobre el shell.
 */
@Component({
  selector: 'app-item-cancellation-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, CurrencyPipe],
  templateUrl: './item-cancellation-modal.component.html',
})
export class ItemCancellationModalComponent {
  /** Canal único de visibilidad (NO declarar `isOpenChange` a mano). */
  readonly isOpen = model<boolean>(false);

  readonly itemName = input('');
  /**
   * false = plato sin disparo a cocina: se ocultan los radios de destino
   * (no hay insumos consumidos que desechar o reutilizar).
   */
  readonly showDestination = input(true);
  readonly canReuse = input(false);
  readonly inFlight = input(false);
  readonly serverError = input<string | null>(null);
  readonly currentTotal = input(0);
  /**
   * null = carril sin datos por línea (mesa: el GET no trae
   * `order_item_taxes` ni `tip_*`, así que el espejo D.4 no puede correr
   * exacto): se muestra la nota de total actual en vez del preview.
   */
  readonly preview = input<ItemCancellationPreview | null>(null);

  readonly confirmed = output<ItemCancellationSubmit>();

  readonly reason = signal('');
  readonly destination = signal<ItemCancellationDestination>('waste');
  private readonly localError = signal<string | null>(null);
  readonly error = computed(() => this.localError() ?? this.serverError());

  constructor() {
    // Reset del form en cada apertura (el wrapper persiste entre usos).
    // `allowSignalWrites`: el reset NO es reactivo en loop (guardia wasOpen),
    // solo publica el estado inicial del form al abrir — precedente:
    // subscription-detail-modal, services-settings-form.
    let wasOpen = false;
    effect(
      () => {
        const open = this.isOpen();
        if (open && !wasOpen) {
          this.reason.set('');
          this.destination.set('waste');
          this.localError.set(null);
        }
        wasOpen = open;
      },
      { allowSignalWrites: true },
    );
  }

  /** Espejo del handler que usaba order-details: en vuelo se ignora el cierre. */
  onInnerOpenChange(open: boolean): void {
    if (!open && !this.inFlight()) this.isOpen.set(false);
  }

  close(): void {
    if (this.inFlight()) return;
    this.isOpen.set(false);
  }

  onConfirm(): void {
    if (this.inFlight()) return;
    const reason = this.reason().trim();
    if (reason.length < 3 || reason.length > 500) {
      this.localError.set('El motivo debe tener entre 3 y 500 caracteres.');
      return;
    }
    this.localError.set(null);
    this.confirmed.emit({ reason, destination: this.destination() });
  }
}
