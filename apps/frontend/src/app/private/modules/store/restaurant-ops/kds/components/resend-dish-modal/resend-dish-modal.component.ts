import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { KitchenTicketsService } from '../../services/kitchen-tickets.service';

/**
 * Opciones del modal de reenvío (QUI-762).
 * Las claves (`reason`) son el contrato con el backend; los textos visibles
 * (`label`, `consequence`) son los que ve el mesero.
 */
type ResendReason = 'lost_command' | 'remake_dish';

interface ResendOption {
  reason: ResendReason;
  label: string;
  consequence: string;
}

const RESEND_OPTIONS: ResendOption[] = [
  {
    reason: 'lost_command',
    label: 'Se perdió la comanda',
    consequence:
      'La cocina va a ver un solo ticket. El viejo queda cancelado. El historial registra una cocción.',
  },
  {
    reason: 'remake_dish',
    label: 'Rehacer el plato',
    consequence:
      'La cocina va a preparar el plato de nuevo. Los dos tickets quedan vivos. El historial registra dos cocciones.',
  },
];

/**
 * Modal de "Reenviar a cocina" (QUI-762).
 *
 * Cuatro reglas del spec:
 *  1. `<app-modal [dialog]="true">` — nace con el patrón de QUI-746, no con la deuda.
 *  2. Ninguna opción preseleccionada. El botón confirmar arranca deshabilitado.
 *  3. Texto en lenguaje de restaurante, con la consecuencia de cada opción visible.
 *  4. El 422 del backend se muestra tal cual llega.
 *
 * El modal NO llama al backend solo. El padre (`order-details-page` hoy) le pasa
 * `orderId` y `orderItemIds` ya resueltos, abre el modal, y al confirmar llama
 * al servicio con el `reason` elegido.
 */
@Component({
  selector: 'app-resend-dish-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './resend-dish-modal.component.html',
})
export class ResendDishModalComponent {
  private readonly kitchenTicketsService = inject(KitchenTicketsService);
  private readonly toastService = inject(ToastService);

  /** Apertura del modal. */
  readonly isOpen = input<boolean>(false);

  /** Orden sobre la que se reenvía. */
  readonly orderId = input<number | null>(null);

  /** Ítems a reenviar. Vacío = modal no se abre (defensa). */
  readonly orderItemIds = input<number[]>([]);

  /** Cerrado por backdrop/Esc. El padre limpia selección. */
  readonly cancel = output<void>();

  /** Resultado del reenvío. El padre refresca la orden. */
  readonly confirmed = output<{ reason: ResendReason }>();

  /** Opción elegida por el mesero. `null` hasta que elija. */
  readonly selectedReason = signal<ResendReason | null>(null);

  /** Spinner mientras el backend procesa. */
  readonly isSubmitting = signal(false);

  readonly options = RESEND_OPTIONS;

  /** Confirmación deshabilitada hasta que haya selección. */
  readonly canConfirm = computed(
    () => this.selectedReason() !== null && !this.isSubmitting(),
  );

  readonly subtitle = computed(() => {
    const n = this.orderItemIds().length;
    if (n === 0) return 'Reenviar plato a cocina';
    if (n === 1) return 'Reenviar 1 plato a cocina';
    return `Reenviar ${n} platos a cocina`;
  });

  onSelect(reason: ResendReason): void {
    if (this.isSubmitting()) return;
    this.selectedReason.set(reason);
  }

  onConfirm(): void {
    const reason = this.selectedReason();
    const orderId = this.orderId();
    const ids = this.orderItemIds();
    if (!reason || orderId == null || ids.length === 0) return;
    if (this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.kitchenTicketsService
      .resendOrderItems({
        order_id: orderId,
        order_item_ids: ids,
        reason,
      })
      .pipe() // sin operadores: el modal vive lo que vive la pantalla del
              // mesero que abrió el modal, y un reenvío nunca dura más que eso.
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.selectedReason.set(null);
          this.confirmed.emit({ reason });
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          // Spec regla 4: el 422 se muestra tal cual llega. parseApiError ya
          // devuelve el `userMessage` curado por el backend; ese es el texto
          // que el mesero ve — sin reescrituras genéricas.
          const { userMessage } = parseApiError(err);
          this.toastService.error(userMessage);
        },
      });
  }

  onCancel(): void {
    if (this.isSubmitting()) return;
    this.selectedReason.set(null);
    this.cancel.emit();
  }

  /**
   * Reset al reabrir (defensivo: si el padre reutiliza el modal con otro
   * `orderItemIds`, no arrastramos selección previa).
   */
  onOpenChange(open: boolean): void {
    if (open) {
      this.selectedReason.set(null);
      this.isSubmitting.set(false);
    }
  }
}