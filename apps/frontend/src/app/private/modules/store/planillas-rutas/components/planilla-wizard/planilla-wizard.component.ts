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

interface AvailableNote {
  id: number;
  dispatch_number: string;
  customer_name?: string;
  grand_total: string | number;
  status: string;
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
  ],
  template: `
    <app-modal
      [isOpen]="true"
      title="Nueva Planilla de Despacho"
      size="lg"
      (cancel)="close.emit()"
    >
      <div class="space-y-4">
        @if (prefillNote()) {
          <div
            class="rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            {{ prefillNote() }}
          </div>
        }

        <!-- Step 1: Datos básicos -->
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">Código de ruta (ej. RI02)</label>
            <input
              type="text"
              class="w-full rounded-md border border-border bg-[var(--color-surface)] px-3 py-2 text-sm"
              [ngModel]="routeCode()"
              (ngModelChange)="routeCode.set($event)"
              placeholder="RI02"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Fecha planeada</label>
            <input
              type="datetime-local"
              class="w-full rounded-md border border-border bg-[var(--color-surface)] px-3 py-2 text-sm"
              [ngModel]="plannedDate()"
              (ngModelChange)="plannedDate.set($event)"
            />
          </div>

          <!-- Vehículo -->
          <div>
            <app-selector
              label="Vehículo"
              placeholder="Seleccionar vehículo..."
              [searchable]="true"
              [options]="vehicleOptions()"
              [ngModel]="vehicleId()"
              (ngModelChange)="vehicleId.set($event)"
            ></app-selector>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">Tipo de conductor</label>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                [class.bg-primary-600]="!driverIsExternal()"
                [class.text-white]="!driverIsExternal()"
                (click)="setDriverExternal(false)"
              >Interno (usuario)</button>
              <button
                type="button"
                class="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                [class.bg-primary-600]="driverIsExternal()"
                [class.text-white]="driverIsExternal()"
                (click)="setDriverExternal(true)"
              >Externo (agente)</button>
            </div>
          </div>

          @if (!driverIsExternal()) {
            <div>
              <label class="block text-sm font-medium mb-1">Conductor</label>
              <app-store-user-select
                placeholder="Buscar conductor..."
                [ngModel]="driverUserId()"
                (ngModelChange)="driverUserId.set($event)"
              ></app-store-user-select>
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
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-sm font-medium mb-1">Nombre externo</label>
                <input
                  type="text"
                  class="w-full rounded-md border border-border bg-[var(--color-surface)] px-3 py-2 text-sm"
                  [ngModel]="extName()"
                  (ngModelChange)="extName.set($event)"
                  placeholder="Nombre completo"
                />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Cédula</label>
                <input
                  type="text"
                  class="w-full rounded-md border border-border bg-[var(--color-surface)] px-3 py-2 text-sm"
                  [ngModel]="extId()"
                  (ngModelChange)="extId.set($event)"
                  placeholder="1234567890"
                />
              </div>
            </div>
          }
        </div>

        <!-- Step 2: Paradas -->
        <div class="border-t border-border pt-4">
          <div class="flex justify-between items-center mb-2">
            <h3 class="font-semibold">Paradas</h3>
            <button
              (click)="addStop()"
              type="button"
              class="text-sm rounded-md bg-secondary text-secondary-foreground px-3 py-1 inline-flex items-center gap-1"
            >
              <app-icon name="plus" [size]="14" />
              Agregar remisión
            </button>
          </div>

          <div class="space-y-2">
            @for (stop of stops(); track $index) {
              <div class="flex gap-2 items-center p-2 rounded-md border border-border bg-muted/30">
                <span class="text-sm font-mono w-6 text-center">{{ $index + 1 }}</span>
                <select
                  class="flex-1 rounded-md border border-border bg-[var(--color-surface)] px-2 py-1 text-sm"
                  [ngModel]="stop.dispatch_note_id"
                  (ngModelChange)="updateStopNote($index, $event)"
                >
                  <option [ngValue]="0">Seleccionar remisión...</option>
                  @for (note of availableNotes(); track note.id) {
                    <option [ngValue]="note.id">
                      {{ note.dispatch_number }} - {{ note.customer_name }}
                      ({{ +note.grand_total | currency: 0 }})
                    </option>
                  }
                </select>
                <button
                  (click)="removeStop($index)"
                  class="text-[var(--color-destructive)] px-2"
                  type="button"
                  aria-label="Quitar parada"
                >
                  <app-icon name="x" [size]="16" />
                </button>
              </div>
            } @empty {
              <div class="text-sm text-[var(--color-text-secondary)] text-center py-4">
                Agrega al menos una remisión
              </div>
            }
          </div>
        </div>
      </div>

      <div slot="footer" class="flex gap-2 w-full">
        <button
          (click)="close.emit()"
          type="button"
          class="flex-1 rounded-md border border-border bg-[var(--color-surface)] px-4 py-2 text-sm"
        >Cancelar</button>
        <button
          (click)="submit()"
          type="button"
          [disabled]="submitting() || !canSubmit()"
          class="flex-1 rounded-md bg-primary-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {{ submitting() ? 'Creando...' : 'Crear Planilla' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class PlanillaWizardComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Contexto precargado al llegar desde un método de envío (atajo). */
  readonly prefillNote = input<string | null>(null);

  readonly close = output<void>();
  readonly created = output<DispatchRoute>();

  readonly routeCode = signal('');
  readonly plannedDate = signal(new Date().toISOString().slice(0, 16));
  readonly driverIsExternal = signal(false);
  readonly driverUserId = signal<number | null>(null);
  readonly assistantIds = signal<number[]>([]);
  readonly extName = signal('');
  readonly extId = signal('');
  readonly vehicleId = signal<number | null>(null);

  /** Excluye al conductor ya elegido de la búsqueda de auxiliares. */
  readonly assistantExcludeIds = computed<number[]>(() => {
    const driver = this.driverUserId();
    return driver != null ? [driver] : [];
  });

  readonly stops = signal<CreateStopDto[]>([]);
  readonly availableNotes = signal<AvailableNote[]>([]);
  readonly vehicleOptions = signal<SelectorOption[]>([]);
  readonly submitting = signal(false);

  constructor() {
    this.loadAvailableNotes();
    this.loadVehicles();
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

  private loadAvailableNotes(): void {
    this.service
      .listAvailableDispatchNotes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.availableNotes.set(res.data as AvailableNote[]),
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

  addStop(): void {
    this.stops.update((s) => [
      ...s,
      { dispatch_note_id: 0, stop_sequence: s.length + 1 },
    ]);
  }

  updateStopNote(idx: number, noteId: number | null): void {
    this.stops.update((s) => {
      const copy = [...s];
      copy[idx] = { ...copy[idx], dispatch_note_id: noteId ?? 0 };
      return copy;
    });
  }

  removeStop(idx: number): void {
    this.stops.update((s) => s.filter((_, i) => i !== idx));
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
      stops: this.stops(),
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
