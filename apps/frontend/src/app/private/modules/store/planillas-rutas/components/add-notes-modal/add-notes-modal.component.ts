import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DispatchDeliveryAddress } from '../../interfaces/planilla.interface';

/**
 * Elegible dispatch note surfaced in the picker. Mirrors the shape returned by
 * `GET /store/dispatch-routes/available-notes` (same subset the wizard's step-2
 * consumes). Address fields are optional because the endpoint may not include
 * the snapshot on every deploy — when absent the row shows no address line.
 */
interface AvailableNote {
  id: number;
  dispatch_number: string;
  customer_name?: string;
  grand_total: string | number;
  status: string;
  customer_address?: DispatchDeliveryAddress | null;
  shipping_address_snapshot?: DispatchDeliveryAddress | null;
}

/**
 * "Agregar remisiones" modal for the planilla detail page. Lets the operator
 * attach MULTIPLE eligible dispatch notes to an existing route (draft /
 * dispatched) in a SINGLE `POST /:id/stops` call. Mirrors the pick/remove UX of
 * the wizard's step 2 (search + available list + selected list) but scoped to
 * appending stops to a live route. On success it emits `added` so the parent can
 * reload the route detail and surface the new paradas.
 */
@Component({
  selector: 'app-add-notes-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, IconComponent, InputsearchComponent, CurrencyPipe],
  template: `
    <app-modal
      [isOpen]="true"
      title="Agregar remisiones"
      subtitle="Adjunta remisiones elegibles a esta planilla"
      size="lg"
      (cancel)="close.emit()"
    >
      <div class="space-y-4">
        <!-- Buscador de remisiones disponibles -->
        <app-inputsearch
          placeholder="Buscar remisión por número o cliente..."
          [debounceTime]="250"
          (searchChange)="noteSearch.set($event)"
        ></app-inputsearch>

        <!-- Remisiones disponibles -->
        <div>
          <h3 class="text-sm font-semibold mb-2">
            Remisiones disponibles
            <span class="text-xs font-normal text-[var(--color-text-secondary)]">
              ({{ availableForPicking().length }})
            </span>
          </h3>
          <div
            class="max-h-56 overflow-y-auto space-y-2 rounded-md border border-border p-2 bg-[var(--color-surface)]"
          >
            @if (loadingNotes()) {
              <div class="text-sm text-[var(--color-text-secondary)] text-center py-4">
                Cargando remisiones...
              </div>
            } @else {
              @for (note of availableForPicking(); track note.id) {
                <div class="flex items-center gap-2 p-2 rounded-md border border-border">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">
                      {{ note.dispatch_number }}
                      <span class="text-[var(--color-text-secondary)]"
                        >· {{ note.customer_name || 'Sin cliente' }}</span
                      >
                    </p>
                    <p class="text-xs text-[var(--color-text-secondary)]">
                      {{ +note.grand_total | currency }}
                    </p>
                    <!-- Dirección de entrega (📍) o aviso de remisión no despachable -->
                    @if (noteHasAddress(note)) {
                      <p
                        class="mt-0.5 text-xs text-[var(--color-text-secondary)] flex items-center gap-1 truncate"
                      >
                        <app-icon name="map-pin" [size]="12" class="shrink-0" />
                        <span class="truncate">{{ noteAddressText(note) }}</span>
                      </p>
                    } @else if (noteAddressKnown(note)) {
                      <p class="mt-0.5 text-xs text-amber-700 flex items-center gap-1">
                        <app-icon name="alert-triangle" [size]="12" class="shrink-0" />
                        <span>Sin dirección — no podrá despacharse</span>
                      </p>
                    }
                  </div>
                  <button
                    type="button"
                    (click)="addNote(note.id)"
                    class="shrink-0 inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] rounded-md bg-secondary text-secondary-foreground px-3 text-sm"
                    aria-label="Agregar remisión"
                  >
                    <app-icon name="plus" [size]="16" />
                    <span class="hidden sm:inline">Agregar</span>
                  </button>
                </div>
              } @empty {
                <div class="text-sm text-[var(--color-text-secondary)] text-center py-4">
                  @if (noteSearch()) {
                    No hay remisiones que coincidan con la búsqueda.
                  } @else {
                    No hay remisiones disponibles para agregar.
                  }
                </div>
              }
            }
          </div>
        </div>

        <!-- Remisiones seleccionadas -->
        <div>
          <h3 class="text-sm font-semibold mb-2">
            Remisiones seleccionadas
            <span class="text-xs font-normal text-[var(--color-text-secondary)]">
              ({{ selectedNotes().length }})
            </span>
          </h3>
          <div class="space-y-2">
            @for (note of selectedNotes(); track note.id) {
              <div
                class="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium truncate">
                    {{ note.dispatch_number }}
                    <span class="text-[var(--color-text-secondary)]"
                      >· {{ note.customer_name || 'Sin cliente' }}</span
                    >
                  </p>
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    {{ +note.grand_total | currency }}
                  </p>
                </div>
                <button
                  type="button"
                  (click)="removeNote(note.id)"
                  class="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-[var(--color-destructive)]"
                  aria-label="Quitar remisión"
                >
                  <app-icon name="trash-2" [size]="18" />
                </button>
              </div>
            } @empty {
              <div class="text-sm text-[var(--color-text-secondary)] text-center py-4">
                Agrega al menos una remisión desde la lista superior.
              </div>
            }
          </div>
        </div>

        <!-- Total a recaudar -->
        <div class="flex items-center justify-between border-t border-border pt-3">
          <span class="text-sm font-medium">Total a recaudar</span>
          <span class="text-base font-semibold">{{ selectedTotal() | currency }}</span>
        </div>
      </div>

      <div slot="footer" class="flex gap-2 w-full">
        <button
          type="button"
          (click)="close.emit()"
          class="flex-1 rounded-md border border-border bg-[var(--color-surface)] px-4 py-2 text-sm min-h-[44px]"
        >
          Cancelar
        </button>
        <button
          type="button"
          (click)="confirm()"
          [disabled]="submitting() || selectedNotes().length === 0"
          class="flex-1 rounded-md bg-primary-600 text-white px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50"
        >
          {{ submitting() ? 'Agregando...' : addLabel() }}
        </button>
      </div>
    </app-modal>
  `,
})
export class AddNotesModalComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Route to which the picked remisiones will be appended. */
  readonly routeId = input.required<number>();

  readonly close = output<void>();
  /** Emitted after the stops are appended so the parent can reload the route. */
  readonly added = output<void>();

  readonly noteSearch = signal('');
  readonly availableNotes = signal<AvailableNote[]>([]);
  readonly loadingNotes = signal(false);
  readonly submitting = signal(false);

  /** Ids of the notes the operator has picked, in selection order. */
  private readonly selectedIds = signal<number[]>([]);

  constructor() {
    this.loadAvailableNotes();
  }

  /** Set of picked ids for quick membership checks in the picking list. */
  private readonly selectedIdSet = computed<Set<number>>(
    () => new Set(this.selectedIds()),
  );

  /**
   * Eligible notes the operator can still add: those not already picked and
   * matching the search term (dispatch number or customer name).
   */
  readonly availableForPicking = computed<AvailableNote[]>(() => {
    const selected = this.selectedIdSet();
    const term = this.noteSearch().trim().toLowerCase();
    return this.availableNotes().filter((note) => {
      if (selected.has(note.id)) return false;
      if (!term) return true;
      const haystack = `${note.dispatch_number} ${note.customer_name ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  /** Picked notes, resolved from `availableNotes`, preserving selection order. */
  readonly selectedNotes = computed<AvailableNote[]>(() => {
    const byId = new Map(this.availableNotes().map((n) => [n.id, n]));
    return this.selectedIds()
      .map((id) => byId.get(id))
      .filter((n): n is AvailableNote => !!n);
  });

  /** Sum of grand_total across the picked notes (preview of route total). */
  readonly selectedTotal = computed<number>(() =>
    this.selectedNotes().reduce((sum, n) => sum + Number(n.grand_total || 0), 0),
  );

  /** Confirm button label reflecting how many remisiones will be attached. */
  readonly addLabel = computed<string>(() => {
    const n = this.selectedNotes().length;
    if (n === 0) return 'Agregar';
    return n === 1 ? 'Agregar 1 remisión' : `Agregar ${n} remisiones`;
  });

  private loadAvailableNotes(): void {
    this.loadingNotes.set(true);
    this.service
      .listAvailableDispatchNotes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.availableNotes.set((res?.data ?? []) as AvailableNote[]);
          this.loadingNotes.set(false);
        },
        error: (e) => {
          this.loadingNotes.set(false);
          this.toast.error(e?.message || 'No se pudieron cargar las remisiones');
        },
      });
  }

  addNote(noteId: number): void {
    if (!noteId || noteId <= 0) return;
    this.selectedIds.update((ids) =>
      ids.includes(noteId) ? ids : [...ids, noteId],
    );
  }

  removeNote(noteId: number): void {
    this.selectedIds.update((ids) => ids.filter((id) => id !== noteId));
  }

  /**
   * Resolves the delivery address of a candidate note: its own snapshot first,
   * then the linked order's `shipping_address_snapshot`. Returns null if neither.
   */
  private resolveNoteAddress(note: AvailableNote): DispatchDeliveryAddress | null {
    return note.customer_address ?? note.shipping_address_snapshot ?? null;
  }

  /**
   * A note has a usable address when its blob carries a non-empty
   * `address_line1` (tolerating legacy `line1`/`address` aliases). Mirrors the
   * backend gate that blocks dispatch without an address.
   */
  noteHasAddress(note: AvailableNote): boolean {
    const a = this.resolveNoteAddress(note);
    if (!a) return false;
    const line1 = a.address_line1 ?? a.line1 ?? a.address;
    return typeof line1 === 'string' && line1.trim().length > 0;
  }

  /** Delivery address on a single line: `address_line1, city, state`. */
  noteAddressText(note: AvailableNote): string {
    const a = this.resolveNoteAddress(note);
    if (!a) return '';
    const parts = [a.address_line1 ?? a.line1 ?? a.address, a.city, a.state_province]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    return parts.join(', ');
  }

  /**
   * Whether the candidate payload carries address information (keys exist, even
   * if null). When the endpoint omits the snapshot we avoid a false "sin
   * dirección" and simply hide both the address and the warning.
   */
  noteAddressKnown(note: AvailableNote): boolean {
    return (
      note.customer_address !== undefined ||
      note.shipping_address_snapshot !== undefined
    );
  }

  confirm(): void {
    const ids = this.selectedIds();
    if (ids.length === 0 || this.submitting()) return;
    this.submitting.set(true);
    this.service
      .addStops(this.routeId(), {
        stops: ids.map((id) => ({ dispatch_note_id: id })),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.added.emit();
        },
        error: (e) => {
          this.submitting.set(false);
          this.toast.error(e?.message || 'No se pudieron agregar las remisiones');
        },
      });
  }
}
