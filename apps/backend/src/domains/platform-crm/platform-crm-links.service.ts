import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AuditAction, AuditService } from '../../common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '../../common/errors';
import { PlatformCrmContext } from './platform-store.guard';
import {
  LinkPlatformCustomerDto,
  UnlinkPlatformCustomerDto,
} from './dto/platform-crm-links.dto';

export const PLATFORM_CRM_AUDIT_RESOURCE = 'platform_crm_links';
const SEARCH_LIMIT = 10;
const SUMMARY_STORES_LIMIT = 10;

export interface PlatformOrganizationSearchItem {
  id: number;
  name: string;
  slug: string;
  created_at: Date | null;
}

/** Candado 7: lo ÚNICO que se lee de la organización cliente. */
export interface PlatformOrganizationSummary {
  id: number;
  name: string;
  state: string;
  subscriptions: Array<{
    store_name: string;
    plan_name: string | null;
    state: string | null;
    current_period_end: Date | null;
    trial_ends_at: Date | null;
  }>;
}

export interface PlatformCrmLinkView {
  link: {
    id: number;
    status: string;
    note: string | null;
    linked_at: Date;
    linked_by: { id: number; first_name: string | null; last_name: string | null };
  } | null;
  organization: PlatformOrganizationSummary | null;
}

/**
 * Enlace prospecto del CRM de Vendix Platform ↔ organización cliente
 * (odd/tasks/vendix-platform-crm-enlace.md §4).
 *
 * Es el ÚNICO sitio con `withoutScope()` del módulo. Toda consulta lleva un
 * `select` literal; la organización cliente solo se lee, nunca se escribe.
 * Las tiendas y usuarios que se tocan salen del {@link PlatformCrmContext}
 * que verificó `PlatformStoreGuard`, nunca del token.
 */
@Injectable()
export class PlatformCrmLinksService {
  private readonly logger = new Logger(PlatformCrmLinksService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.withoutScope();
  }

  async searchOrganizations(q: string): Promise<PlatformOrganizationSearchItem[]> {
    const term = q.trim();
    return this.db.organizations.findMany({
      where: {
        is_platform: false,
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
          { tax_id: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, slug: true, created_at: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: SEARCH_LIMIT,
    });
  }

  async getLink(
    ctx: PlatformCrmContext,
    customerId: number,
  ): Promise<PlatformCrmLinkView> {
    await this.assertPlatformCustomer(ctx, customerId);

    const link = await this.db.platform_crm_links.findFirst({
      where: { store_id: ctx.store_id, customer_id: customerId, status: 'linked' },
      select: {
        id: true,
        status: true,
        note: true,
        linked_at: true,
        organization_id: true,
        linked_by: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!link) return { link: null, organization: null };

    return {
      link: {
        id: link.id,
        status: link.status,
        note: link.note,
        linked_at: link.linked_at,
        linked_by: {
          id: link.linked_by.id,
          first_name: link.linked_by.first_name ?? null,
          last_name: link.linked_by.last_name ?? null,
        },
      },
      organization: await this.readOrganizationSummary(link.organization_id),
    };
  }

  async link(
    ctx: PlatformCrmContext,
    customerId: number,
    dto: LinkPlatformCustomerDto,
  ): Promise<PlatformCrmLinkView> {
    await this.assertPlatformCustomer(ctx, customerId);

    const target = await this.db.organizations.findFirst({
      where: { id: dto.organization_id, is_platform: false },
      select: { id: true, name: true },
    });
    if (!target) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_002);

    const note = dto.note?.length ? dto.note : null;
    let created: { id: number };
    try {
      created = await this.db.$transaction(async (tx) => {
        await this.assertNoActiveLink(tx, customerId, target.id);
        return tx.platform_crm_links.create({
          data: {
            store_id: ctx.store_id,
            customer_id: customerId,
            organization_id: target.id,
            note,
            linked_by_user_id: ctx.user_id,
          },
          select: { id: true },
        });
      });
    } catch (error) {
      // Carrera entre dos enlaces simultáneos: los únicos parciales de la
      // migración deciden; se traduce al mismo 409 del chequeo previo.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.assertNoActiveLink(this.db, customerId, target.id);
        throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_003);
      }
      throw error;
    }

    await this.audit.log({
      userId: ctx.user_id,
      storeId: ctx.store_id,
      organizationId: ctx.organization_id,
      action: AuditAction.CREATE,
      resource: PLATFORM_CRM_AUDIT_RESOURCE,
      resourceId: created.id,
      newValues: {
        customer_id: customerId,
        organization_id: target.id,
        status: 'linked',
        note,
      },
      metadata: { action: 'platform_crm_link', organization_name: target.name },
    });

    return this.getLink(ctx, customerId);
  }

  async unlink(
    ctx: PlatformCrmContext,
    customerId: number,
    dto: UnlinkPlatformCustomerDto,
  ): Promise<PlatformCrmLinkView> {
    await this.assertPlatformCustomer(ctx, customerId);

    const active = await this.db.platform_crm_links.findFirst({
      where: { store_id: ctx.store_id, customer_id: customerId, status: 'linked' },
      select: { id: true, organization_id: true },
    });
    if (!active) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_005);

    // Nunca borra: pasa a `unlinked` y conserva quién y cuándo.
    const result = await this.db.platform_crm_links.updateMany({
      where: { id: active.id, store_id: ctx.store_id, status: 'linked' },
      data: {
        status: 'unlinked',
        unlinked_by_user_id: ctx.user_id,
        unlinked_at: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_005);
    }

    const reason = dto.reason?.length ? dto.reason : null;
    await this.audit.log({
      userId: ctx.user_id,
      storeId: ctx.store_id,
      organizationId: ctx.organization_id,
      action: AuditAction.UPDATE,
      resource: PLATFORM_CRM_AUDIT_RESOURCE,
      resourceId: active.id,
      oldValues: { status: 'linked', organization_id: active.organization_id },
      newValues: { status: 'unlinked' },
      metadata: { action: 'platform_crm_unlink', customer_id: customerId, reason },
    });

    return { link: null, organization: null };
  }

  /**
   * El cliente debe ser cliente (`customer`) de la tienda plataforma del
   * contexto. Un id de otra tienda responde igual que uno inexistente.
   */
  private async assertPlatformCustomer(
    ctx: PlatformCrmContext,
    customerId: number,
  ): Promise<void> {
    const customer = await this.db.users.findFirst({
      where: {
        id: customerId,
        store_users: { some: { store_id: ctx.store_id } },
        user_roles: { some: { roles: { name: 'customer' } } },
      },
      select: { id: true },
    });
    if (!customer) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_001);
  }

