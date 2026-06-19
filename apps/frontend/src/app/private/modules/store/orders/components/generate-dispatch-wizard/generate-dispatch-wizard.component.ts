import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  StoreUserSelectComponent,
  StoreUserMultiSelectComponent,
  ToastService,
} from '../../../../../../shared/components';
import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';

import { Order, OrderItem } from '../../interfaces/order.interface';
import { DispatchNotesService } from '../../../dispatch-notes/services/dispatch-notes.service';
import {
  CreateDispatchFromOrderDto,
  CreateDispatchFromOrderItemDto,
  CreateDispatchFromOrderNewRouteDto,
  CreateDispatchFromOrderRouteAssignmentDto,
} from '../../../dispatch-notes/interfaces/dispatch-note.interface';
import { PlanillasRutasService } from '../../../planillas-rutas/services/planillas-rutas.service';
import { FleetService } from '../../../fleet/services/fleet.service';
import { LocationsService } from '../../../inventory/services/locations.service';
import { Vehicle, CreateVehicleDto } from '../../../fleet/interfaces/vehicle.interface';
import { VehicleFormModalComponent } from '../../../fleet/components/vehicle-form-modal/vehicle-form-modal.component';

/** Per-item editable row state for step 1. */
interface DispatchItemRow {
  order_item_id: number;
  product_name: string;
  /** Pending quantity available to dispatch (currently the full ordered qty). */
  pending_quantity: number;
  unit_price: number;
  total_price: number;
}

type RouteMode = 'none' | 'existing' | 'new';

/**
 * "Generar Remisión" wizard launched from the order details page.
 *
 * 3 steps (Items → Datos + estado → Ruta) collected into a SINGLE call to
 * `DispatchNotesService.createFromOrder` mirroring the backend
 * `POST /store/dispatch-notes/from-order/:order_id` contract. On backend
 * failure the modal keeps the user's data and surfaces a mapped DSP_* message.
 *
 * Fully zoneless: signal inputs/outputs only, no legacy change-detection APIs.
 * Reactive forms drive the CVA selectors (driver / assistants / vehicle).
 */
