import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  TenantContextRunner,
  type ResolvedTenantScope,
  type TenantTarget,
} from '@common/context/tenant-context-runner.service';
import {
  enumerateLocalPeriodKeys,
  localDateString,
  localPeriodSql,
  resolveLocalDateRange,
  resolveOrganizationTimezone,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';

import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import type { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import type { WeeklyTier } from '../../store/weekly-report/types';

import {
  TENANT_ACTIVITY_DEFAULT_DAYS,
  type TenantActivityQueryDto,
} from './dto/tenant-activity-query.dto';

/** Tiers válidos del reporte semanal. Cualquier otro valor degrada a `ZERO`. */
const WEEKLY_TIERS: readonly WeeklyTier[] = ['ZERO', 'BELOW', 'ABOVE', 'STELLAR'];

/** Cuántas filas devuelven los rankings y el listado de sesiones. */
const TOP_LIMIT = 10;
const LIVE_SESSIONS_LIMIT = 25;

/**
 * Eje de tenant de la ficha de actividad. Es el ÚNICO objeto del que salen los
 * `where`, para que ninguna consulta pueda quedarse sin filtro por descuido.
 */
interface ActivityScope {
  organization_id: number;
  /** `null` ⇔ la ficha mira una organización entera. */
  store_id: number | null;
  timezone: string;
}

interface LocalWindow {
  /** Instante UTC del primer milisegundo del primer día local de la ventana. */
  startDate: Date;
  /** Instante UTC del último milisegundo del último día local de la ventana. */
  endDate: Date;
}

/**
 * Actividad de uso de un tenant, para que soporte pueda responder "¿esta
 * tienda se está usando?" sin entrar a su panel ni mirar sus datos de negocio.
 *
 * Devuelve exclusivamente TELEMETRÍA DE USO — accesos, sesiones vivas, conteos
 * de eventos de auditoría y el tier del último reporte semanal. Ninguna cifra
 * de aquí es un importe, un pedido ni un cliente del comerciante.
 *
 * Como `TenantDirectoryService`, usa `GlobalPrismaService` sin scope, y la
 * regla que lo hace seguro es la misma disciplina: **toda** consulta lleva un
 * id de tenant obligatorio en su `where`. Un `where` incompleto sobre un
 * cliente sin scope no falla — devuelve filas de otros tenants en silencio.
 */
@Injectable()
export class TenantActivityService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly runner: TenantContextRunner,
  ) {}

  private get db() {
    return this.globalPrisma.withoutScope();
  }

  async getActivity(target: TenantTarget, query: TenantActivityQueryDto) {
    const resolved = await this.runner.resolve(target);
    const scope = await this.buildScope(target, resolved);

    const days = query.days ?? TENANT_ACTIVITY_DEFAULT_DAYS;
    const window = this.localWindow(scope.timezone, days);
    // Ventanas de los contadores nombrados. Fijas a 7 y 30 días y ancladas al
    // mismo "hoy" local, así que la de 7 es siempre un subconjunto de la de 30.
    const window7 = this.localWindow(scope.timezone, 7);
    const window30 = this.localWindow(scope.timezone, 30);

    const roster = await this.readRoster(scope);
    const rosterIds = new Set(roster.map((user) => user.id));

    const [
      recentActors,
      liveSessions,
      actionsByDay,
      topActions,
      topUsers,
      modulesTouched,
      weeklyReport,
      unattributedEvents,
    ] = await Promise.all([
      this.readRecentActors(scope, window30),
      this.readLiveSessions(roster),
      this.readActionsByDay(scope, window),
      this.readTopActions(scope, window),
      this.readTopUsers(scope, window, rosterIds),
      this.readModulesTouched(scope, window),
      this.readWeeklyReport(scope),
      this.countUnattributedEvents(scope, window),
    ]);

    const seatActors = recentActors.filter((actor) => rosterIds.has(actor.user_id));
    const active_users_30d = seatActors.length;
    const active_users_7d = seatActors.filter(
      (actor) => actor.last_seen_at.getTime() >= window7.startDate.getTime(),
    ).length;

    return {
      tenant: {
        scope: scope.store_id == null ? 'organization' : 'store',
        organization_id: scope.organization_id,
        organization_name: resolved.organization_name,
        store_id: scope.store_id,
        store_name: resolved.store_name,
        is_active: resolved.store_is_active,
        timezone: scope.timezone,
      },
      window: {
        days,
        from: window.startDate,
        to: window.endDate,
      },
      last_access: this.maxLastLogin(roster),
      seats_total: roster.length,
      active_users_7d,
      active_users_30d,
      live_sessions: liveSessions,
      actions_by_day: actionsByDay,
      top_actions: topActions,
      top_users: topUsers,
      modules_touched: modulesTouched,
      weekly_report_tier: this.normalizeTier(weeklyReport?.tier),
      weekly_report: weeklyReport,
      /**
       * Eventos del periodo que el escritor nunca atribuyó a una tienda
       * (`audit_logs.store_id IS NULL`). Viaja con la respuesta para que un
       * conteo bajo se lea como "no lo sabemos" y no como "no hubo uso".
       * `null` en la ficha de organización, donde no hay nada que atribuir.
       */
      unattributed_events: unattributedEvents,
    };
  }

  // --------------------------------------------------------------------
  // Eje de tenant y ventana temporal
  // --------------------------------------------------------------------

  /**
   * Fija el eje de la ficha.
   *
   * La tienda sale de la URL, no de `resolve()`. `ResolvedTenantScope.store_id`
   * es deliberadamente `null` cuando la organización factura con NIT único,
   * porque ahí describe DÓNDE VIVE LA IDENTIDAD FISCAL — y la identidad fiscal
   * no tiene nada que decir sobre quién entró a qué tienda. Usar aquel valor
   * haría que `/stores/12/activity` respondiera la actividad de toda la
   * organización bajo una URL que nombra una tienda. Este criterio sólo puede
   * ESTRECHAR el filtro respecto del alcance resuelto, nunca ensancharlo: la
   * tienda pertenece a la organización que `resolve()` ya validó.
   *
   * Cuando no hay tienda —ficha de organización— el filtro es
   * `organization_id`, como manda la regla de que toda consulta lleve un id de
   * tenant en el `where`.
   */
  private async buildScope(
    target: TenantTarget,
    resolved: ResolvedTenantScope,
  ): Promise<ActivityScope> {
    const store_id =
      target.kind === 'store' ? target.store_id : resolved.store_id;

    const timezone =
      store_id != null
        ? // El util está tipado contra `StorePrismaService` pero sólo lee
          // `store_settings` (+ la relación `stores`), así que el cliente sin
          // scope lo satisface. La consola es cross-tenant por definición: el
          // cliente scoped rechazaría la tienda que se está inspeccionando.
          await resolveStoreTimezone(
            this.db as unknown as StorePrismaService,
            store_id,
          )
        : await resolveOrganizationTimezone(this.db, resolved.organization_id);

    return {
      organization_id: resolved.organization_id,
      store_id,
      timezone,
    };
  }

  /**
   * Ventana de los últimos `days` días NATURALES DEL TENANT, devuelta como
   * instantes UTC. El día de negocio se calcula en la zona del tenant: una
   * acción de las 23:00 en Bogotá ocurre a las 04:00Z del día siguiente y en
   * UTC caería en el bucket equivocado.
   *
   * `days` es inclusivo de hoy, así que la ventana arranca `days - 1` días
   * atrás. El desplazamiento se hace sobre la fecha civil ya localizada
   * (aritmética de calendario, sin semántica de huso) y es
   * `resolveLocalDateRange` quien la convierte en instantes reales, de modo que
   * un cambio de horario de verano dentro de la ventana no corre el límite.
   */
  private localWindow(timezone: string, days: number): LocalWindow {
    const date_to = localDateString(new Date(), timezone);
    const date_from = shiftCalendarDate(date_to, -(days - 1));
    return resolveLocalDateRange({ date_from, date_to }, timezone);
  }

  // --------------------------------------------------------------------
  // Lecturas — todas con id de tenant obligatorio en el where
  // --------------------------------------------------------------------

  /**
   * `where` de `audit_logs` para el tenant. Siempre lleva `organization_id`;
   * añade `store_id` cuando la ficha mira una tienda concreta.
   *
   * El filtro por tienda es ESTRICTO: no recoge las filas con `store_id NULL`
   * de la misma organización. Repartirlas entre todas las tiendas inflaría
   * cada ficha con el trabajo de las demás. Lo que se pierde por ese lado se
   * reporta aparte en `unattributed_events`.
   */
  private auditWhere(scope: ActivityScope): Prisma.audit_logsWhereInput {
    return scope.store_id == null
      ? { organization_id: scope.organization_id }
      : { organization_id: scope.organization_id, store_id: scope.store_id };
  }

  /** Fragmento SQL equivalente a {@link auditWhere}, para la serie diaria. */
  private auditWhereSql(scope: ActivityScope): Prisma.Sql {
    return scope.store_id == null
      ? Prisma.sql`al.organization_id = ${scope.organization_id}`
      : Prisma.sql`al.organization_id = ${scope.organization_id} AND al.store_id = ${scope.store_id}`;
  }

  /**
   * Plantilla de usuarios del tenant.
   *
   * Tienda: quien tiene asiento en ella (`store_users`) o la lleva como tienda
   * principal — `environment-switch.service` crea el `store_users` de forma
   * perezosa, así que un dueño que aún no ha cambiado de entorno sólo aparece
   * por `main_store_id`. El `organization_id` va como AND por encima del OR:
   * sin él, un `store_users` huérfano bastaría para colar a un usuario ajeno.
   *
   * Organización: todos sus usuarios.
   */
  private async readRoster(scope: ActivityScope) {
    const where: Prisma.usersWhereInput =
      scope.store_id == null
        ? { organization_id: scope.organization_id }
        : {
            organization_id: scope.organization_id,
            OR: [
              { store_users: { some: { store_id: scope.store_id } } },
              { main_store_id: scope.store_id },
            ],
          };

    return this.db.users.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        last_login: true,
      },
    });
  }

  /**
   * Usuarios con al menos un evento en los últimos 30 días y el instante de su
   * evento más reciente.
   *
   * Una sola consulta para los DOS contadores: `active_users_7d` se deriva
   * comparando ese máximo contra el inicio de la ventana de 7 días, así que el
   * conjunto de 7 es por construcción un subconjunto del de 30 y los dos no
   * pueden discrepar por haberse leído en momentos distintos.
   */
  private async readRecentActors(scope: ActivityScope, window: LocalWindow) {
    const rows = await this.db.audit_logs.groupBy({
      by: ['user_id'],
      where: {
        ...this.auditWhere(scope),
        user_id: { not: null },
        created_at: { gte: window.startDate, lte: window.endDate },
      },
      _max: { created_at: true },
    });

    return rows
      .map((row) => ({
        user_id: row.user_id as number,
        last_seen_at: row._max.created_at,
      }))
      .filter(
        (row): row is { user_id: number; last_seen_at: Date } =>
          row.user_id != null && row.last_seen_at != null,
      );
  }

  /**
   * Sesiones vivas del tenant: refresh tokens sin revocar y sin caducar de la
   * plantilla.
   *
   * El filtro de tenant es la propia plantilla (`user_id IN roster`), que ya se
   * calculó con `organization_id` y, si aplica, `store_id`. Con la plantilla
   * vacía se devuelve `[]` sin consultar: un `{ in: [] }` es inofensivo, pero
   * ahorrarse el viaje deja explícito que aquí nunca hay un match-all.
   *
   * `ip_address` y `user_agent` salen de `refresh_tokens`, que los captura en
   * el login real. No se tocan `login_attempts`: allí llegan vacíos y con la
   * tienda atribuida por heurística.
   */
  private async readLiveSessions(
    roster: Array<{
      id: number;
      username: string;
      email: string | null;
      first_name: string;
      last_name: string;
    }>,
  ) {
    if (roster.length === 0) {
      return [];
    }

    const byId = new Map(roster.map((user) => [user.id, user]));

    const rows = await this.db.refresh_tokens.findMany({
      where: {
        user_id: { in: roster.map((user) => user.id) },
        revoked: false,
        expires_at: { gt: new Date() },
      },
      orderBy: [
        // Un token recién emitido y nunca usado no debe encabezar la lista de
        // "lo último que pasó": en DESC Postgres pone los NULL primero.
        { last_used: { sort: 'desc', nulls: 'last' } },
        { created_at: 'desc' },
      ],
      take: LIVE_SESSIONS_LIMIT,
      select: {
        id: true,
        user_id: true,
        ip_address: true,
        user_agent: true,
        device_info: true,
        device_fingerprint: true,
        last_used: true,
        created_at: true,
        expires_at: true,
      },
    });

    return rows.map((row) => {
      const user = row.user_id != null ? byId.get(row.user_id) : undefined;
      return {
        id: row.id,
        user_id: row.user_id,
        user_name: displayName(user),
        email: user?.email ?? null,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        device_info: row.device_info,
        device_fingerprint: row.device_fingerprint,
        last_used: row.last_used,
        started_at: row.created_at,
        expires_at: row.expires_at,
      };
    });
  }

  /**
   * Serie diaria de eventos, con un bucket por día natural del tenant.
   *
   * En SQL crudo porque `groupBy` de Prisma no sabe truncar un timestamp a día.
   * La etiqueta la produce `localPeriodSql` como TEXT en la propia consulta —
   * re-derivarla en JS desde un `timestamp` devuelto reintroduce la ambigüedad
   * de huso que el driver `pg` no puede resolver. El zero-fill camina el
   * calendario local con `enumerateLocalPeriodKeys`, que genera exactamente las
   * mismas etiquetas, así que no hay desalineación en los bordes.
   *
   * Consulta cruda ⇒ el scoping por extensión de Prisma no aplica: el filtro de
   * tenant va escrito a mano en el WHERE y parametrizado.
   */
  private async readActionsByDay(scope: ActivityScope, window: LocalWindow) {
    const periodSql = localPeriodSql('al.created_at', scope.timezone, 'day');

    const rows = await this.db.$queryRaw<Array<{ period: string; count: number }>>`
      SELECT
        ${periodSql} AS period,
        COUNT(*)::int AS count
      FROM audit_logs al
      WHERE ${this.auditWhereSql(scope)}
        AND al.created_at >= ${window.startDate}
        AND al.created_at <= ${window.endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const counts = new Map(rows.map((row) => [row.period, Number(row.count)]));

    return enumerateLocalPeriodKeys(
      window.startDate,
      window.endDate,
      'day',
      scope.timezone,
    ).map((date) => ({ date, count: counts.get(date) ?? 0 }));
  }

  /** Acciones más frecuentes del periodo (CREATE, UPDATE, LOGIN, ...). */
  private async readTopActions(scope: ActivityScope, window: LocalWindow) {
    const rows = await this.db.audit_logs.groupBy({
      by: ['action'],
      where: {
        ...this.auditWhere(scope),
        created_at: { gte: window.startDate, lte: window.endDate },
      },
      _count: { _all: true },
      orderBy: { _count: { action: 'desc' } },
      take: TOP_LIMIT,
    });

    return rows.map((row) => ({
      action: row.action,
      count: row._count._all,
    }));
  }

  /**
   * Usuarios más activos del periodo.
   *
   * A diferencia de `active_users_*`, aquí NO se recorta a la plantilla: si
   * quien movió la tienda fue alguien que ya no tiene asiento, ocultarlo
   * borraría justo la explicación que soporte está buscando. Cada fila declara
   * con `is_current_seat` si la persona sigue vinculada.
   */
  private async readTopUsers(
    scope: ActivityScope,
    window: LocalWindow,
    rosterIds: Set<number>,
  ) {
    const rows = await this.db.audit_logs.groupBy({
      by: ['user_id'],
      where: {
        ...this.auditWhere(scope),
        user_id: { not: null },
        created_at: { gte: window.startDate, lte: window.endDate },
      },
      _count: { _all: true },
      orderBy: { _count: { user_id: 'desc' } },
      take: TOP_LIMIT,
    });

    const userIds = rows
      .map((row) => row.user_id)
      .filter((id): id is number => id != null);

    if (userIds.length === 0) {
      return [];
    }

    // Filtro de tenant también aquí: `id IN (...)` sale de filas ya acotadas al
    // tenant, y el `organization_id` lo deja verificable sin seguir la cadena.
    const users = await this.db.users.findMany({
      where: { id: { in: userIds }, organization_id: scope.organization_id },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
      },
    });
    const byId = new Map(users.map((user) => [user.id, user]));

    return rows
      .filter((row) => row.user_id != null)
      .map((row) => {
        const id = row.user_id as number;
        const user = byId.get(id);
        return {
          user_id: id,
          user_name: displayName(user),
          email: user?.email ?? null,
          count: row._count._all,
          is_current_seat: rosterIds.has(id),
        };
      });
  }

  /** Recursos tocados en el periodo: qué partes del producto se usan. */
  private async readModulesTouched(scope: ActivityScope, window: LocalWindow) {
    const rows = await this.db.audit_logs.groupBy({
      by: ['resource'],
      where: {
        ...this.auditWhere(scope),
        created_at: { gte: window.startDate, lte: window.endDate },
      },
      _count: { _all: true },
      _max: { created_at: true },
      orderBy: { _count: { resource: 'desc' } },
    });

    return rows.map((row) => ({
      resource: row.resource,
      count: row._count._all,
      last_at: row._max.created_at,
    }));
  }

  /**
   * Último reporte semanal del tenant.
   *
   * Se lee la tabla directamente en vez de llamar a
   * `WeeklyReportService.getLatestForCurrentStore()`: aquel resuelve la tienda
   * del ALS —que en esta consola es la del super admin— y, si falta el snapshot
   * de la semana cerrada, lo GENERA. Un GET de soporte no puede escribir en la
   * tienda que está inspeccionando ni disparar la notificación `weekly_report`
   * al comerciante.
   */
  private async readWeeklyReport(scope: ActivityScope) {
    const row = await this.db.store_weekly_reports.findFirst({
      where:
        scope.store_id == null
          ? { stores: { organization_id: scope.organization_id } }
          : { store_id: scope.store_id },
      orderBy: { week_start_date: 'desc' },
      select: {
        store_id: true,
        week_start_date: true,
        week_end_date: true,
        tier: true,
        generated_at: true,
        viewed_at: true,
      },
    });

    return row ?? null;
  }

  /**
   * Eventos del periodo que la organización registró sin tienda. Sólo aplica a
   * la ficha de tienda: en la de organización no hay atribución pendiente.
   */
  private async countUnattributedEvents(
    scope: ActivityScope,
    window: LocalWindow,
  ): Promise<number | null> {
    if (scope.store_id == null) {
      return null;
    }

    return this.db.audit_logs.count({
      where: {
        organization_id: scope.organization_id,
        store_id: null,
        created_at: { gte: window.startDate, lte: window.endDate },
      },
    });
  }

  // --------------------------------------------------------------------
  // Derivaciones
  // --------------------------------------------------------------------

  /**
   * Último acceso del tenant: el `users.last_login` más reciente de la
   * plantilla. `null` en una tienda donde nadie ha entrado nunca.
   */
  private maxLastLogin(roster: Array<{ last_login: Date | null }>): Date | null {
    let latest: Date | null = null;
    for (const user of roster) {
      if (user.last_login && (!latest || user.last_login > latest)) {
        latest = user.last_login;
      }
    }
    return latest;
  }

  /**
   * Tienda sin reporte semanal ⇒ `ZERO`, el mismo tier con el que el producto
   * describe una semana sin actividad. Un valor desconocido en la columna
   * (es `VarChar`, no un enum) degrada igual en vez de filtrarse al frontend.
   */
  private normalizeTier(tier?: string | null): WeeklyTier {
    return WEEKLY_TIERS.includes(tier as WeeklyTier)
      ? (tier as WeeklyTier)
      : 'ZERO';
  }
}

/**
 * Desplaza una fecha civil `YYYY-MM-DD` un número de días.
 *
 * Aritmética de CALENDARIO pura sobre la fecha ya localizada: no interpreta
 * husos ni instantes, sólo cuenta días. Quien la convierte en instantes reales
 * es `resolveLocalDateRange`, que sí conoce el huso del tenant.
 */
function shiftCalendarDate(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate
    .slice(0, 10)
    .split('-')
    .map((part) => parseInt(part, 10));

  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + deltaDays);

  return [
    String(cursor.getUTCFullYear()).padStart(4, '0'),
    String(cursor.getUTCMonth() + 1).padStart(2, '0'),
    String(cursor.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** Nombre legible de un usuario, con caída a email y a username. */
function displayName(
  user?: {
    username: string;
    email: string | null;
    first_name: string;
    last_name: string;
  } | null,
): string | null {
  if (!user) {
    return null;
  }
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return full || user.email || user.username;
}
