import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { S3Service } from '../../../../common/services/s3.service';
import {
  isS3Key,
  isSafeS3Key,
} from '../../../../common/helpers/s3-url.helper';

export type VexBlockKind =
  | 'table'
  | 'chart'
  | 'kpi'
  | 'image'
  | 'file'
  | 'markdown';

export const VEX_BLOCK_KINDS: readonly VexBlockKind[] = [
  'table',
  'chart',
  'kpi',
  'image',
  'file',
  'markdown',
];

/** Beyond this a block is a data export, and it belongs in the module. */
export const MAX_BLOCK_ROWS = 5000;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const MAX_BLOCKS_PER_CONVERSATION = 100;

/** A signed block URL lives as long as a chat link: enough to click, not to leak. */
const BLOCK_LINK_TTL_SECONDS = 900;

export interface VexBlockRow {
  id: string;
  store_id: number;
  conversation_id: number;
  message_id: number | null;
  kind: VexBlockKind;
  spec: Record<string, any>;
  data: Record<string, any>;
  version: number;
  created_at: Date;
}

export interface CreateVexBlockInput {
  conversation_id: number;
  message_id?: number;
  kind: VexBlockKind;
  spec?: Record<string, any>;
  data: Record<string, any>;
}

export interface VexBlockTransform {
  filter?: Array<{ field: string; op: string; value: unknown }>;
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  group_by?: string;
  aggregate?: { field: string; function: 'sum' | 'avg' | 'count' | 'min' | 'max' };
}

export interface VexBlockInteraction {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Structural view of the `ai_ui_blocks` delegate.
 *
 * The model lands with the sibling migration (`ai_ui_blocks`); until the
 * Prisma client regenerates, this cast is what keeps the service compiling
 * and the runtime working the moment the table exists. Wave 2 replaces the
 * cast with the generated delegate — no call below changes shape.
 */
interface AiUiBlocksDelegate {
  findFirst(args: any): Promise<VexBlockRow | null>;
  findMany(args: any): Promise<VexBlockRow[]>;
  create(args: any): Promise<VexBlockRow>;
  updateMany(args: any): Promise<{ count: number }>;
  deleteMany(args: any): Promise<{ count: number }>;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Server-side store for Vex's manipulable UI blocks.
 *
 * A block is data the model rendered (a table, a chart, a file) that stays
 * queryable afterwards: `vex_block_read` pages it back into a later turn and
 * `vex_block_transform` derives a new version from it. Every row is
 * store-scoped and every read filters by `store_id` explicitly, so a block id
 * from another store answers 404 — never 403, which would confirm it exists.
 *
 * Images and files persist S3 KEYS only. A signed URL stored in `data` would
 * rot in place and leak through every later read; the fresh URL is minted at
 * read time and attached as `signed_url`, never written back.
 */
@Injectable()
export class VexBlockService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
  ) {}

  private get blocks(): AiUiBlocksDelegate {
    return (this.prisma as unknown as { ai_ui_blocks: AiUiBlocksDelegate })
      .ai_ui_blocks;
  }

