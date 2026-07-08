import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  QuantityControlComponent,
  ResponsiveDataViewComponent,
  SettingToggleComponent,
  StatsComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  StickyHeaderTab,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';

import {
  AccessValidationResult,
  GymAccessCredential,
  GymAccessLog,
  GymAccessResult,
  GymCredentialType,
  Occupancy,
  GYM_ACCESS_RESULT_COLORS,
  GYM_ACCESS_RESULT_LABELS,
  GYM_CREDENTIAL_TYPE_LABELS,
} from '../../interfaces';
import { MembershipAccessService } from '../../services';
import { MembershipCredentialFormModalComponent } from '../../components/credential-form-modal/credential-form-modal.component';
import { AforoGaugeComponent } from '../../components/aforo-gauge/aforo-gauge.component';
import { AforoCheckinPanelComponent } from '../../components/aforo-checkin-panel/aforo-checkin-panel.component';
import { MembershipAmbientAccessService } from '../../../../../../../core/services/membership-ambient-access.service';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { StoreSettingsService } from '../../../../settings/general/services/store-settings.service';
import type {
  MembershipSettings,
  StoreSettings,
} from '../../../../../../../core/models/store-settings.interface';

type AccessTab = 'aforo' | 'logs' | 'credentials';

@Component({
  selector: 'app-membership-access-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    IconComponent,
    QuantityControlComponent,
    SettingToggleComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    MembershipCredentialFormModalComponent,
    AforoGaugeComponent,
    AforoCheckinPanelComponent,
  ],
  templateUrl: './access-page.component.html',
  styleUrl: './access-page.component.css',
})
export class MembershipAccessPageComponent implements OnInit {
  private readonly accessService = inject(MembershipAccessService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ambient = inject(MembershipAmbientAccessService);
  private readonly authFacade = inject(AuthFacade);
  private readonly storeSettingsService = inject(StoreSettingsService);

  readonly activeTab = signal<AccessTab>('aforo');
  readonly isLoading = signal(false);

  // ─── Aforo (occupancy) state ───────────────────────────────────────────────
  /** Authoritative snapshot seeded via `getOccupancy()` (carries turnstile_mode + business_date). */
  private readonly restOccupancy = signal<Occupancy | null>(null);
  /**
   * Effective occupancy: prefer the live SSE signal (C2) for the counters, but
   * keep the authoritative `turnstile_mode` / `business_date` from the REST seed
   * (the SSE tick does not carry those two fields).
   */
  readonly occupancy = computed<Occupancy | null>(() => {
    const live = this.ambient.occupancy();
    const seed = this.restOccupancy();
    if (!live) return seed;
    return {
      ...live,
      turnstile_mode: seed?.turnstile_mode ?? live.turnstile_mode,
      business_date: seed?.business_date ?? live.business_date,
    };
  });

  readonly occupancyPct = computed(() => {
    const o = this.occupancy();
    if (!o || !o.max_capacity) return 0;
    return Math.min(100, Math.round((o.current_count / o.max_capacity) * 100));
  });

  readonly availableSpots = computed(() => {
    const o = this.occupancy();
    if (!o || !o.max_capacity) return null;
    return Math.max(0, o.max_capacity - o.current_count);
  });

  /** True while the store-local aforo is at/over capacity (control on). */
  readonly isFull = computed(() => {
    const o = this.occupancy();
    return (
      !!o &&
      o.capacity_control_enabled &&
      o.max_capacity > 0 &&
      o.current_count >= o.max_capacity
    );
  });

  readonly occupancyLoading = signal(false);
  readonly actionInFlight = signal(false);

  /** Ring/badge color driven by how full the room is. */
  readonly occupancyColor = computed(() => {
    if (this.isFull()) return '#dc2626'; // red — full
    const pct = this.occupancyPct();
    if (pct >= 80) return '#d97706'; // amber — nearly full
    return '#16a34a'; // green — comfortable
  });

  // ─── Manual check-in (result shared with the check-in panel) ────────────────
  /** QR/PIN validation result rendered by `app-aforo-checkin-panel`. */
  readonly lastCheckin = signal<AccessValidationResult | null>(null);
  /** SSE connection state → drives the "EN VIVO" badge in the gauge hero. */
  readonly liveConnected = computed(
    () => this.ambient.connectionState() === 'open',
  );

  // ─── Aforo config (persisted in store_settings.settings.membership) ─────────
  readonly showConfig = signal(false);
  readonly savingConfig = signal(false);
  readonly cfgCapacityControl = signal(false);
  readonly cfgMaxCapacity = signal(0);
  readonly cfgTurnstile = signal(false);
  readonly cfgLevelingEnabled = signal(false);
  readonly cfgLevelingInterval = signal<1 | 2>(2);

  /** Turnstile ⊕ auto-leveling: the turnstile controls entries/exits itself. */
  readonly levelingDisabled = computed(() => this.cfgTurnstile());

  private get membershipSettings(): MembershipSettings | undefined {
    return (this.authFacade.storeSettings() as StoreSettings | null)?.membership;
  }

  // ─── Logs state ──────────────────────────────────────────────────────────
  readonly logs = signal<GymAccessLog[]>([]);
  readonly logsFilters = signal({ page: 1, limit: 20 });
  readonly logsTotal = signal(0);
  readonly resultFilter = signal<GymAccessResult | 'all'>('all');
  logsFilterValues: FilterValues = {};
  readonly grantedToday = signal(0);

  // ─── Credentials state ───────────────────────────────────────────────────
  readonly credentials = signal<GymAccessCredential[]>([]);
  readonly credsFilters = signal({ page: 1, limit: 10 });
  readonly credsTotal = signal(0);
  readonly showCredentialModal = signal(false);
  readonly editingCredential = signal<GymAccessCredential | null>(null);
  private credentialsLoaded = false;

  readonly tabs: StickyHeaderTab[] = [
    { id: 'aforo', label: 'Aforo', icon: 'users' },
    { id: 'logs', label: 'Bitácora', icon: 'history' },
    { id: 'credentials', label: 'Credenciales', icon: 'key-round' },
  ];

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    if (this.activeTab() === 'credentials') {
      return [
        {
          id: 'new-credential',
          label: 'Nueva credencial',
          icon: 'plus',
          variant: 'primary',
        },
      ];
    }
    if (this.activeTab() === 'aforo') {
      return [
        {
          id: 'config-aforo',
          label: 'Configurar aforo',
          icon: 'settings',
          variant: 'outline',
        },
        {
          id: 'refresh-aforo',
          label: 'Refrescar',
          icon: 'refresh-cw',
          variant: 'ghost',
        },
      ];
    }
    return [
      { id: 'refresh', label: 'Refrescar', icon: 'refresh-cw', variant: 'outline' },
    ];
  });

  readonly logsTotalPages = computed(
    () => Math.ceil(this.logsTotal() / this.logsFilters().limit) || 1,
  );
  readonly credsTotalPages = computed(
    () => Math.ceil(this.credsTotal() / this.credsFilters().limit) || 1,
  );

  // ─── Logs table config ────────────────────────────────────────────────────
  readonly logsFilterConfigs: FilterConfig[] = [
    {
      key: 'result',
      label: 'Resultado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'granted', label: 'Concedido' },
        { value: 'denied_no_membership', label: 'Sin membresía' },
        { value: 'denied_expired', label: 'Vencida' },
        { value: 'denied_suspended', label: 'Suspendida' },
        { value: 'denied_frozen', label: 'Congelada' },
        { value: 'denied_quota_exceeded', label: 'Límite alcanzado' },
        { value: 'denied_outside_schedule', label: 'Fuera de horario' },
        { value: 'denied_capacity_full', label: 'Aforo lleno' },
      ],
    },
  ];

  readonly logsActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
  ]);

  readonly logsColumns: TableColumn[] = [
    {
      key: 'access_at',
      label: 'Fecha / hora',
      sortable: true,
      priority: 1,
      transform: (value: string) => this.formatDateTime(value),
    },
    {
      key: 'result',
      label: 'Resultado',
      priority: 1,
      transform: (value: GymAccessResult) =>
        GYM_ACCESS_RESULT_LABELS[value] ?? value,
      badge: true,
      badgeConfig: { type: 'custom', colorMap: GYM_ACCESS_RESULT_COLORS },
    },
    {
      key: 'reason',
      label: 'Motivo',
      sortable: false,
      priority: 2,
      transform: (value: string | null) => value ?? '—',
    },
    {
      key: 'customer_id',
      label: 'Socio',
      sortable: false,
      priority: 3,
      transform: (value: number | null) =>
        value == null ? '—' : `Socio #${value}`,
    },
    {
      key: 'device_id',
      label: 'Dispositivo',
      sortable: false,
      priority: 3,
      transform: (value: string | null) => value ?? '—',
    },
  ];

  readonly logsCardConfig: ItemListCardConfig = {
    titleKey: 'result',
    titleTransform: (row: GymAccessLog) =>
      GYM_ACCESS_RESULT_LABELS[row.result] ?? row.result,
    subtitleKey: 'access_at',
    subtitleTransform: (row: GymAccessLog) => this.formatDateTime(row.access_at),
    avatarFallbackIcon: 'door-open',
    avatarShape: 'square',
    badgeKey: 'result',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: GYM_ACCESS_RESULT_COLORS,
    },
    badgeTransform: (val: GymAccessResult) =>
      GYM_ACCESS_RESULT_LABELS[val] ?? val,
    detailKeys: [
      {
        key: 'reason',
        label: 'Motivo',
        icon: 'info',
        transform: (v: string | null) => v ?? '—',
      },
    ],
  };

  // ─── Credentials table config ─────────────────────────────────────────────
  readonly credsColumns: TableColumn[] = [
    {
      key: 'customer_id',
      label: 'Socio',
      sortable: false,
      priority: 1,
      transform: (value: number) => `Socio #${value}`,
    },
    {
      key: 'credential_type',
      label: 'Tipo',
      sortable: false,
      priority: 2,
      transform: (value: GymCredentialType) =>
        GYM_CREDENTIAL_TYPE_LABELS[value] ?? value,
    },
    {
      key: 'credential_value_masked',
      label: 'Valor',
      sortable: false,
      priority: 1,
      defaultValue: '••••',
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { true: '#16a34a', false: '#b45309' },
      },
    },
  ];

  readonly credsActions = computed<TableAction[]>(() => [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: GymAccessCredential) => this.editCredential(item),
    },
    {
      label: 'Desactivar',
      icon: 'ban',
      variant: 'danger',
      show: (item: GymAccessCredential) => item.is_active,
      action: (item: GymAccessCredential) => this.confirmDeactivate(item),
    },
  ]);

  readonly credsCardConfig: ItemListCardConfig = {
    titleKey: 'credential_value_masked',
    subtitleKey: 'credential_type',
    subtitleTransform: (row: GymAccessCredential) =>
      GYM_CREDENTIAL_TYPE_LABELS[row.credential_type] ?? row.credential_type,
    avatarFallbackIcon: 'key-round',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { true: '#16a34a', false: '#b45309' },
    },
    badgeTransform: (val: boolean) => (val ? 'Activa' : 'Inactiva'),
    detailKeys: [
      {
        key: 'customer_id',
        label: 'Socio',
        icon: 'user',
        transform: (v: number) => `Socio #${v}`,
      },
    ],
  };

  ngOnInit(): void {
    this.loadOccupancy();
    this.hydrateConfigFromSettings();
    this.loadLogs();
  }

  formatDateTime(value: string | Date): string {
    try {
      return new Date(value).toLocaleString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  }

  onTabChanged(tabId: string): void {
    this.activeTab.set(tabId as AccessTab);
    if (tabId === 'aforo') {
      this.loadOccupancy();
      this.hydrateConfigFromSettings();
    }
    if (tabId === 'credentials' && !this.credentialsLoaded) {
      this.credentialsLoaded = true;
      this.loadCredentials();
    }
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'refresh') this.loadLogs();
    else if (actionId === 'new-credential') this.newCredential();
    else if (actionId === 'refresh-aforo') this.loadOccupancy();
    else if (actionId === 'config-aforo') this.toggleConfig();
  }

  // ─── Aforo: occupancy ───────────────────────────────────────────────────────
  loadOccupancy(): void {
    this.occupancyLoading.set(true);
    this.accessService
      .getOccupancy()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (occ) => {
          this.restOccupancy.set(occ);
          this.occupancyLoading.set(false);
        },
        error: (err: unknown) => {
          // Non-fatal: the aforo panel still works via live SSE + actions.
          this.occupancyLoading.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo leer el aforo',
          );
        },
      });
  }

  /**
   * Validate a credential emitted by `app-aforo-checkin-panel` (QR / PIN). The
   * fingerprint path resolves inside the panel via the ambient SSE stream and
   * does NOT route through here. Reuses the same validation flow as before.
   */
  onCheckin(payload: {
    credential_type: GymCredentialType;
    credential_value: string;
  }): void {
    const value = payload.credential_value?.trim();
    if (!value) {
      this.toastService.warning('Ingresa el valor de la credencial');
      return;
    }
    this.actionInFlight.set(true);
    this.accessService
      .validate({
        credential_type: payload.credential_type,
        credential_value: value,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.lastCheckin.set(res);
          if (res.granted) {
            this.toastService.success('Ingreso concedido');
          } else {
            this.toastService.warning(
              GYM_ACCESS_RESULT_LABELS[res.result] ?? 'Acceso denegado',
            );
          }
          // The grant already incremented the counter server-side; re-read to
          // reflect it even when the ambient SSE stream is not connected.
          this.loadOccupancy();
          this.actionInFlight.set(false);
        },
        error: (err: unknown) => {
          this.actionInFlight.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al validar el acceso',
          );
        },
      });
  }

  registerExit(): void {
    this.actionInFlight.set(true);
    this.accessService
      .registerExit()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (occ) => {
          this.restOccupancy.set(occ);
          this.toastService.success('Salida registrada');
          this.actionInFlight.set(false);
        },
        error: (err: unknown) => {
          this.actionInFlight.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al registrar la salida',
          );
        },
      });
  }

  adjust(delta: number): void {
    this.actionInFlight.set(true);
    this.accessService
      .adjustOccupancy(delta)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (occ) => {
          this.restOccupancy.set(occ);
          this.actionInFlight.set(false);
        },
        error: (err: unknown) => {
          this.actionInFlight.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al ajustar el aforo',
          );
        },
      });
  }

  // ─── Aforo: config ────────────────────────────────────────────────────────
  toggleConfig(): void {
    this.hydrateConfigFromSettings();
    this.showConfig.update((v) => !v);
  }

  private hydrateConfigFromSettings(): void {
    const m = this.membershipSettings;
    this.cfgCapacityControl.set(m?.capacity_control_enabled ?? false);
    this.cfgMaxCapacity.set(m?.max_capacity ?? 0);
    this.cfgTurnstile.set(m?.turnstile_mode ?? false);
    this.cfgLevelingEnabled.set(m?.auto_leveling_enabled ?? false);
    this.cfgLevelingInterval.set(m?.auto_leveling_interval_hours === 1 ? 1 : 2);
  }

  onCapacityControlToggle(enabled: boolean): void {
    this.cfgCapacityControl.set(enabled);
  }

  onTurnstileToggle(enabled: boolean): void {
    this.cfgTurnstile.set(enabled);
    // Turnstile controls entries/exits itself → auto-leveling makes no sense.
    if (enabled) this.cfgLevelingEnabled.set(false);
  }

  onLevelingToggle(enabled: boolean): void {
    if (this.levelingDisabled()) return;
    this.cfgLevelingEnabled.set(enabled);
  }

  onMaxCapacityChange(value: number): void {
    this.cfgMaxCapacity.set(Math.max(0, Math.round(value)));
  }

  setLevelingInterval(hours: 1 | 2): void {
    if (this.levelingDisabled()) return;
    this.cfgLevelingInterval.set(hours);
  }

  saveConfig(): void {
    this.savingConfig.set(true);
    const current = this.membershipSettings;
    const membership: MembershipSettings = {
      // preserve unrelated membership settings (ambient toggle, etc.)
      ambient_access_enabled: current?.ambient_access_enabled ?? false,
      ...current,
      capacity_control_enabled: this.cfgCapacityControl(),
      max_capacity: this.cfgMaxCapacity(),
      turnstile_mode: this.cfgTurnstile(),
      auto_leveling_enabled: this.cfgTurnstile()
        ? false
        : this.cfgLevelingEnabled(),
      auto_leveling_interval_hours: this.cfgLevelingInterval(),
    };

    this.storeSettingsService
      .saveSettingsNow({ membership })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingConfig.set(false);
          this.showConfig.set(false);
          this.toastService.success('Configuración de aforo guardada');
          this.loadOccupancy();
        },
        error: (err: unknown) => {
          this.savingConfig.set(false);
          this.toastService.error(
            err instanceof Error ? err.message : 'Error al guardar la configuración',
          );
        },
      });
  }

  // ─── Logs ────────────────────────────────────────────────────────────────
  loadLogs(): void {
    this.isLoading.set(true);
    const query: Record<string, unknown> = {
      page: this.logsFilters().page,
      limit: this.logsFilters().limit,
    };
    if (this.resultFilter() !== 'all') query['result'] = this.resultFilter();

    this.accessService
      .listLogs(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.logs.set(data);
          this.logsTotal.set(response.meta?.total ?? data.length);
          this.recalcGrantedToday(data);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al cargar la bitácora',
          );
          this.isLoading.set(false);
        },
      });
  }

  private recalcGrantedToday(list: GymAccessLog[]): void {
    const today = new Date().toDateString();
    this.grantedToday.set(
      list.filter(
        (l) =>
          l.result === 'granted' &&
          new Date(l.access_at).toDateString() === today,
      ).length,
    );
  }

  onLogsFilterChange(values: FilterValues): void {
    this.logsFilterValues = values;
    const result = (values['result'] as string | undefined) ?? '';
    this.resultFilter.set(result ? (result as GymAccessResult) : 'all');
    this.logsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadLogs();
  }

  clearLogsFilters(): void {
    this.resultFilter.set('all');
    this.logsFilterValues = {};
    this.logsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadLogs();
  }

  onLogsPageChange(page: number): void {
    this.logsFilters.update((f) => ({ ...f, page }));
    this.loadLogs();
  }

  get hasLogsFilters(): boolean {
    return this.resultFilter() !== 'all';
  }

  // ─── Credentials ──────────────────────────────────────────────────────────
  loadCredentials(): void {
    this.isLoading.set(true);
    this.accessService
      .listCredentials({
        page: this.credsFilters().page,
        limit: this.credsFilters().limit,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.credentials.set(data);
          this.credsTotal.set(response.meta?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al cargar las credenciales',
          );
          this.isLoading.set(false);
        },
      });
  }

  onCredsPageChange(page: number): void {
    this.credsFilters.update((f) => ({ ...f, page }));
    this.loadCredentials();
  }

  newCredential(): void {
    this.editingCredential.set(null);
    this.showCredentialModal.set(true);
  }

  editCredential(credential: GymAccessCredential): void {
    this.editingCredential.set(credential);
    this.showCredentialModal.set(true);
  }

  confirmDeactivate(credential: GymAccessCredential): void {
    this.dialogService
      .confirm({
        title: 'Desactivar credencial',
        message: `¿Desactivar la credencial "${credential.credential_value_masked}"? El socio no podrá usarla para ingresar.`,
        confirmText: 'Desactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) this.deactivateCredential(credential);
      });
  }

  private deactivateCredential(credential: GymAccessCredential): void {
    this.accessService
      .deactivateCredential(credential.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Credencial dada de baja');
          this.loadCredentials();
        },
        error: (err: unknown) => {
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al dar de baja la credencial',
          );
        },
      });
  }

  onCredentialSaved(): void {
    this.loadCredentials();
  }
}
