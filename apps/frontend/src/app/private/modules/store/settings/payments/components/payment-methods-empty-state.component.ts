import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-payment-methods-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="text-center py-12">
      <div
        class="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4"
      >
        <app-icon
          name="credit-card"
          [size]="32"
          class="text-gray-400"
        ></app-icon>
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-2">
        No payment methods configured
      </h3>
      <p class="text-gray-600 max-w-md mx-auto mb-6">
        Get started by adding your first payment method. You can choose from
        various payment providers like credit cards, PayPal, bank transfers, and
        cash payments.
      </p>
      <div class="space-y-3">
        <app-button variant="primary" (clicked)="addPaymentMethod.emit()">
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          Add Your First Payment Method
        </app-button>
        <div class="text-sm text-gray-500">
          <p>Popular options include:</p>
          <ul class="mt-2 space-y-1">
            <li>• Credit/Debit Cards (Stripe)</li>
            <li>• PayPal</li>
            <li>• Bank Transfers</li>
            <li>• Cash Payments</li>
          </ul>
        </div>
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
export class PaymentMethodsEmptyStateComponent {
  @Output() addPaymentMethod = new EventEmitter<void>();
}
