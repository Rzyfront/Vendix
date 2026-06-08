import { BadRequestException, Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  FiscalScopeService,
  OrganizationFiscalScope,
} from '@common/services/fiscal-scope.service';
import {
  OperatingScopeService,
  OrganizationOperatingScope,
} from '@common/services/operating-scope.service';

export interface FiscalOperationsContext {
  organization_id: number;
  store_id: number | null;
  fiscal_scope: OrganizationFiscalScope;
  operating_scope: OrganizationOperatingScope;
  accounting_entity_id: number;
  accounting_entity: any;
}

@Injectable()
export class FiscalContextResolverService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  async resolveForStore(): Promise<FiscalOperationsContext> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id || !context?.store_id) {
      throw new BadRequestException('Store fiscal context is required');
    }

    return this.resolve({
      organization_id: context.organization_id,
      store_id: context.store_id,
      require_single_entity: true,
    });
  }

  async resolveForOrganization(params?: {
    store_id?: number | null;
    require_single_entity?: boolean;
  }): Promise<FiscalOperationsContext> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization fiscal context is required');
    }

    return this.resolve({
      organization_id: context.organization_id,
      store_id: params?.store_id ?? null,
      require_single_entity: params?.require_single_entity ?? true,
    });
  }

  async resolveManyForOrganization(): Promise<FiscalOperationsContext[]> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization fiscal context is required');
    }

    const operating_scope = await this.operatingScope.requireOperatingScope(
      context.organization_id,
    );
    const fiscal_scope = await this.fiscalScope.requireFiscalScope(
      context.organization_id,
    );

    if (fiscal_scope === 'ORGANIZATION') {
      return [
        await this.resolve({
          organization_id: context.organization_id,
          store_id: null,
          require_single_entity: true,
        }),
      ];
    }

    const stores = await this.prisma.stores.findMany({
      where: { organization_id: context.organization_id, is_active: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const contexts = await Promise.all(
      stores.map((store) =>
        this.resolve({
          organization_id: context.organization_id!,
          store_id: store.id,
          require_single_entity: true,
          known_scopes: { fiscal_scope, operating_scope },
        }),
      ),
    );

    return contexts;
  }

  private async resolve(params: {
    organization_id: number;
    store_id?: number | null;
    require_single_entity: boolean;
    known_scopes?: {
      fiscal_scope: OrganizationFiscalScope;
      operating_scope: OrganizationOperatingScope;
    };
  }): Promise<FiscalOperationsContext> {
    const fiscal_scope =
      params.known_scopes?.fiscal_scope ??
      (await this.fiscalScope.requireFiscalScope(params.organization_id));
    const operating_scope =
      params.known_scopes?.operating_scope ??
      (await this.operatingScope.requireOperatingScope(params.organization_id));

    if (operating_scope === 'STORE' && fiscal_scope === 'ORGANIZATION') {
      throw new BadRequestException(
        'Invalid scope combination: operating_scope=STORE cannot use fiscal_scope=ORGANIZATION',
      );
    }

    if (
      params.require_single_entity &&
      fiscal_scope === 'STORE' &&
      !params.store_id
    ) {
      throw new BadRequestException(
        'store_id is required when fiscal_scope is STORE',
      );
    }

    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: params.organization_id,
        store_id: fiscal_scope === 'STORE' ? params.store_id : null,
      });

    return {
      organization_id: params.organization_id,
      store_id: fiscal_scope === 'STORE' ? params.store_id! : null,
      fiscal_scope,
      operating_scope,
      accounting_entity_id: accounting_entity.id,
      accounting_entity,
    };
  }
}
