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
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  InputButtonsComponent,
  InputButtonOption,
} from '../../../../../../shared/components/input-buttons/input-buttons.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OrdersService } from '../../../orders/services/orders.service';
import { Order } from '../../../orders/interfaces/order.interface';
import {
  DispatchNotesService,
  CreateFromOrdersBatchDto,
  CreateFromOrdersBatchResultItem,
} from '../../../dispatch-notes/services/dispatch-notes.service';
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
 * attach dispatch notes to an EXISTING route (draft / dispatched) via
 * `addStops`. Two modes (switch A/B — Plan Despacho Economía FASE 7, pasos 10 y
 * 13; espeja el wizard commit 94da65509):
 *
 *  - Modo A (`notes`)  : multi-select de remisiones YA existentes → addStops.
 *  - Modo B (`orders`) : crea remisiones al vuelo desde órdenes despachables
 *    (`createFromOrdersBatch`, target_status='draft') y luego agrega las
 *    creadas como paradas vía `addStops`.
 *
 * `routeId` llega por `input.required` desde el detalle de ruta. El estado
 * editable NO se recibe como input: el padre solo abre este modal cuando
 * `canAddNotes()` (status draft/dispatched) es verdadero, así que un modal
 * abierto YA implica una ruta editable. El backend `addStops` reafirma el gate
 * (`DSP_ROUTE_NOT_EDITABLE_001`) como última defensa.
 *
 * On success (ambos modos) emite `added` para que el padre recargue la ruta.
 */
