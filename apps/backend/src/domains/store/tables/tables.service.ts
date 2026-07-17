import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { QrService } from '@common/services/qr.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateTableDto,
  UpdateTableDto,
  TableQueryDto,
  TableStatus,
} from './dto';

/**
 * Result shape of a single floor-map row. Extends the base `tables`
 * record with a `session` field (the active `table_sessions` row, if
 * any) and a normalized `effective_status` (the table status OR 'occupied'
 * if a session is open, regardless of the persisted `status` field).
 */
export interface FloorMapTable {
  id: number;
  store_id: number;
  name: string;
  zone: string | null;
  capacity: number | null;
  status: TableStatus;
  pos_x: number | null;
  pos_y: number | null;
  created_at: Date | null;
  updated_at: Date | null;
  active_session: {
    id: number;
    order_id: number;
    opened_by: number;
    opened_at: Date;
    closed_at: Date | null;
    guest_count: number | null;
  } | null;
  effective_status: TableStatus;
  pending_bookings?: Array<{
    id: number;
    booking_number: string;
    date: string | Date;
    start_time: string;
    end_time: string;
    status: string;
    customer: {
      id: number;
      first_name: string;
      last_name: string;
      phone: string | null;
    } | null;
    product: { id: number; name: string } | null;
  }>;
}

/**
 * TablesService
 *
 * Store-scoped CRUD for the `tables` and `table_sessions` domain of the
 * Restaurant Suite (Fase E).
 *
 * Responsibilities:
 *  - CRUD on `tables`.
 *  - Floor-map projection: every table + its active session (if any).
 *  - Helpers used by `TableSessionsService` (getActiveSession,
 *    findByZone).
 *
 * Tenant scope: every read/write relies on `StorePrismaService`
 * auto-scoping. Cross-store access is impossible.
 *
 * Floor-map is intentionally a single round-trip endpoint to power the
 * store-admin "mesas" view. It uses `findMany` + a manual filter for
 * active sessions (closed_at IS NULL), avoiding the need for a second
 * `findUnique` per row.
 */
