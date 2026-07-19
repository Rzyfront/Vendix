import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
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
import { MembershipsService } from '../../../members/services';
import type { GymMembership } from '../../../members/interfaces';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import { MembershipCredentialFormModalComponent } from '../../components/credential-form-modal/credential-form-modal.component';
import { AforoGaugeComponent } from '../../components/aforo-gauge/aforo-gauge.component';
import { AforoCheckinPanelComponent } from '../../components/aforo-checkin-panel/aforo-checkin-panel.component';
import type { ScannerViewMode } from '../../components/aforo-qr-scanner/aforo-qr-scanner.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { MembershipAmbientAccessService } from '../../../../../../../core/services/membership-ambient-access.service';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { StoreSettingsService } from '../../../../settings/general/services/store-settings.service';
import type {
  MembershipSettings,
  StoreSettings,
} from '../../../../../../../core/models/store-settings.interface';

type AccessTab = 'aforo' | 'logs' | 'credentials' | 'configuracion';

/** Urgency bucket driving the "días restantes" badge color. */
type ExpiringUrgency = 'expired' | 'soon' | 'ok';

/** Precomputed view row for the "Membresías por vencer" card. */
interface ExpiringRow {
  id: number;
  memberName: string;
  planName: string;
  venceLabel: string;
  daysLabel: string;
  urgency: ExpiringUrgency;
}

const MS_PER_DAY = 86_400_000;

const EXPIRING_URGENCY_COLORS: Record<ExpiringUrgency, string> = {
  expired: '#dc2626',
  soon: '#d97706',
  ok: '#6b7280',
};

const EXPIRING_URGENCY_LABELS: Record<ExpiringUrgency, string> = {
  expired: 'Vencida',
  soon: 'Por vencer',
  ok: 'Vigente',
};

@Component({
  selector: 'app-membership-access-page',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
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
    InputComponent,
    ModalComponent,
    InputsearchComponent,
  ],
  templateUrl: './access-page.component.html',
  styleUrl: './access-page.component.css',
})
export class MembershipAccessPageComponent implements OnInit {
  private readonly accessService = inject(MembershipAccessService);
  private readonly membershipsService = inject(MembershipsService);
  private readonly router = inject(Router);
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

  // ─── Expiring memberships (vencidas + por vencer) ───────────────────────────
  /** Raw list from `GET /store/memberships/expiring` (already ordered asc). */
  readonly expiring = signal<GymMembership[]>([]);
  readonly expiringLoading = signal(false);

  /**
   * Precomputed rows so the table/card never depend on `transform` gating
   * (app-table skips transforms when the raw cell value is falsy — e.g. 0 days).
   */
  readonly expiringRows = computed<ExpiringRow[]>(() =>
    this.expiring().map((m) => {
      const days = this.calendarDaysUntil(m.period_end);
      const urgency: ExpiringUrgency =
        days === null || days < 0 ? 'expired' : days <= 3 ? 'soon' : 'ok';
      return {
        id: m.id,
        memberName: this.membershipMemberName(m),
        planName: m.plan?.name ?? `Plan #${m.plan_id}`,
        venceLabel: m.period_end ? formatDateOnlyUTC(m.period_end) : 'Sin definir',
        daysLabel: this.expiringDaysLabel(days),
        urgency,
      };
    }),
  );

  // Pagination exception: the "expiring" endpoint is a bounded dashboard widget
  // (backend caps the slice server-side and returns a plain array, not a
  // paginated envelope). No client-side pagination by design.
  readonly expiringColumns: TableColumn[] = [
    {
      key: 'memberName',
      label: 'Socio',
      sortable: false,
      priority: 1,
    },
    {
      key: 'planName',
      label: 'Plan',
      sortable: false,
      priority: 2,
    },
    {
      key: 'venceLabel',
      label: 'Vence',
      sortable: false,
      priority: 1,
    },
    {
      key: 'urgency',
      label: 'Días restantes',
      priority: 1,
      transform: (_: ExpiringUrgency, row: ExpiringRow) => row.daysLabel,
      badge: true,
      badgeConfig: { type: 'custom', colorMap: EXPIRING_URGENCY_COLORS },
    },
  ];