@Component({
  selector: 'app-add-notes-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ModalComponent,
    IconComponent,
    InputsearchComponent,
    CurrencyPipe,
    ButtonComponent,
    InputButtonsComponent,
    EmptyStateComponent,
    BadgeComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      title="Agregar remisiones"
      subtitle="Adjunta remisiones elegibles a esta planilla"
      size="lg"
      (cancel)="close.emit()"
    >
      <div class="space-y-4">
        <!-- ================================================================ -->
        <!-- Switch A/B (paso 13). Solo se ofrece cuando el usuario puede      -->
        <!-- crear remisiones desde órdenes (doble permiso). Sin permiso se    -->
        <!-- oculta por completo el Modo B y el modal queda en el flujo A.     -->
        <!-- La ruta ya es editable por construcción (ver doc de la clase).    -->
        <!-- ================================================================ -->
        @if (canCreateFromOrders()) {
          <app-input-buttons
            label="¿Qué quieres agregar a la ruta?"
            [options]="modeOptions()"
            [equalWidth]="true"
            [ngModel]="mode()"
            [ngModelOptions]="{ standalone: true }"
            (valueChange)="setMode($event)"
          ></app-input-buttons>
        }

        @if (mode() === 'notes') {
        <!-- ======================= MODO A: remisiones ======================= -->
        <!-- Tarjeta-resumen / total (compacta, superficie suave) -->
        <div
          class="flex items-center justify-between gap-3 rounded-lg p-3"
          style="background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));"
        >
          <p class="text-sm text-[var(--color-text-secondary)]">
            <strong class="text-[var(--color-text-primary)]">{{
              availableForPicking().length
            }}</strong>
            disponibles ·
            <strong class="text-[var(--color-text-primary)]">{{
              selectedNotes().length
            }}</strong>
            seleccionadas
          </p>
          <div class="text-right shrink-0">
            <p class="text-xs text-[var(--color-text-muted)]">
              Total a recaudar
            </p>
            <p
              class="text-base font-semibold tabular-nums text-[var(--color-text-primary)]"
            >
              {{ selectedTotal() | currency }}
            </p>
          </div>
        </div>

        <!-- Buscador de remisiones disponibles -->
        <app-inputsearch
          placeholder="Buscar remisión por número o cliente..."
          [debounceTime]="250"
          (searchChange)="noteSearch.set($event)"
        ></app-inputsearch>

        <!-- Remisiones disponibles -->
        <div>
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-2"
          >
            Disponibles ({{ availableForPicking().length }})
          </h3>
          <div
            class="max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 space-y-1"
          >
            <!-- 3 estados excluyentes: cargando / error / (lista|vacío) -->
            @if (loadingNotes()) {
              <p class="text-center py-4 text-[var(--color-text-muted)]">
                Cargando remisiones...
              </p>
            } @else if (notesError()) {
              <app-empty-state
                size="sm"
                icon="alert-triangle"
                iconColor="error"
                title="Error al cargar"
                [description]="notesError()!"
                [showActionButton]="false"
                [showRefreshButton]="true"
                (refreshClick)="loadAvailableNotes()"
              ></app-empty-state>
            } @else {
              @for (note of availableForPicking(); track note.id) {
                <button
                  type="button"
                  (click)="addNote(note.id)"
                  class="w-full text-left flex items-center gap-3 p-2 rounded-md hover:bg-[var(--color-primary-light)] transition-colors min-h-[44px]"
                >
                  <div class="flex-1 min-w-0">
                    <p
                      class="text-sm font-medium text-[var(--color-text-primary)] truncate"
                    >
                      {{ note.dispatch_number }}
                      <span class="text-[var(--color-text-secondary)]"
                        >· {{ note.customer_name || 'Sin cliente' }}</span
                      >
                    </p>
                    <!-- Dirección de entrega o aviso de remisión no despachable -->
                    @if (noteHasAddress(note)) {
                      <p
                        class="mt-0.5 text-xs text-[var(--color-text-muted)] flex items-center gap-1 truncate"
                      >
                        <app-icon name="map-pin" [size]="12" class="shrink-0" />
                        <span class="truncate">{{ noteAddressText(note) }}</span>
                      </p>
                    } @else if (noteAddressKnown(note)) {
                      <div class="mt-1">
                        <app-badge variant="warning" size="xs"
                          >Sin dirección</app-badge
                        >
                      </div>
                    }
                  </div>
                  <span
                    class="text-sm font-semibold tabular-nums text-[var(--color-text-primary)] shrink-0"
                    >{{ +note.grand_total | currency }}</span
                  >
                  <app-icon
                    name="plus"
                    [size]="18"
                    class="shrink-0 text-[var(--color-primary)]"
                  />
                </button>
              } @empty {
                <app-empty-state
                  size="sm"
                  icon="package"
                  title="Sin remisiones"
                  [description]="
                    noteSearch()
                      ? 'No hay coincidencias.'
                      : 'No hay remisiones disponibles.'
                  "
                  [showActionButton]="false"
                ></app-empty-state>
              }
            }
          </div>
        </div>

        <!-- Remisiones seleccionadas -->
        <div>
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-2"
          >
            Seleccionadas ({{ selectedNotes().length }})
          </h3>
          <div class="space-y-1.5">
            @for (note of selectedNotes(); track note.id) {
              <div
                class="flex items-center gap-3 p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <div class="flex-1 min-w-0">
                  <p
                    class="text-sm font-medium text-[var(--color-text-primary)] truncate"
                  >
                    {{ note.dispatch_number }}
                    <span class="text-[var(--color-text-secondary)]"
                      >· {{ note.customer_name || 'Sin cliente' }}</span
                    >
                  </p>
                </div>
                <span
                  class="text-sm font-semibold tabular-nums text-[var(--color-text-primary)] shrink-0"
                  >{{ +note.grand_total | currency }}</span
                >
                <button
                  type="button"
                  (click)="removeNote(note.id)"
                  class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] min-h-[40px] min-w-[40px] shrink-0"
                  aria-label="Quitar remisión"
                >
                  <app-icon name="trash-2" [size]="18" />
                </button>
              </div>
            } @empty {
              <app-empty-state
                size="sm"
                icon="map-pin"
                title="Nada seleccionado"
                description="Agrega remisiones desde la lista de arriba."
                [showActionButton]="false"
              ></app-empty-state>
            }
          </div>
        </div>
        } @else {
        <!-- ======================= MODO B: órdenes ======================= -->
        <!-- Resumen de selección de órdenes despachables. -->
        <div
          class="flex items-center justify-between gap-3 rounded-lg p-3"
          style="background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));"
        >
          <p class="text-sm text-[var(--color-text-secondary)]">
            <strong class="text-[var(--color-text-primary)]">{{
              availableOrdersForPicking().length
            }}</strong>
            disponibles ·
            <strong class="text-[var(--color-text-primary)]">{{
              selectedOrderIds().length
            }}</strong>
            seleccionadas
          </p>
          <div class="text-right shrink-0">
            <p class="text-xs text-[var(--color-text-muted)]">
              Total a recaudar
            </p>
            <p
              class="text-base font-semibold tabular-nums text-[var(--color-text-primary)]"
            >
              {{ selectedOrdersTotal() | currency }}
            </p>
          </div>
        </div>

        <!-- Buscador de órdenes despachables -->
        <app-inputsearch
          placeholder="Buscar orden por número o cliente..."
          [debounceTime]="250"
          (searchChange)="orderSearch.set($event)"
        ></app-inputsearch>

        <!-- Órdenes despachables -->
        <div>
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-2"
          >
            Órdenes despachables ({{ availableOrdersForPicking().length }})
          </h3>
          <div
            class="max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 space-y-1"
          >
            <!-- 3 estados excluyentes: cargando / error / (lista|vacío) -->
            @if (ordersLoading()) {
              <div
                class="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]"
              >
                <div
                  class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
                ></div>
                Cargando órdenes...
              </div>
            } @else if (ordersError()) {
              <app-empty-state
                size="sm"
                icon="alert-triangle"
                iconColor="error"
                title="Error al cargar"
                [description]="ordersError()!"
                [showActionButton]="false"
                [showRefreshButton]="true"
                (refreshClick)="loadDispatchableOrders()"
              ></app-empty-state>
            } @else {
              @for (order of availableOrdersForPicking(); track order.id) {
                <button
                  type="button"
                  (click)="toggleOrder(order.id)"
                  class="w-full text-left flex items-center gap-3 p-2 rounded-md hover:bg-[var(--color-primary-light)] transition-colors min-h-[44px]"
                  [style.background]="
                    isOrderSelected(order.id)
                      ? 'var(--color-primary-light)'
                      : ''
                  "
                >
                  <span
                    class="shrink-0 flex items-center"
                    [style.color]="
                      isOrderSelected(order.id)
                        ? 'var(--color-primary)'
                        : 'var(--color-text-muted)'
                    "
                  >
                    <app-icon
                      [name]="
                        isOrderSelected(order.id) ? 'check-circle' : 'circle'
                      "
                      [size]="18"
                    />
                  </span>
                  <div class="flex-1 min-w-0">
                    <p
                      class="text-sm font-medium text-[var(--color-text-primary)] truncate"
                    >
                      {{ order.order_number }}
                      <span class="text-[var(--color-text-secondary)]"
                        >· {{ orderCustomerName(order) }}</span
                      >
                    </p>
                  </div>
                  <span
                    class="text-sm font-semibold tabular-nums text-[var(--color-text-primary)] shrink-0"
                    >{{ +order.grand_total | currency }}</span
                  >
                </button>
              } @empty {
                <app-empty-state
                  size="sm"
                  icon="shopping-cart"
                  title="Sin órdenes"
                  [description]="
                    orderSearch()
                      ? 'No hay coincidencias.'
                      : 'No hay órdenes despachables.'
                  "
                  [showActionButton]="false"
                ></app-empty-state>
              }
            }
          </div>
          <p class="mt-2 text-xs text-[var(--color-text-muted)]">
            Se crearán las remisiones (en borrador) de las órdenes seleccionadas
            y se agregarán como paradas de esta ruta.
          </p>
        </div>
        }
      </div>

      <div
        slot="footer"
        class="flex items-center justify-end gap-3 px-4 py-2.5 bg-[var(--color-surface-elevated)] border-t border-[var(--color-border)]"
      >
        <app-button variant="ghost" (clicked)="close.emit()"
          >Cancelar</app-button
        >
        <app-button
          variant="primary"
          [disabled]="!canConfirm()"
          [loading]="submitting()"
          [showTextWhileLoading]="true"
          (clicked)="confirm()"
        >
          {{ confirmLabel() }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class AddNotesModalComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);
  private readonly ordersService = inject(OrdersService);
  private readonly dispatchNotesService = inject(DispatchNotesService);

  /** Route to which the picked remisiones will be appended. */
  readonly routeId = input.required<number>();

  readonly close = output<void>();
  /** Emitted after the stops are appended so the parent can reload the route. */
  readonly added = output<void>();

  readonly noteSearch = signal('');
  readonly availableNotes = signal<AvailableNote[]>([]);
  readonly loadingNotes = signal(false);
  /**
   * Error del picker de remisiones (paso 10). Distingue "falló la carga" de
   * "no hay remisiones": cuando está seteado se muestra un empty-state de error
   * con botón de reintento; el vacío lo resuelve el `@empty` de la lista.
   */
  readonly notesError = signal<string | null>(null);
  readonly submitting = signal(false);

  /** Ids of the notes the operator has picked, in selection order. */
  private readonly selectedIds = signal<number[]>([]);

  // ==========================================================================
  // Switch A/B (paso 13).
  //  'notes'  = Modo A: adjuntar remisiones existentes (comportamiento previo).
  //  'orders' = Modo B: crear remisiones al vuelo desde órdenes despachables.
  // ==========================================================================
  readonly mode = signal<'notes' | 'orders'>('notes');

  /**
   * El Modo B (crear remisiones desde órdenes y agregarlas a la ruta) exige
   * DOBLE permiso: crear la remisión (`store:dispatch_notes:create`) y mutar la
   * ruta existente (`store:dispatch_routes:update`, que respalda `addStops`).
   * Reactivo zoneless: `hasPermission` lee el signal `userPermissions()` del
   * AuthFacade, por lo que el computed se recalcula al cargar credenciales.
   */
  readonly canCreateFromOrders = computed<boolean>(
    () =>
      this.authFacade.hasPermission('store:dispatch_notes:create') &&
      this.authFacade.hasPermission('store:dispatch_routes:update'),
  );

  /**
   * Opciones del segmentado del switch. Solo se renderiza cuando
   * `canCreateFromOrders()` es verdadero, así que siempre lleva ambas opciones.
   */
  readonly modeOptions = computed<InputButtonOption[]>(() => [
    { value: 'notes', label: 'Remisiones existentes', icon: 'file-text' },
    { value: 'orders', label: 'Crear desde órdenes', icon: 'shopping-cart' },
  ]);

  // --- Estado del picker de órdenes despachables (Modo B) ---
  readonly orders = signal<Order[]>([]);
  readonly ordersLoading = signal(false);
  readonly ordersError = signal<string | null>(null);
  /** Guard: solo se cargan las órdenes la primera vez que se entra al Modo B. */
  private ordersRequested = false;
  /** Término de búsqueda para filtrar órdenes despachables en el Modo B. */
  readonly orderSearch = signal('');
  /** Ids de órdenes seleccionadas para crear remisiones (Modo B). */
  readonly selectedOrderIds = signal<number[]>([]);

  constructor() {
    this.loadAvailableNotes();
  }

  /** Set of picked ids for quick membership checks in the picking list. */
  private readonly selectedIdSet = computed<Set<number>>(
    () => new Set(this.selectedIds()),
  );

  private readonly selectedOrderIdSet = computed<Set<number>>(
    () => new Set(this.selectedOrderIds()),
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

  /** Órdenes visibles en el Modo B, filtradas por el término de búsqueda. */
  readonly availableOrdersForPicking = computed<Order[]>(() => {
    const term = this.orderSearch().trim().toLowerCase();
    return this.orders().filter((order) => {
      if (!term) return true;
      const haystack =
        `${order.order_number} ${this.orderCustomerName(order)}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  /** Suma del grand_total de las órdenes seleccionadas (vista previa Modo B). */
  readonly selectedOrdersTotal = computed<number>(() => {
    const set = this.selectedOrderIdSet();
    return this.orders()
      .filter((o) => set.has(o.id))
      .reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
  });

  /** Habilita el botón de confirmar según el modo activo. */
  readonly canConfirm = computed<boolean>(() => {
    if (this.mode() === 'orders') {
      return this.canCreateFromOrders() && this.selectedOrderIds().length > 0;
    }
    return this.selectedNotes().length > 0;
  });

  /** Etiqueta del botón de confirmar, reflejando modo y conteo. */
  readonly confirmLabel = computed<string>(() => {
    if (this.mode() === 'orders') {
      const n = this.selectedOrderIds().length;
      if (n === 0) return 'Crear y agregar';
      return n === 1
        ? 'Crear y agregar 1 remisión'
        : `Crear y agregar ${n} remisiones`;
    }
    const n = this.selectedNotes().length;
    if (n === 0) return 'Agregar';
    return n === 1 ? 'Agregar 1 remisión' : `Agregar ${n} remisiones`;
  });

  /**
   * Carga las remisiones elegibles para agregar a la ruta. Reintentable desde
   * el empty-state de error (paso 10): limpia `notesError` al iniciar y lo setea
   * en el `error` para mostrar el estado de error en vez del vacío.
   */
  loadAvailableNotes(): void {
    this.loadingNotes.set(true);
    this.notesError.set(null);
    this.service
      .listAvailableDispatchNotes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.availableNotes.set((res?.data ?? []) as AvailableNote[]);
          this.loadingNotes.set(false);
        },
        error: (e) => {
          this.notesError.set(
            e?.message ?? 'No se pudieron cargar las remisiones.',
          );
          this.loadingNotes.set(false);
        },
      });
  }

  /**
   * Cambia entre Modo A (remisiones) y Modo B (órdenes). El Modo B se ignora si
   * el usuario no tiene el doble permiso (defensa extra al ocultado del switch).
   * La primera vez que se entra al Modo B se cargan las órdenes (lazy).
   */
  setMode(value: string): void {
    if (value === 'orders') {
      if (!this.canCreateFromOrders()) return;
      this.mode.set('orders');
      if (!this.ordersRequested) this.loadDispatchableOrders();
      return;
    }
    this.mode.set('notes');
  }

  /**
   * Carga las órdenes despachables (`dispatchable: true`). Solo se usa en el
   * Modo B. Reintentable desde el empty-state de error.
   */
  loadDispatchableOrders(): void {
    this.ordersRequested = true;
    this.ordersLoading.set(true);
    this.ordersError.set(null);
    this.ordersService
      .getOrders({ dispatchable: true, page: 1, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          // OrdersService.getOrders ya desenvuelve el envelope → { data, pagination }.
          const list = Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res)
              ? res
              : [];
          this.orders.set(list as Order[]);
          this.ordersLoading.set(false);
        },
        error: (e) => {
          this.ordersError.set(
            e?.message ?? 'No se pudieron cargar las órdenes despachables.',
          );
          this.ordersLoading.set(false);
        },
      });
  }

  /** Nombre legible del cliente de una orden (fallback a "Cliente #id"). */
  orderCustomerName(order: Order): string {
    const u = (order as any).users;
    const name = u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '';
    return name || (order.customer_id ? `Cliente #${order.customer_id}` : 'Sin cliente');
  }

  /** ¿La orden está seleccionada para crear su remisión (Modo B)? */
  isOrderSelected(orderId: number): boolean {
    return this.selectedOrderIdSet().has(orderId);
  }

  /** Alterna la selección de una orden en el Modo B. */
  toggleOrder(orderId: number): void {
    if (!orderId || orderId <= 0) return;
    this.selectedOrderIds.update((ids) =>
      ids.includes(orderId)
        ? ids.filter((id) => id !== orderId)
        : [...ids, orderId],
    );
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

  /** Confirma según el modo activo (paso 13). */
  confirm(): void {
    if (this.submitting() || !this.canConfirm()) return;
    if (this.mode() === 'orders') {
      this.confirmFromOrders();
      return;
    }
    this.confirmFromNotes();
  }

  /** Modo A: agrega las remisiones ya seleccionadas como paradas (addStops). */
  private confirmFromNotes(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
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

  /**
   * Modo B: crea (en borrador) una remisión por orden seleccionada vía el batch
   * idempotente (`batch_key`), luego agrega las remisiones efectivamente creadas
   * como paradas de la ruta EXISTENTE (`addStops`, no `create`). Reglas:
   *  - `failed`  → toast de error con error_code/message de la primera falla.
   *  - `skipped` → toast informativo (idempotencia / ya despachadas).
   *  - `created.length === 0` → ABORTA: no se llama a `addStops`.
   * `addStops` auto-confirma las remisiones y reafirma el gate de estado de la
   * ruta (`DSP_ROUTE_NOT_EDITABLE_001`) en el backend.
   */
  private confirmFromOrders(): void {
    this.submitting.set(true);
    const batchDto: CreateFromOrdersBatchDto = {
      orders: this.selectedOrderIds(),
      target_status: 'draft',
      batch_key: crypto.randomUUID(),
    };
    this.dispatchNotesService
      .createFromOrdersBatch(batchDto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const created = res.results.filter(
            (
              r,
            ): r is Extract<
              CreateFromOrdersBatchResultItem,
              { status: 'created' }
            > => r.status === 'created',
          );
          const failed = res.results.filter((r) => r.status === 'failed');
          const skipped = res.results.filter((r) => r.status === 'skipped');

          if (failed.length > 0) {
            const first = failed[0] as Extract<
              CreateFromOrdersBatchResultItem,
              { status: 'failed' }
            >;
            this.toast.error(
              `${failed.length} orden(es) no se pudieron despachar: ${first.error_code} — ${first.message}`,
            );
          }
          if (skipped.length > 0) {
            this.toast.info(
              `${skipped.length} orden(es) ya tenían remisión (omitidas).`,
            );
          }

          if (created.length === 0) {
            this.submitting.set(false);
            this.toast.error(
              'No se creó ninguna remisión; no se agregó nada a la ruta.',
            );
            return;
          }

          this.service
            .addStops(this.routeId(), {
              stops: created.map((c) => ({ dispatch_note_id: c.dispatch_note_id })),
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.submitting.set(false);
                this.added.emit();
              },
              error: (e) => {
                this.submitting.set(false);
                this.toast.error(
                  e?.message || 'No se pudieron agregar las remisiones a la ruta',
                );
              },
            });
        },
        error: (e) => {
          this.submitting.set(false);
          this.toast.error(
            e?.message ??
              'No se pudieron crear las remisiones desde las órdenes.',
          );
        },
      });
  }
}
