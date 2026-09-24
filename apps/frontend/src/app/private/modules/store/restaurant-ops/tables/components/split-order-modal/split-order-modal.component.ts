import { Component, input, model, output } from '@angular/core';
import { ModalComponent } from '../../../../../../../shared/components';
import { SplitAccountsPanelComponent } from '../split-accounts-panel/split-accounts-panel.component';
import type { SplitResult, SplitSourceItem } from '../../interfaces';

@Component({
  selector: 'app-split-order-modal', standalone: true,
  imports: [ModalComponent, SplitAccountsPanelComponent],
  templateUrl: './split-order-modal.component.html',
})
export class SplitOrderModalComponent {
  readonly isOpen = model(false);
  readonly orderId = input<number | null>(null);
  readonly items = input<SplitSourceItem[]>([]);
  readonly splitCompleted = output<SplitResult>();
}
