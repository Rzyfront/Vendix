import { BadRequestException, Injectable } from '@nestjs/common';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  createDefaultFiscalStatusBlock,
  FiscalArea,
  FiscalStatusBlock,
  FiscalStatusState,
  normalizeFiscalStatusBlock,
} from '../interfaces/fiscal-status.interface';
import {
  FiscalScopeService,
  OrganizationFiscalScope,
} from './fiscal-scope.service';
import { getDefaultStoreSettings } from '../../domains/store/settings/defaults/default-store-settings';
import { getDefaultOrganizationSettings } from '../../domains/organization/settings/defaults/default-organization-settings';

interface FiscalStatusCacheEntry {
  fiscal_scope: OrganizationFiscalScope;
  block: FiscalStatusBlock;
  source_exists: boolean;
  expires_at: number;
}

const STATE_RANK: Record<FiscalStatusState, number> = {
  INACTIVE: 0,
  WIP: 1,
  ACTIVE: 2,
  LOCKED: 3,
};

@Injectable()
export class FiscalStatusResolverService {
  private readonly cacheTtlMs = 30_000;
  private readonly cache = new Map<string, FiscalStatusCacheEntry>();

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  async getStatusBlock(
    organization_id: number,
    store_id?: number | null,
    tx?: any,
  ): Promise<{
    fiscal_scope: OrganizationFiscalScope;
    store_id: number | null;
    fiscal_status: FiscalStatusBlock;
    source_exists: boolean;
  }> {
    const fiscal_scope = await this.fiscalScope.getFiscalScope(
      organization_id,
      tx,
    );
    const targetStoreId =
      fiscal_scope === 'ORGANIZATION'
        ? null
        : await this.requireStoreId(organization_id, store_id, tx);
    const cacheKey = this.cacheKey(organization_id, targetStoreId);

    if (!tx) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires_at > Date.now()) {
        return {
          fiscal_scope: cached.fiscal_scope,
          store_id: targetStoreId,
          fiscal_status: cached.block,
          source_exists: cached.source_exists,
        };
      }
    }

    const client = tx || this.globalPrisma.withoutScope();
    const settings = fiscal_scope === 'ORGANIZATION'
      ? await client.organization_settings.findUnique({
          where: { organization_id },
          select: { settings: true },
        })
      : await client.store_settings.findUnique({
          where: { store_id: targetStoreId! },
          select: { settings: true },
        });

    const raw = (settings?.settings as any) || {};
    const block = normalizeFiscalStatusBlock(raw.fiscal_status);

    if (!tx) {
      this.cache.set(cacheKey, {
        fiscal_scope,
        block,
        source_exists: Boolean(raw.fiscal_status),
        expires_at: Date.now() + this.cacheTtlMs,
      });
    }

    return {
      fiscal_scope,
      store_id: targetStoreId,
      fiscal_status: block,
      source_exists: Boolean(raw.fiscal_status),
    };
  }

  async writeStatusBlock(
    organization_id: number,
    store_id: number | null | undefined,
    mutator: (block: FiscalStatusBlock, tx: any) => Promise<FiscalStatusBlock> | FiscalStatusBlock,
    tx?: any,
  ): Promise<{
    fiscal_scope: OrganizationFiscalScope;
    store_id: number | null;
    fiscal_status: FiscalStatusBlock;
  }> {
    const run = async (client: any) => {
      const fiscal_scope = await this.fiscalScope.getFiscalScope(
        organization_id,
        client,
      );
      const targetStoreId =
        fiscal_scope === 'ORGANIZATION'
          ? null
          : await this.requireStoreId(organization_id, store_id, client);

      const row = fiscal_scope === 'ORGANIZATION'
        ? await client.organization_settings.findUnique({
            where: { organization_id },
            select: { settings: true },
          })
        : await client.store_settings.findUnique({
            where: { store_id: targetStoreId! },
            select: { settings: true },
          });

      const currentSettings = (row?.settings as any) || {};
      const currentBlock = normalizeFiscalStatusBlock(
        currentSettings.fiscal_status,
      );
      const nextBlock = normalizeFiscalStatusBlock(
        await mutator(currentBlock, client),
      );
      const nextSettings = {
        ...currentSettings,
        fiscal_status: nextBlock,
      };

      if (fiscal_scope === 'ORGANIZATION') {
        const defaults = getDefaultOrganizationSettings();
        await client.organization_settings.upsert({
          where: { organization_id },
          create: {
            organization_id,
            settings: { ...defaults, fiscal_status: nextBlock },
          },
          update: { settings: nextSettings, updated_at: new Date() },
        });
      } else {
        await client.store_settings.upsert({
          where: { store_id: targetStoreId! },
          create: {
            store_id: targetStoreId!,
            settings: {
              ...getDefaultStoreSettings(),
              ...nextSettings,
              fiscal_status: nextBlock,
            },
          },
          update: { settings: nextSettings, updated_at: new Date() },
        });
      }

      this.invalidate(organization_id, targetStoreId);
      return { fiscal_scope, store_id: targetStoreId, fiscal_status: nextBlock };
    };

    if (tx) return run(tx);
    return this.globalPrisma.$transaction(run);
  }

  async isFeatureActive(
    organization_id: number,
    store_id: number | null | undefined,
    feature: FiscalArea,
  ): Promise<boolean> {
    const { fiscal_status } = await this.getStatusBlock(organization_id, store_id);
    const state = fiscal_status[feature]?.state;
    return state === 'ACTIVE' || state === 'LOCKED';
  }

  async consolidateFiscalStatusToOrganization(
    organization_id: number,
    tx: any,
  ): Promise<FiscalStatusBlock> {
    const stores = await tx.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });

    const aggregate = createDefaultFiscalStatusBlock();
    for (const store of stores) {
      const row = await tx.store_settings.findUnique({
        where: { store_id: store.id },
        select: { settings: true },
      });
      const block = normalizeFiscalStatusBlock((row?.settings as any)?.fiscal_status);
      for (const area of Object.keys(aggregate) as FiscalArea[]) {
        if (STATE_RANK[block[area].state] > STATE_RANK[aggregate[area].state]) {
          aggregate[area] = block[area];
        }
      }
    }

    const orgSettings = await tx.organization_settings.findUnique({
      where: { organization_id },
      select: { settings: true },
    });
    const currentSettings = (orgSettings?.settings as any) || {};

    await tx.organization_settings.upsert({
      where: { organization_id },
      create: {
        organization_id,
        settings: {
          ...getDefaultOrganizationSettings(),
          fiscal_status: aggregate,
        },
      },
      update: {
        settings: {
          ...currentSettings,
          fiscal_status: aggregate,
        },
        updated_at: new Date(),
      },
    });
    this.invalidateOrganization(organization_id);
    return aggregate;
  }

  async splitFiscalStatusToStores(
    organization_id: number,
    tx: any,
  ): Promise<void> {
    const orgRow = await tx.organization_settings.findUnique({
      where: { organization_id },
      select: { settings: true },
    });
    const orgBlock = normalizeFiscalStatusBlock(
      (orgRow?.settings as any)?.fiscal_status,
    );
    const stores = await tx.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });

    for (const store of stores) {
      const row = await tx.store_settings.findUnique({
        where: { store_id: store.id },
        select: { settings: true },
      });
      const currentSettings = (row?.settings as any) || {};
      await tx.store_settings.upsert({
        where: { store_id: store.id },
        create: {
          store_id: store.id,
          settings: {
            ...getDefaultStoreSettings(),
            fiscal_status: orgBlock,
          },
        },
        update: {
          settings: { ...currentSettings, fiscal_status: orgBlock },
          updated_at: new Date(),
        },
      });
      this.invalidate(organization_id, store.id);
    }
    this.invalidate(organization_id, null);
  }

  invalidate(organization_id: number, store_id?: number | null): void {
    this.cache.delete(this.cacheKey(organization_id, store_id ?? null));
  }

  invalidateOrganization(organization_id: number): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${organization_id}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private cacheKey(organization_id: number, store_id?: number | null): string {
    return `${organization_id}:${store_id ?? 'org'}`;
  }

  private async requireStoreId(
    organization_id: number,
    store_id: number | null | undefined,
    tx?: any,
  ): Promise<number> {
    if (!store_id || !Number.isFinite(store_id)) {
      throw new BadRequestException(
        'store_id is required when fiscal_scope is STORE',
      );
    }

    const client = tx || this.globalPrisma.withoutScope();
    const store = await client.stores.findFirst({
      where: { id: store_id, organization_id },
      select: { id: true },
    });
    if (!store) {
      throw new BadRequestException('Store does not belong to organization');
    }
    return store.id;
  }
}
