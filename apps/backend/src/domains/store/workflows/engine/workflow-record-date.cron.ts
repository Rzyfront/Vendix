import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowTriggerDef } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  recordStartContext,
  zonedDatePlus,
} from '../records/workflow-record-fields';
import { WorkflowEngineService } from './workflow-engine.service';
import { storeAllowsFlows } from './workflow-industry';
import { DEFAULT_STORE_TIMEZONE } from './workflow-stage.service';

/** Records read per page for one flow and date. */
export const RECORD_DATE_PAGE = 200;

interface RecordDateRow {
  id: number;
  store_id: number;
  organization_id: number;
  triggers: WorkflowTriggerDef[] | null;
  collection: string | null;
  timezone: string | null;
}

/**
 * P3.6: starts flows with a `record_date` trigger. Runs hourly in the worker
 * (once a day is enough; the idempotency key makes extra runs replay). For each
 * published, switched-on flow it takes the non-archived records of the flow's
 * collection whose date field equals today (in the store's time zone) plus
 * `days_before` and starts one request per record and date (actor `system`,
 * key `<definition>:<record>:<field>:<date>`). One failing record is logged
 * and never stops the rest.
 */
@Injectable()
export class WorkflowRecordDateCron {
  private readonly logger = new Logger(WorkflowRecordDateCron.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly engine: WorkflowEngineService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce(new Date());
    } catch (e) {
      this.logger.error(`Record-date flows failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many requests were started (replays are not counted). */
  async runOnce(now: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<RecordDateRow[]>(Prisma.sql`
      SELECT d.id, d.store_id, d.organization_id,
             v.definition->'triggers' AS triggers,
             v.definition->'subject'->>'collection' AS collection,
             s.timezone
      FROM workflow_definitions d
      JOIN workflow_versions v ON v.id = d.published_version_id
      JOIN stores s ON s.id = d.store_id
      WHERE d.status = 'active'
        AND d.is_enabled = true
        AND v.definition->'triggers' @> '[{"kind":"record_date"}]'::jsonb`);
    let started = 0;
    for (const row of rows) {
      try {
        if (!row.collection) continue;
        if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, row.store_id))) {
          continue;
        }
        const tz = row.timezone || DEFAULT_STORE_TIMEZONE;
        for (const trigger of row.triggers ?? []) {
          if (trigger.kind !== 'record_date') continue;
          const date = zonedDatePlus(now, tz, trigger.days_before);
          started += await RequestContextService.runIsolated(
            {
              store_id: row.store_id,
              organization_id: row.organization_id,
              is_super_admin: false,
              is_owner: false,
            },
            () => this.fireForDate(row, row.collection as string, trigger.field, date),
          );
        }
      } catch (e) {
        this.logger.warn(
          `Record-date trigger of definition ${row.id} failed: ${(e as Error)?.message}`,
        );
      }
    }
    return started;
  }

  private async fireForDate(
    row: RecordDateRow,
    collectionKey: string,
    field: string,
    date: string,
  ): Promise<number> {
    const collection = await this.prisma.workflow_collections.findFirst({
      where: { store_id: row.store_id, key: collectionKey, is_archived: false },
      select: { id: true },
    });
    if (!collection) return 0;
    let started = 0;
    let lastId = 0;
    for (;;) {
      const records = await this.prisma.workflow_records.findMany({
        where: {
          store_id: row.store_id,
          collection_id: collection.id,
          archived_at: null,
          id: { gt: lastId },
          data: { path: [field], equals: date },
        },
        orderBy: { id: 'asc' },
        take: RECORD_DATE_PAGE,
      });
      for (const record of records) {
        lastId = record.id;
        try {
          const result = await this.engine.startExternal({
            definitionId: row.id,
            kind: 'record_date',
            recordField: field,
            context: recordStartContext(
              (record.data ?? {}) as Record<string, unknown>,
              record.title,
              record.reference,
            ),
            subject: { type: 'custom_record', id: record.id },
            idempotencyKey: `${row.id}:${record.id}:${field}:${date}`,
            started: { record_id: record.id, field, date },
          });
          if (result && !result.replayed) started++;
        } catch (e) {
          this.logger.warn(
            `Record-date start of record ${record.id} (definition ${row.id}) failed: ${(e as Error)?.message}`,
          );
        }
      }
      if (records.length < RECORD_DATE_PAGE) return started;
    }
  }
}
