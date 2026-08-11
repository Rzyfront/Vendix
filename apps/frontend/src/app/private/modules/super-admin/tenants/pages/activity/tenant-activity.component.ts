import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { environment } from '../../../../../../../environments/environment';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  type ItemListCardConfig,
  type TableColumn,
} from '../../../../../../shared/components';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import type { AuditLog } from '../../../audit/interfaces/audit.interface';
import { TenantContextStore } from '../../state/tenant-context.store';

// ---------------------------------------------------------------------------
// Contrato
//
// Espeja `apps/backend/src/domains/superadmin/tenant-config/tenant-activity.service.ts`.
// Vive aquí, y no en `interfaces/tenant-profile.interface.ts`, porque aquel
// archivo describe `GET .../profile` y esta pestaña consume un endpoint
// distinto. Cuando la consola crezca, el sitio natural de estos tipos es el
// contrato compartido junto a `SuperadminTenantApiService`.
// ---------------------------------------------------------------------------

/** Tier del último reporte semanal. `ZERO` es también el valor de degradación. */
export type TenantWeeklyTier = 'ZERO' | 'BELOW' | 'ABOVE' | 'STELLAR';

export interface TenantActivityTenant {
  readonly scope: 'store' | 'organization';
  readonly organization_id: number;
  readonly organization_name: string | null;
  readonly store_id: number | null;
  readonly store_name: string | null;
  readonly is_active: boolean | null;
  /** Huso del tenant. TODA fecha de esta pantalla se formatea con él. */
  readonly timezone: string;
}

export interface TenantActivityWindow {
  readonly days: number;
  readonly from: string;
  readonly to: string;
}

export interface TenantLiveSession {
  readonly id: number | string;
  readonly user_id: number | null;
  readonly user_name: string | null;
  readonly email: string | null;
  readonly ip_address: string | null;
  readonly user_agent: string | null;
  readonly device_info: unknown;
  readonly device_fingerprint: string | null;
  readonly last_used: string | null;
  readonly started_at: string | null;
  readonly expires_at: string | null;
}

export interface TenantActionsByDay {
  /** `YYYY-MM-DD` YA calculado en el huso del tenant por el backend. */
  readonly date: string;
  readonly count: number;
}

export interface TenantTopAction {
  readonly action: string;
  readonly count: number;
}

export interface TenantTopUser {
  readonly user_id: number;
  readonly user_name: string | null;
  readonly email: string | null;
  readonly count: number;
  /** `false` ⇒ ya no tiene asiento: sus acciones NO suman a los contadores. */
  readonly is_current_seat: boolean;
}

export interface TenantModuleTouched {
  readonly resource: string;
  readonly count: number;
  readonly last_at: string | null;
}

export interface TenantWeeklyReportSnapshot {
  readonly store_id: number | null;
  readonly week_start_date: string | null;
  readonly week_end_date: string | null;
  readonly tier: string | null;
  readonly generated_at: string | null;
  readonly viewed_at: string | null;
}

export interface TenantActivity {
  readonly tenant: TenantActivityTenant;
  readonly window: TenantActivityWindow;
  readonly last_access: string | null;
  readonly seats_total: number;
  readonly active_users_7d: number;
  readonly active_users_30d: number;
  readonly live_sessions: readonly TenantLiveSession[];
  readonly actions_by_day: readonly TenantActionsByDay[];
  readonly top_actions: readonly TenantTopAction[];
  readonly top_users: readonly TenantTopUser[];
  readonly modules_touched: readonly TenantModuleTouched[];
  readonly weekly_report_tier: TenantWeeklyTier;
  readonly weekly_report: TenantWeeklyReportSnapshot | null;
  /**
   * Eventos del periodo que el escritor nunca atribuyó a una tienda.
   * `null` en la ficha de organización, donde no hay nada que atribuir.
   */
  readonly unattributed_events: number | null;
}

interface TenantActivityResponse {
  readonly success: boolean;
  readonly message: string;
  readonly data: TenantActivity;
}

interface AuditLogsResponse {
  readonly success: boolean;
  readonly data: AuditLog[];
}

/** Ventanas ofrecidas. La de 30 es la del backend por defecto. */
const WINDOW_OPTIONS = [7, 30, 90] as const;

/** Cuántos eventos crudos se piden para el timeline. */
const TIMELINE_LIMIT = 15;