  private storeIdOrThrow(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  async create(input: CreateVexBlockInput): Promise<VexBlockRow> {
    const storeId = this.storeIdOrThrow();
    if (!VEX_BLOCK_KINDS.includes(input.kind)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `kind debe ser uno de: ${VEX_BLOCK_KINDS.join(', ')}.`,
      );
    }
    const spec = input.spec ?? {};
    const errors = this.validate(input.kind, spec, input.data);
    if (errors.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `Bloque ${input.kind} inválido: ${errors.join(' ')}`,
      );
    }
    return this.blocks.create({
      data: {
        id: randomUUID(),
        store_id: storeId,
        conversation_id: input.conversation_id,
        message_id: input.message_id ?? null,
        kind: input.kind,
        spec,
        data: input.data,
        version: 1,
      },
    });
  }

  /**
   * One block with a fresh read URL when the kind needs one. Cross-store ids
   * answer 404 — the `store_id` predicate makes "another store's block" and
   * "no such block" indistinguishable.
   */
  async getById(id: string): Promise<VexBlockRow & { signed_url?: string }> {
    const storeId = this.storeIdOrThrow();
    const row = await this.blocks.findFirst({ where: { id, store_id: storeId } });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Bloque no encontrado.',
      );
    }
    return this.withSignedUrl(row);
  }

  async listByConversation(
    conversationId: number,
  ): Promise<Array<VexBlockRow & { signed_url?: string }>> {
    const storeId = this.storeIdOrThrow();
    const rows = await this.blocks.findMany({
      where: { store_id: storeId, conversation_id: conversationId },
      orderBy: { created_at: 'desc' },
      take: MAX_BLOCKS_PER_CONVERSATION,
    });
    return Promise.all(rows.map((row) => this.withSignedUrl(row)));
  }

  /**
   * Paged read of a block's rows for a later turn. The model never receives
   * the whole dataset blindly — it pages through it, exactly as a person
   * would scroll the rendered table.
   */
  async readPaged(
    id: string,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<{
    block_id: string;
    kind: VexBlockKind;
    version: number;
    page: number;
    page_size: number;
    total_rows: number;
    rows: Array<Record<string, any>>;
  }> {
    const row = await this.getById(id);
    const rows = this.rowsOf(row);
    const size = Math.min(Math.max(pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const current = Math.max(page || 1, 1);
    const start = (current - 1) * size;
    return {
      block_id: row.id,
      kind: row.kind,
      version: row.version,
      page: current,
      page_size: size,
      total_rows: rows.length,
      rows: rows.slice(start, start + size),
    };
  }

  /**
   * Derives a NEW version of a table block (filter/sort/group/aggregate).
   *
   * Versions are rows, not mutations: the original render stays intact for the
   * transcript, and the transform is reviewable as its own block. Only `table`
   * blocks transform — a KPI has no rows to filter and a file has no rows at
   * all.
   */
  async transform(id: string, ops: VexBlockTransform): Promise<VexBlockRow> {
    const storeId = this.storeIdOrThrow();
    const row = await this.blocks.findFirst({ where: { id, store_id: storeId } });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Bloque no encontrado.',
      );
    }
    if (row.kind !== 'table') {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `Solo los bloques table se pueden transformar; este es ${row.kind}.`,
      );
    }
    const rows = this.applyOps(this.rowsOf(row), ops);
    if (rows.length > MAX_BLOCK_ROWS) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `La transformación produce ${rows.length} filas y el máximo por bloque son ${MAX_BLOCK_ROWS}.`,
      );
    }
    return this.blocks.create({
      data: {
        id: randomUUID(),
        store_id: storeId,
        conversation_id: row.conversation_id,
        message_id: row.message_id,
        kind: row.kind,
        spec: { ...row.spec, derived_from: row.id, transform: ops },
        data: { ...row.data, rows },
        version: row.version + 1,
      },
    });
  }

  /**
   * Stores what the person did on the block so the next turn receives it as
   * context. Kept inside `spec` (render metadata), never mixed into `data`
   * (the dataset the model transforms).
   */
  async recordInteraction(
    id: string,
    interaction: VexBlockInteraction,
  ): Promise<VexBlockRow> {
    const storeId = this.storeIdOrThrow();
    const row = await this.blocks.findFirst({ where: { id, store_id: storeId } });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Bloque no encontrado.',
      );
    }
    const spec = {
      ...row.spec,
      last_interaction: {
        type: interaction.type,
        payload: interaction.payload,
        at: new Date().toISOString(),
      },
    };
    await this.blocks.updateMany({
      where: { id, store_id: storeId },
      data: { spec },
    });
    return { ...row, spec };
  }

  async delete(id: string): Promise<void> {
    const storeId = this.storeIdOrThrow();
    const { count } = await this.blocks.deleteMany({
      where: { id, store_id: storeId },
    });
    if (count === 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Bloque no encontrado.',
      );
    }
  }

  // ── validation ────────────────────────────────────────────────────────

  private validate(
    kind: VexBlockKind,
    spec: Record<string, any>,
    data: Record<string, any>,
  ): string[] {
    if (!isRecord(data)) return ['data debe ser un objeto.'];
    switch (kind) {
      case 'table': {
        const errors: string[] = [];
        if (!Array.isArray(data.columns) || data.columns.length === 0) {
          errors.push('data.columns debe ser una lista no vacía.');
        }
        if (!Array.isArray(data.rows)) {
          errors.push('data.rows debe ser una lista.');
        } else if (data.rows.length > MAX_BLOCK_ROWS) {
          errors.push(
            `data.rows trae ${data.rows.length} filas y el máximo por bloque son ${MAX_BLOCK_ROWS}.`,
          );
        }
        return errors;
      }
      case 'chart': {
        const errors: string[] = [];
        if (typeof spec.chart_type !== 'string' || !spec.chart_type) {
          errors.push('spec.chart_type es obligatorio (bar, line, pie, area, radar, scatter, gauge).');
        }
        if (!Array.isArray(data.series) || data.series.length === 0) {
          errors.push('data.series debe ser una lista no vacía.');
        }
        return errors;
      }
      case 'kpi': {
        const errors: string[] = [];
        if (typeof data.label !== 'string' || !data.label) {
          errors.push('data.label es obligatorio.');
        }
        if (typeof data.value !== 'number' && typeof data.value !== 'string') {
          errors.push('data.value debe ser número o texto.');
        }
        return errors;
      }
      case 'image':
      case 'file': {
        const errors: string[] = [];
        if (
          typeof data.s3_key !== 'string' ||
          !isS3Key(data.s3_key) ||
          !isSafeS3Key(data.s3_key)
        ) {
          errors.push('data.s3_key debe ser una clave S3 válida (nunca una URL firmada).');
        }
        if (kind === 'file' && (typeof data.filename !== 'string' || !data.filename)) {
          errors.push('data.filename es obligatorio.');
        }
        return errors;
      }
      case 'markdown': {
        if (typeof data.text !== 'string' || !data.text.trim()) {
          return ['data.text es obligatorio.'];
        }
        return [];
      }
    }
  }

  // ── reads ─────────────────────────────────────────────────────────────

  private async withSignedUrl(
    row: VexBlockRow,
  ): Promise<VexBlockRow & { signed_url?: string }> {
    if (
      (row.kind === 'image' || row.kind === 'file') &&
      typeof row.data?.s3_key === 'string'
    ) {
      const signed_url = await this.s3.getPresignedUrl(
        row.data.s3_key,
        BLOCK_LINK_TTL_SECONDS,
      );
      return { ...row, signed_url };
    }
    return { ...row };
  }

  private rowsOf(row: VexBlockRow): Array<Record<string, any>> {
    const rows = (row.data as Record<string, any>)?.rows;
    return Array.isArray(rows) ? rows : [];
  }

  // ── transform ops ─────────────────────────────────────────────────────

  private applyOps(
    rows: Array<Record<string, any>>,
    ops: VexBlockTransform,
  ): Array<Record<string, any>> {
    let out = [...rows];
    for (const f of ops.filter ?? []) {
      out = out.filter((r) => this.matches(r[f.field], f.op, f.value));
    }
    const sorts = ops.sort ?? [];
    if (sorts.length > 0) {
      out.sort((a, b) => {
        for (const s of sorts) {
          const dir = s.direction === 'desc' ? -1 : 1;
          const av = a[s.field];
          const bv = b[s.field];
          if (av === bv) continue;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return (av < bv ? -1 : 1) * dir;
        }
        return 0;
      });
    }
    if (ops.group_by || ops.aggregate) {
      out = this.aggregate(out, ops.group_by, ops.aggregate);
    }
    return out;
  }

  private matches(field: unknown, op: string, value: unknown): boolean {
    switch (op) {
      case 'eq':
        return field === value;
      case 'neq':
        return field !== value;
      case 'gt':
        return typeof field === 'number' && typeof value === 'number' && field > value;
      case 'gte':
        return typeof field === 'number' && typeof value === 'number' && field >= value;
      case 'lt':
        return typeof field === 'number' && typeof value === 'number' && field < value;
      case 'lte':
        return typeof field === 'number' && typeof value === 'number' && field <= value;
      case 'contains':
        return (
          typeof field === 'string' &&
          typeof value === 'string' &&
          field.toLowerCase().includes(value.toLowerCase())
        );
      case 'in':
        return Array.isArray(value) && value.includes(field);
      default:
        return false;
    }
  }

  private aggregate(
    rows: Array<Record<string, any>>,
    groupBy: string | undefined,
    aggregate: VexBlockTransform['aggregate'],
  ): Array<Record<string, any>> {
    if (!aggregate) return rows;
    const groups = new Map<string, Array<Record<string, any>>>();
    for (const row of rows) {
      const key = groupBy ? String(row[groupBy] ?? '—') : 'total';
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    const out: Array<Record<string, any>> = [];
    for (const [key, bucket] of groups) {
      const numbers = bucket
        .map((r) => r[aggregate.field])
        .filter((v): v is number => typeof v === 'number');
      let value: number;
      switch (aggregate.function) {
        case 'sum':
          value = numbers.reduce((a, b) => a + b, 0);
          break;
        case 'avg':
          value = numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
          break;
        case 'count':
          value = bucket.length;
          break;
        case 'min':
          value = numbers.length ? Math.min(...numbers) : 0;
          break;
        case 'max':
          value = numbers.length ? Math.max(...numbers) : 0;
          break;
      }
      out.push(
        groupBy
          ? { [groupBy]: key, [`${aggregate.function}_${aggregate.field}`]: value }
          : { [`${aggregate.function}_${aggregate.field}`]: value },
      );
    }
    return out;
  }
}
