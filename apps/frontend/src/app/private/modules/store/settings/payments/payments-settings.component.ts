import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { PaymentMethodsService } from './services/payment-methods.service';
import {
  PaymentMethodStats,
  StorePaymentMethod,
  SystemPaymentMethod,
} from './interfaces/payment-methods.interface';
import {
  ToastService,
  StatsComponent,
  DialogService,
  TableComponent,
  TableColumn,
  TableAction,
  ButtonComponent,
  ModalComponent,
  BadgeComponent,
  InputsearchComponent,
} from '../../../../shared/components/index';

interface CombinedPaymentMethod {
  id: string;
  display_name: string;
  type: string;
  provider: string;
  state: string;
  is_system: boolean;
  is_store_method: boolean;
  system_payment_method_id?: string;
  store_payment_method?: StorePaymentMethod;
  created_at?: string;
}

@Component({
  selector: 'app-payments-settings',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    TableComponent,
    ButtonComponent,
    ModalComponent,
    BadgeComponent,
    InputsearchComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Cards: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-6 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Métodos"
          [value]="payment_method_stats()?.total_methods || 0"
          iconName="credit-card"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="payment_method_stats()?.enabled_methods || 0"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Requieren Config"
          [value]="payment_method_stats()?.requires_config || 0"
          iconName="settings"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Transacciones"
          [value]="payment_method_stats()?.successful_transactions || 0"
          iconName="check"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Unified Payment Methods Table -->
      <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border overflow-hidden">
        <!-- Header with Add Button -->
        <div class="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <h2 class="text-lg font-semibold text-text-primary">Métodos de Pago</h2>
            <p class="text-sm text-text-secondary">
              {{ filteredMethods().length }} método(s) configurados
            </p>
          </div>
          <app-button
            variant="primary"
            size="sm"
            iconName="plus"
            (onClick)="openAddModal()"
          >
            Agregar Método
          </app-button>
        </div>

        <!-- Search -->
        <div class="px-4 py-2 border-b border-border bg-gray-50/50">
          <app-inputsearch
            class="w-full sm:w-72"
            size="sm"
            placeholder="Buscar métodos..."
            [debounceTime]="300"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearchChange($event)"
          ></app-inputsearch>
        </div>

        <!-- Loading State -->
        @if (isLoading()) {
          <div class="p-8 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary text-sm">Cargando métodos de pago...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!isLoading() && filteredMethods().length === 0) {
          <div class="p-8 text-center">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
              <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
              </svg>
            </div>
            @if (searchTerm()) {
              <p class="text-sm text-text-secondary">No se encontraron métodos con ese criterio</p>
            } @else {
              <p class="text-sm text-text-secondary">No hay métodos de pago configurados</p>
              <p class="text-xs text-gray-400 mt-1">Agrega tu primer método de pago</p>
            }
          </div>
        }

        <!-- Table -->
        @if (!isLoading() && filteredMethods().length > 0) {
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-50 border-b border-border">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Método
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Tipo
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Origen
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Estado
                  </th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (method of filteredMethods(); track method.id) {
                  <tr class="hover:bg-gray-50 transition-colors">
                    <!-- Method Name -->
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            @switch (method.type) {
                              @case ('cash') {
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
                              }
                              @case ('card') {
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
                              }
                              @case ('paypal') {
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path>
                              }
                              @case ('bank_transfer') {
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                              }
                              @default {
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
                              }
                            }
                          </svg>
                        </div>
                        <div>
                          <p class="font-medium text-text-primary">{{ method.display_name }}</p>
                          <p class="text-xs text-text-secondary">
                            @if (method.is_store_method) {
                              {{ method.store_payment_method?.system_payment_method?.provider || 'Personalizado' }}
                            } @else {
                              {{ method.provider }}
                            }
                          </p>
                        </div>
                      </div>
                    </td>

                    <!-- Type -->
                    <td class="px-4 py-3">
                      <span class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                        {{ getTypeLabel(method.type) }}
                      </span>
                    </td>

                    <!-- Origin (System vs Store) -->
                    <td class="px-4 py-3">
                      @if (method.is_store_method) {
                        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-purple-100 text-purple-700">
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                          </svg>
                          Tienda
                        </span>
                      } @else {
                        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
                          </svg>
                          Sistema
                        </span>
                      }
                    </td>

                    <!-- State -->
                    <td class="px-4 py-3">
                      @switch (method.state) {
                        @case ('enabled') {
                          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                            Activo
                          </span>
                        }
                        @case ('disabled') {
                          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            <span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                            Inactivo
                          </span>
                        }
                        @case ('requires_configuration') {
                          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            Requiere Config
                          </span>
                        }
                        @default {
                          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            {{ method.state }}
                          </span>
                        }
                      }
                    </td>

                    <!-- Actions -->
                    <td class="px-4 py-3 text-right">
                      <div class="flex items-center justify-end gap-1">
                        @if (method.is_store_method) {
                          @if (method.state === 'enabled') {
                            <button
                              (click)="toggleMethod(method)"
                              class="p-2 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                              title="Desactivar"
                            >
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                              </svg>
                            </button>
                          } @else {
                            <button
                              (click)="toggleMethod(method)"
                              class="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Activar"
                            >
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                              </svg>
                            </button>
                          }
                          <button
                            (click)="editMethod(method)"
                            class="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                            </svg>
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>

    <!-- Add Payment Method Modal -->
    <app-modal
      [isOpen]="showAddModal()"
      title="Agregar Método de Pago"
      size="lg"
      (closed)="closeAddModal()"
    >
      <div class="space-y-4">
        <p class="text-sm text-text-secondary">
          Selecciona los métodos de pago disponibles que deseas agregar a tu tienda.
        </p>

        <!-- Available Methods Search -->
        <app-inputsearch
          class="w-full"
          size="sm"
          placeholder="Buscar métodos disponibles..."
          [debounceTime]="300"
          [ngModel]="modalSearchTerm()"
          (ngModelChange)="onModalSearchChange($event)"
        ></app-inputsearch>

        <!-- Loading Available Methods -->
        @if (isLoadingAvailable()) {
          <div class="p-4 text-center">
            <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <p class="mt-2 text-sm text-text-secondary">Cargando métodos disponibles...</p>
          </div>
        }

        <!-- Available Methods List -->
        @if (!isLoadingAvailable() && filteredAvailableMethods().length > 0) {
          <div class="max-h-96 overflow-y-auto border border-border rounded-lg">
            <table class="w-full">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-4 py-2 text-left text-xs font-medium text-text-secondary uppercase">
                    Método
                  </th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-text-secondary uppercase">
                    Tipo
                  </th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-text-secondary uppercase">
                    Origen
                  </th>
                  <th class="px-4 py-2 text-right text-xs font-medium text-text-secondary uppercase">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (method of filteredAvailableMethods(); track method.id) {
                  <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                          <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                          </svg>
                        </div>
                        <div>
                          <p class="font-medium text-text-primary text-sm">{{ method.display_name }}</p>
                          <p class="text-xs text-text-secondary">{{ method.description }}</p>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <span class="text-xs text-text-secondary">{{ getTypeLabel(method.type) }}</span>
                    </td>
                    <td class="px-4 py-3">
                      @if (method.provider !== 'system') {
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          Organización
                        </span>
                      } @else {
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                          Sistema
                        </span>
                      }
                    </td>
                    <td class="px-4 py-3 text-right">
                      <app-button
                        variant="primary"
                        size="xs"
                        (onClick)="enableMethod(method)"
                        [loading]="enablingMethodId() === method.id"
                      >
                        Agregar
                      </app-button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- Empty Available -->
        @if (!isLoadingAvailable() && filteredAvailableMethods().length === 0) {
          <div class="p-6 text-center">
            <p class="text-sm text-text-secondary">
              @if (modalSearchTerm()) {
                No hay métodos disponibles con ese criterio
              } @else {
                No hay más métodos disponibles para agregar
              }
            </p>
          </div>
        }
      </div>

      <div class="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
        <app-button variant="ghost" (onClick)="closeAddModal()">
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .stats-container {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      @media (min-width: 768px) {
        .stats-container {
          grid-template-columns: repeat(4, 1fr);
        }
      }
    `,
  ],
})
export class PaymentsSettingsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Signals
  payment_methods = signal<StorePaymentMethod[]>([]);
  available_payment_methods = signal<SystemPaymentMethod[]>([]);
  payment_method_stats = signal<PaymentMethodStats | null>(null);
  store_payment_method_ids = signal<Set<string>>(new Set());

  isLoading = signal(false);
  isLoadingStats = signal(false);
  isLoadingAvailable = signal(false);
  isEnabling = signal(false);
  enablingMethodId = signal<string | null>(null);

  // UI State
  searchTerm = signal('');
  modalSearchTerm = signal('');
  showAddModal = signal(false);

  // Computed
  readonly allMethods = computed<CombinedPaymentMethod[]>(() => {
    const storeMethods = this.payment_methods();
    const availableMethods = this.available_payment_methods();
    const enabledIds = new Set(storeMethods.map(m => m.system_payment_method_id));

    const combined: CombinedPaymentMethod[] = [];

    // Add store payment methods
    storeMethods.forEach(storeMethod => {
      combined.push({
        id: storeMethod.id,
        display_name: storeMethod.display_name,
        type: storeMethod.system_payment_method?.type || 'unknown',
        provider: storeMethod.system_payment_method?.provider || 'unknown',
        state: storeMethod.state,
        is_system: false,
        is_store_method: true,
        system_payment_method_id: storeMethod.system_payment_method_id,
        store_payment_method: storeMethod,
        created_at: storeMethod.created_at,
      });
    });

    // Add available methods that are NOT yet added to store
    availableMethods
      .filter(m => !enabledIds.has(m.id))
      .forEach(availableMethod => {
        combined.push({
          id: availableMethod.id,
          display_name: availableMethod.display_name,
          type: availableMethod.type,
          provider: availableMethod.provider,
          state: 'available',
          is_system: availableMethod.provider === 'system',
          is_store_method: false,
          system_payment_method_id: availableMethod.id,
          created_at: availableMethod.created_at,
        });
      });

    return combined;
  });

  readonly filteredMethods = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const methods = this.allMethods();
    if (!term) return methods;
    return methods.filter(m =>
      m.display_name?.toLowerCase().includes(term) ||
      m.type?.toLowerCase().includes(term) ||
      m.provider?.toLowerCase().includes(term)
    );
  });

  readonly filteredAvailableMethods = computed(() => {
    const term = this.modalSearchTerm().toLowerCase();
    const methods = this.available_payment_methods();
    if (!term) return methods;
    return methods.filter(m =>
      m.display_name?.toLowerCase().includes(term) ||
      m.type?.toLowerCase().includes(term) ||
      m.provider?.toLowerCase().includes(term) ||
      m.description?.toLowerCase().includes(term)
    );
  });

  constructor(
    private paymentMethodsService: PaymentMethodsService,
    private toastService: ToastService,
    private dialogService: DialogService
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

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  onModalSearchChange(term: string): void {
    this.modalSearchTerm.set(term);
  }

  openAddModal(): void {
    this.modalSearchTerm.set('');
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.showAddModal.set(false);
  }

  loadPaymentMethods(): void {
    this.isLoading.set(true);
    this.paymentMethodsService
      .getStorePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const methods = response.data || response;
          this.payment_methods.set(methods || []);
          this.isLoading.set(false);
        },
        error: (error: any) => {
          this.toastService.error('Error al cargar métodos de pago: ' + error.message);
          this.payment_methods.set([]);
          this.isLoading.set(false);
        },
      });
  }

  loadPaymentMethodStats(): void {
    this.isLoadingStats.set(true);
    this.paymentMethodsService
      .getPaymentMethodStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.payment_method_stats.set(stats.data || stats);
          this.isLoadingStats.set(false);
        },
        error: (error: any) => {
          this.toastService.error('Error al cargar estadísticas: ' + error.message);
          this.payment_method_stats.set(null);
          this.isLoadingStats.set(false);
        },
      });
  }

  loadAvailablePaymentMethods(): void {
    this.isLoadingAvailable.set(true);
    this.paymentMethodsService
      .getAvailablePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods: any) => {
          const methodsData = methods.data || methods;
          this.available_payment_methods.set(methodsData || []);
          this.isLoadingAvailable.set(false);
        },
        error: (error: any) => {
          this.toastService.error('Error al cargar métodos disponibles: ' + error.message);
          this.available_payment_methods.set([]);
          this.isLoadingAvailable.set(false);
        },
      });
  }

  enableMethod(method: SystemPaymentMethod): void {
    this.enablingMethodId.set(method.id);
    this.paymentMethodsService
      .enablePaymentMethod(method.id, {
        display_name: method.display_name,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Método de pago agregado correctamente');
          this.enablingMethodId.set(null);
          this.loadPaymentMethods();
          this.loadPaymentMethodStats();
          this.loadAvailablePaymentMethods();
        },
        error: (error: any) => {
          this.toastService.error('Error al agregar método de pago: ' + error.message);
          this.enablingMethodId.set(null);
        },
      });
  }

  toggleMethod(method: CombinedPaymentMethod): void {
    if (!method.is_store_method || !method.store_payment_method) return;

    const storeMethod = method.store_payment_method;

    if (storeMethod.state === 'enabled') {
      this.dialogService
        .confirm({
          title: 'Desactivar Método de Pago',
          message: `¿Deseas desactivar "${method.display_name}"?`,
          confirmText: 'Desactivar',
          cancelText: 'Cancelar',
          confirmVariant: 'warning',
        })
        .then((confirmed) => {
          if (confirmed) {
            this.paymentMethodsService
              .disablePaymentMethod(storeMethod.id)
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: () => {
                  this.toastService.success('Método de pago desactivado');
                  this.loadPaymentMethods();
                  this.loadPaymentMethodStats();
                },
                error: (error: any) => {
                  this.toastService.error('Error al desactivar método: ' + error.message);
                },
              });
          }
        });
    } else {
      this.paymentMethodsService
        .enableStorePaymentMethod(storeMethod.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toastService.success('Método de pago activado');
            this.loadPaymentMethods();
            this.loadPaymentMethodStats();
          },
          error: (error: any) => {
            this.toastService.error('Error al activar método: ' + error.message);
          },
        });
    }
  }

  editMethod(method: CombinedPaymentMethod): void {
    this.toastService.info('Funcionalidad de edición próximamente');
  }

  getTypeLabel(type: string): string {
    const typeMap: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      paypal: 'PayPal',
      bank_transfer: 'Transferencia',
    };
    return typeMap[type] || type;
  }
}
