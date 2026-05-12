import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  BadgeComponent,
  CardComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
} from '../../../../shared/components/index';
import { ApiErrorService } from '../../../../core/services/api-error.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../shared/utils/date.util';
import { OrgFiscalScopeSelectorComponent } from '../shared/components/org-fiscal-scope-selector.component';
import {
  OrgPayrollEmployeeRow,
  OrgPayrollProvisionRow,
  OrgPayrollService,
  OrgPayrollSettings,
  OrgPayrollSummaryRow,
} from './services/org-payroll.service';

@Component({
  selector: 'vendix-org-payroll',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    OrgFiscalScopeSelectorComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-org-fiscal-scope-selector
        [selectedStoreId]="selectedStoreId()"
        (storeChange)="onFiscalStoreChange($event)"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Corridas"
          [value]="visibleRuns().length"
          smallText="Nómina fiscal"
          iconName="banknote"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Neto pagado"
          [value]="formatMoney(totalNetPay())"
          smallText="Según filtros"
          iconName="dollar-sign"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Costo empleador"
          [value]="formatMoney(totalEmployerCost())"
          smallText="Aportes y provisiones"
          iconName="calculator"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Provisiones"
          [value]="formatMoney(totalProvisions())"
          smallText="Cesantías, intereses, prima y vacaciones"
          iconName="landmark"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar nómina">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                Corridas de nómina ({{ visibleRuns().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Supervisión fiscal consolidada del alcance seleccionado.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar número, periodo o tienda..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                triggerLabel="Filtros"
                triggerIcon="filter"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="visibleRuns()"
            [columns]="runColumns"
            [actions]="runActions"
            [cardConfig]="runCardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin corridas"
            emptyMessage="Sin corridas"
            emptyDescription="No hay corridas de nómina para el alcance fiscal seleccionado."
            emptyIcon="banknote"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (rowClick)="selectRun($event)"
            (emptyClearFiltersClick)="clearFilters()"
          />
        </div>
      </app-card>

      @if (selectedRun(); as run) {
        <app-card customClasses="mt-3">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 class="text-base font-semibold text-text-primary">{{ run.payroll_number }}</h3>
              <p class="text-sm text-text-secondary">
                {{ formatPeriod(run.period) }} · {{ run.store?.name || 'Organización' }}
              </p>
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm md:text-right">
              <div>
                <p class="text-text-secondary">Neto</p>
                <p class="font-semibold text-text-primary">{{ formatMoney(run.net_pay) }}</p>
              </div>
              <div>
                <p class="text-text-secondary">Costo empleador</p>
                <p class="font-semibold text-text-primary">{{ formatMoney(run.employer_costs) }}</p>
              </div>
            </div>
          </div>
          <dl class="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
            <div>
              <dt class="text-text-secondary">Empleados</dt>
              <dd class="font-medium text-text-primary">{{ run.employee_count }}</dd>
            </div>
            <div>
              <dt class="text-text-secondary">Pago</dt>
              <dd class="font-medium text-text-primary">{{ formatDate(run.payment_date) }}</dd>
            </div>
            <div>
              <dt class="text-text-secondary">Estado</dt>
              <dd class="font-medium text-text-primary">{{ statusLabel(run.status) }}</dd>
            </div>
            <div>
              <dt class="text-text-secondary">DIAN</dt>
              <dd class="font-medium text-text-primary">{{ sendStatusLabel(run.send_status) }}</dd>
            </div>
          </dl>
        </app-card>
      }

      <div class="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <app-card [responsive]="true" [padding]="false">
          <div class="px-4 py-3 border-b border-border">
            <h2 class="text-sm font-semibold text-text-primary">Detalle por empleado</h2>
          </div>
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="visibleEmployees()"
              [columns]="employeeColumns"
              [cardConfig]="employeeCardConfig"
              [loading]="loading()"
              emptyTitle="Sin empleados"
              emptyMessage="Sin empleados"
              emptyDescription="No hay detalle de empleados para el alcance seleccionado."
              emptyIcon="users"
              [showEmptyAction]="false"
              [showEmptyClearFilters]="hasActiveFilters()"
              (emptyClearFiltersClick)="clearFilters()"
            />
          </div>
        </app-card>

        <app-card [responsive]="true" [padding]="false">
          <div class="px-4 py-3 border-b border-border">
            <h2 class="text-sm font-semibold text-text-primary">Provisiones laborales</h2>
          </div>
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="visibleProvisions()"
              [columns]="provisionColumns"
              [cardConfig]="provisionCardConfig"
              [loading]="loading()"
              emptyTitle="Sin provisiones"
              emptyMessage="Sin provisiones"
              emptyDescription="No hay provisiones para el alcance seleccionado."
              emptyIcon="calculator"
              [showEmptyAction]="false"
              [showEmptyClearFilters]="hasActiveFilters()"
              (emptyClearFiltersClick)="clearFilters()"
            />
          </div>
        </app-card>
      </div>

      <app-card customClasses="mt-3">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 class="text-sm font-semibold text-text-primary">Configuración fiscal de nómina</h2>
            <p class="mt-1 text-sm text-text-secondary">
              {{ settings()?.is_default ? 'Valores por defecto' : 'Configuración guardada' }}
            </p>
          </div>

          @if (settings(); as cfg) {
            <div class="grid w-full grid-cols-1 gap-3 text-sm lg:w-auto lg:min-w-[520px] lg:grid-cols-3">
              <div class="rounded-md border border-border p-3">
                <p class="text-text-secondary">Periodicidad</p>
                <p class="mt-1 font-semibold text-text-primary">{{ frequencyLabel(cfg.payment_frequency) }}</p>
              </div>
              <div class="rounded-md border border-border p-3">
                <p class="text-text-secondary">Retención</p>
                <div class="mt-2">
                  <app-badge [variant]="cfg.withholding_enabled ? 'success' : 'neutral'" size="sm">
                    {{ cfg.withholding_enabled ? 'Activa' : 'Inactiva' }}
                  </app-badge>
                </div>
              </div>
              <div class="rounded-md border border-border p-3">
                <p class="text-text-secondary">PILA</p>
                <p class="mt-1 font-semibold text-text-primary">{{ cfg.pila_operator || 'Sin operador' }}</p>
              </div>
            </div>
          }
        </div>

        @if (settings(); as cfg) {
          <div class="mt-4 flex flex-wrap gap-2">
            @for (item of parafiscalBadges(cfg); track item.key) {
              <app-badge [variant]="item.enabled ? 'success' : 'neutral'" size="sm" badgeStyle="outline">
                {{ item.label }}
              </app-badge>
            }
          </div>
        }
      </app-card>
    </div>
  `,
})
export class OrgPayrollComponent {
  private readonly service = inject(OrgPayrollService);
  private readonly auth = inject(AuthFacade);
  private readonly errors = inject(ApiErrorService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly selectedStoreId = signal<number | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly runs = signal<OrgPayrollSummaryRow[]>([]);
  readonly employees = signal<OrgPayrollEmployeeRow[]>([]);
  readonly provisions = signal<OrgPayrollProvisionRow[]>([]);
  readonly settings = signal<OrgPayrollSettings | null>(null);
  readonly selectedRun = signal<OrgPayrollSummaryRow | null>(null);

  readonly requiresStoreSelector = computed(() => this.auth.fiscalScope() === 'STORE');
  readonly visibleRuns = computed(() =>
    this.runs().filter((row) => this.matchesSearch(row) && this.matchesStatus(row.status)),
  );
  readonly visibleEmployees = computed(() =>
    this.employees().filter((row) => this.matchesSearch(row)),
  );
  readonly visibleProvisions = computed(() =>
    this.provisions().filter((row) => this.matchesSearch(row)),
  );
  readonly totalNetPay = computed(() =>
    this.visibleRuns().reduce((sum, run) => sum + this.asNumber(run.net_pay), 0),
  );
  readonly totalEmployerCost = computed(() =>
    this.visibleRuns().reduce((sum, run) => sum + this.asNumber(run.employer_costs), 0),
  );
  readonly totalProvisions = computed(() =>
    this.visibleProvisions().reduce((sum, row) => sum + this.asNumber(row.total_provisions), 0),
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'calculated', label: 'Calculada' },
        { value: 'approved', label: 'Aprobada' },
        { value: 'sent', label: 'Enviada' },
        { value: 'accepted', label: 'Aceptada' },
        { value: 'paid', label: 'Pagada' },
        { value: 'rejected', label: 'Rechazada' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
    { key: 'date_from', label: 'Desde', type: 'date' },
    { key: 'date_to', label: 'Hasta', type: 'date' },
  ];

  readonly dropdownActions = [
    { label: 'Configuración fiscal', icon: 'settings', action: 'settings', variant: 'outline' as const },
  ];

  readonly runActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'primary',
      action: (row: OrgPayrollSummaryRow) => this.selectRun(row),
    },
  ];

  readonly runColumns: TableColumn[] = [
    { key: 'payroll_number', label: 'Número', sortable: true, priority: 1 },
    {
      key: 'period',
      label: 'Periodo',
      priority: 1,
      transform: (value) => this.formatPeriod(String(value || '')),
    },
    { key: 'store.name', label: 'Tienda', priority: 3, defaultValue: 'Organización' },
    { key: 'employee_count', label: 'Empleados', align: 'center', priority: 2 },
    {
      key: 'net_pay',
      label: 'Neto',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'employer_costs',
      label: 'Costo empleador',
      align: 'right',
      priority: 2,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: { type: 'status' },
      transform: (value) => this.statusLabel(String(value || '')),
    },
    {
      key: 'send_status',
      label: 'DIAN',
      align: 'center',
      priority: 3,
      badgeConfig: { type: 'status' },
      transform: (value) => this.sendStatusLabel(String(value || '')),
    },
  ];

  readonly runCardConfig: ItemListCardConfig = {
    titleKey: 'payroll_number',
    subtitleTransform: (item) => this.formatPeriod(item?.period || ''),
    avatarFallbackIcon: 'banknote',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    footerKey: 'net_pay',
    footerLabel: 'Neto',
    footerStyle: 'prominent',
    footerTransform: (value) => this.formatMoney(value),
    detailKeys: [
      { key: 'store.name', label: 'Tienda', icon: 'store', transform: (value) => value || 'Organización' },
      { key: 'employee_count', label: 'Empleados', icon: 'users' },
      { key: 'send_status', label: 'DIAN', icon: 'send', transform: (value) => this.sendStatusLabel(String(value || '')) },
    ],
  };

  readonly employeeColumns: TableColumn[] = [
    { key: 'employee_name', label: 'Empleado', priority: 1 },
    { key: 'position', label: 'Cargo', priority: 3, defaultValue: '—' },
    { key: 'department', label: 'Área', priority: 3, defaultValue: '—' },
    {
      key: 'payroll_period',
      label: 'Periodo',
      priority: 2,
      transform: (value) => this.formatPeriod(String(value || '')),
    },
    {
      key: 'base_salary',
      label: 'Salario base',
      align: 'right',
      priority: 2,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'net_pay',
      label: 'Neto',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value),
    },
  ];

  readonly employeeCardConfig: ItemListCardConfig = {
    titleKey: 'employee_name',
    subtitleTransform: (item) => item?.position || item?.department || 'Empleado',
    avatarFallbackIcon: 'user',
    footerKey: 'net_pay',
    footerLabel: 'Neto',
    footerTransform: (value) => this.formatMoney(value),
    detailKeys: [
      { key: 'payroll_period', label: 'Periodo', icon: 'calendar', transform: (value) => this.formatPeriod(String(value || '')) },
      { key: 'base_salary', label: 'Salario', icon: 'dollar-sign', transform: (value) => this.formatMoney(value) },
      { key: 'worked_days', label: 'Días', icon: 'clock' },
    ],
  };

  readonly provisionColumns: TableColumn[] = [
    { key: 'employee_name', label: 'Empleado', priority: 1 },
    {
      key: 'hire_date',
      label: 'Ingreso',
      priority: 3,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'base_salary',
      label: 'Salario base',
      align: 'right',
      priority: 2,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'severance',
      label: 'Cesantías',
      align: 'right',
      priority: 3,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'vacation',
      label: 'Vacaciones',
      align: 'right',
      priority: 3,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'total_provisions',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value),
    },
  ];

  readonly provisionCardConfig: ItemListCardConfig = {
    titleKey: 'employee_name',
    subtitleTransform: (item) => `Ingreso ${this.formatDate(item?.hire_date)}`,
    avatarFallbackIcon: 'calculator',
    avatarShape: 'square',
    footerKey: 'total_provisions',
    footerLabel: 'Total provisiones',
    footerStyle: 'prominent',
    footerTransform: (value) => this.formatMoney(value),
    detailKeys: [
      { key: 'base_salary', label: 'Salario', icon: 'dollar-sign', transform: (value) => this.formatMoney(value) },
      { key: 'severance', label: 'Cesantías', icon: 'landmark', transform: (value) => this.formatMoney(value) },
      { key: 'vacation', label: 'Vacaciones', icon: 'calendar', transform: (value) => this.formatMoney(value) },
    ],
  };

  constructor() {
    this.currency.loadCurrency();
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const storeId = params.get('store_id');
        const search = params.get('search') || '';
        const status = params.get('status') || '';
        const dateFrom = params.get('date_from') || '';
        const dateTo = params.get('date_to') || '';

        this.selectedStoreId.set(storeId ? Number(storeId) : null);
        this.searchTerm.set(search);
        this.filterValues.set({
          ...(status ? { status } : {}),
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
        });
        this.loadData();
      });
  }

  onFiscalStoreChange(storeId: number | null): void {
    if (storeId === this.selectedStoreId()) return;
    this.updateQuery({ store_id: storeId || null });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
    this.updateQuery({ search: search || null });
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    this.updateQuery({
      status: (values['status'] as string) || null,
      date_from: (values['date_from'] as string) || null,
      date_to: (values['date_to'] as string) || null,
    });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.updateQuery({ search: null, status: null, date_from: null, date_to: null });
  }

  onActionClick(action: string): void {
    if (action === 'settings') {
      this.router.navigate(['/admin/settings/fiscal']);
    }
  }

  selectRun(run: OrgPayrollSummaryRow): void {
    this.selectedRun.set(run);
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.filterValues()['status'] ||
      this.filterValues()['date_from'] ||
      this.filterValues()['date_to']
    );
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  formatMoney(value: string | number | null | undefined): string {
    return this.currency.format(this.asNumber(value));
  }

  formatPeriod(value: string | null | undefined): string {
    return value ? value.replace(' - ', ' a ') : '-';
  }

  statusLabel(status: string | null | undefined): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      calculated: 'Calculada',
      approved: 'Aprobada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      paid: 'Pagada',
      cancelled: 'Cancelada',
    };
    return labels[String(status || '')] || String(status || '-');
  }

  sendStatusLabel(status: string | null | undefined): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      sending: 'Enviando',
      sent_ok: 'Enviada',
      sent_error: 'Error',
      not_applicable: 'No aplica',
    };
    return labels[String(status || '')] || String(status || '-');
  }

  frequencyLabel(value: string | null | undefined): string {
    const labels: Record<string, string> = {
      monthly: 'Mensual',
      biweekly: 'Quincenal',
      weekly: 'Semanal',
      MENSUAL: 'Mensual',
      QUINCENAL: 'Quincenal',
      SEMANAL: 'Semanal',
    };
    return labels[String(value || '')] || String(value || '-');
  }

  parafiscalBadges(settings: OrgPayrollSettings): Array<{
    key: string;
    label: string;
    enabled: boolean;
  }> {
    const values = settings.parafiscales || {};
    return [
      { key: 'sena', label: 'SENA', enabled: !!values['sena'] },
      { key: 'icbf', label: 'ICBF', enabled: !!values['icbf'] },
      { key: 'caja', label: 'Caja', enabled: !!values['caja_compensacion'] },
      { key: 'eps', label: 'EPS', enabled: !!values['eps'] },
      { key: 'arl', label: 'ARL', enabled: !!values['arl'] },
      { key: 'pension', label: 'Pensión', enabled: !!values['pension'] },
    ];
  }

  asNumber(value: string | number | undefined | null): number {
    if (value === null || value === undefined) return 0;
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  private loadData(): void {
    if (this.requiresStoreSelector() && !this.selectedStoreId()) {
      this.loading.set(false);
      this.runs.set([]);
      this.employees.set([]);
      this.provisions.set([]);
      this.settings.set(null);
      return;
    }

    const query = this.buildQuery();
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      summary: this.service.getSummary(query),
      employees: this.service.getByEmployee(query),
      provisions: this.service.getProvisions(query),
      settings: this.service.getSettings(
        this.selectedStoreId() ? { store_id: this.selectedStoreId()! } : undefined,
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, employees, provisions, settings }) => {
          this.runs.set(summary.data ?? []);
          this.employees.set(employees.data ?? []);
          this.provisions.set(provisions.data ?? []);
          this.settings.set(settings.data ?? null);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar la información de nómina.'),
          );
          this.runs.set([]);
          this.employees.set([]);
          this.provisions.set([]);
          this.loading.set(false);
        },
      });
  }

  private buildQuery(): Record<string, string | number> {
    const filters = this.filterValues();
    return {
      ...(this.selectedStoreId() ? { store_id: this.selectedStoreId()! } : {}),
      ...(filters['date_from'] ? { date_from: filters['date_from'] as string } : {}),
      ...(filters['date_to'] ? { date_to: filters['date_to'] as string } : {}),
    };
  }

  private updateQuery(queryParams: Record<string, string | number | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private matchesStatus(status: string | null | undefined): boolean {
    const selected = this.filterValues()['status'];
    return !selected || selected === status;
  }

  private matchesSearch(row: unknown): boolean {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return true;
    return JSON.stringify(row ?? {}).toLowerCase().includes(term);
  }
}
