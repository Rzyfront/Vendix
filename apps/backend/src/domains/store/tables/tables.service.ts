import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
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

  constructor(private prisma: StorePrismaService) {}

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

    try {
      return await this.prisma.tables.create({
        data: {
          store_id: storeId,
          name: dto.name,
          zone: dto.zone ?? null,
          capacity: dto.capacity ?? null,
          status: dto.status ?? 'available',
          pos_x: dto.pos_x ?? null,
          pos_y: dto.pos_y ?? null,
          updated_at: new Date(),
        },
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

  async update(id: number, dto: UpdateTableDto) {
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
      return await this.prisma.tables.update({ where: { id }, data });
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
      };
    });
  }
}
