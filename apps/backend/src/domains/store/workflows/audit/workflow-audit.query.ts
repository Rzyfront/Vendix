import { Injectable } from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { resolveLocalDateRange, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  WORKFLOW_AUDIT_ACTIONS,
  WORKFLOW_AUDIT_ACTION_LABELS,
  WORKFLOW_AUDIT_CATEGORIES,
  WORKFLOW_AUDIT_CATEGORY_LABELS,
  WORKFLOW_AUDIT_TARGET_LABELS,
  WorkflowAuditAction,
  WorkflowAuditCategory,
  isWorkflowAuditAction,
} from './workflow-audit.catalog';
import type { WorkflowAuditRow } from './workflow-audit.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSITIVE_INT_RE = /^[1-9]\d{0,9}$/;
const EXPORT_BATCH = 1000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_SEARCH = 200;

/**
 * Raw query string of the audit endpoints. Every field is a plain string on
 * purpose: the global pipe forbids undeclared keys, but a malformed value must
 * answer `WORKFLOW_AUDIT_FILTER_INVALID`, not a generic validation error.
 */
export class WorkflowAuditQueryDto {
  /** Store-local calendar dates, `YYYY-MM-DD`. */
  @IsOptional() from?: string;
  @IsOptional() to?: string;
  @IsOptional() category?: string;
  @IsOptional() action?: string;
  /** Id of the user who acted. */
  @IsOptional() actor_id?: string;
  @IsOptional() definition_id?: string;
  @IsOptional() instance_id?: string;
  /** Free text over the one-line summary. */
  @IsOptional() search?: string;
  @IsOptional() page?: string;
  @IsOptional() limit?: string;
}

export interface WorkflowAuditFilters {
  from?: string;
  to?: string;
  category?: WorkflowAuditCategory;
  action?: WorkflowAuditAction;
  actor_id?: number;
  definition_id?: number;
  instance_id?: number;
  search?: string;
}

export interface WorkflowAuditPage {
  page: number;
  limit: number;
}

export interface WorkflowAuditItem {
  id: string;
  seq: string;
  created_at: string;
  category: WorkflowAuditCategory;
  category_label: string;
  action: string;
  action_label: string;
  actor: { type: string; id: number | null; name: string };
  target: { type: string; type_label: string; id: string | null };
  definition_id: number | null;
  instance_id: number | null;
  summary: string;
  details: unknown;
  ip_address: string | null;
  user_agent: string | null;
  prev_hash: string | null;
  entry_hash: string;
}

type StoredAuditRow = WorkflowAuditRow & { id: bigint | number | string };

const invalid = (field: string, message: string) =>
  new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_FILTER_INVALID, message, { field });

function oneOf(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') throw invalid('query', 'Cada filtro admite un solo valor.');
  return raw.trim() || undefined;
}

function positiveInt(field: string, raw: unknown): number | undefined {
  const value = oneOf(raw);
  if (value === undefined) return undefined;
  if (!POSITIVE_INT_RE.test(value)) throw invalid(field, `«${field}» debe ser un número entero positivo.`);
  return Number(value);
}

function calendarDate(field: string, raw: unknown): string | undefined {
  const value = oneOf(raw);
  if (value === undefined) return undefined;
  const parsed = DATE_RE.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) throw invalid(field, `La fecha «${field}» debe tener el formato AAAA-MM-DD.`);
  return value;
}

/** Validates the raw query; every rejection is `WORKFLOW_AUDIT_FILTER_INVALID`. */
export function parseAuditQuery(query: WorkflowAuditQueryDto): {
  filters: WorkflowAuditFilters;
  paging: WorkflowAuditPage;
} {
  const category = oneOf(query.category);
  if (category && !(WORKFLOW_AUDIT_CATEGORIES as readonly string[]).includes(category)) {
    throw invalid('category', 'La categoría no existe.');
  }
  const action = oneOf(query.action);
  if (action && !isWorkflowAuditAction(action)) throw invalid('action', 'La acción no existe.');
  const from = calendarDate('from', query.from);
  const to = calendarDate('to', query.to);
  if (from && to && from > to) throw invalid('from', '«Desde» no puede ser posterior a «hasta».');
  const search = oneOf(query.search);
  if (search && search.length > MAX_SEARCH) throw invalid('search', 'El texto de búsqueda es demasiado largo.');
  if (category && action && WORKFLOW_AUDIT_ACTIONS[action as WorkflowAuditAction] !== category) {
    throw invalid('action', 'La acción no pertenece a la categoría elegida.');
  }
  const page = positiveInt('page', query.page) ?? 1;
  const limit = positiveInt('limit', query.limit) ?? DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) throw invalid('limit', `El límite máximo es ${MAX_LIMIT}.`);
  return {
    filters: {
      from,
      to,
      category: category as WorkflowAuditCategory | undefined,
      action: action as WorkflowAuditAction | undefined,
      actor_id: positiveInt('actor_id', query.actor_id),
      definition_id: positiveInt('definition_id', query.definition_id),
      instance_id: positiveInt('instance_id', query.instance_id),
      search,
    },
    paging: { page, limit },
  };
}

