import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  DialogService,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { providerDisplayName } from '../../../../../../shared/utils/provider-display-name';
import {
  activitiesOutsideDuration,
  groupItineraryByDay,
} from '../../../../../../shared/utils/plan-itinerary.util';
import { ReservationsService } from '../../../reservations/services/reservations.service';
import {
  PlanActivity,
  PlanActivityInput,
  ServicePlansService,
} from '../../services/service-plans.service';

type OwnerKind = 'none' | 'internal' | 'supplier';

interface ActivityDraft {
  day_number: number;
  start_time: string;
  title: string;
  description: string;
  owner: OwnerKind;
  provider_id: number | null;
  supplier_name: string;
  supplier_contact: string;
  cost: number | null;
  creates_task: boolean;
  is_public: boolean;
}

const emptyDraft = (day: number): ActivityDraft => ({
  day_number: day,
  start_time: '',
  title: '',
  description: '',
  owner: 'none',
  provider_id: null,
  supplier_name: '',
  supplier_contact: '',
  cost: null,
  creates_task: false,
  is_public: true,
});

/**
 * Bloque «Itinerario» de la sección «Plan / paquete» (QUI-1060 F2): días 1..N del
 * plan con sus actividades. Cada cambio se guarda al momento contra
 * `/store/service-plans/:id/activities`, igual que tramos y eventos.
 */
