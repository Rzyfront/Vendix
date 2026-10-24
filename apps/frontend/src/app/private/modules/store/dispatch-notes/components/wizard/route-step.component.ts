import {
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  IconComponent,
  InputComponent,
  InputsearchComponent,
  StoreUserSelectComponent,
  TextareaComponent,
} from '../../../../../../shared/components';

import { WizardStepSectionComponent } from './wizard-step-section.component';
import { PlanillasRutasService } from '../../../planillas-rutas/services/planillas-rutas.service';
import { DispatchRoute, DispatchRouteStatus } from '../../../planillas-rutas/interfaces/planilla.interface';
import { CreateDispatchFromOrderNewRouteDto } from '../../interfaces/dispatch-note.interface';
import { DispatchNoteWizardService, WizardRouteMode } from '../../services/dispatch-note-wizard.service';

/** Statuses the backend accepts when appending a remisión to an existing route. */
export const ASSIGNABLE_ROUTE_STATUSES: ReadonlyArray<DispatchRouteStatus> = ['draft', 'dispatched'];

export function isRouteAssignable(route: Pick<DispatchRoute, 'status'>): boolean {
  return ASSIGNABLE_ROUTE_STATUSES.includes(route.status);
}

export const ROUTE_STATUS_LABELS: Record<DispatchRouteStatus, string> = {
  draft: 'Borrador',
  dispatched: 'Despachada',
  in_transit: 'En ruta',
  closed: 'Cerrada',
  voided: 'Anulada',
};

/**
 * Route step (ref 2026-06-25).
 *
 * Optional. The operator picks one of three modes:
 *   - none     : free-standing remisión (default).
 *   - existing : append this remisión as a stop on an existing planilla. All
 *                statuses are listed, but only draft/dispatched are selectable.
 *   - new      : create a new planilla inline. The planilla is created
 *                atomically with the remisión via
 *                `CreateFromOrderDto.route_assignment.new_route`.
 *
 * The component owns the local form state for the "new" sub-form and
 * mirrors the result into the wizard service as a `NewRouteDto` on every
 * change so `canProceed` (step 3) can validate the draft.
 */