/** Read side of the audit trail: filtered list and the full dataset of the export. */
@Injectable()
export class WorkflowAuditQueryService {
  constructor(private readonly prisma: StorePrismaService) {}

  private storeId(): number {
    const id = RequestContextService.getStoreId();
    if (!id) throw new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE);
    return id;
  }

  async timezone(): Promise<string> {
    return resolveStoreTimezone(this.prisma, this.storeId());
  }

  private async where(filters: WorkflowAuditFilters, tz: string) {
    const where: Record<string, unknown> = { store_id: this.storeId() };
    if (filters.from || filters.to) {
      const { startDate, endDate } = resolveLocalDateRange(
        {
          date_from: filters.from ?? filters.to,
          date_to: filters.to ?? filters.from,
        },
        tz,
      );
      where.created_at = {
        ...(filters.from ? { gte: startDate } : {}),
        ...(filters.to ? { lte: endDate } : {}),
      };
    }
    if (filters.category) where.category = filters.category;
    if (filters.action) where.action = filters.action;
    if (filters.actor_id) {
      where.actor_type = 'user';
      where.actor_id = filters.actor_id;
    }
    if (filters.definition_id) where.definition_id = filters.definition_id;
    if (filters.instance_id) where.instance_id = filters.instance_id;
    if (filters.search) where.summary = { contains: filters.search, mode: 'insensitive' };
    return where;
  }

  /** Newest first. */
  async list(filters: WorkflowAuditFilters, paging: WorkflowAuditPage) {
    const tz = await this.timezone();
    const where = await this.where(filters, tz);
    const [total, rows] = await Promise.all([
      this.prisma.workflow_audit_log.count({ where }),
      this.prisma.workflow_audit_log.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip: (paging.page - 1) * paging.limit,
        take: paging.limit,
      }),
    ]);
    return { total, items: await this.present(rows as StoredAuditRow[]) };
  }

  /** The whole filtered dataset, oldest first, read in bounded batches. */
  async all(filters: WorkflowAuditFilters, tz: string): Promise<WorkflowAuditItem[]> {
    const where = await this.where(filters, tz);
    const out: WorkflowAuditItem[] = [];
    let cursor = 0n;
    for (;;) {
      const rows = (await this.prisma.workflow_audit_log.findMany({
        where: { ...where, seq: { gt: cursor } },
        orderBy: { seq: 'asc' },
        take: EXPORT_BATCH,
      })) as StoredAuditRow[];
      out.push(...(await this.present(rows)));
      if (rows.length < EXPORT_BATCH) return out;
      cursor = BigInt(rows[rows.length - 1].seq);
    }
  }

  private async userNames(rows: StoredAuditRow[]): Promise<Map<number, string>> {
    const ids = [
      ...new Set(rows.filter((r) => r.actor_type === 'user' && r.actor_id).map((r) => r.actor_id as number)),
    ];
    const names = new Map<number, string>();
    if (!ids.length) return names;
    const users: Array<{ id: number; first_name: string | null; last_name: string | null }> =
      await this.prisma.users.findMany({
        where: { id: { in: ids } },
        select: { id: true, first_name: true, last_name: true },
      });
    for (const u of users) {
      const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
      if (name) names.set(u.id, name);
    }
    return names;
  }

  private async present(rows: StoredAuditRow[]): Promise<WorkflowAuditItem[]> {
    const names = await this.userNames(rows);
    return rows.map((r) => {
      const category = r.category as WorkflowAuditCategory;
      const actorName =
        r.actor_type === 'user'
          ? (names.get(r.actor_id as number) ?? r.actor_label ?? 'Usuario')
          : r.actor_type === 'public'
            ? (r.actor_label ?? 'Persona externa')
            : r.actor_type === 'external'
              ? (r.actor_label ?? 'Sistema externo')
              : 'Sistema';
      return {
        id: String(r.id),
        seq: String(r.seq),
        created_at: new Date(r.created_at).toISOString(),
        category,
        category_label: WORKFLOW_AUDIT_CATEGORY_LABELS[category] ?? r.category,
        action: r.action,
        action_label: WORKFLOW_AUDIT_ACTION_LABELS[r.action as WorkflowAuditAction] ?? r.action,
        actor: { type: r.actor_type, id: r.actor_id, name: actorName },
        target: {
          type: r.target_type,
          type_label: WORKFLOW_AUDIT_TARGET_LABELS[r.target_type] ?? r.target_type,
          id: r.target_id,
        },
        definition_id: r.definition_id,
        instance_id: r.instance_id,
        summary: r.summary,
        details: r.details,
        ip_address: r.ip_address,
        user_agent: r.user_agent,
        prev_hash: r.prev_hash,
        entry_hash: r.entry_hash,
      };
    });
  }
}