const WEEKLY_TIER_LABELS: Record<TenantWeeklyTier, string> = {
  ZERO: 'Sin actividad',
  BELOW: 'Por debajo',
  ABOVE: 'Por encima',
  STELLAR: 'Excelente',
};

const WEEKLY_TIER_HINTS: Record<TenantWeeklyTier, string> = {
  ZERO: 'La última semana cerrada no registró movimiento.',
  BELOW: 'Rindió por debajo de su propia media.',
  ABOVE: 'Rindió por encima de su propia media.',
  STELLAR: 'Su mejor semana reciente.',
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Crear',
  UPDATE: 'Actualizar',
  DELETE: 'Eliminar',
  LOGIN: 'Inicio de sesión',
  LOGOUT: 'Cierre de sesión',
  READ: 'Lectura',
  VIEW: 'Vista',
  SEARCH: 'Búsqueda',
  PERMISSION_CHANGE: 'Cambio de permisos',
};

const RESOURCE_LABELS: Record<string, string> = {
  users: 'Usuarios',
  organizations: 'Organizaciones',
  stores: 'Tiendas',
  roles: 'Roles',
  permissions: 'Permisos',
  products: 'Productos',
  orders: 'Órdenes',
  categories: 'Categorías',
  customers: 'Clientes',
  suppliers: 'Proveedores',
  purchases: 'Compras',
  inventory: 'Inventario',
  payments: 'Pagos',
  settings: 'Configuración',
};

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** Fila del timeline, ya aplanada y formateada para la tabla compartida. */
interface TimelineRow {
  readonly id: number | string;
  readonly when: string;
  readonly who: string;
  readonly action: string;
  readonly resource: string;
  readonly ip: string;
}

/** Fila de sesión viva, ya aplanada. */
interface SessionRow {
  readonly id: number | string;
  readonly user: string;
  readonly email: string;
  readonly device: string;
  readonly ip: string;
  readonly last_used: string;
  readonly started_at: string;
  readonly expires_at: string;
}

/** Fila de usuario activo, con la marca de ex-empleado ya resuelta. */
interface TopUserRow {
  readonly user_id: number;
  readonly user: string;
  readonly email: string;
  readonly count: number;
  readonly is_current_seat: boolean;
  readonly seat_label: string;
}

/**
 * Pestaña Actividad: contesta "¿este cliente está usando la app?".
 *
 * Jerarquía deliberada, de la respuesta al detalle:
 *
 *  1. **Semáforo** — último acceso, usuarios activos 7d/30d sobre asientos y
 *     tier del reporte semanal. Es lo único que soporte necesita leer para
 *     contestar la pregunta.
 *  2. **Curva** — acciones por día, para distinguir "arrancó y lo dejó" de
 *     "lo usa a diario".
 *  3. **Detalle** — sesiones vivas con dispositivo e IP, usuarios que mueven
 *     la tienda, módulos tocados y los últimos eventos crudos.
 *
 * Sólo telemetría de uso: ni un importe, ni un pedido, ni un cliente del
 * comerciante entra en esta pantalla.
 *
 * **El HTTP vive aquí y no en `SuperadminTenantApiService`** porque ese
 * servicio y el contrato `tenant-profile.interface.ts` pertenecen a otra tarea
 * en vuelo. Es deuda consciente: el sitio natural de `getActivity()` es aquel
 * cliente, provisto en la rama de ruta del perfil.
 */
