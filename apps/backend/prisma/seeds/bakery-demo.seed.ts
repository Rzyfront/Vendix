import { PrismaClient } from '@prisma/client';
import { getPrismaClient, disconnectPrisma } from './shared/client';

/**
 * Pedidos programados + adiciones — tienda demo "Repostería demo".
 *
 * CREATE-ONLY e IDEMPOTENTE: cada recurso se busca por su clave natural
 * (slug, nombre) antes de crearlo. Nunca borra, trunca ni pisa datos.
 *
 * DEPENDENCIES: organización `tech-solutions` y usuario
 * `owner@techsolutions.co` (`organizations-stores.seed.ts`, `users.seed.ts`).
 * Crea la tienda (industria `retail`: no es restaurante, así no dispara a cocina), bodega con stock de insumos, la torta
 * de vainilla en 3 variantes con receta propia, las preparaciones Chantilly y
 * Ganache con receta, la Vela vendible, la categoría "Tortas", los grupos de
 * adiciones Frutas / Cubierta / Velas y activa los dos ajustes.
 *
 * Ejecutar standalone (desde apps/backend):
 *   npx ts-node --transpile-only prisma/seeds/bakery-demo.seed.ts
 */

const ORG_SLUG = 'tech-solutions';
const STORE_SLUG = 'reposteria-demo';
const OWNER_EMAIL = 'owner@techsolutions.co';

