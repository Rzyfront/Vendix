import {
  Component,
  DestroyRef,
  signal,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components';
import { PosCustomerService } from '../../../pos/services/pos-customer.service';
import { DispatchNoteWizardService, WizardCustomer } from '../../services/dispatch-note-wizard.service';

@Component({
  selector: 'app-dispatch-wizard-customer-step',
  standalone: true,
  imports: [
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <div class="space-y-2">
      <!-- Selected customer card -->
      @if (wizardService.customer(); as customer) {
        <div
          class="relative border-2 border-[var(--color-success)] rounded-lg p-3 bg-[var(--color-success)]/5"
        >
          <!-- Check badge -->
          <div
            class="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[var(--color-success)] flex items-center justify-center"
          >
            <app-icon name="check" [size]="12" color="white"></app-icon>
          </div>

          <div class="flex items-center gap-2.5">
            <!-- Avatar -->
            <div
              class="w-10 h-10 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center shrink-0"
            >
              <app-icon
                name="user"
                [size]="20"
                color="var(--color-primary)"
              ></app-icon>
            </div>

            <!-- Info -->
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-sm text-[var(--color-text-primary)] truncate">
                {{ customer.first_name }} {{ customer.last_name }}
              </p>
              <div class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                @if (customer.phone) {
                  <span class="flex items-center gap-1">
                    <app-icon name="phone" [size]="11" color="var(--color-text-muted)"></app-icon>
                    {{ customer.phone }}
                  </span>
                }
                @if (customer.document_number) {
                  <span>Doc: {{ customer.document_number }}</span>
                }
              </div>
              @if (customer.email) {
                <p class="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                  {{ customer.email }}
                </p>
              }
            </div>

            <!-- Change button -->
            <app-button
              variant="outline"
              size="sm"
              (clicked)="onChangeCustomer()"
            >
              Cambiar
            </app-button>
          </div>
        </div>
      } @else {
        <!-- Search input -->
        <app-inputsearch
          placeholder="Buscar por nombre, email o documento..."
          [debounceTime]="300"
          (search)="onSearch($event)"
        ></app-inputsearch>

        <!-- Loading state -->
        @if (loading()) {
          <div class="flex items-center gap-2 py-2 px-1">
            <div
              class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
            ></div>
            <span class="text-sm text-[var(--color-text-secondary)]">
              Buscando clientes...
            </span>
          </div>
        }

        <!-- Search results -->
        @if (!loading() && searchResults().length > 0) {
          <div class="space-y-1.5">
            <p class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Resultados
            </p>
            <div class="space-y-1.5 max-h-52 overflow-y-auto">
              @for (result of searchResults(); track result.id) {
                <button
                  type="button"
                  class="w-full text-left p-2.5 border border-[var(--color-border)] rounded-lg
                         hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]
                         transition-colors duration-150 focus:outline-none focus:ring-2
                         focus:ring-[var(--color-ring)] min-h-[44px]"
                  (click)="selectCustomer(result)"
                >
                  <div class="flex items-center gap-2.5">
                    <div
                      class="w-8 h-8 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center shrink-0"
                    >
                      <app-icon
                        name="user"
                        [size]="15"
                        color="var(--color-text-secondary)"
                      ></app-icon>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                        {{ result.first_name }} {{ result.last_name }}
                      </p>
                      <div class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                        @if (result.email) {
                          <span class="truncate">{{ result.email }}</span>
                        }
                        @if (result.document_number) {
                          <span>Doc: {{ result.document_number }}</span>
                        }
                      </div>
                    </div>
                    <app-icon
                      name="chevron-right"
                      [size]="14"
                      color="var(--color-text-muted)"
                    ></app-icon>
                  </div>
                </button>
              }
            </div>
          </div>
        }

        <!-- No results -->
        @if (!loading() && searchPerformed() && searchResults().length === 0) {
          <div class="flex items-center gap-2 py-3 px-1 text-[var(--color-text-muted)]">
            <app-icon name="user-x" [size]="20" color="var(--color-text-muted)"></app-icon>
            <div>
              <p class="text-sm text-[var(--color-text-secondary)]">
                No se encontraron clientes
              </p>
              <p class="text-xs">Intenta con otro termino de busqueda</p>
            </div>
          </div>
        }

        <!-- Hint when no search yet -->
        @if (!loading() && !searchPerformed() && searchResults().length === 0) {
          <div class="flex items-center gap-2 py-3 px-1 text-[var(--color-text-muted)]">
            <app-icon name="search" [size]="18" color="var(--color-text-muted)"></app-icon>
            <p class="text-sm">
              Escribe para buscar un cliente existente
            </p>
          </div>
        }
      }
    </div>
  `,
})
export class CustomerStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);

  private readonly customerService = inject(PosCustomerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchResults = signal<WizardCustomer[]>([]);
  readonly loading = signal(false);
  readonly searchPerformed = signal(false);

  onSearch(query: string): void {
    if (!query || !query.trim()) {
      this.searchResults.set([]);
      this.searchPerformed.set(false);
      return;
    }

    this.loading.set(true);
    this.customerService
      .searchCustomers({ query: query.trim(), limit: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const mapped: WizardCustomer[] = (response.data || []).map((c: any) => ({
            id: c.id,
            first_name: c.first_name,
            last_name: c.last_name,
            phone: c.phone,
            email: c.email,
            document_number: c.document_number,
          }));
          this.searchResults.set(mapped);
          this.searchPerformed.set(true);
          this.loading.set(false);
        },
        error: () => {
          this.searchResults.set([]);
          this.searchPerformed.set(true);
          this.loading.set(false);
        },
      });
  }

  selectCustomer(customer: WizardCustomer): void {
    this.wizardService.setCustomer(customer);
    this.searchResults.set([]);
    this.searchPerformed.set(false);
  }

  onChangeCustomer(): void {
    this.wizardService.clearCustomer();
    this.searchResults.set([]);
    this.searchPerformed.set(false);
  }
}
