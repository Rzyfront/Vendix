import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  CreateDispatchRouteDto,
  CreateStopDto,
  DispatchDeliveryAddress,
  DispatchRoute,
  Vehicle,
} from '../../interfaces/planilla.interface';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { StoreUserSelectComponent } from '../../../../../../shared/components/store-user-select/store-user-select.component';
import { StoreUserMultiSelectComponent } from '../../../../../../shared/components/store-user-multi-select/store-user-multi-select.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../shared/components/steps-line/steps-line.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  InputButtonsComponent,
  InputButtonOption,
} from '../../../../../../shared/components/input-buttons/input-buttons.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OrdersService } from '../../../orders/services/orders.service';
import { Order } from '../../../orders/interfaces/order.interface';
import {
  DispatchNotesService,
  CreateFromOrdersBatchDto,
  CreateFromOrdersBatchResultItem,
} from '../../../dispatch-notes/services/dispatch-notes.service';

interface AvailableNote {
  id: number;
  dispatch_number: string;
  customer_name?: string;
  grand_total: string | number;
  status: string;
  /**
   * Delivery-address snapshot of the dispatch note (and optional order
   * fallback). Surfaced so the operator can see "¿dónde es?" and spot
   * remisiones that cannot be dispatched (no address). Optional because the
   * `available-notes` endpoint may not include it on every deploy — when
   * absent the row simply shows no address line.
   */
  customer_address?: DispatchDeliveryAddress | null;
  shipping_address_snapshot?: DispatchDeliveryAddress | null;
}

