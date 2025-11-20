import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { PaymentMethodsService } from './services/payment-methods.service';
import {
  PaymentMethodStats,
  StorePaymentMethod,
} from './interfaces/payment-methods.interface';
import { PaymentMethodsStatsComponent } from './components/payment-methods-stats.component';
import { PaymentMethodsListComponent } from './components/payment-methods-list.component';
import { PaymentMethodsEmptyStateComponent } from './components/payment-methods-empty-state.component';
import {
  ButtonComponent,
  ModalComponent,
  ToastService,
  IconComponent,
} from '../../../../../../app/shared/components/index';

@Component({
  selector: 'app-payments-settings',
  standalone: true,
  imports: [
    CommonModule,
    PaymentMethodsStatsComponent,
    PaymentMethodsListComponent,
    PaymentMethodsEmptyStateComponent,
    ButtonComponent,
    ModalComponent,
    IconComponent,
  ],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">
              Payment Methods
            </h1>
            <p class="text-gray-600">
              Configure payment methods and processing settings for your store
            </p>
          </div>
          <app-button
            variant="primary"
            (clicked)="openEnablePaymentMethodModal()"
            [loading]="is_loading"
          >
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Add Payment Method
          </app-button>
        </div>
      </div>

      <!-- Statistics Section -->
      <app-payment-methods-stats
        [stats]="payment_method_stats"
        [is_loading]="is_loading_stats"
      >
      </app-payment-methods-stats>

      <!-- Payment Methods List -->
      <div class="mt-8">
        <div class="bg-white rounded-lg shadow-sm border">
          <div class="px-6 py-4 border-b border-gray-200">
            <h2 class="text-lg font-semibold text-gray-900">
              Enabled Payment Methods
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Manage payment methods available to your customers
            </p>
          </div>

          <div class="p-6">
            <!-- Loading State -->
            <div
              *ngIf="is_loading"
              class="flex items-center justify-center py-12"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
              ></div>
            </div>

            <!-- Empty State -->
            <app-payment-methods-empty-state
              *ngIf="!is_loading && payment_methods.length === 0"
              (addPaymentMethod)="openEnablePaymentMethodModal()"
            >
            </app-payment-methods-empty-state>

            <!-- Payment Methods List -->
            <app-payment-methods-list
              *ngIf="!is_loading && payment_methods.length > 0"
              [payment_methods]="payment_methods"
              [is_loading]="is_loading"
              (edit)="openEditPaymentMethodModal($event)"
              (toggle)="togglePaymentMethod($event)"
              (delete)="deletePaymentMethod($event)"
              (reorder)="reorderPaymentMethods($event)"
            >
            </app-payment-methods-list>
          </div>
        </div>
      </div>

      <!-- Enable Payment Method Modal -->
      <app-modal
        *ngIf="show_enable_modal"
        [size]="'lg'"
        [title]="'Add Payment Method'"
        (closed)="closeEnablePaymentMethodModal()"
      >
        <div class="p-6">
          <p class="text-gray-600 mb-4">
            Select a payment method to enable for your store. You can configure
            it after enabling.
          </p>

          <div class="space-y-3">
            <div
              *ngFor="let method of available_payment_methods"
              class="border rounded-lg p-4 cursor-pointer transition-colors hover:bg-gray-50"
              [class.border-blue-500]="selected_method?.id === method.id"
              [class.bg-blue-50]="selected_method?.id === method.id"
              (click)="selectPaymentMethod(method)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-3">
                  <app-icon
                    [name]="getPaymentMethodIcon(method.type)"
                    [size]="24"
                  ></app-icon>
                  <div>
                    <h3 class="font-medium text-gray-900">
                      {{ method.display_name }}
                    </h3>
                    <p class="text-sm text-gray-600">
                      {{ method.description }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center space-x-2">
                  <span
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {{ getPaymentMethodTypeLabel(method.type) }}
                  </span>
                  <div
                    *ngIf="selected_method?.id === method.id"
                    class="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center"
                  >
                    <app-icon
                      name="check"
                      [size]="12"
                      class="text-white"
                    ></app-icon>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            *ngIf="!available_payment_methods.length && !is_loading_available"
            class="text-center py-8"
          >
            <app-icon
              name="info"
              [size]="48"
              class="text-gray-400 mx-auto mb-3"
            ></app-icon>
            <p class="text-gray-600">
              No additional payment methods are available to enable.
            </p>
          </div>

          <div
            *ngIf="is_loading_available"
            class="flex items-center justify-center py-8"
          >
            <div
              class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"
            ></div>
          </div>
        </div>

        <div
          class="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3"
        >
          <app-button
            variant="secondary"
            (clicked)="closeEnablePaymentMethodModal()"
          >
            Cancel
          </app-button>
          <app-button
            variant="primary"
            (clicked)="enableSelectedPaymentMethod()"
            [disabled]="!selected_method || is_enabling"
          >
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Enable Payment Method
          </app-button>
        </div>
      </app-modal>
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
export class PaymentsSettingsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  payment_methods: StorePaymentMethod[] = [];
  available_payment_methods: any[] = [];
  payment_method_stats: PaymentMethodStats | null = null;

  is_loading = false;
  is_loading_stats = false;
  is_loading_available = false;
  is_enabling = false;

  show_enable_modal = false;
  selected_method: any = null;

  constructor(
    private payment_methods_service: PaymentMethodsService,
    private toast_service: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.loadPaymentMethodStats();
    this.loadAvailablePaymentMethods();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPaymentMethods(): void {
    this.is_loading = true;
    this.payment_methods_service
      .getStorePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.payment_methods = response.data;
          this.is_loading = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to load payment methods: ' + error.message,
          );
          this.is_loading = false;
        },
      });
  }

  loadPaymentMethodStats(): void {
    this.is_loading_stats = true;
    this.payment_methods_service
      .getPaymentMethodStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.payment_method_stats = stats;
          this.is_loading_stats = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to load payment statistics: ' + error.message,
          );
          this.is_loading_stats = false;
        },
      });
  }

  loadAvailablePaymentMethods(): void {
    this.is_loading_available = true;
    this.payment_methods_service
      .getAvailablePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods: any) => {
          this.available_payment_methods = methods;
          this.is_loading_available = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to load available payment methods: ' + error.message,
          );
          this.is_loading_available = false;
        },
      });
  }

  openEnablePaymentMethodModal(): void {
    this.show_enable_modal = true;
    this.selected_method = null;
    if (this.available_payment_methods.length === 0) {
      this.loadAvailablePaymentMethods();
    }
  }

  closeEnablePaymentMethodModal(): void {
    this.show_enable_modal = false;
    this.selected_method = null;
  }

  selectPaymentMethod(method: any): void {
    this.selected_method = method;
  }

  enableSelectedPaymentMethod(): void {
    if (!this.selected_method) return;

    this.is_enabling = true;
    this.payment_methods_service
      .enablePaymentMethod(this.selected_method.id, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast_service.success('Payment method enabled successfully');
          this.closeEnablePaymentMethodModal();
          this.loadPaymentMethods();
          this.loadPaymentMethodStats();
          this.loadAvailablePaymentMethods();
          this.is_enabling = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to enable payment method: ' + error.message,
          );
          this.is_enabling = false;
        },
      });
  }

  openEditPaymentMethodModal(method: StorePaymentMethod): void {
    // TODO: Implement edit modal
    this.toast_service.info('Edit functionality coming soon');
  }

  togglePaymentMethod(method: StorePaymentMethod): void {
    if (method.state === 'enabled') {
      this.payment_methods_service
        .disablePaymentMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Payment method disabled successfully');
            this.loadPaymentMethods();
            this.loadPaymentMethodStats();
          },
          error: (error: any) => {
            this.toast_service.error(
              'Failed to disable payment method: ' + error.message,
            );
          },
        });
    } else {
      // For now, just show a message since state update is not available in DTO
      this.toast_service.info('Enable functionality through available actions');
    }
  }

  deletePaymentMethod(method: StorePaymentMethod): void {
    // TODO: Implement confirmation dialog
    this.toast_service.info('Delete functionality coming soon');
  }

  reorderPaymentMethods(method_ids: string[]): void {
    this.payment_methods_service
      .reorderPaymentMethods({ payment_method_ids: method_ids })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast_service.success('Payment methods reordered successfully');
          this.loadPaymentMethods();
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to reorder payment methods: ' + error.message,
          );
        },
      });
  }

  getPaymentMethodIcon(type: string): string {
    return this.payment_methods_service.getPaymentMethodIcon(type);
  }

  getPaymentMethodTypeLabel(type: string): string {
    return this.payment_methods_service.getPaymentMethodTypeLabel(type);
  }
}
