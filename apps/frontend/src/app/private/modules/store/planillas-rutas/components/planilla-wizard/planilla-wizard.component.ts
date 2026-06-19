import {
  Component,
  DestroyRef,
  EventEmitter,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CreateDispatchRouteDto, CreateStopDto, DispatchRoute } from '../../interfaces/planilla.interface';

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
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center"
      (click)="close.emit()"
    >
      <div
        class="bg-background rounded-t-2xl md:rounded-2xl w-full md:max-w-2xl max-h-[90vh] overflow-y-auto"
        (click)="$event.stopPropagation()"
      >
        <div class="p-4 border-b border-border flex justify-between items-center sticky top-0 bg-background">
          <h2 class="text-lg font-semibold">Nueva Planilla de Despacho</h2>
          <button (click)="close.emit()" class="text-2xl leading-none">×</button>
        </div>

        <div class="p-4 space-y-4">
          <!-- Step 1: Datos básicos -->
          <div class="space-y-3">
            <div>
              <label class="block text-sm font-medium mb-1">Código de ruta (ej. RI02)</label>
              <input
                type="text"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                [(ngModel)]="routeCode"
                placeholder="RI02"
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Fecha planeada</label>
              <input
                type="datetime-local"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                [(ngModel)]="plannedDate"
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">Tipo de conductor</label>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="flex-1 rounded-md border px-3 py-2 text-sm"
                  [class.bg-primary]="!driverIsExternal()"
                  [class.text-primary-foreground]="!driverIsExternal()"
                  [class.bg-background]="driverIsExternal()"
                  (click)="setDriverExternal(false)"
                >Interno (usuario)</button>
                <button
                  type="button"
                  class="flex-1 rounded-md border px-3 py-2 text-sm"
                  [class.bg-primary]="driverIsExternal()"
                  [class.text-primary-foreground]="driverIsExternal()"
                  [class.bg-background]="!driverIsExternal()"
                  (click)="setDriverExternal(true)"
                >Externo (agente)</button>
              </div>
            </div>
            @if (!driverIsExternal()) {
              <div>
                <label class="block text-sm font-medium mb-1">Conductor (ID de usuario)</label>
                <input
                  type="number"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  [ngModel]="driverUserId()"
                  (ngModelChange)="driverUserId.set($event)"
                  placeholder="2"
                />
              </div>
            } @else {
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-sm font-medium mb-1">Nombre externo</label>
                  <input
                    type="text"
                    class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    [ngModel]="extName()"
                    (ngModelChange)="extName.set($event)"
                    placeholder="Nombre completo"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Cédula</label>
                  <input
                    type="text"
                    class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                class="text-sm rounded-md bg-secondary text-secondary-foreground px-3 py-1"
              >+ Agregar remisión</button>
            </div>

            <div class="space-y-2">
              @for (stop of stops(); track $index) {
                <div class="flex gap-2 items-center p-2 rounded-md border border-border bg-muted/30">
                  <span class="text-sm font-mono w-6 text-center">{{ $index + 1 }}</span>
                  <select
                    class="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                    [ngModel]="stop.dispatch_note_id"
                    (ngModelChange)="updateStop($index, 'dispatch_note_id', $event)"
                  >
                    <option [ngValue]="null">Seleccionar remisión...</option>
                    @for (note of availableNotes(); track note.id) {
                      <option [ngValue]="note.id">
                        {{ note.dispatch_number }} - {{ note.customer_name }}
                        ({{ note.grand_total | currency: 'COP' : 'symbol' : '1.0-0' }})
                      </option>
                    }
                  </select>
                  <button
                    (click)="removeStop($index)"
                    class="text-red-500 px-2"
                    type="button"
                  >×</button>
                </div>
              } @empty {
                <div class="text-sm text-muted-foreground text-center py-4">
                  Agrega al menos una remisión
                </div>
              }
            </div>
          </div>
        </div>

        <div class="p-4 border-t border-border flex gap-2 sticky bottom-0 bg-background">
          <button
            (click)="close.emit()"
            class="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm"
          >Cancelar</button>
          <button
            (click)="submit()"
            [disabled]="submitting() || !canSubmit()"
            class="flex-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {{ submitting() ? 'Creando...' : 'Crear Planilla' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class PlanillaWizardComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  @Output() close = new EventEmitter<void>();
  @Output() created = new EventEmitter<DispatchRoute>();

  routeCode = '';
  plannedDate = new Date().toISOString().slice(0, 16);
  readonly driverIsExternal = signal(false);
  readonly driverUserId = signal<number | null>(2);
  readonly extName = signal('');
  readonly extId = signal('');

  setDriverExternal(value: boolean): void {
    this.driverIsExternal.set(value);
    if (value) {
      this.driverUserId.set(null);
    } else {
      this.extName.set('');
      this.extId.set('');
    }
  }

  readonly stops = signal<CreateStopDto[]>([]);
  readonly availableNotes = signal<AvailableNote[]>([]);
  readonly submitting = signal(false);

  constructor() {
    this.loadAvailableNotes();
  }

  private loadAvailableNotes() {
    this.service
      .listAvailableDispatchNotes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.availableNotes.set(res.data as AvailableNote[]),
      });
  }

  addStop() {
    this.stops.update((s) => [...s, { dispatch_note_id: 0, stop_sequence: s.length + 1 }]);
  }

  updateStop(idx: number, key: 'dispatch_note_id' | 'stop_sequence', value: any) {
    this.stops.update((s) => {
      const copy = [...s];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  }

  removeStop(idx: number) {
    this.stops.update((s) => s.filter((_, i) => i !== idx));
  }

  canSubmit(): boolean {
    if (this.stops().length === 0) return false;
    if (!this.stops().every((s) => s.dispatch_note_id > 0)) return false;
    if (this.driverIsExternal()) {
      return !!(this.extName() && this.extId());
    }
    return this.driverUserId() !== null && this.driverUserId()! > 0;
  }

  submit() {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    const dto: CreateDispatchRouteDto = {
      route_code: this.routeCode || undefined,
      planned_date: new Date(this.plannedDate).toISOString(),
      driver_user_id: this.driverIsExternal() ? undefined : this.driverUserId() || undefined,
      external_driver_name: this.driverIsExternal() ? this.extName() || undefined : undefined,
      external_driver_id_number: this.driverIsExternal() ? this.extId() || undefined : undefined,
      is_primary_driver_external: this.driverIsExternal(),
      currency: 'COP',
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