export async function seedBakeryDemo(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();
  let created = 0;
  let skipped = 0;
  const ok = (msg: string) => {
    console.log(`   ✅ ${msg}`);
    created++;
  };
  const skip = (msg: string) => {
    console.log(`   ⏭  ${msg}`);
    skipped++;
  };

  const organization = await client.organizations.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) throw new Error(`Falta la organización ${ORG_SLUG}: corre primero el seed base.`);
  const owner = await client.users.findFirst({ where: { email: OWNER_EMAIL } });
  if (!owner) throw new Error(`Falta el usuario ${OWNER_EMAIL}: corre primero el seed base.`);

  // 1. Tienda
  let store = await client.stores.findFirst({
    where: { organization_id: organization.id, slug: STORE_SLUG },
  });
  if (!store) {
    store = await client.stores.create({
      data: {
        name: 'Repostería demo',
        slug: STORE_SLUG,
        organization_id: organization.id,
        store_code: 'REPO-DEMO',
        store_type: 'physical' as any,
        industries: ['retail'] as any,
        timezone: 'America/Bogota',
        is_active: true,
        onboarding: true,
      },
    });
    ok(`Created store "Repostería demo" (id=${store.id})`);
  } else {
    skip(`Skipped store (already exists, id=${store.id})`);
  }
  const storeId = store.id;

  const storeUser = await client.store_users.findUnique({
    where: { store_id_user_id: { store_id: storeId, user_id: owner.id } },
  });
  if (!storeUser) {
    await client.store_users.create({ data: { store_id: storeId, user_id: owner.id } });
    ok('Linked store_users (owner@techsolutions.co)');
  } else {
    skip('Skipped store_users (already linked)');
  }

  // 2. Ajustes: activa pedidos programados (mar–dom 8–18, franjas de 2 h,
  //    3 por franja, 15 por día, 24 h de anticipación) y adiciones. Solo si
  //    la sección aún no existe: no pisa lo que el usuario haya cambiado.
  const storeSettings = await client.store_settings.findUnique({ where: { store_id: storeId } });
  const current = (storeSettings?.settings as Record<string, any> | null) ?? {};
  if (current.scheduled_orders && current.product_options) {
    skip('Skipped store_settings (pedidos programados ya configurados)');
  } else {
    const next = {
      ...current,
      general: {
        timezone: 'America/Bogota',
        currency: 'COP',
        language: 'es',
        tax_included: false,
        ...(current.general ?? {}),
        industries: ['retail'],
      },
      scheduled_orders: current.scheduled_orders ?? {
        enabled: true,
        weekly_schedule: [0, 2, 3, 4, 5, 6].map((day_of_week) => ({
          day_of_week,
          start_time: '08:00',
          end_time: '18:00',
        })),
        slot_duration_minutes: 120,
        slot_capacity: 3,
        day_capacity: 15,
        min_lead_time_hours: 24,
        max_days_ahead: 30,
        fulfillment_types: ['pickup', 'delivery'],
        reminders: [
          { minutes_before: 1440, enabled: true, notify_staff: true, notify_customer: true },
          { minutes_before: 120, enabled: true, notify_staff: true, notify_customer: false },
        ],
      },
      product_options: current.product_options ?? { enabled: true },
    };
    await client.store_settings.upsert({
      where: { store_id: storeId },
      update: { settings: next, updated_at: new Date() },
      create: { store_id: storeId, settings: next },
    });
    ok('Configured store_settings (scheduled_orders + product_options activos)');
  }

  // Excepción: 25 de diciembre cerrado.
  const year = new Date().getFullYear();
  const christmas = new Date(`${year}-12-25T00:00:00.000Z`);
  const exception = await client.fulfillment_schedule_exceptions.findFirst({
    where: { store_id: storeId, date: christmas },
  });
  if (!exception) {
    await client.fulfillment_schedule_exceptions.create({
      data: { store_id: storeId, date: christmas, is_closed: true, reason: 'Navidad' },
    });
    ok(`Created exception ${year}-12-25 (cerrado)`);
  } else {
    skip('Skipped exception 25 de diciembre (already exists)');
  }

  // 3. Bodega
  let location = await client.inventory_locations.findFirst({
    where: { organization_id: organization.id, store_id: storeId, code: 'BOD-REPO' },
  });
  if (!location) {
    location = await client.inventory_locations.create({
      data: {
        organization_id: organization.id,
        store_id: storeId,
        name: 'Bodega repostería',
        code: 'BOD-REPO',
        type: 'warehouse' as any,
        is_default: true,
        is_active: true,
      },
    });
    ok(`Created location "Bodega repostería" (id=${location.id})`);
  } else {
    skip(`Skipped location (already exists, id=${location.id})`);
  }
  const locationId = location.id;
  if (!store.default_location_id) {
    await client.stores.update({ where: { id: storeId }, data: { default_location_id: locationId } });
    ok('Linked default_location_id on store');
  }

  async function ensureProduct(
    slug: string,
    name: string,
    opts: {
      type: 'physical' | 'prepared';
      ingredient: boolean;
      sellable: boolean;
      track: boolean;
      cost: number;
      price: number;
      unit?: string;
      stock?: number;
    },
  ): Promise<number> {
    let product = await client.products.findFirst({ where: { store_id: storeId, slug } });
    if (product) {
      skip(`Skipped product "${name}" (already exists, id=${product.id})`);
    } else {
      product = await client.products.create({
        data: {
          store_id: storeId,
          name,
          slug,
          sku: `REPO-${slug.toUpperCase()}`.slice(0, 100),
          description: `Repostería demo — ${name}`,
          base_price: opts.price,
          cost_price: opts.cost,
          product_type: opts.type as any,
          is_sellable: opts.sellable,
          is_ingredient: opts.ingredient,
          track_inventory: opts.track,
          stock_unit: opts.unit ?? null,
          state: 'active' as any,
        },
      });
      ok(`Created product "${name}" (id=${product.id})`);
    }
    if (opts.stock !== undefined) {
      const level = await client.stock_levels.findFirst({
        where: { product_id: product.id, product_variant_id: null, location_id: locationId },
      });
      if (level) {
        skip(`Skipped stock_levels for "${name}" (already exists)`);
      } else {
        await client.stock_levels.create({
          data: {
            product_id: product.id,
            product_variant_id: null,
            location_id: locationId,
            quantity_on_hand: opts.stock,
            quantity_reserved: 0,
            quantity_available: opts.stock,
            cost_per_unit: opts.cost,
          },
        });
        await client.products.update({ where: { id: product.id }, data: { stock_quantity: opts.stock } });
        ok(`Created stock_levels for "${name}" (qty=${opts.stock})`);
      }
    }
    return product.id;
  }

  // Insumos (stock en g / unidades) y producto vendible.
  const ing = { type: 'physical' as const, ingredient: true, sellable: false, track: true, price: 0 };
  const harina = await ensureProduct('harina', 'Harina', { ...ing, cost: 4, unit: 'g', stock: 50000 });
  const huevos = await ensureProduct('huevos', 'Huevos', { ...ing, cost: 600, unit: 'und', stock: 300 });
  const azucar = await ensureProduct('azucar', 'Azúcar', { ...ing, cost: 3, unit: 'g', stock: 30000 });
  const crema = await ensureProduct('crema-de-leche', 'Crema de leche', { ...ing, cost: 12, unit: 'g', stock: 20000 });
  const chocolate = await ensureProduct('chocolate', 'Chocolate', { ...ing, cost: 30, unit: 'g', stock: 10000 });
  const fresas = await ensureProduct('fresas', 'Fresas', { ...ing, cost: 20, unit: 'g', stock: 8000 });
  const durazno = await ensureProduct('durazno', 'Durazno', { ...ing, cost: 15, unit: 'g', stock: 8000 });
  const vela = await ensureProduct('vela-numero', 'Vela número', {
    type: 'physical', ingredient: false, sellable: true, track: true, cost: 1200, price: 3000, unit: 'und', stock: 100,
  });
  // Preparaciones (mini-recetas) por gramo, sin stock propio.
  const prep = { type: 'prepared' as const, ingredient: true, sellable: false, track: false, price: 0, unit: 'g' };
  const chantilly = await ensureProduct('chantilly', 'Chantilly', { ...prep, cost: 10 });
  const ganache = await ensureProduct('ganache', 'Ganache', { ...prep, cost: 24 });
  // Torta: preparada a pedido, sin stock propio (consume su receta al producir).
  const torta = await ensureProduct('torta-de-vainilla', 'Torta de vainilla', {
    type: 'prepared', ingredient: false, sellable: true, track: false, cost: 0, price: 60000,
  });

  async function ensureRecipe(
    product_id: number,
    variant_id: number | null,
    yield_quantity: number,
    items: Array<[number, number]>,
    label: string,
  ) {
    let recipe = await client.recipes.findFirst({
      where: { store_id: storeId, product_id, product_variant_id: variant_id },
    });
    if (!recipe) {
      recipe = await client.recipes.create({
        data: {
          store_id: storeId,
          product_id,
          product_variant_id: variant_id,
          yield_quantity,
          yield_unit: yield_quantity === 1 ? 'unit' : 'g',
          waste_percent: 0,
          is_active: true,
          preparation_notes: `Receta demo — ${label}`,
        },
      });
      ok(`Created recipe "${label}" (id=${recipe.id})`);
    } else {
      skip(`Skipped recipe "${label}" (already exists)`);
    }
    for (const [component_product_id, quantity] of items) {
      const item = await client.recipe_items.findUnique({
        where: { recipe_id_component_product_id: { recipe_id: recipe.id, component_product_id } },
      });
      if (!item) {
        await client.recipe_items.create({
          data: { recipe_id: recipe.id, component_product_id, quantity, waste_percent: 0 },
        });
      }
    }
  }

  // Mini-recetas por lote de 1000 g.
  await ensureRecipe(chantilly, null, 1000, [[crema, 900], [azucar, 100]], 'Chantilly (1 kg)');
  await ensureRecipe(ganache, null, 1000, [[chocolate, 600], [crema, 400]], 'Ganache (1 kg)');

  // 4. Variantes de la torta con su receta.
  const sizes: Array<[string, number, number]> = [
    ['Pequeña', 45000, 0.6],
    ['Mediana', 60000, 1],
    ['Grande', 80000, 1.5],
  ];
  for (const [size, price, factor] of sizes) {
    const sku = `REPO-TORTA-VAINILLA-${size.toUpperCase()}`;
    let variant = await client.product_variants.findFirst({ where: { product_id: torta, sku } });
    if (!variant) {
      variant = await client.product_variants.create({
        data: {
          product_id: torta,
          sku,
          name: size,
          price_override: price,
          attributes: { Tamaño: size },
        } as any,
      });
      ok(`Created variant "Torta de vainilla — ${size}" (id=${variant.id})`);
    } else {
      skip(`Skipped variant ${size} (already exists)`);
    }
    await ensureRecipe(
      torta,
      variant.id,
      1,
      [[harina, Math.round(300 * factor)], [huevos, Math.round(4 * factor)], [azucar, Math.round(200 * factor)]],
      `Torta de vainilla ${size}`,
    );
  }

  // 5. Categoría "Tortas" con la torta.
  let category = await client.categories.findFirst({ where: { store_id: storeId, slug: 'tortas' } });
  if (!category) {
    category = await client.categories.create({
      data: { store_id: storeId, name: 'Tortas', slug: 'tortas' } as any,
    });
    ok(`Created category "Tortas" (id=${category.id})`);
  } else {
    skip('Skipped category "Tortas" (already exists)');
  }
  const link = await client.product_categories.findUnique({
    where: { product_id_category_id: { product_id: torta, category_id: category.id } },
  });
  if (!link) {
    await client.product_categories.create({ data: { product_id: torta, category_id: category.id } });
    ok('Linked torta → Tortas');
  }

  // 6. Grupos de adiciones.
  type OptionSeed = [string, number, 'ingredient' | 'recipe' | 'product', number, number, string | null];
  async function ensureGroup(
    name: string,
    rules: { min: number; max: number; required: boolean; scope: 'per_unit' | 'per_line' },
    options: OptionSeed[],
    assignment: { category_id?: number; product_id?: number },
  ) {
    let group = await client.product_option_groups.findFirst({ where: { store_id: storeId, name } });
    if (group) {
      skip(`Skipped option group "${name}" (already exists)`);
      return;
    }
    group = await client.product_option_groups.create({
      data: {
        store_id: storeId,
        name,
        min_select: rules.min,
        max_select: rules.max,
        is_required: rules.required,
        scope: rules.scope,
      },
    });
    await client.product_options.createMany({
      data: options.map(([optionName, price, type, component, quantity, uom], i) => ({
        store_id: storeId,
        group_id: group!.id,
        name: optionName,
        price_delta: price,
        component_type: type,
        component_product_id: component,
        quantity,
        uom,
        sort_order: i,
      })),
    });
    await client.product_option_group_assignments.create({
      data: {
        store_id: storeId,
        group_id: group.id,
        category_id: assignment.category_id ?? null,
        product_id: assignment.product_id ?? null,
      },
    });
    ok(`Created option group "${name}" (${options.length} opciones)`);
  }

  await ensureGroup(
    'Frutas',
    { min: 0, max: 2, required: false, scope: 'per_unit' },
    [
      ['Fresas', 5000, 'ingredient', fresas, 80, 'g'],
      ['Durazno', 4000, 'ingredient', durazno, 60, 'g'],
    ],
    { category_id: category.id },
  );
  await ensureGroup(
    'Cubierta',
    { min: 1, max: 1, required: true, scope: 'per_unit' },
    [
      ['Chantilly', 0, 'recipe', chantilly, 150, 'g'],
      ['Ganache', 6000, 'recipe', ganache, 150, 'g'],
    ],
    { category_id: category.id },
  );
  await ensureGroup(
    'Velas',
    { min: 0, max: 1, required: false, scope: 'per_line' },
    [['Vela número', 3000, 'product', vela, 1, 'und']],
    { product_id: torta },
  );

  return { organizationId: organization.id, storeId, created, skipped };
}

// Standalone: npx ts-node --transpile-only prisma/seeds/bakery-demo.seed.ts
if (require.main === module) {
  seedBakeryDemo()
    .then(async (result) => {
      console.log('✅ Bakery demo seed completed');
      console.log(JSON.stringify(result, null, 2));
      await disconnectPrisma();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('❌ Bakery demo seed failed:', e);
      await disconnectPrisma();
      process.exit(1);
    });
}
