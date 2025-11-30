import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../../shared/components';

@Component({
  selector: 'app-order-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div class="text-center py-12">
      <!-- Icon -->
      <div
        class="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6"
      >
        <svg
          class="w-12 h-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          ></path>
        </svg>
      </div>

      <!-- Title -->
      <h3 class="text-lg font-medium text-gray-900 mb-2">
        {{ title }}
      </h3>

      <!-- Description -->
      <p class="text-gray-500 mb-6 max-w-md mx-auto">
        {{ description }}
      </p>

      <!-- Actions -->
      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <app-button variant="primary" (clicked)="actionClick.emit()">
          {{ actionButtonText }}
        </app-button>

        <app-button
          variant="outline"
          (clicked)="refreshClick.emit()"
          *ngIf="showRefreshButton"
        >
          Refresh
        </app-button>

        <app-button
          variant="ghost"
          (clicked)="clearFiltersClick.emit()"
          *ngIf="showAdditionalActions"
        >
          Clear Filters
        </app-button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class OrderEmptyStateComponent {
  @Input() title = 'No orders found';
  @Input() description = 'Get started by creating your first order.';
  @Input() actionButtonText = 'Create First Order';
  @Input() showAdditionalActions = false;
  @Input() showRefreshButton = true;

  @Output() actionClick = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() clearFiltersClick = new EventEmitter<void>();
}
