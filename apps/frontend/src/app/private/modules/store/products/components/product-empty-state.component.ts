import { Component, Input, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components';

@Component({
  selector: 'app-product-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="text-center py-12">
      <div
        class="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4"
      >
        <app-icon name="package" [size]="32" class="text-gray-400"></app-icon>
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-2">{{ title }}</h3>
      <p class="text-gray-600 mb-6 max-w-md mx-auto">{{ description }}</p>

      <div class="flex justify-center space-x-3" *ngIf="showAction">
        <app-button variant="primary" (clicked)="actionClicked.emit()">
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          {{ actionText }}
        </app-button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ProductEmptyStateComponent {
  @Input() title = 'No products found';
  @Input() description = 'Get started by creating your first product';
  @Input() showAction = true;
  @Input() actionText = 'Create Product';

  actionClicked = new EventEmitter<void>();
}