  readonly expiringCardConfig: ItemListCardConfig = {
    titleKey: 'memberName',
    subtitleKey: 'planName',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    badgeKey: 'urgency',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: EXPIRING_URGENCY_COLORS,
    },
    badgeTransform: (val: ExpiringUrgency) =>
      EXPIRING_URGENCY_LABELS[val] ?? String(val),
    detailKeys: [
      { key: 'venceLabel', label: 'Vence', icon: 'calendar' },
      { key: 'daysLabel', label: 'Restan', icon: 'clock' },
    ],
  };

  // ─── Aforo config (persisted in store_settings.settings.membership) ─────────
  /** Drives the "Configuración de aforo" modal (app-modal [(isOpen)]). */
  readonly showConfig = signal(false);
  readonly savingConfig = signal(false);
  readonly cfgCapacityControl = signal(false);
  readonly cfgMaxCapacity = signal(0);
  readonly cfgTurnstile = signal(false);
  readonly cfgLevelingEnabled = signal(false);
  readonly cfgLevelingInterval = signal<1 | 2>(2);
  /** Re-entry detection mode (off | warn | block). Default `warn`. */
  readonly cfgReEntryMode = signal<'off' | 'warn' | 'block'>('warn');
  /** Window (hours) that counts a repeated entry as a re-entry. Default `2`. */
  readonly cfgReEntryWindowHours = signal(2);

  // ─── Access config (fingerprint device) ────────────────────────────────────
  readonly savingAccessConfig = signal(false);
  /** QR scanner kiosk mode (always-on continuous scanner on the Aforo tab). */
  readonly cfgQrKioskMode = signal(false);
  private cfgKioskPersisted = signal(false);
  /** QR scanner default display mode (store setting). */
  readonly cfgQrScannerDefaultMode = signal<ScannerViewMode>('fullscreen');
  private cfgScannerModePersisted = signal<ScannerViewMode>('fullscreen');
  /** Effective kiosk flag from persisted settings (drives the live scanner). */
  readonly kioskMode = computed(
    () => this.membershipSettings?.qr_kiosk_mode ?? false,
  );
  /** Effective scanner default mode from persisted settings (feeds the panel). */
  readonly scannerDefaultMode = computed<ScannerViewMode>(
    () => this.membershipSettings?.qr_scanner_default_mode ?? 'fullscreen',
  );
  readonly cfgFingerprintReaderType = signal<'id_wrapper' | 'template_sdk'>('id_wrapper');
  readonly cfgFingerprintSdkProvider = signal<'zkteco' | 'digitalpersona' | 'generic_http' | null>(null);
  readonly cfgFingerprintEndpoint = signal<string>('');
  readonly cfgFingerprintApiKeyRef = signal<string>('');
  readonly cfgFingerprintTimeout = signal<number | null>(null);
  readonly cfgFingerprintVerifyTimeout = signal<number | null>(null);
  readonly cfgFingerprintApiKeyVisible = signal(false);
  /** FormControls wired to `<app-input>` (CVA) — sync'd with the signals above. */
  readonly fcFingerprintEndpoint = new FormControl<string>('', { nonNullable: true });
  readonly fcFingerprintApiKeyRef = new FormControl<string>('', { nonNullable: true });
  readonly fcFingerprintTimeout = new FormControl<number | null>(null);
  readonly fcFingerprintVerifyTimeout = new FormControl<number | null>(null);
  /** Snapshot of persisted config so the shell can show "cambios sin guardar". */
  private cfgFingerprintPersisted = signal<{
    reader_type: 'id_wrapper' | 'template_sdk';
    sdk_provider: 'zkteco' | 'digitalpersona' | 'generic_http' | null;
    endpoint: string;
    api_key_ref: string;
    timeout_ms: number | null;
    verify_timeout_ms: number | null;
  } | null>(null);

  /** URL must be http(s) and look like a real endpoint (host + path or domain). */
  readonly cfgEndpointValid = computed(() => {
    const v = this.cfgFingerprintEndpoint().trim();
    if (!v) return null;
    return /^https?:\/\/[\w.-]+(?::\d+)?(\/[\w./?=&%-]*)?$/i.test(v);
  });
  readonly cfgTimeoutValid = computed(() => {
    const t = this.cfgFingerprintTimeout();
    return t == null || (Number.isFinite(t) && t >= 100 && t <= 60_000);
  });
  readonly cfgVerifyTimeoutValid = computed(() => {
    const t = this.cfgFingerprintVerifyTimeout();
    return t == null || (Number.isFinite(t) && t >= 100 && t <= 30_000);
  });
  readonly cfgConfigDirty = computed(() => {
    const kioskDirty = this.cfgQrKioskMode() !== this.cfgKioskPersisted();
    const modeDirty = this.cfgQrScannerDefaultMode() !== this.cfgScannerModePersisted();
    const p = this.cfgFingerprintPersisted();
    if (!p) return kioskDirty || modeDirty || this.cfgFingerprintReaderType() !== 'id_wrapper';
    return (
      kioskDirty ||
      modeDirty ||
      p.reader_type !== this.cfgFingerprintReaderType() ||
      p.sdk_provider !== this.cfgFingerprintSdkProvider() ||
      p.endpoint !== this.cfgFingerprintEndpoint().trim() ||
      p.api_key_ref !== this.cfgFingerprintApiKeyRef().trim() ||
      p.timeout_ms !== this.cfgFingerprintTimeout() ||
      p.verify_timeout_ms !== this.cfgFingerprintVerifyTimeout()
    );
  });
  readonly cfgCanSave = computed(() => {
    if (this.savingAccessConfig()) return false;
    if (!this.cfgConfigDirty()) return false;
    if (this.cfgFingerprintReaderType() !== 'template_sdk') return true;
    return (
      !!this.cfgFingerprintSdkProvider() &&
      this.cfgEndpointValid() === true &&
      this.cfgTimeoutValid() &&
      this.cfgVerifyTimeoutValid()
    );
  });
  /** Per-SDK hint shown below the endpoint input. */
  readonly cfgEndpointHint = computed(() => {
    const p = this.cfgFingerprintSdkProvider();
    switch (p) {
      case 'zkteco':
        return 'URL del servicio de identificación ZKTeco (puerto 8080 típico).';
      case 'digitalpersona':
        return 'URL del endpoint del DigitalPersona SDK adapter.';
      case 'generic_http':
        return 'POST multipart con campo "template" + recibe { id, confidence }.';
      default:
        return 'URL del adapter o SDK.';
    }
  });
  /** Effective placeholder for endpoint, contextual to SDK. */
  readonly cfgEndpointPlaceholder = computed(() => {
    const p = this.cfgFingerprintSdkProvider();
    if (p === 'zkteco') return 'http://192.168.1.50:8080/identify';
    if (p === 'digitalpersona') return 'https://adapter.example.com/dp/identify';
    return 'https://adapter.example.com/identify';
  });

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
  readonly logsSearch = signal('');
  readonly logsDateFrom = signal<string | null>(null);
  readonly logsDateTo = signal<string | null>(null);
  logsFilterValues: FilterValues = {};
  readonly grantedToday = signal(0);

  // ─── Credentials state ───────────────────────────────────────────────────
  readonly credentials = signal<GymAccessCredential[]>([]);
  readonly credsFilters = signal({ page: 1, limit: 10 });
  readonly credsTotal = signal(0);
  readonly showCredentialModal = signal(false);
  readonly editingCredential = signal<GymAccessCredential | null>(null);
  readonly credsSearch = signal('');
  readonly credsTypeFilter = signal<GymCredentialType | 'all'>('all');
  credsFilterValues: FilterValues = {};
  private credentialsLoaded = false;
  /**
   * ID of the credential currently being re-emailed (drives the disabled state
   * of the "Reenviar email" action button per row). Null when no resend is in
   * flight.
   */
  readonly resendingCredentialId = signal<number | null>(null);

  readonly tabs: StickyHeaderTab[] = [
    { id: 'aforo', label: 'Aforo', icon: 'users' },
    { id: 'logs', label: 'Bitácora', icon: 'history' },
    { id: 'credentials', label: 'Credenciales', icon: 'key-round' },
    { id: 'configuracion', label: 'Configuración', icon: 'settings' },
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
    if (this.activeTab() === 'configuracion') {
      return [
        {
          id: 'save-access-config',
          label: 'Guardar',
          icon: 'save',
          variant: 'primary',
          loading: this.savingAccessConfig(),
          disabled: !this.cfgCanSave(),
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
        { value: 'denied_re_entry', label: 'Reingreso bloqueado' },
      ],
    },
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
    },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
    },
  ];

  readonly credsFilterConfigs: FilterConfig[] = [
    {
      key: 'credential_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'qr', label: 'Código QR' },
        { value: 'pin', label: 'PIN' },
        { value: 'external_ref', label: 'Huella (lector biométrico)' },
      ],
    },
  ];

  readonly logsActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
  ]);

  readonly logsColumns: TableColumn[] = [
    {
      key: 'customer_id',
      label: 'Socio',
      sortable: false,
      priority: 1,
      // `defaultValue` covers the transform-gating case: app-table skips the
      // transform when the raw cell value is falsy (denied events with a null
      // customer_id), so a dash is shown instead of a blank cell.
      defaultValue: '—',
      transform: (_: number | null, row: GymAccessLog) => {
        // Logs may carry `customer_id = null` for denied events where the
        // credential was never resolved. The customer relation is the
        // preferred label; we still have to fall back to the FK for cases
        // where the backend did not attach a relation.
        if (row.customer) return this.customerName(row);
        return row.customer_id == null ? '—' : `Socio #${row.customer_id}`;
      },
    },
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
      transform: (_: number, row: GymAccessCredential) => this.customerName(row),
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
      label: 'Reenviar email',
      icon: 'mail',
      variant: 'ghost',
      tooltip: 'Reenviar email de la credencial al socio',
      disabled: () => this.resendingCredentialId() !== null,
      action: (item: GymAccessCredential) => this.resendCredentialEmail(item),
    },
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
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: GymAccessCredential) => this.confirmArchive(item),
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
        transform: (_: number, row: GymAccessCredential) => this.customerName(row),
      },
    ],
  };

  ngOnInit(): void {
    this.loadOccupancy();
    this.loadExpiring();
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

  /**
   * Render the customer relation attached by the backend's `attachCustomer`
   * helper. Falls back to "—" if neither the relation nor the FK is available,
   * otherwise `name || email || Socio #${id}` — matching the `members-list`
   * pattern. Pure derivation: no `inject()` / state read, safe to call from
   * `TableColumn.transform` / `ItemListDetailField.transform`.
   */
  customerName(row: GymAccessCredential | GymAccessLog): string {
    const c = row.customer;
    if (!c) return '—';
    const name = [c.first_name, c.last_name]
      .filter((part): part is string => !!part && part.trim().length > 0)
      .join(' ')
      .trim();
    return name || c.email || `Socio #${c.id}`;
  }

  onTabChanged(tabId: string): void {
    this.activeTab.set(tabId as AccessTab);
    if (tabId === 'aforo') {
      this.loadOccupancy();
      this.loadExpiring();
      this.hydrateConfigFromSettings();
    }
    if (tabId === 'credentials' && !this.credentialsLoaded) {
      this.credentialsLoaded = true;
      this.loadCredentials();
    }
    if (tabId === 'configuracion') {
      this.hydrateConfigFromSettings();
    }
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'refresh') this.loadLogs();
    else if (actionId === 'new-credential') this.newCredential();
    else if (actionId === 'refresh-aforo') this.loadOccupancy();
    else if (actionId === 'config-aforo') this.openConfig();
    else if (actionId === 'save-access-config') this.saveAccessConfig();
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
          if (res.result === 'denied_re_entry') {
            // Re-entry blocked (mode 'block'): reflected as denied, amber toast.
            this.toastService.warning(this.reEntryToastMessage(res, true));
          } else if (res.granted && res.warning) {
            // Granted, but a re-entry within the window (mode 'warn').
            this.toastService.warning(this.reEntryToastMessage(res, false));
          } else if (res.granted) {
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

  /**
   * "Reingreso" / "Reingreso bloqueado" toast line with the elapsed minutes
   * since the last granted entry, e.g. "Reingreso: ya ingresó hace 12 min".
   */
  private reEntryToastMessage(
    res: AccessValidationResult,
    blocked: boolean,
  ): string {
    const prefix = blocked ? 'Reingreso bloqueado' : 'Reingreso';
    const mins = res.re_entry_minutes;
    return mins == null ? prefix : `${prefix}: ya ingresó hace ${mins} min`;
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

  // ─── Expiring memberships (vencidas + por vencer) ───────────────────────────
  loadExpiring(): void {
    this.expiringLoading.set(true);
    this.membershipsService
      .listExpiring(7, 15)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.expiring.set(list);
          this.expiringLoading.set(false);
        },
        error: () => {
          // Non-fatal: the widget simply renders its empty state.
          this.expiring.set([]);
          this.expiringLoading.set(false);
        },
      });
  }

  goToMembership(row: ExpiringRow): void {
    this.router.navigate(['/admin/memberships/members', row.id]);
  }

  /** Calendar days from today (UTC) until a date-only `period_end`. */
  private calendarDaysUntil(end?: string | null): number | null {
    if (!end) return null;
    const now = new Date();
    const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const e = new Date(end);
    if (Number.isNaN(e.getTime())) return null;
    const b = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
    return Math.round((b - a) / MS_PER_DAY);
  }

  private expiringDaysLabel(days: number | null): string {
    if (days === null) return 'Sin definir';
    if (days < 0) return `Venció hace ${Math.abs(days)} d`;
    if (days === 0) return 'Vence hoy';
    if (days === 1) return '1 día';
    return `${days} días`;
  }

  private membershipMemberName(m: GymMembership): string {
    const c = m.customer;
    if (!c) return `Socio #${m.customer_id}`;
    const name = [c.first_name, c.last_name]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(' ')
      .trim();
    return name || c.email || `Socio #${m.customer_id}`;
  }

  // ─── Aforo: config ────────────────────────────────────────────────────────
  openConfig(): void {
    this.hydrateConfigFromSettings();
    this.showConfig.set(true);
  }

  private hydrateConfigFromSettings(): void {
    const m = this.membershipSettings;
    this.cfgCapacityControl.set(m?.capacity_control_enabled ?? false);
    this.cfgMaxCapacity.set(m?.max_capacity ?? 0);
    this.cfgTurnstile.set(m?.turnstile_mode ?? false);
    this.cfgLevelingEnabled.set(m?.auto_leveling_enabled ?? false);
    this.cfgLevelingInterval.set(m?.auto_leveling_interval_hours === 1 ? 1 : 2);
    this.cfgReEntryMode.set(m?.re_entry_mode ?? 'warn');
    this.cfgReEntryWindowHours.set(
      m?.re_entry_window_hours != null && m.re_entry_window_hours >= 1
        ? m.re_entry_window_hours
        : 2,
    );

    // Fingerprint device config (anot 3b).
    const fd = m?.fingerprint_device;
    const endpoint = fd?.endpoint ?? '';
    const apiKeyRef = fd?.api_key_ref ?? '';
    const timeoutMs = fd?.timeout_ms ?? null;
    const verifyTimeoutMs = fd?.verify_timeout_ms ?? null;
    this.cfgFingerprintReaderType.set(fd?.reader_type ?? 'id_wrapper');
    this.cfgFingerprintSdkProvider.set(fd?.sdk_provider ?? null);
    this.cfgFingerprintEndpoint.set(endpoint);
    this.cfgFingerprintApiKeyRef.set(apiKeyRef);
    this.cfgFingerprintTimeout.set(timeoutMs);
    this.cfgFingerprintVerifyTimeout.set(verifyTimeoutMs);
    // Mirror into FormControls (no emitEvent → no infinite loop).
    this.fcFingerprintEndpoint.setValue(endpoint, { emitEvent: false });
    this.fcFingerprintApiKeyRef.setValue(apiKeyRef, { emitEvent: false });
    this.fcFingerprintTimeout.setValue(timeoutMs, { emitEvent: false });
    this.fcFingerprintVerifyTimeout.setValue(verifyTimeoutMs, { emitEvent: false });
    // Snapshot for dirty-state diff.
    this.cfgFingerprintPersisted.set({
      reader_type: fd?.reader_type ?? 'id_wrapper',
      sdk_provider: fd?.sdk_provider ?? null,
      endpoint,
      api_key_ref: apiKeyRef,
      timeout_ms: timeoutMs,
      verify_timeout_ms: verifyTimeoutMs,
    });

    // Kiosk mode (QR scanner always-on on the Aforo tab).
    const kiosk = m?.qr_kiosk_mode ?? false;
    this.cfgQrKioskMode.set(kiosk);
    this.cfgKioskPersisted.set(kiosk);

    // QR scanner default display mode (fullscreen | floating).
    const scannerMode: ScannerViewMode = m?.qr_scanner_default_mode ?? 'fullscreen';
    this.cfgQrScannerDefaultMode.set(scannerMode);
    this.cfgScannerModePersisted.set(scannerMode);
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

  setReEntryMode(mode: 'off' | 'warn' | 'block'): void {
    this.cfgReEntryMode.set(mode);
  }

  onReEntryWindowChange(value: number): void {
    this.cfgReEntryWindowHours.set(Math.max(1, Math.round(value)));
  }

  onFingerprintEndpointInput(value: string): void {
    this.cfgFingerprintEndpoint.set(value);
    this.fcFingerprintEndpoint.setValue(value, { emitEvent: false });
  }

  onFingerprintApiKeyRefInput(value: string): void {
    this.cfgFingerprintApiKeyRef.set(value);
    this.fcFingerprintApiKeyRef.setValue(value, { emitEvent: false });
  }

  onFingerprintTimeoutInput(value: string | number | null): void {
    const v = value === '' || value == null ? null : Number(value);
    this.cfgFingerprintTimeout.set(v);
    this.fcFingerprintTimeout.setValue(v, { emitEvent: false });
  }

  onFingerprintVerifyTimeoutInput(value: string | number | null): void {
    const v = value === '' || value == null ? null : Number(value);
    this.cfgFingerprintVerifyTimeout.set(v);
    this.fcFingerprintVerifyTimeout.setValue(v, { emitEvent: false });
  }

  toggleApiKeyVisibility(): void {
    this.cfgFingerprintApiKeyVisible.update((v) => !v);
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
      re_entry_mode: this.cfgReEntryMode(),
      re_entry_window_hours: Math.max(1, Math.round(this.cfgReEntryWindowHours())),
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

  /**
   * Persist the fingerprint device configuration (anot 3b).
   * Reads current signal values, merges with existing membership settings to
   * preserve unrelated keys (ambient_access_enabled, aforo, etc.), and writes
   * via `StoreSettingsService.saveSettingsNow`.
   */
  saveAccessConfig(): void {
    if (!this.cfgCanSave()) return;
    this.savingAccessConfig.set(true);
    const current = this.membershipSettings;
    const readerType = this.cfgFingerprintReaderType();
    const fingerprint_device = {
      reader_type: readerType,
      // Only persist SDK-specific fields when relevant; otherwise leave them
      // empty so the backend defaults take over.
      sdk_provider:
        readerType === 'template_sdk'
          ? (this.cfgFingerprintSdkProvider() ?? 'generic_http')
          : undefined,
      endpoint:
        readerType === 'template_sdk' && this.cfgFingerprintEndpoint().trim()
          ? this.cfgFingerprintEndpoint().trim()
          : undefined,
      api_key_ref:
        readerType === 'template_sdk' && this.cfgFingerprintApiKeyRef().trim()
          ? this.cfgFingerprintApiKeyRef().trim()
          : undefined,
      timeout_ms:
        readerType === 'template_sdk' && this.cfgFingerprintTimeout() != null
          ? Number(this.cfgFingerprintTimeout())
          : undefined,
      verify_timeout_ms:
        readerType === 'template_sdk' && this.cfgFingerprintVerifyTimeout() != null
          ? Number(this.cfgFingerprintVerifyTimeout())
          : undefined,
    };

    const membership: MembershipSettings = {
      ...current,
      ambient_access_enabled: current?.ambient_access_enabled ?? false,
      qr_kiosk_mode: this.cfgQrKioskMode(),
      qr_scanner_default_mode: this.cfgQrScannerDefaultMode(),
      fingerprint_device: fingerprint_device as MembershipSettings['fingerprint_device'],
    };

    this.storeSettingsService
      .saveSettingsNow({ membership })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingAccessConfig.set(false);
          // Refresh persisted snapshot so dirty state resets.
          this.cfgFingerprintPersisted.set({
            reader_type: fingerprint_device.reader_type as 'id_wrapper' | 'template_sdk',
            sdk_provider: fingerprint_device.sdk_provider ?? null,
            endpoint: fingerprint_device.endpoint ?? '',
            api_key_ref: fingerprint_device.api_key_ref ?? '',
            timeout_ms: fingerprint_device.timeout_ms ?? null,
            verify_timeout_ms: fingerprint_device.verify_timeout_ms ?? null,
          });
          this.cfgKioskPersisted.set(this.cfgQrKioskMode());
          this.cfgScannerModePersisted.set(this.cfgQrScannerDefaultMode());
          this.toastService.success('Configuración guardada');
        },
        error: (err: unknown) => {
          this.savingAccessConfig.set(false);
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
    if (this.logsSearch()) query['search'] = this.logsSearch();
    if (this.logsDateFrom()) query['date_from'] = this.logsDateFrom();
    if (this.logsDateTo()) query['date_to'] = this.logsDateTo();

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
    this.logsDateFrom.set((values['date_from'] as string) || null);
    this.logsDateTo.set((values['date_to'] as string) || null);
    this.logsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadLogs();
  }

  clearLogsFilters(): void {
    this.resultFilter.set('all');
    this.logsSearch.set('');
    this.logsDateFrom.set(null);
    this.logsDateTo.set(null);
    this.logsFilterValues = {};
    this.logsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadLogs();
  }

  onLogsPageChange(page: number): void {
    this.logsFilters.update((f) => ({ ...f, page }));
    this.loadLogs();
  }

  get hasLogsFilters(): boolean {
    return (
      this.resultFilter() !== 'all' ||
      !!this.logsSearch() ||
      !!this.logsDateFrom() ||
      !!this.logsDateTo()
    );
  }

  onLogsSearch(term: string): void {
    this.logsSearch.set(term);
    this.logsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadLogs();
  }

  // ─── Credentials ──────────────────────────────────────────────────────────
  loadCredentials(): void {
    this.isLoading.set(true);
    const query: {
      page: number;
      limit: number;
      search?: string;
      credential_type?: GymCredentialType;
    } = {
      page: this.credsFilters().page,
      limit: this.credsFilters().limit,
    };
    const term = this.credsSearch().trim();
    if (term) query.search = term;
    const type = this.credsTypeFilter();
    if (type !== 'all') query.credential_type = type;

    this.accessService
      .listCredentials(query)
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

  onCredsFilterChange(values: FilterValues): void {
    this.credsFilterValues = values;
    const type = (values['credential_type'] as string | undefined) ?? '';
    this.credsTypeFilter.set(type ? (type as GymCredentialType) : 'all');
    this.credsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadCredentials();
  }

  clearCredsFilters(): void {
    this.credsTypeFilter.set('all');
    this.credsSearch.set('');
    this.credsFilterValues = {};
    this.credsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadCredentials();
  }

  onCredsSearch(term: string): void {
    this.credsSearch.set(term);
    this.credsFilters.update((f) => ({ ...f, page: 1 }));
    this.loadCredentials();
  }

  get hasCredsFilters(): boolean {
    return this.credsTypeFilter() !== 'all' || !!this.credsSearch();
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

  confirmArchive(credential: GymAccessCredential): void {
    this.dialogService
      .confirm({
        title: 'Eliminar credencial',
        message: `Esta credencial se archivará y dejará de aparecer en el listado. El socio no podrá usarla para ingresar. ¿Deseas continuar?`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) this.archiveCredential(credential);
      });
  }

  private archiveCredential(credential: GymAccessCredential): void {
    this.accessService
      .archiveCredential(credential.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Credencial eliminada');
          this.loadCredentials();
        },
        error: (err: unknown) => {
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al eliminar la credencial',
          );
        },
      });
  }

  onCredentialSaved(): void {
    this.loadCredentials();
  }

  /**
   * Re-send the credential-creation email to the member. Surfaces a success
   * toast when the backend delivered, a warning with the backend reason when
   * it did not, and an error toast on transport/HTTP failure. The per-row
   * "Reenviar email" button is disabled while this credential's request is in
   * flight (see `resendingCredentialId`).
   */
  resendCredentialEmail(credential: GymAccessCredential): void {
    if (this.resendingCredentialId() !== null) return;
    this.resendingCredentialId.set(credential.id);
    this.accessService
      .resendCredentialEmail(credential.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.resendingCredentialId.set(null);
          if (res.email_sent) {
            this.toastService.success('Email reenviado al socio');
          } else {
            this.toastService.warning(
              `No se pudo reenviar el email${res.email_error ? `: ${res.email_error}` : ''}`,
            );
          }
        },
        error: () => {
          this.resendingCredentialId.set(null);
          this.toastService.error('Error al reenviar el email');
        },
      });
  }
}