@Component({
  selector: 'app-dispatch-wizard-route-step',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    StoreUserSelectComponent,
    TextareaComponent,
    WizardStepSectionComponent,
  ],
  template: `
    <app-wizard-step-section
      icon="truck"
      title="Ruta"
      subtitle="Asigna una ruta ahora o deja la remisión sin ruta (se creará como borrador)"
      [dense]="true"
    >
      <!-- Mode radio group -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        @for (opt of modeOptions; track opt.value) {
          <button
            type="button"
            class="p-2.5 border-2 rounded-lg text-left transition-colors"
            [class]="
              wizardService.routeMode() === opt.value
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/40'
            "
            (click)="onModeChange(opt.value)"
          >
            <div class="flex items-center gap-1.5">
              <app-icon [name]="opt.icon" [size]="16"></app-icon>
              <span class="text-sm font-medium">{{ opt.label }}</span>
            </div>
            <p class="text-xs text-[var(--color-text-muted)] mt-0.5">
              {{ opt.description }}
            </p>
          </button>
        }
      </div>

      <!-- existing -->
      @if (wizardService.routeMode() === 'existing') {
        <div class="space-y-1.5">
          <app-inputsearch
            placeholder="Buscar ruta por # o nombre..."
            [debounceTime]="300"
            (search)="onRouteSearch($event)"
          ></app-inputsearch>

          @if (loadingRoutes()) {
            <p class="text-xs text-[var(--color-text-secondary)] py-1.5 px-1">
              Buscando rutas...
            </p>
          }

          @if (!loadingRoutes() && routes().length === 0) {
            <p class="text-xs text-[var(--color-text-muted)] py-2 px-1">
              No hay rutas registradas.
            </p>
          }

          @for (r of routes(); track r.id) {
            <button
              type="button"
              class="w-full text-left p-2 border rounded-lg transition-colors"
              [disabled]="!isAssignable(r)"
              [class]="
                !isAssignable(r)
                  ? 'border-[var(--color-border)] opacity-60 cursor-not-allowed'
                  : wizardService.selectedRouteId() === r.id
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/40'
              "
              (click)="onPickRoute(r)"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">{{ r.route_number }}</span>
                <span class="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                  {{ statusLabels[r.status] }}
                </span>
              </div>
              <p class="text-xs text-[var(--color-text-muted)] mt-0.5">
                {{ r.planned_date }}
                @if (r.driver_user) {
                  · {{ r.driver_user.first_name }} {{ r.driver_user.last_name }}
                }
                @if (r.vehicle) {
                  · {{ r.vehicle.plate }}
                }
              </p>
              @if (!isAssignable(r)) {
                <p class="text-xs text-[var(--color-text-muted)] mt-0.5">
                  No admite nuevas remisiones: solo se pueden asignar rutas en Borrador o Despachada.
                </p>
              }
            </button>
          }
        </div>
      }

      <!-- new -->
      @if (wizardService.routeMode() === 'new') {
        <div class="space-y-2 border-t border-[var(--color-border)] pt-2.5">
          <app-store-user-select
            placeholder="Buscar conductor..."
            [ngModel]="driverUserId()"
            (ngModelChange)="setDriver($event)"
          ></app-store-user-select>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <app-input
              type="date"
              label="Fecha planeada"
              [ngModel]="plannedDate()"
              (ngModelChange)="setPlannedDate($event)"
            ></app-input>

            <app-input
              type="text"
              label="Código (opcional)"
              placeholder="Ej. R-001"
              [ngModel]="routeCode()"
              (ngModelChange)="setRouteCode($event)"
            ></app-input>
          </div>

          <app-textarea
            label="Notas (opcional)"
            placeholder="Notas internas de la ruta..."
            [rows]="2"
            [ngModel]="notes()"
            (ngModelChange)="setNotes($event)"
          ></app-textarea>
        </div>
      }
    </app-wizard-step-section>
  `,
})
export class RouteStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly planillasService = inject(PlanillasRutasService);
  private readonly destroyRef = inject(DestroyRef);

  readonly modeOptions: Array<{
    value: WizardRouteMode;
    label: string;
    description: string;
    icon: string;
  }> = [
    { value: 'none', label: 'Sin ruta', description: 'Entrega directa desde la remisión.', icon: 'x' },
    { value: 'existing', label: 'Ruta existente', description: 'Asignar a una ruta en borrador o despachada.', icon: 'truck' },
    { value: 'new', label: 'Nueva ruta', description: 'Crear ruta y asignar la remisión.', icon: 'plus-circle' },
  ];

  readonly statusLabels = ROUTE_STATUS_LABELS;

  readonly loadingRoutes = signal(false);
  readonly routes = signal<DispatchRoute[]>([]);

  // New-route draft (mirrors the wizard service).
  readonly driverUserId = signal<number | null>(null);
  readonly plannedDate = signal<string>('');
  readonly routeCode = signal<string>('');
  readonly notes = signal<string>('');

  constructor() {
    // Seed the local draft from the service (in case the operator navigates
    // back and forth between steps).
    const existing = this.wizardService.newRouteDraft();
    if (existing) {
      this.driverUserId.set(existing.driver_user_id);
      this.plannedDate.set(existing.planned_date);
      this.routeCode.set(existing.route_code ?? '');
      this.notes.set(existing.notes ?? '');
    }
    if (this.wizardService.routeMode() === 'existing') {
      this.fetchRoutes('');
    }
  }

  onModeChange(mode: WizardRouteMode): void {
    this.wizardService.setRouteMode(mode);
    if (mode === 'existing') {
      this.fetchRoutes('');
    }
  }

  onRouteSearch(query: string): void {
    this.fetchRoutes(query);
  }

  isAssignable(route: Pick<DispatchRoute, 'status'>): boolean {
    return isRouteAssignable(route);
  }

  onPickRoute(route: DispatchRoute): void {
    if (!this.isAssignable(route)) return;
    this.wizardService.setSelectedRouteId(route.id);
  }

  setDriver(id: number | null): void {
    this.driverUserId.set(id);
    this._pushDraft();
  }
  setPlannedDate(v: string): void {
    this.plannedDate.set(v);
    this._pushDraft();
  }
  setRouteCode(v: string): void {
    this.routeCode.set(v);
    this._pushDraft();
  }
  setNotes(v: string): void {
    this.notes.set(v);
    this._pushDraft();
  }

  private _pushDraft(): void {
    const driver = this.driverUserId();
    const date = this.plannedDate();
    if (!driver || !date) {
      this.wizardService.setNewRouteDraft(null);
      return;
    }
    const draft: CreateDispatchFromOrderNewRouteDto = {
      driver_user_id: driver,
      planned_date: date,
    };
    if (this.routeCode()) draft.route_code = this.routeCode();
    if (this.notes()) draft.notes = this.notes();
    this.wizardService.setNewRouteDraft(draft);
  }

  private fetchRoutes(query: string): void {
    this.loadingRoutes.set(true);
    this.planillasService
      .list({ search: query?.trim() || undefined, limit: 20 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.routes.set(res?.data ?? []);
          this.loadingRoutes.set(false);
        },
        error: () => {
          this.routes.set([]);
          this.loadingRoutes.set(false);
        },
      });
  }
}
