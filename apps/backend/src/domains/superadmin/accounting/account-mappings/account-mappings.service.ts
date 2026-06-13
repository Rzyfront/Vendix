import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  DEFAULT_ACCOUNT_MAPPINGS,
} from '../../../store/accounting/account-mappings/account-mapping.service';

type MappingSource = 'organization' | 'default';

export interface PlatformMappingRow {
  mapping_key: string;
  account_code: string;
  account_id?: number;
  description: string;
  source: MappingSource;
}

@Injectable()
export class AccountMappingsService {
  private readonly logger = new Logger(AccountMappingsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  private async requireContext() {
    return this.platformOrg.requirePlatformContext();
  }

  /**
   * List the mapping cascade for the platform org.
   * Order: DB override → DEFAULT_ACCOUNT_MAPPINGS fallback.
   * If prefix is provided, filters by mapping_key.startsWith(prefix).
   */
  async getMappings(prefix?: string): Promise<PlatformMappingRow[]> {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    const org_mappings = await base.accounting_account_mappings.findMany({
      where: {
        organization_id: ctx.organization_id,
        store_id: null,
        is_active: true,
        ...(prefix && { mapping_key: { startsWith: prefix } }),
      },
      include: {
        account: { select: { id: true, code: true, name: true } },
      },
    });

    const org_map = new Map<
      string,
      { account_code: string; account_id: number; description: string }
    >();
    for (const m of org_mappings) {
      org_map.set(m.mapping_key, {
        account_code: m.account.code,
        account_id: m.account.id,
        description: m.account.name,
      });
    }

    const default_codes = Array.from(
      new Set(
        Object.entries(DEFAULT_ACCOUNT_MAPPINGS)
          .filter(([key]) => !prefix || key.startsWith(prefix))
          .map(([, v]) => v.code),
      ),
    );

    const default_account_id_by_code = new Map<string, number>();
    if (default_codes.length > 0) {
      const default_accounts = await base.chart_of_accounts.findMany({
        where: {
          accounting_entity_id: ctx.accounting_entity_id,
          code: { in: default_codes },
        },
        select: { id: true, code: true },
      });
      for (const a of default_accounts) {
        default_account_id_by_code.set(a.code, a.id);
      }
    }

    return Object.entries(DEFAULT_ACCOUNT_MAPPINGS)
      .filter(([key]) => !prefix || key.startsWith(prefix))
      .map(([mapping_key, def]) => {
        if (org_map.has(mapping_key)) {
          const org_entry = org_map.get(mapping_key)!;
          return {
            mapping_key,
            account_code: org_entry.account_code,
            account_id: org_entry.account_id,
            description: org_entry.description,
            source: 'organization' as const,
          };
        }
        const default_account_id = default_account_id_by_code.get(def.code);
        return {
          mapping_key,
          account_code: def.code,
          account_id: default_account_id,
          description: def.description,
          source: 'default' as const,
        };
      });
  }

  /**
   * Set/update the org-level override for a given mapping key.
   */
  async setOverride(mapping_key: string, account_id: number) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    if (!DEFAULT_ACCOUNT_MAPPINGS[mapping_key]) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `Invalid mapping_key '${mapping_key}'. Must be one of the DEFAULT_ACCOUNT_MAPPINGS keys.`,
      );
    }

    const account = await base.chart_of_accounts.findFirst({
      where: {
        id: account_id,
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
      select: { id: true, code: true, name: true },
    });

    if (!account) {
      throw new VendixHttpException(
        ErrorCodes.ACC_FIND_001,
        `Account with id ${account_id} not found in the platform chart of accounts`,
      );
    }

    const existing = await base.accounting_account_mappings.findFirst({
      where: {
        organization_id: ctx.organization_id,
        store_id: null,
        mapping_key,
      },
    });

    if (existing) {
      return base.accounting_account_mappings.update({
        where: { id: existing.id },
        data: {
          account_id,
          accounting_entity_id: ctx.accounting_entity_id,
          is_active: true,
          updated_at: new Date(),
        },
      });
    }

    return base.accounting_account_mappings.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: null,
        accounting_entity_id: ctx.accounting_entity_id,
        mapping_key,
        account_id,
        is_active: true,
      },
    });
  }

  /**
   * Delete the org-level override, falling back to DEFAULT_ACCOUNT_MAPPINGS.
   */
  async resetOverride(mapping_key: string) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    const existing = await base.accounting_account_mappings.findFirst({
      where: {
        organization_id: ctx.organization_id,
        store_id: null,
        mapping_key,
      },
    });

    if (!existing) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        `No override exists for mapping_key '${mapping_key}'`,
      );
    }

    await base.accounting_account_mappings.delete({
      where: { id: existing.id },
    });

    return { mapping_key, reset: true };
  }
}
