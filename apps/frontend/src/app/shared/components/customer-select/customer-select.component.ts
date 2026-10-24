import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { IconComponent } from '../icon/icon.component';
import { ToastService } from '../toast/toast.service';
import type { AddressPayload } from '../address-form-fields/address-form-fields.component';
import { CustomersService } from '../../../private/modules/store/customers/services/customers.service';
import type {
  CreateCustomerRequest,
  Customer,
} from '../../../private/modules/store/customers/models/customer.model';
import { translateCustomerError } from '../../../private/modules/store/customers/utils/customer-error.translator';
import { CustomerModalComponent } from '../../../private/modules/store/customers/components/customer-modal/customer-modal.component';

const SEARCH_DEBOUNCE_MS = 300;

/** Cliente elegido en el selector (subset estable de `Customer`). */
export interface CustomerSelectOption {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone?: string | null;
  document_type?: string | null;
  document_number?: string | null;
}

/**
 * Selector OPCIONAL de cliente de la tienda con búsqueda remota y botón
 * "+ Crear cliente" que abre el `app-customer-modal` canónico. Al crear, el
 * cliente nuevo queda seleccionado automáticamente.
 *
 * - Standalone, OnPush, zoneless + signals.
 * - `[(selected)]` (model) con el cliente elegido o `null` (venta/atención sin cliente).
 * - El modal de cliente se carga con `@defer`, así el chunk (y su import del
 *   barrel `shared/components`) no crea un ciclo estático con este barrel.
 */
