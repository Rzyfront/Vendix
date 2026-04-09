import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
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
  PaginationComponent,
} from '../../../../../../app/shared/components';
import { StickyHeaderComponent } from '../../../../../../app/shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-customer-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CurrencyPipe,
    CardComponent,
    ButtonComponent,
    SpinnerComponent,
    IconComponent,
    EmptyStateComponent,
    InputComponent,
    SelectorComponent,
    PaginationComponent,
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
              <div *ngIf="wallet" class="flex items-center gap-2">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="showAdjustForm = !showAdjustForm; showTopUpForm = false"
                >
                  {{ showAdjustForm ? 'Cancelar' : 'Ajustar' }}
                </app-button>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="showTopUpForm = !showTopUpForm; showAdjustForm = false"
                >
                  {{ showTopUpForm ? 'Cancelar' : 'Recargar' }}
                </app-button>
              </div>
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

              <!-- Adjust Form -->
              <div
                *ngIf="showAdjustForm"
                class="p-4 rounded-lg mb-4"
                style="background: var(--color-background); border: 1px solid var(--color-border);"
              >
                <h4 class="font-semibold mb-3" style="color: var(--color-text-primary)">
                  Ajustar Wallet
                </h4>
                <form [formGroup]="adjustForm" (ngSubmit)="adjustWallet()">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <app-selector
                      label="Tipo"
                      formControlName="type"
                      [options]="adjustTypeOptions"
                    ></app-selector>
                    <app-input
                      label="Monto"
                      [currency]="true"
                      formControlName="amount"
                      placeholder="0"
                      [prefixIcon]="true"
                    >
                      <span slot="prefix-icon">$</span>
                    </app-input>
                    <div class="sm:col-span-2">
                      <app-input
                        label="Razón"
                        formControlName="reason"
                        placeholder="Ej: Corrección de saldo, bonificación..."
                      ></app-input>
                    </div>
                    <div class="sm:col-span-2">
                      <app-input
                        label="Referencia (opcional)"
                        formControlName="reference"
                        placeholder="Ej: Ticket #123"
                      ></app-input>
                    </div>
                  </div>
                  <div
                    *ngIf="adjustError"
                    class="mt-2 p-2 rounded text-sm"
                    style="background: var(--color-error-light); color: var(--color-error);"
                  >
                    {{ adjustError }}
                  </div>
                  <div class="flex gap-2 justify-end mt-3">
                    <app-button variant="ghost" size="sm" (clicked)="showAdjustForm = false">
                      Cancelar
                    </app-button>
                    <app-button
                      [variant]="adjustForm.get('type')?.value === 'debit' ? 'danger' : 'primary'"
                      size="sm"
                      [loading]="adjustLoading"
                      [disabled]="!adjustForm.valid"
                      (clicked)="adjustWallet()"
                    >
                      {{ adjustForm.get('type')?.value === 'debit' ? 'Debitar' : 'Acreditar' }}
                    </app-button>
                  </div>
                </form>
              </div>

              <!-- Transaction History -->
              <div>
                <!-- Header with filters toggle -->
                <div class="flex items-center justify-between mb-3">
                  <h4
                    class="font-semibold"
                    style="color: var(--color-text-primary)"
                  >
                    Historial de Movimientos
                  </h4>
                  <div class="flex items-center gap-2">
                    <app-button
                      *ngIf="hasActiveFilters"
                      variant="ghost"
                      size="sm"
                      (clicked)="clearHistoryFilters()"
                    >
                      Limpiar
                    </app-button>
                    <app-button
                      variant="ghost"
                      size="sm"
                      (clicked)="showHistoryFilters = !showHistoryFilters"
                    >
                      <app-icon name="filter" [size]="14"></app-icon>
                      Filtros
                    </app-button>
                  </div>
                </div>

                <!-- Filter row (collapsible) -->
                <div
                  *ngIf="showHistoryFilters"
                  class="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 rounded-lg mb-3"
                  style="background: var(--color-background); border: 1px solid var(--color-border);"
                >
                  <app-selector
                    label="Tipo"
                    [options]="historyTypeOptions"
                    [(ngModel)]="historyFilterType"
                    (ngModelChange)="onHistoryFilterChange()"
                    placeholder="Todos"
                  ></app-selector>
                  <app-input
                    label="Desde"
                    type="date"
                    [(ngModel)]="historyDateFrom"
                    (ngModelChange)="onHistoryFilterChange()"
                  ></app-input>
                  <app-input
                    label="Hasta"
                    type="date"
                    [(ngModel)]="historyDateTo"
                    (ngModelChange)="onHistoryFilterChange()"
                  ></app-input>
                </div>

                <!-- Loading -->
                <div *ngIf="loadingHistory" class="flex justify-center py-4">
                  <app-spinner></app-spinner>
                </div>

                <!-- Content -->
                <ng-container *ngIf="!loadingHistory">
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

                  <!-- Pagination -->
                  <div *ngIf="historyTotalPages > 1" class="mt-4 flex justify-center">
                    <app-pagination
                      [currentPage]="historyPage"
                      [totalPages]="historyTotalPages"
                      [total]="historyTotal"
                      [limit]="historyLimit"
                      infoStyle="page"
                      (pageChange)="onHistoryPageChange($event)"
                    ></app-pagination>
                  </div>
                </ng-container>
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

  // Adjust wallet
  showAdjustForm = false;
  adjustLoading = false;
  adjustError: string | null = null;
  adjustForm: FormGroup;
  adjustTypeOptions = [
    { value: 'credit', label: 'Crédito (abonar)' },
    { value: 'debit', label: 'Débito (descontar)' },
  ];

  // Filtros de historial
  historyFilterType = '';
  historyDateFrom = '';
  historyDateTo = '';
  showHistoryFilters = false;
  historyTypeOptions = [
    { value: '', label: 'Todos' },
    { value: 'credit', label: 'Créditos' },
    { value: 'debit', label: 'Débitos' },
    { value: 'hold', label: 'Retenciones' },
    { value: 'release', label: 'Liberaciones' },
  ];

  // Paginación de historial
  historyPage = 1;
  historyLimit = 20;
  historyTotal = 0;
  historyTotalPages = 0;
  loadingHistory = false;

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
    this.adjustForm = this.fb.group({
      type: ['credit', [Validators.required]],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      reason: ['', [Validators.required]],
      reference: [''],
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
    this.loadingHistory = true;

    let url = `${this.walletApiUrl}/${this.customerId}/history?page=${this.historyPage}&limit=${this.historyLimit}`;
    if (this.historyFilterType) url += `&type=${this.historyFilterType}`;
    if (this.historyDateFrom) url += `&date_from=${this.historyDateFrom}`;
    if (this.historyDateTo) url += `&date_to=${this.historyDateTo}`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        const payload = res.data || res;
        this.walletHistory = Array.isArray(payload) ? payload : payload?.data || [];
        const meta = payload?.meta;
        if (meta) {
          this.historyTotal = meta.total || 0;
          this.historyTotalPages = meta.total_pages || 0;
          this.historyPage = meta.page || 1;
        }
        this.loadingHistory = false;
      },
      error: () => {
        this.walletHistory = [];
        this.loadingHistory = false;
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
          this.historyPage = 1;
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

  adjustWallet(): void {
    if (!this.adjustForm.valid || !this.customerId) return;
    this.adjustLoading = true;
    this.adjustError = null;

    this.http
      .post<any>(
        `${this.walletApiUrl}/${this.customerId}/adjust`,
        this.adjustForm.value,
      )
      .subscribe({
        next: () => {
          this.adjustLoading = false;
          this.showAdjustForm = false;
          this.adjustForm.reset({ type: 'credit' });
          this.loadWallet();
          this.historyPage = 1;
          this.loadWalletHistory();
        },
        error: (err) => {
          this.adjustLoading = false;
          this.adjustError = extractApiErrorMessage(err);
        },
      });
  }

  onHistoryFilterChange(): void {
    this.historyPage = 1;
    this.loadWalletHistory();
  }

  clearHistoryFilters(): void {
    this.historyFilterType = '';
    this.historyDateFrom = '';
    this.historyDateTo = '';
    this.historyPage = 1;
    this.loadWalletHistory();
  }

  onHistoryPageChange(page: number): void {
    this.historyPage = page;
    this.loadWalletHistory();
  }

  get hasActiveFilters(): boolean {
    return !!this.historyFilterType || !!this.historyDateFrom || !!this.historyDateTo;
  }

  goBack(): void {
    this.router.navigate(['/admin/customers/all']);
  }
}