@Component({
  selector: 'app-tenant-activity',
  standalone: true,
  imports: [
    CardComponent,
    StatsComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './tenant-activity.component.html',
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      /*
       * Altura ANCLADA. La curva se dibuja con divs, no con una librería de
       * gráficas: un contenedor de altura indefinida hace que un canvas de
       * echarts crezca en cada ciclo de medición hasta comerse la página.
       */
      .activity-chart {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 8rem;
        width: 100%;
      }

      .activity-chart__col {
        flex: 1 1 0;
        min-width: 2px;
        height: 100%;
        display: flex;
        align-items: flex-end;
        border-radius: 2px;
        background: var(--color-neutral-100, rgba(148, 163, 184, 0.18));
      }

      /*
       * Siempre rgba(var(--token-rgb), alfa) y nunca rgb(var(--token)): los
       * tokens de color del proyecto son ternas separadas por coma y sólo
       * componen con la sintaxis rgba().
       *
       * (Sin acentos graves en este bloque: el string de styles es un template
       * literal, y un acento grave dentro lo cierra a media CSS.)
       */
      .activity-chart__bar {
        width: 100%;
        border-radius: 2px;
        background: rgba(var(--color-primary-rgb), 0.9);
        transition: height 150ms ease-out;
      }

      /* Un día con un solo evento debe verse: sin esto se redondea a 0px. */
      .activity-chart__bar--seen {
        min-height: 3px;
      }
    `,
  ],
})
export class TenantActivityComponent {
  private readonly http = inject(HttpClient);
  private readonly store = inject(TenantContextStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly baseUrl = `${environment.apiUrl}/superadmin/tenants`;

  protected readonly windowOptions = WINDOW_OPTIONS;

  protected readonly days = signal<number>(30);

  private readonly _activity = signal<TenantActivity | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _timeline = signal<readonly AuditLog[]>([]);
  private readonly _timelineUnavailable = signal(false);

  protected readonly activity = this._activity.asReadonly();
  protected readonly loading = this._loading.asReadonly();
  protected readonly error = this._error.asReadonly();
  protected readonly timelineUnavailable = this._timelineUnavailable.asReadonly();

  /**
   * Descarta respuestas de un tenant o de una ventana que ya no están en
   * pantalla. Los providers de ruta NO se destruyen al navegar
   * (`routeConfig._injector` se cachea), y el router reutiliza este componente
   * cuando sólo cambia `:storeId`: sin token, la respuesta lenta del tenant
   * anterior pintaría su actividad bajo el nombre del siguiente.
   */
  private requestToken = 0;

  constructor() {
    effect(() => {
      const tenantId = this.store.tenantId();
      const days = this.days();
      if (tenantId === null) return;
      this.load(tenantId, days);
    });
  }

  // -------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------

  protected setDays(days: number): void {
    if (this.days() === days) return;
    this.days.set(days);
  }

  protected reload(): void {
    const tenantId = this.store.tenantId();
    if (tenantId === null) return;
    this.load(tenantId, this.days());
  }

  private load(tenantId: number, days: number): void {
    const token = ++this.requestToken;

    // Limpiar ANTES de pedir: mientras carga el tenant nuevo no puede quedar
    // en pantalla la telemetría del anterior.
    this._activity.set(null);
    this._timeline.set([]);
    this._timelineUnavailable.set(false);
    this._error.set(null);
    this._loading.set(true);

    const params = new HttpParams().set('days', String(days));

    this.http
      .get<TenantActivityResponse>(
        `${this.baseUrl}/${this.store.scope}/${tenantId}/activity`,
        { params },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (token !== this.requestToken) return;
          this._loading.set(false);

          const data = response?.data;
          if (!data?.tenant) {
            this._error.set('La actividad del tenant llegó vacía.');
            return;
          }

          this._activity.set(data);
          this.loadTimeline(token, data);
        },
        error: (err: unknown) => {
          if (token !== this.requestToken) return;
          this._loading.set(false);
          this._activity.set(null);
          this._error.set(this.describeError(err));
        },
      });
  }

  /**
   * Últimos eventos crudos del tenant.
   *
   * **Sólo en fichas de tienda.** `GET /superadmin/admin/audit/logs` acepta
   * `store_id` pero NO acepta ningún filtro de organización: pedirlo desde una
   * ficha de organización devolvería los eventos de toda la plataforma bajo el
   * nombre de un tenant. Es exactamente la fuga que esta consola no se puede
   * permitir, así que allí el bloque se explica en vez de pintarse.
   *
   * El parámetro va en snake_case (`store_id`) porque así lo lee el
   * controlador. `AuditService.getAuditLogs()` lo envía como `storeId`, que el
   * backend ignora en silencio: reutilizar aquel método aquí habría devuelto
   * la plataforma entera con apariencia de estar filtrada.
   */
  private loadTimeline(token: number, activity: TenantActivity): void {
    const storeId = activity.tenant.store_id;
    if (storeId == null) return;

    const params = new HttpParams()
      .set('store_id', String(storeId))
      .set('limit', String(TIMELINE_LIMIT));

    this.http
      .get<AuditLogsResponse>(
        `${environment.apiUrl}/superadmin/admin/audit/logs`,
        { params },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (token !== this.requestToken) return;
          this._timeline.set(response?.data ?? []);
        },
        error: () => {
          if (token !== this.requestToken) return;
          // El timeline es un extra: su fallo no puede tumbar la ficha, pero
          // tampoco puede parecer "no hubo eventos".
          this._timeline.set([]);
          this._timelineUnavailable.set(true);
        },
      });
  }

  private describeError(err: unknown): string {
    const status = (err as { status?: number } | null)?.status;
    if (status === 403) {
      return 'No tienes permiso para consultar la actividad de este tenant.';
    }
    if (status === 404) {
      return 'El tenant no expone actividad: puede haber sido eliminado.';
    }
    return parseApiError(err).userMessage;
  }

  // -------------------------------------------------------------------
  // Huso horario — toda fecha de la pantalla pasa por aquí
  // -------------------------------------------------------------------

  /** Huso del tenant. Cae a Bogotá sólo si el backend no lo mandó. */
  protected readonly timezone = computed(
    () => this.activity()?.tenant.timezone || 'America/Bogota',
  );

  /**
   * Formateadores anclados al huso del TENANT, no al del navegador: soporte
   * mira estas fichas desde cualquier parte y "entró a las 23:40" tiene que
   * significar las 23:40 del comerciante.
   *
   * `hourCycle: 'h23'` y NUNCA `hour12: false`: con `hour12` el ICU de algunos
   * contenedores rinde la medianoche como `24:05` en vez de `00:05`.
   */
  private readonly dateTimeFormatter = computed(
    () =>
      new Intl.DateTimeFormat('es-CO', {
        timeZone: this.timezone(),
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  );

  private readonly dateFormatter = computed(
    () =>
      new Intl.DateTimeFormat('es-CO', {
        timeZone: this.timezone(),
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
  );

  /** Instante → fecha y hora en el huso del tenant. */
  protected instant(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return this.dateTimeFormatter().format(date);
  }

  /** Instante → sólo fecha en el huso del tenant. */
  protected dateOnly(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return this.dateFormatter().format(date);
  }

  /**
   * `YYYY-MM-DD` → `05 ago`.
   *
   * Se formatea DESDE LA CADENA, sin pasar por `Date`: el backend ya calculó
   * ese día en el huso del tenant y reinterpretarlo como instante lo correría
   * un día en cualquier navegador al oeste de UTC.
   */
  protected dayLabel(isoDate: string): string {
    const [, month, day] = isoDate.slice(0, 10).split('-');
    const monthIndex = Number(month) - 1;
    return `${day} ${MONTHS_SHORT[monthIndex] ?? month}`;
  }

  /** "hace 3 días" / "hoy". Aproximación por diferencia de instantes. */
  protected relative(value: string | null | undefined): string {
    if (!value) return 'nunca';
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return '—';

    const minutes = Math.floor((Date.now() - then) / 60000);
    if (minutes < 1) return 'ahora mismo';
    if (minutes < 60) return `hace ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;

    const days = Math.floor(hours / 24);
    if (days === 1) return 'ayer';
    if (days < 30) return `hace ${days} días`;

    const months = Math.floor(days / 30);
    if (months < 12) return `hace ${months} mes(es)`;
    return `hace ${Math.floor(months / 12)} año(s)`;
  }

  /** Días transcurridos desde un instante. `null` cuando no hay instante. */
  private daysSince(value: string | null | undefined): number | null {
    if (!value) return null;
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return null;
    return Math.floor((Date.now() - then) / 86_400_000);
  }

  // -------------------------------------------------------------------
  // 1. Semáforo
  // -------------------------------------------------------------------

  protected readonly lastAccessValue = computed(() => {
    const value = this.activity()?.last_access ?? null;
    return value ? this.relative(value) : 'Nunca';
  });

  protected readonly lastAccessHint = computed(() => {
    const value = this.activity()?.last_access ?? null;
    return value ? this.instant(value) : 'Nadie ha iniciado sesión jamás';
  });

  /** Verde ≤7 días, ámbar ≤30, rojo por encima o nunca. */
  protected readonly lastAccessTone = computed<'ok' | 'warn' | 'bad'>(() => {
    const days = this.daysSince(this.activity()?.last_access);
    if (days === null) return 'bad';
    if (days <= 7) return 'ok';
    if (days <= 30) return 'warn';
    return 'bad';
  });

  protected readonly seatsLabel = computed(() => {
    const data = this.activity();
    if (!data) return '—';
    return `de ${data.seats_total} asiento(s)`;
  });

  protected readonly weeklyTier = computed<TenantWeeklyTier>(
    () => this.activity()?.weekly_report_tier ?? 'ZERO',
  );

  protected readonly weeklyTierLabel = computed(
    () => WEEKLY_TIER_LABELS[this.weeklyTier()],
  );

  protected readonly weeklyTierHint = computed(() => {
    const data = this.activity();
    const report = data?.weekly_report;
    if (!report?.week_start_date) return WEEKLY_TIER_HINTS[this.weeklyTier()];
    return `Semana ${this.dateOnly(report.week_start_date)} → ${this.dateOnly(
      report.week_end_date,
    )}`;
  });

  /** Total de eventos atribuidos de la ventana. */
  protected readonly totalEvents = computed(() =>
    (this.activity()?.actions_by_day ?? []).reduce(
      (sum, day) => sum + day.count,
      0,
    ),
  );

  /**
   * Veredicto de una línea. Es la frase que soporte repite por teléfono, así
   * que se calcula del mismo dato que pintan las tarjetas y nunca de otro.
   */
  protected readonly verdict = computed<{
    tone: 'ok' | 'warn' | 'bad';
    icon: string;
    title: string;
    detail: string;
  } | null>(() => {
    const data = this.activity();
    if (!data) return null;

    const days = data.window.days;

    if (this.hasNoActivity()) {
      return {
        tone: 'bad',
        icon: 'alert-triangle',
        title: 'Sin actividad registrada',
        detail:
          data.last_access === null
            ? `Nadie ha iniciado sesión nunca y no hay eventos en los últimos ${days} días.`
            : `No hay eventos en los últimos ${days} días. El último acceso fue ${this.relative(
                data.last_access,
              )}.`,
      };
    }

    if (data.active_users_7d === 0) {
      return {
        tone: 'warn',
        icon: 'alert-circle',
        title: 'Uso detenido esta semana',
        detail: `Hubo ${data.active_users_30d} usuario(s) activo(s) en 30 días, pero ninguno en los últimos 7.`,
      };
    }

    return {
      tone: 'ok',
      icon: 'check',
      title: 'Tenant en uso',
      detail: `${data.active_users_7d} de ${data.seats_total} asiento(s) con actividad esta semana y ${this.totalEvents()} evento(s) en ${days} días.`,
    };
  });

  /**
   * Sin actividad ⇔ ni eventos, ni sesiones vivas, ni un acceso reciente. Es un
   * estado NORMAL (tienda recién creada), no un error: se pinta como tal.
   */
  protected readonly hasNoActivity = computed(() => {
    const data = this.activity();
    if (!data) return false;
    return (
      this.totalEvents() === 0 &&
      data.active_users_30d === 0 &&
      data.live_sessions.length === 0
    );
  });

  // -------------------------------------------------------------------
  // Eventos sin atribuir — nota, no tarjeta
  // -------------------------------------------------------------------

  /**
   * `null` en fichas de organización (allí no hay nada que atribuir); un número
   * en fichas de tienda.
   *
   * Se muestra SIEMPRE que exista, incluido el 0. Ocultarlo haría que un
   * conteo bajo se leyera como "no hubo uso" cuando la lectura correcta es "no
   * lo sabemos": `audit_logs.store_id` está mal poblado porque las llamadas
   * directas a `logCreate` / `logUpdate` / `logCustom` no lo pasan.
   */
  protected readonly unattributed = computed<number | null>(
    () => this.activity()?.unattributed_events ?? null,
  );

  protected readonly unattributedShare = computed<number>(() => {
    const orphans = this.unattributed() ?? 0;
    const total = this.totalEvents() + orphans;
    if (total === 0) return 0;
    return Math.round((orphans / total) * 100);
  });

  // -------------------------------------------------------------------
  // 2. Curva
  // -------------------------------------------------------------------

  protected readonly series = computed<
    ReadonlyArray<{
      date: string;
      count: number;
      heightPct: number;
      label: string;
    }>
  >(() => {
    const days = this.activity()?.actions_by_day ?? [];
    const max = days.reduce((peak, day) => Math.max(peak, day.count), 0);

    return days.map((day) => ({
      date: day.date,
      count: day.count,
      heightPct: max === 0 ? 0 : Math.round((day.count / max) * 100),
      label: `${this.dayLabel(day.date)}: ${day.count} evento(s)`,
    }));
  });

  protected readonly seriesPeak = computed(() =>
    this.series().reduce((peak, day) => Math.max(peak, day.count), 0),
  );

  /** Primer / último día de la ventana, para rotular el eje sin saturarlo. */
  protected readonly seriesEdges = computed(() => {
    const series = this.series();
    if (series.length === 0) return null;
    return {
      first: this.dayLabel(series[0].date),
      last: this.dayLabel(series[series.length - 1].date),
    };
  });

  protected readonly busiestDay = computed(() => {
    const series = this.series();
    if (series.length === 0) return null;
    const peak = series.reduce(
      (best, day) => (day.count > best.count ? day : best),
      series[0],
    );
    return peak.count === 0
      ? null
      : { label: this.dayLabel(peak.date), count: peak.count };
  });

  // -------------------------------------------------------------------
  // 3. Detalle
  // -------------------------------------------------------------------

  protected readonly sessionRows = computed<SessionRow[]>(() =>
    (this.activity()?.live_sessions ?? []).map((session) => ({
      id: session.id,
      user: session.user_name || 'Usuario desconocido',
      email: session.email || '—',
      device: describeDevice(session),
      ip: session.ip_address || '—',
      last_used: session.last_used
        ? `${this.instant(session.last_used)} · ${this.relative(session.last_used)}`
        : 'Nunca usada',
      started_at: this.instant(session.started_at),
      expires_at: this.instant(session.expires_at),
    })),
  );

  protected readonly sessionColumns: TableColumn[] = [
    { key: 'user', label: 'Usuario', priority: 1, width: '160px' },
    { key: 'device', label: 'Dispositivo', priority: 1 },
    { key: 'ip', label: 'IP', priority: 2, width: '130px' },
    { key: 'last_used', label: 'Último uso', priority: 1, width: '200px' },
    { key: 'expires_at', label: 'Expira', priority: 3, width: '150px' },
  ];

  protected readonly sessionCardConfig: ItemListCardConfig = {
    titleKey: 'user',
    subtitleKey: 'email',
    avatarFallbackIcon: 'monitor',
    detailKeys: [
      { key: 'device', label: 'Dispositivo', icon: 'smartphone' },
      { key: 'ip', label: 'IP', icon: 'wifi' },
      { key: 'last_used', label: 'Último uso', icon: 'clock' },
      { key: 'expires_at', label: 'Expira', icon: 'calendar' },
    ],
  };

  protected readonly topUserRows = computed<TopUserRow[]>(() =>
    (this.activity()?.top_users ?? []).map((user) => ({
      user_id: user.user_id,
      user: user.user_name || `Usuario #${user.user_id}`,
      email: user.email || '—',
      count: user.count,
      is_current_seat: user.is_current_seat,
      seat_label: user.is_current_seat ? 'Con asiento' : 'Sin asiento',
    })),
  );

  /** Hay al menos un actor que ya no tiene asiento en el tenant. */
  protected readonly hasFormerStaff = computed(() =>
    this.topUserRows().some((row) => !row.is_current_seat),
  );

  protected readonly topUserColumns: TableColumn[] = [
    { key: 'user', label: 'Usuario', priority: 1 },
    { key: 'email', label: 'Correo', priority: 3 },
    {
      key: 'count',
      label: 'Eventos',
      priority: 1,
      align: 'right',
      width: '100px',
    },
    {
      key: 'seat_label',
      label: 'Vínculo',
      priority: 1,
      align: 'center',
      width: '130px',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        // Hex de 7 caracteres: el badge de la tabla pinta color, no clases.
        colorMap: {
          'Con asiento': '#10b981',
          'Sin asiento': '#f59e0b',
        },
      },
    },
  ];

  protected readonly topUserCardConfig: ItemListCardConfig = {
    titleKey: 'user',
    subtitleKey: 'email',
    avatarFallbackIcon: 'user-check',
    badgeKey: 'seat_label',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        'Con asiento': '#10b981',
        'Sin asiento': '#f59e0b',
      },
    },
    detailKeys: [{ key: 'count', label: 'Eventos', icon: 'activity' }],
  };

  /** Resalta la fila de quien ya no tiene asiento: es la explicación buscada. */
  protected readonly topUserRowClass = (row: TopUserRow): string | undefined =>
    row.is_current_seat ? undefined : 'bg-amber-50';

  protected readonly modules = computed(() => {
    const rows = this.activity()?.modules_touched ?? [];
    const max = rows.reduce((peak, row) => Math.max(peak, row.count), 0);
    return rows.map((row) => ({
      resource: row.resource,
      label: RESOURCE_LABELS[row.resource] ?? row.resource,
      count: row.count,
      widthPct: max === 0 ? 0 : Math.max(3, Math.round((row.count / max) * 100)),
      lastAt: this.instant(row.last_at),
    }));
  });

  protected readonly topActions = computed(() =>
    (this.activity()?.top_actions ?? []).map((row) => ({
      action: row.action,
      label: ACTION_LABELS[row.action] ?? row.action,
      count: row.count,
    })),
  );

  protected readonly timelineRows = computed<TimelineRow[]>(() =>
    this._timeline().map((log) => ({
      id: log.id,
      when: this.instant(log.created_at),
      who: log.users
        ? `${log.users.first_name ?? ''} ${log.users.last_name ?? ''}`.trim() ||
          log.users.email
        : 'Sistema',
      action: ACTION_LABELS[log.action] ?? String(log.action),
      resource: RESOURCE_LABELS[log.resource] ?? String(log.resource),
      ip: log.ip_address || '—',
    })),
  );

  /** El timeline crudo sólo puede acotarse por tienda. Ver `loadTimeline`. */
  protected readonly timelineScoped = computed(
    () => this.activity()?.tenant.store_id != null,
  );

  protected readonly timelineColumns: TableColumn[] = [
    { key: 'when', label: 'Cuándo', priority: 1, width: '160px' },
    { key: 'who', label: 'Quién', priority: 1 },
    { key: 'action', label: 'Acción', priority: 1, width: '140px' },
    { key: 'resource', label: 'Recurso', priority: 2, width: '140px' },
    { key: 'ip', label: 'IP', priority: 3, width: '130px' },
  ];

  protected readonly timelineCardConfig: ItemListCardConfig = {
    titleKey: 'who',
    subtitleKey: 'when',
    avatarFallbackIcon: 'history',
    detailKeys: [
      { key: 'action', label: 'Acción', icon: 'activity' },
      { key: 'resource', label: 'Recurso', icon: 'layers' },
      { key: 'ip', label: 'IP', icon: 'wifi' },
    ],
  };

  // -------------------------------------------------------------------
  // Presentación
  // -------------------------------------------------------------------

  protected toneIconBg(tone: 'ok' | 'warn' | 'bad'): string {
    if (tone === 'ok') return 'bg-green-100';
    if (tone === 'warn') return 'bg-amber-100';
    return 'bg-red-100';
  }

  protected toneIconColor(tone: 'ok' | 'warn' | 'bad'): string {
    if (tone === 'ok') return 'text-green-600';
    if (tone === 'warn') return 'text-amber-600';
    return 'text-red-600';
  }

  protected toneBoxClass(tone: 'ok' | 'warn' | 'bad'): string {
    if (tone === 'ok') return 'border-green-300 bg-green-50';
    if (tone === 'warn') return 'border-amber-300 bg-amber-50';
    return 'border-red-300 bg-red-50';
  }

  protected toneTextClass(tone: 'ok' | 'warn' | 'bad'): string {
    if (tone === 'ok') return 'text-green-900';
    if (tone === 'warn') return 'text-amber-900';
    return 'text-red-900';
  }
}

/**
 * Describe la sesión de forma legible.
 *
 * `device_info` gana cuando trae algo: lo escribe el login real. Si no, se
 * deduce del `user_agent`, que es lo único que queda cuando el cliente no lo
 * envió. Nunca se muestra el `user_agent` crudo: no cabe en la celda y no dice
 * nada de un vistazo.
 */
function describeDevice(session: TenantLiveSession): string {
  const info = session.device_info;
  if (typeof info === 'string' && info.trim()) return info.trim();
  if (info && typeof info === 'object') {
    const record = info as Record<string, unknown>;
    const parts = ['device', 'os', 'browser', 'platform', 'name']
      .map((key) => record[key])
      .filter((value): value is string => typeof value === 'string' && !!value);
    if (parts.length) return parts.join(' · ');
  }

  const agent = session.user_agent;
  if (!agent) return 'Dispositivo desconocido';

  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\/|Opera/.test(agent)
      ? 'Opera'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Firefox\//.test(agent)
          ? 'Firefox'
          : /Safari\//.test(agent)
            ? 'Safari'
            : 'Navegador';

  const platform = /iPhone|iPad|iPod/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Escritorio';

  return `${browser} · ${platform}`;
}
