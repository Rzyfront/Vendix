import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { RequestContextService } from '@common/context/request-context.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalContextResolverService } from '../../fiscal-operations/services/fiscal-context-resolver.service';
import { ReceivedDocumentsContext } from '../received-documents.service';

/** Builds tenant context only from authenticated request state and fiscal resolution. */
@Injectable()
export class ReceivedDocumentsContextService {
  constructor(
    private readonly fiscalContextResolver: FiscalContextResolverService,
    private readonly prisma: GlobalPrismaService,
  ) {}

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
