import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { environment } from '../../../../../../environments/environment';
import { CustomersService } from '../services/customers.service';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../app/shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  CardComponent,
  ButtonComponent,
  SpinnerComponent,
  IconComponent,
  EmptyStateComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../app/shared/components';
import { StickyHeaderComponent } from '../../../../../../app/shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-customer-details',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CurrencyPipe,
    CardComponent,
    ButtonComponent,
    SpinnerComponent,
    IconComponent,
    EmptyStateComponent,
    InputComponent,
    SelectorComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Sticky Header -->
      <app-sticky-header
        title="Detalle del Cliente"
        [subtitle]="customer ? (customer.first_name + ' ' + customer.last_name) : 'Cargando...'"
        icon="user"
        [showBackButton]="true"
        backRoute="/admin/customers/all"
        [badgeText]="customer?.state === 'active' ? 'Activo' : customer?.state === 'inactive' ? 'Inactivo' : ''"
        [badgeColor]="customer?.state === 'active' ? 'green' : 'red'"
      ></app-sticky-header>

      <!-- Content -->
      <div class="flex flex-col gap-4 md:gap-6">
        <!-- Loading -->
        <div *ngIf="loadingCustomer" class="flex justify-center py-12">
          <app-spinner></app-spinner>
        </div>

        <!-- Error -->
        <div
          *ngIf="errorMessage && !loadingCustomer"
          class="p-4 rounded-lg"
          style="background: var(--color-error-light); color: var(--color-error)"
        >
          {{ errorMessage }}
        </div>

        <!-- Customer Info Card -->
        <app-card *ngIf="customer && !loadingCustomer">
          <div class="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
            <div class="flex items-center gap-4 flex-1">
              <div
                class="w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0"
                style="background: var(--color-primary); color: var(--color-text-on-primary)"
              >
                {{ getInitials() }}
              </div>
              <div>
                <h2 class="text-xl font-bold" style="color: var(--color-text-primary)">
                  {{ customer.first_name }} {{ customer.last_name }}
                </h2>
                <div class="flex items-center gap-2 mt-1">
                  <app-icon name="mail" [size]="14" style="color: var(--color-text-muted)"></app-icon>
                  <span class="text-sm" style="color: var(--color-text-muted)">{{ customer.email }}</span>
                </div>
                <div *ngIf="customer.phone" class="flex items-center gap-2 mt-0.5">
                  <app-icon name="phone" [size]="14" style="color: var(--color-text-muted)"></app-icon>
                  <span class="text-sm" style="color: var(--color-text-muted)">{{ customer.phone }}</span>
                </div>
              </div>
            </div>
          </div>

          <div
            class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4"
            style="border-top: 1px solid var(--color-border)"
          >
            <div *ngIf="customer.document_number" class="flex flex-col gap-1">
              <span class="text-xs" style="color: var(--color-text-muted)">Documento</span>
              <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                {{ customer.document_type || 'CC' }} {{ customer.document_number }}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs" style="color: var(--color-text-muted)">Cliente desde</span>
              <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                {{ customer.created_at | date:'mediumDate' }}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs" style="color: var(--color-text-muted)">Última compra</span>
              <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                {{ customer.last_order_date ? (customer.last_order_date | date:'mediumDate') : 'Sin compras' }}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs" style="color: var(--color-text-muted)">Órdenes</span>
              <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                {{ customer.total_orders || 0 }}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs" style="color: var(--color-text-muted)">Gasto total</span>
              <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                {{ customer.total_spend | currency }}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs" style="color: var(--color-text-muted)">Ticket promedio</span>
              <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                {{ getAverageTicket() | currency }}
              </span>
            </div>
          </div>
        </app-card>

          <!-- Wallet Card -->
          <app-card *ngIf="customer && !loadingCustomer">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-2">
                <app-icon
                  name="wallet"
                  [size]="20"
                  class="text-primary"
                ></app-icon>
                <h3
                  class="text-lg font-bold"
                  style="color: var(--color-text-primary)"
                >
                  Wallet
                </h3>
              </div>
              <app-button
                *ngIf="wallet"
                variant="primary"
                size="sm"
                (clicked)="showTopUpForm = !showTopUpForm"
              >
                {{ showTopUpForm ? 'Cancelar' : 'Recargar' }}
              </app-button>
            </div>

            <!-- Wallet Loading -->
            <div *ngIf="loadingWallet" class="flex justify-center py-6">
              <app-spinner></app-spinner>
            </div>

            <!-- Wallet Error -->
            <div
              *ngIf="walletError && !loadingWallet"
              class="p-3 rounded-lg mb-4"
              style="
                background: var(--color-error-light);
                color: var(--color-error);
              "
            >
              {{ walletError }}
            </div>

            <!-- Wallet Balance -->
            <div *ngIf="wallet && !loadingWallet">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div
                  class="p-3 rounded-lg"
                  style="background: var(--color-background)"
                >
                  <span
                    class="text-xs block"
                    style="color: var(--color-text-muted)"
                    >Saldo disponible</span
                  >
                  <span
                    class="text-xl font-bold"
                    style="color: var(--color-success)"
                    >{{ getAvailable() | currency }}</span
                  >
                </div>
                <div
                  class="p-3 rounded-lg"
                  style="background: var(--color-background)"
                >
                  <span
                    class="text-xs block"
                    style="color: var(--color-text-muted)"
                    >Saldo retenido</span
                  >
                  <span
                    class="text-xl font-bold"
                    style="color: var(--color-text-muted)"
                    >{{ wallet.held_balance | currency }}</span
                  >
                </div>
                <div
                  class="p-3 rounded-lg"
                  style="background: var(--color-background)"
                >
                  <span
                    class="text-xs block"
                    style="color: var(--color-text-muted)"
                    >Balance total</span
                  >
                  <span
                    class="text-xl font-bold"
                    style="color: var(--color-text-primary)"
                    >{{ wallet.balance | currency }}</span
                  >
                </div>
              </div>

              <!-- Top Up Form -->
              <div
                *ngIf="showTopUpForm"
                class="p-4 rounded-lg mb-4"
                style="
                  background: var(--color-background);
                  border: 1px solid var(--color-border);
                "
              >
                <h4
                  class="font-semibold mb-3"
                  style="color: var(--color-text-primary)"
                >
                  Recargar Wallet
                </h4>
                <form [formGroup]="topUpForm" (ngSubmit)="topUpWallet()">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <app-input
                      label="Monto"
                      [currency]="true"
                      formControlName="amount"
                      placeholder="0"
                      [prefixIcon]="true"
                    >
                      <span slot="prefix-icon">$</span>
                    </app-input>
                    <app-selector
                      label="Método de pago"
                      formControlName="payment_method"
                      [options]="paymentMethodOptions"
                    ></app-selector>
                    <div class="sm:col-span-2">
                      <app-input
                        label="Descripción"
                        formControlName="description"
                        placeholder="Ej: Recarga en tienda"
                      ></app-input>
                    </div>
                  </div>
                  <div
                    *ngIf="topUpError"
                    class="mt-2 p-2 rounded text-sm"
                    style="
                      background: var(--color-error-light);
                      color: var(--color-error);
                    "
                  >
                    {{ topUpError }}
                  </div>
                  <div class="flex gap-2 justify-end mt-3">
                    <app-button
                      variant="ghost"
                      size="sm"
                      (clicked)="showTopUpForm = false"
                      >Cancelar</app-button
                    >
                    <app-button
                      variant="primary"
                      size="sm"
                      [loading]="topUpLoading"
                      [disabled]="!topUpForm.valid"
                      (clicked)="topUpWallet()"
                      >Recargar</app-button
                    >
                  </div>
                </form>
              </div>

              <!-- Transaction History -->
              <div>
                <h4
                  class="font-semibold mb-3"
                  style="color: var(--color-text-primary)"
                >
                  Historial de Movimientos
                </h4>
                <app-empty-state
                  *ngIf="walletHistory.length === 0"
                  icon="inbox"
                  message="No hay movimientos aún"
                ></app-empty-state>
                <div
                  *ngIf="walletHistory.length > 0"
                  class="flex flex-col"
                >
                  <div
                    *ngFor="let tx of walletHistory"
                    class="flex justify-between items-center py-3"
                    style="border-bottom: 1px solid var(--color-border)"
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        [style.background]="
                          tx.type === 'credit' || tx.type === 'release'
                            ? 'var(--color-success-light)'
                            : 'var(--color-error-light)'
                        "
                        [style.color]="
                          tx.type === 'credit' || tx.type === 'release'
                            ? 'var(--color-success)'
                            : 'var(--color-error)'
                        "
                      >
                        {{
                          tx.type === 'credit' || tx.type === 'release'
                            ? '↓'
                            : '↑'
                        }}
                      </div>
                      <div>
                        <p
                          class="text-sm font-medium"
                          style="color: var(--color-text-primary)"
                        >
                          {{ getTransactionLabel(tx.type) }}
                        </p>
                        <p
                          class="text-xs"
                          style="color: var(--color-text-muted)"
                        >
                          {{ tx.description || tx.reference_type || '-' }}
                        </p>
                      </div>
                    </div>
                    <div class="text-right">
                      <p
                        class="text-sm font-bold"
                        [style.color]="
                          tx.type === 'credit' || tx.type === 'release'
                            ? 'var(--color-success)'
                            : 'var(--color-error)'
                        "
                      >
                        {{
                          tx.type === 'credit' || tx.type === 'release'
                            ? '+'
                            : '-'
                        }}{{ tx.amount | currency }}
                      </p>
                      <p
                        class="text-xs"
                        style="color: var(--color-text-muted)"
                      >
                        {{ tx.created_at | date : 'short' }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- No Wallet -->
            <div
              *ngIf="!wallet && !loadingWallet && !walletError"
              class="text-center py-6"
            >
              <app-empty-state
                icon="wallet"
                message="Este cliente no tiene wallet aún."
              ></app-empty-state>
              <app-button
                variant="primary"
                size="sm"
                class="mt-3"
                (clicked)="createAndLoadWallet()"
                >Crear Wallet</app-button
              >
            </div>
          </app-card>
      </div>
    </div>
  `,
})
export class CustomerDetailsComponent implements OnInit {
  customerId: number | null = null;
  customer: any = null;
  wallet: any = null;
  walletHistory: any[] = [];
  loadingCustomer = true;
  loadingWallet = true;
  showTopUpForm = false;
  topUpLoading = false;
  topUpForm: FormGroup;
  errorMessage: string | null = null;
  walletError: string | null = null;
  topUpError: string | null = null;

  paymentMethodOptions = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'bank_transfer', label: 'Transferencia' },
  ];

  private walletApiUrl = `${environment.apiUrl}/store/wallets`;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private fb: FormBuilder,
    private customersService: CustomersService,
  ) {
    this.topUpForm = this.fb.group({
      amount: [null, [Validators.required, Validators.min(1)]],
      description: [''],
      payment_method: ['cash'],
    });
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.customerId = parseInt(id, 10);
        this.loadCustomer();
        this.loadWallet();
        this.loadWalletHistory();
      }
    });
  }

  loadCustomer(): void {
    if (!this.customerId) return;
    this.loadingCustomer = true;
    this.customersService.getCustomer(this.customerId).subscribe({
      next: (customer) => {
        this.customer = customer;
        this.loadingCustomer = false;
      },
      error: (err) => {
        this.loadingCustomer = false;
        this.errorMessage = extractApiErrorMessage(err);
      },
    });
  }

  loadWallet(): void {
    if (!this.customerId) return;
    this.loadingWallet = true;
    this.http.get<any>(`${this.walletApiUrl}/${this.customerId}`).subscribe({
      next: (res) => {
        const data = res.data || res;
        this.wallet = data?.id || data?.wallet_id ? data : null;
        this.loadingWallet = false;
      },
      error: (err) => {
        this.wallet = null;
        this.loadingWallet = false;
        this.walletError = extractApiErrorMessage(err);
      },
    });
  }

  loadWalletHistory(): void {
    if (!this.customerId) return;
    this.http
      .get<any>(
        `${this.walletApiUrl}/${this.customerId}/history?page=1&limit=20`,
      )
      .subscribe({
        next: (res) => {
          const data = res.data || res;
          this.walletHistory = Array.isArray(data) ? data : data?.data || [];
        },
        error: () => {
          this.walletHistory = [];
        },
      });
  }

  topUpWallet(): void {
    if (!this.topUpForm.valid || !this.customerId) return;
    this.topUpLoading = true;
    this.topUpError = null;
    this.http
      .post<any>(
        `${this.walletApiUrl}/${this.customerId}/topup`,
        this.topUpForm.value,
      )
      .subscribe({
        next: () => {
          this.topUpLoading = false;
          this.showTopUpForm = false;
          this.topUpForm.reset({ payment_method: 'cash' });
          this.loadWallet();
          this.loadWalletHistory();
        },
        error: (err) => {
          this.topUpLoading = false;
          this.topUpError = extractApiErrorMessage(err);
        },
      });
  }

  createAndLoadWallet(): void {
    this.loadWallet();
  }

  getAvailable(): number {
    if (!this.wallet) return 0;
    return (
      Number(this.wallet.balance || 0) -
      Number(this.wallet.held_balance || 0)
    );
  }

  getInitials(): string {
    if (!this.customer) return '?';
    const f = this.customer.first_name?.[0] || '';
    const l = this.customer.last_name?.[0] || '';
    return (f + l).toUpperCase();
  }

  getAverageTicket(): number {
    if (!this.customer?.total_orders || !this.customer?.total_spend) return 0;
    return Number(this.customer.total_spend) / Number(this.customer.total_orders);
  }

  getTransactionLabel(type: string): string {
    const labels: Record<string, string> = {
      credit: 'Recarga',
      debit: 'Pago / Débito',
      hold: 'Retención',
      release: 'Liberación',
    };
    return labels[type] || type;
  }

  goBack(): void {
    this.router.navigate(['/admin/customers/all']);
  }
}
