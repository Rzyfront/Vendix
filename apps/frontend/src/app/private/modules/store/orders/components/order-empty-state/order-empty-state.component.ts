import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-order-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  templateUrl: './order-empty-state.component.html',
  styleUrls: ['./order-empty-state.component.scss'],
})
export class OrderEmptyStateComponent {
  @Input() title = 'No se encontraron órdenes';
  @Input() description = 'Comienza creando tu primera orden de venta.';
  @Input() actionButtonText = 'Crear Primera Orden';
  @Input() showActionButton = true;
  @Input() showAdditionalActions = false;
  @Input() showRefreshButton = true;

  @Output() actionClick = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() clearFiltersClick = new EventEmitter<void>();
}
