import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  SpinnerComponent,
  TextareaComponent,
  ToastService,
} from '../../../../shared/components';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { PlatformCrmService } from './platform-crm.service';
import {
  PlatformAccountSearchResult,
  PlatformCrmLinkTarget,
  PlatformCrmLinkView,
  PlatformOrganizationSearchItem,
  PlatformStoreSearchItem,
  organizationStateLabel,
  subscriptionStateLabel,
} from './platform-crm.interface';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
/** Tope del backend (`SearchPlatformAccountsQueryDto.q`). */
const MAX_QUERY = 100;
const NO_RESULTS: PlatformAccountSearchResult = { organizations: [], stores: [] };

/** Lo que el comercial elige: la organización entera o una tienda concreta. */
type LinkCandidate =
  | { kind: 'organization'; item: PlatformOrganizationSearchItem }
  | { kind: 'store'; item: PlatformStoreSearchItem };

/**
 * Modal "Enlazar con cuenta Vendix": busca la organización cliente (nombre,
 * slug o NIT) o una de sus tiendas (nombre o slug), elige una y confirma.
 *
 * El campo es `app-inputsearch`, el buscador del repo: su debounce emite
 * `searchChange` con el texto final. El cuerpo vive dentro de
 * `@if (isOpen())` para que cada apertura cree el campo vacío (el contenido
 * proyectado en `app-modal` sobrevive al cierre).
 */
