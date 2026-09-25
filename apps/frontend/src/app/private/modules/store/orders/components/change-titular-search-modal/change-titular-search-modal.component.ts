import { Component, DestroyRef, inject, input, output, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  CustomersService,
} from '../../../customers/services/customers.service';
import { Customer } from '../../../customers/models/customer.model';

type TitularSearchStep = 'search' | 'create';

/**
 * Buscar-o-crear para el cambio de titular de la orden, con la UX del modal
 * "Crear Cliente Rápido" del POS (tabs Buscar/Crear, lookup rápido por
 * documento, resultados en tarjetas seleccionables).
 *
 * Diferencia clave: la creación NO es el quick limitado del POS. El tab Crear
 * (y los CTAs "crear") emiten `createNew` y el padre abre el
 * `app-customer-modal` canónico (quick/advanced, NATURAL/JURIDICA con razón
 * social + datos fiscales DIAN para facturar).
 *
 * Zoneless-clean: signals + `input()`/`output()` únicamente; la búsqueda por
 * nombre usa Subject+debounceTime+switchMap (el inputsearch ya debouncea a
 * 300ms; el switchMap cancela in-flight).
 */
@Component({
  selector: 'app-change-titular-search-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      (closed)="onClose()"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      size="md"
    >
      <!-- Tab Navigation -->
      <!-- full-bleed calibrado al padding del body de app-modal (px-3 py-2.5 md:px-5 md:py-4): evita scroll horizontal -->
      <div class="flex border-b border-[var(--color-border)] -mx-3 -mt-2.5 px-3 md:-mx-5 md:-mt-4 md:px-5 mb-6" role="tablist" aria-label="Modo de titular">
        <button
          type="button"
          role="tab"
          (click)="switchToSearchMode()"
          [attr.aria-selected]="currentStep() === 'search'"
          class="flex-1 px-4 py-3 min-h-[44px] text-sm font-medium transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
          [class.text-[var(--color-primary)]]="currentStep() === 'search'"
          [class.border-b-2]="currentStep() === 'search'"
          [class.border-[var(--color-primary)]]="currentStep() === 'search'"
          [class.text-[var(--color-neutral-600)]]="currentStep() !== 'search'"
        >
          Buscar
        </button>
        <button
          type="button"
          role="tab"
          (click)="switchToCreateMode()"
          [attr.aria-selected]="currentStep() === 'create'"
          class="flex-1 px-4 py-3 min-h-[44px] text-sm font-medium transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
          [class.text-[var(--color-primary)]]="currentStep() === 'create'"
          [class.border-b-2]="currentStep() === 'create'"
          [class.border-[var(--color-primary)]]="currentStep() === 'create'"
          [class.text-[var(--color-neutral-600)]]="currentStep() !== 'create'"
        >
          Crear
        </button>
      </div>

      <!-- Search Step -->
      @if (currentStep() === 'search') {
        <div class="space-y-4">
          <app-inputsearch
            placeholder="Buscar por nombre, email o documento..."
            (search)="onSearch($event)"
            [debounceTime]="300"
          ></app-inputsearch>
          <!-- Search Results -->
          @if (searchResults().length > 0) {
            <div class="space-y-2">
              <h3 class="text-sm font-medium text-[var(--color-neutral-600)]">
                Resultados de búsqueda:
              </h3>
              <div class="max-h-48 overflow-y-auto space-y-2">
                @for (customer of searchResults(); track customer.id) {
                  <button
                    type="button"
                    (click)="selectCustomer(customer)"
                    [attr.aria-label]="'Seleccionar ' + displayName(customer)"
                    class="w-full min-h-[44px] p-3 border border-[var(--color-border)] rounded-lg text-left cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)]"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <p class="font-medium text-[var(--color-text-primary)] truncate">
                          {{ displayName(customer) }}
                        </p>
                        <p class="text-sm text-[var(--color-neutral-600)] truncate">
                          {{ customer.email }}
                        </p>
                        @if (documentLine(customer)) {
                          <p class="text-xs text-[var(--color-neutral-600)]">
                            {{ documentLine(customer) }}
                          </p>
                        }
                      </div>
                      <app-icon
                        [name]="customer.person_type === 'JURIDICA' ? 'building' : 'chevron'"
                        [size]="16"
                        color="var(--color-neutral-600)"
                      ></app-icon>
                    </div>
                  </button>
                }
              </div>
            </div>
          }
          <!-- No Results -->
          @if (searchPerformed() && searchResults().length === 0 && !searching()) {
            <div class="text-center py-8">
              <app-icon
                name="user"
                [size]="48"
                color="var(--color-neutral-600)"
                class="mx-auto mb-4"
              ></app-icon>
              <p class="text-[var(--color-neutral-600)] mb-4">
                No se encontraron clientes con esos criterios
              </p>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="switchToCreateMode()"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Crear cliente nuevo
              </app-button>
            </div>
          }
          <!-- Quick Create Option -->
          @if (!searchPerformed() && !lookupPerformed()) {
            <div class="text-center py-4 border-t border-[var(--color-border)]">
              <p class="text-sm text-[var(--color-neutral-600)] mb-2">
                ¿No quieres buscar?
              </p>
              <app-button
                variant="outline"
                size="sm"
                customClasses="min-h-[44px]"
                (clicked)="switchToCreateMode()"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Crear cliente nuevo
              </app-button>
            </div>
          }
          <!-- Búsqueda avanzada: lookup por documento (debajo de crear) -->
          <div class="mb-4 p-4 bg-[var(--color-primary-light)]/30 rounded-lg border border-[var(--color-primary)]/20">
            <label class="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              Búsqueda avanzada
            </label>
            <div class="flex gap-2">
              <div class="flex-1">
                <app-input
                  [ngModel]="lookupQuery()"
                  (ngModelChange)="lookupQuery.set($event)"
                  placeholder="Ingrese cédula o NIT..."
                  type="text"
                  [size]="'md'"
                  (keydown.enter)="onDocumentLookup()"
                ></app-input>
              </div>
              <app-button
                variant="primary"
                size="md"
                (clicked)="onDocumentLookup()"
                [loading]="lookupLoading()"
                [disabled]="!lookupQuery() || lookupQuery().trim().length < 5"
              >
                <app-icon name="search" [size]="16" slot="icon"></app-icon>
                Buscar
              </app-button>
            </div>
            <!-- Lookup Result: Found -->
            @if (lookupPerformed() && lookupResult(); as found) {
              <div class="mt-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="font-medium text-[var(--color-text-primary)] truncate">
                      {{ displayName(found) }}
                    </p>
                    <p class="text-sm text-[var(--color-neutral-600)] truncate">{{ found.email }}</p>
                    @if (documentLine(found)) {
                      <p class="text-xs text-[var(--color-neutral-600)]">{{ documentLine(found) }}</p>
                    }
                  </div>
                  <app-button variant="primary" size="sm" customClasses="min-h-[44px] shrink-0" (clicked)="selectCustomer(found)">
                    Seleccionar
                  </app-button>
                </div>
              </div>
            }
            <!-- Lookup Result: Not Found -->
            @if (lookupPerformed() && !lookupResult() && !lookupLoading()) {
              <div class="mt-3 text-center">
                <p class="text-sm text-[var(--color-neutral-600)] mb-2">
                  No se encontró cliente con este documento
                </p>
                <app-button variant="outline" size="sm" customClasses="min-h-[44px]" (clicked)="onCreateNew()">
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  Crear con este documento
                </app-button>
              </div>
            }
          </div>
        </div>
      }

      <!-- Create Step: puente a la creación completa (app-customer-modal) -->
      @if (currentStep() === 'create') {
        <div class="space-y-4">
          <div class="flex items-center gap-2 mb-4">
            <app-button
              variant="ghost"
              size="sm"
              (clicked)="switchToSearchMode()"
            >
              Volver a buscar
            </app-button>
          </div>
          <div class="text-center py-6">
            <app-icon
              name="user"
              [size]="48"
              color="var(--color-neutral-600)"
              class="mx-auto mb-4"
            ></app-icon>
            <p class="text-[var(--color-text-primary)] font-medium mb-2">
              Creación completa del cliente
            </p>
            <p class="text-sm text-[var(--color-neutral-600)] mb-4 max-w-sm mx-auto">
              Incluye razón social y datos fiscales DIAN (NATURAL/JURIDICA) para poder facturar a este titular.
            </p>
            <app-button
              variant="primary"
              size="md"
              customClasses="min-h-[44px]"
              (clicked)="onCreateNew()"
            >
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Crear cliente nuevo
            </app-button>
          </div>
        </div>
      }

      <div slot="footer">
        <div class="flex items-center justify-end gap-3">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class ChangeTitularSearchModalComponent {
  private customersService = inject(CustomersService);
  private destroyRef = inject(DestroyRef);

  /** Controls modal visibility from the parent. */
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  /** Emitted with the chosen existing customer. Parent PATCHes the titular. */
  readonly selected = output<Customer>();
  /** Emitted when the operator wants the full create flow instead. */
  readonly createNew = output<void>();
  /** Emitted when the operator dismisses the modal. */
  readonly closed = output<void>();

  readonly currentStep = signal<TitularSearchStep>('search');
  readonly searchResults = signal<Customer[]>([]);
  readonly searching = signal(false);
  readonly searchPerformed = signal(false);
  readonly lookupQuery = signal('');
  readonly lookupResult = signal<Customer | null>(null);
  readonly lookupPerformed = signal(false);
  readonly lookupLoading = signal(false);

  readonly modalTitle = computed(() =>
    this.currentStep() === 'search' ? 'Buscar titular' : 'Crear titular',
  );
  readonly modalSubtitle = computed(() =>
    this.currentStep() === 'search'
      ? 'Busca un cliente existente o crea uno nuevo'
      : 'Creación completa con datos fiscales',
  );

  /** RxJS subject for debounced search */
  private readonly search$ = new Subject<string>(); // LEGÍTIMO — debounceTime+switchMap customer search

  constructor() {
    this.search$
      .pipe(
        // Sin debounceTime: app-inputsearch ya debouncea a 300ms.
        distinctUntilChanged(),
        switchMap((term) => {
          const query = term.trim();
          if (query.length < 2) return of([] as Customer[]);
          this.searching.set(true);
          return this.customersService.getCustomers(1, 8, { search: query }).pipe(
            map((res: unknown) => {
              const envelope = res as { data?: unknown };
              const raw = (envelope?.data as { data?: unknown } | undefined)?.data ?? envelope?.data ?? res;
              const list = Array.isArray(raw) ? raw : [];
              return list as Customer[];
            }),
            catchError(() => of([] as Customer[])),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((customers) => {
        this.searchResults.set(customers);
        this.searching.set(false);
        this.searchPerformed.set(true);
      });
  }

  switchToSearchMode(): void {
    this.currentStep.set('search');
  }

  switchToCreateMode(): void {
    this.currentStep.set('create');
  }

  onSearch(term: string): void {
    if (term.trim().length < 2) {
      this.searchResults.set([]);
      this.searching.set(false);
      this.searchPerformed.set(false);
      return;
    }
    this.search$.next(term);
  }

  onDocumentLookup(): void {
    const doc = this.lookupQuery().trim();
    if (doc.length < 5 || this.lookupLoading()) return;
    this.lookupLoading.set(true);
    this.customersService
      .lookupByDocument(doc)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (customer) => {
          this.lookupResult.set(customer);
          this.lookupPerformed.set(true);
          this.lookupLoading.set(false);
        },
        error: () => {
          this.lookupResult.set(null);
          this.lookupPerformed.set(true);
          this.lookupLoading.set(false);
        },
      });
  }

  selectCustomer(customer: Customer): void {
    this.selected.emit(customer);
  }

  onCreateNew(): void {
    this.reset();
    this.createNew.emit();
  }

  onClose(): void {
    this.reset();
    this.isOpenChange.emit(false);
    this.closed.emit();
  }

  /** Plain methods (not computed): read the row fresh on each CD run. */
  displayName(customer: Customer): string {
    if (customer.person_type === 'JURIDICA' && customer.legal_name?.trim()) {
      return customer.legal_name.trim();
    }
    const full = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
    return full || customer.legal_name?.trim() || customer.email || 'Sin nombre';
  }

  documentLine(customer: Customer): string {
    const doc = [customer.document_type, customer.document_number]
      .filter((part) => !!part?.trim())
      .join(' ');
    return doc.trim();
  }

  private reset(): void {
    this.currentStep.set('search');
    this.searchResults.set([]);
    this.searching.set(false);
    this.searchPerformed.set(false);
    this.lookupQuery.set('');
    this.lookupResult.set(null);
    this.lookupPerformed.set(false);
    this.lookupLoading.set(false);
  }
}
