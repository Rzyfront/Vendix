import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  PlanDeparture,
  PlanDepartureMode,
  PlanDepartureStatus,
  PlanPaxPrice,
  ServicePlansService,
} from '../../services/service-plans.service';

interface TierRow {
  min_pax: number | null;
  max_pax: number | null;
  price: number | null;
}

interface DepartureDraft {
  capacity: number | null;
  price_override: number | null;
  status: PlanDepartureStatus;
}

const STATUS_LABELS: Record<PlanDepartureStatus, string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
};

/**
 * Sección «Plan / paquete» del formulario de servicio (QUI-1060). Los campos del plan viven en el
 * formulario del padre (`plan_*`); los tramos de precio y las salidas se guardan por su cuenta
 * contra `/store/service-plans` y solo se gestionan con el servicio ya guardado.
 */
@Component({
  selector: 'app-service-plan-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    SpinnerComponent,
    TextareaComponent,
    CurrencyPipe,
  ],
  template: `
    <section class="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div class="flex items-center gap-2">
        <app-icon name="calendar" [size]="16"></app-icon>
        <h3 class="text-sm font-semibold text-text-primary">Plan / paquete</h3>
      </div>

      <div [formGroup]="form()" class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <app-input
            label="Duración (días)"
            type="number"
            min="1"
            formControlName="plan_duration_days"
            placeholder="Ej. 3"
            customWrapperClass="!mt-0"
          ></app-input>
          <app-input
            label="Noches"
            type="number"
            min="0"
            formControlName="plan_duration_nights"
            placeholder="Ej. 2"
            customWrapperClass="!mt-0"
          ></app-input>
          <app-selector
            label="Eventos"
            [options]="departureModeOptions"
            formControlName="plan_departure_mode"
            placeholder="Seleccionar modo"
            customWrapperClass="!mt-0"
          ></app-selector>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Mínimo de personas"
            type="number"
            min="1"
            formControlName="plan_min_pax"
            customWrapperClass="!mt-0"
          ></app-input>
          <app-input
            label="Máximo de personas"
            type="number"
            min="1"
            formControlName="plan_max_pax"
            customWrapperClass="!mt-0"
          ></app-input>
        </div>
        <app-textarea
          label="Incluye"
          formControlName="plan_includes"
          placeholder="Qué incluye el plan..."
          customWrapperClass="!mt-0"
        ></app-textarea>
        <app-textarea
          label="No incluye"
          formControlName="plan_excludes"
          placeholder="Qué no incluye el plan..."
          customWrapperClass="!mt-0"
        ></app-textarea>
        <app-textarea
          label="Recomendaciones"
          formControlName="plan_recommendations"
          placeholder="Recomendaciones para el viajero..."
          customWrapperClass="!mt-0"
        ></app-textarea>
      </div>

      @if (!productId()) {
        <p class="text-xs text-text-secondary">
          Guarda el servicio para cargar tramos de precio y eventos.
        </p>
      } @else if (loading()) {
        <div class="flex items-center gap-2 text-sm text-text-secondary">
          <app-spinner size="sm" color="primary"></app-spinner>
          Cargando tramos y eventos...
        </div>
      } @else {
        <!-- Tramos de precio por tamaño de grupo -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-medium text-text-primary">Precio por tamaño de grupo</h4>
            <app-button variant="outline" size="sm" (clicked)="addTier()">
              <app-icon slot="icon" name="plus" [size]="14"></app-icon>
              Agregar tramo
            </app-button>
          </div>
          @if (tiers().length === 0) {
            <p class="text-xs text-text-secondary">Aún no hay tramos. El plan no podrá reservarse sin tarifa.</p>
          }
          @for (tier of tiers(); track $index; let i = $index) {
            <div class="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-end">
              <app-input
                label="Mín. pax"
                type="number"
                min="1"
                [ngModel]="tier.min_pax"
                (ngModelChange)="updateTier(i, 'min_pax', $event)"
                [ngModelOptions]="{ standalone: true }"
                customWrapperClass="!mt-0"
              ></app-input>
              <app-input
                label="Máx. pax"
                type="number"
                min="1"
                [ngModel]="tier.max_pax"
                (ngModelChange)="updateTier(i, 'max_pax', $event)"
                [ngModelOptions]="{ standalone: true }"
                customWrapperClass="!mt-0"
              ></app-input>
              <app-input
                label="Precio del paquete"
                [currency]="true"
                [ngModel]="tier.price"
                (ngModelChange)="updateTier(i, 'price', $event)"
                [ngModelOptions]="{ standalone: true }"
                customWrapperClass="!mt-0"
              ></app-input>
              <app-button variant="ghost" size="sm" (clicked)="removeTier(i)">
                <app-icon name="trash-2" [size]="14"></app-icon>
              </app-button>
            </div>
          }
          @if (tiersError()) {
            <p class="text-xs text-error">{{ tiersError() }}</p>
          }
          @if (tiers().length > 0 || tiersDirty()) {
            <app-button
              variant="primary"
              size="sm"
              [disabled]="savingTiers() || !!tiersError()"
              [loading]="savingTiers()"
              (clicked)="saveTiers()"
            >
              Guardar tramos
            </app-button>
          }
        </div>

        <!-- Eventos programados -->
        @if (showDepartures()) {
          <div class="space-y-3">
            <h4 class="text-sm font-medium text-text-primary">Eventos programados</h4>

            <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
              <app-input
                label="Fecha del evento"
                type="date"
                [min]="todayString"
                [ngModel]="newDate()"
                (ngModelChange)="newDate.set($event)"
                [ngModelOptions]="{ standalone: true }"
                customWrapperClass="!mt-0"
              ></app-input>
              <app-input
                label="Cupo"
                type="number"
                min="1"
                [ngModel]="newCapacity()"
                (ngModelChange)="newCapacity.set($event)"
                [ngModelOptions]="{ standalone: true }"
                customWrapperClass="!mt-0"
              ></app-input>
              <app-input
                label="Precio especial (opcional)"
                [currency]="true"
                [ngModel]="newOverride()"
                (ngModelChange)="newOverride.set($event)"
                [ngModelOptions]="{ standalone: true }"
                customWrapperClass="!mt-0"
              ></app-input>
              <app-button
                variant="primary"
                size="sm"
                [disabled]="!canAddDeparture() || savingDeparture()"
                [loading]="savingDeparture()"
                (clicked)="addDeparture()"
              >
                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                Agregar evento
              </app-button>
            </div>

            @if (departures().length === 0) {
              <p class="text-xs text-text-secondary">No hay eventos próximos.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-xs text-text-secondary">
                      <th class="py-2 pr-3 font-medium">Fecha</th>
                      <th class="py-2 pr-3 font-medium">Cupo</th>
                      <th class="py-2 pr-3 font-medium">Vendidos</th>
                      <th class="py-2 pr-3 font-medium">Disponibles</th>
                      <th class="py-2 pr-3 font-medium">Precio especial</th>
                      <th class="py-2 pr-3 font-medium">Estado</th>
                      <th class="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (dep of departures(); track dep.id) {
                      <tr class="border-t border-border">
                        <td class="py-2 pr-3">{{ formatDate(dep.departure_date) }}</td>
                        @if (editingId() === dep.id) {
                          <td class="py-2 pr-3">
                            <app-input
                              type="number"
                              min="1"
                              [ngModel]="draft().capacity"
                              (ngModelChange)="patchDraft({ capacity: toNumber($event) })"
                              [ngModelOptions]="{ standalone: true }"
                              customWrapperClass="!mt-0"
                            ></app-input>
                          </td>
                          <td class="py-2 pr-3">{{ dep.seats_sold }}</td>
                          <td class="py-2 pr-3">{{ dep.seats_available }}</td>
                          <td class="py-2 pr-3">
                            <app-input
                              [currency]="true"
                              [ngModel]="draft().price_override"
                              (ngModelChange)="patchDraft({ price_override: toNumber($event) })"
                              [ngModelOptions]="{ standalone: true }"
                              customWrapperClass="!mt-0"
                            ></app-input>
                          </td>
                          <td class="py-2 pr-3">
                            <app-selector
                              [options]="statusOptions"
                              [ngModel]="draft().status"
                              (ngModelChange)="patchDraft({ status: $event })"
                              [ngModelOptions]="{ standalone: true }"
                              customWrapperClass="!mt-0"
                            ></app-selector>
                          </td>
                          <td class="py-2 text-right whitespace-nowrap">
                            <app-button
                              variant="primary"
                              size="sm"
                              [disabled]="savingDeparture()"
                              [loading]="savingDeparture()"
                              (clicked)="saveDeparture(dep)"
                            >
                              Guardar
                            </app-button>
                            <app-button variant="ghost" size="sm" (clicked)="editingId.set(null)">Cancelar</app-button>
                          </td>
                        } @else {
                          <td class="py-2 pr-3">{{ dep.capacity }}</td>
                          <td class="py-2 pr-3">{{ dep.seats_sold }}</td>
                          <td class="py-2 pr-3">{{ dep.seats_available }}</td>
                          <td class="py-2 pr-3">
                            @if (dep.price_override != null) {
                              {{ dep.price_override | currency }}
                            } @else {
                              <span class="text-text-secondary">—</span>
                            }
                          </td>
                          <td class="py-2 pr-3">{{ statusLabel(dep.status) }}</td>
                          <td class="py-2 text-right">
                            <app-button variant="ghost" size="sm" (clicked)="startEdit(dep)">
                              <app-icon name="edit" [size]="14"></app-icon>
                            </app-button>
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }
      }
    </section>
  `,
})
export class ServicePlanSectionComponent implements OnInit {
  private readonly plansService = inject(ServicePlansService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Formulario del servicio; contiene los controles `plan_*`. */
  readonly form = input.required<FormGroup>();
  /** Id del servicio guardado; null al crear. */
  readonly productId = input<number | null>(null);

  readonly departureModeOptions: SelectorOption[] = [
    { value: 'fixed', label: 'Eventos fijos' },
    { value: 'on_demand', label: 'Fecha libre' },
    { value: 'both', label: 'Ambos' },
  ];
  readonly statusOptions: SelectorOption[] = [
    { value: 'open', label: STATUS_LABELS.open },
    { value: 'closed', label: STATUS_LABELS.closed },
    { value: 'cancelled', label: STATUS_LABELS.cancelled },
  ];

  readonly loading = signal(false);
  readonly mode = signal<PlanDepartureMode | null>(null);
  readonly showDepartures = computed(() => this.mode() === 'fixed' || this.mode() === 'both');

  // Tramos
  readonly tiers = signal<TierRow[]>([]);
  readonly tiersDirty = signal(false);
  readonly savingTiers = signal(false);
  readonly tiersError = computed(() => this.validateTiers(this.tiers()));

  // Eventos
  readonly departures = signal<PlanDeparture[]>([]);
  readonly newDate = signal('');
  readonly newCapacity = signal<number | null>(null);
  readonly newOverride = signal<number | null>(null);
  readonly savingDeparture = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly draft = signal<DepartureDraft>({ capacity: null, price_override: null, status: 'open' });
  readonly canAddDeparture = computed(() => !!this.newDate() && Number(this.newCapacity()) >= 1);

  readonly todayString = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  constructor() {
    effect(() => {
      const id = this.productId();
      untracked(() => (id ? this.load(id) : this.reset()));
    });
  }

  ngOnInit(): void {
    const control = this.form().get('plan_departure_mode');
    if (!control) return;
    this.mode.set((control.value as PlanDepartureMode | null) ?? null);
    control.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.mode.set((value as PlanDepartureMode | null) ?? null));
  }

