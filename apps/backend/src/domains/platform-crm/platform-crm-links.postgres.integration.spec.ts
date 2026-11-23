import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  assertDisposableDatabase,
  describeDestructiveE2E,
} from '../../testing/destructive-e2e.guard';
import { PlatformCrmLinksService } from './platform-crm-links.service';
import { PlatformCrmContext } from './platform-store.guard';

/**
 * Tests del §6 «Servicio y base (Postgres real)»
 * (odd/tasks/vendix-platform-crm-enlace.md).
 *
 * Como comercial de Vendix en la ficha de un prospecto del CRM, quiero
 * enlazarlo con la organización que creó y paga, deshacer el enlace cuando
 * haga falta y ver solo el plan y el estado de su suscripción, para seguir la
 * venta sin que ningún error me deje enlazar dos veces, borrar historial o ver
 * datos del negocio del cliente.
 *
 * Corre SOLO con `VENDIX_DESTRUCTIVE_E2E=1` contra una base desechable
 * (`assertDisposableDatabase`). El esquema sale de `prisma migrate diff`
 * (como el job de CI); el spec aplica las migraciones reales encima, en orden:
 * así prueba que son idempotentes y que instalan los triggers y los únicos
 * parciales que Prisma no expresa.
 */
const readMigration = (name: string) =>
  fs.readFileSync(
    path.resolve(__dirname, `../../../prisma/migrations/${name}/migration.sql`),
    'utf8',
  );
const MIGRATION_SQL = readMigration('20261204090000_platform_crm_links');
/** Enlace a una tienda concreta: columna, únicos parciales y trigger nuevos. */
const LINKED_STORE_MIGRATION_SQL = readMigration('20261207090000_platform_crm_links_linked_store');
/** D2: un cliente con varios enlaces (quita el único por cliente). */
const MULTI_MIGRATION_SQL = readMigration('20261211090000_platform_crm_links_multi');

/** `pg` no entiende `?schema=public` del DATABASE_URL de Prisma. */
function pgConnectionString(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('schema');
  return parsed.toString();
}

