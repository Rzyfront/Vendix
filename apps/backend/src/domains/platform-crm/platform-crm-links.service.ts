import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AuditAction, AuditService } from '../../common/audit/audit.service';
import { ErrorCodeEntry, ErrorCodes, VendixHttpException } from '../../common/errors';
import { PlatformCrmContext } from './platform-store.guard';
import {
  LinkPlatformCustomerDto,
  UnlinkPlatformCustomerDto,
} from './dto/platform-crm-links.dto';

export const PLATFORM_CRM_AUDIT_RESOURCE = 'platform_crm_links';
const SEARCH_LIMIT = 10;
const SUMMARY_STORES_LIMIT = 10;
/** Tope de cordura de enlaces activos por cliente (D2): evita que un error de UI cree cientos. */
export const MAX_ACTIVE_LINKS_PER_CUSTOMER = 25;

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

/** Un enlace activo del cliente con su resumen cerrado (candado 7). */
export interface PlatformCrmLinkItem {
  id: number;
  status: string;
  note: string | null;
  linked_at: Date;
  linked_by: { id: number; first_name: string | null; last_name: string | null };
  /** `organization` = la org entera; `store` = solo `linked_store`. */
  scope: 'organization' | 'store';
  linked_store: { id: number; name: string } | null;
  organization: PlatformOrganizationSummary | null;
}

/** `GET store/platform-crm/customers/:customerId/links` */
export interface PlatformCrmLinkList {
  links: PlatformCrmLinkItem[];
}

/**
 * Comercio cubierto por un enlace activo del cliente: la tienda suelta, o cada
 * tienda de una org enlazada completa (incluidas las creadas después).
 */
export interface PlatformCoveredStore {
  store_id: number;
  store_name: string;
  organization_name: string;
  link_id: number;
}

/** Tope de comercios cubiertos que se leen por cliente (25 enlaces × varias tiendas). */
export const MAX_COVERED_STORES = 200;

/** `select` literal de un enlace: lo único que se lee de la fila. */
const LINK_SELECT = {
  id: true,
  status: true,
  note: true,
  linked_at: true,
  organization_id: true,
  linked_by: { select: { id: true, first_name: true, last_name: true } },
  linked_store: { select: { id: true, name: true } },
} as const;

/** Lo que devuelve {@link LINK_SELECT}, escrito a mano: `GetPayload` sobre este esquema dispara el typecheck. */
interface LinkRow {
  id: number;
  status: string;
  note: string | null;
  linked_at: Date;
  organization_id: number;
  linked_by: { id: number; first_name: string | null; last_name: string | null };
  linked_store: { id: number; name: string } | null;
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

  /** Todos los enlaces activos del cliente, del más antiguo al más nuevo. */
  async listLinks(
    ctx: PlatformCrmContext,
    customerId: number,
  ): Promise<PlatformCrmLinkList> {
    await this.assertPlatformCustomer(ctx, customerId);
    const rows = await this.db.platform_crm_links.findMany({
      where: { store_id: ctx.store_id, customer_id: customerId, status: 'linked' },
      select: LINK_SELECT,
      orderBy: [{ linked_at: 'asc' }, { id: 'asc' }],
      take: MAX_ACTIVE_LINKS_PER_CUSTOMER,
    });
    const links: PlatformCrmLinkItem[] = [];
    for (const row of rows) {
      const view = await this.toView(row);
      links.push({
        ...view.link!,
        scope: row.linked_store ? 'store' : 'organization',
        organization: view.organization,
      });
    }
    return { links };
  }

  /**
   * @deprecated Compatibilidad con el front de un solo enlace: devuelve el
   * enlace activo MÁS ANTIGUO. Usar {@link listLinks}; se borra en un PR
   * posterior.
   */
  async getLink(
    ctx: PlatformCrmContext,
    customerId: number,
  ): Promise<PlatformCrmLinkView> {
    await this.assertPlatformCustomer(ctx, customerId);

    const link = await this.db.platform_crm_links.findFirst({
      where: { store_id: ctx.store_id, customer_id: customerId, status: 'linked' },
      select: LINK_SELECT,
      orderBy: [{ linked_at: 'asc' }, { id: 'asc' }],
    });
    if (!link) return { link: null, organization: null };
    return this.toView(link);
  }

  /** Un cliente puede tener varios enlaces (D2); devuelve el que se acaba de crear. */
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
        // Siempre en este orden (cliente → org) para no cruzar candados.
        // Cliente: serializa el tope de enlaces y el «ya es tuyo».
        // Org: la regla «la org entera choca con cualquiera de sus tiendas»
        // cruza dos índices parciales distintos, y ningún único la cubre sola.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform_crm_link_customer:${customerId}`}))`;
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
      // Carrera que los candados no cubran: los únicos parciales de las
      // migraciones deciden; se traduce al mismo 409 del chequeo previo.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.assertNoActiveLink(this.db, customerId, target);
        throw new VendixHttpException(
          target.store ? ErrorCodes.PLATFORM_CRM_007 : ErrorCodes.PLATFORM_CRM_004,
        );
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

