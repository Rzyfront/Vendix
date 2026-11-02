import { Component, signal, computed, inject, DestroyRef } from '@angular/core';
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
import { CurrencyPipe } from '../../../../../../app/shared/pipes/currency';
import { translateCustomerError } from '../utils/customer-error.translator';
import { getDocumentTypeLabel } from '../../../../../shared/constants/document-types';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import {
  CardComponent,
  ButtonComponent,
  SpinnerComponent,
  IconComponent,
  EmptyStateComponent,
  InputComponent,
  SelectorComponent,
  PaginationComponent,
  ScrollableTabsComponent,
  BadgeComponent,
} from '../../../../../../app/shared/components';
import type { BadgeVariant, ScrollableTab } from '../../../../../../app/shared/components';
import {
  CustomerSectionComponent,
  CustomerSectionEmptyComponent,
} from '../components/customer-section/customer-section.component';
import { CustomerCrmPanelComponent } from '../crm/profile/customer-crm-panel.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../app/shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-customer-details',
  standalone: true,
  imports: [
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
    ScrollableTabsComponent,
    CustomerCrmPanelComponent,
    CustomerSectionComponent,
    CustomerSectionEmptyComponent,
    BadgeComponent,
],
  template: `
    <div class="w-full">
      <!-- Sticky Header -->
      <app-sticky-header
        title="Detalle del Cliente"
        [subtitle]="customer() ? getDisplayName() : 'Cargando...'"
        icon="user"
        [showBackButton]="true"
        backRoute="/admin/customers/all"
        [badgeText]="customer()?.state === 'active' ? 'Activo' : customer()?.state === 'inactive' ? 'Inactivo' : ''"
        [badgeColor]="customer()?.state === 'active' ? 'green' : 'red'"
        [actions]="gymProfileActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>
    
      @if (showCrmTab()) {
        <div class="mb-4">
          <app-scrollable-tabs
            [tabs]="profileTabs"
            [activeTab]="activeTab()"
            size="sm"
            ariaLabel="Secciones de la ficha del cliente"
            (tabChange)="selectTab($event)"
          ></app-scrollable-tabs>
        </div>
      }

      @if (activeTab() === 'crm' && customerId()) {
        <app-customer-crm-panel [customerId]="customerId()!"></app-customer-crm-panel>
      }

      <!-- Content -->
      <div class="flex flex-col gap-4 md:gap-6" [class.hidden]="activeTab() !== 'info'">
        <!-- Loading -->
        @if (loadingCustomer()) {
          <div class="flex justify-center py-12">
            <app-spinner></app-spinner>
          </div>
        }
    
        <!-- Error -->
        @if (errorMessage() && !loadingCustomer()) {
          <div
            class="p-4 rounded-xl border border-error/25 bg-error/10 text-error"
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
                  class="w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0 bg-primary/10 text-primary-on-tint"
                  >
                  {{ getInitials() }}
                </div>
                <div>
                  <h2 class="text-xl font-bold text-text-primary">
                    {{ getDisplayName() }}
                  </h2>
                  @if (customer().person_type === 'JURIDICA') {
                    <p class="text-xs uppercase tracking-wider mt-0.5 text-text-secondary">
                      Persona jurídica
                    </p>
                  } @else {
                    <p class="text-xs uppercase tracking-wider mt-0.5 text-text-secondary">
                      Persona natural
                    </p>
                  }
                  <div class="flex items-center gap-2 mt-1">
                    <app-icon name="mail" [size]="14" class="text-text-secondary"></app-icon>
                    <span class="text-sm text-text-secondary">{{ customer().email }}</span>
                  </div>
                  @if (customer().phone) {
                    <div class="flex items-center gap-2 mt-0.5">
                      <app-icon name="phone" [size]="14" class="text-text-secondary"></app-icon>
                      <span class="text-sm text-text-secondary">{{ customer().phone }}</span>
                    </div>
                  }
                </div>
              </div>
            </div>
            <div
              class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4 border-t border-border"
              >
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary">Documento</span>
                <span class="text-sm font-semibold text-text-primary">
                  @if (customer().document_number) {
                    {{ getDocumentLabel(customer().document_type) }} {{ customer().document_number }}
                    @if (customer().verification_digit) {
                      <span class="text-xs ml-1 text-text-secondary">DV {{ customer().verification_digit }}</span>
                    }
                  } @else {
                    Sin documento
                  }
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary">Cliente desde</span>
                <span class="text-sm font-semibold text-text-primary">
                  {{ formatDate(customer().created_at) }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary">Última compra</span>
                <span class="text-sm font-semibold text-text-primary">
                  {{ customer().last_order_date ? formatDate(customer().last_order_date) : 'Sin compras' }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary">Pedidos</span>
                <span class="text-sm font-semibold text-text-primary">
                  {{ customer().total_orders || 0 }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary">Gasto total</span>
                <span class="text-sm font-semibold text-text-primary">
                  {{ customer().total_spend | currency }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary">Ticket promedio</span>
                <span class="text-sm font-semibold text-text-primary">
                  {{ getAverageTicket() | currency }}
                </span>
              </div>
            </div>
          </app-card>

          <!-- Fiscal / DIAN Card -->
          @if (hasFiscalData()) {
            <app-customer-section title="Datos fiscales y tributarios" icon="file-text">
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-text-secondary">Régimen tributario</span>
                  <span class="text-sm font-semibold text-text-primary">
                    {{ getTaxRegimeLabel() }}
                  </span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-text-secondary">Código CIIU</span>
                  <span class="text-sm font-semibold text-text-primary">
                    {{ customer().ciiu_code || '—' }}
                  </span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-text-secondary">¿Agente retenedor?</span>
                  <span class="text-sm font-semibold text-text-primary">
                    {{ customer().is_withholding_agent ? 'Sí' : 'No' }}
                  </span>
                </div>
              </div>
              @if (customer().fiscal_responsibilities && customer().fiscal_responsibilities!.length > 0) {
                <div class="mt-4 border-t border-border pt-4">
                  <span class="mb-2 block text-xs text-text-secondary">
                    Responsabilidades tributarias
                  </span>
                  <div class="flex flex-wrap gap-2">
                    @for (code of customer().fiscal_responsibilities!; track code) {
                      <span
                        class="rounded-full border border-border bg-surface px-2 py-1 font-mono text-xs text-text-primary"
                        title="{{ getFiscalResponsibilityLabel(code) }}"
                      >
                        {{ code }}
                      </span>
                    }
                  </div>
                </div>
              }
            </app-customer-section>
          }

          <!-- Dirección Card -->
          @if (primaryAddress(); as addr) {
            <app-customer-section title="Dirección" icon="map-pin">
              <div class="space-y-1">
                <p class="text-sm text-text-primary">
                  {{ addr.address_line1 }}{{ addr.address_line2 ? ', ' + addr.address_line2 : '' }}
                </p>
                <p class="text-sm text-text-secondary">
                  {{ addr.city }}{{ addr.state_province ? ', ' + addr.state_province : '' }} · {{ addr.country_code }}
                  @if (addr.postal_code) {
                    · CP {{ addr.postal_code }}
                  }
                </p>
                @if (addr.phone_number) {
                  <p class="text-xs text-text-secondary">
                    Tel: {{ addr.phone_number }}
                  </p>
                }
              </div>
            </app-customer-section>
          }
        }
    
        <!-- Customer Metadata Card -->
        @if (customerMetadata().length > 0) {
          <app-customer-section title="Ficha del cliente" icon="clipboard-list">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              @for (field of summaryFields(); track field.id) {
                <div class="flex flex-col">
                  <span class="text-xs text-text-secondary">{{ field.field?.label }}</span>
                  <span class="text-sm font-semibold text-text-primary">
                    {{ field.value_text || field.value_number || field.value_bool || field.value_date || '-' }}
                  </span>
                </div>
              }
            </div>
    
            @if (detailFields().length > 0) {
              <button type="button" class="text-xs font-semibold text-primary hover:underline" (click)="showAllMetadata.set(!showAllMetadata())">
                {{ showAllMetadata() ? 'Ver menos' : 'Ver todos los datos (' + detailFields().length + ')' }}
              </button>
              @if (showAllMetadata()) {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  @for (field of detailFields(); track field.id) {
                    <div class="flex flex-col">
                      <span class="text-xs text-text-secondary">{{ field.field?.label }}</span>
                      <span class="text-sm text-text-primary">
                        {{ field.value_text || field.value_number || field.value_bool || field.value_date || '-' }}
                      </span>
                    </div>
                  }
                </div>
              }
            }
          </app-customer-section>
        }
    
        <!-- Hospitality (Hotelería) — placeholder until stays land -->
        @if (customer() && !loadingCustomer() && showHospitalitySection()) {
          <app-customer-section title="Hotelería" icon="bed-double">
            <app-customer-section-empty icon="bed-double" text="Aquí verás las estadías de este huésped."></app-customer-section-empty>
          </app-customer-section>
        }

        <!-- Consultation History (service industry) -->
        @if (showConsultationHistory() && bookingHistory().length > 0) {
          <app-customer-section title="Historia de consultas" icon="clipboard-list">
            @for (entry of bookingHistory(); track entry.id) {
              <div class="flex gap-3 border-b border-border py-3 last:border-b-0">
                <div class="flex flex-col items-center flex-shrink-0">
                  <div class="h-3 w-3 rounded-full"
                    [class]="bookingDotClass(entry.status)">
                  </div>
                  <div class="mt-1 w-px flex-1 bg-border"></div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="truncate text-sm font-semibold text-text-primary">{{ entry.product?.name }}</span>
                    <app-badge size="xs" [variant]="bookingBadgeVariant(entry.status)">
                      {{ getBookingStatusLabel(entry.status) }}
                    </app-badge>
                  </div>
                  <div class="mt-1 text-xs text-text-secondary">
                    {{ formatDate(entry.date) }} · {{ entry.start_time }}
                    @if (entry.provider) { · {{ entry.provider.display_name }} }
                    </div>
                    <div class="flex gap-2 mt-1.5 flex-wrap">
                      @if (entry.has_intake_data) {
                        <span class="flex items-center gap-1 text-xs text-text-secondary">
                          <app-icon name="file-text" [size]="12"></app-icon> Formulario
                        </span>
                      }
                      @if (entry.has_prediagnosis) {
                        <span class="flex items-center gap-1 text-xs text-text-secondary">
                          <app-icon name="brain" [size]="12"></app-icon> Prediagnóstico
                        </span>
                      }
                      @if (entry.notes_count > 0) {
                        <span class="flex items-center gap-1 text-xs text-text-secondary">
                          <app-icon name="clipboard-check" [size]="12"></app-icon> {{ entry.notes_count }} notas
                        </span>
                      }
                    </div>
                  </div>
                </div>
              }
            </app-customer-section>
          }
    
          <!-- Wallet Card -->
          @if (customer() && !loadingCustomer()) {
            <app-customer-section title="Billetera" icon="wallet">
                @if (wallet()) {
                  <div slot="actions" class="flex items-center gap-2">
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
              <!-- Wallet Loading -->
              @if (loadingWallet()) {
                <div class="flex justify-center py-6">
                  <app-spinner></app-spinner>
                </div>
              }
              <!-- Wallet Error -->
              @if (walletError() && !loadingWallet()) {
                <div
                  class="p-3 rounded-xl mb-4 border border-error/25 bg-error/10 text-error"
                  >
                  {{ walletError() }}
                </div>
              }
              <!-- Wallet Balance -->
              @if (wallet() && !loadingWallet()) {
                <div>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div
                      class="p-3 rounded-xl bg-background"
                      >
                      <span
                        class="text-xs block text-text-secondary"
                        >Saldo disponible</span
                        >
                        <span
                          class="text-xl font-bold text-success"
                          >{{ getAvailable() | currency }}</span
                          >
                        </div>
                        <div
                          class="p-3 rounded-xl bg-background"
                          >
                          <span
                            class="text-xs block text-text-secondary"
                            >Saldo retenido</span
                            >
                            <span
                              class="text-xl font-bold text-text-secondary"
                              >{{ wallet().held_balance | currency }}</span
                              >
                            </div>
                            <div
                              class="p-3 rounded-xl bg-background"
                              >
                              <span
                                class="text-xs block text-text-secondary"
                                >Saldo total</span
                                >
                                <span
                                  class="text-xl font-bold text-text-primary"
                                  >{{ wallet().balance | currency }}</span
                                  >
                                </div>
                              </div>
                              <!-- Top Up Form -->
                              @if (showTopUpForm()) {
                                <div
                                  class="p-4 rounded-xl mb-4 bg-background border border-border"
                                  >
                                  <h4
                                    class="font-semibold mb-3 text-text-primary"
                                    >
                                    Recargar saldo
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
                                        class="mt-2 p-2 rounded-xl text-sm border border-error/25 bg-error/10 text-error"
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
                                      class="p-4 rounded-xl mb-4 bg-background border border-border"
                                      >
                                      <h4 class="font-semibold mb-3 text-text-primary">
                                        Ajustar saldo
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
                                            class="mt-2 p-2 rounded-xl text-sm border border-error/25 bg-error/10 text-error"
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
                                        class="font-semibold text-text-primary"
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
                                          <app-icon slot="icon" name="filter" [size]="14"></app-icon>
                                          Filtros
                                        </app-button>
                                      </div>
                                    </div>
                                    <!-- Filter row (collapsible) -->
                                    @if (showHistoryFilters()) {
                                      <div
                                        class="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 rounded-xl mb-3 bg-background border border-border"
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
                                          message="Sin movimientos en la billetera"
                                        ></app-empty-state>
                                      }
                                      @if (walletHistory().length > 0) {
                                        <div
                                          class="flex flex-col"
                                          >
                                          @for (tx of walletHistory(); track tx) {
                                            <div
                                              class="flex justify-between items-center border-b border-border py-3 last:border-b-0"
                                              
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
                                                    class="text-sm font-medium text-text-primary"
                                                    >
                                                    {{ getTransactionLabel(tx.type) }}
                                                  </p>
                                                  <p
                                                    class="text-xs text-text-secondary"
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
                                                  class="text-xs text-text-secondary"
                                                  >
                                                  {{ formatDateTime(tx.created_at) }}
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
                                    message="Este cliente aún no tiene billetera."
                                  ></app-empty-state>
                                  <app-button
                                    variant="primary"
                                    size="sm"
                                    class="mt-3"
                                    (clicked)="createAndLoadWallet()"
                                    >Crear billetera</app-button
                                    >
                                  </div>
                                }
                              </app-customer-section>
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
  private authFacade = inject(AuthFacade);

  // Industry sections: the profile only shows sections of the store's active
  // industries (settings → login → [] cascade in AuthFacade).
  showHospitalitySection = this.authFacade.isHospitality;
  showConsultationHistory = computed(() =>
    this.authFacade.storeIndustries().includes('service'),
  );

  // Metadata & History signals
  customerMetadata = signal<any[]>([]);
  showAllMetadata = signal(false);
  bookingHistory = signal<ConsultationHistoryEntry[]>([]);
  historyLoading = signal(false);
  showConsolidatedSummary = signal(false);

  summaryFields = computed(() => this.customerMetadata().filter((f: any) => f.field?.display_mode === 'summary'));
  detailFields = computed(() => this.customerMetadata().filter((f: any) => f.field?.display_mode === 'detail'));

  customerId = signal<number | null>(null);

  // CRM tab (PLAN-CRM §7, H2). `?tab=crm` opens it directly.
  readonly profileTabs: ScrollableTab[] = [
    { id: 'info', label: 'Información', icon: 'user' },
    { id: 'crm', label: 'CRM', icon: 'trending-up' },
  ];
  readonly activeTab = signal<'info' | 'crm'>('info');
  readonly showCrmTab = computed(
    () =>
      this.authFacade.isOwner() ||
      this.authFacade.hasPermission('store:customers:read'),
  );

  selectTab(tab: string): void {
    const next = tab === 'crm' ? 'crm' : 'info';
    this.activeTab.set(next);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: next === 'crm' ? 'crm' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
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

  // Deep-link to the member profile (Membership Suite). Only shown for
  // `gym`-industry stores; the destination page is also gated by the
  // store:memberships:read permission and the memberships panel_ui
  // visibility.
  gymProfileActions = computed<StickyHeaderActionButton[]>(() =>
    this.customerId() != null && this.authFacade.isGym()
      ? [
          {
            id: 'gym-profile',
            label: 'Perfil de socio (gimnasio)',
            icon: 'dumbbell',
            variant: 'outline',
          },
        ]
      : [],
  );

  onHeaderAction(actionId: string): void {
    if (actionId === 'gym-profile' && this.customerId() != null) {
      this.router.navigate([
        '/admin/memberships/members/profile',
        this.customerId(),
      ]);
    }
  }

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

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.activeTab.set(params.get('tab') === 'crm' ? 'crm' : 'info');
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
          this.errorMessage.set(
            translateCustomerError(err, 'No se pudo cargar el cliente'),
          );
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
          this.walletError.set(
            translateCustomerError(err, 'No se pudo cargar el saldo'),
          );
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
          this.topUpError.set(
            translateCustomerError(err, 'No se pudo recargar el saldo'),
          );
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
    const c = this.customer();
    // Persona jurídica: usar iniciales de la razón social.
    if (c.person_type === 'JURIDICA' && c.legal_name) {
      const parts = c.legal_name.trim().split(/\s+/);
      const first = parts[0]?.[0] || '';
      const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return (first + last).toUpperCase();
    }
    const f = c.first_name?.[0] || '';
    const l = c.last_name?.[0] || '';
    return (f + l).toUpperCase();
  }

  /** Nombre principal: legal_name si jurídica, sino first_name + last_name. */
  getDisplayName(): string {
    const c = this.customer();
    if (!c) return 'Cargando...';
    if (c.person_type === 'JURIDICA' && c.legal_name) {
      return c.legal_name;
    }
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    return name || 'Sin nombre';
  }

  /** True si el cliente tiene al menos un campo fiscal capturado. */
  hasFiscalData(): boolean {
    const c = this.customer();
    if (!c) return false;
    return !!(
      c.tax_regime ||
      c.ciiu_code ||
      c.is_withholding_agent ||
      (c.fiscal_responsibilities && c.fiscal_responsibilities.length > 0)
    );
  }

  /** Traduce el enum tax_regime a etiqueta legible. */
  getTaxRegimeLabel(): string {
    const r = this.customer()?.tax_regime;
    const labels: Record<string, string> = {
      COMUN: 'Régimen común',
      SIMPLIFICADO: 'Régimen simplificado',
      GRAN_CONTRIBUYENTE: 'Gran contribuyente',
      AUTORRETENEDOR: 'Autorretenedor',
      ESPECIAL: 'Régimen especial',
      NO_APLICA: 'No aplica',
    };
    return r ? labels[r] || r : '—';
  }

  /** Devuelve la dirección primaria (o la primera) del cliente. */
  primaryAddress(): any | null {
    const addrs = this.customer()?.addresses;
    if (!addrs || addrs.length === 0) return null;
    return addrs.find((a: any) => a.is_primary) ?? addrs[0];
  }

  /** Etiqueta legible de un código de responsabilidad fiscal. */
  getFiscalResponsibilityLabel(code: string): string {
    const labels: Record<string, string> = {
      'R-99-PN': 'No aplica - Persona natural consumidor',
      'O-13': 'Gran contribuyente',
      'O-14': 'Informante de precios de transferencia',
      'O-15': 'Autorretenedor',
      'O-16': 'Obligado a llevar libros',
      'O-17': 'Responsable de IVA (legacy)',
      'O-19': 'Responsable de INC',
      'O-22': 'No responsable de IVA (legacy)',
      'O-32': 'Responsable de ICUI (bebidas azucaradas)',
      'O-33': 'Responsable de INC (ultraprocesados)',
      'O-47': 'Régimen simple de tributación',
      'O-48': 'Responsable de IVA',
      'O-49': 'No responsable de IVA',
    };
    return labels[code] || code;
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

  bookingBadgeVariant(status: string): BadgeVariant {
    if (status === 'completed') return 'success';
    if (status === 'confirmed' || status === 'in_progress') return 'info';
    if (status === 'cancelled' || status === 'no_show') return 'error';
    return 'neutral';
  }

  bookingDotClass(status: string): string {
    const variant = this.bookingBadgeVariant(status);
    if (variant === 'success') return 'bg-success';
    if (variant === 'info') return 'bg-info';
    if (variant === 'error') return 'bg-error';
    return 'bg-muted';
  }

  getBookingStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No asistió',
      in_progress: 'En curso',
    };
    return labels[status] || status;
  }

  getDocumentLabel(code: string | null | undefined): string {
    return getDocumentTypeLabel(code);
  }

  formatDate(value: string | Date | null | undefined): string {
    if (!value) return '';
    try {
      return formatDateOnlyUTC(value);
    } catch {
      return String(value);
    }
  }

  formatDateTime(value: string | Date | null | undefined): string {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
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
          this.adjustError.set(
            translateCustomerError(err, 'No se pudo ajustar el saldo'),
          );
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