describeDestructiveE2E('platform_crm_links contra Postgres real', () => {
  jest.setTimeout(60_000);

  const prisma = new GlobalPrismaService();
  const db = prisma.withoutScope();
  const audit = { log: jest.fn() };
  const service = new PlatformCrmLinksService(prisma, audit as never);
  const run = Date.now();
  let pool: Pool;

  let platformOrgId: number;
  let ctx: PlatformCrmContext;
  let tenantOrgId: number;
  let tenantStoreId: number;
  let customerRoleId: number;
  let planName: string;
  const clientOrgs: number[] = [];

  async function createOrg(label: string, is_platform = false) {
    const org = await db.organizations.create({
      data: {
        name: `PCRM ${label} ${run}`,
        slug: `pcrm-${label}-${run}`,
        email: `pcrm-${label}-${run}@example.com`,
        tax_id: `PCRM${label}${run}`.slice(0, 50),
        is_platform,
        state: 'active',
      },
      select: { id: true },
    });
    return org.id;
  }

  async function createStore(organization_id: number, label: string) {
    const store = await db.stores.create({
      data: {
        name: `PCRM tienda ${label} ${run}`,
        slug: `pcrm-store-${label}-${run}`,
        organization_id,
        industries: ['administration'],
      },
      select: { id: true },
    });
    return store.id;
  }

  /** `roleStoreId`: tienda a la que queda atado el rol `customer` (por defecto, la misma). */
  async function createCustomer(
    store_id: number,
    organization_id: number,
    label: string,
    roleStoreId: number | null = store_id,
  ) {
    const user = await db.users.create({
      data: {
        username: `pcrm-${label}-${run}`,
        password: 'x',
        first_name: 'Prospecto',
        last_name: label,
        organization_id,
      },
      select: { id: true },
    });
    await db.store_users.create({ data: { store_id, user_id: user.id } });
    await db.user_roles.create({
      data: { user_id: user.id, role_id: customerRoleId, store_id: roleStoreId },
    });
    return user.id;
  }

  async function newClientOrg(label: string) {
    const id = await createOrg(label);
    clientOrgs.push(id);
    return id;
  }

  beforeAll(async () => {
    assertDisposableDatabase();
    pool = new Pool({
      connectionString: pgConnectionString(process.env.DATABASE_URL as string),
    });

    platformOrgId = await createOrg('platform', true);
    const platformStoreId = await createStore(platformOrgId, 'platform');
    tenantOrgId = await createOrg('tenant');
    tenantStoreId = await createStore(tenantOrgId, 'tenant');

    const seller = await db.users.create({
      data: {
        username: `pcrm-seller-${run}`,
        password: 'x',
        first_name: 'Comercial',
        last_name: 'Vendix',
        organization_id: platformOrgId,
      },
      select: { id: true },
    });
    ctx = { store_id: platformStoreId, organization_id: platformOrgId, user_id: seller.id };

    const customerRole =
      (await db.roles.findFirst({
        where: { name: 'customer', organization_id: null, store_id: null },
        select: { id: true },
      })) ??
      (await db.roles.create({
        data: { name: 'customer', is_system_role: true },
        select: { id: true },
      }));
    customerRoleId = customerRole.id;

    // Suscripción de la org cliente para el resumen cerrado.
    planName = `Plan PCRM ${run}`;
    await db.subscription_plans.create({
      data: {
        code: `pcrm-${run}`,
        name: planName,
        base_price: 100000,
        feature_matrix: {},
        ai_feature_flags: {},
      },
    });

    // Primera aplicación de las migraciones, en orden, sobre el esquema de
    // `migrate diff` (que ya trae la columna y la FK de schema.prisma).
    await pool.query(MIGRATION_SQL);
    await pool.query(LINKED_STORE_MIGRATION_SQL);
    await pool.query(MULTI_MIGRATION_SQL);
  });

  /** Tienda de una org cliente con su suscripción al plan de prueba. */
  async function createSubscribedStore(organization_id: number, label: string) {
    const storeId = await createStore(organization_id, label);
    const plan = await db.subscription_plans.findFirst({
      where: { name: planName },
      select: { id: true },
    });
    await db.store_subscriptions.create({
      data: {
        store_id: storeId,
        plan_id: plan!.id,
        state: 'active',
        effective_price: 100000,
        vendix_base_price: 100000,
        resolved_features: {},
        current_period_end: new Date('2027-01-31T00:00:00Z'),
      },
    });
    return storeId;
  }

  afterAll(async () => {
    await pool?.end();
    await prisma.$disconnect();
  });

  it('las migraciones aplicadas dos veces más no fallan ni duplican filas', async () => {
    for (let i = 0; i < 2; i++) {
      await pool.query(MIGRATION_SQL);
      await pool.query(LINKED_STORE_MIGRATION_SQL);
      await pool.query(MULTI_MIGRATION_SQL);
    }

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM permissions
            WHERE name IN ('platform:crm_link:manage','platform:crm_link:read')
              AND is_system_permission) AS permissions,
         (SELECT count(*)::int FROM roles
            WHERE name = 'Comercial Vendix' AND organization_id = $1 AND store_id IS NULL) AS roles,
         (SELECT count(*)::int FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
            WHERE r.name = 'Comercial Vendix' AND r.organization_id = $1) AS grants,
         (SELECT count(*)::int FROM pg_trigger
            WHERE tgname IN ('platform_crm_links_platform_store_guard',
                             'platform_crm_links_linked_store_guard')) AS triggers,
         (SELECT count(*)::int FROM pg_indexes WHERE tablename = 'platform_crm_links'
            AND indexname IN ('platform_crm_links_one_active_per_customer',
                              'platform_crm_links_one_active_per_organization',
                              'platform_crm_links_one_active_per_linked_store')
            AND indexdef LIKE 'CREATE UNIQUE INDEX%WHERE%') AS partial_uniques,
         (SELECT indexdef FROM pg_indexes
            WHERE indexname = 'platform_crm_links_one_active_per_organization') AS org_index`,
      [platformOrgId],
    );
    expect(rows[0]).toEqual({
      permissions: 2,
      roles: 1,
      grants: 2,
      triggers: 2,
      // Org entera y tienda; el único por cliente lo quita la migración multi.
      partial_uniques: 2,
      // El único de la org solo cuenta los enlaces a la org entera.
      org_index: expect.stringContaining('linked_store_id IS NULL'),
    });
  });

  it('INSERT directo con un store_id de otra organización → el trigger lo rechaza', async () => {
    const orgId = await newClientOrg('trigger');
    const customerId = await createCustomer(ctx.store_id, platformOrgId, 'trigger');

    await expect(
      pool.query(
        `INSERT INTO platform_crm_links (store_id, customer_id, organization_id, linked_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [tenantStoreId, customerId, orgId, ctx.user_id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('does not belong to the platform organization'),
    });

    // Tampoco se puede MOVER un enlace válido a la tienda ajena.
    const { rows } = await pool.query(
      `INSERT INTO platform_crm_links (store_id, customer_id, organization_id, linked_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ctx.store_id, customerId, orgId, ctx.user_id],
    );
    await expect(
      pool.query(`UPDATE platform_crm_links SET store_id = $1 WHERE id = $2`, [
        tenantStoreId,
        rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('un cliente con varias organizaciones; la misma organización a otro cliente → conflicto', async () => {
    const orgA = await newClientOrg('dup-a');
    const orgB = await newClientOrg('dup-b');
    const customer1 = await createCustomer(ctx.store_id, platformOrgId, 'dup-1');
    const customer2 = await createCustomer(ctx.store_id, platformOrgId, 'dup-2');

    await service.link(ctx, customer1, { organization_id: orgA });
    // D2: el mismo cliente enlaza una segunda organización.
    await service.link(ctx, customer1, { organization_id: orgB });
    expect(
      (await service.listLinks(ctx, customer1)).links.map((l) => l.organization?.id),
    ).toEqual([orgA, orgB]);
    // La misma org otra vez al mismo cliente → 009, no un segundo enlace.
    await expect(
      service.link(ctx, customer1, { organization_id: orgA }),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_009' });
    await expect(
      service.link(ctx, customer2, { organization_id: orgA }),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_004' });

    // La base también lo impide sin el chequeo del servicio.
    await expect(
      pool.query(
        `INSERT INTO platform_crm_links (store_id, customer_id, organization_id, linked_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [ctx.store_id, customer2, orgA, ctx.user_id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    // El servicio traduce la carrera por este código: Prisma debe reportar el
    // único PARCIAL (que no está en schema.prisma) como P2002.
    await expect(
      db.platform_crm_links.create({
        data: {
          store_id: ctx.store_id,
          customer_id: customer2,
          organization_id: orgA,
          linked_by_user_id: ctx.user_id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('dos enlaces simultáneos del mismo cliente a dos orgs: los dos entran (D2)', async () => {
    const orgA = await newClientOrg('race-a');
    const orgB = await newClientOrg('race-b');
    const customer = await createCustomer(ctx.store_id, platformOrgId, 'race');

    const results = await Promise.allSettled([
      service.link(ctx, customer, { organization_id: orgA }),
      service.link(ctx, customer, { organization_id: orgB }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const active = await db.platform_crm_links.count({
      where: { customer_id: customer, status: 'linked' },
    });
    expect(active).toBe(2);
  });

  it('org entera + tienda de otra org al mismo cliente; desenlazar por id deja la otra; un id ajeno → 404', async () => {
    const orgA = await newClientOrg('multi-a');
    const orgB = await newClientOrg('multi-b');
    const storeB = await createSubscribedStore(orgB, 'multi-b');
    const customer = await createCustomer(ctx.store_id, platformOrgId, 'multi');
    const other = await createCustomer(ctx.store_id, platformOrgId, 'multi-other');

    const first = await service.link(ctx, customer, { organization_id: orgA });
    const second = await service.link(ctx, customer, { linked_store_id: storeB });
    const otherLink = await service.link(ctx, other, { organization_id: await newClientOrg('multi-c') });

    const { links } = await service.listLinks(ctx, customer);
    expect(links.map((l) => [l.id, l.scope])).toEqual([
      [first.link!.id, 'organization'],
      [second.link!.id, 'store'],
    ]);
    // El GET de compatibilidad devuelve el más antiguo; el DELETE viejo pide cuál.
    expect((await service.getLink(ctx, customer)).link?.id).toBe(first.link!.id);
    await expect(service.unlink(ctx, customer, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_011',
    });

    await expect(
      service.unlinkById(ctx, customer, otherLink.link!.id, {}),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_012' });
    expect(
      await db.platform_crm_links.count({ where: { id: otherLink.link!.id, status: 'linked' } }),
    ).toBe(1);

    const rest = await service.unlinkById(ctx, customer, first.link!.id, { reason: 'vendió' });
    expect(rest.links.map((l) => l.id)).toEqual([second.link!.id]);
  });

  it('desenlazar y volver a enlazar conserva el historial', async () => {
    const orgA = await newClientOrg('hist-a');
    const orgB = await newClientOrg('hist-b');
    const customer = await createCustomer(ctx.store_id, platformOrgId, 'hist');

    await service.link(ctx, customer, { organization_id: orgA, note: 'primera venta' });
    await service.unlink(ctx, customer, { reason: 'se equivocó de org' });
    expect(await service.getLink(ctx, customer)).toEqual({ link: null, organization: null });
    await service.link(ctx, customer, { organization_id: orgB });

    const rows = await db.platform_crm_links.findMany({
      where: { customer_id: customer },
      orderBy: { id: 'asc' },
      select: {
        organization_id: true,
        status: true,
        note: true,
        linked_by_user_id: true,
        unlinked_by_user_id: true,
        unlinked_at: true,
      },
    });
    expect(rows).toEqual([
      {
        organization_id: orgA,
        status: 'unlinked',
        note: 'primera venta',
        linked_by_user_id: ctx.user_id,
        unlinked_by_user_id: ctx.user_id,
        unlinked_at: expect.any(Date),
      },
      {
        organization_id: orgB,
        status: 'linked',
        note: null,
        linked_by_user_id: ctx.user_id,
        unlinked_by_user_id: null,
        unlinked_at: null,
      },
    ]);
    // Un segundo desenlace ya no encuentra enlace activo: 404 y ninguna fila
    // borrada.
    await service.unlink(ctx, customer, {});
    await expect(service.unlink(ctx, customer, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_005',
    });
    expect(await db.platform_crm_links.count({ where: { customer_id: customer } })).toBe(2);
  });

  it('el resumen no expone campos fuera de la lista (snapshot de las llaves)', async () => {
    const orgId = await newClientOrg('summary');
    const storeId = await createStore(orgId, 'summary');
    const plan = await db.subscription_plans.findFirst({
      where: { name: planName },
      select: { id: true },
    });
    await db.store_subscriptions.create({
      data: {
        store_id: storeId,
        plan_id: plan!.id,
        state: 'trial',
        effective_price: 100000,
        vendix_base_price: 100000,
        resolved_features: {},
        trial_ends_at: new Date('2026-12-31T00:00:00Z'),
      },
    });
    const customer = await createCustomer(ctx.store_id, platformOrgId, 'summary');

    const view = await service.link(ctx, customer, { organization_id: orgId });

    expect(Object.keys(view).sort()).toEqual(['link', 'organization']);
    expect(Object.keys(view.link!).sort()).toEqual([
      'id',
      'linked_at',
      'linked_by',
      'linked_store',
      'note',
      'status',
    ]);
    expect(view.link!.linked_store).toBeNull();
    expect(Object.keys(view.link!.linked_by).sort()).toEqual([
      'first_name',
      'id',
      'last_name',
    ]);
    expect(Object.keys(view.organization!).sort()).toEqual([
      'id',
      'name',
      'state',
      'subscriptions',
    ]);
    expect(view.organization!.subscriptions).toEqual([
      {
        store_name: `PCRM tienda summary ${run}`,
        plan_name: planName,
        state: 'trial',
        current_period_end: null,
        trial_ends_at: new Date('2026-12-31T00:00:00Z'),
      },
    ]);
    // Lo que NO debe salir aunque exista en la fila de la organización.
    expect(JSON.stringify(view)).not.toMatch(/tax_id|email|slug|legal_name|PCRMsummary/);

    // La lista de enlaces (D2) agrega solo `scope` y el mismo resumen cerrado.
    const { links } = await service.listLinks(ctx, customer);
    expect(Object.keys(links[0]).sort()).toEqual([
      'id',
      'linked_at',
      'linked_by',
      'linked_store',
      'note',
      'organization',
      'scope',
      'status',
    ]);
    expect(links[0].organization).toEqual(view.organization);
    expect(JSON.stringify(links)).not.toMatch(/tax_id|email|slug|legal_name|PCRMsummary/);
  });

  it('cliente de otra tienda u organización plataforma → 404 sin escribir nada', async () => {
    const orgId = await newClientOrg('foreign');
    const foreignCustomer = await createCustomer(tenantStoreId, platformOrgId, 'foreign');
    const ownCustomer = await createCustomer(ctx.store_id, platformOrgId, 'own');
    const before = await db.platform_crm_links.count();

    await expect(
      service.link(ctx, foreignCustomer, { organization_id: orgId }),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_001' });
    await expect(service.getLink(ctx, foreignCustomer)).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_001',
    });
    await expect(
      service.link(ctx, ownCustomer, { organization_id: platformOrgId }),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_002' });
    expect(await db.platform_crm_links.count()).toBe(before);
  });

  it('solo un cliente de la tienda plataforma es prospecto: empleado, otra org o rol de otra tienda → 404 sin escribir nada', async () => {
    const orgId = await newClientOrg('not-prospect');
    const staffRole = await db.roles.create({
      data: { name: `pcrm-staff-${run}`, organization_id: platformOrgId },
      select: { id: true },
    });

    // Empleado de la tienda plataforma que además es cliente de otra tienda:
    // rol `customer` org-wide (como lo deja el registro) + vínculo con ambas.
    const employee = await createCustomer(tenantStoreId, platformOrgId, 'employee', null);
    await db.store_users.create({ data: { store_id: ctx.store_id, user_id: employee } });
    await db.user_roles.create({
      data: { user_id: employee, role_id: staffRole.id, store_id: ctx.store_id },
    });
    // Vinculado a la tienda plataforma, pero es usuario de otra organización.
    const otherOrgUser = await createCustomer(ctx.store_id, tenantOrgId, 'other-org');
    // Su rol de cliente está atado a otra tienda.
    const foreignRole = await createCustomer(ctx.store_id, platformOrgId, 'foreign-role', tenantStoreId);
    const before = await db.platform_crm_links.count();

    for (const customerId of [employee, otherOrgUser, foreignRole]) {
      await expect(
        service.link(ctx, customerId, { organization_id: orgId }),
      ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_001' });
      await expect(service.getLink(ctx, customerId)).rejects.toMatchObject({
        errorCode: 'PLATFORM_CRM_001',
      });
    }
    expect(await db.platform_crm_links.count()).toBe(before);

    // Control: el cliente de la tienda plataforma, con el rol org-wide del
    // registro o atado a esa tienda, sí es prospecto.
    for (const roleStoreId of [null, ctx.store_id]) {
      const prospect = await createCustomer(
        ctx.store_id,
        platformOrgId,
        `prospect-${roleStoreId ?? 'org'}`,
        roleStoreId,
      );
      await expect(service.getLink(ctx, prospect)).resolves.toEqual({
        link: null,
        organization: null,
      });
    }
  });

  it('la búsqueda excluye la org plataforma y sus tiendas, encuentra la org por NIT y devuelve solo id, nombre, slug, estado y fecha', async () => {
    expect(await service.searchAccounts(`PCRM platform ${run}`)).toEqual({
      organizations: [],
      stores: [],
    });
    expect(await service.searchAccounts(`pcrm-store-platform-${run}`)).toEqual({
      organizations: [],
      stores: [],
    });

    const orgId = await newClientOrg('nit');
    const byTaxId = await service.searchAccounts(`pcrmnit${run}`);
    expect(byTaxId.organizations.map((o) => o.id)).toEqual([orgId]);
    expect(Object.keys(byTaxId.organizations[0]).sort()).toEqual([
      'created_at',
      'id',
      'name',
      'slug',
      'state',
    ]);
    expect(byTaxId.organizations[0].state).toBe('active');
  });

  it('la búsqueda encuentra tiendas por nombre o slug, y las de la org encontrada, con su org, plan y estado', async () => {
    const orgId = await newClientOrg('search-stores');
    const storeId = await createSubscribedStore(orgId, 'buscable');

    const byStoreName = await service.searchAccounts(`tienda buscable ${run}`);
    expect(byStoreName.organizations).toEqual([]);
    expect(byStoreName.stores).toEqual([
      {
        id: storeId,
        name: `PCRM tienda buscable ${run}`,
        slug: `pcrm-store-buscable-${run}`,
        organization: { id: orgId, name: `PCRM search-stores ${run}` },
        plan_name: planName,
        subscription_state: 'active',
      },
    ]);

    const byStoreSlug = await service.searchAccounts(`pcrm-store-buscable-${run}`);
    expect(byStoreSlug.stores.map((s) => s.id)).toEqual([storeId]);

    // Al encontrar la org (por nombre, slug o NIT) también salen sus tiendas.
    const byOrgName = await service.searchAccounts(`PCRM search-stores ${run}`);
    expect(byOrgName.organizations.map((o) => o.id)).toEqual([orgId]);
    expect(byOrgName.stores.map((s) => s.id)).toEqual([storeId]);
  });

  it('enlazar una tienda guarda la org de esa tienda y la ficha muestra solo esa tienda con su plan', async () => {
    const orgId = await newClientOrg('store-link');
    const storeId = await createSubscribedStore(orgId, 'store-link-a');
    await createSubscribedStore(orgId, 'store-link-b');
    const customer = await createCustomer(ctx.store_id, platformOrgId, 'store-link');

    const view = await service.link(ctx, customer, { linked_store_id: storeId, note: 'sede norte' });

    expect(view.link).toMatchObject({
      status: 'linked',
      note: 'sede norte',
      linked_store: { id: storeId, name: `PCRM tienda store-link-a ${run}` },
    });
    expect(view.organization).toEqual({
      id: orgId,
      name: `PCRM store-link ${run}`,
      state: 'active',
      subscriptions: [
        {
          store_name: `PCRM tienda store-link-a ${run}`,
          plan_name: planName,
          state: 'active',
          current_period_end: new Date('2027-01-31T00:00:00Z'),
          trial_ends_at: null,
        },
      ],
    });
    const row = await db.platform_crm_links.findFirst({
      where: { customer_id: customer },
      select: { organization_id: true, linked_store_id: true },
    });
    expect(row).toEqual({ organization_id: orgId, linked_store_id: storeId });
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        newValues: expect.objectContaining({ organization_id: orgId, linked_store_id: storeId }),
      }),
    );

    // Desenlazar un enlace a tienda funciona igual y conserva la fila.
    await service.unlink(ctx, customer, {});
    expect(await service.getLink(ctx, customer)).toEqual({ link: null, organization: null });
    expect(
      await db.platform_crm_links.count({ where: { customer_id: customer, status: 'unlinked' } }),
    ).toBe(1);
  });

  it('unicidad: una tienda por prospecto, varias tiendas de una org a prospectos distintos y la org entera choca con sus tiendas', async () => {
    const orgId = await newClientOrg('uniq');
    const storeA = await createStore(orgId, 'uniq-a');
    const storeB = await createStore(orgId, 'uniq-b');
    const otherOrg = await newClientOrg('uniq-other');
    const [c1, c2, c3, c4] = await Promise.all(
      ['uniq-1', 'uniq-2', 'uniq-3', 'uniq-4'].map((label) =>
        createCustomer(ctx.store_id, platformOrgId, label),
      ),
    );

    await service.link(ctx, c1, { linked_store_id: storeA });
    // Misma tienda a otro prospecto → 409 de tienda.
    await expect(service.link(ctx, c2, { linked_store_id: storeA })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_007',
    });
    // Otra tienda de la misma org → permitido.
    await service.link(ctx, c2, { linked_store_id: storeB });
    // La org entera ya tiene tiendas enlazadas → 409.
    await expect(service.link(ctx, c3, { organization_id: orgId })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_008',
    });
    // D2: el prospecto con enlace sí puede tener otro, en otra org.
    await service.link(ctx, c1, { organization_id: otherOrg });
    // Pero no la misma tienda otra vez (009), ni la org entera de su tienda (013).
    await expect(service.link(ctx, c1, { linked_store_id: storeA })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_009',
    });
    await expect(service.link(ctx, c1, { organization_id: orgId })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_013',
    });

    // Org entera enlazada → ninguna de sus tiendas se enlaza a otro.
    const wholeOrg = await newClientOrg('uniq-whole');
    const wholeStore = await createStore(wholeOrg, 'uniq-whole');
    await service.link(ctx, c3, { organization_id: wholeOrg });
    await expect(service.link(ctx, c4, { linked_store_id: wholeStore })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_004',
    });
    // Al mismo cliente, su tienda ya está cubierta por la org entera → 009.
    await expect(service.link(ctx, c3, { linked_store_id: wholeStore })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_009',
    });

    // La base impide dos enlaces activos a la misma tienda sin el servicio, y
    // Prisma lo reporta como P2002 (el servicio traduce la carrera por él).
    await expect(
      pool.query(
        `INSERT INTO platform_crm_links (store_id, customer_id, organization_id, linked_store_id, linked_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.store_id, c4, orgId, storeA, ctx.user_id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.platform_crm_links.create({
        data: {
          store_id: ctx.store_id,
          customer_id: c4,
          organization_id: orgId,
          linked_store_id: storeA,
          linked_by_user_id: ctx.user_id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enlazar a la vez la org entera y una de sus tiendas: el candado por org deja pasar solo uno', async () => {
    // Ningún único parcial cubre este choque (cada enlace cae en un índice
    // distinto): sin `pg_advisory_xact_lock` los dos chequeos leen «libre» y
    // ambos se crean. Varias orgs a la vez para que la carrera ocurra de verdad.
    const pairs = await Promise.all(
      ['lock-1', 'lock-2', 'lock-3', 'lock-4'].map(async (label) => {
        const orgId = await newClientOrg(label);
        const storeId = await createStore(orgId, label);
        const [wholeOrgCustomer, storeCustomer] = await Promise.all([
          createCustomer(ctx.store_id, platformOrgId, `${label}-org`),
          createCustomer(ctx.store_id, platformOrgId, `${label}-store`),
        ]);
        return { orgId, storeId, wholeOrgCustomer, storeCustomer };
      }),
    );

    const outcomes = await Promise.all(
      pairs.map((p) =>
        Promise.allSettled([
          service.link(ctx, p.wholeOrgCustomer, { organization_id: p.orgId }),
          service.link(ctx, p.storeCustomer, { linked_store_id: p.storeId }),
        ]),
      ),
    );

    for (const [i, results] of outcomes.entries()) {
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      // Org entera primero → la tienda recibe 004; tienda primero → la org recibe 008.
      expect(['PLATFORM_CRM_004', 'PLATFORM_CRM_008']).toContain(rejected.reason?.errorCode);
      expect(
        await db.platform_crm_links.count({
          where: { organization_id: pairs[i].orgId, status: 'linked' },
        }),
      ).toBe(1);
    }
  });

  it('una tienda de la org plataforma o inexistente no se enlaza; la base rechaza una tienda ajena a la org del enlace', async () => {
    const customer = await createCustomer(ctx.store_id, platformOrgId, 'store-reject');
    const before = await db.platform_crm_links.count();

    await expect(
      service.link(ctx, customer, { linked_store_id: ctx.store_id }),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_006' });
    await expect(
      service.link(ctx, customer, { linked_store_id: 2_000_000_000 }),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_006' });
    expect(await db.platform_crm_links.count()).toBe(before);

    // Sin el servicio: tienda de otra org que la del enlace → el trigger la rechaza.
    const orgId = await newClientOrg('store-reject');
    const foreignStore = await createStore(await newClientOrg('store-reject-other'), 'reject');
    await expect(
      pool.query(
        `INSERT INTO platform_crm_links (store_id, customer_id, organization_id, linked_store_id, linked_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.store_id, customer, orgId, foreignStore, ctx.user_id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('does not belong to client organization'),
    });
  });

  it('cada enlace y desenlace queda en la auditoría con la org plataforma como dueña', () => {
    const calls = audit.log.mock.calls.map(([entry]) => entry);
    expect(calls.length).toBeGreaterThan(0);
    for (const entry of calls) {
      expect(entry).toMatchObject({
        userId: ctx.user_id,
        storeId: ctx.store_id,
        organizationId: platformOrgId,
        resource: 'platform_crm_links',
      });
    }
    expect(calls.some((e) => e.metadata?.action === 'platform_crm_unlink')).toBe(true);
  });
});
