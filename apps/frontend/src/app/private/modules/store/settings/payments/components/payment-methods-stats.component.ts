import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaymentMethodStats } from '../interfaces/payment-methods.interface';
import { IconComponent } from '../../../../../../shared/components/index';

@Component({
  selector: 'app-payment-methods-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <!-- Total Methods -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div
              class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center"
            >
              <app-icon
                name="credit-card"
                [size]="16"
                class="text-blue-600"
              ></app-icon>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">Total Methods</p>
            <div class="flex items-baseline">
              <p class="text-2xl font-semibold text-gray-900">
                {{ is_loading ? '-' : stats?.total_methods || 0 }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Enabled Methods -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div
              class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center"
            >
              <app-icon
                name="check-circle"
                [size]="16"
                class="text-green-600"
              ></app-icon>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">Enabled</p>
            <div class="flex items-baseline">
              <p class="text-2xl font-semibold text-gray-900">
                {{ is_loading ? '-' : stats?.enabled_methods || 0 }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Requires Configuration -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div
              class="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center"
            >
              <app-icon
                name="alert-triangle"
                [size]="16"
                class="text-yellow-600"
              ></app-icon>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">Needs Config</p>
            <div class="flex items-baseline">
              <p class="text-2xl font-semibold text-gray-900">
                {{ is_loading ? '-' : stats?.requires_config || 0 }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Total Revenue -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div
              class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center"
            >
              <app-icon
                name="dollar-sign"
                [size]="16"
                class="text-purple-600"
              ></app-icon>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">Total Revenue</p>
            <div class="flex items-baseline">
              <p class="text-2xl font-semibold text-gray-900">
                {{
                  is_loading
                    ? '-'
                    : (stats?.total_revenue || 0 | currency: 'USD' : 'symbol')
                }}
              </p>
            </div>
          </div>
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
export class PaymentMethodsStatsComponent {
  @Input() stats: PaymentMethodStats | null = null;
  @Input() is_loading = false;
}
