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
import { CancellationPolicyFormModalComponent } from '../../components/cancellation-policy-form-modal/cancellation-policy-form-modal.component';
import { RatePlanFormModalComponent } from '../../components/rate-plan-form-modal/rate-plan-form-modal.component';
import { RatesCalendarComponent } from '../../components/rates-calendar/rates-calendar.component';
import { RestrictionFormModalComponent } from '../../components/restriction-form-modal/restriction-form-modal.component';
import { SeasonFormModalComponent } from '../../components/season-form-modal/season-form-modal.component';
import {
  CancellationPolicy,
  describePolicy,
  LodgingRestriction,
  MEAL_PLAN_LABELS,
  RatePlan,
  Season,
  seasonRange,
} from '../../interfaces/rate-plan.interface';
import { CancellationPoliciesService } from '../../services/cancellation-policies.service';
import { RatePlansService } from '../../services/rate-plans.service';
import { RestrictionsService } from '../../services/restrictions.service';
import { SeasonsService } from '../../services/seasons.service';

interface RatePlanRow extends RatePlan {
  meal_plan_label: string;
  room_types: string;
  policy_label: string;
  status: 'active' | 'inactive';
  default_label: string;
}

interface PolicyRow extends CancellationPolicy {
  description: string;
  plans_label: string;
  status: 'active' | 'inactive';
}

interface SeasonRow extends Season {
  range: string;
  status: 'active' | 'inactive';
}

