import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  IconComponent,
  InputsearchComponent,
} from '../../../../../../shared/components';

import { WizardStepSectionComponent } from './wizard-step-section.component';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { LocationsService } from '../../../inventory/services/locations.service';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import {
  PurchaseOrdersService,
} from '../../../inventory/services/purchase-orders.service';
import { PosCustomerService } from '../../../pos/services/pos-customer.service';

/**
 * Party step (step 1 for non-customer_delivery subtypes — ref R4a).
 *
 * Renders a different selector per subtype:
 *   - transfer_out / transfer_in: from_location_id + to_location_id
 *   - purchase_receipt: supplier_id + optional purchase_order_id
 *   - customer_return: customer_id + related_dispatch_id
 *
 * Zoneless puro: signal/computed, sin NgZone/markForCheck.
 */
@Component({
  selector: 'app-dispatch-wizard-party-step',
  standalone: true,
  imports: [
    IconComponent,
    InputsearchComponent,
    WizardStepSectionComponent,
  ],
  template: `
    <app-wizard-step-section
      [icon]="sectionIcon()"
      [title]="sectionTitle()"
      [subtitle]="sectionSubtitle()"
      [dense]="true"
    >
      @switch (wizardService.subtype()) {
        @case ('transfer_out') {
          <section class="space-y-3">
            <!-- Origin -->
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Bodega origen
              </p>
              <app-inputsearch
                placeholder="Buscar bodega origen..."
                [debounceTime]="300"
                (search)="onSearchLocation($event, 'from')"
              ></app-inputsearch>
              @if (locationSearchFrom().length > 0) {
                <div class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)] mt-1">
                  @for (loc of locationSearchFrom(); track loc.id) {
                    <button
                      type="button"
                      class="w-full text-left p-2 flex items-center gap-2 hover:bg-[var(--color-primary-light)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                      (click)="selectFromLocation(loc)"
                    >
                      <app-icon name="map-pin" [size]="14" color="var(--color-text-muted)"></app-icon>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">{{ loc.name }}</p>
                        @if (loc.code) {
                          <p class="text-xs text-[var(--color-text-muted)] truncate">{{ loc.code }}</p>
                        }
                      </div>
                      @if (wizardService.fromLocationId() === loc.id) {
                        <app-icon name="check" [size]="14" color="var(--color-primary)"></app-icon>
                      }
                    </button>
                  }
                </div>
              }
            </div>
            <!-- Destination -->
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Bodega destino (otra tienda)
              </p>
              <app-inputsearch
                placeholder="Buscar bodega destino..."
                [debounceTime]="300"
                (search)="onSearchLocation($event, 'to')"
              ></app-inputsearch>
              @if (locationSearchTo().length > 0) {
                <div class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)] mt-1">
                  @for (loc of locationSearchTo(); track loc.id) {
                    <button
                      type="button"
                      class="w-full text-left p-2 flex items-center gap-2 hover:bg-[var(--color-primary-light)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                      (click)="selectToLocation(loc)"
                    >
                      <app-icon name="map-pin" [size]="14" color="var(--color-text-muted)"></app-icon>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">{{ loc.name }}</p>
                        @if (loc.code) {
                          <p class="text-xs text-[var(--color-text-muted)] truncate">{{ loc.code }}</p>
                        }
                      </div>
                      @if (wizardService.toLocationId() === loc.id) {
                        <app-icon name="check" [size]="14" color="var(--color-primary)"></app-icon>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </section>
        }

        @case ('transfer_in') {
          <section class="space-y-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Bodega origen (otra tienda)
              </p>
              <app-inputsearch
                placeholder="Buscar bodega origen..."
                [debounceTime]="300"
                (search)="onSearchLocation($event, 'from')"
              ></app-inputsearch>
              @if (locationSearchFrom().length > 0) {
                <div class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)] mt-1">
                  @for (loc of locationSearchFrom(); track loc.id) {
                    <button
                      type="button"
                      class="w-full text-left p-2 flex items-center gap-2 hover:bg-[var(--color-primary-light)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                      (click)="selectFromLocation(loc)"
                    >
                      <app-icon name="map-pin" [size]="14" color="var(--color-text-muted)"></app-icon>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">{{ loc.name }}</p>
                        @if (loc.code) {
                          <p class="text-xs text-[var(--color-text-muted)] truncate">{{ loc.code }}</p>
                        }
                      </div>
                      @if (wizardService.fromLocationId() === loc.id) {
                        <app-icon name="check" [size]="14" color="var(--color-primary)"></app-icon>
                      }
                    </button>
                  }
                </div>
              }
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Bodega destino (esta tienda)
              </p>
              <app-inputsearch
                placeholder="Buscar bodega destino..."
                [debounceTime]="300"
                (search)="onSearchLocation($event, 'to')"
              ></app-inputsearch>
              @if (locationSearchTo().length > 0) {
                <div class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)] mt-1">
                  @for (loc of locationSearchTo(); track loc.id) {
                    <button
                      type="button"
                      class="w-full text-left p-2 flex items-center gap-2 hover:bg-[var(--color-primary-light)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                      (click)="selectToLocation(loc)"
                    >
                      <app-icon name="map-pin" [size]="14" color="var(--color-text-muted)"></app-icon>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">{{ loc.name }}</p>
                        @if (loc.code) {
                          <p class="text-xs text-[var(--color-text-muted)] truncate">{{ loc.code }}</p>
                        }
                      </div>
                      @if (wizardService.toLocationId() === loc.id) {
                        <app-icon name="check" [size]="14" color="var(--color-primary)"></app-icon>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </section>
        }

        @case ('purchase_receipt') {
          <section class="space-y-3">
            <!-- Supplier search -->
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Proveedor
              </p>
              @if (wizardService.supplierId(); as sid) {
                <div class="relative border-2 border-[var(--color-success)] rounded-lg p-2.5 bg-[var(--color-success)]/5">
                  <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center shrink-0">
                      <app-icon name="truck" [size]="16" color="var(--color-primary)"></app-icon>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                        {{ wizardService.supplierName() }}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="text-xs font-medium text-[var(--color-primary)] hover:underline"
                      (click)="changeSupplier()"
                    >
                      Cambiar
                    </button>
                  </div>
                </div>
              } @else {
                <app-inputsearch
                  placeholder="Buscar por nombre o código de proveedor..."
                  [debounceTime]="300"
                  (search)="onSearchSupplier($event)"
                ></app-inputsearch>
                @if (supplierResults().length > 0) {
                  <div class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)] mt-1">
                    @for (sup of supplierResults(); track sup.id) {
                      <button
                        type="button"
                        class="w-full text-left p-2 flex items-center gap-2 hover:bg-[var(--color-primary-light)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                        (click)="selectSupplier(sup)"
                      >
                        <app-icon name="truck" [size]="14" color="var(--color-text-muted)"></app-icon>
                        <div class="flex-1 min-w-0">
                          <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">{{ sup.name }}</p>
                          @if (sup.code) {
                            <p class="text-xs text-[var(--color-text-muted)] truncate">{{ sup.code }}</p>
                          }
                        </div>
                        <app-icon name="plus" [size]="14" color="var(--color-primary)"></app-icon>
                      </button>
                    }
                  </div>
                }
              }
            </div>

            <!-- Optional PO selector -->
            @if (wizardService.supplierId()) {
              <div>
                <div class="flex items-center gap-1.5 mb-1.5">
                  <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Orden de compra (opcional)
                  </p>
                </div>
                @if (poLoading()) {
                  <p class="text-xs text-[var(--color-text-muted)]">Cargando órdenes de compra...</p>
                } @else if (purchaseOrders().length === 0) {
                  <p class="text-xs text-[var(--color-text-muted)] italic">
                    No hay órdenes de compra abiertas para este proveedor.
                  </p>
                } @else {
                  <div class="space-y-1 max-h-40 overflow-y-auto">
                    @for (po of purchaseOrders(); track po.id) {
                      <button
                        type="button"
                        class="w-full text-left p-2 border rounded-lg transition-colors"
                        [class]="
                          wizardService.purchaseOrderId() === po.id
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                            : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                        "
                        (click)="selectPO(po)"
                      >
                        <div class="flex items-center justify-between">
                          <span class="text-sm font-medium text-[var(--color-text-primary)]">
                            #{{ po.order_number || po.id }}
                          </span>
                          <span class="text-xs text-[var(--color-text-muted)]">
                            {{ po.status }}
                          </span>
                        </div>
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </section>
        }

        @case ('customer_return') {
          <section class="space-y-3">
            <!-- Customer search -->
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Cliente
              </p>
              @if (wizardService.customerId(); as cid) {
                <div class="relative border-2 border-[var(--color-success)] rounded-lg p-2.5 bg-[var(--color-success)]/5">
                  <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center shrink-0">
                      <app-icon name="user" [size]="16" color="var(--color-primary)"></app-icon>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                        {{ wizardService.customerName() }}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="text-xs font-medium text-[var(--color-primary)] hover:underline"
                      (click)="changeCustomer()"
                    >
                      Cambiar
                    </button>
                  </div>
                </div>
              } @else {
                <app-inputsearch
                  placeholder="Buscar por nombre, email o documento..."
                  [debounceTime]="300"
                  (search)="onSearchCustomer($event)"
                ></app-inputsearch>
                @if (customerResults().length > 0) {
                  <div class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)] mt-1">
                    @for (cust of customerResults(); track cust.id) {
                      <button
                        type="button"
                        class="w-full text-left p-2 flex items-center gap-2 hover:bg-[var(--color-primary-light)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                        (click)="selectCustomer(cust)"
                      >
                        <app-icon name="user" [size]="14" color="var(--color-text-muted)"></app-icon>
                        <div class="flex-1 min-w-0">
                          <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {{ cust.first_name }} {{ cust.last_name }}
                          </p>
                          @if (cust.document_number) {
                            <p class="text-xs text-[var(--color-text-muted)] truncate">Doc: {{ cust.document_number }}</p>
                          }
                        </div>
                        <app-icon name="plus" [size]="14" color="var(--color-primary)"></app-icon>
                      </button>
                    }
                  </div>
                }
              }
            </div>

            <!-- Related dispatch selector -->
            @if (wizardService.customerId()) {
              <div>
                <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                  Remisión original (opcional)
                </p>
                @if (dispatchLoading()) {
                  <p class="text-xs text-[var(--color-text-muted)]">Cargando remisiones entregadas...</p>
                } @else if (deliveredDispatches().length === 0) {
                  <p class="text-xs text-[var(--color-text-muted)] italic">
                    No hay remisiones entregadas para este cliente.
                  </p>
                } @else {
                  <div class="space-y-1 max-h-40 overflow-y-auto">
                    @for (dn of deliveredDispatches(); track dn.id) {
                      <button
                        type="button"
                        class="w-full text-left p-2 border rounded-lg transition-colors"
                        [class]="
                          wizardService.relatedDispatchId() === dn.id
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                            : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                        "
                        (click)="selectRelatedDispatch(dn)"
                      >
                        <div class="flex items-center justify-between">
                          <span class="text-sm font-medium text-[var(--color-text-primary)]">
                            #{{ dn.dispatch_number }}
                          </span>
                          <span class="text-xs text-[var(--color-text-muted)]">
                            {{ dn.emission_date }}
                          </span>
                        </div>
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </section>
        }
      }
    </app-wizard-step-section>
  `,
})
export class PartyStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly locationsService = inject(LocationsService);
  private readonly suppliersService = inject(SuppliersService);
  private readonly purchaseOrdersService = inject(PurchaseOrdersService);
  private readonly customerService = inject(PosCustomerService);
  private readonly dispatchNotesService = inject(DispatchNotesService);
  private readonly destroyRef = inject(DestroyRef);

  // --- Shell header (icon/title/subtitle derived from subtype) ---
  readonly sectionIcon = computed<string>(() => {
    switch (this.wizardService.subtype()) {
      case 'transfer_out':
      case 'transfer_in':
        return 'arrow-right-left';
      case 'purchase_receipt':
        return 'truck';
      case 'customer_return':
        return 'user';
      default:
        return 'user';
    }
  });

  readonly sectionTitle = computed<string>(() => {
    switch (this.wizardService.subtype()) {
      case 'transfer_out':
      case 'transfer_in':
        return 'Origen y destino';
      case 'purchase_receipt':
        return 'Proveedor';
      case 'customer_return':
        return 'Cliente y remisión';
      default:
        return 'Contraparte';
    }
  });

  readonly sectionSubtitle = computed<string>(() => {
    switch (this.wizardService.subtype()) {
      case 'transfer_out':
        return 'Bodega origen (esta tienda) y destino (otra tienda)';
      case 'transfer_in':
        return 'Bodega origen (otra tienda) y destino (esta tienda)';
      case 'purchase_receipt':
        return 'Selecciona el proveedor y, opcionalmente, la orden de compra';
      case 'customer_return':
        return 'Selecciona el cliente y, opcionalmente, la remisión original';
      default:
        return '';
    }
  });

  // --- Location search (transfer_out / transfer_in) ---
  readonly allLocations = signal<any[]>([]);
  readonly locationSearchFrom = signal<any[]>([]);
  readonly locationSearchTo = signal<any[]>([]);

  // --- Supplier search (purchase_receipt) ---
  readonly supplierResults = signal<any[]>([]);
  readonly purchaseOrders = signal<any[]>([]);
  readonly poLoading = signal(false);

  // --- Customer search (customer_return) ---
  readonly customerResults = signal<any[]>([]);
  readonly deliveredDispatches = signal<any[]>([]);
  readonly dispatchLoading = signal(false);

  constructor() {
    // Preload locations for transfer subtypes.
    this.loadLocations();
  }

  private loadLocations(): void {
    this.locationsService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const locs = response.data || [];
          this.allLocations.set(locs);
        },
        error: () => this.allLocations.set([]),
      });
  }

  onSearchLocation(query: string, which: 'from' | 'to'): void {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      if (which === 'from') this.locationSearchFrom.set([]);
      else this.locationSearchTo.set([]);
      return;
    }
    const filtered = this.allLocations().filter(
      (loc) =>
        (loc.name || '').toLowerCase().includes(q) ||
        (loc.code || '').toLowerCase().includes(q),
    );
    if (which === 'from') this.locationSearchFrom.set(filtered);
    else this.locationSearchTo.set(filtered);
  }

  selectFromLocation(loc: any): void {
    this.wizardService.setFromLocationId(loc.id);
    this.locationSearchFrom.set([]);
  }

  selectToLocation(loc: any): void {
    this.wizardService.setToLocationId(loc.id);
    this.locationSearchTo.set([]);
  }

  // --- Supplier (purchase_receipt) ---

  onSearchSupplier(query: string): void {
    if (!query || !query.trim()) {
      this.supplierResults.set([]);
      return;
    }
    this.suppliersService
      .getSuppliers({ search: query.trim(), is_active: true, limit: 20 } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const suppliers = response.data || [];
          this.supplierResults.set(Array.isArray(suppliers) ? suppliers : []);
        },
        error: () => this.supplierResults.set([]),
      });
  }

  selectSupplier(sup: any): void {
    this.wizardService.setSupplier(sup.id, sup.name);
    this.supplierResults.set([]);
    this.loadPurchaseOrders(sup.id);
  }

  changeSupplier(): void {
    this.wizardService.setSupplier(null);
    this.purchaseOrders.set([]);
  }

  private loadPurchaseOrders(supplierId: number): void {
    this.poLoading.set(true);
    this.purchaseOrdersService
      .getPurchaseOrders({ supplier_id: supplierId, limit: 20 } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const pos = response.data || [];
          // Only show open/active POs (not fully received/cancelled).
          const open = (Array.isArray(pos) ? pos : []).filter(
            (po: any) => !['received', 'cancelled', 'voided'].includes(po.status),
          );
          this.purchaseOrders.set(open);
          this.poLoading.set(false);
        },
        error: () => {
          this.purchaseOrders.set([]);
          this.poLoading.set(false);
        },
      });
  }

  selectPO(po: any): void {
    this.wizardService.setPurchaseOrderId(po.id);
  }

  // --- Customer (customer_return) ---

  onSearchCustomer(query: string): void {
    if (!query || !query.trim()) {
      this.customerResults.set([]);
      return;
    }
    this.customerService
      .searchCustomers({ query: query.trim(), limit: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.customerResults.set(response.data || []);
        },
        error: () => this.customerResults.set([]),
      });
  }

  selectCustomer(cust: any): void {
    const name = `${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim() || `Cliente #${cust.id}`;
    this.wizardService.setCustomerParty(cust.id, name);
    this.customerResults.set([]);
    this.loadDeliveredDispatches(cust.id);
  }

  changeCustomer(): void {
    this.wizardService.setCustomerParty(null);
    this.deliveredDispatches.set([]);
  }

  private loadDeliveredDispatches(customerId: number): void {
    this.dispatchLoading.set(true);
    this.dispatchNotesService
      .getDispatchNotes({ customer_id: customerId, direction: 'outbound', status: 'delivered', limit: 20 } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const notes = response.data || response;
          const arr = Array.isArray(notes) ? notes : [];
          this.deliveredDispatches.set(arr);
          this.dispatchLoading.set(false);
        },
        error: () => {
          this.deliveredDispatches.set([]);
          this.dispatchLoading.set(false);
        },
      });
  }

  selectRelatedDispatch(dn: any): void {
    this.wizardService.setRelatedDispatchId(dn.id);
  }
}