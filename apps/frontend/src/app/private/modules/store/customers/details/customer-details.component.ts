import { Component, signal, computed, inject, DestroyRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import { CustomersService } from '../services/customers.service';
import { MetadataFieldsService } from '../../data-collection/services/metadata-fields.service';
import { CustomerHistoryService, ConsultationHistoryEntry } from '../services/customer-history.service';
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
    FormsModule,
    ReactiveFormsModule,
    DatePipe,
    CurrencyPipe,
    CardComponent,
    ButtonComponent,
    SpinnerComponent,
    IconComponent,
    EmptyStateComponent,
    InputComponent,
    SelectorComponent,
    PaginationComponent,
    StickyHeaderComponent
],
  template: `
    <div class="w-full">
      <!-- Sticky Header -->
      <app-sticky-header
        title="Detalle del Cliente"
        [subtitle]="customer() ? (customer().first_name + ' ' + customer().last_name) : 'Cargando...'"
        icon="user"
        [showBackButton]="true"
        backRoute="/admin/customers/all"
        [badgeText]="customer()?.state === 'active' ? 'Activo' : customer()?.state === 'inactive' ? 'Inactivo' : ''"
        [badgeColor]="customer()?.state === 'active' ? 'green' : 'red'"
      ></app-sticky-header>
    
      <!-- Content -->
      <div class="flex flex-col gap-4 md:gap-6">
        <!-- Loading -->
        @if (loadingCustomer()) {
          <div class="flex justify-center py-12">
            <app-spinner></app-spinner>
          </div>
        }
    
        <!-- Error -->
        @if (errorMessage() && !loadingCustomer()) {
          <div
            class="p-4 rounded-lg"
            style="background: var(--color-error-light); color: var(--color-error)"
            >
            {{ errorMessage() }}
          </div>
        }
    
        <!-- Customer Info Card -->
        @if (customer() && !loadingCustomer()) {
          <app-card>
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
                    {{ customer().first_name }} {{ customer().last_name }}
                  </h2>
                  <div class="flex items-center gap-2 mt-1">
                    <app-icon name="mail" [size]="14" style="color: var(--color-text-muted)"></app-icon>
                    <span class="text-sm" style="color: var(--color-text-muted)">{{ customer().email }}</span>
                  </div>
                  @if (customer().phone) {
                    <div class="flex items-center gap-2 mt-0.5">
                      <app-icon name="phone" [size]="14" style="color: var(--color-text-muted)"></app-icon>
                      <span class="text-sm" style="color: var(--color-text-muted)">{{ customer().phone }}</span>
                    </div>
                  }
                </div>
              </div>
            </div>
            <div
              class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4"
              style="border-top: 1px solid var(--color-border)"
              >
              @if (customer().document_number) {
                <div class="flex flex-col gap-1">
                  <span class="text-xs" style="color: var(--color-text-muted)">Documento</span>
                  <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                    {{ customer().document_type || 'CC' }} {{ customer().document_number }}
                  </span>
                </div>
              }
              <div class="flex flex-col gap-1">
                <span class="text-xs" style="color: var(--color-text-muted)">Cliente desde</span>
                <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                  {{ customer().created_at | date:'mediumDate' }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs" style="color: var(--color-text-muted)">Última compra</span>
                <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                  {{ customer().last_order_date ? (customer().last_order_date | date:'mediumDate') : 'Sin compras' }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs" style="color: var(--color-text-muted)">Órdenes</span>
                <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                  {{ customer().total_orders || 0 }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs" style="color: var(--color-text-muted)">Gasto total</span>
                <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
                  {{ customer().total_spend | currency }}
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
        }
    
        <!-- Customer Metadata Card -->
        @if (customerMetadata().length > 0) {
          <div class="card p-4 mb-4" style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 0.75rem">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-bold text-base flex items-center gap-2" style="color: var(--color-text)">
                <app-icon name="file-text" [size]="18"></app-icon>
                Ficha del Cliente
              </h3>
            </div>
    
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              @for (field of summaryFields(); track field.id) {
                <div class="flex flex-col">
                  <span class="text-xs font-medium" style="color: var(--color-text-muted)">{{ field.field?.label }}</span>
                  <span class="text-sm font-medium" style="color: var(--color-text)">
                    {{ field.value_text || field.value_number || field.value_bool || field.value_date || '-' }}
                  </span>
                </div>
              }
            </div>
    
            @if (detailFields().length > 0) {
              <button class="text-xs" style="color: var(--color-primary)" (click)="showAllMetadata.set(!showAllMetadata())">
                {{ showAllMetadata() ? 'Ver menos' : 'Ver todos los datos (' + detailFields().length + ')' }}
              </button>
              @if (showAllMetadata()) {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  @for (field of detailFields(); track field.id) {
                    <div class="flex flex-col">
                      <span class="text-xs" style="color: var(--color-text-muted)">{{ field.field?.label }}</span>
                      <span class="text-sm" style="color: var(--color-text)">
                        {{ field.value_text || field.value_number || field.value_bool || field.value_date || '-' }}
                      </span>
                    </div>
                  }
                </div>
              }
            }
          </div>
        }
    
        <!-- Consultation History -->
        @if (bookingHistory().length > 0) {
          <div class="card p-4" style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 0.75rem">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-base flex items-center gap-2" style="color: var(--color-text)">
                <app-icon name="clipboard-list" [size]="18"></app-icon>
                Historia de Consultas
              </h3>
            </div>
    
            @for (entry of bookingHistory(); track entry.id) {
              <div class="flex gap-3 py-3" style="border-bottom: 1px solid var(--color-border)">
                <div class="flex flex-col items-center flex-shrink-0">
                  <div class="w-3 h-3 rounded-full"
                    [style.background]="entry.status === 'completed' ? '#22c55e' : entry.status === 'confirmed' ? '#3b82f6' : entry.status === 'cancelled' ? '#ef4444' : '#9ca3af'">
                  </div>
                  <div class="w-px flex-1 mt-1" style="background: var(--color-border)"></div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold truncate" style="color: var(--color-text)">{{ entry.product?.name }}</span>
                    <span class="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      [style.background]="entry.status === 'completed' ? '#dcfce7' : entry.status === 'confirmed' ? '#dbeafe' : '#fee2e2'"
                      [style.color]="entry.status === 'completed' ? '#166534' : entry.status === 'confirmed' ? '#1e40af' : '#991b1b'">
                      {{ entry.status }}
                    </span>
                  </div>
                  <div class="text-xs mt-1" style="color: var(--color-text-muted)">
                    {{ entry.date | date:'mediumDate' }} · {{ entry.start_time }}
                    @if (entry.provider) { · {{ entry.provider.display_name }} }
                    </div>
                    <div class="flex gap-2 mt-1.5 flex-wrap">
                      @if (entry.has_intake_data) {
                        <span class="text-xs flex items-center gap-1" style="color: #3b82f6">
                          <app-icon name="file-text" [size]="12"></app-icon> Formulario
                        </span>
                      }
                      @if (entry.has_prediagnosis) {
                        <span class="text-xs flex items-center gap-1" style="color: #7c3aed">
                          <app-icon name="brain" [size]="12"></app-icon> Prediagnóstico
                        </span>
                      }
                      @if (entry.notes_count > 0) {
                        <span class="text-xs flex items-center gap-1" style="color: #22c55e">
                          <app-icon name="clipboard-check" [size]="12"></app-icon> {{ entry.notes_count }} notas
                        </span>
                      }
                    </div>
                  </div>
                </div>
              }
            </div>
          }
    
          <!-- Wallet Card -->
          @if (customer() && !loadingCustomer()) {
            <app-card>
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
                @if (wallet()) {
                  <div class="flex items-center gap-2">
                    <app-button
                      variant="outline"
                      size="sm"
                      (clicked)="showAdjustForm.set(!showAdjustForm()); showTopUpForm.set(false)"
                      >
                      {{ showAdjustForm() ? 'Cancelar' : 'Ajustar' }}
                    </app-button>
                    <app-button
                      variant="primary"
                      size="sm"
                      (clicked)="showTopUpForm.set(!showTopUpForm()); showAdjustForm.set(false)"
                      >
                      {{ showTopUpForm() ? 'Cancelar' : 'Recargar' }}
                    </app-button>
                  </div>
                }
              </div>
              <!-- Wallet Loading -->
              @if (loadingWallet()) {
                <div class="flex justify-center py-6">
                  <app-spinner></app-spinner>
                </div>
              }
              <!-- Wallet Error -->
              @if (walletError() && !loadingWallet()) {
                <div
                  class="p-3 rounded-lg mb-4"
              style="
                background: var(--color-error-light);
                color: var(--color-error);
              "
                  >
                  {{ walletError() }}
                </div>
              }
              <!-- Wallet Balance -->
              @if (wallet() && !loadingWallet()) {
                <div>
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
                              >{{ wallet().held_balance | currency }}</span
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
                                  >{{ wallet().balance | currency }}</span
                                  >
                                </div>
                              </div>
                              <!-- Top Up Form -->
                              @if (showTopUpForm()) {
                                <div
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
                                    @if (topUpError()) {
                                      <div
                                        class="mt-2 p-2 rounded text-sm"
                    style="
                      background: var(--color-error-light);
                      color: var(--color-error);
                    "
                                        >
                                        {{ topUpError() }}
                                      </div>
                                    }
                                    <div class="flex gap-2 justify-end mt-3">
                                      <app-button
                                        variant="ghost"
                                        size="sm"
                                        (clicked)="showTopUpForm.set(false)"
                                        >Cancelar</app-button
                                        >
                                        <app-button
                                          variant="primary"
                                          size="sm"
                                          [loading]="topUpLoading()"
                                          [disabled]="!topUpForm.valid"
                                          (clicked)="topUpWallet()"
                                          >Recargar</app-button
                                          >
                                        </div>
                                      </form>
                                    </div>
                                  }
                                  <!-- Adjust Form -->
                                  @if (showAdjustForm()) {
                                    <div
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
                                        @if (adjustError()) {
                                          <div
                                            class="mt-2 p-2 rounded text-sm"
                                            style="background: var(--color-error-light); color: var(--color-error);"
                                            >
                                            {{ adjustError() }}
                                          </div>
                                        }
                                        <div class="flex gap-2 justify-end mt-3">
                                          <app-button variant="ghost" size="sm" (clicked)="showAdjustForm.set(false)">
                                            Cancelar
                                          </app-button>
                                          <app-button
                                            [variant]="adjustForm.get('type')?.value === 'debit' ? 'danger' : 'primary'"
                                            size="sm"
                                            [loading]="adjustLoading()"
                                            [disabled]="!adjustForm.valid"
                                            (clicked)="adjustWallet()"
                                            >
                                            {{ adjustForm.get('type')?.value === 'debit' ? 'Debitar' : 'Acreditar' }}
                                          </app-button>
                                        </div>
                                      </form>
                                    </div>
                                  }
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
                                        @if (hasActiveFilters) {
                                          <app-button
                                            variant="ghost"
                                            size="sm"
                                            (clicked)="clearHistoryFilters()"
                                            >
                                            Limpiar
                                          </app-button>
                                        }
                                        <app-button
                                          variant="ghost"
                                          size="sm"
                                          (clicked)="showHistoryFilters.set(!showHistoryFilters())"
                                          >
                                          <app-icon name="filter" [size]="14"></app-icon>
                                          Filtros
                                        </app-button>
                                      </div>
                                    </div>
                                    <!-- Filter row (collapsible) -->
                                    @if (showHistoryFilters()) {
                                      <div
                                        class="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 rounded-lg mb-3"
                                        style="background: var(--color-background); border: 1px solid var(--color-border);"
                                        >
                                        <app-selector
                                          label="Tipo"
                                          [options]="historyTypeOptions"
                                          [ngModel]="historyFilterType()"
                                          (ngModelChange)="historyFilterType.set($event); onHistoryFilterChange()"
                                          placeholder="Todos"
                                        ></app-selector>
                                        <app-input
                                          label="Desde"
                                          type="date"
                                          [ngModel]="historyDateFrom()"
                                          (ngModelChange)="historyDateFrom.set($event); onHistoryFilterChange()"
                                        ></app-input>
                                        <app-input
                                          label="Hasta"
                                          type="date"
                                          [ngModel]="historyDateTo()"
                                          (ngModelChange)="historyDateTo.set($event); onHistoryFilterChange()"
                                        ></app-input>
                                      </div>
                                    }
                                    <!-- Loading -->
                                    @if (loadingHistory()) {
                                      <div class="flex justify-center py-4">
                                        <app-spinner></app-spinner>
                                      </div>
                                    }
                                    <!-- Content -->
                                    @if (!loadingHistory()) {
                                      @if (walletHistory().length === 0) {
                                        <app-empty-state
                                          icon="inbox"
                                          message="No hay movimientos aún"
                                        ></app-empty-state>
                                      }
                                      @if (walletHistory().length > 0) {
                                        <div
                                          class="flex flex-col"
                                          >
                                          @for (tx of walletHistory(); track tx) {
                                            <div
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
                                          }
                                        </div>
                                      }
                                      <!-- Pagination -->
                                      @if (historyTotalPages() > 1) {
                                        <div class="mt-4 flex justify-center">
                                          <app-pagination
                                            [currentPage]="historyPage()"
                                            [totalPages]="historyTotalPages()"
                                            [total]="historyTotal()"
                                            [limit]="historyLimit()"
                                            infoStyle="page"
                                            (pageChange)="onHistoryPageChange($event)"
                                          ></app-pagination>
                                        </div>
                                      }
                                    }
                                  </div>
                                </div>
                              }
                              <!-- No Wallet -->
                              @if (!wallet() && !loadingWallet() && !walletError()) {
                                <div
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
                                }
                              </app-card>
                            }
                          </div>
                        </div>
    `,
})
export class CustomerDetailsComponent {
  private destroyRef = inject(DestroyRef);
  private metadataService = inject(MetadataFieldsService);
  private historyService = inject(CustomerHistoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private customersService = inject(CustomersService);

  // Metadata & History signals
  customerMetadata = signal<any[]>([]);
  showAllMetadata = signal(false);
  bookingHistory = signal<ConsultationHistoryEntry[]>([]);
  historyLoading = signal(false);
  showConsolidatedSummary = signal(false);

  summaryFields = computed(() => this.customerMetadata().filter((f: any) => f.field?.display_mode === 'summary'));
  detailFields = computed(() => this.customerMetadata().filter((f: any) => f.field?.display_mode === 'detail'));

  customerId = signal<number | null>(null);
  customer = signal<any>(null);
  wallet = signal<any>(null);
  walletHistory = signal<any[]>([]);
  loadingCustomer = signal(true);
  loadingWallet = signal(true);
  showTopUpForm = signal(false);
  topUpLoading = signal(false);
  topUpForm: FormGroup;
  errorMessage = signal<string | null>(null);
  walletError = signal<string | null>(null);
  topUpError = signal<string | null>(null);

  paymentMethodOptions = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'bank_transfer', label: 'Transferencia' },
  ];

  // Adjust wallet
  showAdjustForm = signal(false);
  adjustLoading = signal(false);
  adjustError = signal<string | null>(null);
  adjustForm: FormGroup;
  adjustTypeOptions = [
    { value: 'credit', label: 'Crédito (abonar)' },
    { value: 'debit', label: 'Débito (descontar)' },
  ];

  // Filtros de historial
  historyFilterType = signal('');
  historyDateFrom = signal('');
  historyDateTo = signal('');
  showHistoryFilters = signal(false);
  historyTypeOptions = [
    { value: '', label: 'Todos' },
    { value: 'credit', label: 'Créditos' },
    { value: 'debit', label: 'Débitos' },
    { value: 'hold', label: 'Retenciones' },
    { value: 'release', label: 'Liberaciones' },
  ];

  // Paginación de historial
  historyPage = signal(1);
  historyLimit = signal(20);
  historyTotal = signal(0);
  historyTotalPages = signal(0);
  loadingHistory = signal(false);

  private walletApiUrl = `${environment.apiUrl}/store/wallets`;

  constructor() {
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

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('id');
        if (id) {
          this.customerId.set(parseInt(id, 10));
          this.loadCustomer();
          this.loadWallet();
          this.loadWalletHistory();
          this.loadCustomerMetadata(this.customerId()!);
          this.loadBookingHistory(this.customerId()!);
        }
      });
  }

  loadCustomer(): void {
    if (!this.customerId()) return;
    this.loadingCustomer.set(true);
    this.customersService.getCustomer(this.customerId()!)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (customer) => {
          this.customer.set(customer);
          this.loadingCustomer.set(false);
        },
        error: (err) => {
          this.loadingCustomer.set(false);
          this.errorMessage.set(extractApiErrorMessage(err));
        },
      });
  }

  loadWallet(): void {
    if (!this.customerId()) return;
    this.loadingWallet.set(true);
    this.http.get<any>(`${this.walletApiUrl}/${this.customerId()}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res.data || res;
          this.wallet.set(data?.id || data?.wallet_id ? data : null);
          this.loadingWallet.set(false);
        },
        error: (err) => {
          this.wallet.set(null);
          this.loadingWallet.set(false);
          this.walletError.set(extractApiErrorMessage(err));
        },
      });
  }

  loadWalletHistory(): void {
    if (!this.customerId()) return;
    this.loadingHistory.set(true);

    let url = `${this.walletApiUrl}/${this.customerId()}/history?page=${this.historyPage()}&limit=${this.historyLimit()}`;
    if (this.historyFilterType()) url += `&type=${this.historyFilterType()}`;
    if (this.historyDateFrom()) url += `&date_from=${this.historyDateFrom()}`;
    if (this.historyDateTo()) url += `&date_to=${this.historyDateTo()}`;

    this.http.get<any>(url)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const payload = res.data || res;
          this.walletHistory.set(Array.isArray(payload) ? payload : payload?.data || []);
          const meta = payload?.meta;
          if (meta) {
            this.historyTotal.set(meta.total || 0);
            this.historyTotalPages.set(meta.total_pages || 0);
            this.historyPage.set(meta.page || 1);
          }
          this.loadingHistory.set(false);
        },
        error: () => {
          this.walletHistory.set([]);
          this.loadingHistory.set(false);
        },
      });
  }

  topUpWallet(): void {
    if (!this.topUpForm.valid || !this.customerId()) return;
    this.topUpLoading.set(true);
    this.topUpError.set(null);
    this.http
      .post<any>(
        `${this.walletApiUrl}/${this.customerId()}/topup`,
        this.topUpForm.value,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.topUpLoading.set(false);
          this.showTopUpForm.set(false);
          this.topUpForm.reset({ payment_method: 'cash' });
          this.loadWallet();
          this.historyPage.set(1);
          this.loadWalletHistory();
        },
        error: (err) => {
          this.topUpLoading.set(false);
          this.topUpError.set(extractApiErrorMessage(err));
        },
      });
  }

  createAndLoadWallet(): void {
    this.loadWallet();
  }

  getAvailable(): number {
    if (!this.wallet()) return 0;
    return (
      Number(this.wallet().balance || 0) -
      Number(this.wallet().held_balance || 0)
    );
  }

  getInitials(): string {
    if (!this.customer()) return '?';
    const f = this.customer().first_name?.[0] || '';
    const l = this.customer().last_name?.[0] || '';
    return (f + l).toUpperCase();
  }

  getAverageTicket(): number {
    if (!this.customer()?.total_orders || !this.customer()?.total_spend) return 0;
    return Number(this.customer().total_spend) / Number(this.customer().total_orders);
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
    if (!this.adjustForm.valid || !this.customerId()) return;
    this.adjustLoading.set(true);
    this.adjustError.set(null);

    this.http
      .post<any>(
        `${this.walletApiUrl}/${this.customerId()}/adjust`,
        this.adjustForm.value,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.adjustLoading.set(false);
          this.showAdjustForm.set(false);
          this.adjustForm.reset({ type: 'credit' });
          this.loadWallet();
          this.historyPage.set(1);
          this.loadWalletHistory();
        },
        error: (err) => {
          this.adjustLoading.set(false);
          this.adjustError.set(extractApiErrorMessage(err));
        },
      });
  }

  onHistoryFilterChange(): void {
    this.historyPage.set(1);
    this.loadWalletHistory();
  }

  clearHistoryFilters(): void {
    this.historyFilterType.set('');
    this.historyDateFrom.set('');
    this.historyDateTo.set('');
    this.historyPage.set(1);
    this.loadWalletHistory();
  }

  onHistoryPageChange(page: number): void {
    this.historyPage.set(page);
    this.loadWalletHistory();
  }

  get hasActiveFilters(): boolean {
    return !!this.historyFilterType() || !!this.historyDateFrom() || !!this.historyDateTo();
  }

  private loadCustomerMetadata(customerId: number) {
    this.metadataService.getValues('customer', customerId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (values) => this.customerMetadata.set(values),
        error: () => this.customerMetadata.set([]),
      });
  }

  private loadBookingHistory(customerId: number) {
    this.historyLoading.set(true);
    this.historyService.getTimeline(customerId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.bookingHistory.set(result.data);
          this.historyLoading.set(false);
        },
        error: () => {
          this.bookingHistory.set([]);
          this.historyLoading.set(false);
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/admin/customers/all']);
  }
}
