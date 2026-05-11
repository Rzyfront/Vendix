import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../errors';
import {
  getColombiaPucAccounts,
  type PucAccountInput,
} from './data/colombia-puc.data';

export interface SeedChartOfAccountsParams {
  organization_id: number;
  /** When true, existing accounts are kept and re-upserted (idempotent re-seed). */
  force?: boolean;
}

export interface SeedChartOfAccountsResult {
  organization_id: number;
  accounting_entities_processed: number;
  accounts_processed: number;
  forced: boolean;
}

/**
 * DefaultChartOfAccountsSeederService
 *
 * HTTP-triggered, tenant-scoped seeder for the Colombian PUC chart of
 * accounts. Designed to back the fiscal-activation wizard's "Use Colombian
 * template" option so a single click materialises the full PUC for a tenant.
 *
 * Source of truth for the data lives in `data/colombia-puc.data.ts`,
 * shared with the global Prisma seed (`prisma/seeds/default-puc.seed.ts`).
 *
 * Idempotency model (mirrors the seed):
 *   - Two partial UNIQUE INDEXES on chart_of_accounts prevent duplicates:
 *       (accounting_entity_id, code) WHERE accounting_entity_id IS NOT NULL
 *       (organization_id, code)      WHERE accounting_entity_id IS NULL
 *   - We resolve parent_id by re-reading the DB per account (the PUC array
 *     is level-ordered, parents land first).
 *   - For each account we update if found, else create — falling back to
 *     update on P2002 to absorb races.
 *
 * Bootstrap behaviour:
 *   - If the organization has zero accounting_entities and fiscal_scope=ORGANIZATION,
 *     we auto-create one accounting_entity for the organization so the PUC binds
 *     to a real entity from day one (avoids transient NULL rows).
 *   - If fiscal_scope=STORE and there are no entities, we throw
 *     MISSING_ACCOUNTING_ENTITY — the caller must seed store-level entities first.
 *
 * Pre-check + 409 contract:
 *   - When `force=false` (default) and at least one chart_of_accounts row
 *     already exists for any of the org's accounting entities, the service
 *     throws CHART_ALREADY_SEEDED (HTTP 409). Callers wanting to repair
 *     drift after manual edits must pass `force=true`.
 */
@Injectable()
export class DefaultChartOfAccountsSeederService {
  private readonly logger = new Logger(
    DefaultChartOfAccountsSeederService.name,
  );

  constructor(private readonly prisma: GlobalPrismaService) {}