  private async assertNoActiveLink(
    client: Pick<Prisma.TransactionClient, 'platform_crm_links'>,
    customerId: number,
    organizationId: number,
  ): Promise<void> {
    const existing = await client.platform_crm_links.findFirst({
      where: {
        status: 'linked',
        OR: [{ customer_id: customerId }, { organization_id: organizationId }],
      },
      select: { customer_id: true },
    });
    if (!existing) return;
    throw new VendixHttpException(
      existing.customer_id === customerId
        ? ErrorCodes.PLATFORM_CRM_003
        : ErrorCodes.PLATFORM_CRM_004,
    );
  }

  /**
   * Candado 7: la ÚNICA lectura de la organización cliente. `select` literal
   * y respuesta construida campo por campo: aunque el modelo crezca, no se
   * filtra nada más (el spec fija el conjunto de llaves).
   */
  private async readOrganizationSummary(
    organizationId: number,
  ): Promise<PlatformOrganizationSummary | null> {
    const org = await this.db.organizations.findFirst({
      where: { id: organizationId, is_platform: false },
      select: {
        id: true,
        name: true,
        state: true,
        stores: {
          select: {
            name: true,
            subscription: {
              select: {
                state: true,
                current_period_end: true,
                trial_ends_at: true,
                plan: { select: { name: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
          take: SUMMARY_STORES_LIMIT,
        },
      },
    });
    if (!org) {
      this.logger.warn(
        `platform_crm_links points to organization ${organizationId} that is missing or is_platform`,
      );
      return null;
    }

    return {
      id: org.id,
      name: org.name,
      state: org.state,
      subscriptions: org.stores.map((store) => ({
        store_name: store.name,
        plan_name: store.subscription?.plan?.name ?? null,
        state: store.subscription?.state ?? null,
        current_period_end: store.subscription?.current_period_end ?? null,
        trial_ends_at: store.subscription?.trial_ends_at ?? null,
      })),
    };
  }
}