@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    private prisma: StorePrismaService,
    private readonly qrService: QrService,
  ) {}

  // ------------------------------------------------------------------ helpers
  private requireStoreId(): number {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  async getById(id: number) {
    const table = await this.prisma.tables.findFirst({ where: { id } });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }
    return table;
  }

  async findByZone(zone: string) {
    return this.prisma.tables.findMany({
      where: { zone },
      orderBy: [{ name: 'asc' }],
    });
  }

  /**
   * Returns the OPEN table_session for a table (closed_at IS NULL), or
   * null if there is none. Throws nothing — callers decide how to react.
   */
  async getActiveSession(tableId: number) {
    return this.prisma.table_sessions.findFirst({
      where: { table_id: tableId, closed_at: null },
      orderBy: { opened_at: 'desc' },
    });
  }

  /**
   * Returns the ids of staff users currently assigned as waiters for a
   * table. Navigates via the `tables` parent so the call stays inside
   * the store-scoped client (the `tables` model is in
   * `StorePrismaService.store_scoped_models`); the relation join to
   * `table_waiters` is therefore transitively scoped. Returns an empty
   * array if the table does not belong to the current store.
   *
   * Public so other services (e.g. EcommerceTablesService) can resolve
   * the assigned waiter for a given public_token without re-querying.
   */
  async getAssignedWaiterUserIds(tableId: number): Promise<number[]> {
    const table = await this.prisma.tables.findFirst({
      where: { id: tableId },
      include: {
        table_waiters: { select: { user_id: true } },
      },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }
    return table.table_waiters.map((tw) => tw.user_id);
  }

  // -------------------------------------------------------- waiter pivote
  /**
   * STAFF-only guard for `waiter_user_ids`. Each id must:
   *  (a) have a `store_users` row in this store, AND
   *  (b) carry NO role named `customer` (we look at the user_roles
   *      join via the relation to `roles`).
   *
   * Throws BadRequestException("Uno o más usuarios no son staff de la
   * tienda") on the first violation. Called BEFORE opening the
   * transaction so a bad payload fails fast with no DB writes.
   *
   * Note: `store_users` / `user_roles` / `users` are NOT in
   * `store_scoped_models` (the latter two simply have no store_id
   * column). The `where: { user_id: { in: userIds } }` filter and the
   * `store_users` member check together make this safe by transitive
   * trust — every candidate user_id has been confirmed to belong to
   * this store before this helper returns.
   */
  private async assertStaffUserIds(
    storeId: number,
    userIds: number[],
  ): Promise<void> {
    if (userIds.length === 0) return;

    // (a) membership in this store
    const members = await this.prisma.store_users.findMany({
      where: { store_id: storeId, user_id: { in: userIds } },
      select: { user_id: true },
    });
    const memberSet = new Set(members.map((m) => m.user_id));
    for (const uid of userIds) {
      if (!memberSet.has(uid)) {
        throw new BadRequestException(
          'Uno o más usuarios no son staff de la tienda',
        );
      }
    }

    // (b) none may have the `customer` role
    const customerRoles = await this.prisma.user_roles.findMany({
      where: {
        user_id: { in: userIds },
        roles: { name: 'customer' },
      },
      select: { user_id: true },
    });
    if (customerRoles.length > 0) {
      throw new BadRequestException(
        'Uno o más usuarios no son staff de la tienda',
      );
    }
  }

  /**
   * Synchronizes the `table_waiters` pivot for a given table inside an
   * existing `$transaction`. Three modes driven by the input:
   *
   *   - `undefined` → no-op (caller asked us to preserve current state;
   *     update-only behavior).
   *   - `[]`        → clear all waiters for this table.
   *   - `[a,b,...]` → remove anyone NOT in the list, then insert any
   *     new ids (idempotent via `skipDuplicates` against the
   *     (table_id, user_id) unique constraint).
   *
   * IMPORTANT: the caller MUST have already verified that the table
   * belongs to this store (via `tables.findFirst`) before opening the
   * transaction. `table_waiters` is intentionally NOT registered in
   * the StorePrisma relational scope map (it would require editing
   * the shared prisma service — out of scope for this step); the
   * transitive trust on `table_id` is what enforces isolation.
   */
  private async syncTableWaiters(
    tx: Prisma.TransactionClient,
    tableId: number,
    waiterUserIds: number[] | undefined,
  ): Promise<void> {
    if (waiterUserIds === undefined) return;
    if (waiterUserIds.length === 0) {
      await tx.table_waiters.deleteMany({ where: { table_id: tableId } });
      return;
    }
    await tx.table_waiters.deleteMany({
      where: { table_id: tableId, user_id: { notIn: waiterUserIds } },
    });
    await tx.table_waiters.createMany({
      data: waiterUserIds.map((uid) => ({
        table_id: tableId,
        user_id: uid,
      })),
      skipDuplicates: true,
    });
  }

  // ----------------------------------------------------------------- CRUD
  async create(dto: CreateTableDto) {
    const storeId = this.requireStoreId();

    // (store_id, name) is unique — surface a friendly error instead of P2002.
    const dup = await this.prisma.tables.findFirst({
      where: { name: dto.name },
    });
    if (dup) {
      throw new VendixHttpException(ErrorCodes.TABLE_DUP_NAME);
    }

    // Fail fast on bad waiter ids BEFORE opening the transaction —
    // saves a round-trip when the payload is malformed.
    if (dto.waiter_user_ids && dto.waiter_user_ids.length > 0) {
      await this.assertStaffUserIds(storeId, dto.waiter_user_ids);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const table = await tx.tables.create({
          data: {
            store_id: storeId,
            name: dto.name,
            zone: dto.zone ?? null,
            capacity: dto.capacity ?? null,
            status: dto.status ?? 'available',
            pos_x: dto.pos_x ?? null,
            pos_y: dto.pos_y ?? null,
            public_token: uuidv4(),
            updated_at: new Date(),
          },
        });

        await this.syncTableWaiters(tx, table.id, dto.waiter_user_ids);

        return table;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.TABLE_DUP_NAME);
      }
      throw error;
    }
  }

  async findAll(query: TableQueryDto) {
    const {
      page = 1,
      limit = 50,
      search,
      status,
      zone,
    } = query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.tablesWhereInput = {
      ...(status && { status }),
      ...(zone && { zone }),
      ...(search && {
        name: { contains: search, mode: 'insensitive' },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.tables.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ zone: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.tables.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const table = await this.getById(id);
    const active_session = await this.getActiveSession(id);
    return { ...table, active_session };
  }

  // --------------------------------------------------------------- QR por mesa
  /**
   * Resuelve el dominio ecommerce primario activo de la tienda.
   *
   * Replica la lógica de `EcommerceService.findPrimaryEcommerceDomain`
   * (privado en ese servicio — fuera de scope importarlo). Query directa
   * a `domain_settings` filtrando por store_id + domain_type 'ecommerce'
   * + status 'active' + is_primary true.
   */
  private async findPrimaryEcommerceDomain(storeId: number) {
    return this.prisma.domain_settings.findFirst({
      where: {
        store_id: storeId,
        domain_type: 'ecommerce',
        status: 'active',
        is_primary: true,
      },
      orderBy: { updated_at: 'desc' },
    });
  }

  /**
   * Construye la URL completa del dominio. Replica
   * `EcommerceService.buildEcommerceUrl` (privado). Si el hostname ya
   * incluye protocolo, se devuelve tal cual; si no, se prefija https://.
   */
  private buildEcommerceUrl(hostname: string): string {
    if (hostname.startsWith('http://') || hostname.startsWith('https://')) {
      return hostname;
    }
    return `https://${hostname}`;
  }

  /**
   * Genera la URL pública de la mesa + el QR (data URL PNG) que apunta a
   * esa URL. El QR contiene `${ecommerceUrl}/?mesa=${public_token}`.
   *
   * Reutiliza `QrService.generateDataUrl` (common/services/qr.service) —
   * inyectado en el módulo. La resolución del dominio primario se
   * replica localmente porque `EcommerceService.findPrimaryEcommerceDomain`
   * es privado (ver arriba).
   */
  async getQr(id: number): Promise<{ public_url: string; qr_data_url: string }> {
    const storeId = this.requireStoreId();
    const table = await this.getById(id);

    if (!table.public_token) {
      // Mesa creada antes de la migración que añadió public_token.
      // Genera el token on-demand para que el QR funcione.
      const updated = await this.prisma.tables.update({
        where: { id },
        data: { public_token: uuidv4(), updated_at: new Date() },
      });
      table.public_token = updated.public_token;
    }

    const domain = await this.findPrimaryEcommerceDomain(storeId);
    if (!domain) {
      throw new VendixHttpException(
        ErrorCodes.ORG_DOMAIN_001,
        'No hay un dominio ecommerce principal activo para generar el QR de la mesa',
      );
    }

    const baseUrl = this.buildEcommerceUrl(domain.hostname);
    const publicUrl = `${baseUrl}/?mesa=${table.public_token}`;
    const qrDataUrl = await this.qrService.generateDataUrl(publicUrl, 320);

    return { public_url: publicUrl, qr_data_url: qrDataUrl };
  }

  async update(id: number, dto: UpdateTableDto) {
    const storeId = this.requireStoreId();
    await this.getById(id);

    if (dto.name) {
      const dup = await this.prisma.tables.findFirst({
        where: {
          name: dto.name,
          id: { not: id },
        },
      });
      if (dup) {
        throw new VendixHttpException(ErrorCodes.TABLE_DUP_NAME);
      }
    }

    // State-transition guard: a table with an OPEN session (closed_at IS
    // NULL) cannot be moved to a "free" status — `available` or `reserved`
    // — because doing so would orphan the open check. `occupied` and
    // `cleaning` are always allowed (they reflect the table being in use
    // or being reset). Reuses the existing TABLE_INVALID_STATUS code; no
    // new error code is introduced.
    if (dto.status === 'available' || dto.status === 'reserved') {
      const activeSession = await this.getActiveSession(id);
      if (activeSession) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_INVALID_STATUS,
          `La mesa tiene una cuenta abierta; no puede marcarse como "${dto.status}"`,
        );
      }
    }

    // Validate the waiter payload ONLY when the caller provided one.
    // `undefined` means "preserve current assignment", so no validation
    // is needed.
    if (dto.waiter_user_ids && dto.waiter_user_ids.length > 0) {
      await this.assertStaffUserIds(storeId, dto.waiter_user_ids);
    }

    const data: Prisma.tablesUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.zone !== undefined && { zone: dto.zone }),
      ...(dto.capacity !== undefined && { capacity: dto.capacity }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.pos_x !== undefined && { pos_x: dto.pos_x }),
      ...(dto.pos_y !== undefined && { pos_y: dto.pos_y }),
      updated_at: new Date(),
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.tables.update({ where: { id }, data });
        await this.syncTableWaiters(tx, id, dto.waiter_user_ids);
        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.TABLE_DUP_NAME);
      }
      throw error;
    }
  }

  /**
   * Hard delete is allowed for tables with NO sessions at all (the
   * unique-floor (store_id, name) is freed). For tables that already
   * accumulated session history, the operator should mark the row
   * inactive via `update({ status: 'cleaning' })` and create a new
   * replacement — the audit trail of who sat at the table is preserved.
   */
  async remove(id: number) {
    await this.getById(id);
    const sessions = await this.prisma.table_sessions.count({
      where: { table_id: id },
    });
    if (sessions > 0) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_INVALID_STATUS,
        'La mesa tiene sesiones registradas; márcala como inactiva en lugar de eliminarla',
      );
    }
    await this.prisma.tables.delete({ where: { id } });
    return { deleted: true };
  }

  // -------------------------------------------------------------- floor map
  /**
   * One-shot projection for the floor-map view. Each table includes
   * its active (open) session, if any, and a derived
   * `effective_status` — `occupied` if a session is open, else the
   * table's persisted `status`.
   */
  async floorMap(): Promise<FloorMapTable[]> {
    const storeId = this.requireStoreId();

    // Fetch all tables (no pagination — the floor view shows the whole
    // floor). Operators with >500 tables can add a `?zone=` filter later.
    const tables = await this.prisma.tables.findMany({
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
    });

    if (tables.length === 0) {
      return [];
    }

    const tableIds = tables.map((t) => t.id);
    // Active sessions: closed_at IS NULL.
    // We use the scoped client's `findMany` to keep the where simple
    // and join by table_id IN (...) — the relational scope is still
    // applied automatically.
    const sessions = await this.prisma.table_sessions.findMany({
      where: {
        table_id: { in: tableIds },
        closed_at: null,
      },
      orderBy: { opened_at: 'desc' },
    });

    // Latest open session per table (if more than one — should never
    // happen given the service's invariants, but defensive).
    const activeByTable = new Map<number, (typeof sessions)[number]>();
    for (const s of sessions) {
      if (!activeByTable.has(s.table_id)) {
        activeByTable.set(s.table_id, s);
      }
    }

    // Próximas reservas por mesa (pending o confirmed).
    const bookings = await this.prisma.bookings.findMany({
      where: {
        table_id: { in: tableIds },
        status: { in: ['pending', 'confirmed'] },
        date: { gte: new Date(new Date().toISOString().slice(0, 10)) },
      },
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      include: {
        customer: {
          select: { id: true, first_name: true, last_name: true, phone: true },
        },
        product: { select: { id: true, name: true } },
      },
    });
    const bookingsByTable = new Map<number, typeof bookings>();
    for (const b of bookings) {
      const arr = bookingsByTable.get(b.table_id!) ?? [];
      arr.push(b);
      bookingsByTable.set(b.table_id!, arr);
    }

    return tables.map((t): FloorMapTable => {
      const active = activeByTable.get(t.id) ?? null;
      return {
        ...t,
        active_session: active
          ? {
              id: active.id,
              order_id: active.order_id,
              opened_by: active.opened_by,
              opened_at: active.opened_at,
              closed_at: active.closed_at,
              guest_count: active.guest_count,
            }
          : null,
        effective_status: active ? 'occupied' : (t.status as TableStatus),
        pending_bookings: (bookingsByTable.get(t.id) ?? []).map((b) => ({
          id: b.id,
          booking_number: b.booking_number,
          date: b.date,
          start_time: b.start_time,
          end_time: b.end_time,
          status: b.status,
          customer: b.customer
            ? {
                id: b.customer.id,
                first_name: b.customer.first_name,
                last_name: b.customer.last_name,
                phone: b.customer.phone ?? null,
              }
            : null,
          product: b.product
            ? { id: b.product.id, name: b.product.name }
            : null,
        })),
      };
    });
  }
}