  async seed(
    params: SeedChartOfAccountsParams,
  ): Promise<SeedChartOfAccountsResult> {
    const { organization_id, force = false } = params;

    let accounting_entities = await this.prisma.withoutScope().accounting_entities.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });

    // Auto-bootstrap an accounting_entity for ORGANIZATION-scoped tenants
    // when none exist; refuse for STORE-scoped tenants (per-store decision).
    if (accounting_entities.length === 0) {
      const org = await this.prisma.withoutScope().organizations.findUnique({
        where: { id: organization_id },
        select: {
          id: true,
          name: true,
          legal_name: true,
          tax_id: true,
          fiscal_scope: true,
          operating_scope: true,
        },
      });

      if (!org) {
        throw new VendixHttpException(ErrorCodes.MISSING_ACCOUNTING_ENTITY);
      }

      if (org.fiscal_scope === 'ORGANIZATION') {
        const entityName = org.legal_name || org.name || 'Entidad fiscal';
        this.logger.log(
          `Auto-creating accounting_entity for organization_id=${organization_id} ` +
            `(fiscal_scope=ORGANIZATION, name="${entityName}")`,
        );
        await this.prisma.withoutScope().accounting_entities.create({
          data: {
            organization_id,
            store_id: null,
            scope: org.operating_scope,
            fiscal_scope: 'ORGANIZATION',
            is_active: true,
            name: entityName,
            legal_name: org.legal_name ?? null,
            tax_id: org.tax_id ?? null,
          },
        });
        accounting_entities = await this.prisma.withoutScope().accounting_entities.findMany({
          where: { organization_id, is_active: true },
          select: { id: true },
        });
      } else {
        // STORE-scoped: cannot auto-pick which store(s) to bootstrap.
        throw new VendixHttpException(ErrorCodes.MISSING_ACCOUNTING_ENTITY);
      }
    }

    const accounting_entity_ids: (number | null)[] = accounting_entities.length
      ? accounting_entities.map((entity) => entity.id)
      : [null];

    if (!force) {
      const existingCount = await this.prisma.withoutScope().chart_of_accounts.count({
        where: {
          organization_id,
          ...(accounting_entities.length
            ? {
                accounting_entity_id: {
                  in: accounting_entities.map((entity) => entity.id),
                },
              }
            : {}),
        },
      });

      if (existingCount > 0) {
        throw new VendixHttpException(ErrorCodes.CHART_ALREADY_SEEDED);
      }
    }

    const accounts = getColombiaPucAccounts();
    let accounts_processed = 0;

    // Atomicity: wrap the full seeding loop in a single transaction so a
    // mid-flight failure rolls back every account inserted in this run.
    await this.prisma.withoutScope().$transaction(
      async (tx) => {
        for (const accounting_entity_id of accounting_entity_ids) {
          for (const account of accounts) {
            await this.upsertAccount(
              tx,
              organization_id,
              accounting_entity_id,
              account,
            );
            accounts_processed++;
          }
        }
      },
      {
        // PUC = ~600 rows × 1 entity. Give Postgres room before timing out.
        maxWait: 10_000,
        timeout: 120_000,
      },
    );

    this.logger.log(
      `Seeded PUC for organization_id=${organization_id}: ` +
        `${accounts_processed} accounts across ` +
        `${accounting_entity_ids.length} accounting entity bucket(s) (force=${force})`,
    );

    return {
      organization_id,
      accounting_entities_processed: accounting_entity_ids.length,
      accounts_processed,
      forced: force,
    };
  }

  private async upsertAccount(
    tx: Prisma.TransactionClient,
    organization_id: number,
    accounting_entity_id: number | null,
    account: PucAccountInput,
  ): Promise<void> {
    let parent_id: number | null = null;
    if (account.parent_code) {
      const parent = await tx.chart_of_accounts.findFirst({
        where: this.buildAccountFilter(
          organization_id,
          accounting_entity_id,
          account.parent_code,
        ),
        select: { id: true },
      });
      parent_id = parent?.id ?? null;
    }

    const writeData = {
      name: account.name,
      account_type: account.account_type as any,
      nature: account.nature as any,
      parent_id,
      level: account.level,
      is_active: true,
      accepts_entries: account.accepts_entries,
    };

    const existing = await tx.chart_of_accounts.findFirst({
      where: this.buildAccountFilter(
        organization_id,
        accounting_entity_id,
        account.code,
      ),
      select: { id: true },
    });

    if (existing) {
      await tx.chart_of_accounts.update({
        where: { id: existing.id },
        data: writeData,
      });
      return;
    }

    try {
      await tx.chart_of_accounts.create({
        data: {
          organization_id,
          accounting_entity_id,
          code: account.code,
          ...writeData,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Refetch with the same filter first; if not found (could happen when
        // the row was created with the NULL-entity partial unique while we
        // searched scoped to an entity), broaden by (organization_id, code).
        let racy = await tx.chart_of_accounts.findFirst({
          where: this.buildAccountFilter(
            organization_id,
            accounting_entity_id,
            account.code,
          ),
          select: { id: true },
        });
        if (!racy) {
          racy = await tx.chart_of_accounts.findFirst({
            where: { organization_id, code: account.code },
            select: { id: true },
          });
        }
        if (!racy) {
          throw error;
        }
        await tx.chart_of_accounts.update({
          where: { id: racy.id },
          data: writeData,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Build a WHERE filter that maps `accounting_entity_id === null` to a real
   * IS NULL predicate in SQL (Prisma maps `{ accounting_entity_id: null }` to
   * `IS NULL`, not `= NULL`).
   */
  private buildAccountFilter(
    organization_id: number,
    accounting_entity_id: number | null,
    code: string,
  ): Prisma.chart_of_accountsWhereInput {
    return {
      organization_id,
      accounting_entity_id:
        accounting_entity_id === null ? null : accounting_entity_id,
      code,
    };
  }
}