@Component({
  selector: 'app-service-plan-itinerary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="space-y-3">
      <h4 class="text-sm font-medium text-text-primary">Itinerario</h4>

      @if (!durationDays()) {
        <p class="text-xs text-text-secondary">
          Indica la duración (días) y guarda el servicio para armar el itinerario.
        </p>
      } @else {
        @if (outside().length > 0) {
          <div class="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-text-primary">
            {{ outside().length === 1 ? 'Una actividad queda' : outside().length + ' actividades quedan' }}
            fuera de la nueva duración ({{ outsideLabel() }}). Muévelas a otro día o elimínalas antes de guardar.
          </div>
        }

        @for (day of days(); track day.day_number) {
          <div class="rounded-lg border border-border p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-text-primary">Día {{ day.day_number }}</span>
              @if (editing() === null) {
                <app-button variant="outline" size="sm" (clicked)="startCreate(day.day_number)">
                  <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                  Agregar actividad
                </app-button>
              }
            </div>

            @if (day.activities.length === 0 && !isCreatingOn(day.day_number)) {
              <p class="text-xs text-text-secondary">Sin actividades.</p>
            }

            @for (act of day.activities; track act.id; let first = $first; let last = $last) {
              @if (editing() === act.id) {
                <ng-container *ngTemplateOutlet="formTpl"></ng-container>
              } @else {
                <div class="flex items-start gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <div class="flex flex-col">
                    <app-button variant="ghost" size="sm" [disabled]="first || busy()" (clicked)="move(act, -1)" ariaLabel="Subir">
                      <app-icon name="chevron-up" [size]="14"></app-icon>
                    </app-button>
                    <app-button variant="ghost" size="sm" [disabled]="last || busy()" (clicked)="move(act, 1)" ariaLabel="Bajar">
                      <app-icon name="chevron-down" [size]="14"></app-icon>
                    </app-button>
                  </div>
                  <div class="min-w-0 flex-1 text-sm">
                    <p class="font-medium text-text-primary break-words">
                      @if (act.start_time) {
                        <span class="text-text-secondary">{{ act.start_time }} ·</span>
                      }
                      {{ act.title }}
                    </p>
                    @if (act.description) {
                      <p class="text-xs text-text-secondary whitespace-pre-line break-words">{{ act.description }}</p>
                    }
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                      @if (ownerLabel(act)) {
                        <span>{{ ownerLabel(act) }}</span>
                      }
                      @if (act.cost != null) {
                        <span>Costo: {{ act.cost | currency }}</span>
                      }
                      @if (act.creates_task) {
                        <span>Crea tarea</span>
                      }
                      @if (!act.is_public) {
                        <span>Solo interno</span>
                      }
                    </div>
                  </div>
                  <div class="flex shrink-0">
                    <app-button variant="ghost" size="sm" [disabled]="busy() || editing() !== null" (clicked)="startEdit(act)" ariaLabel="Editar">
                      <app-icon name="edit" [size]="14"></app-icon>
                    </app-button>
                    <app-button variant="ghost" size="sm" [disabled]="busy()" (clicked)="remove(act)" ariaLabel="Eliminar">
                      <app-icon name="trash-2" [size]="14"></app-icon>
                    </app-button>
                  </div>
                </div>
              }
            }

            @if (isCreatingOn(day.day_number)) {
              <ng-container *ngTemplateOutlet="formTpl"></ng-container>
            }
          </div>
        }

        @if (outside().length > 0) {
          <div class="rounded-lg border border-border p-3 space-y-2">
            <span class="text-sm font-semibold text-text-primary">Fuera de la duración</span>
            @for (act of outside(); track act.id) {
              @if (editing() === act.id) {
                <ng-container *ngTemplateOutlet="formTpl"></ng-container>
              } @else {
                <div class="flex items-center justify-between gap-2 text-sm">
                  <span class="min-w-0 break-words">Día {{ act.day_number }} · {{ act.title }}</span>
                  <div class="flex shrink-0">
                    <app-button variant="ghost" size="sm" [disabled]="busy() || editing() !== null" (clicked)="startEdit(act)" ariaLabel="Editar">
                      <app-icon name="edit" [size]="14"></app-icon>
                    </app-button>
                    <app-button variant="ghost" size="sm" [disabled]="busy()" (clicked)="remove(act)" ariaLabel="Eliminar">
                      <app-icon name="trash-2" [size]="14"></app-icon>
                    </app-button>
                  </div>
                </div>
              }
            }
          </div>
        }
      }
    </div>

    <ng-template #formTpl>
      <div class="space-y-3 rounded-lg bg-surface-secondary p-3">
        <div class="grid grid-cols-1 md:grid-cols-[8rem_1fr_8rem] gap-3">
          <app-input
            label="Hora (opcional)"
            type="time"
            [ngModel]="draft().start_time"
            (ngModelChange)="patch({ start_time: $event ?? '' })"
            customWrapperClass="!mt-0"
          ></app-input>
          <app-input
            label="Título"
            [required]="true"
            placeholder="Ej. Visita a la cascada"
            [ngModel]="draft().title"
            (ngModelChange)="patch({ title: $event ?? '' })"
            customWrapperClass="!mt-0"
          ></app-input>
          <app-selector
            label="Día"
            [options]="dayOptions()"
            [ngModel]="draft().day_number"
            (ngModelChange)="patch({ day_number: toNumber($event) ?? draft().day_number })"
            customWrapperClass="!mt-0"
          ></app-selector>
        </div>
        <app-textarea
          label="Descripción (opcional)"
          [rows]="2"
          [ngModel]="draft().description"
          (ngModelChange)="patch({ description: $event ?? '' })"
          customWrapperClass="!mt-0"
        ></app-textarea>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-selector
            label="Responsable"
            [options]="ownerOptions"
            [ngModel]="draft().owner"
            (ngModelChange)="patch({ owner: $event })"
            customWrapperClass="!mt-0"
          ></app-selector>
          @if (draft().owner === 'internal') {
            <app-selector
              label="Personal de la tienda"
              [options]="providerOptions()"
              placeholder="Elegir responsable"
              [ngModel]="draft().provider_id"
              (ngModelChange)="patch({ provider_id: toNumber($event) })"
              customWrapperClass="!mt-0"
            ></app-selector>
          } @else if (draft().owner === 'supplier') {
            <app-input
              label="Proveedor (tercero)"
              placeholder="Ej. Transportes del Valle"
              [ngModel]="draft().supplier_name"
              (ngModelChange)="patch({ supplier_name: $event ?? '' })"
              customWrapperClass="!mt-0"
            ></app-input>
          }
        </div>
        @if (draft().owner === 'supplier') {
          <app-input
            label="Contacto del proveedor (opcional)"
            placeholder="Teléfono o correo"
            [ngModel]="draft().supplier_contact"
            (ngModelChange)="patch({ supplier_contact: $event ?? '' })"
            customWrapperClass="!mt-0"
          ></app-input>
        }
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <app-input
            label="Costo interno (opcional)"
            [currency]="true"
            [ngModel]="draft().cost"
            (ngModelChange)="patch({ cost: toNumber($event) })"
            customWrapperClass="!mt-0"
          ></app-input>
          <app-toggle
            label="Crear tarea al vender"
            [checked]="draft().creates_task"
            (changed)="patch({ creates_task: $event })"
          ></app-toggle>
          <app-toggle
            label="Visible al cliente"
            [checked]="draft().is_public"
            (changed)="patch({ is_public: $event })"
          ></app-toggle>
        </div>
        <p class="text-xs text-text-secondary">
          El cliente ve hora, título y descripción. Costo y responsable nunca se muestran.
        </p>
        @if (draftError()) {
          <p class="text-xs text-error">{{ draftError() }}</p>
        }
        <div class="flex flex-wrap justify-end gap-2">
          <app-button variant="ghost" size="sm" (clicked)="cancel()">Cancelar</app-button>
          <app-button
            variant="primary"
            size="sm"
            [disabled]="busy() || !!draftError()"
            [loading]="busy()"
            (clicked)="save()"
          >
            Guardar actividad
          </app-button>
        </div>
      </div>
    </ng-template>
  `,
})
export class ServicePlanItineraryComponent {
  private readonly plansService = inject(ServicePlansService);
  private readonly reservationsService = inject(ReservationsService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly productId = input.required<number>();
  /**
   * Duración del plan según el formulario. Si aún no se guardó, el servidor valida
   * el día contra la duración guardada y responde con un mensaje claro.
   */
  readonly durationDays = input<number | null>(null);
  readonly activities = model<PlanActivity[]>([]);

  readonly ownerOptions: SelectorOption[] = [
    { value: 'none', label: 'Sin responsable' },
    { value: 'internal', label: 'Personal propio' },
    { value: 'supplier', label: 'Tercero' },
  ];

  readonly providers = signal<SelectorOption[]>([]);
  readonly providerOptions = computed(() => this.providers());
  private readonly providerNames = computed(
    () => new Map(this.providers().map((p) => [Number(p.value), p.label])),
  );

  readonly busy = signal(false);
  /** `'new'` = alta en `creatingDay`; un id = edición; null = nada abierto. */
  readonly editing = signal<number | 'new' | null>(null);
  readonly creatingDay = signal<number | null>(null);
  readonly draft = signal<ActivityDraft>(emptyDraft(1));

  private readonly effectiveDays = computed(() => Math.max(Math.floor(this.durationDays() ?? 0), 0));

  readonly days = computed(() =>
    groupItineraryByDay(this.activities(), this.effectiveDays(), { includeEmpty: true }),
  );
  readonly outside = computed(() => activitiesOutsideDuration(this.activities(), this.durationDays()));
  readonly outsideLabel = computed(() => {
    const days = [...new Set(this.outside().map((a) => a.day_number))].sort((a, b) => a - b);
    return `día${days.length === 1 ? '' : 's'} ${days.join(', ')}`;
  });
  readonly dayOptions = computed<SelectorOption[]>(() =>
    Array.from({ length: this.effectiveDays() }, (_, i) => ({ value: i + 1, label: `Día ${i + 1}` })),
  );

  readonly draftError = computed(() => {
    const d = this.draft();
    if (!d.title.trim()) return 'El título es obligatorio.';
    if (d.owner === 'internal' && d.provider_id == null) return 'Elige quién de tu equipo es responsable.';
    if (d.owner === 'supplier' && !d.supplier_name.trim()) return 'Escribe el nombre del proveedor.';
    if (d.cost != null && d.cost < 0) return 'El costo no puede ser negativo.';
    return null;
  });

  constructor() {
    this.reservationsService
      .getProviders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) =>
          this.providers.set(
            (list ?? [])
              .filter((p) => p.is_active)
              .map((p) => ({ value: p.id, label: providerDisplayName(p) || `Responsable #${p.id}` })),
          ),
        // Sin permiso de reservas solo se pierde la lista: el resto del bloque funciona.
        error: () => this.providers.set([]),
      });
  }

  isCreatingOn(day: number): boolean {
    return this.editing() === 'new' && this.creatingDay() === day;
  }

  ownerLabel(act: PlanActivity): string {
    if (act.provider_id != null) {
      return `Responsable: ${this.providerNames().get(act.provider_id) ?? `#${act.provider_id}`}`;
    }
    if (act.supplier_name) {
      return `Tercero: ${act.supplier_name}${act.supplier_contact ? ` (${act.supplier_contact})` : ''}`;
    }
    return '';
  }

  startCreate(day: number): void {
    this.draft.set(emptyDraft(day));
    this.creatingDay.set(day);
    this.editing.set('new');
  }

  startEdit(act: PlanActivity): void {
    this.draft.set({
      day_number: act.day_number,
      start_time: act.start_time ?? '',
      title: act.title,
      description: act.description ?? '',
      owner: act.provider_id != null ? 'internal' : act.supplier_name ? 'supplier' : 'none',
      provider_id: act.provider_id,
      supplier_name: act.supplier_name ?? '',
      supplier_contact: act.supplier_contact ?? '',
      cost: act.cost,
      creates_task: act.creates_task,
      is_public: act.is_public,
    });
    this.creatingDay.set(null);
    this.editing.set(act.id);
  }

  patch(value: Partial<ActivityDraft>): void {
    this.draft.set({ ...this.draft(), ...value });
  }

  cancel(): void {
    this.editing.set(null);
    this.creatingDay.set(null);
  }

  save(): void {
    if (this.draftError()) return;
    const editing = this.editing();
    const payload = this.toPayload(this.draft());
    const request$ =
      editing === 'new'
        ? this.plansService.createActivity(this.productId(), payload)
        : this.plansService.updateActivity(this.productId(), editing as number, payload);
    this.busy.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        const rest = this.activities().filter((a) => a.id !== saved.id);
        this.activities.set([...rest, saved]);
        this.busy.set(false);
        this.cancel();
        this.toast.success(editing === 'new' ? 'Actividad agregada' : 'Actividad actualizada');
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(extractApiErrorMessage(err));
      },
    });
  }

  async remove(act: PlanActivity): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Eliminar actividad',
      message: `¿Eliminar «${act.title}» del día ${act.day_number}?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.plansService
      .deleteActivity(this.productId(), act.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.activities.set(this.activities().filter((a) => a.id !== act.id));
          if (this.editing() === act.id) this.cancel();
          this.busy.set(false);
          this.toast.success('Actividad eliminada');
        },
        error: (err) => {
          this.busy.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  /** Sube o baja una actividad dentro de su día y guarda el nuevo orden. */
  move(act: PlanActivity, delta: -1 | 1): void {
    const day = this.days().find((d) => d.day_number === act.day_number);
    if (!day) return;
    const ids = day.activities.map((a) => a.id);
    const from = ids.indexOf(act.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    this.busy.set(true);
    this.plansService
      .reorderActivities(this.productId(), act.day_number, ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dayRows) => {
          const others = this.activities().filter((a) => a.day_number !== act.day_number);
          this.activities.set([...others, ...dayRows]);
          this.busy.set(false);
        },
        error: (err) => {
          this.busy.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** El responsable es interno XOR tercero: el otro lado siempre viaja en null. */
  private toPayload(d: ActivityDraft): PlanActivityInput {
    return {
      day_number: d.day_number,
      start_time: d.start_time ? d.start_time.slice(0, 5) : null,
      title: d.title.trim(),
      description: d.description.trim() || null,
      provider_id: d.owner === 'internal' ? d.provider_id : null,
      supplier_name: d.owner === 'supplier' ? d.supplier_name.trim() || null : null,
      supplier_contact: d.owner === 'supplier' ? d.supplier_contact.trim() || null : null,
      cost: d.cost,
      creates_task: d.creates_task,
      is_public: d.is_public,
    };
  }
}
