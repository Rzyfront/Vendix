import { Component, computed, inject, input, model, output } from '@angular/core';
import { ModalComponent } from '../../../../../shared/components';
import { PosRestaurantIntegrationService } from '../services/pos-restaurant-integration.service';
import { SplitAccountsPanelComponent } from '../../restaurant-ops/tables/components/split-accounts-panel/split-accounts-panel.component';
import type { SplitResult, SplitSourceItem } from '../../restaurant-ops/tables/interfaces';

@Component({
  selector: 'app-pos-split-bill-modal', standalone: true,
  imports: [ModalComponent, SplitAccountsPanelComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" title="Cuentas independientes" size="xl" [dialog]="true">
      @if (isOpen() && resolvedOrderId(); as id) {
        <app-split-accounts-panel [sourceOrderId]="id" [items]="resolvedItems()" (splitCompleted)="splitCompleted.emit($event)" />
      } @else { <p>Guarda la orden o abre una mesa antes de dividir su saldo.</p> }
    </app-modal>
  `,
})
export class PosSplitBillModalComponent {
  private readonly integration = inject(PosRestaurantIntegrationService);
  readonly isOpen = model(false);
  readonly sourceOrderId = input<number | null>(null);
  readonly items = input<SplitSourceItem[]>([]);
  readonly splitCompleted = output<SplitResult>();
  readonly resolvedOrderId = computed(() => this.sourceOrderId() ?? this.integration.currentTableSession()?.order_id ?? null);
  readonly resolvedItems = computed(() => this.items().length ? this.items() : this.integration.currentTableSession()?.order?.order_items ?? []);
}
