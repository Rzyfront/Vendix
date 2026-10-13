import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { RequestContextService } from '@common/context/request-context.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalContextResolverService } from '../../fiscal-operations/services/fiscal-context-resolver.service';
import { ReceivedDocumentsContext } from '../received-documents.service';
import { FiscalScopeService, OrganizationFiscalScope } from '@common/services/fiscal-scope.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';

/** Authenticated read scope may legitimately have no configured fiscal entity yet. */
export interface ReceivedDocumentsReadContext extends Omit<ReceivedDocumentsContext, 'accounting_entity_id'> {
  accounting_entity_id: number | null;
  fiscal_scope: OrganizationFiscalScope;
}

/** Builds tenant context only from authenticated request state and fiscal resolution. */
@Injectable()
export class ReceivedDocumentsContextService {
  @Inject(FiscalScopeService)
  private readonly fiscalScopes!: FiscalScopeService;

  @Inject(OperatingScopeService)
  private readonly operatingScopes!: OperatingScopeService;

  constructor(
    private readonly fiscalContextResolver: FiscalContextResolverService,
    private readonly prisma: GlobalPrismaService,
  ) {}

  async resolveStoreRead(): Promise<ReceivedDocumentsReadContext> {
    const request = RequestContextService.getContext();
    if (!this.isPositiveId(request?.organization_id) || !this.isPositiveId(request?.store_id)) {
      throw new ForbiddenException('Se requiere contexto autenticado de organización y tienda.');
    }
    return this.resolveRead(request.organization_id, request.store_id, false, request.user_id);
  }

  async resolveOrganizationRead(storeId?: number): Promise<ReceivedDocumentsReadContext> {
    const request = RequestContextService.getContext();
    if (!this.isPositiveId(request?.organization_id)) {
      throw new ForbiddenException('Se requiere contexto autenticado de organización.');
    }
    if (storeId !== undefined && !this.isPositiveId(storeId)) {
      throw new BadRequestException('store_id debe ser un entero positivo.');
    }
    return this.resolveRead(request.organization_id, storeId ?? null, true, request.user_id);
  }

  private async resolveRead(
    organizationId: number,
    storeId: number | null,
    isOrganization: boolean,
    actorId?: number,
  ): Promise<ReceivedDocumentsReadContext> {
    const organization = await this.prisma.organizations.findFirst({
      where: { id: organizationId, state: 'active' },
      select: { id: true },
    });
    if (!organization) throw new ForbiddenException('La organización autenticada no está activa.');
    if (storeId != null) {
      const store = await this.prisma.stores.findFirst({
        where: { id: storeId, organization_id: organizationId, is_active: true },
        select: { id: true },
      });
      if (!store) throw new ForbiddenException('La tienda seleccionada no pertenece a la organización autenticada.');
    }
    const [fiscalScope, operatingScope] = await Promise.all([
      this.fiscalScopes.requireFiscalScope(organizationId),
      this.operatingScopes.requireOperatingScope(organizationId),
    ]);
    this.fiscalScopes.assertValidScopeCombination(operatingScope, fiscalScope);

    let accountingEntityId: number | null = null;
    if (fiscalScope === 'ORGANIZATION' || storeId != null) {
      const candidateId = await this.fiscalScopes.findFiscalAccountingEntityId({
        organization_id: organizationId,
        store_id: storeId,
      });
      if (candidateId != null) {
        const entity = await this.prisma.accounting_entities.findFirst({
          where: {
            id: candidateId,
            organization_id: organizationId,
            store_id: fiscalScope === 'STORE' ? storeId : null,
            scope: fiscalScope,
            fiscal_scope: fiscalScope,
            is_active: true,
          },
          select: { id: true },
        });
        accountingEntityId = entity?.id ?? null;
      }
    }
    return {
      organization_id: organizationId,
      accounting_entity_id: accountingEntityId,
      store_id: storeId,
      actor_id: this.actorId(actorId),
      is_organization: isOrganization,
      fiscal_scope: fiscalScope,
    };
  }

  async resolveStore(): Promise<ReceivedDocumentsContext> {
    const request = RequestContextService.getContext();
    const organizationId = request?.organization_id;
    const operationalStoreId = request?.store_id;
    if (!this.isPositiveId(organizationId) || !this.isPositiveId(operationalStoreId)) {
      throw new ForbiddenException('Se requiere contexto autenticado de organización y tienda.');
    }

    const fiscal = await this.fiscalContextResolver.resolveForStore();
    return {
      organization_id: fiscal.organization_id,
      accounting_entity_id: fiscal.accounting_entity_id,
      // Operational store remains scoped even when fiscal identity is consolidated
      // at organization level (fiscal resolver's store_id is then null).
      store_id: operationalStoreId,
      actor_id: this.actorId(request?.user_id),
      is_organization: false,
    };
  }

  async resolveOrganization(storeId?: number): Promise<ReceivedDocumentsContext> {
    const request = RequestContextService.getContext();
    const organizationId = request?.organization_id;
    if (!this.isPositiveId(organizationId)) {
      throw new ForbiddenException('Se requiere contexto autenticado de organización.');
    }
    if (storeId !== undefined) {
      if (!this.isPositiveId(storeId)) {
        throw new BadRequestException('store_id debe ser un entero positivo.');
      }
      const store = await this.prisma.stores.findFirst({
        where: { id: storeId, organization_id: organizationId, is_active: true },
        select: { id: true },
      });
      if (!store) {
        throw new ForbiddenException('La tienda seleccionada no pertenece a la organización autenticada.');
      }
    }

    // Resolver owns STORE-vs-ORGANIZATION fiscal policy and rejects missing
    // store selection for a STORE-scoped taxpayer.
    const fiscal = await this.fiscalContextResolver.resolveForOrganization({
      store_id: storeId,
    });
    return {
      organization_id: fiscal.organization_id,
      accounting_entity_id: fiscal.accounting_entity_id,
      // Preserve a chosen operational store under a consolidated organization
      // entity so detail/review methods keep the same store predicate.
      store_id: storeId ?? fiscal.store_id,
      actor_id: this.actorId(request?.user_id),
      is_organization: true,
    };
  }

  private actorId(userId?: number): number | undefined {
    return this.isPositiveId(userId) ? userId : undefined;
  }

  private isPositiveId(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
  }
}
