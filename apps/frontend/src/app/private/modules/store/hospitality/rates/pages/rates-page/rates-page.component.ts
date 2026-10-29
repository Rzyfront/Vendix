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
import { Observable } from 'rxjs';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { UnitTypesService } from '../../../rooms/services/unit-types.service';
import {
  AllotmentFormModalComponent,
  customerName,
} from '../../components/allotment-form-modal/allotment-form-modal.component';
import { CancellationPolicyFormModalComponent } from '../../components/cancellation-policy-form-modal/cancellation-policy-form-modal.component';
import { RatePlanFormModalComponent } from '../../components/rate-plan-form-modal/rate-plan-form-modal.component';
import { RatesCalendarComponent } from '../../components/rates-calendar/rates-calendar.component';
import { RestrictionFormModalComponent } from '../../components/restriction-form-modal/restriction-form-modal.component';
import { SeasonFormModalComponent } from '../../components/season-form-modal/season-form-modal.component';
import {
  Allotment,
  CancellationPolicy,
  describePolicy,
  LodgingRestriction,
  MEAL_PLAN_LABELS,
  RatePlan,
  Season,
  seasonRange,
} from '../../interfaces/rate-plan.interface';
import { AllotmentsService } from '../../services/allotments.service';
import { CancellationPoliciesService } from '../../services/cancellation-policies.service';
import { RatePlansService } from '../../services/rate-plans.service';
import { RestrictionsService } from '../../services/restrictions.service';
import { SeasonsService } from '../../services/seasons.service';

type RatesTab = 'plans' | 'seasons' | 'policies' | 'allotments' | 'calendar';

const TAB_TITLES: Record<RatesTab, string> = {
  plans: 'Planes tarifarios',
  seasons: 'Temporadas',
  policies: 'Políticas de cancelación',
  allotments: 'Cupos para agencias',
  calendar: 'Calendario de tarifas',
};

const SEARCH_PLACEHOLDERS: Record<RatesTab, string> = {
  plans: 'Buscar planes...',
  seasons: 'Buscar temporadas...',
  policies: 'Buscar políticas...',
  allotments: 'Buscar cupos...',
  calendar: '',
};

/** R-CTA-03 — the create button names the noun of the active tab. */
const CREATE_LABELS: Partial<Record<RatesTab, string>> = {
  plans: 'Nuevo plan',
  seasons: 'Nueva temporada',
  policies: 'Nueva política',
  allotments: 'Nuevo cupo',
};

/** Masculine/feminine active badge for plans/cupos and seasons/policies. */
const STATUS_BADGE = {
  type: 'custom' as const,
  size: 'sm' as const,
  colorMap: { active: 'var(--color-success)', inactive: 'var(--color-text-secondary)' },
};

const STATUS_FILTER: FilterConfig = {
  key: 'status',
  label: 'Estado',
  type: 'select',
  options: [
    { value: '', label: 'Todos' },
    { value: 'active', label: 'Activos' },
    { value: 'inactive', label: 'Inactivos' },
  ],
};

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

/** "1 plan con política" / "3 planes con política". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

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

interface AllotmentRow extends Allotment {
  agency: string;
  type_name: string;
  range: string;
  rooms_label: string;
  release_label: string;
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
 * H2.5: allotments (cupos) that hold rooms for an agency until their release.
 *
 * Standard admin list module: four stats, tabs (plans, seasons, policies,
 * allotments, calendar) and one card per tab with the sticky search, the
 * create button of the active tab, the filters dropdown and the responsive
 * data view. Every row edits and activates/deactivates in place (U10).
 * Each list is the hotel's whole configuration (tens of rows), so search and
 * filters run client-side.
 */
