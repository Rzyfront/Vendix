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
 * (como el job de CI); el spec aplica la migración real encima: así prueba
 * que es idempotente y que instala el trigger y los únicos parciales que
 * Prisma no expresa.
 */
const MIGRATION_SQL = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../prisma/migrations/20261204090000_platform_crm_links/migration.sql',
  ),
  'utf8',
);

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

  async function createCustomer(store_id: number, organization_id: number, label: string) {
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
      data: { user_id: user.id, role_id: customerRoleId, store_id },
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
    const tenantOrgId = await createOrg('tenant');
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

    // Primera aplicación de la migración sobre el esquema de `migrate diff`.
    await pool.query(MIGRATION_SQL);
  });

  afterAll(async () => {
    await pool?.end();
    await prisma.$disconnect();
  });

  it('la migración aplicada dos veces más no falla ni duplica filas', async () => {
    await pool.query(MIGRATION_SQL);
    await pool.query(MIGRATION_SQL);

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
            WHERE tgname = 'platform_crm_links_platform_store_guard') AS triggers,
         (SELECT count(*)::int FROM pg_indexes WHERE tablename = 'platform_crm_links'
            AND indexname IN ('platform_crm_links_one_active_per_customer',
                              'platform_crm_links_one_active_per_organization')) AS partial_uniques`,
      [platformOrgId],
    );
    expect(rows[0]).toEqual({
      permissions: 2,
      roles: 1,
      grants: 2,
      triggers: 1,
      partial_uniques: 2,
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

  it('doble enlace del mismo cliente o de la misma organización → conflicto', async () => {
    const orgA = await newClientOrg('dup-a');
    const orgB = await newClientOrg('dup-b');
    const customer1 = await createCustomer(ctx.store_id, platformOrgId, 'dup-1');
    const customer2 = await createCustomer(ctx.store_id, platformOrgId, 'dup-2');

    await service.link(ctx, customer1, { organization_id: orgA });

    await expect(
      service.link(ctx, customer1, { organization_id: orgB }),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_003' });
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

  it('dos enlaces simultáneos del mismo cliente: uno gana y el otro recibe 409', async () => {
    const orgA = await newClientOrg('race-a');
    const orgB = await newClientOrg('race-b');
    const customer = await createCustomer(ctx.store_id, platformOrgId, 'race');

    const results = await Promise.allSettled([
      service.link(ctx, customer, { organization_id: orgA }),
      service.link(ctx, customer, { organization_id: orgB }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ errorCode: 'PLATFORM_CRM_003' });
    const active = await db.platform_crm_links.count({
      where: { customer_id: customer, status: 'linked' },
    });
    expect(active).toBe(1);
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
      'note',
      'status',
    ]);
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

  it('la búsqueda excluye la org plataforma, encuentra por NIT y devuelve solo id, nombre, slug y fecha', async () => {
    const byName = await service.searchOrganizations(`PCRM platform ${run}`);
    expect(byName).toEqual([]);

    const orgId = await newClientOrg('nit');
    const byTaxId = await service.searchOrganizations(`pcrmnit${run}`);
    expect(byTaxId.map((o) => o.id)).toEqual([orgId]);
    expect(Object.keys(byTaxId[0]).sort()).toEqual(['created_at', 'id', 'name', 'slug']);
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
