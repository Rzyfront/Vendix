import { Injectable, Logger } from '@nestjs/common';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  createDefaultFiscalStatusBlock,
  FiscalArea,
  FiscalStatusBlock,
  FiscalStatusState,
  normalizeFiscalStatusBlock,
} from '../interfaces/fiscal-status.interface';
import { getDefaultStoreSettings } from '../../domains/store/settings/defaults/default-store-settings';
import { getDefaultOrganizationSettings } from '../../domains/organization/settings/defaults/default-organization-settings';

export interface FiscalStatusMigrationOptions {
  dryRun?: boolean;
  force?: boolean;
  organizationId?: number;
}

export interface FiscalStatusMigrationReport {
  scanned: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
  details: Array<{
    organization_id: number;
    store_id: number | null;
    action: 'update' | 'skip';
    reason: string;
  }>;
}

@Injectable()
export class FiscalStatusMigrationService {
  private readonly logger = new Logger(FiscalStatusMigrationService.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async migrate(
    options: FiscalStatusMigrationOptions = {},
  ): Promise<FiscalStatusMigrationReport> {
    const dryRun = options.dryRun !== false;
    const client = this.globalPrisma.withoutScope() as any;
    const organizations = await client.organizations.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, fiscal_scope: true },
      orderBy: { id: 'asc' },
    });
    const report: FiscalStatusMigrationReport = {
      scanned: 0,
      updated: 0,
      skipped: 0,
      dryRun,
      details: [],
    };

    for (const organization of organizations) {
      const fiscalScope = organization.fiscal_scope || 'STORE';
      if (fiscalScope === 'ORGANIZATION') {
        await this.migrateOrganizationTarget(
          organization.id,
          options.force === true,
          dryRun,
          report,
        );
      } else {
        const stores = await client.stores.findMany({
          where: { organization_id: organization.id, is_active: true },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        for (const store of stores) {
          await this.migrateStoreTarget(
            organization.id,
            store.id,
            options.force === true,
            dryRun,
            report,
          );
        }
      }
    }

    this.logger.log(
      `fiscal_status migration scanned=${report.scanned} updated=${report.updated} skipped=${report.skipped} dryRun=${dryRun}`,
    );
    return report;
  }

  private async migrateOrganizationTarget(
    organization_id: number,
    force: boolean,
    dryRun: boolean,
    report: FiscalStatusMigrationReport,
  ): Promise<void> {
    const client = this.globalPrisma.withoutScope() as any;
    const stores = await client.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });
    let aggregate = createDefaultFiscalStatusBlock();
    for (const store of stores) {
      const block = await this.inferStoreBlock(organization_id, store.id);
      aggregate = this.maxBlock(aggregate, block);
    }

    await this.writeTarget({
      organization_id,
      store_id: null,
      block: aggregate,
      force,
      dryRun,
      report,
    });
  }

  private async migrateStoreTarget(
    organization_id: number,
    store_id: number,
    force: boolean,
    dryRun: boolean,
    report: FiscalStatusMigrationReport,
  ): Promise<void> {
    const block = await this.inferStoreBlock(organization_id, store_id);
    await this.writeTarget({
      organization_id,
      store_id,
      block,
      force,
      dryRun,
      report,
    });
  }

  private async writeTarget(params: {
    organization_id: number;
    store_id: number | null;
    block: FiscalStatusBlock;
    force: boolean;
    dryRun: boolean;
    report: FiscalStatusMigrationReport;
  }): Promise<void> {
    const client = this.globalPrisma.withoutScope() as any;
    params.report.scanned++;

    const row = params.store_id
      ? await client.store_settings.findUnique({
          where: { store_id: params.store_id },
          select: { settings: true },
        })
      : await client.organization_settings.findUnique({
          where: { organization_id: params.organization_id },
          select: { settings: true },
        });
    const settings = (row?.settings as any) || {};
    if (settings.fiscal_status && !params.force) {
      params.report.skipped++;
      params.report.details.push({
        organization_id: params.organization_id,
        store_id: params.store_id,
        action: 'skip',
        reason: 'fiscal_status already exists',
      });
      return;
    }

    params.report.details.push({
      organization_id: params.organization_id,
      store_id: params.store_id,
      action: 'update',
      reason: 'legacy module_flows/data migrated',
    });

    if (params.dryRun) return;

    await client.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock($1)',
        80510140000 + params.organization_id,
      );

      if (params.store_id) {
        await tx.store_settings.upsert({
          where: { store_id: params.store_id },
          create: {
            store_id: params.store_id,
            settings: {
              ...getDefaultStoreSettings(),
              fiscal_status: params.block,
            },
          },
          update: {
            settings: { ...settings, fiscal_status: params.block },
            updated_at: new Date(),
          },
        });
      } else {
        await tx.organization_settings.upsert({
          where: { organization_id: params.organization_id },
          create: {
            organization_id: params.organization_id,
            settings: {
              ...getDefaultOrganizationSettings(),
              fiscal_status: params.block,
            },
          },
          update: {
            settings: { ...settings, fiscal_status: params.block },
            updated_at: new Date(),
          },
        });
      }

      for (const area of Object.keys(params.block) as FiscalArea[]) {
        await tx.fiscal_status_audit_log.create({
          data: {
            organization_id: params.organization_id,
            store_id: params.store_id,
            feature: area,
            from_state: null,
            to_state: params.block[area].state,
            source: 'migration_v1',
            before_json: null,
            after_json: params.block[area] as any,
            changed_by_user_id: null,
          },
        });
      }
    });

    params.report.updated++;
  }

  private async inferStoreBlock(
    organization_id: number,
    store_id: number,
  ): Promise<FiscalStatusBlock> {
    const client = this.globalPrisma.withoutScope() as any;
    const row = await client.store_settings.findUnique({
      where: { store_id },
      select: { settings: true },
    });
    const settings = (row?.settings as any) || {};
    const block = normalizeFiscalStatusBlock(settings.fiscal_status);
    const hasData = await this.detectFiscalData(organization_id, store_id);

    const moduleFlows = settings.module_flows;
    for (const area of Object.keys(block) as FiscalArea[]) {
      const enabled =
        !moduleFlows || moduleFlows[area]?.enabled !== false;
      block[area] = {
        ...block[area],
        state: this.inferState(hasData[area], enabled),
        locked_reasons: hasData[area]
          ? [`migration_detected_${area}_data`]
          : block[area].locked_reasons,
        locked_at: hasData[area] ? new Date().toISOString() : block[area].locked_at,
        activated_at: enabled ? new Date().toISOString() : block[area].activated_at,
        updated_at: new Date().toISOString(),
      };
    }
    return block;
  }

  private async detectFiscalData(
    organization_id: number,
    store_id: number,
  ): Promise<Record<FiscalArea, boolean>> {
    const client = this.globalPrisma.withoutScope() as any;
    const [invoices, entries, payroll] = await Promise.all([
      client.invoices.count({
        where: {
          organization_id,
          store_id,
          OR: [
            { status: 'accepted' },
            { accepted_at: { not: null } },
            { cufe: { not: null } },
          ],
        },
      }),
      client.accounting_entries.count({
        where: { organization_id, store_id, status: 'posted' },
      }),
      client.payroll_runs.count({
        where: {
          organization_id,
          store_id,
          status: { in: ['accepted', 'paid'] },
        },
      }),
    ]);
    return {
      invoicing: invoices > 0,
      accounting: entries > 0,
      payroll: payroll > 0,
    };
  }

  private inferState(hasData: boolean, enabled: boolean): FiscalStatusState {
    if (hasData) return 'LOCKED';
    if (enabled) return 'ACTIVE';
    return 'INACTIVE';
  }

  private maxBlock(
    current: FiscalStatusBlock,
    candidate: FiscalStatusBlock,
  ): FiscalStatusBlock {
    const rank: Record<FiscalStatusState, number> = {
      INACTIVE: 0,
      WIP: 1,
      ACTIVE: 2,
      LOCKED: 3,
    };
    const next = normalizeFiscalStatusBlock(current);
    for (const area of Object.keys(next) as FiscalArea[]) {
      if (rank[candidate[area].state] > rank[next[area].state]) {
        next[area] = candidate[area];
      }
    }
    return next;
  }
}
