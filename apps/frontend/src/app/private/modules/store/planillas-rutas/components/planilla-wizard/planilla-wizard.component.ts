import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';

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
    CommonModule,
    FormsModule,
    ModalComponent,
    SelectorComponent,
    StoreUserSelectComponent,
    StoreUserMultiSelectComponent,
    IconComponent,
    CurrencyPipe,
    StepsLineComponent,
    InputComponent,
    ToggleComponent,
    InputsearchComponent,
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
            class="rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            {{ prefillNote() }}
          </div>
        }

        @switch (currentStep()) {
          <!-- ============================================================= -->
          <!-- Paso 1: Información básica del despacho                        -->
          <!-- ============================================================= -->
          @case (1) {
            <div class="space-y-3">
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

              <app-selector
                label="Vehículo"
                placeholder="Seleccionar vehículo..."
                [searchable]="true"
                [options]="vehicleOptions()"
                [ngModel]="vehicleId()"
                (ngModelChange)="vehicleId.set($event)"
              ></app-selector>

              <div>
                <label class="block text-sm font-medium mb-2"
                  >Tipo de conductor</label
                >
                <div class="flex items-center gap-3">
                  <span
                    class="text-sm"
                    [class.font-semibold]="!driverIsExternal()"
                    [class.text-[var(--color-text-secondary)]]="
                      driverIsExternal()
                    "
                    >Interno (usuario)</span
                  >
                  <app-toggle
                    ariaLabel="Conductor externo"
                    [checked]="driverIsExternal()"
                    (changed)="setDriverExternal($event)"
                  ></app-toggle>
                  <span
                    class="text-sm"
                    [class.font-semibold]="driverIsExternal()"
                    [class.text-[var(--color-text-secondary)]]="
                      !driverIsExternal()
                    "
                    >Externo (agente)</span
                  >
                </div>
              </div>

              @if (!driverIsExternal()) {
                <div>
                  <label class="block text-sm font-medium mb-1">
                    Conductor
                    <span class="text-red-500" aria-label="obligatorio">*</span>
                  </label>
                  <app-store-user-select
                    placeholder="Buscar conductor..."
                    [ngModel]="driverUserId()"
                    (ngModelChange)="driverUserId.set($event)"
                  ></app-store-user-select>
                  @if (driverUserId() == null) {
                    <p class="text-xs text-amber-700 mt-1">
                      Selecciona un conductor de tu tienda.
                    </p>
                  }
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Auxiliares</label>
                  <app-store-user-multi-select
                    placeholder="Buscar auxiliares..."
                    [excludeIds]="assistantExcludeIds()"
                    [ngModel]="assistantIds()"
                    (ngModelChange)="assistantIds.set($event)"
                  ></app-store-user-multi-select>
                </div>
              } @else {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            </div>
          }

          <!-- ============================================================= -->
          <!-- Paso 2: Entregas                                              -->
          <!-- ============================================================= -->
          @case (2) {
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
                  @for (note of availableForPicking(); track note.id) {
                    <div
                      class="flex items-center gap-2 p-2 rounded-md border border-border"
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
                        <!-- Dirección de entrega (📍) o aviso de remisión no despachable -->
                        @if (noteHasAddress(note)) {
                          <p
                            class="mt-0.5 text-xs text-[var(--color-text-secondary)] flex items-center gap-1 truncate"
                          >
                            <app-icon name="map-pin" [size]="12" class="shrink-0" />
                            <span class="truncate">{{ noteAddressText(note) }}</span>
                          </p>
                        } @else if (noteAddressKnown(note)) {
                          <p
                            class="mt-0.5 text-xs text-amber-700 flex items-center gap-1"
                          >
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
                    <div
                      class="text-sm text-[var(--color-text-secondary)] text-center py-4"
                    >
                      @if (noteSearch()) {
                        No hay remisiones que coincidan con la búsqueda.
                      } @else {
                        No hay remisiones disponibles para agregar.
                      }
                    </div>
                  }
                </div>
              </div>

              <!-- Paradas seleccionadas -->
              <div>
                <h3 class="text-sm font-semibold mb-2">
                  Entregas seleccionadas
                  <span class="text-xs font-normal text-[var(--color-text-secondary)]">
                    ({{ stops().length }})
                  </span>
                </h3>
                <div class="space-y-2">
                  @for (stop of orderedStops(); track stop.dispatch_note_id; let i = $index) {
                    <div
                      class="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30"
                    >
                      <span class="text-sm font-mono w-6 text-center shrink-0">{{
                        i + 1
                      }}</span>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium truncate">
                          {{ stopNote(stop.dispatch_note_id)?.dispatch_number }}
                          <span class="text-[var(--color-text-secondary)]"
                            >·
                            {{
                              stopNote(stop.dispatch_note_id)?.customer_name ||
                                'Sin cliente'
                            }}</span
                          >
                        </p>
                        <p class="text-xs text-[var(--color-text-secondary)]">
                          {{
                            +(stopNote(stop.dispatch_note_id)?.grand_total || 0)
                              | currency
                          }}
                        </p>
                      </div>
                      <button
                        type="button"
                        (click)="moveStopUp(i)"
                        [disabled]="i === 0"
                        class="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-[var(--color-text-primary)] disabled:opacity-30"
                        aria-label="Subir entrega"
                      >
                        <app-icon name="arrow-up" [size]="18" />
                      </button>
                      <button
                        type="button"
                        (click)="moveStopDown(i)"
                        [disabled]="i === stops().length - 1"
                        class="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-[var(--color-text-primary)] disabled:opacity-30"
                        aria-label="Bajar entrega"
                      >
                        <app-icon name="arrow-down" [size]="18" />
                      </button>
                      <button
                        type="button"
                        (click)="removeStop(i)"
                        class="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-[var(--color-destructive)]"
                        aria-label="Quitar entrega"
                      >
                        <app-icon name="trash-2" [size]="18" />
                      </button>
                    </div>
                  } @empty {
                    <div
                      class="text-sm text-[var(--color-text-secondary)] text-center py-4"
                    >
                      Agrega al menos una remisión desde la lista superior.
                    </div>
                  }
                </div>
              </div>

              <!-- Total a recaudar -->
              <div
                class="flex items-center justify-between border-t border-border pt-3"
              >
                <span class="text-sm font-medium">Total a recaudar</span>
                <span class="text-base font-semibold">{{
                  stopsTotal() | currency
                }}</span>
              </div>
            </div>
          }
        }
      </div>

      <!-- Footer Paso 1 -->
      @if (currentStep() === 1) {
        <div slot="footer" class="flex gap-2 w-full">
          <button
            (click)="close.emit()"
            type="button"
            class="flex-1 rounded-md border border-border bg-[var(--color-surface)] px-4 py-2 text-sm min-h-[44px]"
          >
            Cancelar
          </button>
          <button
            (click)="next()"
            type="button"
            [disabled]="!canProceedStep1()"
            class="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-primary-600 text-white px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50"
          >
            Siguiente
            <app-icon name="arrow-right" [size]="16" />
          </button>
        </div>
      }

      <!-- Footer Paso 2 -->
      @if (currentStep() === 2) {
        <div slot="footer" class="flex gap-2 w-full">
          <button
            (click)="back()"
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-border bg-[var(--color-surface)] px-4 py-2 text-sm min-h-[44px]"
          >
            <app-icon name="arrow-left" [size]="16" />
            Atrás
          </button>
          <button
            (click)="submit()"
            type="button"
            [disabled]="submitting() || !canSubmit()"
            class="flex-1 rounded-md bg-primary-600 text-white px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50"
          >
            {{ submitting() ? 'Creando...' : 'Crear planilla' }}
          </button>
        </div>
      }
    </app-modal>
  `,
})
export class PlanillaWizardComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

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

  /** Término de búsqueda para filtrar remisiones disponibles en el paso 2. */
  readonly noteSearch = signal('');

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

  constructor() {
    this.loadAvailableNotes();
    this.loadVehicles();
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
  private loadAvailableNotes(): void {
    this.service
      .listAvailableDispatchNotes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const notes = (res?.data ?? []) as AvailableNote[];
          this.availableNotes.set(notes);
        },
      });
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

  canSubmit(): boolean {
    if (this.stops().length === 0) return false;
    if (!this.stops().every((s) => s.dispatch_note_id > 0)) return false;
    if (this.driverIsExternal()) {
      return !!(this.extName() && this.extId());
    }
    const driver = this.driverUserId();
    return driver !== null && driver > 0;
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    const isExternal = this.driverIsExternal();
    const assistants = isExternal
      ? undefined
      : this.assistantIds().map((id) => ({ user_id: id }));
    const dto: CreateDispatchRouteDto = {
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
      stops: this.orderedStops(),
    };
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
}
