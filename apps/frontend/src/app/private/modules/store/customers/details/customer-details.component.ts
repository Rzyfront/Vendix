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

@Component({
  selector: 'app-customer-details',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="w-full max-w-4xl mx-auto">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <button (click)="goBack()" class="back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <div>
          <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Detalle del Cliente</h1>
          <p class="text-sm" style="color: var(--color-text-muted)">Información y wallet del cliente</p>
        </div>
      </div>

      <!-- Loading -->
      <div *ngIf="loadingCustomer" class="card text-center py-12">
        <div class="spinner mx-auto mb-3"></div>
        <p style="color: var(--color-text-muted)">Cargando cliente...</p>
      </div>

      <!-- Customer Info Card -->
      <div *ngIf="customer && !loadingCustomer" class="card mb-4">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="avatar">{{ getInitials() }}</div>
            <div>
              <h2 class="text-xl font-bold" style="color: var(--color-text-primary)">
                {{ customer.first_name }} {{ customer.last_name }}
              </h2>
              <p class="text-sm" style="color: var(--color-text-muted)">{{ customer.email }}</p>
            </div>
          </div>
          <span class="status-badge"
                [class.active]="customer.state === 'active'"
                [class.inactive]="customer.state !== 'active'">
            {{ customer.state === 'active' ? 'Activo' : 'Inactivo' }}
          </span>
        </div>

        <div class="info-grid mt-4">
          <div class="info-item" *ngIf="customer.phone">
            <span class="info-label">Teléfono</span>
            <span class="info-value">{{ customer.phone }}</span>
          </div>
          <div class="info-item" *ngIf="customer.document_number">
            <span class="info-label">Documento</span>
            <span class="info-value">{{ customer.document_type || 'CC' }} {{ customer.document_number }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Cliente desde</span>
            <span class="info-value">{{ customer.created_at | date:'mediumDate' }}</span>
          </div>
          <div class="info-item" *ngIf="customer.total_orders != null">
            <span class="info-label">Órdenes</span>
            <span class="info-value">{{ customer.total_orders }}</span>
          </div>
          <div class="info-item" *ngIf="customer.total_spend != null">
            <span class="info-label">Gasto total</span>
            <span class="info-value">\${{ customer.total_spend | number:'1.0-0' }}</span>
          </div>
        </div>
      </div>

      <!-- Wallet Card -->
      <div *ngIf="customer && !loadingCustomer" class="card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold" style="color: var(--color-text-primary)">Wallet</h3>
          <button *ngIf="wallet" (click)="showTopUpForm = !showTopUpForm" class="btn-primary btn-sm">
            {{ showTopUpForm ? 'Cancelar' : 'Recargar' }}
          </button>
        </div>

        <!-- Wallet Loading -->
        <div *ngIf="loadingWallet" class="text-center py-6">
          <div class="spinner mx-auto mb-2" style="width:24px;height:24px;border-width:2px"></div>
          <p class="text-sm" style="color: var(--color-text-muted)">Consultando wallet...</p>
        </div>

        <!-- Wallet Balance -->
        <div *ngIf="wallet && !loadingWallet">
          <div class="balance-grid mb-4">
            <div class="balance-card">
              <span class="balance-label">Saldo disponible</span>
              <span class="balance-value" style="color: var(--color-success)">\${{ getAvailable() | number:'1.0-0' }}</span>
            </div>
            <div class="balance-card">
              <span class="balance-label">Saldo retenido</span>
              <span class="balance-value" style="color: var(--color-text-muted)">\${{ wallet.held_balance | number:'1.0-0' }}</span>
            </div>
            <div class="balance-card">
              <span class="balance-label">Balance total</span>
              <span class="balance-value" style="color: var(--color-text-primary)">\${{ wallet.balance | number:'1.0-0' }}</span>
            </div>
          </div>

          <!-- Top Up Form -->
          <div *ngIf="showTopUpForm" class="topup-form mb-4">
            <h4 class="font-semibold mb-3" style="color: var(--color-text-primary)">Recargar Wallet</h4>
            <form [formGroup]="topUpForm" (ngSubmit)="topUpWallet()">
              <div class="form-grid">
                <div class="form-group">
                  <label>Monto *</label>
                  <input type="number" formControlName="amount" placeholder="0" min="1" class="form-input">
                </div>
                <div class="form-group">
                  <label>Método de pago</label>
                  <select formControlName="payment_method" class="form-input">
                    <option value="cash">Efectivo</option>
                    <option value="bank_transfer">Transferencia</option>
                  </select>
                </div>
                <div class="form-group full-width">
                  <label>Descripción</label>
                  <input type="text" formControlName="description" placeholder="Ej: Recarga en tienda" class="form-input">
                </div>
              </div>
              <div class="flex gap-2 justify-end mt-3">
                <button type="button" (click)="showTopUpForm = false" class="btn-secondary btn-sm">Cancelar</button>
                <button type="submit" [disabled]="!topUpForm.valid || topUpLoading" class="btn-primary btn-sm">
                  {{ topUpLoading ? 'Procesando...' : 'Recargar' }}
                </button>
              </div>
            </form>
          </div>

          <!-- Transaction History -->
          <div>
            <h4 class="font-semibold mb-3" style="color: var(--color-text-primary)">Historial de Movimientos</h4>
            <div *ngIf="walletHistory.length === 0" class="text-center py-4">
              <p class="text-sm" style="color: var(--color-text-muted)">No hay movimientos aún</p>
            </div>
            <div *ngIf="walletHistory.length > 0" class="transaction-list">
              <div *ngFor="let tx of walletHistory" class="transaction-item">
                <div class="flex items-center gap-3">
                  <div class="tx-icon"
                       [class.credit]="tx.type === 'credit' || tx.type === 'release'"
                       [class.debit]="tx.type === 'debit' || tx.type === 'hold'">
                    {{ (tx.type === 'credit' || tx.type === 'release') ? '↓' : '↑' }}
                  </div>
                  <div>
                    <p class="font-medium text-sm" style="color: var(--color-text-primary)">
                      {{ getTransactionLabel(tx.type) }}
                    </p>
                    <p class="text-xs" style="color: var(--color-text-muted)">
                      {{ tx.description || tx.reference_type || '-' }}
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="font-bold text-sm"
                     [style.color]="(tx.type === 'credit' || tx.type === 'release') ? 'var(--color-success)' : 'var(--color-error)'">
                    {{ (tx.type === 'credit' || tx.type === 'release') ? '+' : '-' }}\${{ tx.amount | number:'1.0-0' }}
                  </p>
                  <p class="text-xs" style="color: var(--color-text-muted)">{{ tx.created_at | date:'short' }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No Wallet -->
        <div *ngIf="!wallet && !loadingWallet" class="text-center py-6">
          <p class="text-sm mb-3" style="color: var(--color-text-muted)">Este cliente no tiene wallet aún.</p>
          <button (click)="createAndLoadWallet()" class="btn-primary btn-sm">Crear Wallet</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 20px;
        box-shadow: var(--shadow-sm);
      }
      .back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        cursor: pointer;
        color: var(--color-text-primary);
        transition: all 0.2s;
      }
      .back-btn:hover {
        background: var(--color-background);
      }
      .avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--color-primary);
        color: var(--color-text-on-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 16px;
        flex-shrink: 0;
      }
      .status-badge {
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .status-badge.active {
        background: var(--color-success-light);
        color: var(--color-success);
      }
      .status-badge.inactive {
        background: var(--color-error-light);
        color: var(--color-error);
      }
      .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }
      .info-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .info-label {
        font-size: 12px;
        color: var(--color-text-muted);
      }
      .info-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .balance-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
      }
      .balance-card {
        background: var(--color-background);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .balance-label {
        font-size: 12px;
        color: var(--color-text-muted);
      }
      .balance-value {
        font-size: 20px;
        font-weight: 700;
      }
      .topup-form {
        background: var(--color-background);
        border-radius: 8px;
        padding: 16px;
        border: 1px solid var(--color-border);
      }
      .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .form-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .form-group.full-width {
        grid-column: 1 / -1;
      }
      .form-group label {
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-muted);
      }
      .form-input {
        padding: 8px 12px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-size: 14px;
        background: var(--color-surface);
        color: var(--color-text-primary);
        transition: border-color 0.2s;
      }
      .form-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }
      .btn-primary {
        background: var(--color-primary);
        color: var(--color-text-on-primary);
        border: none;
        border-radius: 6px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.2s;
      }
      .btn-primary:hover:not(:disabled) {
        opacity: 0.9;
      }
      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-secondary {
        background: var(--color-background);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-weight: 500;
        cursor: pointer;
      }
      .btn-sm {
        padding: 6px 14px;
        font-size: 13px;
      }
      .transaction-list {
        display: flex;
        flex-direction: column;
      }
      .transaction-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid var(--color-border);
      }
      .transaction-item:last-child {
        border-bottom: none;
      }
      .tx-icon {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 700;
        flex-shrink: 0;
      }
      .tx-icon.credit {
        background: var(--color-success-light);
        color: var(--color-success);
      }
      .tx-icon.debit {
        background: var(--color-error-light);
        color: var(--color-error);
      }
      .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 640px) {
        .form-grid {
          grid-template-columns: 1fr;
        }
        .form-group.full-width {
          grid-column: auto;
        }
        .balance-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
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
      error: () => {
        this.loadingCustomer = false;
      },
    });
  }

  loadWallet(): void {
    if (!this.customerId) return;
    this.loadingWallet = true;
    this.http.get<any>(`${this.walletApiUrl}/${this.customerId}`).subscribe({
      next: (res) => {
        const data = res.data || res;
        this.wallet = data?.id ? data : null;
        this.loadingWallet = false;
      },
      error: () => {
        this.wallet = null;
        this.loadingWallet = false;
      },
    });
  }

  loadWalletHistory(): void {
    if (!this.customerId) return;
    this.http
      .get<any>(`${this.walletApiUrl}/${this.customerId}/history?page=1&limit=20`)
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
    this.http
      .post<any>(`${this.walletApiUrl}/${this.customerId}/topup`, this.topUpForm.value)
      .subscribe({
        next: () => {
          this.topUpLoading = false;
          this.showTopUpForm = false;
          this.topUpForm.reset({ payment_method: 'cash' });
          this.loadWallet();
          this.loadWalletHistory();
        },
        error: () => {
          this.topUpLoading = false;
        },
      });
  }

  createAndLoadWallet(): void {
    this.loadWallet();
  }

  getAvailable(): number {
    if (!this.wallet) return 0;
    return Number(this.wallet.balance || 0) - Number(this.wallet.held_balance || 0);
  }

  getInitials(): string {
    if (!this.customer) return '?';
    const f = this.customer.first_name?.[0] || '';
    const l = this.customer.last_name?.[0] || '';
    return (f + l).toUpperCase();
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