@Component({
  selector: 'app-hospitality-rates-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    StatsComponent,
    EmptyStateComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ScrollableTabsComponent,
    ResponsiveDataViewComponent,
    RatePlanFormModalComponent,
    SeasonFormModalComponent,
    AllotmentFormModalComponent,
    RatesCalendarComponent,
    RestrictionFormModalComponent,
    CancellationPolicyFormModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Planes activos"
          [value]="stats().activePlans"
          [smallText]="stats().defaultPlan"
          iconName="tag"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="isLoading()"
        />
        <app-stats
          title="Temporadas"
          [value]="stats().activeSeasons"
          [smallText]="'activas de ' + stats().totalSeasons + ' registradas'"
          iconName="calendar-days"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="seasonsLoading()"
        />
        <app-stats
          title="Políticas activas"
          [value]="stats().activePolicies"
          [smallText]="stats().policiesInUse"
          iconName="shield-check"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="policiesLoading()"
        />
        <app-stats
          title="Cupos activos"
          [value]="stats().activeAllotments"
          [smallText]="stats().heldRooms"
          iconName="building-2"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="allotmentsLoading()"
        />
      </div>

      <!-- Tabs -->
      <app-scrollable-tabs
        [tabs]="tabs"
        [activeTab]="activeTab()"
        (tabChange)="onTabChange($event)"
        ariaLabel="Secciones de tarifas"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Sticky search header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              {{ title() }}
              @if (count() !== null) {
                <span class="text-text-secondary font-normal">({{ count() }})</span>
              }
            </h2>

            @if (activeTab() !== 'calendar') {
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  [placeholder]="searchPlaceholder()"
                  [debounceTime]="300"
                  [ngModel]="searchTerm()"
                  (ngModelChange)="searchTerm.set($event ?? '')"
                />
                <!-- R-CTA-01..03/08: the create button follows the active tab. -->
                @if (canWrite() && createLabel(); as label) {
                  <app-button
                    variant="primary"
                    size="md"
                    [iconOnlyMobile]="true"
                    customClasses="!h-11 !w-11 !px-0 md:!w-auto md:!px-4 !rounded-[10px]"
                    class="shrink-0"
                    [ariaLabel]="label"
                    (clicked)="openCreate()"
                    data-testid="rates-new"
                  >
                    <app-icon slot="icon" name="plus" [size]="18" />
                    {{ label }}
                  </app-button>
                }
                <app-options-dropdown
                  class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  [filters]="filterConfigs()"
                  [filterValues]="filterValues()"
                  [isLoading]="activeLoading()"
                  (filterChange)="filterValues.set($event)"
                  (clearAllFilters)="filterValues.set({})"
                />
              </div>
            }
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @switch (activeTab()) {
            @case ('plans') {
              @if (!isLoading() && plans().length === 0) {
                <app-empty-state
                  icon="tag"
                  title="Aún no tienes planes tarifarios"
                  description="Sin planes, cada reserva usa el precio base del tipo de habitación. Crea planes como “Con desayuno” con precio por día de la semana."
                  actionButtonText="Nuevo plan"
                  actionButtonIcon="plus"
                  [showActionButton]="canWrite()"
                  (actionClick)="openForm(null)"
                />
              } @else {
                <app-responsive-data-view
                  [data]="rows()"
                  [actions]="planActions"
                  [columns]="columns"
                  [cardConfig]="cardConfig"
                  [loading]="isLoading()"
                  [striped]="true"
                  [hoverable]="true"
                  emptyMessage="No hay planes con ese criterio"
                  emptyIcon="search"
                  (rowClick)="openForm($event)"
                />
              }
            }
            @case ('seasons') {
              @if (!seasonsLoading() && seasons().length === 0) {
                <app-empty-state
                  icon="calendar-days"
                  title="Aún no tienes temporadas"
                  description="Define fechas de alta demanda (ej. Alta: 15-dic al 15-ene) y ponles precio propio en cada plan."
                  actionButtonText="Nueva temporada"
                  actionButtonIcon="plus"
                  [showActionButton]="canWrite()"
                  (actionClick)="openSeasonForm(null)"
                />
              } @else {
                <app-responsive-data-view
                  [data]="seasonRows()"
                  [actions]="seasonActions"
                  [columns]="seasonColumns"
                  [cardConfig]="seasonCardConfig"
                  [loading]="seasonsLoading()"
                  [striped]="true"
                  [hoverable]="true"
                  emptyMessage="No hay temporadas con ese criterio"
                  emptyIcon="search"
                  (rowClick)="openSeasonForm($event)"
                />
              }
            }
            @case ('policies') {
              @if (!policiesLoading() && policies().length === 0) {
                <app-empty-state
                  icon="shield-check"
                  title="Aún no tienes políticas de cancelación"
                  description="Define lo que pierde el huésped si cancela (ej. Flexible: gratis hasta 48 h, luego 1 noche) y asígnala a cada plan junto con el depósito exigido."
                  actionButtonText="Nueva política"
                  actionButtonIcon="plus"
                  [showActionButton]="canWrite()"
                  (actionClick)="openPolicyForm(null)"
                />
              } @else {
                <app-responsive-data-view
                  [data]="policyRows()"
                  [actions]="policyActions"
                  [columns]="policyColumns"
                  [cardConfig]="policyCardConfig"
                  [loading]="policiesLoading()"
                  [striped]="true"
                  [hoverable]="true"
                  emptyMessage="No hay políticas con ese criterio"
                  emptyIcon="search"
                  (rowClick)="openPolicyForm($event)"
                />
              }
            }
            @case ('allotments') {
              @if (!allotmentsLoading() && allotments().length === 0) {
                <app-empty-state
                  icon="building-2"
                  title="Aún no tienes cupos"
                  description="Reserva habitaciones para una agencia o empresa (ej. Viajes X: 3 Dobles en diciembre) con fecha de liberación, para garantizarle disponibilidad sin bloquear el inventario."
                  actionButtonText="Nuevo cupo"
                  actionButtonIcon="plus"
                  [showActionButton]="canWrite()"
                  (actionClick)="openAllotmentForm(null)"
                />
              } @else {
                <app-responsive-data-view
                  [data]="allotmentRows()"
                  [actions]="allotmentActions"
                  [columns]="allotmentColumns"
                  [cardConfig]="allotmentCardConfig"
                  [loading]="allotmentsLoading()"
                  [striped]="true"
                  [hoverable]="true"
                  emptyMessage="No hay cupos con ese criterio"
                  emptyIcon="search"
                  (rowClick)="openAllotmentForm($event)"
                />
              }
            }
            @case ('calendar') {
              <app-rates-calendar
                [seasons]="seasons()"
                [restrictions]="restrictions()"
                [unitTypeNames]="unitTypeNames()"
                (monthChanged)="loadRestrictions($event)"
                (daySelected)="canWrite() && openRestrictionForm($event)"
              />
            }
          }
        </div>
      </app-card>

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

      <app-allotment-form-modal
        [isOpen]="isAllotmentFormOpen()"
        [allotment]="editingAllotment()"
        [unitTypes]="unitTypes()"
        (isOpenChange)="isAllotmentFormOpen.set($event)"
        (saved)="refreshAllotments()"
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
  private readonly allotmentsService = inject(AllotmentsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);

  /** Without rates:write the page only reads: no create, edit or toggle. */
  readonly canWrite = computed(() => this.authFacade.hasPermission('store:lodging:rates:write'));

  readonly plans = signal<RatePlan[]>([]);
  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  readonly isFormOpen = signal(false);
  readonly editing = signal<RatePlan | null>(null);
  readonly allotments = signal<Allotment[]>([]);
  readonly allotmentsLoading = signal(true);
  readonly isAllotmentFormOpen = signal(false);
  readonly editingAllotment = signal<Allotment | null>(null);
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

  readonly tabs: ScrollableTab[] = [
    { id: 'plans', label: 'Planes', icon: 'tag' },
    { id: 'seasons', label: 'Temporadas', icon: 'calendar-days' },
    { id: 'policies', label: 'Políticas', icon: 'shield-check' },
    { id: 'allotments', label: 'Cupos para agencias', icon: 'building-2' },
    { id: 'calendar', label: 'Calendario', icon: 'calendar-check' },
  ];
  readonly activeTab = signal<RatesTab>('plans');
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

  readonly title = computed(() => TAB_TITLES[this.activeTab()]);
  readonly searchPlaceholder = computed(() => SEARCH_PLACEHOLDERS[this.activeTab()]);

  /** Rows shown in the active tab, or null for the calendar. */
  readonly count = computed<number | null>(() => {
    switch (this.activeTab()) {
      case 'plans':
        return this.rows().length;
      case 'seasons':
        return this.seasonRows().length;
      case 'policies':
        return this.policyRows().length;
      case 'allotments':
        return this.allotmentRows().length;
      default:
        return null;
    }
  });

  readonly activeLoading = computed(() => {
    switch (this.activeTab()) {
      case 'seasons':
        return this.seasonsLoading();
      case 'policies':
        return this.policiesLoading();
      case 'allotments':
        return this.allotmentsLoading();
      default:
        return this.isLoading();
    }
  });

  readonly createLabel = computed(() => CREATE_LABELS[this.activeTab()] ?? null);

  readonly filterConfigs = computed<FilterConfig[]>(() => {
    switch (this.activeTab()) {
      case 'plans':
        return [
          {
            key: 'meal_plan',
            label: 'Plan de comidas',
            type: 'select',
            options: [
              { value: '', label: 'Todos' },
              ...Object.entries(MEAL_PLAN_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
          STATUS_FILTER,
        ];
      case 'allotments':
        return [
          {
            key: 'unit_type_id',
            label: 'Tipo',
            type: 'select',
            options: [
              { value: '', label: 'Todos los tipos' },
              ...this.unitTypes().map((t) => ({ value: String(t.id), label: t.name })),
            ],
          },
          STATUS_FILTER,
        ];
      default:
        return [STATUS_FILTER];
    }
  });

  readonly stats = computed(() => {
    const plans = this.plans();
    const defaultPlan = plans.find((p) => p.is_default);
    const activeAllotments = this.allotments().filter((a) => a.is_active);
    const policies = this.policies();
    const usedPolicyIds = new Set(plans.map((p) => p.cancellation_policy_id));
    return {
      activePlans: plans.filter((p) => p.is_active).length,
      defaultPlan: defaultPlan ? `Predeterminado: ${defaultPlan.name}` : 'Sin plan predeterminado',
      activeSeasons: this.seasons().filter((s) => s.is_active).length,
      totalSeasons: this.seasons().length,
      activePolicies: policies.filter((p) => p.is_active).length,
      // TR5 — "2 políticas · 1 en uso": registered policies and those some plan uses.
      policiesInUse: `${plural(policies.length, 'política', 'políticas')} · ${
        policies.filter((p) => usedPolicyIds.has(p.id)).length
      } en uso`,
      activeAllotments: activeAllotments.length,
      heldRooms: plural(
        activeAllotments.reduce((sum, a) => sum + a.rooms, 0),
        'habitación reservada',
        'habitaciones reservadas',
      ),
    };
  });

  /** Search + status filter shared by every list tab. */
  private keep(isActive: boolean, ...values: (string | null | undefined)[]): boolean {
    const status = this.filterValues()['status'];
    if (status === 'active' && !isActive) return false;
    if (status === 'inactive' && isActive) return false;
    return matches(this.searchTerm(), ...values);
  }

  readonly unitTypeNames = computed(
    () => new Map(this.unitTypes().map((t) => [t.id, t.name] as const)),
  );

  readonly hasDefault = computed(() => this.plans().some((p) => p.is_default));

  readonly rows = computed<RatePlanRow[]>(() => {
    const names = new Map(this.unitTypes().map((t) => [t.id, t.name] as const));
    const mealPlan = this.filterValues()['meal_plan'];
    return this.plans().flatMap((plan) => {
      const typeIds = [
        ...new Set(
          plan.prices
            .filter((p) => p.day_of_week === null && p.season_id === null)
            .map((p) => p.unit_type_id),
        ),
      ];
      const row: RatePlanRow = {
        ...plan,
        meal_plan_label: MEAL_PLAN_LABELS[plan.meal_plan] ?? plan.meal_plan,
        room_types: typeIds.map((id) => names.get(id) ?? `Tipo ${id}`).join(', ') || 'Sin precios',
        policy_label: policyLabel(plan),
        status: plan.is_active ? 'active' : 'inactive',
        default_label: plan.is_default ? 'Sí' : '',
      };
      const visible =
        (!mealPlan || plan.meal_plan === mealPlan) &&
        this.keep(plan.is_active, row.name, row.room_types, row.meal_plan_label);
      return visible ? [row] : [];
    });
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Plan', sortable: true },
    { key: 'meal_plan_label', label: 'Plan de comidas' },
    { key: 'room_types', label: 'Tipos con precio' },
    { key: 'policy_label', label: 'Cancelación y depósito' },
    { key: 'default_label', label: 'Predeterminado', align: 'center' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: STATUS_BADGE,
      transform: (value: string) => (value === 'active' ? 'Activo' : 'Inactivo'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'meal_plan_label',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: string) => (value === 'active' ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'room_types', label: 'Tipos' },
      { key: 'policy_label', label: 'Cancelación' },
      { key: 'default_label', label: 'Predeterminado' },
    ],
  };

  readonly policyRows = computed<PolicyRow[]>(() =>
    this.policies().flatMap((policy) => {
      const plans = this.plans().filter((plan) => plan.cancellation_policy_id === policy.id);
      const row: PolicyRow = {
        ...policy,
        description: describePolicy(policy),
        plans_label: plans.map((plan) => plan.name).join(', ') || 'Ningún plan',
        status: policy.is_active ? 'active' : 'inactive',
      };
      return this.keep(policy.is_active, row.name, row.plans_label) ? [row] : [];
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
      badgeConfig: STATUS_BADGE,
      transform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly policyCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    detailKeys: [{ key: 'plans_label', label: 'Planes' }],
  };

  /** H2.5 — "Viajes X · Doble · 1-dic → 31-dic · 3 hab. · libera 7 días antes". */
  readonly allotmentRows = computed<AllotmentRow[]>(() => {
    const typeId = this.filterValues()['unit_type_id'];
    return this.allotments()
      .filter((a) => !typeId || String(a.unit_type.id) === typeId)
      .map((a): AllotmentRow => ({
        ...a,
        agency: customerName(a.customer),
        type_name: a.unit_type.name,
        range: seasonRange(a),
        rooms_label: `${a.rooms} hab.`,
        release_label: a.release_days === 1 ? '1 día antes' : `${a.release_days} días antes`,
        status: a.is_active ? 'active' : 'inactive',
      }))
      .filter((row) => this.keep(row.is_active, row.agency, row.type_name));
  });

  readonly allotmentColumns: TableColumn[] = [
    { key: 'agency', label: 'Agencia o empresa', sortable: true },
    { key: 'type_name', label: 'Tipo' },
    { key: 'range', label: 'Noches' },
    { key: 'rooms_label', label: 'Habitaciones', align: 'center' },
    { key: 'release_label', label: 'Liberación' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: STATUS_BADGE,
      transform: (value: string) => (value === 'active' ? 'Activo' : 'Inactivo'),
    },
  ];

  readonly allotmentCardConfig: ItemListCardConfig = {
    titleKey: 'agency',
    subtitleKey: 'range',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: string) => (value === 'active' ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'type_name', label: 'Tipo' },
      { key: 'rooms_label', label: 'Habitaciones' },
      { key: 'release_label', label: 'Liberación' },
    ],
  };

  readonly seasonRows = computed<SeasonRow[]>(() =>
    this.seasons()
      .filter((season) => this.keep(season.is_active, season.name))
      .map((season) => ({
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
      badgeConfig: STATUS_BADGE,
      transform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly seasonCardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'range',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: string) => (value === 'active' ? 'Activa' : 'Inactiva'),
    detailKeys: [{ key: 'priority', label: 'Prioridad' }],
  };

  ngOnInit(): void {
    this.refresh();
    this.refreshSeasons();
    this.refreshPolicies();
    this.refreshAllotments();
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

  refreshAllotments(): void {
    this.allotmentsLoading.set(true);
    this.allotmentsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (allotments) => {
          this.allotments.set(allotments);
          this.allotmentsLoading.set(false);
        },
        error: (message: unknown) => {
          this.allotmentsLoading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar los cupos',
          );
        },
      });
  }

  onTabChange(tab: string): void {
    this.activeTab.set(
      (['plans', 'seasons', 'policies', 'allotments', 'calendar'] as const).find(
        (t) => t === tab,
      ) ?? 'plans',
    );
    this.searchTerm.set('');
    this.filterValues.set({});
  }

  openCreate(): void {
    switch (this.activeTab()) {
      case 'plans':
        return this.openForm(null);
      case 'seasons':
        return this.openSeasonForm(null);
      case 'policies':
        return this.openPolicyForm(null);
      case 'allotments':
        return this.openAllotmentForm(null);
    }
  }

  /** R-ROW-04 — "Editar" and "Activar/Desactivar" on every row of a list tab. */
  private rowActions<T extends { is_active: boolean }>(
    edit: (item: T) => void,
    toggle: (item: T) => void,
  ): TableAction[] {
    return [
      {
        label: 'Editar',
        icon: 'edit-2',
        variant: 'primary',
        show: () => this.canWrite(),
        action: edit,
      },
      {
        label: (item: T) => (item.is_active ? 'Desactivar' : 'Activar'),
        icon: (item: T) => (item.is_active ? 'eye-off' : 'eye'),
        variant: 'secondary',
        show: () => this.canWrite(),
        action: toggle,
      },
    ];
  }

  readonly planActions = this.rowActions<RatePlanRow>(
    (row) => this.openForm(row),
    (row) =>
      this.toggleActive(row, {
        title: '¿Desactivar el plan?',
        message: `El plan ${row.name} no se ofrecerá en nuevas reservas hasta que lo reactives.${
          row.is_default ? ' Dejará de ser el plan predeterminado.' : ''
        }`,
        done: (active) => (active ? 'Plan activado' : 'Plan desactivado'),
        failed: 'No se pudo actualizar el plan',
        save: (is_active) => this.ratePlansService.update(row.id, { is_active }),
        reload: () => this.refresh(),
      }),
  );

  readonly seasonActions = this.rowActions<SeasonRow>(
    (row) => this.openSeasonForm(row),
    (row) =>
      this.toggleActive(row, {
        title: '¿Desactivar la temporada?',
        message: `Las noches de ${row.name} (${row.range}) volverán al precio normal hasta que la reactives.`,
        done: (active) => (active ? 'Temporada activada' : 'Temporada desactivada'),
        failed: 'No se pudo actualizar la temporada',
        save: (is_active) => this.seasonsService.update(row.id, { is_active }),
        reload: () => this.refreshSeasons(),
      }),
  );

  readonly policyActions = this.rowActions<PolicyRow>(
    (row) => this.openPolicyForm(row),
    (row) =>
      this.toggleActive(row, {
        title: '¿Desactivar la política?',
        message: `${row.name} no se podrá asignar a otros planes hasta que la reactives. Los planes que ya la usan la conservan.`,
        done: (active) => (active ? 'Política activada' : 'Política desactivada'),
        failed: 'No se pudo actualizar la política',
        save: (is_active) => this.policiesService.update(row.id, { is_active }),
        reload: () => {
          this.refreshPolicies();
          this.refresh();
        },
      }),
  );

  readonly allotmentActions = this.rowActions<AllotmentRow>(
    (row) => this.openAllotmentForm(row),
    (row) =>
      this.toggleActive(row, {
        title: '¿Desactivar el cupo?',
        message: `${plural(row.rooms, 'habitación guardada', 'habitaciones guardadas')} para ${row.agency} (${row.range}) ${row.rooms === 1 ? 'vuelve' : 'vuelven'} a la venta libre.`,
        done: (active) => (active ? 'Cupo activado' : 'Cupo desactivado'),
        failed: 'No se pudo actualizar el cupo',
        save: (is_active) => this.allotmentsService.update(row.id, { is_active }),
        reload: () => this.refreshAllotments(),
      }),
  );

  /**
   * R-CONF-02 — deactivating takes the row out of sale, so it asks first;
   * activating goes straight through. Uses each list's existing `update`.
   */
  private async toggleActive(
    row: { is_active: boolean },
    opts: {
      title: string;
      message: string;
      done: (active: boolean) => string;
      failed: string;
      save: (is_active: boolean) => Observable<unknown>;
      reload: () => void;
    },
  ): Promise<void> {
    if (
      row.is_active &&
      !(await this.dialogService.confirm({
        title: opts.title,
        message: opts.message,
        confirmText: 'Desactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      }))
    ) {
      return;
    }
    const next = !row.is_active;
    opts
      .save(next)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(opts.done(next));
          opts.reload();
        },
        error: (message: unknown) =>
          this.toastService.error(typeof message === 'string' ? message : opts.failed),
      });
  }

  openAllotmentForm(allotment: Allotment | null): void {
    this.editingAllotment.set(
      allotment ? (this.allotments().find((a) => a.id === allotment.id) ?? null) : null,
    );
    this.isAllotmentFormOpen.set(true);
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