@Component({
  selector: 'app-vendix-account-link-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
    SpinnerComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Enlazar con cuenta Vendix"
      subtitle="Busca la organización o la tienda que este cliente creó y paga. No se fusionan cuentas."
      size="md"
    >
      @if (isOpen()) {
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-text-primary">Organización o tienda</span>
            <app-inputsearch
              ariaLabel="Buscar organización o tienda"
              placeholder="Nombre, slug o NIT de la organización, o nombre de la tienda"
              [debounceTime]="searchDebounceMs"
              (searchChange)="onQuery($event)"
            ></app-inputsearch>
          </div>

          @if (searching()) {
            <div class="flex justify-center py-3"><app-spinner size="sm"></app-spinner></div>
          } @else if (term().length >= minQuery) {
            @if (results().organizations.length || results().stores.length) {
              <div class="flex max-h-72 flex-col gap-3 overflow-y-auto">
                @if (results().organizations.length) {
                  <ul class="flex flex-col gap-2" role="listbox" aria-label="Organizaciones">
                    @for (org of results().organizations; track org.id) {
                      <li>
                        <button
                          type="button"
                          role="option"
                          [attr.aria-selected]="isSelected('organization', org.id)"
                          [class]="optionClass(isSelected('organization', org.id))"
                          (click)="selected.set({ kind: 'organization', item: org })"
                        >
                          <span class="min-w-0">
                            <span class="block text-xs font-medium text-text-secondary">Organización</span>
                            <span class="block truncate font-semibold text-text-primary">{{ org.name }}</span>
                            <span class="block truncate text-xs text-text-secondary">
                              {{ org.slug }} · {{ organizationState(org.state) }}
                            </span>
                          </span>
                          @if (isSelected('organization', org.id)) {
                            <app-icon name="check" [size]="16"></app-icon>
                          }
                        </button>
                      </li>
                    }
                  </ul>
                }
                @if (results().stores.length) {
                  <ul class="flex flex-col gap-2" role="listbox" aria-label="Tiendas">
                    @for (store of results().stores; track store.id) {
                      <li>
                        <button
                          type="button"
                          role="option"
                          [attr.aria-selected]="isSelected('store', store.id)"
                          [class]="optionClass(isSelected('store', store.id))"
                          (click)="selected.set({ kind: 'store', item: store })"
                        >
                          <span class="min-w-0">
                            <span class="block truncate text-xs font-medium text-text-secondary">
                              Tienda · {{ store.organization.name }}
                            </span>
                            <span class="block truncate font-semibold text-text-primary">{{ store.name }}</span>
                            <span class="block truncate text-xs text-text-secondary">{{ storePlan(store) }}</span>
                          </span>
                          @if (isSelected('store', store.id)) {
                            <app-icon name="check" [size]="16"></app-icon>
                          }
                        </button>
                      </li>
                    }
                  </ul>
                }
              </div>
            } @else {
              <p class="py-3 text-center text-sm text-text-secondary">
                Ninguna organización ni tienda coincide.
              </p>
            }
          } @else {
            <p class="text-sm text-text-secondary">Escribe al menos {{ minQuery }} caracteres.</p>
          }

          <app-textarea
            label="Nota (opcional)"
            placeholder="Ej.: Cerró con el plan anual"
            [rows]="2"
            [ngModel]="note()"
            (ngModelChange)="note.set($event)"
          ></app-textarea>
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button
          variant="primary"
          size="md"
          [disabled]="!canSubmit()"
          [loading]="saving()"
          (clicked)="submit()"
        >
          Enlazar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class VendixAccountLinkModalComponent {
  private readonly service = inject(PlatformCrmService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model(false);
  readonly customerId = input.required<number>();
  readonly linked = output<PlatformCrmLinkView>();

  protected readonly minQuery = MIN_QUERY;
  protected readonly searchDebounceMs = SEARCH_DEBOUNCE_MS;
  /** Último término que emitió el buscador, recortado. */
  protected readonly term = signal('');
  protected readonly note = signal('');
  protected readonly results = signal<PlatformAccountSearchResult>(NO_RESULTS);
  protected readonly selected = signal<LinkCandidate | null>(null);
  protected readonly searching = signal(false);
  protected readonly saving = signal(false);
  protected readonly canSubmit = computed(
    () => !!this.selected() && !this.saving() && this.note().length <= 300,
  );

  /** Solo la respuesta de la última búsqueda pinta resultados. */
  private searchSeq = 0;

  constructor() {
    // Cada apertura empieza limpia; una respuesta en vuelo ya no pinta nada.
    effect(() => {
      if (!this.isOpen()) return;
      untracked(() => {
        this.searchSeq++;
        this.term.set('');
        this.note.set('');
        this.results.set(NO_RESULTS);
        this.selected.set(null);
        this.searching.set(false);
      });
    });
  }

  /** `searchChange` de `app-inputsearch`: ya llega con el debounce aplicado. */
  protected onQuery(value: string): void {
    const term = (value ?? '').trim().slice(0, MAX_QUERY);
    const seq = ++this.searchSeq;
    this.term.set(term);
    this.selected.set(null);
    if (term.length < MIN_QUERY) {
      this.results.set(NO_RESULTS);
      this.searching.set(false);
      return;
    }
    void this.search(term, seq);
  }

  private async search(term: string, seq: number): Promise<void> {
    this.searching.set(true);
    try {
      const results = await firstValueFrom(this.service.searchAccounts(term));
      if (seq === this.searchSeq) this.results.set(results);
    } catch (error) {
      if (seq === this.searchSeq) {
        this.results.set(NO_RESULTS);
        this.toast.error(parseApiError(error).userMessage);
      }
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const candidate = this.selected();
    if (!candidate || this.saving()) return;
    this.saving.set(true);
    try {
      const note = this.note().trim();
      const target: PlatformCrmLinkTarget =
        candidate.kind === 'store'
          ? { linked_store_id: candidate.item.id }
          : { organization_id: candidate.item.id };
      const view = await firstValueFrom(
        this.service.link(this.customerId(), { ...target, ...(note ? { note } : {}) }),
      );
      const label =
        candidate.kind === 'store'
          ? `la tienda ${candidate.item.name} (${candidate.item.organization.name})`
          : candidate.item.name;
      this.toast.success(`Enlazado con ${label}`);
      this.linked.emit(view);
      this.isOpen.set(false);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  protected isSelected(kind: LinkCandidate['kind'], id: number): boolean {
    const current = this.selected();
    return current?.kind === kind && current.item.id === id;
  }

  protected organizationState(state: string): string {
    return organizationStateLabel(state);
  }

  protected storePlan(store: PlatformStoreSearchItem): string {
    const plan = store.plan_name || 'Sin plan';
    const state = subscriptionStateLabel(store.subscription_state);
    return state ? `${plan} · ${state}` : plan;
  }

  protected optionClass(selected: boolean): string {
    const base =
      'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors';
    return selected ? `${base} border-primary bg-primary/10` : `${base} border-border bg-surface`;
  }
}
