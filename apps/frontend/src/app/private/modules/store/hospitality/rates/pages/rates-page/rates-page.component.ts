import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StickyHeaderComponent,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { UnitTypesService } from '../../../rooms/services/unit-types.service';
import { RatePlanFormModalComponent } from '../../components/rate-plan-form-modal/rate-plan-form-modal.component';
import { MEAL_PLAN_LABELS, RatePlan } from '../../interfaces/rate-plan.interface';
import { RatePlansService } from '../../services/rate-plans.service';

interface RatePlanRow extends RatePlan {
  meal_plan_label: string;
  room_types: string;
  status: 'active' | 'inactive';
  default_label: string;
}

/**
 * Hospitality Suite (H2.1) — Tarifas: rate plans ("Solo alojamiento", "Con
 * desayuno") with a nightly price per room type and weekday. The default plan
 * is preselected when booking.
 */
@Component({
  selector: 'app-hospitality-rates-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StickyHeaderComponent,
    EmptyStateComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    RatePlanFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Tarifas"
        subtitle="Planes tarifarios y precio por noche de tu hotel"
        icon="tag"
        variant="glass"
      />

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex items-center justify-between gap-2">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
              >
                Planes tarifarios ({{ plans().length }})
              </h2>
              <app-button variant="primary" size="md" (clicked)="openForm(null)">
                <app-icon slot="icon" name="plus" [size]="16" />
                Nuevo plan
              </app-button>
            </div>
          </div>

          <div class="px-2 pb-2 pt-3 md:px-6 md:pb-6">
            @if (!isLoading() && plans().length === 0) {
              <app-empty-state
                icon="tag"
                title="Aún no tienes planes tarifarios"
                description="Sin planes, cada reserva usa el precio base del tipo de habitación. Crea planes como “Con desayuno” con precio por día de la semana."
                actionButtonText="Nuevo plan"
                actionButtonIcon="plus"
                [showActionButton]="true"
                (actionClick)="openForm(null)"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [loading]="isLoading()"
                [striped]="true"
                [hoverable]="true"
                (rowClick)="openForm($event)"
              />
            }
          </div>
        </app-card>
      </div>

      <app-rate-plan-form-modal
        [isOpen]="isFormOpen()"
        [plan]="editing()"
        [unitTypes]="unitTypes()"
        [hasDefault]="hasDefault()"
        (isOpenChange)="isFormOpen.set($event)"
        (saved)="refresh()"
      />
    </div>
  `,
})
export class HospitalityRatesPageComponent implements OnInit {
  private readonly ratePlansService = inject(RatePlansService);
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly plans = signal<RatePlan[]>([]);
  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  readonly isFormOpen = signal(false);
  readonly editing = signal<RatePlan | null>(null);

  readonly hasDefault = computed(() => this.plans().some((p) => p.is_default));

  readonly rows = computed<RatePlanRow[]>(() => {
    const names = new Map(this.unitTypes().map((t) => [t.id, t.name] as const));
    return this.plans().map((plan) => {
      const typeIds = [
        ...new Set(plan.prices.filter((p) => p.day_of_week === null).map((p) => p.unit_type_id)),
      ];
      return {
        ...plan,
        meal_plan_label: MEAL_PLAN_LABELS[plan.meal_plan] ?? plan.meal_plan,
        room_types: typeIds.map((id) => names.get(id) ?? `Tipo ${id}`).join(', ') || 'Sin precios',
        status: plan.is_active ? 'active' : 'inactive',
        default_label: plan.is_default ? 'Sí' : '',
      };
    });
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Plan', sortable: true },
    { key: 'meal_plan_label', label: 'Régimen' },
    { key: 'room_types', label: 'Tipos con precio' },
    { key: 'default_label', label: 'Predeterminado', align: 'center' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => (value === 'active' ? 'Activo' : 'Inactivo'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'meal_plan_label',
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (value: string) => (value === 'active' ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'room_types', label: 'Tipos' },
      { key: 'default_label', label: 'Predeterminado' },
    ],
  };

  ngOnInit(): void {
    this.refresh();
    this.unitTypesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.unitTypes.set(list),
        error: (message: unknown) =>
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar los tipos de habitación',
          ),
      });
  }

  refresh(): void {
    this.isLoading.set(true);
    this.ratePlansService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plans) => {
          this.plans.set(plans);
          this.isLoading.set(false);
        },
        error: (message: unknown) => {
          this.isLoading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar los planes tarifarios',
          );
        },
      });
  }

  openForm(plan: RatePlan | null): void {
    this.editing.set(plan ? (this.plans().find((p) => p.id === plan.id) ?? null) : null);
    this.isFormOpen.set(true);
  }
}
