import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-purchase-order-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  templateUrl: './purchase-order-empty-state.component.html',
  styleUrls: ['./purchase-order-empty-state.component.scss'],
})
export class PurchaseOrderEmptyStateComponent {
  @Input() title = 'No se encontraron órdenes de compra';
  @Input() description = 'Comienza creando tu primera orden de compra para reabastecer inventario.';
  @Input() actionButtonText = 'Crear Primera Orden';
  @Input() showActionButton = true;
  @Input() showAdditionalActions = false;
  @Input() showRefreshButton = true;

  @Output() actionClick = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() clearFiltersClick = new EventEmitter<void>();
}