/**
 * Hospitality Suite (H2.1, H2.2) — Tarifas: rate plans ("Solo alojamiento",
 * "Con desayuno") with a nightly price per room type and weekday, demand
 * seasons ("Alta") priced inside each plan, and the rates calendar colored by
 * season. The default plan is preselected when booking. H2.3: clicking a
 * night of the calendar sets its stay restrictions (min stay, CTA/CTD, stop-sell).
 * H2.4: cancellation policies, assigned to each plan with its deposit percent.
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
    SeasonFormModalComponent,
    RatesCalendarComponent,
    RestrictionFormModalComponent,
    CancellationPolicyFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Tarifas"
        subtitle="Planes tarifarios, temporadas y precio por noche de tu hotel"
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

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex items-center justify-between gap-2">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
              >
                Temporadas ({{ seasons().length }})
              </h2>
              <app-button variant="outline" size="md" (clicked)="openSeasonForm(null)">
                <app-icon slot="icon" name="plus" [size]="16" />
                Nueva temporada
              </app-button>
            </div>
          </div>

          <div class="px-2 pb-2 pt-3 md:px-6 md:pb-6">
            @if (!seasonsLoading() && seasons().length === 0) {
              <app-empty-state
                icon="calendar-days"
                title="Aún no tienes temporadas"
                description="Define fechas de alta demanda (ej. Alta: 15-dic al 15-ene) y ponles precio propio en cada plan."
                actionButtonText="Nueva temporada"
                actionButtonIcon="plus"
                [showActionButton]="true"
                (actionClick)="openSeasonForm(null)"
              />
            } @else {
              <app-responsive-data-view
                [data]="seasonRows()"
                [columns]="seasonColumns"
                [cardConfig]="seasonCardConfig"
                [loading]="seasonsLoading()"
                [striped]="true"
                [hoverable]="true"
                (rowClick)="openSeasonForm($event)"
              />
            }
          </div>
        </app-card>
      </div>

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex items-center justify-between gap-2">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
              >
                Políticas de cancelación ({{ policies().length }})
              </h2>
              <app-button variant="outline" size="md" (clicked)="openPolicyForm(null)">
                <app-icon slot="icon" name="plus" [size]="16" />
                Nueva política
              </app-button>
            </div>
          </div>

          <div class="px-2 pb-2 pt-3 md:px-6 md:pb-6">
            @if (!policiesLoading() && policies().length === 0) {
              <app-empty-state
                icon="shield-check"
                title="Aún no tienes políticas de cancelación"
                description="Define lo que pierde el huésped si cancela (ej. Flexible: gratis hasta 48 h, luego 1 noche) y asígnala a cada plan junto con el depósito exigido."
                actionButtonText="Nueva política"
                actionButtonIcon="plus"
                [showActionButton]="true"
                (actionClick)="openPolicyForm(null)"
              />
            } @else {
              <app-responsive-data-view
                [data]="policyRows()"
                [columns]="policyColumns"
                [cardConfig]="policyCardConfig"
                [loading]="policiesLoading()"
                [striped]="true"
                [hoverable]="true"
                (rowClick)="openPolicyForm($event)"
              />
            }
          </div>
        </app-card>
      </div>

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Calendario de tarifas
            </h2>
          </div>
          <div class="px-2 pb-2 pt-3 md:px-6 md:pb-6">
            <app-rates-calendar
              [seasons]="seasons()"
              [restrictions]="restrictions()"
              [unitTypeNames]="unitTypeNames()"
              (monthChanged)="loadRestrictions($event)"
              (daySelected)="openRestrictionForm($event)"
            />
          </div>
        </app-card>
      </div>

      <app-rate-plan-form-modal
        [isOpen]="isFormOpen()"
        [plan]="editing()"
        [unitTypes]="unitTypes()"
        [seasons]="seasons()"
        [hasDefault]="hasDefault()"
        [policies]="policies()"
        (isOpenChange)="isFormOpen.set($event)"
        (saved)="refresh()"
      />

      <app-cancellation-policy-form-modal
        [isOpen]="isPolicyFormOpen()"
        [policy]="editingPolicy()"
        (isOpenChange)="isPolicyFormOpen.set($event)"
        (saved)="refreshPolicies(); refresh()"
      />

      <app-restriction-form-modal
        [isOpen]="isRestrictionFormOpen()"
        [date]="restrictionDate()"
        [unitTypes]="unitTypes()"
        [restrictions]="restrictions()"
        (isOpenChange)="isRestrictionFormOpen.set($event)"
        (saved)="reloadRestrictions()"
      />

      <app-season-form-modal
        [isOpen]="isSeasonFormOpen()"
        [season]="editingSeason()"
        (isOpenChange)="isSeasonFormOpen.set($event)"
        (saved)="refreshSeasons()"
      />
    </div>
  `,
})
export class HospitalityRatesPageComponent implements OnInit {
  private readonly ratePlansService = inject(RatePlansService);
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly seasonsService = inject(SeasonsService);
  private readonly restrictionsService = inject(RestrictionsService);
  private readonly policiesService = inject(CancellationPoliciesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly plans = signal<RatePlan[]>([]);
  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  readonly isFormOpen = signal(false);
  readonly editing = signal<RatePlan | null>(null);
  readonly seasons = signal<Season[]>([]);
  readonly seasonsLoading = signal(true);
  readonly isSeasonFormOpen = signal(false);
  readonly editingSeason = signal<Season | null>(null);
  /** H2.3 — restrictions of the month shown in the calendar. */
  readonly restrictions = signal<LodgingRestriction[]>([]);
  private readonly restrictionMonth = signal<{ from: string; to: string } | null>(null);
  readonly isRestrictionFormOpen = signal(false);
  readonly restrictionDate = signal<string | null>(null);
  /** H2.4 — cancellation policies of the store. */
  readonly policies = signal<CancellationPolicy[]>([]);
  readonly policiesLoading = signal(true);
  readonly isPolicyFormOpen = signal(false);
  readonly editingPolicy = signal<CancellationPolicy | null>(null);

  readonly unitTypeNames = computed(
    () => new Map(this.unitTypes().map((t) => [t.id, t.name] as const)),
  );

  readonly hasDefault = computed(() => this.plans().some((p) => p.is_default));

  readonly rows = computed<RatePlanRow[]>(() => {
    const names = new Map(this.unitTypes().map((t) => [t.id, t.name] as const));
    return this.plans().map((plan) => {
      const typeIds = [
        ...new Set(
          plan.prices
            .filter((p) => p.day_of_week === null && p.season_id === null)
            .map((p) => p.unit_type_id),
        ),
      ];
      return {
        ...plan,
        meal_plan_label: MEAL_PLAN_LABELS[plan.meal_plan] ?? plan.meal_plan,
        room_types: typeIds.map((id) => names.get(id) ?? `Tipo ${id}`).join(', ') || 'Sin precios',
        policy_label: policyLabel(plan),
        status: plan.is_active ? 'active' : 'inactive',
        default_label: plan.is_default ? 'Sí' : '',
      };
    });
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Plan', sortable: true },
    { key: 'meal_plan_label', label: 'Régimen' },
    { key: 'room_types', label: 'Tipos con precio' },
    { key: 'policy_label', label: 'Cancelación y depósito' },
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
      { key: 'policy_label', label: 'Cancelación' },
      { key: 'default_label', label: 'Predeterminado' },
    ],
  };

  readonly policyRows = computed<PolicyRow[]>(() =>
    this.policies().map((policy) => {
      const plans = this.plans().filter((plan) => plan.cancellation_policy_id === policy.id);
      return {
        ...policy,
        description: describePolicy(policy),
        plans_label: plans.map((plan) => plan.name).join(', ') || 'Ningún plan',
        status: policy.is_active ? 'active' : 'inactive',
      };
    }),
  );

  readonly policyColumns: TableColumn[] = [
    { key: 'name', label: 'Política', sortable: true },
    { key: 'description', label: 'Condiciones' },
    { key: 'plans_label', label: 'Planes' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly policyCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    detailKeys: [{ key: 'plans_label', label: 'Planes' }],
  };

  readonly seasonRows = computed<SeasonRow[]>(() =>
    this.seasons().map((season) => ({
      ...season,
      range: seasonRange(season),
      status: season.is_active ? 'active' : 'inactive',
    })),
  );

  readonly seasonColumns: TableColumn[] = [
    { key: 'name', label: 'Temporada', sortable: true },
    { key: 'range', label: 'Noches' },
    { key: 'priority', label: 'Prioridad', align: 'center' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly seasonCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'range',
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    detailKeys: [{ key: 'priority', label: 'Prioridad' }],
  };

  ngOnInit(): void {
    this.refresh();
    this.refreshSeasons();
    this.refreshPolicies();
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

  refreshSeasons(): void {
    this.seasonsLoading.set(true);
    this.seasonsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (seasons) => {
          this.seasons.set(seasons);
          this.seasonsLoading.set(false);
        },
        error: (message: unknown) => {
          this.seasonsLoading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar las temporadas',
          );
        },
      });
  }

  refreshPolicies(): void {
    this.policiesLoading.set(true);
    this.policiesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policies) => {
          this.policies.set(policies);
          this.policiesLoading.set(false);
        },
        error: (message: unknown) => {
          this.policiesLoading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar las políticas',
          );
        },
      });
  }

  openPolicyForm(policy: CancellationPolicy | null): void {
    this.editingPolicy.set(
      policy ? (this.policies().find((p) => p.id === policy.id) ?? null) : null,
    );
    this.isPolicyFormOpen.set(true);
  }

  loadRestrictions(month: { from: string; to: string }): void {
    this.restrictionMonth.set(month);
    this.restrictionsService
      .list(month.from, month.to)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          // A late answer for a month already left behind is dropped.
          if (this.restrictionMonth() === month) this.restrictions.set(rows);
        },
        error: (message: unknown) =>
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar las restricciones',
          ),
      });
  }

  reloadRestrictions(): void {
    const month = this.restrictionMonth();
    if (month) this.loadRestrictions(month);
  }

  openRestrictionForm(date: string): void {
    this.restrictionDate.set(date);
    this.isRestrictionFormOpen.set(true);
  }

  openSeasonForm(season: Season | null): void {
    this.editingSeason.set(
      season ? (this.seasons().find((s) => s.id === season.id) ?? null) : null,
    );
    this.isSeasonFormOpen.set(true);
  }

  openForm(plan: RatePlan | null): void {
    this.editing.set(plan ? (this.plans().find((p) => p.id === plan.id) ?? null) : null);
    this.isFormOpen.set(true);
  }
}

/** H2.4 — "Flexible · depósito 30 %" for the plans list. */
function policyLabel(plan: RatePlan): string {
  const deposit = Number(plan.deposit_percent ?? 0);
  const policy = plan.cancellation_policy?.name ?? 'Sin política';
  return deposit > 0 ? `${policy} · depósito ${deposit} %` : policy;
}
