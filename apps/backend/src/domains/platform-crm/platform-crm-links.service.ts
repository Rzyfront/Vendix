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
  state: string;
  created_at: Date | null;
}

/** Tienda de una organización cliente: se puede enlazar sola, sin la org entera. */
export interface PlatformStoreSearchItem {
  id: number;
  name: string;
  slug: string;
  organization: { id: number; name: string };
  plan_name: string | null;
  subscription_state: string | null;
}

export interface PlatformAccountSearchResult {
  organizations: PlatformOrganizationSearchItem[];
  stores: PlatformStoreSearchItem[];
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
    /** Tienda concreta del enlace; `null` = la organización entera. */
    linked_store: { id: number; name: string } | null;
  } | null;
  /**
   * Resumen de la organización enlazada. En un enlace a una tienda,
   * `subscriptions` trae solo la suscripción de esa tienda.
   */
  organization: PlatformOrganizationSummary | null;
}

/** Destino ya verificado de un enlace: la org entera o una de sus tiendas. */
interface LinkTarget {
  organization_id: number;
  organization_name: string;
  store: { id: number; name: string } | null;
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

  /**
   * Organizaciones por nombre, slug o NIT, y tiendas por su nombre o slug o por
   * los de su organización (así, al encontrar la org también aparecen sus
   * tiendas). La org plataforma y sus tiendas nunca salen.
   */
  async searchAccounts(q: string): Promise<PlatformAccountSearchResult> {
    const contains = { contains: q.trim(), mode: 'insensitive' as const };
    const organizationMatch = {
      OR: [{ name: contains }, { slug: contains }, { tax_id: contains }],
    };

    const [organizations, stores] = await Promise.all([
      this.db.organizations.findMany({
        where: { is_platform: false, ...organizationMatch },
        select: { id: true, name: true, slug: true, state: true, created_at: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: SEARCH_LIMIT,
      }),
      this.db.stores.findMany({
        where: {
          organizations: { is_platform: false },
          OR: [
            { name: contains },
            { slug: contains },
            { organizations: organizationMatch },
          ],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          organizations: { select: { id: true, name: true } },
          subscription: { select: { state: true, plan: { select: { name: true } } } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: SEARCH_LIMIT,
      }),
    ]);

    return {
      organizations: organizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        state: org.state,
        created_at: org.created_at,
      })),
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        organization: { id: store.organizations.id, name: store.organizations.name },
        plan_name: store.subscription?.plan?.name ?? null,
        subscription_state: store.subscription?.state ?? null,
      })),
    };
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
        linked_store: { select: { id: true, name: true } },
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
        linked_store: link.linked_store
          ? { id: link.linked_store.id, name: link.linked_store.name }
          : null,
      },
      organization: await this.readOrganizationSummary(
        link.organization_id,
        link.linked_store?.id ?? null,
      ),
    };
  }

  async link(
    ctx: PlatformCrmContext,
    customerId: number,
    dto: LinkPlatformCustomerDto,
  ): Promise<PlatformCrmLinkView> {
    await this.assertPlatformCustomer(ctx, customerId);

    const target = await this.resolveLinkTarget(dto);
    const note = dto.note?.length ? dto.note : null;
    let created: { id: number };
    try {
      created = await this.db.$transaction(async (tx) => {
        // Serializa los enlaces de una misma organización: la regla «la org
        // entera choca con cualquiera de sus tiendas» cruza dos índices
        // parciales distintos, y ningún único la cubre sola.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform_crm_link_org:${target.organization_id}`}))`;
        await this.assertNoActiveLink(tx, customerId, target);
        return tx.platform_crm_links.create({
          data: {
            store_id: ctx.store_id,
            customer_id: customerId,
            organization_id: target.organization_id,
            linked_store_id: target.store?.id ?? null,
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
        await this.assertNoActiveLink(this.db, customerId, target);
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
        organization_id: target.organization_id,
        linked_store_id: target.store?.id ?? null,
        status: 'linked',
        note,
      },
      metadata: {
        action: 'platform_crm_link',
        organization_name: target.organization_name,
        store_name: target.store?.name ?? null,
      },
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
      select: { id: true, organization_id: true, linked_store_id: true },
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
      oldValues: {
        status: 'linked',
        organization_id: active.organization_id,
        linked_store_id: active.linked_store_id,
      },
      newValues: { status: 'unlinked' },
      metadata: { action: 'platform_crm_unlink', customer_id: customerId, reason },
    });

    return { link: null, organization: null };
  }

  /**
   * Prospecto = cliente de la tienda plataforma del contexto, y nada más:
   * - usuario de la org plataforma y vinculado a esa tienda (`store_users`);
   * - con el rol `customer` org-wide (como lo deja el registro) o atado a esa
   *   misma tienda, nunca a otra;
   * - sin ningún otro rol: `customer` es la marca de «esta cuenta no es staff»,
   *   así que un empleado de la tienda que compró en otra no es prospecto.
   * Cualquier otro id responde igual que uno inexistente.
   */
  private async assertPlatformCustomer(
    ctx: PlatformCrmContext,
    customerId: number,
  ): Promise<void> {
    const customer = await this.db.users.findFirst({
      where: {
        id: customerId,
        organization_id: ctx.organization_id,
        store_users: { some: { store_id: ctx.store_id } },
        user_roles: {
          some: {
            roles: { name: 'customer' },
            OR: [{ store_id: null }, { store_id: ctx.store_id }],
          },
          none: { roles: { name: { not: 'customer' } } },
        },
      },
      select: { id: true },
    });
    if (!customer) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_001);
  }

  /**
   * La organización entera (`organization_id`) o una tienda concreta
   * (`linked_store_id`); el DTO garantiza que llega exactamente uno. De una
   * tienda, la organización del enlace es SIEMPRE la suya. La org plataforma
   * y sus tiendas no se enlazan.
   */
  private async resolveLinkTarget(dto: LinkPlatformCustomerDto): Promise<LinkTarget> {
    if (dto.linked_store_id !== undefined) {
      const store = await this.db.stores.findFirst({
        where: { id: dto.linked_store_id, organizations: { is_platform: false } },
        select: {
          id: true,
          name: true,
          organizations: { select: { id: true, name: true } },
        },
      });
      if (!store) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_006);
      return {
        organization_id: store.organizations.id,
        organization_name: store.organizations.name,
        store: { id: store.id, name: store.name },
      };
    }

    const organization = await this.db.organizations.findFirst({
      where: { id: dto.organization_id, is_platform: false },
      select: { id: true, name: true },
    });
    if (!organization) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_002);
    return {
      organization_id: organization.id,
      organization_name: organization.name,
      store: null,
    };
  }

  /**
   * Unicidad (los únicos parciales de las migraciones la respaldan):
   * - un cliente, un enlace activo;
   * - la org entera, un solo prospecto, y ninguna de sus tiendas enlazada a
   *   otro: el enlace a la org reclama todas sus tiendas;
   * - una tienda, un solo prospecto; varias tiendas de una misma org sí pueden
   *   ir a prospectos distintos.
   */
  private async assertNoActiveLink(
    client: Pick<Prisma.TransactionClient, 'platform_crm_links'>,
    customerId: number,
    target: LinkTarget,
  ): Promise<void> {
    const own = await client.platform_crm_links.findFirst({
      where: { status: 'linked', customer_id: customerId },
      select: { id: true },
    });
    if (own) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_003);

    const taken = await client.platform_crm_links.findFirst({
      where: {
        status: 'linked',
        ...(target.store
          ? {
              OR: [
                { linked_store_id: target.store.id },
                { organization_id: target.organization_id, linked_store_id: null },
              ],
            }
          : { organization_id: target.organization_id }),
      },
      select: { linked_store_id: true },
      orderBy: { id: 'asc' },
    });
    if (!taken) return;

    if (target.store) {
      throw new VendixHttpException(
        taken.linked_store_id === target.store.id
          ? ErrorCodes.PLATFORM_CRM_007
          : ErrorCodes.PLATFORM_CRM_004,
      );
    }
    throw new VendixHttpException(
      taken.linked_store_id === null
        ? ErrorCodes.PLATFORM_CRM_004
        : ErrorCodes.PLATFORM_CRM_008,
    );
  }

  /**
   * Candado 7: la ÚNICA lectura de la organización cliente. `select` literal
   * y respuesta construida campo por campo: aunque el modelo crezca, no se
   * filtra nada más (el spec fija el conjunto de llaves).
   */
  private async readOrganizationSummary(
    organizationId: number,
    linkedStoreId: number | null,
  ): Promise<PlatformOrganizationSummary | null> {
    const org = await this.db.organizations.findFirst({
      where: { id: organizationId, is_platform: false },
      select: {
        id: true,
        name: true,
        state: true,
        stores: {
          // Enlace a una tienda: solo esa tienda, nada del resto de la org.
          ...(linkedStoreId !== null ? { where: { id: linkedStoreId } } : {}),
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