    const row = await this.db.platform_crm_links.findFirst({
      where: { id: created.id, store_id: ctx.store_id },
      select: LINK_SELECT,
    });
    return row ? this.toView(row) : { link: null, organization: null };
  }

  /**
   * @deprecated Compatibilidad con el front de un solo enlace. Con más de un
   * enlace activo responde 409 (`PLATFORM_CRM_011`): hay que indicar cuál con
   * {@link unlinkById}. Se borra en un PR posterior.
   */
  async unlink(
    ctx: PlatformCrmContext,
    customerId: number,
    dto: UnlinkPlatformCustomerDto,
  ): Promise<PlatformCrmLinkView> {
    await this.assertPlatformCustomer(ctx, customerId);

    const active = await this.db.platform_crm_links.findMany({
      where: { store_id: ctx.store_id, customer_id: customerId, status: 'linked' },
      select: { id: true },
      take: 2,
    });
    if (active.length === 0) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_005);
    if (active.length > 1) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_011);

    await this.deactivate(ctx, customerId, active[0].id, dto, ErrorCodes.PLATFORM_CRM_005);
    return { link: null, organization: null };
  }

  /**
   * Desenlaza UN enlace del cliente. Anti-IDOR: el `linkId` debe ser un enlace
   * activo de ese cliente en esta tienda plataforma; si no, 404 sin escribir.
   * Devuelve los enlaces que le quedan.
   */
  async unlinkById(
    ctx: PlatformCrmContext,
    customerId: number,
    linkId: number,
    dto: UnlinkPlatformCustomerDto,
  ): Promise<PlatformCrmLinkList> {
    await this.assertPlatformCustomer(ctx, customerId);
    await this.deactivate(ctx, customerId, linkId, dto, ErrorCodes.PLATFORM_CRM_012);
    return this.listLinks(ctx, customerId);
  }

  /** Nunca borra: pasa a `unlinked` y conserva quién y cuándo, con auditoría. */
  private async deactivate(
    ctx: PlatformCrmContext,
    customerId: number,
    linkId: number,
    dto: UnlinkPlatformCustomerDto,
    notFound: ErrorCodeEntry,
  ): Promise<void> {
    const where = {
      id: linkId,
      store_id: ctx.store_id,
      customer_id: customerId,
      status: 'linked' as const,
    };
    const active = await this.db.platform_crm_links.findFirst({
      where,
      select: { id: true, organization_id: true, linked_store_id: true },
    });
    if (!active) throw new VendixHttpException(notFound);

    const result = await this.db.platform_crm_links.updateMany({
      where,
      data: {
        status: 'unlinked',
        unlinked_by_user_id: ctx.user_id,
        unlinked_at: new Date(),
      },
    });
    if (result.count !== 1) throw new VendixHttpException(notFound);

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
  }

  /** Fila del enlace → vista con su resumen cerrado (candado 7). */
  private async toView(link: LinkRow): Promise<PlatformCrmLinkView> {
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

  /**
   * Comercios cubiertos por los enlaces activos del cliente (B.1). Se resuelve
   * al leer: una tienda creada después en una org enlazada completa entra sola.
   * Sin duplicados; si una tienda la cubren su org completa y un enlace suelto,
   * manda el de la org. Base de todo anti-IDOR por `store_id` del módulo.
   */
  async resolveCoveredStores(
    ctx: PlatformCrmContext,
    customerId: number,
  ): Promise<PlatformCoveredStore[]> {
    await this.assertPlatformCustomer(ctx, customerId);
    const links = await this.db.platform_crm_links.findMany({
      where: { store_id: ctx.store_id, customer_id: customerId, status: 'linked' },
      select: { id: true, organization_id: true, linked_store_id: true },
      orderBy: [{ linked_at: 'asc' }, { id: 'asc' }],
      take: MAX_ACTIVE_LINKS_PER_CUSTOMER,
    });
    if (links.length === 0) return [];

    const orgLinks = new Map<number, number>();
    const storeLinks = new Map<number, number>();
    for (const link of links) {
      if (link.linked_store_id === null) orgLinks.set(link.organization_id, link.id);
      else storeLinks.set(link.linked_store_id, link.id);
    }
    const scopes: Prisma.storesWhereInput[] = [];
    if (orgLinks.size) scopes.push({ organization_id: { in: [...orgLinks.keys()] } });
    if (storeLinks.size) scopes.push({ id: { in: [...storeLinks.keys()] } });

    const stores = await this.db.stores.findMany({
      where: { organizations: { is_platform: false }, OR: scopes },
      select: {
        id: true,
        name: true,
        organization_id: true,
        organizations: { select: { name: true } },
      },
      orderBy: [{ organization_id: 'asc' }, { id: 'asc' }],
      take: MAX_COVERED_STORES,
    });

    const covered: PlatformCoveredStore[] = [];
    for (const store of stores) {
      const linkId = orgLinks.get(store.organization_id) ?? storeLinks.get(store.id);
      if (linkId === undefined) continue;
      covered.push({
        store_id: store.id,
        store_name: store.name,
        organization_name: store.organizations.name,
        link_id: linkId,
      });
    }
    return covered;
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
   * - un cliente, VARIOS enlaces (D2), hasta {@link MAX_ACTIVE_LINKS_PER_CUSTOMER};
   *   lo que ya cubre uno de sus enlaces no se vuelve a enlazar (`009`), y la
   *   org entera no se enlaza si ya tiene una de sus tiendas suelta (`013`);
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
    const own = await client.platform_crm_links.findMany({
      where: { status: 'linked', customer_id: customerId },
      select: { organization_id: true, linked_store_id: true },
    });
    const sameOrg = own.filter((l) => l.organization_id === target.organization_id);
    if (target.store) {
      // La misma tienda, o la org entera que ya la cubre.
      if (
        sameOrg.some(
          (l) => l.linked_store_id === null || l.linked_store_id === target.store!.id,
        )
      ) {
        throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_009);
      }
    } else {
      if (sameOrg.some((l) => l.linked_store_id === null)) {
        throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_009);
      }
      if (sameOrg.length > 0) {
        throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_013);
      }
    }
    if (own.length >= MAX_ACTIVE_LINKS_PER_CUSTOMER) {
      throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_010);
    }

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