@Component({
  selector: 'app-generate-dispatch-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    StoreUserSelectComponent,
    StoreUserMultiSelectComponent,
    CurrencyPipe,
    VehicleFormModalComponent,
  ],
  templateUrl: './generate-dispatch-wizard.component.html',
})
export class GenerateDispatchWizardComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dispatchNotesService = inject(DispatchNotesService);
  private readonly planillasService = inject(PlanillasRutasService);
  private readonly fleetService = inject(FleetService);
  private readonly locationsService = inject(LocationsService);
  private readonly toast = inject(ToastService);

  // ── Inputs / Outputs ──────────────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  readonly order = input<Order | null>(null);

  /** Emitted once the dispatch note is created; payload = new dispatch note id. */
  readonly generated = output<number>();
  readonly closed = output<void>();

  // ── Wizard navigation ─────────────────────────────────────────────────
  readonly step = signal<1 | 2 | 3>(1);
  readonly submitting = signal<boolean>(false);

  // ── Step 1: item rows ─────────────────────────────────────────────────
  readonly itemRows = signal<DispatchItemRow[]>([]);
  /** Editable dispatched quantity per order_item_id. */
  readonly quantities = signal<Record<number, number>>({});

  readonly totalToDispatch = computed(() => {
    const qty = this.quantities();
    return this.itemRows().reduce(
      (sum, row) => sum + (qty[row.order_item_id] ?? 0) * row.unit_price,
      0,
    );
  });

  readonly hasDispatchableItems = computed(() => {
    const qty = this.quantities();
    return this.itemRows().some((row) => (qty[row.order_item_id] ?? 0) > 0);
  });

  // ── Step 2: dispatch data ─────────────────────────────────────────────
  readonly dataForm = this.fb.group({
    dispatch_location_id: this.fb.control<number | null>(null),
    agreed_delivery_date: this.fb.control<string>(''),
    notes: this.fb.control<string>(''),
    target_status: this.fb.control<'draft' | 'confirmed'>('draft', {
      nonNullable: true,
    }),
  });

  readonly locationOptions = signal<SelectorOption[]>([]);

  // ── Step 3: route assignment ──────────────────────────────────────────
  readonly routeMode = signal<RouteMode>('none');

  readonly routeForm = this.fb.group({
    // existing
    route_id: this.fb.control<number | null>(null),
    // new
    driver_user_id: this.fb.control<number | null>(null),
    assistant_ids: this.fb.control<number[]>([], { nonNullable: true }),
    vehicle_id: this.fb.control<number | null>(null),
    planned_date: this.fb.control<string>(''),
    route_code: this.fb.control<string>(''),
    currency: this.fb.control<string>('COP', { nonNullable: true }),
    notes: this.fb.control<string>(''),
  });

  readonly routeOptions = signal<SelectorOption[]>([]);
  readonly vehicleOptions = signal<SelectorOption[]>([]);

  /** Driver id used to exclude the driver from the assistants multi-select. */
  readonly driverId = computed(() => this.routeForm.controls.driver_user_id.value);
  readonly driverExcludeIds = computed<number[]>(() => {
    const id = this.driverId();
    return id != null ? [id] : [];
  });

  // ── Inline vehicle creation ───────────────────────────────────────────
  readonly showVehicleModal = signal<boolean>(false);
  readonly savingVehicle = signal<boolean>(false);

  constructor() {
    // Reset + hydrate every time the wizard opens.
    effect(() => {
      if (this.isOpen()) {
        this.resetWizard();
        this.hydrateItems();
        this.loadLocations();
      }
    });
  }

  // ── Lifecycle helpers ─────────────────────────────────────────────────
  private resetWizard(): void {
    this.step.set(1);
    this.submitting.set(false);
    this.routeMode.set('none');
    this.dataForm.reset({
      dispatch_location_id: null,
      agreed_delivery_date: '',
      notes: '',
      target_status: 'draft',
    });
    this.routeForm.reset({
      route_id: null,
      driver_user_id: null,
      assistant_ids: [],
      vehicle_id: null,
      planned_date: '',
      route_code: '',
      currency: 'COP',
      notes: '',
    });
  }

  private hydrateItems(): void {
    const order = this.order();
    const rows: DispatchItemRow[] = (order?.order_items ?? [])
      .filter((it: OrderItem) => Number(it.quantity) > 0)
      .map((it: OrderItem) => ({
        order_item_id: it.id,
        product_name: it.product_name,
        pending_quantity: Number(it.quantity),
        unit_price: Number(it.unit_price) || 0,
        total_price: Number(it.total_price) || 0,
      }));
    this.itemRows.set(rows);
    // Default each line to its full pending quantity.
    const qty: Record<number, number> = {};
    for (const row of rows) qty[row.order_item_id] = row.pending_quantity;
    this.quantities.set(qty);
  }

  private loadLocations(): void {
    this.locationsService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = res?.data ?? [];
          this.locationOptions.set(
            list.map((l) => ({
              value: l.id,
              label: l.name + (l.is_default ? ' (Principal)' : ''),
            })),
          );
        },
        error: () => this.locationOptions.set([]),
      });
  }

  private loadRoutes(): void {
    this.planillasService
      .listRoutes({ status: 'draft,dispatched' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (routes) => {
          this.routeOptions.set(
            routes.map((r) => ({
              value: r.id,
              label: `${r.route_number}${r.route_code ? ' · ' + r.route_code : ''} (${this.routeStatusLabel(r.status)})`,
            })),
          );
        },
        error: (err) => {
          this.routeOptions.set([]);
          this.toast.error(err.message || 'No se pudieron cargar las rutas');
        },
      });
  }

  private loadVehicles(): void {
    this.fleetService
      .list({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.setVehicleOptions(res?.data ?? []),
        error: () => this.vehicleOptions.set([]),
      });
  }

  private setVehicleOptions(vehicles: Vehicle[]): void {
    this.vehicleOptions.set(
      vehicles.map((v) => ({
        value: v.id,
        label: `${v.plate}${v.brand ? ' · ' + v.brand : ''}${v.model_name ? ' ' + v.model_name : ''}`,
      })),
    );
  }

  private routeStatusLabel(status: string): string {
    return status === 'dispatched' ? 'Despachada' : 'Borrador';
  }

  // ── Step 1 handlers ───────────────────────────────────────────────────
  onQuantityChange(row: DispatchItemRow, raw: string | number): void {
    let value = Number(raw);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > row.pending_quantity) value = row.pending_quantity;
    this.quantities.update((q) => ({ ...q, [row.order_item_id]: value }));
  }

  quantityOf(row: DispatchItemRow): number {
    return this.quantities()[row.order_item_id] ?? 0;
  }

  // ── Step 3 handlers ───────────────────────────────────────────────────
  setRouteMode(mode: RouteMode): void {
    this.routeMode.set(mode);
    if (mode === 'existing' && this.routeOptions().length === 0) {
      this.loadRoutes();
    }
    if (mode === 'new' && this.vehicleOptions().length === 0) {
      this.loadVehicles();
    }
  }

  // ── Inline vehicle creation ───────────────────────────────────────────
  openVehicleModal(): void {
    this.showVehicleModal.set(true);
  }

  onVehicleSaved(dto: CreateVehicleDto): void {
    this.savingVehicle.set(true);
    this.fleetService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (vehicle) => {
          this.savingVehicle.set(false);
          this.showVehicleModal.set(false);
          // Prepend the new vehicle and auto-select it.
          this.vehicleOptions.update((opts) => [
            {
              value: vehicle.id,
              label: `${vehicle.plate}${vehicle.brand ? ' · ' + vehicle.brand : ''}${vehicle.model_name ? ' ' + vehicle.model_name : ''}`,
            },
            ...opts,
          ]);
          this.routeForm.controls.vehicle_id.setValue(vehicle.id);
          this.toast.success(`Vehículo ${vehicle.plate} creado`);
        },
        error: (err) => {
          this.savingVehicle.set(false);
          this.toast.error(err.message || 'Error al crear el vehículo');
        },
      });
  }

  // ── Navigation ────────────────────────────────────────────────────────
  next(): void {
    if (this.step() === 1) {
      if (!this.hasDispatchableItems()) {
        this.toast.error('Indica al menos un item a despachar');
        return;
      }
      this.step.set(2);
      return;
    }
    if (this.step() === 2) {
      this.step.set(3);
      return;
    }
  }

  back(): void {
    if (this.step() > 1) this.step.update((s) => (s - 1) as 1 | 2 | 3);
  }

  close(): void {
    if (this.submitting()) return;
    this.closed.emit();
  }

  // ── Submit ────────────────────────────────────────────────────────────
  submit(): void {
    const order = this.order();
    if (!order) return;

    const dto = this.buildDto();
    if (!dto) return;

    this.submitting.set(true);
    this.dispatchNotesService
      .createFromOrder(order.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dispatchNote) => {
          this.submitting.set(false);
          this.toast.success(
            `Remisión ${dispatchNote.dispatch_number || ''} generada exitosamente`.trim(),
          );
          this.generated.emit(dispatchNote.id);
        },
        error: (err) => {
          this.submitting.set(false);
          // Modal stays open with the user's data; show a mapped message.
          this.toast.error(this.mapError(err));
        },
      });
  }

  /** Build the single from-order body. Returns null + toasts on validation gaps. */
  private buildDto(): CreateDispatchFromOrderDto | null {
    const qty = this.quantities();
    const items: CreateDispatchFromOrderItemDto[] = this.itemRows()
      .map((row) => ({
        order_item_id: row.order_item_id,
        dispatched_quantity: qty[row.order_item_id] ?? 0,
      }))
      .filter((it) => it.dispatched_quantity > 0);

    if (items.length === 0) {
      this.step.set(1);
      this.toast.error('Indica al menos un item a despachar');
      return null;
    }

    const data = this.dataForm.getRawValue();
    const dto: CreateDispatchFromOrderDto = {
      items,
      target_status: data.target_status,
    };
    if (data.dispatch_location_id != null) {
      dto.dispatch_location_id = data.dispatch_location_id;
    }
    if (data.agreed_delivery_date) {
      dto.agreed_delivery_date = data.agreed_delivery_date;
    }
    if (data.notes?.trim()) dto.notes = data.notes.trim();

    const assignment = this.buildRouteAssignment();
    if (assignment === false) return null; // validation failed
    if (assignment) dto.route_assignment = assignment;

    return dto;
  }

  /**
   * Returns the assignment object, `undefined` for "none", or `false` when a
   * required field is missing (after toasting + navigating to step 3).
   */
  private buildRouteAssignment():
    | CreateDispatchFromOrderRouteAssignmentDto
    | undefined
    | false {
    const mode = this.routeMode();
    if (mode === 'none') return undefined;

    const raw = this.routeForm.getRawValue();

    if (mode === 'existing') {
      if (raw.route_id == null) {
        this.step.set(3);
        this.toast.error('Selecciona una ruta existente');
        return false;
      }
      return { mode: 'existing', route_id: raw.route_id };
    }

    // mode === 'new'
    if (raw.driver_user_id == null) {
      this.step.set(3);
      this.toast.error('Selecciona el conductor de la nueva ruta');
      return false;
    }
    if (!raw.planned_date) {
      this.step.set(3);
      this.toast.error('Indica la fecha planeada de la ruta');
      return false;
    }

    const newRoute: CreateDispatchFromOrderNewRouteDto = {
      driver_user_id: raw.driver_user_id,
      planned_date: raw.planned_date,
    };
    if (raw.vehicle_id != null) newRoute.vehicle_id = raw.vehicle_id;
    if (raw.assistant_ids?.length) newRoute.assistant_ids = raw.assistant_ids;
    if (raw.route_code?.trim()) newRoute.route_code = raw.route_code.trim();
    if (raw.currency?.trim()) newRoute.currency = raw.currency.trim();
    if (raw.notes?.trim()) newRoute.notes = raw.notes.trim();

    return { mode: 'new', new_route: newRoute };
  }

  /** Map backend DSP_* error codes to clear Spanish messages. */
  private mapError(err: any): string {
    const code: string | undefined = err?.error?.error_code || err?.error_code;
    const backendMsg: string | undefined =
      err?.error?.message || err?.message;

    const byCode: Record<string, string> = {
      DSP_ORDER_TARGET_STATUS_001:
        'El estado destino de la remisión no es válido para esta orden.',
      DSP_ROUTE_NOT_EDITABLE_001:
        'La ruta seleccionada ya no admite nuevas paradas (debe estar en borrador o despachada).',
      DSP_ROUTE_STOP_CONFLICT_001:
        'Esta remisión ya está asignada a la ruta seleccionada.',
      DSP_ROUTE_ASSIGN_001:
        'Los datos de asignación de ruta son inconsistentes. Revisa el conductor, vehículo y fecha.',
      DSP_ORDER_STATE_001:
        'La orden no está en un estado válido para generar una remisión.',
      DSP_ORDER_DELIVERY_001:
        'Las órdenes de entrega directa no generan remisión de despacho.',
    };

    if (code && byCode[code]) return byCode[code];
    return backendMsg || 'Error al generar la remisión';
  }

  // Expose for template constant binding.
  protected readonly Validators = Validators;
}
