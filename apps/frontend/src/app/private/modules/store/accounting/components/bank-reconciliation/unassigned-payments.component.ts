import {
  Component,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { Router } from '@angular/router';
import {
  ButtonComponent,
  IconComponent,
  StatsComponent,
  InputsearchComponent,
  CardComponent,
  ModalComponent,
  SelectorComponent,
  PaginationComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import {
  UnassignedPayment,
  AssignableBankAccount,
} from '../../interfaces/accounting.interface';

/**
 * E.2 (CP-POLLO-ARABE-727 / cross-ref QUI-728) — pagos sin asignar.
 *
 * Pantalla propia dentro del módulo de bank-reconciliation: lista los
 * `payments WHERE bank_account_id IS NULL` ("Sin asignar") y permite asignar
 * la cuenta de destino (payments.bank_account_id) con la acción manual
 * "Asignar cuenta".
 *
 * NO es la UI de conciliación existente (que empareja `bank_transaction_id`
 * con `accounting_entry_id` sobre otro modelo de datos). El backend afín es
 * `digital-payment-matcher.service.ts`; la lógica de listado/asignación vive en
 * `unassigned-payments.service.ts`.
 *
 * Zoneless: estado 100% en signals, sin NgZone / markForCheck.
 */
@Component({
  selector: 'vendix-unassigned-payments',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    CardComponent,
    ModalComponent,
    SelectorComponent,
    PaginationComponent,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Sin asignar"
          [value]="stats().total"
          iconName="circle-alert"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Monto Total"
          [value]="stats().total_amount | currency: 0"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Cuentas Activas"
          [value]="accounts().length"
          iconName="landmark"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [clickable]="false"
        ></app-stats>
      </div>

      <!-- Container -->
      <app-card
        [responsive]="true"
        [padding]="false"
        customClasses="md:min-h-[400px]"
      >
        <!-- Search Header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary"
            >
              Pagos Sin Asignar ({{ totalItems() }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar pago / orden..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="loadPayments()"
              >
                <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Actualizar</span>
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="navigateToAccounts()"
              >
                <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Cuentas</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          @if (loading()) {
            <div
              class="absolute inset-0 bg-[color-mix(in_srgb,var(--color-surface)_50%,transparent)] z-10 flex items-center justify-center"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"
              ></div>
            </div>
          }

          <!-- Table Header (desktop) -->
          <div
            class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-[var(--color-surface-secondary)] rounded-lg
                      text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1"
          >
            <div class="col-span-2">Pago</div>
            <div class="col-span-2">Fecha</div>
            <div class="col-span-2">Método</div>
            <div class="col-span-2 text-right">Monto</div>
            <div class="col-span-2">Referencia</div>
            <div class="col-span-2 text-right">Acciones</div>
          </div>

          @if (payments().length === 0) {
            <div
              class="flex flex-col items-center justify-center py-16 text-text-secondary"
            >
              <app-icon name="check-circle" [size]="48"></app-icon>
              <p class="mt-4 text-base">No hay pagos sin asignar</p>
              <p class="text-sm">
                Todos los pagos de esta tienda ya tienen cuenta bancaria asignada.
              </p>
            </div>
          } @else {
            <div class="divide-y divide-border">
              @for (payment of payments(); track payment.payment_id) {
                <!-- Mobile Card -->
                <div
                  class="md:hidden p-3 mx-2 my-1 bg-[var(--color-surface)] rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
                >
                  <div class="flex items-center justify-between">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span
                          class="text-[15px] font-bold text-text-primary truncate"
                          >#{{ payment.payment_id }}</span
                        >
                        <span
                          class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-warning-light text-warning"
                        >
                          Sin asignar
                        </span>
                      </div>
                      <div class="flex items-center gap-2 mt-1">
                        <span class="text-xs text-text-secondary">{{
                          payment.order_number || 'Sin orden'
                        }}</span>
                        <span class="text-xs text-text-secondary">{{
                          payment.payment_method_display ||
                            payment.payment_method ||
                            '—'
                        }}</span>
                      </div>
                      <div class="mt-1">
                        <span
                          class="text-sm font-semibold text-success"
                        >
                          {{ payment.amount | currency: 0 }}
                        </span>
                        <span class="ml-2 text-[10px] text-text-secondary">
                          {{ payment.paid_at | date: 'dd/MM/yyyy HH:mm' }}
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center ml-2">
                      <button
                        (click)="openAssignModal(payment)"
                        class="p-1.5 rounded border border-[var(--color-info)] bg-[var(--color-info-light)] text-[var(--color-info)] hover:opacity-90"
                        [disabled]="assigning()"
                      >
                        <app-icon name="landmark" [size]="14"></app-icon>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Desktop Row -->
                <div
                  class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-[var(--color-surface-secondary)] transition-colors"
                >
                  <div class="col-span-2 text-sm text-text-primary font-medium truncate">
                    #{{ payment.payment_id }}
                    <span
                      class="ml-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-warning-light text-warning"
                    >
                      Sin asignar
                    </span>
                  </div>
                  <div class="col-span-2 text-sm text-gray-600 truncate">
                    {{ payment.paid_at | date: 'dd/MM/yyyy HH:mm' }}
                  </div>
                  <div class="col-span-2 text-sm text-gray-600 truncate">
                    {{ payment.payment_method_display || payment.payment_method || '—' }}
                  </div>
                  <div class="col-span-2 text-sm text-right font-semibold text-success">
                    {{ payment.amount | currency: 0 }}
                  </div>
                  <div class="col-span-2 text-sm font-mono text-text-secondary truncate">
                    {{ payment.gateway_reference || (payment.order_number || '—') }}
                  </div>
                  <div class="col-span-2 flex items-center justify-end gap-1">
                    <button
                      (click)="openAssignModal(payment)"
                      class="p-1.5 rounded border border-[var(--color-info)] bg-[var(--color-info-light)] text-[var(--color-info)] hover:opacity-90"
                      [disabled]="assigning()"
                      title="Asignar cuenta"
                    >
                      <app-icon name="landmark" [size]="14"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Pagination -->
          @if (totalPages() > 1) {
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="totalItems()"
                [limit]="limit()"
                (pageChange)="onPageChange($event)"
              ></app-pagination>
            </div>
          }
        </div>
      </app-card>

      <!-- Assign Modal -->
      <app-modal
        [isOpen]="isAssignModalOpen()"
        (isOpenChange)="isAssignModalOpen.set($event)"
        [title]="'Asignar cuenta'"
        [subtitle]="assignSubtitle()"
        [size]="'sm'"
        (cancel)="closeAssignModal()"
      >
        <div class="p-5 space-y-4">
          @if (selectedPayment()) {
            @if (accountsLoading()) {
              <div class="flex justify-center py-6">
                <div
                  class="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-primary)]"
                ></div>
              </div>
            } @else if (accounts().length === 0) {
              <p class="text-sm text-text-secondary text-center py-6">
                No hay cuentas bancarias activas para asignar.
              </p>
            } @else {
              <app-selector
                [options]="accountOptions()"
                [label]="'Cuenta de destino'"
                [placeholder]="'Selecciona una cuenta bancaria'"
                [searchable]="true"
                (valueChange)="onAccountChange($event)"
              ></app-selector>
            }
          }
        </div>
        <div slot="footer">
          <div class="flex justify-end gap-2">
            <app-button
              variant="outline"
              size="sm"
              (clicked)="closeAssignModal()"
            >
              Cancelar
            </app-button>
            <app-button
              variant="primary"
              size="sm"
              [disabled]="!selectedAccountId() || assigning()"
              (clicked)="confirmAssign()"
            >
              Asignar
            </app-button>
          </div>
        </div>
      </app-modal>
    </div>
  `,
})
export class UnassignedPaymentsComponent {
  private destroyRef = inject(DestroyRef);
  private reconciliationService = inject(BankReconciliationService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  // ── Listado
  payments = signal<UnassignedPayment[]>([]);
  loading = signal(false);
  searchTerm = signal('');
  page = signal(1);
  limit = signal(25);
  totalItems = signal(0);

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.limit())),
  );

  // Suma del conjunto filtrado completo, la calcula el backend (`meta.total_amount`).
  // Sumar `payments()` aquí daba el total de la página visible —25 de 80 filas—
  // y la tarjeta contradecía al contador de la lista que tiene al lado.
  totalAmount = signal(0);

  stats = computed(() => ({
    total: this.totalItems(),
    total_amount: this.totalAmount(),
  }));

  // ── Asignación
  isAssignModalOpen = signal(false);
  accounts = signal<AssignableBankAccount[]>([]);
  accountsLoading = signal(false);
  selectedPayment = signal<UnassignedPayment | null>(null);
  selectedAccountId = signal<number | null>(null);
  assigning = signal(false);

  accountOptions = computed<SelectorOption[]>(() =>
    this.accounts().map((a) => ({
      value: a.id,
      label: `${a.name} — ${a.bank_name} (${a.account_number})`,
    })),
  );

  assignSubtitle = computed(() => {
    const p = this.selectedPayment();
    if (!p) return '';
    return `Pago #${p.payment_id} · Orden ${p.order_number || 'N/A'}`;
  });

  constructor() {
    this.loadPayments();
    // La tarjeta "Cuentas Activas" lee `accounts()`, así que el dato tiene que
    // existir al entrar: cargarlo solo al abrir el modal de asignación dejaba la
    // tarjeta en 0 aunque la tienda tuviera cuentas activas.
    this.loadAccounts();
  }

  loadPayments(): void {
    this.loading.set(true);
    this.reconciliationService
      .getUnassignedPayments({
        page: this.page(),
        limit: this.limit(),
        search: this.searchTerm(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.payments.set(res.data || []);
          this.totalItems.set(res.meta?.total ?? 0);
          this.totalAmount.set(res.meta?.total_amount ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar los pagos sin asignar');
          this.loading.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.page.set(1);
    this.loadPayments();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.loadPayments();
  }

  navigateToAccounts(): void {
    this.router.navigate(['/store/accounting/bank-reconciliation']);
  }

  openAssignModal(payment: UnassignedPayment): void {
    this.selectedPayment.set(payment);
    this.selectedAccountId.set(null);
    this.isAssignModalOpen.set(true);
    // Ya se cargan al entrar a la pantalla; solo se reintenta si aquella falló.
    if (this.accounts().length === 0) {
      this.loadAccounts();
    }
  }

  closeAssignModal(): void {
    this.isAssignModalOpen.set(false);
    this.selectedPayment.set(null);
    this.selectedAccountId.set(null);
  }

  loadAccounts(): void {
    this.accountsLoading.set(true);
    this.reconciliationService
      .getAssignableAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.accounts.set(res.data || []);
          this.accountsLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar las cuentas bancarias');
          this.accountsLoading.set(false);
        },
      });
  }

  onAccountChange(value: string | number | null): void {
    this.selectedAccountId.set(
      value === null ? null : Number(value),
    );
  }

  confirmAssign(): void {
    const payment = this.selectedPayment();
    const account_id = this.selectedAccountId();
    if (!payment || !account_id) return;

    this.assigning.set(true);
    this.reconciliationService
      .assignPaymentAccount(payment.payment_id, account_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Cuenta asignada correctamente');
          this.assigning.set(false);
          this.closeAssignModal();
          this.loadPayments();
        },
        error: (err) => {
          const message =
            err?.error?.message || err?.message || 'Error al asignar la cuenta';
          this.toastService.error(message);
          this.assigning.set(false);
        },
      });
  }
}
