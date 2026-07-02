import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  StickyHeaderTab,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';

import {
  GymAccessCredential,
  GymAccessLog,
  GymAccessResult,
  GymCredentialType,
  GYM_ACCESS_RESULT_COLORS,
  GYM_ACCESS_RESULT_LABELS,
  GYM_CREDENTIAL_TYPE_LABELS,
} from '../../interfaces';
import { MembershipAccessService } from '../../services';
import { MembershipCredentialFormModalComponent } from '../../components/credential-form-modal/credential-form-modal.component';

type AccessTab = 'logs' | 'credentials';

@Component({
  selector: 'app-membership-access-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    MembershipCredentialFormModalComponent,
  ],
  templateUrl: './access-page.component.html',
})
export class MembershipAccessPageComponent implements OnInit {
  private readonly accessService = inject(MembershipAccessService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeTab = signal<AccessTab>('logs');
  readonly isLoading = signal(false);

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
    { key: 'credential_value', label: 'Valor', sortable: false, priority: 1 },
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
    titleKey: 'credential_value',
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
    if (tabId === 'credentials' && !this.credentialsLoaded) {
      this.credentialsLoaded = true;
      this.loadCredentials();
    }
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'refresh') this.loadLogs();
    else if (actionId === 'new-credential') this.newCredential();
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
        message: `¿Desactivar la credencial "${credential.credential_value}"? El socio no podrá usarla para ingresar.`,
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