  private reset(): void {
    this.tiers.set([]);
    this.departures.set([]);
    this.tiersDirty.set(false);
  }

  private load(productId: number): void {
    this.loading.set(true);
    this.plansService
      .get(productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plan) => {
          this.tiers.set(plan.pax_prices.map((p) => ({ min_pax: p.min_pax, max_pax: p.max_pax, price: p.price })));
          this.departures.set(plan.departures);
          this.tiersDirty.set(false);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  // ---- Tramos ----

  addTier(): void {
    const rows = this.tiers();
    const last = rows[rows.length - 1];
    const min = last?.max_pax != null ? Number(last.max_pax) + 1 : 1;
    this.tiers.set([...rows, { min_pax: min, max_pax: null, price: null }]);
    this.tiersDirty.set(true);
  }

  removeTier(index: number): void {
    this.tiers.set(this.tiers().filter((_, i) => i !== index));
    this.tiersDirty.set(true);
  }

  updateTier(index: number, key: keyof TierRow, value: unknown): void {
    this.tiers.set(
      this.tiers().map((row, i) => (i === index ? { ...row, [key]: this.toNumber(value) } : row)),
    );
    this.tiersDirty.set(true);
  }

  private validateTiers(rows: TierRow[]): string | null {
    for (const row of rows) {
      if (row.min_pax == null || row.max_pax == null || row.price == null) {
        return 'Completa mínimo, máximo y precio de cada tramo.';
      }
      if (row.min_pax < 1) return 'El mínimo de personas debe ser al menos 1.';
      if (row.min_pax > row.max_pax) return 'En cada tramo el mínimo no puede superar al máximo.';
      if (row.price < 0) return 'El precio no puede ser negativo.';
    }
    const sorted = [...rows].sort((a, b) => (a.min_pax ?? 0) - (b.min_pax ?? 0));
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i].min_pax ?? 0) <= (sorted[i - 1].max_pax ?? 0)) {
        return 'Los tramos no pueden solaparse.';
      }
    }
    return null;
  }

  saveTiers(): void {
    const productId = this.productId();
    if (!productId || this.tiersError()) return;
    this.savingTiers.set(true);
    const payload: PlanPaxPrice[] = this.tiers().map((t) => ({
      min_pax: t.min_pax as number,
      max_pax: t.max_pax as number,
      price: t.price as number,
    }));
    this.plansService
      .replacePaxPrices(productId, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.tiers.set(saved.map((p) => ({ min_pax: p.min_pax, max_pax: p.max_pax, price: p.price })));
          this.tiersDirty.set(false);
          this.savingTiers.set(false);
          this.toast.success('Tramos de precio guardados');
        },
        error: (err) => {
          this.savingTiers.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  // ---- Eventos ----

  addDeparture(): void {
    const productId = this.productId();
    if (!productId || !this.canAddDeparture()) return;
    this.savingDeparture.set(true);
    this.plansService
      .createDeparture(productId, {
        departure_date: this.newDate(),
        capacity: Number(this.newCapacity()),
        price_override: this.newOverride() != null ? Number(this.newOverride()) : null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.departures.set(
            [...this.departures(), created].sort((a, b) => a.departure_date.localeCompare(b.departure_date)),
          );
          this.newDate.set('');
          this.newCapacity.set(null);
          this.newOverride.set(null);
          this.savingDeparture.set(false);
          this.toast.success('Evento agregado');
        },
        error: (err) => {
          this.savingDeparture.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  startEdit(dep: PlanDeparture): void {
    this.draft.set({ capacity: dep.capacity, price_override: dep.price_override, status: dep.status });
    this.editingId.set(dep.id);
  }

  patchDraft(patch: Partial<DepartureDraft>): void {
    this.draft.set({ ...this.draft(), ...patch });
  }

  saveDeparture(dep: PlanDeparture): void {
    const productId = this.productId();
    const draft = this.draft();
    if (!productId || !draft.capacity || draft.capacity < 1) return;
    this.savingDeparture.set(true);
    this.plansService
      .updateDeparture(productId, dep.id, {
        capacity: draft.capacity,
        price_override: draft.price_override,
        status: draft.status,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.departures.set(this.departures().map((d) => (d.id === dep.id ? { ...d, ...updated } : d)));
          this.editingId.set(null);
          this.savingDeparture.set(false);
          this.toast.success('Evento actualizado');
        },
        error: (err) => {
          this.savingDeparture.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  // ---- Helpers ----

  toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  statusLabel(status: PlanDepartureStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  formatDate(date: string): string {
    if (!date) return '--';
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}`;
  }
}
