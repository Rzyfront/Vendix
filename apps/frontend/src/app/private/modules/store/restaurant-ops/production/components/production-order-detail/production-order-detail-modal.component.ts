import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { ModalComponent } from '../../../../../../../shared/components';
import { ProductionOrderDetailComponent } from './production-order-detail.component';

/**
 * Modal wrapper of the shared production order detail, so other modules
 * (sale detail, scheduled orders, production list) can open it in place.
 */
@Component({
  selector: 'app-production-order-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ProductionOrderDetailComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Orden de producción"
      size="lg"
      [fullScreenOnMobile]="true"
    >
      @if (isOpen()) {
        <app-production-order-detail
          [orderId]="orderId()"
          (changed)="changed.emit()"
        />
      }
    </app-modal>
  `,
})
export class ProductionOrderDetailModalComponent {
  readonly orderId = input<number | null>(null);
  readonly isOpen = model<boolean>(false);
  /** Re-emitted so the host refreshes after start / complete / cancel. */
  readonly changed = output<void>();
}
