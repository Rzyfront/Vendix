import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import type { OrganizationOperatingScope } from './operating-scope.service';

export type OrganizationFiscalScope = 'STORE' | 'ORGANIZATION';

export interface ResolveFiscalAccountingEntityParams {
  organization_id: number;
  store_id?: number | null;
  tx?: any;
}

interface FiscalScopeCacheEntry {
  scope: OrganizationFiscalScope;
  expires_at: number;
}

@Injectable()
export class FiscalScopeService {
  private readonly scopeCacheTtlMs = 30_000;
  private readonly scopeCache = new Map<number, FiscalScopeCacheEntry>();

  constructor(private readonly prisma: StorePrismaService) {}

  async getFiscalScope(
    organization_id: number,
    tx?: any,
  ): Promise<OrganizationFiscalScope> {
    if (!tx) {
      const cached = this.scopeCache.get(organization_id);
      if (cached && cached.expires_at > Date.now()) {
        return cached.scope;
      }
    }

    const client = tx || this.prisma.withoutScope();
    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: {
        fiscal_scope: true,
        operating_scope: true,
        account_type: true,
      },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    const resolved: OrganizationFiscalScope = organization.fiscal_scope
      ? (organization.fiscal_scope as OrganizationFiscalScope)
      : organization.operating_scope
        ? (organization.operating_scope as OrganizationFiscalScope)
        : organization.account_type === 'MULTI_STORE_ORG'
          ? 'ORGANIZATION'
          : 'STORE';

    if (!tx) {
      this.scopeCache.set(organization_id, {
        scope: resolved,
        expires_at: Date.now() + this.scopeCacheTtlMs,
      });
    }

    return resolved;
  }

  async requireFiscalScope(
    organization_id: number,
    tx?: any,
  ): Promise<OrganizationFiscalScope> {
    if (!organization_id || !Number.isFinite(organization_id)) {
      throw new BadRequestException('organization_id is required');
    }

    try {
      return await this.getFiscalScope(organization_id, tx);
    } catch (error) {
      if (
        error instanceof BadRequestException &&
        /Organization not found/i.test(error.message)
      ) {
        throw new NotFoundException(`Organization ${organization_id} not found`);
      }
      throw error;
    }
  }

  invalidateFiscalScopeCache(organization_id: number): void {
    this.scopeCache.delete(organization_id);
  }

  assertValidScopeCombination(
    operating_scope: OrganizationOperatingScope,
    fiscal_scope: OrganizationFiscalScope,
  ): void {
    if (operating_scope === 'STORE' && fiscal_scope === 'ORGANIZATION') {
      throw new BadRequestException(
        'Invalid scope combination: operating_scope=STORE cannot use fiscal_scope=ORGANIZATION',
      );
    }
  }

  async resolveAccountingEntityForFiscal(
    params: ResolveFiscalAccountingEntityParams,
  ) {
    const client = params.tx || this.prisma.withoutScope();
    const fiscalScope = await this.getFiscalScope(params.organization_id, client);

    if (fiscalScope === 'ORGANIZATION') {
      return this.ensureFiscalAccountingEntity({
        organization_id: params.organization_id,
        fiscal_scope: 'ORGANIZATION',
        client,
      });
    }

    const storeId = await this.resolveStoreIdForFiscalScope(
      params.organization_id,
      params.store_id ?? null,
      client,
    );

    return this.ensureFiscalAccountingEntity({
      organization_id: params.organization_id,
      fiscal_scope: 'STORE',
      store_id: storeId,
      client,
    });
  }

  async isIntercompanyTransfer(params: {
    organization_id: number;
    from_store_id?: number | null;
    to_store_id?: number | null;
    tx?: any;
  }): Promise<boolean> {
    if (!params.from_store_id || !params.to_store_id) return false;
    if (params.from_store_id === params.to_store_id) return false;

    const fiscalScope = await this.getFiscalScope(
      params.organization_id,
      params.tx,
    );
    return fiscalScope === 'STORE';
  }

  async ensureOrganizationFiscalAccountingEntity(
    organization_id: number,
    client: any,
  ) {
    return this.ensureFiscalAccountingEntity({
      organization_id,
      fiscal_scope: 'ORGANIZATION',
      client,
    });
  }

  async ensureStoreFiscalAccountingEntity(
    organization_id: number,
    store_id: number,
    client: any,
  ) {
    return this.ensureFiscalAccountingEntity({
      organization_id,
      fiscal_scope: 'STORE',
      store_id,
      client,
    });
  }

  private async ensureFiscalAccountingEntity(params: {
    organization_id: number;
    fiscal_scope: OrganizationFiscalScope;
    store_id?: number | null;
    client: any;
  }) {
    if (params.fiscal_scope === 'ORGANIZATION') {
      const existing = await params.client.accounting_entities.findFirst({
        where: {
          organization_id: params.organization_id,
          store_id: null,
          scope: 'ORGANIZATION',
          fiscal_scope: 'ORGANIZATION',
          is_active: true,
        },
      });
      if (existing) return existing;

      const organization = await params.client.organizations.findUnique({
        where: { id: params.organization_id },
        select: { name: true, legal_name: true, tax_id: true },
      });
      if (!organization) {
        throw new BadRequestException('Organization not found');
      }

      return params.client.accounting_entities.create({
        data: {
          organization_id: params.organization_id,
          store_id: null,
          scope: 'ORGANIZATION',
          fiscal_scope: 'ORGANIZATION',
          name: organization.name,
          legal_name: organization.legal_name,
          tax_id: organization.tax_id,
        },
      });
    }

    if (!params.store_id) {
      throw new BadRequestException('Fiscal STORE scope requires a store context');
    }

    const existing = await params.client.accounting_entities.findFirst({
      where: {
        organization_id: params.organization_id,
        store_id: params.store_id,
        scope: 'STORE',
        fiscal_scope: 'STORE',
        is_active: true,
      },
    });
    if (existing) return existing;

    const store = await params.client.stores.findFirst({
      where: { id: params.store_id, organization_id: params.organization_id },
      select: {
        id: true,
        name: true,
        legal_name: true,
        tax_id: true,
      },
    });
    if (!store) {
      throw new BadRequestException('Store not found for accounting entity');
    }

    if (!String(store.tax_id ?? '').trim()) {
      throw new BadRequestException({
        code: 'FISCAL_SCOPE_MISSING_TAX_ID',
        message:
          'Store tax_id is required to create a STORE fiscal accounting entity',
        details: {
          organization_id: params.organization_id,
          store_id: store.id,
          remediation_link: '/admin/settings/fiscal-activation',
        },
      });
    }

    return params.client.accounting_entities.create({
      data: {
        organization_id: params.organization_id,
        store_id: store.id,
        scope: 'STORE',
        fiscal_scope: 'STORE',
        name: store.name,
        legal_name: store.legal_name || store.name,
        tax_id: store.tax_id,
      },
    });
  }

  private async resolveStoreIdForFiscalScope(
    organization_id: number,
    store_id: number | null,
    client: any,
  ): Promise<number> {
    if (store_id) {
      const store = await client.stores.findFirst({
        where: { id: store_id, organization_id, is_active: true },
        select: { id: true },
      });

      if (!store) {
        throw new BadRequestException(
          'Store does not belong to the current organization',
        );
      }

      return store.id;
    }

    const stores = await client.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
      take: 2,
    });

    if (stores.length === 1) return stores[0].id;

    throw new BadRequestException(
      'Fiscal STORE scope requires a store context',
    );
  }
}