@Component({
  selector: 'app-planilla-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ModalComponent,
    SelectorComponent,
    StoreUserSelectComponent,
    StoreUserMultiSelectComponent,
    IconComponent,
    CurrencyPipe,
    StepsLineComponent,
    InputComponent,
    InputsearchComponent,
    ButtonComponent,
    InputButtonsComponent,
    EmptyStateComponent,
    BadgeComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      title="Nueva Planilla de Despacho"
      size="lg"
      (cancel)="close.emit()"
    >
      <!-- Indicador de progreso -->
      <app-steps-line
        [steps]="steps"
        [currentStep]="currentStep() - 1"
        [clickable]="true"
        (stepClicked)="goToStep($event + 1)"
      ></app-steps-line>

      <div class="space-y-4">
        @if (prefillNote()) {
          <div
            class="rounded-lg p-3 text-sm text-[var(--color-text-secondary)]"
            style="background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));"
          >
            {{ prefillNote() }}
          </div>
        }

        @switch (currentStep()) {
          <!-- ============================================================= -->
          <!-- Paso 1: Información básica del despacho                        -->
          <!-- ============================================================= -->
          @case (1) {
            <div class="space-y-5">
              <!-- Sección: Datos de la ruta -->
              <section class="space-y-3">
                <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
                  Datos de la ruta
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <app-input
                    label="Código de ruta"
                    placeholder="RI02"
                    [ngModel]="routeCode()"
                    (ngModelChange)="routeCode.set($event)"
                  ></app-input>
                  <app-input
                    label="Fecha planeada"
                    type="datetime-local"
                    [ngModel]="plannedDate()"
                    (ngModelChange)="plannedDate.set($event)"
                  ></app-input>
                </div>
                <app-selector
                  label="Vehículo"
                  placeholder="Seleccionar vehículo..."
                  [searchable]="true"
                  [options]="vehicleOptions()"
                  [ngModel]="vehicleId()"
                  (ngModelChange)="vehicleId.set($event)"
                ></app-selector>
              </section>

              <!-- Sección: Conductor y equipo -->
              <section
                class="space-y-3 pt-4 border-t border-[var(--color-border)]"
              >
                <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
                  Conductor y equipo
                </h3>

                <app-input-buttons
                  label="Tipo de conductor"
                  [options]="driverTypeOptions"
                  [equalWidth]="true"
                  [ngModel]="driverIsExternal() ? 'external' : 'internal'"
                  [ngModelOptions]="{ standalone: true }"
                  (valueChange)="setDriverExternal($event === 'external')"
                ></app-input-buttons>

                @if (!driverIsExternal()) {
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        class="block text-sm font-medium text-[var(--color-text-primary)] mb-1"
                      >
                        Conductor
                        <span
                          class="text-[var(--color-danger)]"
                          aria-label="obligatorio"
                          >*</span
                        >
                      </label>
                      <app-store-user-select
                        placeholder="Buscar conductor..."
                        [ngModel]="driverUserId()"
                        (ngModelChange)="driverUserId.set($event)"
                      ></app-store-user-select>
                      @if (driverUserId() == null) {
                        <p class="text-xs text-[var(--color-text-muted)] mt-1">
                          Selecciona un conductor de tu tienda.
                        </p>
                      }
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-[var(--color-text-primary)] mb-1"
                        >Auxiliares</label
                      >
                      <app-store-user-multi-select
                        placeholder="Buscar auxiliares..."
                        [excludeIds]="assistantExcludeIds()"
                        [ngModel]="assistantIds()"
                        (ngModelChange)="assistantIds.set($event)"
                      ></app-store-user-multi-select>
                    </div>
                  </div>
                } @else {
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <app-input
                      label="Nombre externo"
                      placeholder="Nombre completo"
                      [required]="true"
                      [ngModel]="extName()"
                      (ngModelChange)="extName.set($event)"
                    ></app-input>
                    <app-input
                      label="Cédula"
                      placeholder="1234567890"
                      [required]="true"
                      [ngModel]="extId()"
                      (ngModelChange)="extId.set($event)"
                    ></app-input>
                  </div>
                }
              </section>
            </div>
          }

          <!-- ============================================================= -->
          <!-- Paso 2: Entregas                                              -->
          <!-- ============================================================= -->
          @case (2) {
            <div class="space-y-4">
              <!-- ================================================================ -->
              <!-- Switch A/B (Plan Despacho Economia FASE 7 paso 12):              -->
              <!--  Modo A (notes)  = adjuntar remisiones ya existentes.            -->
              <!--  Modo B (orders) = crear remisiones al vuelo desde ordenes       -->
              <!--    despachables. Solo se ofrece si el usuario tiene el permiso    -->
              <!--    store:dispatch_notes:create (ver modeOptions()).               -->
              <!-- ================================================================ -->
              <app-input-buttons
                label="¿Qué quieres agregar a la ruta?"
                [options]="modeOptions()"
                [equalWidth]="true"
                [ngModel]="mode()"
                [ngModelOptions]="{ standalone: true }"
                (valueChange)="setMode($event)"
              ></app-input-buttons>

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
                    stops().length
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
                    {{ stopsTotal() | currency }}
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
                  @if (notesLoading()) {
                    <div
                      class="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]"
                    >
                      <div
                        class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
                      ></div>
                      Cargando remisiones...
                    </div>
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
                            <app-icon
                              name="map-pin"
                              [size]="12"
                              class="shrink-0"
                            />
                            <span class="truncate">{{
                              noteAddressText(note)
                            }}</span>
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
                          : 'No hay remisiones disponibles para enviar.'
                      "
                      [showActionButton]="false"
                    ></app-empty-state>
                    }
                  }
                </div>
              </div>

              <!-- Paradas seleccionadas -->
              <div>
                <h3
                  class="text-sm font-semibold text-[var(--color-text-primary)] mb-2"
                >
                  En la ruta ({{ stops().length }})
                </h3>
                <div class="space-y-1.5">
                  @for (stop of orderedStops(); track stop.dispatch_note_id; let i = $index) {
                    <div
                      class="flex items-center gap-3 p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
                    >
                      <app-badge variant="primary" size="xs">{{
                        i + 1
                      }}</app-badge>
                      <div class="flex-1 min-w-0">
                        <p
                          class="text-sm font-medium text-[var(--color-text-primary)] truncate"
                        >
                          {{ stopNote(stop.dispatch_note_id)?.dispatch_number }}
                          <span class="text-[var(--color-text-secondary)]"
                            >·
                            {{
                              stopNote(stop.dispatch_note_id)?.customer_name ||
                                'Sin cliente'
                            }}</span
                          >
                        </p>
                      </div>
                      <span
                        class="text-sm font-semibold tabular-nums text-[var(--color-text-primary)] shrink-0"
                        >{{
                          +(stopNote(stop.dispatch_note_id)?.grand_total || 0)
                            | currency
                        }}</span
                      >
                      <div class="flex items-center shrink-0">
                        <button
                          type="button"
                          (click)="moveStopUp(i)"
                          [disabled]="i === 0"
                          class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 min-h-[40px] min-w-[40px]"
                          aria-label="Subir entrega"
                        >
                          <app-icon name="arrow-up" [size]="18" />
                        </button>
                        <button
                          type="button"
                          (click)="moveStopDown(i)"
                          [disabled]="i === stops().length - 1"
                          class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 min-h-[40px] min-w-[40px]"
                          aria-label="Bajar entrega"
                        >
                          <app-icon name="arrow-down" [size]="18" />
                        </button>
                        <button
                          type="button"
                          (click)="removeStop(i)"
                          class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] min-h-[40px] min-w-[40px]"
                          aria-label="Quitar entrega"
                        >
                          <app-icon name="trash-2" [size]="18" />
                        </button>
                      </div>
                    </div>
                  } @empty {
                    <app-empty-state
                      size="sm"
                      icon="map-pin"
                      title="Ruta vacía"
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
                  Se crearán las remisiones (en borrador) de las órdenes
                  seleccionadas y se agregarán como paradas de la ruta.
                </p>
              </div>
              }
            </div>
          }
        }
      </div>

      <!-- Footer Paso 1 -->
      @if (currentStep() === 1) {
        <div
          slot="footer"
          class="flex items-center justify-end gap-3 px-4 py-2.5 bg-[var(--color-surface-elevated)] border-t border-[var(--color-border)]"
        >
          <app-button variant="ghost" (clicked)="close.emit()"
            >Cancelar</app-button
          >
          <app-button
            variant="primary"
            [disabled]="!canProceedStep1()"
            (clicked)="next()"
          >
            Siguiente
            <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
          </app-button>
        </div>
      }

      <!-- Footer Paso 2 -->
      @if (currentStep() === 2) {
        <div
          slot="footer"
          class="flex items-center justify-between px-4 py-2.5 bg-[var(--color-surface-elevated)] border-t border-[var(--color-border)]"
        >
          <app-button variant="outline" (clicked)="back()">
            <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
            Atrás
          </app-button>
          <app-button
            variant="primary"
            [disabled]="!canSubmit()"
            [loading]="submitting()"
            [showTextWhileLoading]="true"
            (clicked)="submit()"
          >
            Crear planilla
          </app-button>
        </div>
      }
    </app-modal>
  `,
})
export class PlanillaWizardComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly authFacade = inject(AuthFacade);
  private readonly ordersService = inject(OrdersService);
  private readonly dispatchNotesService = inject(DispatchNotesService);

  /** Contexto precargado al llegar desde un método de envío (atajo). */
  readonly prefillNote = input<string | null>(null);

  // Plan Despacho Economía — FASE 3 paso 12. Prefill estructurado (no
  // cosmético) desde la política efectiva del método. Se aplican al iniciar
  // el wizard si están presentes; permanecen editables para granular control.
  readonly prefillShippingMethodId = input<number | null>(null);
  readonly prefillVehicleId = input<number | null>(null);
  readonly prefillDriverUserId = input<number | null>(null);
  readonly prefillCarrierSupplierId = input<number | null>(null);

  readonly close = output<void>();
  readonly created = output<DispatchRoute>();

  /** Pasos del wizard, mostrados por el stepper compartido. */
  readonly steps: StepsLineItem[] = [
    { label: 'Información básica del despacho' },
    { label: 'Entregas' },
  ];

  /** Opciones del segmentado tipo-de-conductor (app-input-buttons). */
  readonly driverTypeOptions: InputButtonOption[] = [
    { value: 'internal', label: 'Interno' },
    { value: 'external', label: 'Externo' },
  ];

  /** Paso activo del wizard (1 = datos básicos, 2 = entregas). */
  readonly currentStep = signal<1 | 2>(1);

  readonly routeCode = signal('');
  readonly plannedDate = signal(new Date().toISOString().slice(0, 16));
  readonly driverIsExternal = signal(false);
  readonly driverUserId = signal<number | null>(null);
  readonly assistantIds = signal<number[]>([]);
  readonly extName = signal('');
  readonly extId = signal('');
  readonly vehicleId = signal<number | null>(null);
  /**
   * Transportadora externa (supplier) que ejecuta la ruta, prellenada desde la
   * política efectiva del método de envío. Editable; se envía en `submit()`.
   */
  readonly carrierSupplierId = signal<number | null>(null);

  /** Término de búsqueda para filtrar remisiones disponibles en el paso 2. */
  readonly noteSearch = signal('');

  // ==========================================================================
  // Estados del picker de remisiones (Modo A) — cargando / error. El vacío lo
  // resuelve el `@empty` de la lista; estos dos signals distinguen "cargando" y
  // "falló" de "no hay". Se setean en el next/error de loadAvailableNotes().
  // ==========================================================================
  readonly notesLoading = signal(false);
  readonly notesError = signal<string | null>(null);

  // ==========================================================================
  // Switch A/B (Plan Despacho Economía FASE 7 paso 12).
  //  'notes'  = Modo A: adjuntar remisiones existentes (comportamiento previo).
  //  'orders' = Modo B: crear remisiones al vuelo desde órdenes despachables.
  // ==========================================================================
  readonly mode = signal<'notes' | 'orders'>('notes');

  /**
   * El Modo B (crear remisiones desde órdenes) solo se ofrece si el usuario
   * tiene el permiso backend `store:dispatch_notes:create`. Reactivo zoneless:
   * `hasPermission` lee el signal `userPermissions()` del AuthFacade, por lo que
   * el computed se recalcula cuando las credenciales terminan de cargar.
   */
  readonly canCreateFromOrders = computed<boolean>(() =>
    this.authFacade.hasPermission('store:dispatch_notes:create'),
  );

  /**
   * Opciones del segmentado del switch. El Modo B se OCULTA por completo cuando
   * el usuario no puede crear remisiones (no hay forma de deshabilitar una sola
   * opción del `app-input-buttons`, así que se filtra del array).
   */
  readonly modeOptions = computed<InputButtonOption[]>(() => {
    const options: InputButtonOption[] = [
      { value: 'notes', label: 'Remisiones existentes', icon: 'file-text' },
    ];
    if (this.canCreateFromOrders()) {
      options.push({
        value: 'orders',
        label: 'Crear desde órdenes',
        icon: 'shopping-cart',
      });
    }
    return options;
  });

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

  private readonly selectedOrderIdSet = computed<Set<number>>(
    () => new Set(this.selectedOrderIds()),
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

  /** Excluye al conductor ya elegido de la búsqueda de auxiliares. */
  readonly assistantExcludeIds = computed<number[]>(() => {
    const driver = this.driverUserId();
    return driver != null ? [driver] : [];
  });

  /**
   * El paso 1 está completo cuando hay un conductor definido. Interno: un
   * usuario seleccionado (`driverUserId > 0`). Externo: nombre y cédula no
   * vacíos. El vehículo y el código de ruta son opcionales.
   */
  readonly canProceedStep1 = computed<boolean>(() => {
    if (this.driverIsExternal()) {
      return !!(this.extName().trim() && this.extId().trim());
    }
    const driver = this.driverUserId();
    return driver !== null && driver > 0;
  });

  /**
   * Suma el grand_total de las remisiones seleccionadas en el wizard. Útil como
   * vista previa del monto total de la ruta antes de crear la planilla.
   * Solo cuenta paradas con un dispatch_note_id válido (> 0).
   */
  readonly stopsTotal = computed<number>(() => {
    const notesById = new Map(this.availableNotes().map((n) => [n.id, n]));
    return this.stops().reduce((sum, s) => {
      if (!s.dispatch_note_id || s.dispatch_note_id <= 0) return sum;
      const note = notesById.get(s.dispatch_note_id);
      if (!note) return sum;
      return sum + Number(note.grand_total || 0);
    }, 0);
  });

  readonly stops = signal<CreateStopDto[]>([]);
  readonly availableNotes = signal<AvailableNote[]>([]);
  readonly vehicleOptions = signal<SelectorOption[]>([]);
  readonly submitting = signal(false);

  /** Ids de remisiones ya agregadas a una parada. */
  private readonly selectedNoteIds = computed<Set<number>>(
    () => new Set(this.stops().map((s) => s.dispatch_note_id)),
  );

  /**
   * Remisiones que el operador puede agregar: las disponibles que aún no están
   * en una parada y que coinciden con el término de búsqueda (número o cliente).
   */
  readonly availableForPicking = computed<AvailableNote[]>(() => {
    const selected = this.selectedNoteIds();
    const term = this.noteSearch().trim().toLowerCase();
    return this.availableNotes().filter((note) => {
      if (selected.has(note.id)) return false;
      if (!term) return true;
      const haystack = `${note.dispatch_number} ${note.customer_name ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  /** Paradas ordenadas por stop_sequence para mostrar/operar de forma estable. */
  readonly orderedStops = computed<CreateStopDto[]>(() =>
    [...this.stops()].sort((a, b) => a.stop_sequence - b.stop_sequence),
  );

  /**
   * Guard idempotente para el prefill. El padre setea los inputs de política
   * de forma asíncrona (tras `getEffectivePolicy`), por lo que el `effect` corre
   * una primera vez con valores nulos y luego con los reales. Se marca aplicado
   * SOLO cuando llega al menos un valor de prefill, para no pisar ediciones
   * manuales posteriores si el input reemite. Campo plano (no signal): leerlo en
   * el effect NO crea dependencia reactiva.
   */
  private prefillApplied = false;

  /**
   * Ids de dispatch_note precargados desde el query param `prefillNotes`
   * (CONTRATO con el flujo "crear ruta nueva desde una remisión" del módulo
   * dispatch-notes: ids separados por coma, p.ej. `?prefillNotes=12,34`). Se
   * leen del snapshot en el constructor y se aplican como paradas EN CUANTO
   * cargan las remisiones elegibles (por eso se difieren hasta el callback de
   * `loadAvailableNotes`). Campo plano (no signal): se consume una sola vez.
   */
  private pendingPrefillNoteIds: number[] = [];

  constructor() {
    this.readPrefillNotesFromQuery();
    this.loadAvailableNotes();
    this.loadVehicles();

    // Plan Despacho Economía — FASE 3 paso 12. Aplica el prefill estructurado a
    // los signals editables. LEE los inputs de prefill y ESCRIBE signals
    // distintos (vehicleId, driverUserId, carrierSupplierId) — nunca escribe lo
    // que lee, así se evita el bucle. Zoneless-safe: solo signals + effect, sin
    // markForCheck/detectChanges.
    effect(() => {
      const shippingMethodId = this.prefillShippingMethodId();
      const vehicleId = this.prefillVehicleId();
      const driverUserId = this.prefillDriverUserId();
      const carrierSupplierId = this.prefillCarrierSupplierId();

      if (this.prefillApplied) return;
      const hasAnyPrefill =
        shippingMethodId != null ||
        vehicleId != null ||
        driverUserId != null ||
        carrierSupplierId != null;
      if (!hasAnyPrefill) return;

      this.prefillApplied = true;
      if (vehicleId != null) this.vehicleId.set(vehicleId);
      if (driverUserId != null) this.driverUserId.set(driverUserId);
      if (carrierSupplierId != null) this.carrierSupplierId.set(carrierSupplierId);
    });
  }

  goToStep(step: number): void {
    if (step === 1) {
      this.currentStep.set(1);
      return;
    }
    // Solo permitir avanzar al paso 2 si el paso 1 es válido.
    if (step === 2 && this.canProceedStep1()) {
      this.currentStep.set(2);
    }
  }

  next(): void {
    if (this.canProceedStep1()) {
      this.currentStep.set(2);
    }
  }

  back(): void {
    this.currentStep.set(1);
  }

  setDriverExternal(value: boolean): void {
    this.driverIsExternal.set(value);
    if (value) {
      this.driverUserId.set(null);
      this.assistantIds.set([]);
    } else {
      this.extName.set('');
      this.extId.set('');
    }
  }

  /**
   * Loads the dispatch notes that the operator can pick when creating a
   * planilla. We ask the backend for `status=confirmed` (the only notes that
   * can be attached to a route). The backend enforces the additional
   * "not already on a non-released stop of a non-draft route" rule at create
   * time; if a chosen note is blocked, the API returns 400 and the wizard
   * surfaces the error in a toast.
   */
  loadAvailableNotes(): void {
    this.notesLoading.set(true);
    this.notesError.set(null);
    this.service
      .listAvailableDispatchNotes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const notes = (res?.data ?? []) as AvailableNote[];
          this.availableNotes.set(notes);
          this.applyPrefillNotes();
          this.notesLoading.set(false);
        },
        error: (e) => {
          this.notesError.set(
            e?.message ?? 'No se pudieron cargar las remisiones disponibles.',
          );
          this.notesLoading.set(false);
        },
      });
  }

  /**
   * Cambia entre Modo A (remisiones) y Modo B (órdenes). El Modo B se ignora si
   * el usuario no tiene el permiso `store:dispatch_notes:create` (defensa extra
   * al filtrado de `modeOptions()`). La primera vez que se entra al Modo B se
   * cargan las órdenes despachables (lazy).
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
   * Carga las órdenes despachables (state ∈ {processing, pending_payment} y
   * delivery_type que sí requiere remisión — el backend lo resuelve con
   * `dispatchable: true`). Solo se usa en el Modo B. Reintentable desde el
   * empty-state de error.
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
    const u = order.users;
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

  /**
   * Lee el query param `prefillNotes` del snapshot (el repo NO usa
   * `withComponentInputBinding`, así que los params se leen vía `ActivatedRoute`)
   * y deja los ids válidos pendientes de aplicar. Idempotente: si no viene el
   * param, no hace nada y el flujo normal del wizard queda intacto.
   */
  private readPrefillNotesFromQuery(): void {
    const raw = this.activatedRoute.snapshot.queryParamMap.get('prefillNotes');
    if (!raw) return;
    this.pendingPrefillNoteIds = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  /**
   * Aplica el prefill de remisiones (query param `prefillNotes`) una vez
   * cargadas las elegibles: agrega como parada cada id que exista en
   * `availableNotes`. Se ejecuta una sola vez (vacía la lista pendiente). Un id
   * que no esté entre las elegibles (ya asignado a otra ruta / no confirmado) se
   * ignora en silencio para no crear paradas fantasma sin datos.
   */
  private applyPrefillNotes(): void {
    if (this.pendingPrefillNoteIds.length === 0) return;
    const availableIds = new Set(this.availableNotes().map((n) => n.id));
    for (const id of this.pendingPrefillNoteIds) {
      if (availableIds.has(id)) this.addNote(id);
    }
    this.pendingPrefillNoteIds = [];
  }

  private loadVehicles(): void {
    this.service
      .listVehicles({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const vehicles = (res?.data ?? []) as Vehicle[];
          this.vehicleOptions.set(
            vehicles.map((v) => ({
              value: v.id,
              label: this.vehicleLabel(v),
            })),
          );
        },
      });
  }

  private vehicleLabel(vehicle: Vehicle): string {
    const descriptor = [vehicle.brand, vehicle.model_name]
      .filter(Boolean)
      .join(' ');
    return descriptor ? `${vehicle.plate} - ${descriptor}` : vehicle.plate;
  }

  /** Busca la remisión disponible asociada a una parada (para mostrar datos). */
  stopNote(noteId: number): AvailableNote | undefined {
    return this.availableNotes().find((n) => n.id === noteId);
  }

  /**
   * Resuelve la dirección de entrega de una remisión candidata: snapshot propio
   * (`customer_address`) primero, luego el `shipping_address_snapshot` de la
   * orden vinculada. Devuelve null si no hay ninguno.
   */
  private resolveNoteAddress(note: AvailableNote): DispatchDeliveryAddress | null {
    return note.customer_address ?? note.shipping_address_snapshot ?? null;
  }

  /**
   * Una remisión tiene dirección utilizable cuando su blob trae un
   * `address_line1` no vacío (tolerando los alias legacy `line1`/`address`).
   * Espeja el chequeo del backend que bloquea el despacho sin dirección.
   */
  noteHasAddress(note: AvailableNote): boolean {
    const a = this.resolveNoteAddress(note);
    if (!a) return false;
    const line1 = a.address_line1 ?? a.line1 ?? a.address;
    return typeof line1 === 'string' && line1.trim().length > 0;
  }

  /** Dirección de entrega formateada en una línea: `address_line1, city, state`. */
  noteAddressText(note: AvailableNote): string {
    const a = this.resolveNoteAddress(note);
    if (!a) return '';
    const parts = [a.address_line1 ?? a.line1 ?? a.address, a.city, a.state_province]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    return parts.join(', ');
  }

  /**
   * Si el payload de la remisión candidata trae información de dirección (las
   * claves existen, aunque sean null). El endpoint `available-notes` puede no
   * incluir aún el snapshot; cuando NO viene, evitamos un falso "sin dirección"
   * y simplemente no mostramos ni la dirección ni el aviso. El aviso solo
   * aparece cuando sí sabemos que la dirección falta de verdad.
   */
  noteAddressKnown(note: AvailableNote): boolean {
    return (
      note.customer_address !== undefined ||
      note.shipping_address_snapshot !== undefined
    );
  }

  /** Agrega una remisión como nueva parada al final de la secuencia. */
  addNote(noteId: number): void {
    if (!noteId || noteId <= 0) return;
    this.stops.update((s) => {
      if (s.some((stop) => stop.dispatch_note_id === noteId)) return s;
      return [...s, { dispatch_note_id: noteId, stop_sequence: s.length + 1 }];
    });
  }

  /** Sube una parada una posición y recalcula la secuencia 1..n. */
  moveStopUp(index: number): void {
    if (index <= 0) return;
    this.stops.update((s) => {
      const ordered = [...s].sort((a, b) => a.stop_sequence - b.stop_sequence);
      [ordered[index - 1], ordered[index]] = [
        ordered[index],
        ordered[index - 1],
      ];
      return this.resequence(ordered);
    });
  }

  /** Baja una parada una posición y recalcula la secuencia 1..n. */
  moveStopDown(index: number): void {
    this.stops.update((s) => {
      const ordered = [...s].sort((a, b) => a.stop_sequence - b.stop_sequence);
      if (index >= ordered.length - 1) return s;
      [ordered[index], ordered[index + 1]] = [
        ordered[index + 1],
        ordered[index],
      ];
      return this.resequence(ordered);
    });
  }

  /** Quita una parada (por índice ordenado) y recalcula la secuencia 1..n. */
  removeStop(index: number): void {
    this.stops.update((s) => {
      const ordered = [...s].sort((a, b) => a.stop_sequence - b.stop_sequence);
      ordered.splice(index, 1);
      return this.resequence(ordered);
    });
  }

  /** Reasigna stop_sequence consecutivo (1..n) a una lista ordenada. */
  private resequence(stops: CreateStopDto[]): CreateStopDto[] {
    return stops.map((stop, i) => ({ ...stop, stop_sequence: i + 1 }));
  }

  /**
   * El conductor es válido cuando: interno = usuario seleccionado (> 0);
   * externo = nombre y cédula no vacíos. Compartido por ambos modos.
   */
  private driverValid(): boolean {
    if (this.driverIsExternal()) {
      return !!(this.extName() && this.extId());
    }
    const driver = this.driverUserId();
    return driver !== null && driver > 0;
  }

  canSubmit(): boolean {
    if (!this.driverValid()) return false;
    if (this.mode() === 'orders') {
      // Modo B: al menos una orden seleccionada + permiso vigente.
      return this.canCreateFromOrders() && this.selectedOrderIds().length > 0;
    }
    // Modo A: al menos una parada con remisión válida.
    if (this.stops().length === 0) return false;
    return this.stops().every((s) => s.dispatch_note_id > 0);
  }

  /**
   * Arma el DTO de la ruta con los campos comunes (conductor, vehículo, fecha,
   * transportadora, prefill) y las paradas provistas. El backend (`create()`)
   * sólo dispara el auto-config de vehículo/conductor/transportadora si recibe
   * `shipping_method_id` (FASE 3 paso 12).
   */
  private buildRouteDto(stops: CreateStopDto[]): CreateDispatchRouteDto {
    const isExternal = this.driverIsExternal();
    const assistants = isExternal
      ? undefined
      : this.assistantIds().map((id) => ({ user_id: id }));
    return {
      route_code: this.routeCode() || undefined,
      vehicle_id: this.vehicleId() ?? undefined,
      planned_date: new Date(this.plannedDate()).toISOString(),
      driver_user_id: isExternal ? undefined : this.driverUserId() ?? undefined,
      external_driver_name: isExternal ? this.extName() || undefined : undefined,
      external_driver_id_number: isExternal ? this.extId() || undefined : undefined,
      is_primary_driver_external: isExternal,
      assistants: assistants && assistants.length > 0 ? assistants : undefined,
      currency: 'COP',
      notes: this.prefillNote() || undefined,
      shipping_method_id: this.prefillShippingMethodId() ?? undefined,
      external_carrier_supplier_id: this.carrierSupplierId() ?? undefined,
      stops,
    };
  }

  submit(): void {
    if (!this.canSubmit()) return;
    if (this.mode() === 'orders') {
      this.submitFromOrders();
      return;
    }
    this.submitFromNotes();
  }

  /** Modo A: crea la ruta con las remisiones ya seleccionadas (sin cambios). */
  private submitFromNotes(): void {
    this.submitting.set(true);
    const dto = this.buildRouteDto(this.orderedStops());
    this.service
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.submitting.set(false);
          this.created.emit(r);
        },
        error: (e) => {
          this.submitting.set(false);
          this.toast.error(e.message);
        },
      });
  }

  /**
   * Modo B: primero crea (en borrador) una remisión por orden seleccionada vía
   * el batch idempotente (`batch_key`), luego arma las paradas con las remisiones
   * efectivamente creadas y crea la ruta. Reglas:
   *  - `failed`  → toast de error con error_code/message de la primera falla.
   *  - `skipped` → toast informativo (idempotencia / ya despachadas).
   *  - `created.length === 0` → ABORTA: no se crea una ruta vacía.
   */
  private submitFromOrders(): void {
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
            ): r is Extract<CreateFromOrdersBatchResultItem, { status: 'created' }> =>
              r.status === 'created',
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
              'No se creó ninguna remisión; no se crea la ruta.',
            );
            return;
          }

          const stops: CreateStopDto[] = created.map((c, i) => ({
            dispatch_note_id: c.dispatch_note_id,
            stop_sequence: i + 1,
          }));
          const dto = this.buildRouteDto(stops);
          this.service
            .create(dto)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (r) => {
                this.submitting.set(false);
                this.created.emit(r);
              },
              error: (e) => {
                this.submitting.set(false);
                this.toast.error(e.message);
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
