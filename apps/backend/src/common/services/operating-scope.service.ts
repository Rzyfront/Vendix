import { BadRequestException, Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';

export type OrganizationOperatingScope = 'STORE' | 'ORGANIZATION';

export interface ResolveAccountingEntityParams {
  organization_id: number;
  store_id?: number | null;
  tx?: any;
}

@Injectable()
export class OperatingScopeService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getOperatingScope(
    organization_id: number,
    tx?: any,
  ): Promise<OrganizationOperatingScope> {
    const client = tx || this.prisma.withoutScope();
    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { operating_scope: true, account_type: true },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    if (organization.operating_scope) {
      return organization.operating_scope as OrganizationOperatingScope;
    }

    return organization.account_type === 'MULTI_STORE_ORG'
      ? 'ORGANIZATION'
      : 'STORE';
  }

  async resolveAccountingEntity(params: ResolveAccountingEntityParams) {
    const client = params.tx || this.prisma.withoutScope();
    const scope = await this.getOperatingScope(params.organization_id, client);

    if (scope === 'ORGANIZATION') {
      return this.ensureOrganizationAccountingEntity(
        params.organization_id,
        client,
      );
    }

    const storeId = await this.resolveStoreIdForStoreScope(
      params.organization_id,
      params.store_id ?? null,
      client,
    );

    return this.ensureStoreAccountingEntity(params.organization_id, storeId, client);
  }

  async validateLocationScope(
    organization_id: number,
    location_ids: number[],
    tx?: any,
  ) {
    const client = tx || this.prisma.withoutScope();
    const scope = await this.getOperatingScope(organization_id, client);
    const locations = await client.inventory_locations.findMany({
      where: { id: { in: location_ids } },
      select: { id: true, organization_id: true, store_id: true },
    });

    if (locations.length !== location_ids.length) {
      throw new BadRequestException('Inventory location not found');
    }

    if (locations.some((location) => location.organization_id !== organization_id)) {
      throw new BadRequestException(
        'Inventory locations must belong to the current organization',
      );
    }

    if (scope === 'ORGANIZATION') {
      return { scope, locations };
    }

    const storeIds = new Set(locations.map((location) => location.store_id));
    if (storeIds.size !== 1 || storeIds.has(null)) {
      throw new BadRequestException(
        'Store-scoped inventory operations must use locations from the same store',
      );
    }

    return { scope, locations };
  }

  private async ensureOrganizationAccountingEntity(
    organization_id: number,
    client: any,
  ) {
    const existing = await client.accounting_entities.findFirst({
      where: {
        organization_id,
        store_id: null,
        scope: 'ORGANIZATION',
        is_active: true,
      },
    });

    if (existing) return existing;

    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { name: true, legal_name: true, tax_id: true },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    return client.accounting_entities.create({
      data: {
        organization_id,
        store_id: null,
        scope: 'ORGANIZATION',
        name: organization.name,
        legal_name: organization.legal_name,
        tax_id: organization.tax_id,
      },
    });
  }

  private async ensureStoreAccountingEntity(
    organization_id: number,
    store_id: number,
    client: any,
  ) {
    const existing = await client.accounting_entities.findFirst({
      where: {
        organization_id,
        store_id,
        scope: 'STORE',
        is_active: true,
      },
    });

    if (existing) return existing;

    const store = await client.stores.findFirst({
      where: { id: store_id, organization_id },
      select: {
        id: true,
        name: true,
        organizations: { select: { legal_name: true, tax_id: true } },
      },
    });

    if (!store) {
      throw new BadRequestException('Store not found for accounting entity');
    }

    return client.accounting_entities.create({
      data: {
        organization_id,
        store_id: store.id,
        scope: 'STORE',
        name: store.name,
        legal_name: store.organizations?.legal_name || store.name,
        tax_id: store.organizations?.tax_id || null,
      },
    });
  }

  private async resolveStoreIdForStoreScope(
    organization_id: number,
    store_id: number | null,
    client: any,
  ): Promise<number> {
    if (store_id) return store_id;

    const stores = await client.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
      take: 2,
    });

    if (stores.length === 1) return stores[0].id;

    throw new BadRequestException(
      'Store-scoped accounting requires a store context',
    );
  }
}