@Component({
  selector: 'app-customer-select',
  standalone: true,
  imports: [FormsModule, IconComponent, CustomerModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-1">
      @if (label()) {
        <label class="block text-sm font-medium text-[var(--color-text-primary)]">{{ label() }}</label>
      }
      <div class="flex items-stretch gap-2">
        <div class="relative flex-1 min-w-0">
          @if (selected(); as customer) {
            <div
              class="flex items-center justify-between gap-2 p-2 border border-border rounded-lg bg-[var(--color-surface)]"
              [class.opacity-50]="disabled()"
            >
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-8 h-8 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                  <span class="text-xs font-bold">{{ initial(customer.name) }}</span>
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">{{ customer.name }}</p>
                  <p class="text-xs text-[var(--color-text-secondary)] truncate">
                    {{ secondaryLine(customer) }}
                  </p>
                </div>
              </div>
              @if (!disabled()) {
                <button
                  type="button"
                  (click)="clear()"
                  class="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-destructive)] shrink-0"
                  aria-label="Quitar cliente"
                >
                  <app-icon name="x" [size]="14" />
                </button>
              }
            </div>
          } @else {
            <div class="relative">
              <input
                type="text"
                [placeholder]="placeholder()"
                [disabled]="disabled()"
                [ngModel]="query()"
                (ngModelChange)="onQueryChange($event)"
                (focus)="openDropdown()"
                (keydown.escape)="isOpen.set(false)"
                class="w-full px-3 py-2 pr-8 text-sm border border-border rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:border-[var(--color-primary)] placeholder-[var(--color-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <app-icon
                name="search"
                [size]="14"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] pointer-events-none"
              />
            </div>
          }

          @if (isOpen() && !selected()) {
            <div class="absolute z-[10000] top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
              @if (isLoading()) {
                <div class="flex items-center justify-center gap-2 p-4 text-sm text-[var(--color-text-secondary)]">
                  <app-icon name="loader-2" [size]="16" [spin]="true" />
                  Buscando...
                </div>
              } @else if (results().length === 0) {
                <div class="p-4 text-center text-sm text-[var(--color-text-secondary)]">
                  @if (query().trim()) {
                    No se encontraron clientes
                  } @else {
                    Escribe nombre, documento, correo o teléfono
                  }
                </div>
              } @else {
                @for (customer of results(); track customer.id) {
                  <button
                    type="button"
                    class="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary-50 transition-colors text-left"
                    (mousedown)="select(customer)"
                  >
                    <div class="w-8 h-8 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                      <span class="text-xs font-bold">{{ initial(customer.name) }}</span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">{{ customer.name }}</p>
                      <p class="text-xs text-[var(--color-text-secondary)] truncate">{{ secondaryLine(customer) }}</p>
                    </div>
                  </button>
                }
              }
            </div>
          }
        </div>

        @if (allowCreate()) {
          <button
            type="button"
            [disabled]="disabled() || creating()"
            (click)="openCreate()"
            class="shrink-0 inline-flex items-center gap-1 px-3 text-sm font-medium rounded-lg border border-border bg-[var(--color-surface)] text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Crear cliente"
            title="Crear cliente"
          >
            <app-icon [name]="creating() ? 'loader-2' : 'plus'" [size]="14" [spin]="creating()" />
            <span class="hidden sm:inline">Crear cliente</span>
          </button>
        }
      </div>
      @if (helpText()) {
        <p class="text-xs text-[var(--color-text-secondary)]">{{ helpText() }}</p>
      }
    </div>

    @defer (when createOpen()) {
      <app-customer-modal
        [isOpen]="createOpen()"
        [customer]="null"
        [initialValues]="createInitialValues()"
        [loading]="creating()"
        (isOpenChange)="createOpen.set($event)"
        (closed)="createOpen.set(false)"
        (save)="onCreate($event)"
        (addressData)="pendingAddress.set($event)"
      />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
    `,
  ],
})
export class CustomerSelectComponent implements OnInit {
  private readonly customersService = inject(CustomersService);
  private readonly toast = inject(ToastService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  readonly label = input<string>('');
  readonly placeholder = input<string>('Buscar cliente (opcional)...');
  readonly helpText = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly allowCreate = input<boolean>(true);
  /** Prellenado del alta (p. ej. el nombre o documento que ya se digitó). */
  readonly createInitialValues = input<Partial<CreateCustomerRequest> | null>(null);

  /** Cliente seleccionado; `null` = sin cliente. */
  readonly selected = model<CustomerSelectOption | null>(null);
  /** Emite solo cuando se crea un cliente nuevo desde el botón "+". */
  readonly created = output<CustomerSelectOption>();

  readonly query = signal('');
  readonly results = signal<CustomerSelectOption[]>([]);
  readonly isLoading = signal(false);
  readonly isOpen = signal(false);
  readonly createOpen = signal(false);
  readonly creating = signal(false);
  readonly pendingAddress = signal<AddressPayload | null>(null);

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        tap(() => this.isLoading.set(true)),
        switchMap((term) =>
          this.customersService.getCustomers(1, 10, term.trim() ? { search: term.trim() } : undefined).pipe(
            map((response) => (response?.data ?? []).map((c) => this.toOption(c))),
            catchError(() => of([] as CustomerSelectOption[])),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((options) => {
        this.isLoading.set(false);
        this.results.set(options);
      });
  }

  onQueryChange(term: string): void {
    this.query.set(term);
    this.isOpen.set(true);
    this.searchSubject.next(term);
  }

  openDropdown(): void {
    if (this.disabled()) return;
    this.isOpen.set(true);
    if (!this.selected()) this.searchSubject.next(this.query());
  }

  select(customer: CustomerSelectOption): void {
    this.selected.set(customer);
    this.query.set('');
    this.results.set([]);
    this.isOpen.set(false);
  }

  clear(): void {
    if (this.disabled()) return;
    this.selected.set(null);
    this.query.set('');
    this.results.set([]);
  }

  openCreate(): void {
    if (this.disabled()) return;
    this.isOpen.set(false);
    this.pendingAddress.set(null);
    this.createOpen.set(true);
  }

  onCreate(data: CreateCustomerRequest): void {
    this.creating.set(true);
    this.customersService
      .createCustomer(data)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (response: Customer | { data?: Customer }) => {
          const customer = (
            response && 'data' in response && response.data ? response.data : response
          ) as Customer;
          if (!customer?.id) {
            this.toast.error('No se pudo leer el cliente creado.');
            return;
          }
          this.toast.success('Cliente creado correctamente');
          const address = this.pendingAddress();
          this.pendingAddress.set(null);
          if (address) this.persistAddress(customer.id, address);
          const option = this.toOption(customer);
          this.createOpen.set(false);
          this.select(option);
          this.created.emit(option);
        },
        error: (error: unknown) => {
          this.pendingAddress.set(null);
          this.toast.error(translateCustomerError(error), 'Error al crear cliente');
        },
      });
  }

  initial(name: string): string {
    return (name?.charAt(0) || '?').toUpperCase();
  }

  secondaryLine(customer: CustomerSelectOption): string {
    const parts = [
      customer.document_number ? `${customer.document_type || 'Doc'} ${customer.document_number}` : '',
      customer.phone || '',
      customer.email || '',
    ].filter(Boolean);
    return parts.join(' · ') || `Cliente #${customer.id}`;
  }

  private toOption(customer: Customer): CustomerSelectOption {
    const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
    return {
      id: Number(customer.id),
      name: customer.legal_name || fullName || customer.email || `Cliente #${customer.id}`,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
      phone: customer.phone ?? null,
      document_type: customer.document_type ?? null,
      document_number: customer.document_number ?? null,
    };
  }

  private persistAddress(customerId: number, payload: AddressPayload): void {
    this.customersService
      .createCustomerAddress({
        address_line_1: payload.address_line1 ?? '',
        address_line_2: payload.address_line2 ?? undefined,
        city: payload.city ?? '',
        state: payload.state_province ?? '',
        country: payload.country_code ?? '',
        postal_code: payload.postal_code ?? undefined,
        type: 'shipping' as const,
        is_primary: true,
        customer_id: customerId,
        latitude: payload.latitude != null ? String(payload.latitude) : undefined,
        longitude: payload.longitude != null ? String(payload.longitude) : undefined,
        municipality_code: payload.municipality_code || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () =>
          this.toast.error('No se pudo guardar la dirección de envío. El cliente fue creado correctamente.'),
      });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const inside = event.composedPath().some((node) => node === this.elementRef.nativeElement);
    if (!inside) this.isOpen.set(false);
  }
}
